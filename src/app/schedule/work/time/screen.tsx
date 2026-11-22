'use client';
import {ScheduleLink} from '../../navigation';

import {TaskPrerequisite} from '../../../task-prerequisite';
import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {authentication,AuthenticationError} from '../../../../client/authentication';
import {scheduling,SchedulingClientError} from '../../../../client/scheduling';
import {lookupSchedulingOriginal} from '../../../../client/scheduling-original';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../../client/pending-scheduling';
import type {PendingScheduling} from '../../../../client/pending-scheduling';
import {formatJobWorkTimeCsv} from '../../../../operations/job-work-time-export';
import type {LoadedJobWorkTime} from '../../../../operations/job-work-time-contract';
import {scheduleInstantMicroseconds} from '../../../../operations/schedule-time';
import {parseWorkBoundarySave,workBoundaries,workBoundaryKind,workBoundaryOriginal} from '../../../../operations/job-work-boundary-contract';
import type {WorkBoundarySave} from '../../../../operations/job-work-boundary-contract';
import {parseWorkStartSave,workStartKind,workStartOriginal} from '../../../../operations/job-work-start-contract';
import type {LoadedWorkStart,WorkStartSave} from '../../../../operations/job-work-start-contract';
import {parseWorkEndSave,workEndKind,workEndOriginal} from '../../../../operations/job-work-end-contract';
import type {LoadedWorkEnd,WorkEndSave} from '../../../../operations/job-work-end-contract';
import type {SchedulingOriginalKind} from '../../../../operations/scheduling-original-contract';
import {workTimeDuration as duration} from './work-time-presentation';
import {WorkIntervalHistory} from './work-interval-history';
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

export function WorkTimeScreen({jobId}:{jobId:string}){
 const [state,setState]=useState<State>(initial),refresh=useRef<((format?:Format)=>Promise<void>)|null>(null);
 const [dirtyDrafts,setDirtyDrafts]=useState<ReadonlySet<string>>(()=>new Set());
 const draftChanged=useCallback((id:string,dirty:boolean)=>setDirtyDrafts(previous=>{
  if(previous.has(id)===dirty)return previous;
  const next=new Set(previous);if(dirty)next.add(id);else next.delete(id);return next;
 }),[]);
 const mayReplaceDrafts=(exceptId?:string)=>!Array.from(dirtyDrafts).some(id=>id!==exceptId)||window.confirm(exceptId?'Continue with this save and discard the other unfinished correction drafts?':'Discard unfinished correction drafts and load a new saved snapshot?');
 const reload=(format?:Format)=>{if(mayReplaceDrafts())void refresh.current?.(format);};
 useEffect(()=>{
  if(!dirtyDrafts.size)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirtyDrafts]);
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
     correction:workspace.context.writeState==='ready'?workspace:null,start,end});
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
 function handleCorrection(input:Correction,workspace:Workspace,id?:string){
  if(!mayReplaceDrafts(id))return;
  void correct.current?.(input,workspace);
 }
 const format=state.phase==='ready'?new Intl.DateTimeFormat('en-US',{timeZone:state.timezone,dateStyle:'medium',timeStyle:'medium'}):null;
 const when=(value:string)=>format!.format(new Date(value));
 return <section aria-label="Saved work time" aria-busy={state.phase==='loading'} className="field-work-form work-time-screen">
  <p role="status">{state.message}</p>
  {state.phase==='signed-out'&&<ScheduleLink href="/sign-in">Sign in to view work time</ScheduleLink>}
  {state.phase==='unavailable'&&jobId&&<button type="button" className="work-time-refresh" onClick={()=>reload()}>Refresh totals</button>}
  {state.phase==='pending'&&<p><button type="button" onClick={()=>reload()}>Check original correction</button> <ScheduleLink href="/save-review">Open Save review</ScheduleLink></p>}
  {state.phase==='ready'&&(()=>{
   const {record,intervals,summary}=state.data;
   return <div className="work-time-workbench">
    <section className="home-panel work-time-overview" aria-label="Work totals">
     <div className="work-time-overview-heading">
      <div>
       <h2>{summary.openInterval?summary.openInterval.kind==='active'?'Work is in progress.':'Work is paused.':'Work totals'}</h2>
       <p>As of <time dateTime={record.observedAt}>{when(record.observedAt)}</time> · {state.timezone}</p>
      </div>
      <button type="button" className="secondary work-time-refresh" onClick={()=>reload()}>Refresh totals</button>
     </div>
     {intervals.length===0?<div className="work-time-empty"><p>No work intervals have been recorded for this job.</p>
      <ScheduleLink className="primary-action" href={'/schedule/work?job='+encodeURIComponent(jobId)}>Open work status</ScheduleLink>
      <p className="field-help">Review this job’s saved status and available actions.</p>
     </div>:
      <dl className="schedule-work-totals">
       <div><dt>Active work</dt><dd>{duration(summary.observedActiveMicroseconds)}</dd></div>
       <div><dt>Paused</dt><dd>{duration(summary.observedPauseMicroseconds)}</dd></div>
       {!summary.continuous&&<div><dt>Unrecorded gap</dt><dd>{duration(summary.unrecordedMicroseconds)}</dd></div>}
      </dl>}
     {summary.openInterval&&<p className="field-help">Open durations are measured only to the read time above. Refresh to update them.</p>}
     {dirtyDrafts.size>0&&<p className="work-time-draft-state">{dirtyDrafts.size} unfinished correction {dirtyDrafts.size===1?'draft':'drafts'}. Reloading or downloading asks before discarding them.</p>}
     <div className="work-time-downloads" role="group" aria-label="Work-time downloads">
      <span className="field-help">Saved job version {record.jobVersion}</span>
      <button type="button" className="secondary" onClick={()=>reload('csv')}>Download CSV</button>
      <button type="button" className="secondary" onClick={()=>reload('json')}>Download JSON</button>
     </div>
    </section>
    {intervals.length>0&&<WorkTimeLedger data={state.data} timezone={state.timezone} workspace={state.correction}
     start={state.start} end={state.end} when={when} draftChanged={draftChanged} save={handleCorrection}/>}
   </div>;
  })()}
  {!jobId&&state.phase==='unavailable'&&<TaskPrerequisite kind="workTime"/>}
 </section>;
}

type WorkClock=(time:string)=>string;
type SaveCorrection=(input:Correction,workspace:Workspace,draftId?:string)=>void;
type DraftChanged=(id:string,dirty:boolean)=>void;

function WorkTimeLedger({data,timezone,workspace,start,end,when,save,draftChanged}:{
 data:LoadedJobWorkTime;timezone:string;workspace:Workspace|null;start:LoadedWorkStart|null;
 end:LoadedWorkEnd|null;when:WorkClock;save:SaveCorrection;draftChanged:DraftChanged;
}){
 const day=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'long',month:'long',day:'numeric',year:'numeric'});
 const clock=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
 const {record,intervals}=data;
 const transitions=new Map(workspace?.workBoundaryAvailable?workBoundaries(data).map(row=>[row.leftVersionId,row]):[]);
 const groups:{label:string;rows:(typeof intervals)[number][]}[]=[];
 for(const row of intervals){
  const label=day.format(new Date(row.startedAt)),previous=groups.at(-1);
  if(previous?.label===label)previous.rows.push(row);
  else groups.push({label,rows:[row]});
 }
 return <section className="home-panel work-time-ledger" aria-label="Saved intervals">
  <h2>Saved intervals ({intervals.length})</h2>
  {groups.map(group=><section key={group.rows[0]!.intervalId} className="work-time-day">
   <h3>{group.label}</h3>
   <ol className="work-time-rows">
    {group.rows.map(row=>{
     const boundary=transitions.get(row.versionId);
     const elapsed=scheduleInstantMicroseconds(row.endedAt??record.observedAt)-scheduleInstantMicroseconds(row.startedAt);
     const sameDay=row.endedAt&&day.format(new Date(row.endedAt))===group.label;
     return <li className="work-time-interval" key={row.versionId} data-kind={row.kind}>
      <div className="work-time-interval-head">
       <h4>{row.kind==='active'?'Active work':'Pause'}</h4>
       <strong>{duration(elapsed.toString())}{row.endedAt===null&&<small>At last read</small>}</strong>
      </div>
      <dl className="work-time-interval-times">
       <div><dt>Start</dt><dd><time dateTime={row.startedAt}>{clock.format(new Date(row.startedAt))}</time></dd></div>
       <div><dt>End</dt><dd>{row.endedAt?<time dateTime={row.endedAt}>{sameDay?clock.format(new Date(row.endedAt)):when(row.endedAt)}</time>:'Still open'}</dd></div>
      </dl>
      {row.pauseReason&&<p className="work-time-reason">{row.pauseReason}</p>}
      {row.recordReason&&<p className="work-time-reason"><span>Record note</span>{row.recordReason}</p>}
      <WorkIntervalHistory data={data} current={row} timezone={timezone} when={when}/>
      {workspace&&start?.workVersionId===row.versionId&&<WorkStartForm start={start} observedAt={record.observedAt} workspace={workspace} when={when} save={save} draftChanged={draftChanged}/>}
      {workspace&&boundary&&<WorkBoundaryForm data={data} boundary={boundary} workspace={workspace} when={when} save={save} draftChanged={draftChanged}/>}
      {workspace&&end?.workVersionId===row.versionId&&<WorkEndForm end={end} observedAt={record.observedAt} workspace={workspace} when={when} save={save} draftChanged={draftChanged}/>}
     </li>;
    })}
   </ol>
  </section>)}
 </section>;
}

function CorrectionForm({summary,savedAt,originalAt,description,impact,timeLabel,reasonLabel,saveLabel,workspace,when,build,save,draftChanged}:{
 summary:string;savedAt:string;originalAt?:string;description:ReactNode;impact?:string;timeLabel:string;reasonLabel:string;saveLabel:string;
 workspace:Workspace;when:WorkClock;build:(correctedAt:string,reason:string)=>Correction;save:SaveCorrection;draftChanged:DraftChanged;
}){
 const id=useId(),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 const [proposal,setProposal]=useState<Correction|null>(null);
 const reviewFocus=useRef<'review'|'form'|null>(null);
 const reviewHeading=useRef<HTMLHeadingElement>(null),reviewButton=useRef<HTMLButtonElement>(null);

 useLayoutEffect(()=>{
  if(reviewFocus.current==='review'&&proposal)reviewHeading.current?.focus();
  if(reviewFocus.current==='form'&&!proposal)reviewButton.current?.focus();
  reviewFocus.current=null;
 },[proposal]);
 useEffect(()=>()=>draftChanged(id,false),[draftChanged,id]);
 return <details className="work-time-correction">
  <summary>{summary}</summary>
  <form onChange={()=>draftChanged(id,true)} onSubmit={event=>{
   event.preventDefault();
   if(proposal)return;
   const reason=String(new FormData(event.currentTarget).get('reason')??'');
   try{
    const next=build(correctedAt,reason);reviewFocus.current='review';setProposal(next);setIssue('');
   }catch{setIssue('Enter a different time within the saved limits and give a reason.');}
  }}>
   <div className="work-time-correction-fields" hidden={proposal!==null}>
    <p>Saved time <time dateTime={savedAt}>{when(savedAt)}</time>.</p>
    {originalAt&&originalAt!==savedAt&&<p>First recorded as <time dateTime={originalAt}>{when(originalAt)}</time>.</p>}
    <div className="work-time-correction-help">{description}</div>
    <BookingInstantInput label={timeLabel} value={correctedAt} zone={workspace.context.timezone} change={setCorrectedAt} seconds/>
    <label htmlFor={id+'-reason'}>{reasonLabel}</label>
    <textarea name="reason" id={id+'-reason'} rows={2} maxLength={1000} required/>
    {issue&&<p role="alert">{issue}</p>}
    <button ref={reviewButton} type="submit">Review correction</button>
   </div>
   {proposal&&<section aria-label="Work-time correction review" className="work-time-correction-review">
    <h5 ref={reviewHeading} tabIndex={-1}>Review correction</h5>
    <dl className="work-time-comparison">
     <div><dt>Saved</dt><dd><time dateTime={savedAt}>{when(savedAt)}</time><small>{savedAt}</small></dd></div>
     <div><dt>Proposed</dt><dd><time dateTime={proposal.body.correctedAt}>{when(proposal.body.correctedAt)}</time><small>{proposal.body.correctedAt}</small></dd></div>
    </dl>
    <p className="work-time-reason"><span>Reason</span>{proposal.body.reason}</p>
    {impact&&<p className="field-help">{impact}</p>}
    <div className="work-time-actions">
     <button type="button" onClick={()=>save(proposal,workspace,id)}>{saveLabel}</button>
     <button type="button" className="secondary" onClick={()=>{
      reviewFocus.current='form';setProposal(null);
     }}>Back to correction</button>
    </div>
   </section>}
  </form>
 </details>;
}

function WorkEndForm({end,observedAt,workspace,when,save,draftChanged}:{end:LoadedWorkEnd;observedAt:string;workspace:Workspace;when:WorkClock;save:SaveCorrection;draftChanged:DraftChanged}){
 return <CorrectionForm summary="Correct the completion time" savedAt={end.completedAt} originalAt={end.originalCompletedAt}
  description={<p>The final {end.finalIntervalKind==='active'?'work interval':'pause'} began at <time dateTime={end.finalIntervalStartedAt}>{when(end.finalIntervalStartedAt)}</time>. Crest retains the original completion in history.</p>}
  impact="The job stays completed. The prior completion time is kept in history."
  timeLabel="Corrected completion time" reasonLabel="Completion correction reason" saveLabel="Save completion correction"
  workspace={workspace} when={when} save={save} draftChanged={draftChanged} build={(correctedAt,reason)=>{
   if(!correctedAt||correctedAt===end.completedAt||correctedAt<end.finalIntervalStartedAt||correctedAt>observedAt)throw Error();
   return parseWorkEndSave({schemaVersion:1,businessId:end.businessId,operationId:crypto.randomUUID(),
    recoveryEpoch:workspace.context.recoveryEpoch,jobId:end.jobId,expectedJobVersion:end.jobVersion,
    workVersionId:end.workVersionId,completionEventId:end.completionEventId,body:{correctedAt,reason}});
  }}/>;
}

function WorkStartForm({start,observedAt,workspace,when,save,draftChanged}:{start:LoadedWorkStart;observedAt:string;workspace:Workspace;when:WorkClock;save:SaveCorrection;draftChanged:DraftChanged}){
 return <CorrectionForm summary="Correct the first work start" savedAt={start.startedAt} originalAt={start.originalStartedAt}
  description={<>
   {start.arrival&&<p>This also changes the linked arrival. The trip keeps its departure at <time dateTime={start.arrival.departedAt}>{when(start.arrival.departedAt)}</time>.</p>}
   {start.workEndedAt&&<p>The first active interval ends at <time dateTime={start.workEndedAt}>{when(start.workEndedAt)}</time>.</p>}
  </>}
  impact={start.arrival?'The linked arrival moves to this time as well.':''}
  timeLabel="Corrected first start" reasonLabel="First-start correction reason" saveLabel="Save first-start correction"
  workspace={workspace} when={when} save={save} draftChanged={draftChanged} build={(correctedAt,reason)=>{
   if(!correctedAt||correctedAt===start.startedAt||correctedAt>(start.workEndedAt??observedAt)||
    (start.arrival&&correctedAt<start.arrival.departedAt))throw Error();
   return parseWorkStartSave({schemaVersion:1,businessId:start.businessId,operationId:crypto.randomUUID(),
    recoveryEpoch:workspace.context.recoveryEpoch,jobId:start.jobId,expectedJobVersion:start.jobVersion,
    workVersionId:start.workVersionId,arrivalVersionId:start.arrival?.versionId??null,body:{correctedAt,reason}});
  }}/>;
}

function WorkBoundaryForm({data,boundary,workspace,when,save,draftChanged}:{
 data:LoadedJobWorkTime;boundary:ReturnType<typeof workBoundaries>[number];workspace:Workspace;when:WorkClock;save:SaveCorrection;draftChanged:DraftChanged;
}){
 return <CorrectionForm summary={boundary.action==='Pause'?'Correct this pause time':'Correct this resume time'} savedAt={boundary.at}
  description={<p>Choose a time after <time dateTime={boundary.after}>{when(boundary.after)}</time> and before <time dateTime={boundary.before}>{when(boundary.before)}</time>. Crest retains both original intervals in history.</p>}
  impact={boundary.action==='Pause'?'This moves the end of work and the start of the pause.':'This moves the end of the pause and the start of work.'}
  timeLabel="Corrected local time" reasonLabel="Correction reason" saveLabel="Save work-time correction"
  workspace={workspace} when={when} save={save} draftChanged={draftChanged} build={(correctedAt,reason)=>{
   if(correctedAt<=boundary.after||correctedAt>=boundary.before||correctedAt===boundary.at)throw Error();
   return parseWorkBoundarySave({schemaVersion:1,businessId:data.record.businessId,operationId:crypto.randomUUID(),
    recoveryEpoch:workspace.context.recoveryEpoch,jobId:data.record.jobId,expectedJobVersion:data.record.jobVersion,
    leftVersionId:boundary.leftVersionId,rightVersionId:boundary.rightVersionId,body:{correctedAt,reason}});
  }}/>;
}
