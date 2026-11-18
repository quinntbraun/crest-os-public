'use client';
import {useEffect,useRef,useState} from 'react';
import {createQuoteAmendmentWorkspace,initialQuoteAmendmentWorkspaceView} from '../../../client/quote-amendment-workspace';
import {QuoteDocument} from '../quote-document';
import {QuoteAmendmentDocument} from '../quote-amendment-document';
import {quoteMoney} from '../../../commercial/quote-pricing';
import {AmendmentDraftEditor} from './draft-editor';
import {AmendmentAcceptance} from './acceptance';
import {AmendmentReviewAndSharing} from './review-and-sharing';
import {SavedAmendmentDownload} from './saved-record-download';
import {AmendmentAllocationReview} from './allocation-review';
import {AmendmentCancellationCreator} from './cancellation-creator';
import {AmendmentCancellationEditor} from './cancellation-editor';
import {AmendmentHistoryEvents} from './history';

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
  {!selected&&<p className="intro">Choose an accepted quote to review or prepare changes.</p>}
  <p role="status" aria-live="polite" className={view.status==='Saved accepted quotes loaded.'?'visually-hidden':'notice amendment-status'}>{view.status}</p>
  <div className="amendment-actions"><button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard()){setSearch('');void controller.current?.load();}}}>Load accepted work</button><a href="/quotes" onClick={event=>{if(!discard())event.preventDefault();}}>All quotes</a><a href="/save-review" onClick={event=>{if(!discard())event.preventDefault();}}>Save review</a></div>
  {view.phase==='pending'&&<button type="button" disabled={!view.canLookup} onClick={()=>void controller.current?.lookup()}>Check original quote result</button>}
  {view.phase==='ready'&&!selected&&<>
   <form className="service-search amendment-search" aria-label="Find accepted work" onSubmit={event=>{event.preventDefault();void controller.current?.load(search);}}>
    <label htmlFor="accepted-quote-search">Find accepted quotes</label>
    <input id="accepted-quote-search" type="search" value={search} maxLength={200} onChange={event=>setSearch(event.target.value)} disabled={view.busy}/>
    <button type="submit" aria-label="Search accepted quotes" disabled={view.busy}>Search</button>
   </form>
   <ul className="customer-list crest-record-list" aria-label="Accepted quotes">{view.rows.map(row=>{
    const accepted=row.parent.revision.customer_safe_snapshot;
    const version='Accepted agreement '+row.parent.versionNo;
    const state=row.revision.kind==='amendment'?'Amendment '+row.revision.state:'Accepted quote';
    const amount=quoteMoney(row.parent.revision.total_cents);
    return <li key={row.family.id}>
     <button type="button" className="secondary crest-record-row amendment-record-row" disabled={view.busy}
      aria-label={[accepted.recipient.displayName,accepted.title,version,state,amount].join(', ')}
      onClick={()=>void controller.current?.open(row.family.id)}>
      <span className="crest-record-identity"><strong>{accepted.recipient.displayName}</strong>{' '}<span>{accepted.title}</span></span>{' '}
      <span className="crest-record-meta">
       <span>{version}</span>{' '}
       <span className="crest-record-state">{state}</span>
      </span>{' '}
      <strong className="amendment-record-amount">{amount}</strong>
     </button>
    </li>;
   })}</ul>
   {view.rows.length===0&&<p>No accepted work to display.</p>}
   {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void controller.current?.load(view.search,true)}>Next accepted quote page</button>}
  </>}
  {selected&&<section aria-label="Selected accepted work">
   <header className="amendment-record-header">
    <p>{selected.parent.revision.customer_safe_snapshot.recipient.displayName}</p>
    <h2 tabIndex={-1} ref={heading}>{selected.parent.revision.customer_safe_snapshot.title}</h2>
    <dl><div><dt>Accepted agreement</dt><dd>Version {selected.parent.versionNo}</dd></div>
     <div><dt>Accepted total</dt><dd>{quoteMoney(selected.parent.revision.total_cents)}</dd></div></dl>
   </header>
   {view.writesPaused&&<p className="notice">Changes are paused. Saved terms and history remain available.</p>}
   <div className={amendment?'amendment-workspace-grid':undefined}>
    <div className="amendment-workspace-main">
     {amendment&&<>
      <div className="amendment-review-heading">
       <h3>Current amendment · {amendment.revision.state}</h3>
       <a href="#amendment-activity">Activity and records</a>
      </div>
      {!amendment.parentIsCurrent&&!(amendment.schemaVersion===2&&amendment.acceptance.request.agreementId===selected.parent.agreementId)&&<p className="notice">This amendment refers to an earlier accepted agreement. Review the current accepted terms before preparing further changes.</p>}
      {view.dirty&&!view.acceptance&&<p className="notice">{view.preparingReopening?'This comparison shows the accepted cancellation. Save the new Draft to compare your proposed work.':'This comparison shows the saved amendment. Save your edits to update it.'}</p>}
      <details className="amendment-saved-comparison" open><summary>{amendment.schemaVersion===2?'Review accepted changes':'Review proposed changes'}</summary><QuoteAmendmentDocument comparison={amendment.comparison.customer} accepted={amendment.schemaVersion===2}/></details>
     </>}
     <details><summary>Accepted scope and terms</summary><QuoteDocument quote={selected.parent.revision.customer_safe_snapshot} stage="accepted"/></details>
     <AmendmentAllocationReview key={JSON.stringify(['allocations',selected.family.business_id,selected.family.id,selected.family.version,selected.parent.agreementId,selected.parent.versionNo,selected.parent.customerId,selected.parent.revision.total_cents])} target={selected}/>
     {amendment&&<>
      {!view.preparingReopening&&amendment.revision.customer_safe_snapshot.schemaVersion===3?<AmendmentCancellationEditor view={view} controller={controller}/>:<AmendmentDraftEditor view={view} controller={controller}/>}
      <AmendmentReviewAndSharing key={amendment.revision.id+':'+amendment.revision.version} view={view} controller={controller}/>
      <AmendmentAcceptance key={'accept:'+amendment.revision.id+':'+amendment.revision.version} view={view} controller={controller}/>
     </>}
     <div className="amendment-actions">
      {view.canCreate&&<button type="button" disabled={view.busy} onClick={()=>void controller.current?.create()}>{selected.parent.revision.customer_safe_snapshot.schemaVersion===3?'Propose new work after cancellation':'Prepare amendment Draft from accepted terms'}</button>}
      <AmendmentCancellationCreator view={view} controller={controller}/>
     </div>
    </div>
   {amendment&&<aside className="amendment-activity" id="amendment-activity" aria-label="Amendment activity and records" tabIndex={-1}>
    <h3>Activity and records</h3>
    <details>
     <summary>Saved amendment history</summary>
     <p className="field-help">{amendment.history.length?'Showing retained versions '+amendment.history[0]!.revision+'–'+amendment.history.at(-1)!.revision+' of '+amendment.revision.version+'.':'No later history events.'} These are saved events.</p>
     <p className="field-help">Times show when each version was recorded, in that version’s saved time zone. Sharing is an owner record, not delivery confirmation.</p>
     <AmendmentHistoryEvents events={amendment.history}/>
     <div className="amendment-actions">
      <button type="button" className="secondary" disabled={!view.canReadHistory} onClick={()=>void controller.current?.historyPage(true)}>First amendment history page</button>
      {amendment.hasMore&&<button type="button" className="secondary" disabled={!view.canReadHistory} onClick={()=>void controller.current?.historyPage()}>Next amendment history page</button>}
     </div>
     {view.dirty&&<p className="field-help">{view.acceptance?'Finish or discard the acceptance review before loading another history page or downloading the saved record.':view.preparingReopening?'Save or discard the new Draft before loading another history page or downloading the saved record.':'Save your edits before loading another history page or downloading the saved record.'}</p>}
    </details>
    <SavedAmendmentDownload key={'record:'+amendment.revision.id+':'+amendment.revision.version} disabled={!view.canReadHistory} archive={()=>controller.current?.archive()??Promise.resolve(undefined)}/>
    <p className="field-help">The private record covers this amendment. Use the complete source export for recovery.</p>
   </aside>}
   </div>
  </section>}
 </>;
}
