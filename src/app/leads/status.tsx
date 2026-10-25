'use client';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createLeadStatusController,initialLeadStatusView} from '../../client/lead-status-controller';
import {createPendingLeadStateStore} from '../../client/pending-lead-state-edit';
import {createPendingLeadStore} from '../../client/pending-lead-edit';
import {manualLeadTargets} from '../../customer/lead-state-contract';
import type {ManualLeadTarget} from '../../customer/lead-state-contract';
const label=(value:string)=>value.replaceAll('_',' ');
export function LeadStatusPanel({businessId,leadId,disabled,onLock,onCommitted}:{businessId:string;leadId:string;disabled:boolean;onLock:(locked:boolean)=>void;onCommitted:(leadId:string)=>void}){
 const [view,setView]=useState(initialLeadStatusView),current=useRef<ReturnType<typeof createLeadStatusController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const controller=createLeadStatusController({businessId,leadId,store:createPendingLeadStateStore(storage),intakeStore:createPendingLeadStore(storage),change:setView,committed:onCommitted});current.current=controller;
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[businessId,leadId,onCommitted]);
 const pending=view.phase==='pending',hasDraft=view.draft!==null;
 useEffect(()=>{onLock(view.busy||pending||hasDraft);},[onLock,view.busy,pending,hasDraft]);
 useEffect(()=>()=>onLock(false),[onLock]);
 useEffect(()=>{if(!pending&&!hasDraft)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[pending,hasDraft]);
 async function action(kind:'load'|'more'|'save'|'check'|'retry'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function submit(event:FormEvent){event.preventDefault();if(!disabled)void action('save');}
 const writeDisabled=disabled||view.busy||view.writesPaused,requiredReason=view.draft?.toState==='lost'||view.source?.state==='lost'||view.source?.state==='won';
 return <section aria-label="Lead status" aria-busy={view.busy}><h2>Status and retained reasons</h2>
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead status editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {disabled&&<p className="field-help">Save or reload the intake draft before starting a status change.</p>}
  {['idle','review','unavailable','blocked'].includes(view.phase)&&<button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void action('load')}>Load current lead status</button>}
  {view.phase==='ready'&&view.source&&<>
   <p>Current status: <strong>{label(view.source.state)}</strong> · Version {view.source.version}</p>
   <p className="field-help">Changing status preserves intake and follow-up. Quote sent and Won require their own confirmed quote or acceptance workflows.</p>
   {view.writesPaused&&<p className="notice">Status changes are paused. Retained reasons remain available.</p>}
   <form onSubmit={submit} aria-label="Change lead status"><fieldset disabled={writeDisabled}><legend>Explicit status change</legend>
    <label htmlFor="lead-status-target">New lead status</label><select id="lead-status-target" value={view.draft?.toState??''} required onChange={event=>current.current?.choose(event.target.value as ManualLeadTarget)}>
     <option value="">Choose a different status</option>{manualLeadTargets.filter(target=>target!==view.source!.state&&!(view.source!.state==='won'&&target==='lost')).map(target=><option key={target} value={target}>{label(target)}</option>)}
    </select>
    {view.draft&&<><label htmlFor="lead-status-reason">{requiredReason?'Reason for this status change':'Reason (optional)'}</label><textarea id="lead-status-reason" autoComplete="off" maxLength={2000} required={requiredReason} value={view.draft.reason??''} onChange={event=>current.current?.reason(event.target.value)}/><p className="field-help">{[...(view.draft.reason??'')].length}/1,000 characters. Lost and reopening Lost or Won require a reason.</p></>}
   </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={writeDisabled||!view.canSave}>Save lead status</button></form>
   {view.draft&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('load')}>Discard status draft and reload</button>}
   <section aria-label="Retained status history"><h3>Retained status history</h3>{view.events.length===0&&<p>No status changes on this page.</p>}{view.events.map(event=><details key={event.id}><summary>Version {event.lead_version} · {label(event.from_state)} → {label(event.to_state)}</summary><p>Recorded (UTC): {event.effective_at}</p><p style={{whiteSpace:'pre-wrap'}}>{event.reason??'No reason recorded for this active status change.'}</p></details>)}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('more')}>Next status history page</button>}</section>
  </>}
  {pending&&<><p className="field-help">Keep this original status reference until its outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Status save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check status change outcome</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('retry')}>Retry original status change</button>}</>}
 </section>;
}
