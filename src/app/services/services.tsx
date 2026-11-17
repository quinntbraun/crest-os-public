'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createServiceEditorController,initialServiceEditorView} from '../../client/service-editor-controller';
import {createPendingServiceStore} from '../../client/pending-service-edit';
import {draftFromService,emptyServiceDraft,serviceDraftChanged} from '../../client/service-draft';
import {quoteMoney} from '../../commercial/quote-pricing';
import type {StoredServiceContent} from '../../commercial/service-storage-contract';
import {ServiceRecordDownload} from './saved-service-download';

const revisionDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const actionLabels={create:'Created',edit:'Updated',archive:'Made inactive',reopen:'Reactivated'};
function guidance(content:StoredServiceContent){
 const low=content.range_low_cents,high=content.range_high_cents;
 if(low===null)return 'No price guidance';
 if(high===null)return 'Starts at '+quoteMoney(low);
 return high===low?quoteMoney(low):quoteMoney(low)+'–'+quoteMoney(high);
}
function serviceDuration(value:string|null){
 if(value===null)return 'No estimate';
 const seconds=BigInt(value),minutes=seconds/60n;
 return [minutes?minutes.toLocaleString('en-US')+' min':'',seconds%60n?seconds%60n+' sec':''].filter(Boolean).join(' ');
}

function ServiceQuotePreview({name,inclusions,exclusions,saved,heading}:{
 name:string;inclusions:string;exclusions:string;saved:boolean;heading?:React.Ref<HTMLHeadingElement>;
}){
 return <section className="service-quote-preview home-panel" data-saved={saved} aria-label="Quote scope preview">
  {!saved&&<h3 ref={heading} tabIndex={-1}>Quote scope preview</h3>}
  <p className="field-help">The name, included work, and exclusions carry over. Set the amount on the quote.</p>
  <div className="service-quote-line">
   <h4 className="service-scope">{name||'Service name'}</h4>
   <p><strong>Included work</strong></p>
   <p className="service-scope">{inclusions||'Describe what the customer will receive.'}</p>
   {exclusions&&<><p><strong>Exclusions</strong></p><p className="service-scope">{exclusions}</p></>}
  </div>
 </section>;
}

export function ServiceScreen(){
 const [view,setView]=useState(initialServiceEditorView),current=useRef<ReturnType<typeof createServiceEditorController>|null>(null);
 const [editing,setEditing]=useState(false),[showRecord,setShowRecord]=useState(false),[preview,setPreview]=useState(false);
 const formHeading=useRef<HTMLHeadingElement>(null),profileHeading=useRef<HTMLHeadingElement>(null),previewHeading=useRef<HTMLHeadingElement>(null);
 const focus=useRef<string|null|undefined>(undefined),directoryTrigger=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null);
 const selected=view.selected,draft=view.draft;
 const original=selected?draftFromService(selected.service,selected.content):emptyServiceDraft;
 const dirty=serviceDraftChanged(draft,original);
 useLayoutEffect(()=>{
  if(focus.current===undefined||view.busy)return;
  if(view.phase==='ready'&&view.draft&&(view.selected?.service.id??null)===focus.current){
   (editing?formHeading:profileHeading).current?.focus();
  }
  focus.current=undefined;
 },[editing,view]);
 useEffect(()=>{
  const c=createServiceEditorController({
   store:createPendingServiceStore({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)}),
   change:setView
  });
  current.current=c;void c.load();
  const leave=()=>{setEditing(false);setPreview(false);setShowRecord(false);c.suspend();};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();},restore=(e:PageTransitionEvent)=>{if(e.persisted)leave();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return ()=>{
   current.current=null;c.dispose();document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);
  };
 },[]);
 useEffect(()=>{
  if(!dirty&&view.phase!=='pending'&&!view.busy)return;
  const leave=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leave);
  return ()=>window.removeEventListener('beforeunload',leave);
 },[dirty,view.phase,view.busy]);
 function discard(){
  const v=current.current?.view();
  return !v||!serviceDraftChanged(v.draft,v.selected?draftFromService(v.selected.service,v.selected.content):emptyServiceDraft)||
   window.confirm('Discard your unsaved service changes? Choose Cancel to keep editing.');
 }
 function create(trigger:HTMLButtonElement){
  if(!discard())return;
  directoryTrigger.current=trigger;setPreview(false);setEditing(true);setShowRecord(true);
  focus.current=null;current.current?.create();
 }
 async function open(id:string,trigger:HTMLButtonElement){
  if(!discard())return;
  directoryTrigger.current=trigger;setPreview(false);setEditing(false);setShowRecord(true);
  focus.current=id;await current.current?.open(id);
 }
 function closeEditor(){
  if(!selected||!discard())return;
  current.current?.edit(draftFromService(selected.service,selected.content));setEditing(false);setPreview(false);
  requestAnimationFrame(()=>profileHeading.current?.focus());
 }
 function reload(){
  if(!discard())return;
  setEditing(false);setPreview(false);setShowRecord(false);
  void current.current?.load();
 }
 function query(search:string,inactive:boolean,more=false){
  if(!discard())return;
  setEditing(false);setPreview(false);setShowRecord(false);
  void current.current?.query(search,inactive,more);
 }
 function choosePreview(next:boolean){
  setPreview(next);
  requestAnimationFrame(()=>(next?previewHeading:formHeading).current?.focus());
 }
 function backToCatalog(){
  setShowRecord(false);
  requestAnimationFrame(()=>{
   const trigger=directoryTrigger.current;
   (trigger?.isConnected?trigger:searchInput.current)?.focus();
  });
 }
 function returnToRecord(){
  setShowRecord(true);
  requestAnimationFrame(()=>(editing?preview?previewHeading:formHeading:profileHeading).current?.focus());
 }
 const canEdit=editing&&draft!==null;
 return <>
  <p role="status" aria-label="Service status" className="customer-directory-status">{view.message}</p>
  {view.phase==='unavailable'&&<p><a href="/sign-in">Sign in to view services</a></p>}
  {view.phase!=='ready'&&view.phase!=='loading'&&<div className="actions">
   {view.phase==='pending'?<>
    <button type="button" disabled={view.busy} onClick={()=>void current.current?.check()}>Check original save</button>
    {view.canRetry&&<button type="button" disabled={view.busy} onClick={()=>void current.current?.retry()}>Retry unchanged original</button>}
    <a href="/save-review">Review interrupted saves</a>
    {view.reference&&<p className="field-help">Original operation <span className="record-reference">{view.reference}</span></p>}
   </>:<button type="button" disabled={view.busy} onClick={reload}>Load current services</button>}
  </div>}
  {view.phase==='ready'&&<div className="service-layout" data-mobile-record={showRecord&&draft!==null}>
   <section className="service-directory-panel home-panel" aria-labelledby="service-directory-heading">
    <h2 id="service-directory-heading">Saved services</h2>
    <div className="service-toolbar">
     <button type="button" className="customer-add" disabled={view.busy||view.writesPaused} onClick={e=>create(e.currentTarget)}>Add service</button>
     <button type="button" className="secondary" disabled={view.busy} onClick={reload}>Reload saved services</button>
    </div>
    {draft&&!showRecord&&<button type="button" className="secondary service-mobile-control" onClick={returnToRecord}>Return to open service</button>}
    <form className="service-search" onSubmit={e=>{
     e.preventDefault();const fields=new FormData(e.currentTarget);query(String(fields.get('search')??''),fields.has('inactive'));
    }}>
     <label>Find a service<input ref={searchInput} name="search" type="search" maxLength={200} defaultValue={view.search} key={view.search} disabled={view.busy}/></label>
     <button className="secondary" disabled={view.busy}>Search</button>
     <label className="checkbox"><input name="inactive" type="checkbox" defaultChecked={view.includeInactive} key={String(view.includeInactive)} disabled={view.busy}/>Include inactive services</label>
    </form>
    <ul className="customer-list service-directory" aria-label="Saved services">
     {view.rows.map(row=><li key={row.service.id}><button type="button" className="secondary"
      aria-current={selected?.service.id===row.service.id?'true':undefined} disabled={view.busy}
      onClick={e=>void open(row.service.id,e.currentTarget)}>
      <strong>{row.content.name}</strong>
      <span className="service-row-price">{guidance(row.content)}{row.content.range_low_cents!==null&&<small>Price guidance</small>}</span>
      <span>{row.service.active?'Available on new quotes':'Inactive'} · Revision {row.service.version}</span>
      <time dateTime={row.service.updated_at}>{revisionDate.format(new Date(row.service.updated_at))}</time>
     </button></li>)}
    </ul>
    {!view.busy&&!view.rows.length&&<p className="customer-directory-empty">No services match this search. Add a service or change the search.</p>}
    {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>query(view.search,view.includeInactive,true)}>Next service page</button>}
   </section>
   {draft&&<div className="service-record">
    <button type="button" className="secondary service-mobile-control" onClick={backToCatalog}>Back to services</button>
    {selected&&<header className="customer-record-header service-profile">
     <div className="service-profile-title">
      <div>
       <p className="service-availability">{selected.service.active?'Available on new quotes':'Inactive'}</p>
       <h2 tabIndex={-1} ref={profileHeading}>{selected.content.name}</h2>
       <p className="service-profile-price">{guidance(selected.content)}{selected.content.range_low_cents!==null&&<span>Price guidance</span>}</p>
      </div>
      {!canEdit&&!view.writesPaused&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>{
       setEditing(true);requestAnimationFrame(()=>formHeading.current?.focus());
      }}>Edit service</button>}
     </div>
     <p className="service-revision"><time dateTime={selected.service.updated_at}>{revisionDate.format(new Date(selected.service.updated_at))}</time> UTC · Revision {selected.service.version}</p>
    </header>}
    {canEdit?<section className="service-definition-panel" aria-label={selected?'Edit saved service':'New service definition'}>
     <nav aria-label="Service editor views" className="service-editor-views">
      <button type="button" className="secondary" aria-pressed={!preview} onClick={()=>choosePreview(false)}>Service details</button>
      <button type="button" className="secondary" aria-pressed={preview} onClick={()=>choosePreview(true)}>Quote preview</button>
     </nav>
     <div className="service-edit-grid" data-preview={preview}>
      <form className="customer-record-editor service-edit-form" aria-label="Service editor" onSubmit={e=>{e.preventDefault();void current.current?.save();}}>
       <h2 tabIndex={-1} ref={formHeading}>{selected?'Edit service':'New service'}</h2>
       <p className="field-help">Unsaved changes clear when you leave or hide the page.</p>
       <fieldset className="service-fields" disabled={view.busy||view.writesPaused}>
        <legend className="visually-hidden">Service definition</legend>
        <label htmlFor="service-code">Service code</label>
        <input id="service-code" aria-describedby="service-code-help" value={draft.code} maxLength={80}
         autoCapitalize="none" autoCorrect="off" spellCheck={false} readOnly={!!selected}
         onChange={e=>current.current?.edit({...draft,code:e.target.value})} required/>
        <p id="service-code-help" className="field-help">Permanent code using lowercase letters, numbers, hyphens or underscores.</p>
        <label>Service name<input value={draft.name} maxLength={200} onChange={e=>current.current?.edit({...draft,name:e.target.value})} required/></label>
        <label htmlFor="service-inclusions">What is included</label>
        <textarea id="service-inclusions" value={draft.inclusions} maxLength={8000} rows={4} onChange={e=>current.current?.edit({...draft,inclusions:e.target.value})} required/>
        <label htmlFor="service-exclusions">What is excluded</label>
        <textarea id="service-exclusions" value={draft.exclusions} maxLength={8000} rows={3} onChange={e=>current.current?.edit({...draft,exclusions:e.target.value})}/>
        <details><summary>Internal guidance and timing (optional)</summary>
         <label htmlFor="service-internal-notes">Internal notes</label>
         <textarea id="service-internal-notes" value={draft.internalGuidance} maxLength={8000} rows={3} onChange={e=>current.current?.edit({...draft,internalGuidance:e.target.value})}/>
         <div className="service-pair">
          <label>Starting guidance (USD)<input inputMode="decimal" value={draft.low} onChange={e=>current.current?.edit({...draft,low:e.target.value})}/></label>
          <label>Upper guidance (USD)<input inputMode="decimal" value={draft.high} onChange={e=>current.current?.edit({...draft,high:e.target.value})}/></label>
         </div>
         <div className="service-pair">
          <label>Estimated minutes<input inputMode="numeric" value={draft.minutes} onChange={e=>current.current?.edit({...draft,minutes:e.target.value})}/></label>
          <label>Additional seconds (0–59)<input inputMode="numeric" value={draft.seconds} onChange={e=>current.current?.edit({...draft,seconds:e.target.value})}/></label>
         </div>
        </details>
        <label className="checkbox"><input type="checkbox" checked={draft.active} onChange={e=>current.current?.edit({...draft,active:e.target.checked})}/>Active — available for future selection</label>
        {view.draftIssue&&<p role="alert">{view.draftIssue}</p>}
        <div className="service-edit-actions">
         <button type="submit" disabled={!view.canSave}>Save service</button>
         {selected&&<button type="button" className="secondary" disabled={view.busy} onClick={closeEditor}>Close editor</button>}
        </div>
       </fieldset>
      </form>
      <ServiceQuotePreview name={draft.name} inclusions={draft.inclusions} exclusions={draft.exclusions} saved={false} heading={previewHeading}/>
     </div>
    </section>:selected&&<div className="service-saved-details">
     <details className="home-panel"><summary>Pricing and timing</summary><dl className="service-saved-facts">
      <div><dt>Price guidance</dt><dd>{guidance(selected.content)}</dd></div>
      <div><dt>Estimated duration</dt><dd>{serviceDuration(selected.content.estimated_seconds)}</dd></div>
      <div><dt>Service code</dt><dd>{selected.service.code}</dd></div>
      {selected.content.internal_guidance&&<div><dt>Internal notes</dt><dd>{selected.content.internal_guidance}</dd></div>}
     </dl></details>
     <details className="home-panel service-saved-scope"><summary>Saved quote scope</summary>
      <ServiceQuotePreview name={selected.content.name} inclusions={selected.content.inclusions} exclusions={selected.content.exclusions} saved/>
     </details>
     {view.history&&<section className="home-panel service-history" aria-labelledby="service-history-heading">
      <h3 id="service-history-heading">Saved history</h3>
      <ol className="customer-history">{view.history.history.map(event=><li key={event.eventId}>
       <div className="service-history-row"><strong>Revision {event.revision} · {actionLabels[event.action]}</strong>
        <time dateTime={event.at}>{revisionDate.format(new Date(event.at))} UTC</time></div>
       <details><summary>Recorded scope</summary>
        <p className="service-scope"><strong>{event.content.name}</strong></p>
        <p className="service-scope">{event.content.inclusions}</p>
        {event.content.exclusions&&<p className="service-scope">Exclusions: {event.content.exclusions}</p>}
       </details>
      </li>)}</ol>
      {view.history.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.moreHistory()}>Next history page</button>}
      <ServiceRecordDownload key={selected.service.id+':'+selected.service.version} row={selected} disabled={view.busy}/>
     </section>}
    </div>}
   </div>}
  </div>}
 </>;
}
