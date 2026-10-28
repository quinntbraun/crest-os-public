'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createServiceEditorController,initialServiceEditorView} from '../../client/service-editor-controller';
import {createPendingServiceStore} from '../../client/pending-service-edit';
import {draftFromService,emptyServiceDraft,serviceDraftChanged} from '../../client/service-draft';
import {ServiceRecordDownload} from './saved-service-download';

export function ServiceScreen(){
 const [view,setView]=useState(initialServiceEditorView),current=useRef<ReturnType<typeof createServiceEditorController>|null>(null),heading=useRef<HTMLHeadingElement>(null),focus=useRef<string|null|undefined>(undefined);
 const original=view.selected?draftFromService(view.selected.service,view.selected.content):emptyServiceDraft,dirty=serviceDraftChanged(view.draft,original);
 useLayoutEffect(()=>{if(focus.current===undefined||view.busy)return;if(view.phase==='ready'&&view.draft&&(view.selected?.service.id??null)===focus.current)heading.current?.focus();focus.current=undefined;},[view]);
 useEffect(()=>{
  const c=createServiceEditorController({store:createPendingServiceStore({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)}),change:setView});current.current=c;void c.load();
  const hidden=()=>{if(document.visibilityState==='hidden')c.suspend();},leave=()=>c.suspend(),restore=(e:PageTransitionEvent)=>{if(e.persisted)c.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return ()=>{current.current=null;c.dispose();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
 },[]);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leave=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leave);return ()=>window.removeEventListener('beforeunload',leave);},[dirty,view.phase,view.busy]);
 function discard(){const v=current.current?.view();return !v||!serviceDraftChanged(v.draft,v.selected?draftFromService(v.selected.service,v.selected.content):emptyServiceDraft)||window.confirm('Discard your unsaved service changes? Choose Cancel to keep editing.');}
 function create(){if(discard()){focus.current=null;current.current?.create();}}
 async function open(id:string){if(discard()){focus.current=id;await current.current?.open(id);}}
 const draft=view.draft;
 return <>
  <p className="intro">Define the work you offer. Saved versions retain earlier scope and guidance. Guidance never sets a quote price.</p>
  <p role="status" aria-label="Service status" className="notice">{view.message}</p>
  {view.phase==='unavailable'&&<p><a href="/sign-in">Sign in to view services</a></p>}
  {view.phase!=='ready'&&view.phase!=='loading'&&<div className="actions">{view.phase==='pending'?<><button type="button" disabled={view.busy} onClick={()=>void current.current?.check()}>Check original save</button>{view.canRetry&&<button type="button" disabled={view.busy} onClick={()=>void current.current?.retry()}>Retry unchanged original</button>}<a href="/save-review">Review interrupted saves</a>{view.reference&&<p className="field-help">Original operation: <span className="record-reference">{view.reference}</span></p>}</>:<button type="button" disabled={view.busy} onClick={()=>void current.current?.load()}>Load current services</button>}</div>}
  {view.phase==='ready'&&<div className="service-layout">
   <section className="service-directory-panel" aria-labelledby="service-directory-heading">
   <h2 id="service-directory-heading">Saved services</h2>
   <div className="service-toolbar"><button type="button" disabled={view.busy||view.writesPaused} onClick={create}>Add service</button><button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard())void current.current?.load();}}>Reload saved services</button></div>
   <form className="service-search" onSubmit={e=>{e.preventDefault();if(discard()){const fields=new FormData(e.currentTarget);void current.current?.query(String(fields.get('search')??''),fields.has('inactive'));}}}>
    <label>Find a service<input name="search" type="search" maxLength={200} defaultValue={view.search} key={view.search} disabled={view.busy}/></label>
    <button className="secondary" disabled={view.busy}>Search</button><label className="checkbox"><input name="inactive" type="checkbox" defaultChecked={view.includeInactive} key={String(view.includeInactive)} disabled={view.busy}/>Include inactive services</label>
   </form>
   <ul className="customer-list service-directory" aria-label="Saved services">{view.rows.map(row=><li key={row.service.id}><button type="button" className="secondary" aria-current={view.selected?.service.id===row.service.id?'true':undefined} disabled={view.busy} onClick={()=>void open(row.service.id)}><strong>{row.content.name}</strong><span>{row.service.code} · {row.service.active?'Active':'Inactive'} · revision {row.service.version}</span></button></li>)}</ul>
   {!view.rows.length&&<p>No services match this search. Add a service or change the search.</p>}
   {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard())void current.current?.query(view.search,view.includeInactive,true);}}>Next service page</button>}
   </section>
   {draft?<section className="service-definition-panel" aria-labelledby="service-editor-heading">
    <h2 id="service-editor-heading" tabIndex={-1} ref={heading}>{view.selected?'Edit service':'New service'}</h2>
    <p className="field-help">{dirty?'Unsaved changes stay only on this page.':view.selected?'Showing the saved service.':'New service; nothing has been saved.'} Leaving or hiding this page clears private details.</p>
    <form onSubmit={e=>{e.preventDefault();void current.current?.save();}}>
     <fieldset className="service-fields" disabled={view.busy||view.writesPaused}>
      <label htmlFor="service-code">Service code</label><input id="service-code" aria-describedby="service-code-help" value={draft.code} maxLength={80} autoCapitalize="none" autoCorrect="off" spellCheck={false} readOnly={!!view.selected} onChange={e=>current.current?.edit({...draft,code:e.target.value})} required/><p id="service-code-help" className="field-help">A permanent unique code: lowercase letters, numbers, hyphens or underscores. It cannot change after saving.</p>
      <label>Service name<input value={draft.name} maxLength={200} onChange={e=>current.current?.edit({...draft,name:e.target.value})} required/></label>
      <label htmlFor="service-inclusions">What is included</label><textarea id="service-inclusions" value={draft.inclusions} maxLength={8000} rows={4} onChange={e=>current.current?.edit({...draft,inclusions:e.target.value})} required/>
      <label htmlFor="service-exclusions">What is excluded</label><textarea id="service-exclusions" value={draft.exclusions} maxLength={8000} rows={3} onChange={e=>current.current?.edit({...draft,exclusions:e.target.value})}/>
      <details><summary>Internal guidance and timing (optional)</summary>
       <label htmlFor="service-internal-notes">Internal notes</label><textarea id="service-internal-notes" value={draft.internalGuidance} maxLength={8000} rows={3} onChange={e=>current.current?.edit({...draft,internalGuidance:e.target.value})}/>
       <p className="field-help">These values are guidance only. Leave unknown values empty; no price or duration is assumed.</p>
       <div className="service-pair"><label>Starting guidance (USD)<input inputMode="decimal" value={draft.low} onChange={e=>current.current?.edit({...draft,low:e.target.value})}/></label><label>Upper guidance (USD)<input inputMode="decimal" value={draft.high} onChange={e=>current.current?.edit({...draft,high:e.target.value})}/></label></div>
       <div className="service-pair"><label>Estimated minutes<input inputMode="numeric" value={draft.minutes} onChange={e=>current.current?.edit({...draft,minutes:e.target.value})}/></label><label>Additional seconds (0–59)<input inputMode="numeric" value={draft.seconds} onChange={e=>current.current?.edit({...draft,seconds:e.target.value})}/></label></div>
      </details>
      <label className="checkbox"><input type="checkbox" checked={draft.active} onChange={e=>current.current?.edit({...draft,active:e.target.checked})}/>Active — available for future selection</label>
      {view.draftIssue&&<p role="alert">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>Save service</button>
     </fieldset>
    </form>
    {view.selected&&<ServiceRecordDownload key={view.selected.service.id+':'+view.selected.service.version} row={view.selected} disabled={view.busy}/>}
    {view.history&&<section aria-labelledby="service-history-heading"><h3 id="service-history-heading">Saved history</h3><ol className="customer-history">{view.history.history.map(event=><li key={event.eventId}><strong>Revision {event.revision} · {event.action}</strong><p>{event.content.name} · content version {event.content.sequence}</p><p>{event.at}</p><details><summary>Recorded scope</summary><p className="service-scope">{event.content.inclusions}</p>{event.content.exclusions&&<p className="service-scope">Exclusions: {event.content.exclusions}</p>}</details></li>)}</ol>{view.history.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.moreHistory()}>Next history page</button>}</section>}
   </section>:<section className="service-choice"><h2>Choose a service</h2><p>Open a saved service to review its scope and history, or choose Add service to define a new one.</p></section>}
  </div>}
 </>;
}
