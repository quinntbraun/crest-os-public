'use client';
import {useEffect,useRef,useState} from 'react';
import {createSourceExportController,initialSourceExportView} from '../../client/source-export-controller';
import type {SourceExportView} from '../../client/source-export-controller';
import {SourceExportDownloadScreen} from './export-downloads';
type ExportAction='load'|'older'|'request'|'checkOriginal'|'checkResolution'|'retire'|'checkJob';

export function SourceExportControls({view,action,editReason,selectJob,statusRef}:{view:SourceExportView;action:(kind:ExportAction)=>void;editReason:(value:string)=>void;selectJob:(id:string)=>void;statusRef?:React.Ref<HTMLParagraphElement>}){
 return <section className="export-files" aria-label="Business data exports" aria-busy={view.busy}>
  <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  <p>Exports contain private business records. Keep downloaded copies somewhere only you can access. Continue keeping separate database backups.</p>
  <button type="button" disabled={view.busy} onClick={()=>action('load')}>Check sign-in and load exports</button>
  {view.phase==='ready'&&<button type="button" disabled={!view.canRequest} onClick={()=>action('request')}>Request business export</button>}
  {view.jobs.length>0&&<><h2>Export history</h2><p>Up to five exports per page. Times are shown in UTC.</p><ul aria-label="Export history">{view.jobs.map(job=><li key={job.id}><button className="secondary" type="button" disabled={view.busy} aria-pressed={view.jobId===job.id} onClick={()=>selectJob(job.id)}><time dateTime={job.createdAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(job.createdAt))} UTC</time> · {job.state}</button></li>)}</ul></>}
  {view.hasOlder&&<button type="button" disabled={!view.canLoadOlder} onClick={()=>action('older')}>Older exports</button>}
  {view.phase==='pending'&&<>
   <p>Keep this tab’s saved request until its outcome is confirmed. Closing the tab or clearing browser data may remove the reference.</p>
   {view.reference&&<p>Request reference: <code>{view.reference}</code></p>}
   <button type="button" disabled={!view.canCheckOriginal} onClick={()=>action('checkOriginal')}>Check original request status</button>
   <button type="button" disabled={!view.canCheckResolution} onClick={()=>action('checkResolution')}>Check closing decision</button>
   <form onSubmit={event=>{event.preventDefault();if(view.canRetire)action('retire');}}>
    <label htmlFor="export-close-reason">Reason for closing this interrupted request</label>
    <textarea id="export-close-reason" name="export-close-reason" rows={3} maxLength={4000} value={view.reason} disabled={view.busy} onChange={event=>editReason(event.target.value)} aria-describedby="export-close-help" required/>
    <p id="export-close-help">{[...view.reason].length}/2000 characters. Review the original status first. Closing records your decision and prevents a late request from starting. It does not cancel an export already recorded. Your reason is kept in the audit history.</p>
    <button type="submit" disabled={!view.canRetire}>Close this interrupted request</button>
   </form>
  </>}
  {view.jobId&&<p>Export reference: <code>{view.jobId}</code>{view.jobState&&<> · Status: {view.jobState}</>}</p>}
  {view.canCheckJob&&<button type="button" disabled={view.busy} onClick={()=>action('checkJob')}>Check export status</button>}
 </section>;
}
// Not registered as a product page. Adoption and verified download
// must be composed before this screen is enabled for the owner.
export function SourceExportScreen(){
 const [view,setView]=useState(initialSourceExportView),current=useRef<ReturnType<typeof createSourceExportController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createSourceExportController({storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView});current.current=controller;void controller.load();
  const review=()=>controller.reviewOnReturn(),restore=(event:PageTransitionEvent)=>{if(event.persisted)review();};window.addEventListener('pagehide',review);window.addEventListener('pageshow',restore);document.addEventListener('visibilitychange',review);
  return()=>{controller.dispose();current.current=null;window.removeEventListener('pagehide',review);window.removeEventListener('pageshow',restore);document.removeEventListener('visibilitychange',review);};
 },[]);
 async function action(kind:ExportAction){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 return <><SourceExportControls view={view} statusRef={status} action={kind=>{void action(kind);}} editReason={value=>current.current?.editReason(value)} selectJob={value=>current.current?.selectJob(value)}/>{!view.busy&&view.jobId&&view.jobState==='Ready'&&['ready','confirmed'].includes(view.phase)&&<SourceExportDownloadScreen key={view.jobId} jobId={view.jobId}/>}</>;
}
