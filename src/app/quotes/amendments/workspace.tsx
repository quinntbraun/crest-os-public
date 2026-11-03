'use client';
import {useEffect,useRef,useState} from 'react';
import {createQuoteAmendmentWorkspace,initialQuoteAmendmentWorkspaceView} from '../../../client/quote-amendment-workspace';
import {QuoteDocument} from '../quote-document';
import {QuoteAmendmentDocument} from '../quote-amendment-document';
import {quoteMoney} from '../../../commercial/quote-pricing';
import {AmendmentDraftEditor} from './draft-editor';
import {AmendmentReviewAndSharing} from './review-and-sharing';
import {SavedAmendmentDownload} from './saved-record-download';

/** Construction view. Amendment APIs remain closed by default; the complete
 * amendment feature, source/recovery adoption and release gates are pending. */
export function QuoteAmendmentWorkspace(){
 const [view,setView]=useState(initialQuoteAmendmentWorkspaceView),[search,setSearch]=useState(''),controller=useRef<ReturnType<typeof createQuoteAmendmentWorkspace>|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  const current=createQuoteAmendmentWorkspace({storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView});controller.current=current;void current.load();
  const hide=()=>{if(document.visibilityState==='hidden'){setSearch('');current.clearPrivate();}},leave=()=>{setSearch('');current.clearPrivate();},restore=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return ()=>{controller.current=null;current.dispose();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
 },[]);
 const focused=useRef('');
 useEffect(()=>{const identity=view.selected?view.selected.revision.id+':'+view.selected.revision.version:'';if(view.phase==='ready'&&identity&&!view.busy&&identity!==focused.current){focused.current=identity;heading.current?.focus();}else if(!identity)focused.current='';},[view.phase,view.selected,view.busy]);
 const discard=()=>!view.dirty||window.confirm('Discard the unsaved amendment changes? They are kept only on this page.');
 const selected=view.selected,amendment=view.amendment;
 return <>
  <p className="intro">Review accepted work and prepare a separate amendment. Saving a Draft does not change the accepted agreement, booked jobs or financial history.</p>
  <p role="status" aria-live="polite" className="notice">{view.status}</p>
  <div className="amendment-actions"><button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard()){setSearch('');void controller.current?.load();}}}>Load accepted work</button><a href="/quotes" onClick={event=>{if(!discard())event.preventDefault();}}>All quotes</a><a href="/save-review" onClick={event=>{if(!discard())event.preventDefault();}}>Save review</a></div>
  {view.phase==='pending'&&<button type="button" disabled={!view.canLookup} onClick={()=>void controller.current?.lookup()}>Check original quote result</button>}
  {view.phase==='ready'&&!selected&&<>
   <form className="service-search" aria-label="Find accepted work" onSubmit={event=>{event.preventDefault();void controller.current?.load(search);}}><label>Find accepted quotes<input type="search" value={search} maxLength={200} onChange={event=>setSearch(event.target.value)} disabled={view.busy}/></label><button type="submit" disabled={view.busy}>Find accepted work</button></form>
   <ul className="customer-list">{view.rows.map(row=><li key={row.family.id}><button type="button" className="secondary service-scope" disabled={view.busy} onClick={()=>void controller.current?.open(row.family.id)}><strong>{row.parent.revision.customer_safe_snapshot.recipient.displayName}</strong><span>{row.parent.revision.customer_safe_snapshot.title} · Accepted agreement {row.parent.versionNo}</span><span>{quoteMoney(row.parent.revision.total_cents)} · {row.revision.kind==='amendment'?'Amendment '+row.revision.state:'Accepted quote'}</span></button></li>)}</ul>
   {view.rows.length===0&&<p>No accepted work to display.</p>}
   {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void controller.current?.load(view.search,true)}>Next accepted quote page</button>}
  </>}
  {selected&&<section aria-label="Selected accepted work">
   <h2 tabIndex={-1} ref={heading}>{selected.parent.revision.customer_safe_snapshot.title}</h2>
   <p>{selected.parent.revision.customer_safe_snapshot.recipient.displayName} · Accepted agreement {selected.parent.versionNo} · {quoteMoney(selected.parent.revision.total_cents)}</p>
   {view.writesPaused&&<p className="notice">Changes are paused. Saved terms and history remain available.</p>}
   <details><summary>Accepted scope and terms</summary><QuoteDocument quote={selected.parent.revision.customer_safe_snapshot} stage="accepted"/></details>
   {amendment&&<>
    <h3>Current amendment · {amendment.revision.state}</h3>
    {!amendment.parentIsCurrent&&<p className="notice">This amendment refers to an earlier accepted agreement. Review the current accepted terms before preparing further changes.</p>}
    <AmendmentDraftEditor view={view} controller={controller}/>
    {view.dirty&&<p className="notice">The comparison below shows the saved amendment. Save your edits to update it.</p>}
    <QuoteAmendmentDocument comparison={amendment.comparison.customer}/>
    <AmendmentReviewAndSharing key={amendment.revision.id+':'+amendment.revision.version} view={view} controller={controller}/>
    <details><summary>Saved amendment history</summary><p className="field-help">{amendment.history.length?'Showing retained versions '+amendment.history[0]!.revision+'–'+amendment.history.at(-1)!.revision+' of '+amendment.revision.version+'.':'No later history events.'} These are saved events; unsaved edits are excluded.</p><ol className="customer-history">{amendment.history.map(event=><li key={event.eventId}><strong>{event.action} · Version {event.revision}</strong> · <time dateTime={event.at}>{event.at}</time><details><summary>Customer content at version {event.revision}</summary><QuoteDocument quote={event.after.customer_safe_snapshot} stage={event.action==='approve'?'approved':event.after.state==='Sent'?'sent':event.after.state==='Superseded'?'superseded':event.after.state==='Ready for Review'?'review':'draft'}/></details></li>)}</ol><div className="amendment-actions"><button type="button" className="secondary" disabled={!view.canReadHistory} onClick={()=>void controller.current?.historyPage(true)}>First amendment history page</button>{amendment.hasMore&&<button type="button" className="secondary" disabled={!view.canReadHistory} onClick={()=>void controller.current?.historyPage()}>Next amendment history page</button>}</div>{view.dirty&&<p className="field-help">Save your edits before loading another history page or downloading the saved record.</p>}</details>
    <SavedAmendmentDownload key={'record:'+amendment.revision.id+':'+amendment.revision.version} disabled={!view.canReadHistory} archive={()=>controller.current?.archive()??Promise.resolve(undefined)}/>
   </>}
   {view.canCreate&&<button type="button" disabled={view.busy} onClick={()=>void controller.current?.create()}>Prepare amendment Draft from accepted terms</button>}
   <p className="field-help">The selected-record copy does not replace complete source export and recovery. Customer acceptance of amendments remains unfinished.</p>
  </section>}
 </>;
}
