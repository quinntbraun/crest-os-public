'use client';
import {createPendingLeadAddressStore} from '../../client/pending-lead-address-edit';
import {Fragment,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createLeadVehicleEditorController,initialLeadVehicleEditorView,emptyLeadVehicleDraft} from '../../client/lead-vehicle-editor-controller';
import {createPendingLeadVehicleStore} from '../../client/pending-lead-vehicle-edit';
import {createPendingLeadStore} from '../../client/pending-lead-edit';
import {createPendingLeadStateStore} from '../../client/pending-lead-state-edit';
import {draftFromLeadVehicle} from '../../customer/lead-vehicle-contract';
import type {LeadVehicle} from '../../customer/lead-vehicle-contract';
import type {LeadVehicleDraft,ReportedLeadVehicle} from '../../customer/lead-resource-contract';
import {NullableText} from '../customers/nullable-text';
import {ReferencePicker} from './reference-picker';
import {vehicleYearInput} from '../vehicles/year-input';
function YearInput({value,change}:{value:number;change:(value:number)=>void}){
 const [text,setText]=useState(Number.isFinite(value)?String(value):'');
 return <><label htmlFor="lead-vehicle-year">Reported year value</label><input id="lead-vehicle-year" type="text" autoComplete="off" maxLength={16} pattern="-?[0-9]+" value={text} required onChange={event=>{setText(event.target.value);change(vehicleYearInput(event.target.value));}}/><p className="field-help">Enter a whole year. Unusual reported years are retained.</p></>;
}
function ReportDetails({row}:{row:LeadVehicle}){
 const text=(value:string|number|null)=>value===null?'Not recorded':value===''?'Recorded as empty':String(value),r=row.reported_vehicle;
 return <dl className="customer-values"><dt>Reported label</dt><dd>{r.label}</dd>{(['year','make','model','color','vin','plate','notes'] as const).map(key=><Fragment key={key}><dt>Reported {key==='vin'?'VIN':key}</dt><dd style={{whiteSpace:'pre-wrap'}}>{text(r[key])}</dd></Fragment>)}<dt>Directory vehicle</dt><dd>{row.vehicle_id?'Existing vehicle linked':'Unlinked'}</dd><dt>Requested work</dt><dd style={{whiteSpace:'pre-wrap'}}>{text(row.requested_services.text)}</dd><dt>Reported condition</dt><dd style={{whiteSpace:'pre-wrap'}}>{text(row.condition_notes)}</dd><dt>Report status</dt><dd>{row.archived_at===null?'Active':'Archived: '+row.archived_reason}</dd></dl>;
}
export function LeadVehiclePanel({businessId,leadId,disabled,onLock}:{businessId:string;leadId:string;disabled:boolean;onLock:(locked:boolean)=>void}){
 const [view,setView]=useState(initialLeadVehicleEditorView),current=useRef<ReturnType<typeof createLeadVehicleEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const controller=createLeadVehicleEditorController({addressStore:createPendingLeadAddressStore(storage),businessId,leadId,store:createPendingLeadVehicleStore(storage),intakeStore:createPendingLeadStore(storage),statusStore:createPendingLeadStateStore(storage),change:setView});current.current=controller;
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[businessId,leadId]);
 const dirty=view.draft!==null&&(view.draftIssue!==''||JSON.stringify(view.draft)!==JSON.stringify(view.selected?draftFromLeadVehicle(view.selected):emptyLeadVehicleDraft)),pending=view.phase==='pending',hasDraft=view.draft!==null&&(!view.selected||dirty);
 useEffect(()=>{onLock(view.busy||pending||hasDraft);},[onLock,view.busy,pending,hasDraft]);useEffect(()=>()=>onLock(false),[onLock]);
 useEffect(()=>{if(!pending&&!hasDraft)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[pending,hasDraft]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function edit<K extends keyof LeadVehicleDraft>(key:K,value:LeadVehicleDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function report<K extends keyof ReportedLeadVehicle>(key:K,value:ReportedLeadVehicle[K]){if(view.draft)edit('reportedVehicle',{...view.draft.reportedVehicle,[key]:value});}
 function submit(event:FormEvent){event.preventDefault();if(!disabled)void action('save');}
 const writeDisabled=disabled||view.busy||view.writesPaused,key=(view.selected?.id??'new')+':'+(view.selected?.version??'0');
 return <section aria-label="Lead vehicles" aria-busy={view.busy}><h2>Reported vehicles</h2>
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead vehicle editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {disabled&&<p className="field-help">Save or reload the intake, status or address draft before editing vehicle reports.</p>}
  {['idle','review','blocked','unavailable'].includes(view.phase)&&<button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void action('load')}>Load lead vehicles</button>}
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Vehicle report changes are paused. Retained history remains available.</p>}
   <label className="trust"><input type="checkbox" checked={view.includeArchived} disabled={disabled||view.busy||hasDraft} onChange={event=>void current.current?.query(event.target.checked)}/>Include archived reports</label>
   <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void current.current?.open(row.id)}>{row.reported_vehicle.label}{row.archived_at?' — archived':''}</button><p>Report version {row.version}{row.vehicle_id?' · Existing directory vehicle linked':' · Unlinked report'}</p></li>)}</ul>
   {view.rows.length===0&&<p>No reported vehicles on this page.</p>}{view.hasMore&&<button type="button" className="secondary" disabled={disabled||view.busy||hasDraft} onClick={()=>void current.current?.query(view.includeArchived,true)}>Next vehicle report page</button>}
   <p className="field-help">Opening another report discards an unsaved draft. Original reports are retained separately from directory details and ownership.</p>
   <button type="button" disabled={writeDisabled} onClick={()=>current.current?.create()}>Add reported vehicle</button>
   {view.draft&&<>
    <h3>{view.selected?'Edit vehicle report':'New vehicle report'}</h3><p className="field-help">Only a reported label is required. Unknown details stay unknown. A directory link does not assign ownership or accept requested work.</p>
    <ReferencePicker key={key+':vehicle'} businessId={businessId} kind="vehicle" value={view.draft.vehicleId} disabled={writeDisabled} change={value=>edit('vehicleId',value)}/>
    <form onSubmit={submit} aria-label="Lead vehicle editor"><fieldset disabled={writeDisabled}><legend>Original reported details</legend>
     <label htmlFor="lead-vehicle-label">Reported vehicle label</label><input id="lead-vehicle-label" autoComplete="off" maxLength={400} required value={view.draft.reportedVehicle.label} onChange={event=>report('label',event.target.value)}/><p className="field-help">{[...view.draft.reportedVehicle.label].length}/200 characters.</p>
     <label className="trust"><input type="checkbox" checked={view.draft.reportedVehicle.year!==null} onChange={event=>report('year',event.target.checked?NaN:null)}/>Record reported year</label>{view.draft.reportedVehicle.year!==null&&<YearInput key={key+':year'} value={view.draft.reportedVehicle.year} change={value=>report('year',value)}/>}
     {(['make','model','color','vin','plate','notes'] as const).map(field=><NullableText key={field} name={'lead-vehicle-'+field} label={'Reported '+(field==='vin'?'VIN':field)} limit={field==='notes'?2000:field==='make'||field==='model'?200:128} multiline={field==='notes'} value={view.draft!.reportedVehicle[field]} disabled={writeDisabled} change={value=>report(field,value)}/>)}
     <NullableText name="lead-vehicle-request" label="Requested work" limit={4000} multiline value={view.draft.requestedServices.text} disabled={writeDisabled} change={value=>edit('requestedServices',{schemaVersion:1,text:value})}/>
     <NullableText name="lead-vehicle-condition" label="Reported condition" limit={4000} multiline value={view.draft.conditionNotes} disabled={writeDisabled} change={value=>edit('conditionNotes',value)}/>
     <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>{if(view.draft)current.current?.edit({...view.draft,archived:event.target.checked,archiveReason:event.target.checked?view.draft.archiveReason??'':null});}}/>Archive vehicle report</label>
     {view.draft.archived&&<><label htmlFor="lead-vehicle-archive">Vehicle report archive reason</label><textarea id="lead-vehicle-archive" required maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)}/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1,000 characters.</p></>}
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={writeDisabled||!view.canSave}>Save vehicle report</button></form>
    <button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('load')}>Discard vehicle draft and reload</button>
   </>}
   {view.history&&<section aria-label="Lead vehicle history"><h3>Retained vehicle report history</h3><p>Current report version: {view.history.leadVehicle.version}</p>{view.history.history.map(event=><details key={event.eventId}><summary>Report version {event.version} · {event.action}</summary><p>Recorded (UTC): {event.at}</p>{event.before&&<><h4>Before report</h4><ReportDetails row={event.before}/></>}<h4>After report</h4><ReportDetails row={event.after}/></details>)}{view.history.hasMore&&<button type="button" className="secondary" disabled={disabled||view.busy||hasDraft} onClick={()=>void action('moreHistory')}>Next vehicle history page</button>}</section>}
  </>}
  {pending&&<><p className="field-help">Keep the original report reference until its outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Vehicle report reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check vehicle report outcome</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('retry')}>Retry original vehicle report</button>}</>}
 </section>;
}
