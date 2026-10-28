'use client';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createLeadSourceEditorController,initialLeadSourceEditorView,emptyLeadSourceDraft} from '../../client/lead-source-editor-controller';
import {createPendingLeadSourceStore} from '../../client/pending-lead-source-edit';
import type {LeadSource,LeadSourceDraft} from '../../customer/lead-contract';
import {draftFromLeadSource} from '../../customer/lead-contract';
import {ReferencePicker} from '../leads/reference-picker';
function SourceDetails({source}:{source:LeadSource}){return <dl className="customer-values"><dt>Label</dt><dd>{source.label}</dd><dt>Kind</dt><dd>{source.kind}</dd><dt>Status</dt><dd>{source.active?'Active':'Inactive'}</dd><dt>Referral customer</dt><dd>{source.referral_customer_id?'Existing customer linked':'Not linked'}</dd></dl>;}
export function LeadSourceScreen(){
 const [view,setView]=useState(initialLeadSourceEditorView),current=useRef<ReturnType<typeof createLeadSourceEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createLeadSourceEditorController({store:createPendingLeadSourceStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;void controller.load();
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[]);
 const dirty=view.draft!==null&&JSON.stringify(view.draft)!==JSON.stringify(view.selected?draftFromLeadSource(view.selected):emptyLeadSourceDraft);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,view.phase,view.busy]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function edit<K extends keyof LeadSourceDraft>(key:K,value:LeadSourceDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);void current.current?.query(String(data.get('search')??''),data.get('inactive')==='on');}
 function submit(event:FormEvent){event.preventDefault();void action('save');}
 const key=(view.selected?.id??'new')+':'+(view.selected?.version??'0'),disabled=view.busy||view.writesPaused;
 return <section aria-label="Lead source directory" aria-busy={view.busy}>
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead source editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Source changes are paused. You can review current records and retained history.</p>}
   <form onSubmit={search} aria-label="Search lead sources"><label htmlFor="source-search">Lead source search</label><input id="source-search" name="search" type="search" maxLength={400} autoComplete="off" defaultValue={view.search} disabled={view.busy}/><label className="trust"><input name="inactive" type="checkbox" defaultChecked={view.includeInactive} disabled={view.busy}/>Include inactive sources</label><button type="submit" className="secondary" disabled={view.busy}>Search lead sources</button></form>
   <p className="field-help">Searching or opening another source discards an unsaved draft. Deactivation retains the source and earlier lead attribution.</p>
   <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.open(row.id)}>{row.label}{row.active?'':' — inactive'}</button><p>{row.kind}</p></li>)}</ul>
   {view.rows.length===0&&<p>No sources found on this page.</p>}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.query(view.search,view.includeInactive,true)}>Next lead source page</button>}
   <button type="button" disabled={disabled} onClick={()=>current.current?.create()}>Add lead source</button>
   {view.draft&&<>
    <h2>{view.selected?'Edit lead source':'New lead source'}</h2><p className="field-help">The label and kind are required. Choose a referring customer only when known. Leaving or hiding this page clears private drafts; closing this tab can also lose its save reference.</p>
    {view.businessId&&<ReferencePicker key={key+':customer'} businessId={view.businessId} kind="customer" value={view.draft.referralCustomerId} disabled={disabled} change={value=>edit('referralCustomerId',value)}/>}
    <form onSubmit={submit} aria-label="Lead source editor"><fieldset disabled={disabled}><legend>Source details</legend>
     <label htmlFor="source-label">Source label</label><input id="source-label" name="source-label" autoComplete="off" maxLength={400} value={view.draft.label} onChange={event=>edit('label',event.target.value)} required/><p className="field-help">{[...view.draft.label].length}/200 characters. Labels must be distinct within the business.</p>
     <label htmlFor="source-kind">Source kind</label><input id="source-kind" name="source-kind" autoComplete="off" maxLength={400} value={view.draft.kind} onChange={event=>edit('kind',event.target.value)} required/><p className="field-help">{[...view.draft.kind].length}/200 characters. Use your own classification.</p>
     <label className="trust"><input type="checkbox" checked={view.draft.active} onChange={event=>edit('active',event.target.checked)}/>Source active</label>
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>Save lead source</button></form>
   </>}
   {view.history&&<section aria-label="Lead source history"><h2>Retained source history</h2><p>Current version: {view.history.leadSource.version}</p>{view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><SourceDetails source={event.before}/></>}<h3>After</h3><SourceDetails source={event.after}/></details>)}{view.history.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next source history page</button>}</section>}
  </>}
  {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check lead source save status</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('retry')}>Retry original lead source change</button>}</>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current lead sources</button>}
<nav aria-label="Lead source navigation"><a href="/save-review">Review interrupted save</a><a href="/leads">Leads</a><a href="/customers">Customers</a><a href="/sign-in">Device sign-in and sign-out</a><a href="/">Crest OS home</a></nav>
  <p className="field-help">Setup and synthetic testing are in progress. This screen does not approve real customer records or production use.</p>
 </section>;
}
