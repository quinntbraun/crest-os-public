'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createSourceExportController,initialSourceExportView} from '../../client/source-export-controller';
import type {SourceExportView} from '../../client/source-export-controller';
import {SourceExportDownloadScreen} from './export-downloads';
const exportDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'});
type ExportAction='load'|'older'|'request'|'checkOriginal'|'checkResolution'|'retire'|'checkJob';

export function SourceExportControls({view,action,editReason,selectJob,statusRef,children}:{view:SourceExportView;action:(kind:ExportAction)=>void;editReason:(value:string)=>void;selectJob:(id:string)=>void;statusRef?:React.Ref<HTMLParagraphElement>;children?:React.ReactNode}){
 const historyHeading=useRef<HTMLHeadingElement>(null),selectionHeading=useRef<HTMLHeadingElement>(null),focusSelection=useRef(false);
 useLayoutEffect(()=>{if(focusSelection.current&&!view.busy){focusSelection.current=false;selectionHeading.current?.focus();}},[view]);
 return <section className="export-files export-source" aria-label="Business data exports" aria-busy={view.busy}>
  <header className="export-collection-header">
   <h2>Business export requests</h2>
   <p>Request a package of business records or download the files from a saved export.</p><dl className="export-attributes"><div><dt>Included records</dt><dd>Defined by the source manifest</dd></div><div><dt>Date scope</dt><dd>Captured record set; no date filter</dd></div><div><dt>Format</dt><dd>CSV and JSON parts</dd></div></dl>
  </header>
  <p className="export-status" ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  <div className="export-actions">
   {view.phase==='ready'&&<button className={view.jobId&&view.jobState!=='Failed'?'secondary':undefined} type="button" disabled={!view.canRequest} onClick={()=>action('request')}>Request business export</button>}
   <button className={view.phase==='ready'||view.canCheckJob||view.phase==='pending'?'secondary':undefined} type="button" disabled={view.busy} onClick={()=>action('load')}>Check sign-in and load exports</button>
  </div>
  <div className="export-request-layout" data-selected={!!view.jobId&&view.phase!=='pending'}>
  <div className="export-request-directory">
  {view.jobs.length>0&&<section className="export-history">
   <h3 ref={historyHeading} tabIndex={-1}>Export history</h3>
   <table role="table" className="export-request-table" aria-label="Export history"><caption>Requests on this page · times shown in UTC</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Requested</th><th role="columnheader" scope="col">Recorded status</th><th role="columnheader" scope="col">Review</th></tr></thead><tbody role="rowgroup">{view.jobs.map(job=><tr role="row" key={job.id} data-selected={view.jobId===job.id}>
    <td role="cell"><time dateTime={job.createdAt}>{exportDate.format(new Date(job.createdAt))}</time></td><td role="cell"><span className="export-state">{job.state}</span></td>
    <td role="cell"><button className="secondary" type="button" disabled={view.busy} aria-pressed={view.jobId===job.id} aria-label={'Review export requested '+exportDate.format(new Date(job.createdAt))+' · '+job.state} onClick={()=>{focusSelection.current=true;selectJob(job.id);}}>Review</button></td>
   </tr>)}</tbody></table>
  </section>}
  {view.phase==='ready'&&view.jobs.length===0&&<p className="export-empty">No recorded export requests on this page. Request a package to create one; files are not downloaded automatically.</p>}
  {view.hasOlder&&<button className="secondary export-inline-action" type="button" disabled={!view.canLoadOlder} onClick={()=>action('older')}>Older exports</button>}
  </div>
  <div className="export-request-detail">
  {view.phase==='pending'&&<section className="export-recovery" aria-label="Interrupted export request"><h3>Review the original request</h3>
   <p>Keep this tab’s saved request until its outcome is confirmed. Closing the tab or clearing browser data may remove the reference.</p>
   {view.reference&&<p>Request reference: <code>{view.reference}</code></p>}
   <button type="button" disabled={!view.canCheckOriginal} onClick={()=>action('checkOriginal')}>Check original request status</button>
   <button type="button" className="secondary" disabled={!view.canCheckResolution} onClick={()=>action('checkResolution')}>Check closing decision</button>
   <form onSubmit={event=>{event.preventDefault();if(view.canRetire)action('retire');}}>
    <label htmlFor="export-close-reason">Reason for closing this interrupted request</label>
    <textarea id="export-close-reason" name="export-close-reason" rows={3} maxLength={4000} value={view.reason} disabled={view.busy} onChange={event=>editReason(event.target.value)} aria-describedby="export-close-help" required/>
    <p id="export-close-help">{[...view.reason].length}/2000 characters. Review the original status first. Closing records your decision and prevents a late request from starting. It does not cancel an export already recorded. Your reason is kept in the audit history.</p>
    <button type="submit" className="secondary" disabled={!view.canRetire}>Close this interrupted request</button>
   </form>
  </section>}
  {view.jobId&&view.phase!=='pending'&&<div className="export-selection">
   <div className="export-selection-heading"><h3 ref={selectionHeading} tabIndex={-1}>Selected export</h3>{view.jobState&&<span className="export-state">{view.jobState}</span>}</div>
   {view.selection?<dl className="export-attributes"><div><dt>Requested · UTC</dt><dd><time dateTime={view.selection.createdAt}>{exportDate.format(new Date(view.selection.createdAt))}</time></dd></div><div><dt>Recorded update · UTC</dt><dd><time dateTime={view.selection.updatedAt}>{exportDate.format(new Date(view.selection.updatedAt))}</time></dd></div></dl>:<p>The original request is recorded. Check its export status before expecting files.</p>}
   <details><summary>Export reference</summary><code>{view.jobId}</code></details>
   {view.canCheckJob&&<button className={['Ready','Failed'].includes(view.jobState)?'secondary export-inline-action':'export-inline-action'} type="button" disabled={view.busy} onClick={()=>action('checkJob')}>Check export status</button>}
   {view.jobs.length>0&&<button className="secondary export-inline-action" type="button" onClick={()=>{historyHeading.current?.focus();historyHeading.current?.scrollIntoView({block:'start'});}}>Back to export history</button>}
  </div>}
  {children}
  </div></div>
 </section>;
}
// Product and API access remain opt-in at the trusted server boundary.
export function SourceExportScreen({onAccessDenied,focusOnLoad=false}:{onAccessDenied?:()=>void;focusOnLoad?:boolean}={}){
 const [view,setView]=useState(initialSourceExportView),current=useRef<ReturnType<typeof createSourceExportController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createSourceExportController({storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView,...onAccessDenied?{onAccessDenied}:{}});current.current=controller;void controller.load().then(()=>{if(focusOnLoad&&current.current===controller)status.current?.focus();});
  const review=()=>controller.reviewOnReturn(),restore=(event:PageTransitionEvent)=>{if(event.persisted)review();};window.addEventListener('pagehide',review);window.addEventListener('pageshow',restore);document.addEventListener('visibilitychange',review);
  return()=>{controller.dispose();current.current=null;window.removeEventListener('pagehide',review);window.removeEventListener('pageshow',restore);document.removeEventListener('visibilitychange',review);};
 },[onAccessDenied,focusOnLoad]);
 async function action(kind:ExportAction){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 return <div className="export-collection">
  <SourceExportControls view={view} statusRef={status} action={kind=>{void action(kind);}} editReason={value=>current.current?.editReason(value)} selectJob={value=>current.current?.selectJob(value)}>
  {!view.busy&&view.jobId&&view.jobState==='Ready'&&['ready','confirmed'].includes(view.phase)&&<SourceExportDownloadScreen key={view.jobId} jobId={view.jobId} {...onAccessDenied?{onAccessDenied}:{}}/>}
  </SourceExportControls>
 </div>;
}
