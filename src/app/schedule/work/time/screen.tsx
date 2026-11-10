'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../../../client/authentication';
import {scheduling,SchedulingClientError} from '../../../../client/scheduling';
import {lookupSchedulingOriginal} from '../../../../client/scheduling-original';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../../client/pending-scheduling';
import type {PendingScheduling} from '../../../../client/pending-scheduling';
import {formatJobWorkTimeCsv} from '../../../../operations/job-work-time-export';
import type {LoadedJobWorkTime} from '../../../../operations/job-work-time-contract';
import {parseWorkBoundarySave,workBoundaries,workBoundaryKind,workBoundaryOriginal} from '../../../../operations/job-work-boundary-contract';
import type {WorkBoundarySave} from '../../../../operations/job-work-boundary-contract';
import {parseWorkStartSave,workStartKind,workStartOriginal} from '../../../../operations/job-work-start-contract';
import type {LoadedWorkStart,WorkStartSave} from '../../../../operations/job-work-start-contract';
import {parseWorkEndSave,workEndKind,workEndOriginal} from '../../../../operations/job-work-end-contract';
import type {LoadedWorkEnd,WorkEndSave} from '../../../../operations/job-work-end-contract';
import type {SchedulingOriginalKind} from '../../../../operations/scheduling-original-contract';
import {BookingInstantInput} from '../../booking-fields';

type Format='csv'|'json';
type Workspace=Awaited<ReturnType<typeof scheduling.workspace>>;
type Correction=WorkBoundarySave|WorkStartSave|WorkEndSave;
type CorrectionKind=typeof workBoundaryKind|typeof workStartKind|typeof workEndKind;
type State={phase:'loading'|'unavailable'|'signed-out'|'pending';message:string}|
 {phase:'ready';message:string;data:LoadedJobWorkTime;timezone:string;correction:Workspace|null;start:LoadedWorkStart|null;end:LoadedWorkEnd|null};
const initial:State={phase:'loading',message:'Checking access to recorded work time…'};
function available(workspace:Workspace,kind:CorrectionKind){
 if(kind===workEndKind)return workspace.workEndAvailable===true;
 if(kind===workStartKind)return workspace.workStartAvailable===true;
 return workspace.workBoundaryAvailable===true;
}
function duration(microseconds:string){
 const seconds=BigInt(microseconds)/1000000n;
 const hours=seconds/3600n,minutes=(seconds/60n)%60n;
 return [hours?hours+'h':'',hours||minutes?minutes+'m':'',seconds%60n+'s'].filter(Boolean).join(' ');
}

export function WorkTimeScreen({jobId}:{jobId:string}){
 const [state,setState]=useState<State>(initial),refresh=useRef<((format?:Format)=>Promise<void>)|null>(null);
 const correct=useRef<((input:Correction,workspace:Workspace)=>Promise<void>)|null>(null);
 useEffect(()=>{
  let active:AbortController|null=null,downloadUrl:string|null=null;
  const store=(kind:CorrectionKind)=>createPendingSchedulingStore(window.sessionStorage,kind);
  function revoke(){if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
  function clear(){active?.abort();active=null;revoke();setState({phase:'unavailable',message:'Reload to review private work time.'});}
  function download(data:LoadedJobWorkTime,format:Format){
   const contents=format==='csv'?formatJobWorkTimeCsv(data):JSON.stringify({
    ...data.record,intervals:data.intervals,summary:data.summary,coverage:'Saved versions of this job’s work intervals'
   },null,2)+'\n';
   revoke();
   const url=downloadUrl=URL.createObjectURL(new Blob([contents],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'}));
   const link=document.createElement('a');
   link.href=url;link.download='crest-work-time.'+format;link.hidden=true;
   document.body.append(link);
   try{link.click();}finally{link.remove();setTimeout(()=>{if(downloadUrl===url)revoke();},1000);}
  }
  async function load(format?:Format,reported?:string){
   if(active)return;
   if(!jobId){setState({phase:'unavailable',message:'Open a saved Mobile job from Schedule.'});return;}
   const request=active=new AbortController(),signal=request.signal;
   setState(reported?{phase:'loading',message:reported}:initial);
   let pending:PendingScheduling|null=null;
   try{
    const proof=await authentication.session(signal),workspace=await scheduling.workspace(proof,signal);
    signal.throwIfAborted();
    if(!workspace.workTimeAvailable){setState({phase:'unavailable',message:'Recorded work time is unavailable in this build.'});return;}
    for(const kind of [workBoundaryKind,workStartKind,workEndKind]){
     if(!available(workspace,kind))continue;
     pending=store(kind).read();
     if(pending){
      if(pending.businessId!==workspace.context.businessId||pending.binding!==workspace.binding||
       !('jobId'in pending.reference)||pending.reference.jobId!==jobId){
       setState({phase:'pending',message:'Review the interrupted correction in its original signed-in context.'});return;
      }
      const original={schemaVersion:1,businessId:pending.businessId,commandType:kind,reference:pending.reference};
      const result=await lookupSchedulingOriginal(original,proof,signal);
      signal.throwIfAborted();
      if(result.state==='absent'){
       setState({phase:'pending',message:'No saved correction was found. Review the original before making another correction.'});return;
      }
      store(kind).clear(pending);pending=null;reported='Work-time correction saved.';
     }
    }
    const data=await scheduling.jobWorkTime(workspace.context.businessId,jobId,proof,signal);
    signal.throwIfAborted();
    if('state'in data){setState({phase:'unavailable',message:'This job’s work time is unavailable in the current workspace.'});return;}
    let message=reported??'Saved work time loaded.';
    let start:LoadedWorkStart|null=null;
    let end:LoadedWorkEnd|null=null;
    if(workspace.workStartAvailable&&workspace.context.writeState==='ready'&&data.intervals.length>0){
     try{
      const found=await scheduling.jobWorkStart(data.record.businessId,jobId,proof,signal);
      signal.throwIfAborted();
      if('state'in found||found.jobVersion!==data.record.jobVersion||
       !data.intervals.some(row=>row.versionId===found.workVersionId&&row.kind==='active'&&
        row.startedAt===found.startedAt&&row.endedAt===found.workEndedAt))throw Error();
      start=found;
     }catch{
      signal.throwIfAborted();
      message=reported??'Saved work time loaded. Refresh before correcting the first work start.';
     }
    }
    if(workspace.workEndAvailable&&workspace.context.writeState==='ready'&&data.record.jobState==='completed'){
     try{
      const found=await scheduling.jobWorkEnd(data.record.businessId,jobId,proof,signal);
      signal.throwIfAborted();
      if('state'in found||found.jobVersion!==data.record.jobVersion||
       !data.intervals.some(row=>row.versionId===found.workVersionId&&row.kind===found.finalIntervalKind&&
        row.startedAt===found.finalIntervalStartedAt&&row.endedAt===found.completedAt))throw Error();
      end=found;
     }catch{
      signal.throwIfAborted();
      message=reported??'Saved work time loaded. Refresh before correcting the completion time.';
     }
    }
    if(format){
     try{download(data,format);message='Download requested. Check your browser’s downloads.';}
     catch{message='The download could not be prepared. Try again.';}
    }
    setState({phase:'ready',message,data,timezone:workspace.context.timezone,
     correction:workspace.workBoundaryAvailable&&workspace.context.writeState==='ready'?workspace:null,start,end});
   }catch(error){
    if(!signal.aborted){
     const denied=error instanceof AuthenticationError&&error.kind==='denied';
     setState(pending?{phase:'pending',message:'The original correction could not be verified. Check it again in Save review.'}:
      {phase:denied?'signed-out':'unavailable',message:reported??
       (denied?'Sign in to view work time.':'Work time could not be verified. Check your connection and try again.')});
    }
   }finally{if(active===request)active=null;}
  }
  refresh.current=load;
  correct.current=async(input,prior)=>{
   if(active)return;
   const request=active=new AbortController(),signal=request.signal;
   const kind='completionEventId'in input?workEndKind:'workVersionId'in input?workStartKind:workBoundaryKind;
   let pinned:PendingScheduling|null=null,reported:string|undefined;
   setState({phase:'loading',message:'Checking access and saving the correction…'});
   try{
    const proof=await authentication.session(signal),next=await scheduling.workspace(proof,signal);
    signal.throwIfAborted();
    if(next.binding!==prior.binding||next.context.businessId!==input.businessId||
     next.context.recoveryEpoch!==input.recoveryEpoch||next.context.writeState!=='ready'||
     !available(next,kind))throw Error();
    for(const kind of Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]){
     if(createPendingSchedulingStore(window.sessionStorage,kind).read()){
      setState({phase:'pending',message:'Review the interrupted schedule save before submitting a correction.'});return;
     }
    }
    const original='completionEventId'in input?workEndOriginal(input):
     'workVersionId'in input?workStartOriginal(input):workBoundaryOriginal(input);
    pinned={schemaVersion:1,businessId:original.businessId,binding:next.binding,reference:original.reference};
    store(kind).write(pinned);
    const saved=await ('completionEventId'in input?scheduling.correctWorkEnd(input,proof,signal):
     'workVersionId'in input?scheduling.correctWorkStart(input,proof,signal):scheduling.correctWorkBoundary(input,proof,signal));
    signal.throwIfAborted();
    if('state'in saved&&saved.reason==='operation'){
     setState({phase:'pending',message:'The correction conflicts with the original save. Check Save review.'});return;
    }
    try{store(kind).clear(pinned);pinned=null;}
    catch{
     setState({phase:'pending',message:'state'in saved?
      'No change saved. Check the retained reference in Save review.':
      'Work-time correction saved. Check the retained reference in Save review before another correction.'});
     return;
    }
    reported='state'in saved?(saved.reason==='occupancy'
     ?'No change saved. The correction would overlap recorded work or travel.'
     :'No change saved. Review the latest work intervals before trying again.'):'Work-time correction saved.';
   }catch(error){
    if(signal.aborted)return;
    if(pinned&&error instanceof SchedulingClientError&&['input','not_submitted','limited'].includes(error.kind)){
     try{store(kind).clear(pinned);pinned=null;reported='The correction was not submitted. Try again after reviewing the saved times.';}
     catch{/* Save review keeps the reference if local cleanup cannot be verified. */}
    }
    if(!reported)setState(pinned?{phase:'pending',message:'The correction could not be confirmed. Check the original before trying again.'}:
     {phase:'unavailable',message:'The correction was not submitted. Reload saved work and check access.'});
   }finally{if(active===request)active=null;}
   if(reported&&!signal.aborted)await load(undefined,reported);
  };
  void load();
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   active?.abort();refresh.current=null;correct.current=null;revoke();
   document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[jobId]);
 const format=state.phase==='ready'?new Intl.DateTimeFormat('en-US',{timeZone:state.timezone,dateStyle:'medium',timeStyle:'medium'}):null;
 const when=(value:string)=>format!.format(new Date(value));
 return <section aria-label="Saved work time" aria-busy={state.phase==='loading'} className="field-work-form">
  <p role="status">{state.message}</p>
  {state.phase==='signed-out'&&<a href="/sign-in">Sign in to view work time</a>}
  {state.phase==='unavailable'&&jobId&&<button type="button" className="secondary work-time-refresh" onClick={()=>void refresh.current?.()}>Refresh totals</button>}
  {state.phase==='pending'&&<p><button type="button" className="secondary" onClick={()=>void refresh.current?.()}>Check original correction</button> <a href="/save-review">Open Save review</a></p>}
  {state.phase==='ready'&&(()=>{
   const {record,intervals,summary}=state.data;
   const currentIds=new Set(intervals.map(row=>row.versionId));
   const earlier=record.intervalVersions.filter(row=>!currentIds.has(row.versionId))
    .sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt));
   return <>
    <p>Saved version {record.jobVersion} · Measured <time dateTime={record.observedAt}>{when(record.observedAt)}</time> · {state.timezone}</p>
    {intervals.length===0?<p>No work intervals have been recorded for this job.</p>:<>
     <dl className="schedule-work-totals">
      <div><dt>Active work</dt><dd>{duration(summary.observedActiveMicroseconds)}</dd></div>
      <div><dt>Paused</dt><dd>{duration(summary.observedPauseMicroseconds)}</dd></div>
      {!summary.continuous&&<div><dt>Unrecorded gap</dt><dd>{duration(summary.unrecordedMicroseconds)}</dd></div>}
     </dl>
     {summary.openInterval&&<p>{summary.openInterval.kind==='active'?'Work is in progress.':'Work is paused.'}</p>}
    </>}
    <button type="button" className="secondary work-time-refresh" onClick={()=>void refresh.current?.()}>Refresh totals</button>
    {intervals.length>0&&<details><summary>Saved intervals ({intervals.length})</summary>
      <ol>{intervals.map(row=><li key={row.intervalId}>
       <p><strong>{row.kind==='active'?'Active work':'Pause'}</strong> · <time dateTime={row.startedAt}>{when(row.startedAt)}</time>
        {row.endedAt?<> to <time dateTime={row.endedAt}>{when(row.endedAt)}</time></>:' · Still open'}</p>
       {row.pauseReason&&<p>{row.pauseReason}</p>}{row.recordReason&&<p>{row.recordReason}</p>}
      </li>)}</ol>
    </details>}
    {earlier.length>0&&<details><summary>Earlier versions ({earlier.length})</summary>
     <ol>{earlier.map(row=><li key={row.versionId}>
      <p><strong>{row.kind==='active'?'Active work':'Pause'}</strong> · Version {row.sequence} · Recorded <time dateTime={row.recordedAt}>{when(row.recordedAt)}</time></p>
      <p><time dateTime={row.startedAt}>{when(row.startedAt)}</time>{row.endedAt?<> to <time dateTime={row.endedAt}>{when(row.endedAt)}</time></>:' · Open when recorded'}</p>
      {row.pauseReason&&<p>{row.pauseReason}</p>}{row.recordReason&&<p>{row.recordReason}</p>}
     </li>)}</ol>
    </details>}
    {state.correction&&<WorkBoundaryForm data={state.data} workspace={state.correction} when={when}
     save={(input,workspace)=>void correct.current?.(input,workspace)}/>}
    {state.correction&&state.start&&<WorkStartForm start={state.start} observedAt={record.observedAt} workspace={state.correction} when={when}
     save={(input,workspace)=>void correct.current?.(input,workspace)}/>}
    {state.correction&&state.end&&<WorkEndForm end={state.end} observedAt={record.observedAt} workspace={state.correction} when={when}
     save={(input,workspace)=>void correct.current?.(input,workspace)}/>}
    <div className="work-time-downloads">
     <button type="button" className="secondary" onClick={()=>void refresh.current?.('csv')}>Download CSV</button>
     <button type="button" className="secondary" onClick={()=>void refresh.current?.('json')}>Download JSON</button>
    </div>
   </>;
  })()}
  <nav aria-label="Work time navigation"><a href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>Saved job and history</a><a href="/schedule">Schedule</a></nav>
 </section>;
}

function WorkEndForm({end,observedAt,workspace,when,save}:{end:LoadedWorkEnd;observedAt:string;workspace:Workspace;
 when:(time:string)=>string;save:(input:WorkEndSave,workspace:Workspace)=>void}){
 const id=useId(),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 return <details>
  <summary>Correct the completion time</summary>
  <form onSubmit={event=>{
   event.preventDefault();
   const reason=String(new FormData(event.currentTarget).get('reason')??'');
   try{
    if(!correctedAt||correctedAt===end.completedAt||correctedAt<end.finalIntervalStartedAt||correctedAt>observedAt)throw Error();
    const input=parseWorkEndSave({schemaVersion:1,businessId:end.businessId,operationId:crypto.randomUUID(),
     recoveryEpoch:workspace.context.recoveryEpoch,jobId:end.jobId,expectedJobVersion:end.jobVersion,
     workVersionId:end.workVersionId,completionEventId:end.completionEventId,body:{correctedAt,reason}});
    setIssue('');save(input,workspace);
   }catch{setIssue('Enter a different time within the saved limits and give a reason.');}
  }}>
   <p>Saved completion <time dateTime={end.completedAt}>{when(end.completedAt)}</time>.</p>
   {end.originalCompletedAt!==end.completedAt&&<p>First recorded as <time dateTime={end.originalCompletedAt}>{when(end.originalCompletedAt)}</time>.</p>}
   <p>The final {end.finalIntervalKind==='active'?'work interval':'pause'} began at <time dateTime={end.finalIntervalStartedAt}>
    {when(end.finalIntervalStartedAt)}</time>. The job stays completed and Crest keeps its original completion in history.</p>
   <BookingInstantInput label="Corrected completion time" value={correctedAt} zone={workspace.context.timezone} change={setCorrectedAt} seconds/>
   <label htmlFor={id+'-reason'}>Completion correction reason</label>
   <textarea name="reason" id={id+'-reason'} rows={2} maxLength={1000} required/>
   <button type="submit">Save completion correction</button>
   {issue&&<p role="alert">{issue}</p>}
  </form>
 </details>;
}

function WorkStartForm({start,observedAt,workspace,when,save}:{start:LoadedWorkStart;observedAt:string;workspace:Workspace;
 when:(time:string)=>string;save:(input:WorkStartSave,workspace:Workspace)=>void}){
 const id=useId(),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 return <details>
  <summary>Correct the first work start</summary>
  <form onSubmit={event=>{
   event.preventDefault();
   const reason=String(new FormData(event.currentTarget).get('reason')??'');
   try{
    if(!correctedAt||correctedAt===start.startedAt||correctedAt>(start.workEndedAt??observedAt)||
     (start.arrival&&correctedAt<start.arrival.departedAt))throw Error();
    const input=parseWorkStartSave({schemaVersion:1,businessId:start.businessId,operationId:crypto.randomUUID(),
     recoveryEpoch:workspace.context.recoveryEpoch,jobId:start.jobId,expectedJobVersion:start.jobVersion,
     workVersionId:start.workVersionId,arrivalVersionId:start.arrival?.versionId??null,body:{correctedAt,reason}});
    setIssue('');save(input,workspace);
   }catch{setIssue('Enter a different time within the saved limits and give a reason.');}
  }}>
   <p>Saved start <time dateTime={start.startedAt}>{when(start.startedAt)}</time>.</p>
   {start.originalStartedAt!==start.startedAt&&<p>First recorded as <time dateTime={start.originalStartedAt}>{when(start.originalStartedAt)}</time>.</p>}
   {start.arrival&&<p>This also changes the linked arrival. Its departure at <time dateTime={start.arrival.departedAt}>{when(start.arrival.departedAt)}</time> stays in the trip record.</p>}
   {start.workEndedAt&&<p>The first active interval ends at <time dateTime={start.workEndedAt}>{when(start.workEndedAt)}</time>.</p>}
   <BookingInstantInput label="Corrected first start" value={correctedAt} zone={workspace.context.timezone} change={setCorrectedAt} seconds/>
   <label htmlFor={id+'-reason'}>First-start correction reason</label>
   <textarea name="reason" id={id+'-reason'} rows={2} maxLength={1000} required/>
   <button type="submit">Save first-start correction</button>
   {issue&&<p role="alert">{issue}</p>}
  </form>
 </details>;
}

function WorkBoundaryForm({data,workspace,when,save}:{data:LoadedJobWorkTime;workspace:Workspace;
 when:(time:string)=>string;save:(input:WorkBoundarySave,workspace:Workspace)=>void}){
 const id=useId(),[selection,setSelection]=useState(''),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 const boundaries=workBoundaries(data);
 const boundary=boundaries.find(row=>row.leftVersionId===selection);
 const optionTime=new Intl.DateTimeFormat('en-US',{timeZone:workspace.context.timezone,month:'numeric',day:'numeric',
  hour:'numeric',minute:'2-digit',second:'2-digit'});
 if(boundaries.length===0)return null;
 return <details>
  <summary>Correct a pause or resume time</summary>
  <form onSubmit={event=>{
   event.preventDefault();
   const reason=String(new FormData(event.currentTarget).get('reason')??'');
   try{
    if(!boundary||correctedAt<=boundary.after||correctedAt>=boundary.before||correctedAt===boundary.at)throw Error();
    const input=parseWorkBoundarySave({schemaVersion:1,businessId:data.record.businessId,operationId:crypto.randomUUID(),
     recoveryEpoch:workspace.context.recoveryEpoch,jobId:data.record.jobId,expectedJobVersion:data.record.jobVersion,
     leftVersionId:boundary.leftVersionId,rightVersionId:boundary.rightVersionId,body:{correctedAt,reason}});
    setIssue('');save(input,workspace);
   }catch{setIssue('Choose a different time between the adjacent interval limits and enter the reason.');}
  }}>
   <p>Change the time that work paused or resumed. Crest keeps both original intervals in history.</p>
   <label htmlFor={id+'-transition'}>Recorded transition</label>
   <select id={id+'-transition'} required value={selection} onChange={event=>{setSelection(event.target.value);setCorrectedAt('');setIssue('');}}>
    <option value="">Choose a saved pause or resume</option>
    {boundaries.map(row=><option value={row.leftVersionId} key={row.leftVersionId}>{row.action} · {optionTime.format(new Date(row.at))}</option>)}
   </select>
   {boundary&&<div key={boundary.leftVersionId}>
    <p>Saved {boundary.action.toLowerCase()} <time dateTime={boundary.at}>{when(boundary.at)}</time>.</p>
    <p>Enter a time after {when(boundary.after)} and before {when(boundary.before)}.</p>
    <BookingInstantInput label="Corrected local time" value={correctedAt} zone={workspace.context.timezone} change={setCorrectedAt} seconds/>
    <label htmlFor={id+'-reason'}>Correction reason</label>
    <textarea name="reason" id={id+'-reason'} rows={2} maxLength={1000} required/>
    <button type="submit">Save work-time correction</button>
   </div>}
   {issue&&<p role="alert">{issue}</p>}
  </form>
 </details>;
}
