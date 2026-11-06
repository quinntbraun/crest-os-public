'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createFieldSessionController,initialFieldSessionView} from '../../../client/field-session-controller';
import type {FieldSessionView} from '../../../client/field-session-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import type {FieldSessionSave,FieldAction} from '../../../operations/field-session-contract';
import {parseCustomer} from '../../../customer/customer-contract';
import {BookingInstantInput} from '../booking-fields';
const labels:Readonly<Record<string,string>>={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const actionLabels:Readonly<Record<FieldAction,string>>={depart:'Record departure',arrive:'Record arrival and start work',direct_arrive:'Start work without recorded travel',pause:'Pause work',resume:'Resume work'};
function WorkForm({view,save,more}:{view:FieldSessionView;save:(body:FieldSessionSave['body'])=>Promise<void>;more:()=>Promise<void>}){
 const resources=view.resources!,context=view.context!,job=resources.head.job,customer=parseCustomer(resources.vehicles[0]!.customer_snapshot,resources.businessId),prefix=useId(),disabled=view.busy||context.context.writeState!=='ready';
 const [action,setAction]=useState<FieldAction>(job.state==='scheduled'?'depart':job.state==='en_route'?'arrive':job.state==='paused'?'resume':'pause'),[reason,setReason]=useState(''),[vehicle,setVehicle]=useState(''),[origin,setOrigin]=useState(''),[instructions,setInstructions]=useState(''),[notes,setNotes]=useState(''),[eta,setEta]=useState('');
 const optional=(v:string)=>v.trim()?v:null;
 return <form className="field-work-form" onSubmit={event=>{event.preventDefault();if(disabled)return;const body:FieldSessionSave['body']=action==='depart'?{action,reason:optional(reason),trip:{drivenVehicleId:vehicle,origin:{schemaVersion:1,kind:'manual',locationText:origin,instructions:optional(instructions)},etaAt:eta||null,notes:optional(notes)}}:{action,reason:optional(reason)};void save(body);}}>
  <p className="eyebrow">{labels[job.state]} · Saved version {job.version}</p><h2>{customer.display_name}</h2>
  <p>{action==='depart'?'Record the actual start of this trip to the saved job location.':action==='arrive'?'This closes the open trip and starts work at the recorded server time.':action==='pause'?'This stops active work time and begins a pause.':action==='resume'?'This ends the pause and restarts active work time.':'This starts work and records that travel was omitted. It does not create a trip.'}</p>
  <p className="field-help">The time is recorded when the action saves. Messages are prepared only; this action does not send a message.</p>
  <fieldset disabled={disabled}><legend>{actionLabels[action]}</legend>
   {job.state==='scheduled'&&<><label htmlFor={prefix+'-action'}>What is happening?</label><select id={prefix+'-action'} value={action} onChange={event=>{if(event.target.value==='depart'||event.target.value==='direct_arrive')setAction(event.target.value);}}><option value="depart">Leaving for this job</option><option value="direct_arrive">Already here — start without recorded travel</option></select></>}
   {action==='depart'&&<><label htmlFor={prefix+'-vehicle'}>Vehicle you are driving</label><select id={prefix+'-vehicle'} value={vehicle} required onChange={event=>setVehicle(event.target.value)}><option value="">Choose the actual vehicle</option>{view.vehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select>{view.moreVehicles&&<button type="button" className="secondary" onClick={()=>void more()}>Load more vehicles</button>}{view.vehicles.length===0&&<p>No active vehicles are available. <a href="/vehicles">Save the vehicle first</a>, then reload this job.</p>}<label htmlFor={prefix+'-origin'}>Where are you leaving from?</label><textarea id={prefix+'-origin'} value={origin} rows={2} maxLength={2000} required autoComplete="off" onChange={event=>setOrigin(event.target.value)}/>
    <details><summary>Trip notes and arrival estimate (optional)</summary><BookingInstantInput label="Estimated arrival (optional)" value={eta} zone={context.context.timezone} change={setEta} required={false}/><p className="field-help">Time zone: {context.context.timezone}. Leave blank when unknown. No route or distance is inferred.</p><label htmlFor={prefix+'-instructions'}>Origin instructions (optional)</label><textarea id={prefix+'-instructions'} value={instructions} maxLength={2000} rows={2} onChange={event=>setInstructions(event.target.value)}/><label htmlFor={prefix+'-notes'}>Trip notes (optional)</label><textarea id={prefix+'-notes'} value={notes} maxLength={2000} rows={2} onChange={event=>setNotes(event.target.value)}/></details>
   </>}
   <label htmlFor={prefix+'-reason'}>{action==='pause'?'Reason for pause':action==='direct_arrive'?'Why was travel not recorded?':'Reason or context (optional)'}</label><textarea id={prefix+'-reason'} value={reason} maxLength={1000} rows={2} required={action==='pause'||action==='direct_arrive'} onChange={event=>setReason(event.target.value)}/>
   <button type="submit">{view.busy?'Saving…':actionLabels[action]}</button>
  </fieldset>
 </form>;
}
export function FieldSessionScreen({jobId}:{jobId:string}){
 const [view,setView]=useState(initialFieldSessionView),current=useRef<ReturnType<typeof createFieldSessionController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)},controller=createFieldSessionController({store:createPendingSchedulingStore(storage,'operations.job.field'),blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(kind=>kind!=='operations.job.field').map(kind=>createPendingSchedulingStore(storage,kind)),change:setView});current.current=controller;void controller.load(jobId);
  const clear=()=>controller.suspend(),hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);return()=>{current.current=null;controller.dispose();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[jobId]);
 async function action(kind:'load'|'check'|'moreVehicles'){const controller=current.current;if(!controller)return;await(kind==='load'?controller.load(jobId):controller[kind]());if(current.current===controller)status.current?.focus();}
 return <section aria-label="Mobile work status" aria-busy={view.busy}><p className="job-change-status" ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to review work status</a>}
  {view.phase==='ready'&&view.resources&&view.context&&<WorkForm key={view.resources.head.job.id+':'+view.resources.head.job.version} view={view} more={()=>action('moreVehicles')} save={async body=>{const controller=current.current;if(!controller)return;await controller.save(body);if(current.current===controller)status.current?.focus();}}/>}
  {view.savedJobId&&<><p>Confirmed saved version {view.savedVersion}.</p><a className="primary-action" href={'/schedule?job='+encodeURIComponent(view.savedJobId)}>Open updated job in Schedule</a></>}
  {view.phase==='pending'&&<><p>No request retries automatically. Keep its reference until the original outcome is verified.</p>{view.reference&&<p className="save-reference">Original work reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check original work action</button><a href="/save-review?kind=operations.job.field">Open Save review</a></>}
  {['review','blocked','unavailable'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload saved work</button>}
  <nav aria-label="Work navigation"><a href={'/schedule?job='+encodeURIComponent(jobId)}>Saved job and history</a><a href="/schedule">Schedule</a><a href="/save-review">Interrupted saves</a></nav>
 </section>;
}
