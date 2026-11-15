'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createMaintenanceReminderController,initialMaintenanceReminderView} from '../client/maintenance-follow-up';
import type {MaintenanceAction,MaintenanceHistory,MaintenanceReminderView,MaintenanceScope} from '../client/maintenance-follow-up';
import {customerUuid} from '../customer/customer-contract';
import {BookingInstantInput} from './schedule/booking-fields';

const labels={open:'Open',snoozed:'Snoozed',completed:'Completed',dismissed:'Dismissed'} as const;
type ReminderController=ReturnType<typeof createMaintenanceReminderController>;
type Editor={kind:'create'}|{kind:'change';taskId:string};
function dateLabel(instant:string,timezone:string){
 return new Intl.DateTimeFormat(undefined,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(instant));
}
function savedJobId(value:string){
 const url=new URL(value,window.location.origin);
 const job=url.searchParams.get('job');
 if(url.origin!==window.location.origin||url.pathname!=='/schedule'||url.hash||url.username||url.password||
  url.searchParams.size!==1||!customerUuid(job))throw Error();
 return job;
}

function ReminderEditor({editor,view,close,controller}:{editor:Editor;view:MaintenanceReminderView;close:()=>void;controller:()=>ReminderController|null}){
 const form=useRef<HTMLFormElement>(null);
 useEffect(()=>{form.current?.querySelector<HTMLElement>('select, input')?.focus();},[]);
 const id=useId(),[date,setDate]=useState(''),[vehicle,setVehicle]=useState(''),[reason,setReason]=useState('');
 const [action,setAction]=useState<MaintenanceAction['kind']|'none'>('none'),[jobLink,setJobLink]=useState(''),[error,setError]=useState('');
 const creating=editor.kind==='create',needsDate=creating||action==='snoozed',showLink=!creating&&(action==='snoozed'||action==='completed');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(view.busy||!(creating?view.canCreate:view.canChange))return;
  setError('');
  if(needsDate&&!date){setError('Choose a date and time. If a time occurs twice, choose its occurrence.');return;}
  const note=reason.trim()||null;
  if(action==='dismissed'&&!note){setError('Enter a reason to dismiss this reminder.');return;}
  if(!creating&&action==='none'){setError('Choose what to record.');return;}
  let rebookingJobId:string|null=null;
  try{if(showLink&&jobLink.trim())rebookingJobId=savedJobId(jobLink.trim());}
  catch{setError('Copy the saved job link from Schedule in this Crest workspace.');return;}
  const saved=editor.kind==='create'?await controller()?.create(date,vehicle||null,note):
   action==='none'?false:await controller()?.change(editor.taskId,{kind:action,snoozedUntil:action==='snoozed'?date:null,rebookingJobId,reason:note});
  if(saved)close();
 }
 return <form ref={form} className="field-work-form" aria-label={creating?'New maintenance reminder':'Update maintenance reminder'} onSubmit={event=>void submit(event)}>
  <fieldset disabled={view.busy}><legend>{creating?'New maintenance reminder':'Update maintenance reminder'}</legend>
   {creating&&view.vehicles.length>0&&<>
    <label htmlFor={id+'-vehicle'}>Vehicle (optional)</label>
    <select id={id+'-vehicle'} value={vehicle} onChange={event=>setVehicle(event.target.value)}>
     <option value="">Customer-wide reminder</option>
     {view.vehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}
    </select>
   </>}
   {!creating&&<>
    <label htmlFor={id+'-action'}>What should happen?</label>
    <select id={id+'-action'} value={action==='none'?'':action} required onChange={event=>{
     const next=event.target.value;if(next===''||next==='snoozed'||next==='completed'||next==='dismissed'){
      setAction(next||'none');setDate('');setJobLink('');setError('');
     }
    }}>
     <option value="">Choose an action</option><option value="snoozed">Snooze</option>
     <option value="completed">Mark complete</option><option value="dismissed">Dismiss</option>
    </select>
   </>}
   {needsDate&&<>
    <BookingInstantInput label={creating?'Due date and time':'Snooze until'} value={date} zone={view.timezone} change={setDate}/>
    <p className="field-help">Times use {view.timezone}.</p>
   </>}
   {showLink&&<>
    <label htmlFor={id+'-booking'}>Saved rebooking link (optional)</label>
    <input id={id+'-booking'} type="text" inputMode="url" maxLength={1000} value={jobLink} autoComplete="off"
     aria-describedby={id+'-booking-help'} onChange={event=>setJobLink(event.target.value)}/>
    <p className="field-help" id={id+'-booking-help'}>Paste the link to the saved job in Schedule. It must be for the same customer and, if selected, the same vehicle.</p>
   </>}
   <label htmlFor={id+'-reason'}>{action==='dismissed'?'Dismissal reason':'Note (optional)'}</label>
   <textarea id={id+'-reason'} maxLength={1000} rows={2} value={reason} required={action==='dismissed'}
    onChange={event=>setReason(event.target.value)}/>
   {error&&<p role="alert">{error}</p>}
   <button type="submit" disabled={!creating&&action==='none'}>{view.busy?'Saving…':creating?'Save reminder':'Save reminder change'}</button>
   <button type="button" className="secondary" onClick={close}>Cancel</button>
  </fieldset>
 </form>;
}

function ReminderHistory({history,view,close,more,download}:{history:MaintenanceHistory;view:MaintenanceReminderView;close:()=>void;more:()=>void;download:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[history.taskId]);
 return <section aria-label="Maintenance reminder history">
  <h3 ref={heading} tabIndex={-1}>Reminder history</h3>
  <ol className="follow-up-list">{history.entries.map(event=><li key={event.eventId}>
   <strong>{event.version==='1'?'Created':labels[event.state]}</strong>
   <time dateTime={event.recordedAt}>{dateLabel(event.recordedAt,view.timezone)}</time>
   {event.snoozedUntil&&<span>Snoozed until {dateLabel(event.snoozedUntil,view.timezone)}</span>}
   {event.reason&&<p className="completion-text">{event.reason}</p>}
   {event.rebookingJobId&&<a href={'/schedule?job='+encodeURIComponent(event.rebookingJobId)}>Open linked rebooking</a>}
  </li>)}</ol>
  {history.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={more}>Load more history</button>}
  <div className="maintenance-actions">
   <button type="button" className="secondary" disabled={view.busy} onClick={download}>Download history (CSV + JSON)</button>
   <button type="button" className="secondary" disabled={view.busy} onClick={close}>Close history</button>
  </div>
 </section>;
}

export function MaintenanceReminders({businessId,scope}:{businessId:string;scope:MaintenanceScope}){
 const [view,setView]=useState(initialMaintenanceReminderView),[editor,setEditor]=useState<Editor|null>(null);
 const current=useRef<ReminderController|null>(null),details=useRef<HTMLDetailsElement>(null),status=useRef<HTMLParagraphElement>(null);
 const {kind,id}=scope,archived=scope.kind==='customer'&&scope.archived;
 const downloadUrl=useRef<string|null>(null);
 const revokeDownload=useCallback(()=>{
  if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);
  downloadUrl.current=null;
 },[]);
 function downloadHistory(taskId:string){
  void current.current?.downloadHistory(taskId,bytes=>{
   revokeDownload();
   const url=downloadUrl.current=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
   const link=document.createElement('a');
   link.href=url;link.download='crest-maintenance-reminder-history.zip';link.rel='noopener noreferrer';link.hidden=true;
   document.body.append(link);
   try{link.click();}finally{link.remove();setTimeout(()=>{if(downloadUrl.current===url)revokeDownload();},1000);}
  });
 }
 useEffect(()=>{
  const controller=createMaintenanceReminderController({businessId,scope:kind==='customer'?{kind,id,archived}:{kind,id},
   storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView});
  current.current=controller;
  if(details.current?.open)void controller.load();
  const clear=()=>{revokeDownload();if(details.current)details.current.open=false;controller.suspend();setEditor(null);};
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{revokeDownload();current.current=null;controller.dispose();document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[businessId,kind,id,archived,revokeDownload]);
 async function refresh(){const controller=current.current;await controller?.load();if(current.current===controller)status.current?.focus();}
 const closeEditor=()=>{setEditor(null);status.current?.focus();};
 return <details className="review-message-history maintenance-reminders" ref={details} onToggle={event=>{
  if(event.currentTarget.open)void current.current?.load();
  else{revokeDownload();current.current?.suspend();setEditor(null);}
 }}>
  <summary>Maintenance reminders</summary>
  <div aria-busy={view.busy}>
   <p className="field-help">Choose a date for an internal reminder.</p>
   <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
   {view.phase==='pending'&&<p><a href="/save-review?kind=operations.follow_up.save">Open interrupted save review</a></p>}
   {(view.phase==='unavailable'||view.phase==='review')&&
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>{setEditor(null);void refresh();}}>Reload saved reminders</button>}
   {view.phase==='ready'&&<>
    {view.entries.length===0?<p>No saved maintenance reminders for this {kind}.</p>:
     <ul className="follow-up-list">{view.entries.map(({record,vehicleLabel,effectiveDueAt})=><li key={record.taskId}>
      <strong>{vehicleLabel??'Customer-wide reminder'}</strong>
      <time dateTime={effectiveDueAt}>{dateLabel(effectiveDueAt,view.timezone)}</time>
      <span>{labels[record.state]}</span>
      {record.reason&&<p className="completion-text">{record.reason}</p>}
      {record.rebookingJobId&&<a href={'/schedule?job='+encodeURIComponent(record.rebookingJobId)}>Open linked rebooking</a>}
      <div className="maintenance-actions">
       <button type="button" className="secondary" disabled={view.busy||editor!==null} onClick={()=>void current.current?.showHistory(record.taskId)}>View reminder history</button>
       {view.canChange&&(record.state==='open'||record.state==='snoozed')&&
        <button type="button" className="secondary" disabled={view.busy||editor!==null} onClick={()=>{current.current?.closeHistory();setEditor({kind:'change',taskId:record.taskId});}}>Update reminder</button>}
      </div>
     </li>)}</ul>}
    {view.more&&<button type="button" className="secondary" disabled={view.busy||editor!==null} onClick={()=>void current.current?.more()}>Load more reminders</button>}
    {view.history&&<ReminderHistory history={view.history} view={view} close={()=>{revokeDownload();current.current?.closeHistory();}}
     more={()=>void current.current?.showHistory(view.history!.taskId,true)} download={()=>downloadHistory(view.history!.taskId)}/>}
    {view.canCreate&&editor===null&&<button type="button" disabled={view.busy}
     onClick={()=>{current.current?.closeHistory();setEditor({kind:'create'});}}>Add maintenance reminder</button>}
    {editor&&<ReminderEditor editor={editor} view={view} controller={()=>current.current} close={closeEditor}/>}
    {!view.canChange&&<p className="field-help">Reminder changes are paused for recovery review.</p>}
   </>}
  </div>
 </details>;
}
