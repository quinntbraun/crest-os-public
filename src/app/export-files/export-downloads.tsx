'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createSourceExportDownloadController,initialSourceExportDownloadView} from '../../client/source-export-download-controller';
import type {SourceExportDownloadView} from '../../client/source-export-download-controller';

type Actions={load:()=>void;continueLoading:()=>void;prepare:(partId:string)=>void;requestSave:()=>void;compare:(files:readonly File[])=>void};
export function SourceExportDownloadControls({view,actions,statusRef}:{view:SourceExportDownloadView;actions:Actions;statusRef?:React.Ref<HTMLParagraphElement>}){
 const choice=useId(),local=useId(),[selected,setSelected]=useState(''),part=view.files.find(file=>file.partId===selected)??view.files[0];
 return <section aria-label="Download export files" aria-busy={view.busy}>
  <h2>Download and compare files</h2>
  <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  <p>Save all parts from the same export together in a private folder. Browser save requests do not confirm files reached your device. Comparing selected bytes does not replace a recoverable database backup.</p>
  <button type="button" disabled={!view.canLoad} onClick={actions.load}>Check sign-in and load file list</button>
  {view.total!==null&&<p>Checked file list: {view.loaded} of {view.total} parts.</p>}
  {view.canContinue&&<button type="button" onClick={actions.continueLoading}>Continue loading file list</button>}
  {view.files.length>0&&<>
   <label htmlFor={choice}>File to prepare</label>
   <select id={choice} value={part?.partId??''} disabled={!view.canPrepare} onChange={event=>setSelected(event.target.value)}>{view.files.map(file=><option key={file.partId} value={file.partId}>{file.fileName} · {file.bytes} bytes · {file.comparison}</option>)}</select>
   <button type="button" disabled={!view.canPrepare||!part} onClick={()=>{if(part)actions.prepare(part.partId);}}>Prepare selected file</button>
   <p>Only one file is prepared at a time. Prepared copies expire within one minute. Prepare missing or invalid parts explicitly; existing local files are never changed by comparison.</p>
   {view.prepared&&<p>Prepared file: {view.prepared.fileName} · {view.prepared.bytes} bytes.</p>}
   <button type="button" disabled={!view.canRequestSave} onClick={actions.requestSave}>Request browser save</button>
   <label htmlFor={local}>Select local copies to compare</label>
   <input id={local} type="file" multiple disabled={!view.canCompare} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';actions.compare(files);}}/>
   <p>Choose all parts you want checked. Results use exact filename, size and checksum. Files are read on this device and are not uploaded.</p>
   {view.extraCount>0&&<p>Unrelated selected files: {view.extraCount}. Their contents were not read.</p>}
   <ul aria-label="Local file comparison">{view.files.map(file=><li key={file.partId}>{file.fileName}: {file.comparison}</li>)}</ul>
  </>}
 </section>;
}
// Still behind the unregistered export screen; no product route is enabled.
function ExportDownloadSession({jobId}:{jobId:string}){
 const [view,setView]=useState(initialSourceExportDownloadView),current=useRef<ReturnType<typeof createSourceExportDownloadController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createSourceExportDownloadController({jobId,change:setView});current.current=controller;
  const review=()=>controller.reviewOnReturn(),restore=(event:PageTransitionEvent)=>{if(event.persisted)review();};document.addEventListener('visibilitychange',review);window.addEventListener('pagehide',review);window.addEventListener('pageshow',restore);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',review);window.removeEventListener('pagehide',review);window.removeEventListener('pageshow',restore);};
 },[jobId]);
 async function action(kind:'load'|'continueLoading'|'prepare'|'compare',value?:string|readonly File[]){const controller=current.current;if(!controller)return;if(kind==='prepare')await controller.prepare(value as string);else if(kind==='compare')await controller.compare(value as readonly File[]);else await controller[kind]();if(current.current===controller)status.current?.focus();}
 return <SourceExportDownloadControls view={view} statusRef={status} actions={{load:()=>{void action('load');},continueLoading:()=>{void action('continueLoading');},prepare:id=>{void action('prepare',id);},compare:files=>{void action('compare',files);},requestSave:()=>{current.current?.requestSave();status.current?.focus();}}}/>;
}
export function SourceExportDownloadScreen({jobId}:{jobId:string}){return <ExportDownloadSession key={jobId} jobId={jobId}/>;}
