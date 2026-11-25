'use client';
import {SignInLink} from "../../sign-in-link";

import {ScheduleLink} from '../navigation';

import {TaskPrerequisite} from '../../task-prerequisite';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createFieldSessionController,fieldSessionKind,initialFieldSessionView} from '../../../client/field-session-controller';
import type {FieldSessionMode,FieldSessionView} from '../../../client/field-session-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import type {FieldSessionSave,FieldAction} from '../../../operations/field-session-contract';
import {reviewOutcomeKind} from '../../../operations/review-message-contract';
import {parseCustomer} from '../../../customer/customer-contract';
import {parseVehicle} from '../../../customer/vehicle-contract';
import {BookingInstantInput} from '../booking-fields';
import {CompletionEditor,SavedCompletion} from './completion';
import {InvoicePreparation} from './invoice-preparation';
import {MaintenanceReminders} from '../../maintenance-reminders';
import {TripInterruptionForm} from './interruption';
import {UnfulfilledCancellationForm} from './cancellation';
import {FieldVisitHeader} from './visit-header';
import {defaultWorkAction,workActionLabels} from './actions';
const actionDetails:Readonly<Record<FieldAction,string>>={
 depart:'Record when you leave for the saved work location.',
 arrive:'This ends the open trip and starts work.',
 direct_arrive:'This starts work and records why travel was skipped.',
 start_dropoff:'Start detailing after intake has been recorded for every booked vehicle.',
 start_pickup:'The booked vehicles have recorded work-site arrivals. Start the timer when detailing begins.',
 pause:'This stops active work time and begins a pause.',
 resume:'This ends the pause and restarts active work time.',
};
function WorkForm({view,initialAction,save,more}:{view:FieldSessionView;initialAction:FieldAction;save:(body:FieldSessionSave['body'])=>Promise<void>;more:()=>Promise<void>}){
 const resources=view.resources!,context=view.context!,job=resources.head.job,prefix=useId(),disabled=view.busy||context.context.writeState!=='ready';
 const dropoff=job.fulfillment_mode==='dropoff',pickup=job.fulfillment_mode==='pickup_return';
 const [action,setAction]=useState<FieldAction>(initialAction),[reasons,setReasons]=useState<Partial<Record<FieldAction,string>>>({}),[vehicle,setVehicle]=useState(''),[origin,setOrigin]=useState(''),[instructions,setInstructions]=useState(''),[notes,setNotes]=useState(''),[eta,setEta]=useState('');
 const actionHeading=useRef<HTMLHeadingElement>(null),moveFocus=useRef(false);
 const reason=reasons[action]??'';
 const reasonRequired=action==='pause'||action==='direct_arrive';
 const twoWays=job.state==='scheduled'&&!dropoff&&!pickup;
 const workStarted=job.state==='in_progress'||job.state==='paused';
 const finishAvailable=context.jobCompletionAvailable===true&&workStarted;
 const cancelAvailable=context.unfulfilledCancellationAvailable===true&&workStarted;
 const interruptAvailable=context.jobMileageAvailable===true&&job.state==='en_route';
 const timeAvailable=context.workTimeAvailable===true&&job.fulfillment_mode==='mobile'&&!!job.first_work_at;
 const jobQuery='?job='+encodeURIComponent(job.id);
 useLayoutEffect(()=>{if(moveFocus.current){moveFocus.current=false;actionHeading.current?.focus();}},[action]);
 function setReason(value:string){setReasons(current=>({...current,[action]:value}));}
 const optional=(v:string)=>v.trim()?v:null;
 return <form className="field-work-form active-work-form" onSubmit={event=>{event.preventDefault();if(disabled)return;const body:FieldSessionSave['body']=action==='depart'?{action,reason:optional(reason),trip:{drivenVehicleId:vehicle,origin:{schemaVersion:1,kind:'manual',locationText:origin,instructions:optional(instructions)},etaAt:eta||null,notes:optional(notes)}}:{action,reason:optional(reason)};void save(body);}}>
  <FieldVisitHeader resources={resources} compact/>
  <fieldset className="field-next-action" disabled={disabled}><legend className="visually-hidden">Next work action</legend>
   <h2 ref={actionHeading} tabIndex={-1}>{workActionLabels[action]}</h2>
   <p>{actionDetails[action]}</p>
   {twoWays&&<details className="field-alternate-action">
    <summary>Other ways to start</summary>
    <button type="button" className="secondary" onClick={event=>{
     const menu=event.currentTarget.closest('details');if(menu)menu.open=false;
     moveFocus.current=true;setAction(action==='depart'?'direct_arrive':'depart');
    }}>{action==='depart'?'Already here — start without recorded travel':'Switch to departure'}</button>
   </details>}
   {twoWays&&<fieldset className="field-departure-fields" hidden={action!=='depart'} disabled={action!=='depart'}><legend className="visually-hidden">Departure details</legend><label htmlFor={prefix+'-vehicle'}>Vehicle you are driving</label><select id={prefix+'-vehicle'} value={vehicle} required onChange={event=>setVehicle(event.target.value)}><option value="">Choose the actual vehicle</option>{view.vehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select>{view.moreVehicles&&<button type="button" className="secondary" onClick={()=>void more()}>Load more vehicles</button>}{view.vehicles.length===0&&<p>No active vehicles are available. <ScheduleLink href="/vehicles">Save the vehicle first</ScheduleLink>, then reload this job.</p>}<label htmlFor={prefix+'-origin'}>Where are you leaving from?</label><textarea id={prefix+'-origin'} value={origin} rows={2} maxLength={2000} required autoComplete="off" onChange={event=>setOrigin(event.target.value)}/>
    <details><summary>Trip notes and arrival estimate (optional)</summary><BookingInstantInput label="Estimated arrival (optional)" value={eta} zone={context.context.timezone} change={setEta} required={false}/><p className="field-help">Time zone: {context.context.timezone}. Leave blank when unknown. No route or distance is inferred.</p><label htmlFor={prefix+'-instructions'}>Origin instructions (optional)</label><textarea id={prefix+'-instructions'} value={instructions} maxLength={2000} rows={2} onChange={event=>setInstructions(event.target.value)}/><label htmlFor={prefix+'-notes'}>Trip notes (optional)</label><textarea id={prefix+'-notes'} value={notes} maxLength={2000} rows={2} onChange={event=>setNotes(event.target.value)}/></details>
   </fieldset>}
   {reasonRequired?<><label htmlFor={prefix+'-reason'}>{action==='pause'?'Reason for pause':'Why was travel not recorded?'}</label><textarea id={prefix+'-reason'} value={reason} maxLength={1000} rows={2} required onChange={event=>setReason(event.target.value)}/></>:
    <details><summary>Add a reason or note</summary><label htmlFor={prefix+'-reason'}>Reason or context (optional)</label><textarea id={prefix+'-reason'} value={reason} maxLength={1000} rows={2} onChange={event=>setReason(event.target.value)}/></details>}
   <p className="field-help">Crest records the time when the action saves.{!dropoff&&!pickup&&' Send any customer message separately.'}</p>
   <div className="field-action-controls">
    <button type="submit">{view.busy?'Saving…':workActionLabels[action]}</button>
    {finishAvailable&&<ScheduleLink inert={view.busy} href={'/schedule/work/complete'+jobQuery}>Review and end job</ScheduleLink>}
   </div>
   {(interruptAvailable||cancelAvailable||timeAvailable)&&<details className="field-more-actions" inert={view.busy}>
    <summary>More actions</summary>
    {interruptAvailable&&<ScheduleLink href={'/schedule/work/interrupt'+jobQuery}>Interrupt this trip</ScheduleLink>}
    {timeAvailable&&<ScheduleLink href={'/schedule/work/time'+jobQuery}>Review recorded work time</ScheduleLink>}
    {cancelAvailable&&<ScheduleLink href={'/schedule/work/cancel'+jobQuery}>Cancel if no work was completed</ScheduleLink>}
   </details>}
  </fieldset>
 </form>;
}
export function FieldSessionScreen({jobId,mode='work'}:{jobId:string;mode?:FieldSessionMode}){
 const [view,setView]=useState(initialFieldSessionView),current=useRef<ReturnType<typeof createFieldSessionController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 const completing=mode==='completion',interrupting=mode==='interruption',cancelling=mode==='cancellation';
 const kind=fieldSessionKind[mode];
 useEffect(()=>{const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)},controller=createFieldSessionController({mode,store:createPendingSchedulingStore(storage,kind),...completing?{outcomeStore:createPendingSchedulingStore(storage,reviewOutcomeKind)}:{},blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(key=>key!==kind&&(!completing||key!==reviewOutcomeKind)).map(key=>createPendingSchedulingStore(storage,key)),change:setView});current.current=controller;void controller.load(jobId);
  const clear=()=>controller.suspend(),hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);return()=>{current.current=null;controller.dispose();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[jobId,kind,mode,completing]);
 async function action(kind:'load'|'check'|'moreVehicles'){const controller=current.current;if(!controller)return;await(kind==='load'?controller.load(jobId):controller[kind]());if(current.current===controller)status.current?.focus();}
 const activeJob=view.resources?.head.job;
 const workAction=activeJob&&defaultWorkAction(activeJob);
 const pickup=activeJob?.fulfillment_mode==='pickup_return'&&view.context?.pickupWorkAvailable===true;
 const dropoff=activeJob?.fulfillment_mode==='dropoff'&&view.context?.dropoffCustodyAvailable===true;
 const returnHref=jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule';
 const blocked=view.phase==='blocked';
 const visit=completing&&view.resources?{
  customer:parseCustomer(view.resources.vehicles[0]!.customer_snapshot,view.resources.businessId).display_name,
  vehicles:view.resources.vehicles.map(row=>({id:row.vehicle_id,label:parseVehicle(row.vehicle_snapshot,view.resources!.businessId).label})),
  assignments:view.completionVehicles,
 }:undefined;
 const quietLoaded=mode==='work'&&view.phase==='ready'&&view.message==='Saved job loaded. Record what is happening now.';
 return <section aria-label={completing?'Job completion':interrupting?'Mobile trip interruption':cancelling?pickup?'Pickup job cancellation':dropoff?'Drop-Off job cancellation':'Mobile job cancellation':pickup?'Pickup work status':dropoff?'Drop-Off work status':'Mobile work status'} aria-busy={view.busy}><p className={view.selectionNeeded?'visually-hidden':'job-change-status'+(quietLoaded?' visually-hidden':'')} ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='loading'&&<div className="workspace-skeleton appointment-change-loading" aria-hidden="true"/>}
  {view.phase==='signed-out'&&<SignInLink className="primary-action" returnTo="schedule">{completing?'Sign in to review completion':'Sign in to review work status'}</SignInLink>}
  {mode==='work'&&view.phase==='ready'&&view.resources&&view.context&&workAction&&<WorkForm initialAction={workAction} key={view.resources.head.job.id+':'+view.resources.head.job.version} view={view} more={()=>action('moreVehicles')} save={async body=>{const controller=current.current;if(!controller)return;await controller.save(body);if(current.current===controller)status.current?.focus();}}/>}
  {interrupting&&view.phase==='ready'&&view.resources&&view.context&&view.openTrip&&
   <TripInterruptionForm key={view.openTrip.legVersionId} view={view} save={async draft=>{
    const controller=current.current;if(!controller)return;await controller.interrupt(draft);if(current.current===controller)status.current?.focus();
   }}/>}
  {cancelling&&view.phase==='ready'&&view.context&&view.resources&&view.cancellation&&
   <UnfulfilledCancellationForm key={view.cancellation.workIntervalId} view={view} save={async draft=>{
    const controller=current.current;if(!controller)return;await controller.cancelUnfulfilled(draft);if(current.current===controller)status.current?.focus();
   }}/>}
  {view.phase==='ready'&&view.completion&&<CompletionEditor key={view.completion.jobId+':'+view.completion.jobVersion} context={view.completion} visit={visit} disabled={view.busy||view.context?.context.writeState!=='ready'} save={async body=>{
   const controller=current.current;if(!controller)return;await controller.complete(body);if(current.current===controller)status.current?.focus();
  }}/>}
  {view.summary&&<SavedCompletion summary={view.summary} outcome={view.reviewOutcome} outcomeEnabled={view.reviewOutcomeEnabled===true}
   historyAvailable={view.reviewHistoryAvailable===true} invoicePreparationAvailable={view.invoicePreparationAvailable===true} canRecordOutcome={view.canRecordReviewOutcome===true} disabled={view.busy} saveOutcome={async body=>{
    const controller=current.current;if(!controller)return;await controller.recordReviewOutcome(body);if(current.current===controller)status.current?.focus();
   }}/>}
  {view.summary&&view.maintenanceFollowUpAvailable&&<MaintenanceReminders key={view.summary.jobId}
   businessId={view.summary.businessId} scope={{kind:'job',id:view.summary.jobId}}/>}
  {view.summary&&view.invoicePreparationAvailable&&<InvoicePreparation key={view.summary.jobId} businessId={view.summary.businessId} jobId={view.summary.jobId}/>}
  {view.savedJobId&&<>{!view.summary&&<p>Confirmed saved version {view.savedVersion}.</p>}<ScheduleLink className={view.phase==='pending'||completing&&!view.summary?'primary-action secondary':'primary-action'} href={'/schedule?job='+encodeURIComponent(view.savedJobId)}>Open updated job in Schedule</ScheduleLink></>}
  {completing&&view.phase==='committed'&&!view.summary&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload saved completion</button>}
  {view.phase==='pending'&&<><p>No request retries automatically. Keep its reference until the original outcome is verified.</p>{view.reference&&<p className="save-reference">Original work reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>{view.pendingKind===reviewOutcomeKind?'Check original message outcome':completing?'Check original completion':interrupting?'Check original trip interruption':cancelling?'Check original cancellation':'Check original work action'}</button><ScheduleLink href={'/save-review?kind='+(view.pendingKind??kind)}>Open Save review</ScheduleLink></>}
  {view.selectionNeeded&&<TaskPrerequisite kind={mode}/>}
  {blocked&&!view.selectionNeeded&&<div className="field-unavailable-actions">
   <ScheduleLink className="primary-action" href={returnHref}>{jobId?'Open saved job':'Open Schedule'}</ScheduleLink>
   {jobId&&(cancelling?<details className="field-eligibility-recheck"><summary>Check cancellation eligibility again</summary><button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload saved work</button></details>:<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload saved work</button>)}
  </div>}
  {['review','unavailable'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload saved work</button>}
  <nav aria-label="Work navigation">{!blocked&&jobId&&<ScheduleLink href={returnHref}>Saved job and history</ScheduleLink>}{(!blocked||jobId)&&<ScheduleLink href="/schedule">Schedule</ScheduleLink>}<ScheduleLink href="/save-review">Interrupted saves</ScheduleLink></nav>
 </section>;
}
