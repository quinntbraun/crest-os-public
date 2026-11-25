'use client';
import {useEffect,useRef,useState} from 'react';
import {createSourceExportStopController,initialExportStopView} from '../../client/source-export-stop-controller';
import type {ExportStopView} from '../../client/source-export-stop-controller';

type Action='load'|'stop'|'check'|'retry';
export function ExportStopControls({view,action,statusRef}:{view:ExportStopView;action:(kind:Action)=>void;statusRef?:React.Ref<HTMLParagraphElement>}){
 return <section className="export-recovery" aria-label="Unfinished export recovery" aria-busy={view.busy}>
  <h3>Unfinished export</h3>
  <p>Stop an unfinished attempt before requesting a fresh export. This keeps its history and does not change your business records.</p>
  <p className="export-status" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} ref={statusRef}>{view.message}</p>
  {view.reference&&<details><summary>Saved stop reference</summary><code>{view.reference}</code></details>}
  <div className="export-actions">
   {view.canStop&&<button type="button" className="secondary" onClick={()=>action('stop')}>Stop this export</button>}
   {view.canCheck&&<button type="button" onClick={()=>action('check')}>Check stop result</button>}
   {view.canRetry&&<button type="button" className="secondary" onClick={()=>action('retry')}>Retry saved stop request</button>}
   <button type="button" className="secondary" disabled={view.busy} onClick={()=>action('load')}>Refresh access and status</button>
  </div>
 </section>;
}
export function ExportStopScreen({jobId,onResolved,onAccessDenied}:{jobId:string;onResolved:()=>void;onAccessDenied?:()=>void}){
 const [view,setView]=useState(initialExportStopView),current=useRef<ReturnType<typeof createSourceExportStopController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createSourceExportStopController({jobId,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)},change:setView,onResolved,...onAccessDenied?{onAccessDenied}:{}});current.current=controller;void controller.load();
  const review=()=>controller.reviewOnReturn(),restore=(event:PageTransitionEvent)=>{if(event.persisted)review();};window.addEventListener('pagehide',review);window.addEventListener('pageshow',restore);document.addEventListener('visibilitychange',review);
  return()=>{controller.dispose();current.current=null;window.removeEventListener('pagehide',review);window.removeEventListener('pageshow',restore);document.removeEventListener('visibilitychange',review);};
 },[jobId,onResolved,onAccessDenied]);
 async function action(kind:Action){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 return <ExportStopControls view={view} action={kind=>{void action(kind);}} statusRef={status}/>;
}
