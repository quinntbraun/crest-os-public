'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../../../client/authentication';
import {scheduling} from '../../../../client/scheduling';
import {formatJobWorkTimeCsv} from '../../../../operations/job-work-time-export';
import type {LoadedJobWorkTime} from '../../../../operations/job-work-time-contract';

type Format='csv'|'json';
type State={phase:'loading'|'unavailable'|'signed-out';message:string}|
 {phase:'ready';message:string;data:LoadedJobWorkTime;timezone:string};
const initial:State={phase:'loading',message:'Checking access to recorded work time…'};
function duration(microseconds:string){
 const seconds=BigInt(microseconds)/1000000n;
 const hours=seconds/3600n,minutes=(seconds/60n)%60n;
 return [hours?hours+'h':'',hours||minutes?minutes+'m':'',seconds%60n+'s'].filter(Boolean).join(' ');
}

export function WorkTimeScreen({jobId}:{jobId:string}){
 const [state,setState]=useState<State>(initial),refresh=useRef<((format?:Format)=>Promise<void>)|null>(null);
 useEffect(()=>{
  let active:AbortController|null=null,downloadUrl:string|null=null;
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
  async function load(format?:Format){
   if(active)return;
   if(!jobId){setState({phase:'unavailable',message:'Open a saved Mobile job from Schedule.'});return;}
   const request=active=new AbortController(),signal=request.signal;
   setState(initial);
   try{
    const proof=await authentication.session(signal),workspace=await scheduling.workspace(proof,signal);
    signal.throwIfAborted();
    if(!workspace.workTimeAvailable){setState({phase:'unavailable',message:'Recorded work time is unavailable in this build.'});return;}
    const data=await scheduling.jobWorkTime(workspace.context.businessId,jobId,proof,signal);
    signal.throwIfAborted();
    if('state'in data){setState({phase:'unavailable',message:'This job’s work time is unavailable in the current workspace.'});return;}
    let message='Saved work time loaded.';
    if(format){
     try{download(data,format);message='Download requested. Check your browser’s downloads.';}
     catch{message='The download could not be prepared. Try again.';}
    }
    setState({phase:'ready',message,data,timezone:workspace.context.timezone});
   }catch(error){
    if(!signal.aborted){
     const denied=error instanceof AuthenticationError&&error.kind==='denied';
     setState({phase:denied?'signed-out':'unavailable',message:denied?'Sign in to view work time.':'Work time could not be verified. Check your connection and try again.'});
    }
   }finally{if(active===request)active=null;}
  }
  refresh.current=load;
  void load();
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   active?.abort();refresh.current=null;revoke();
   document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[jobId]);
 const format=state.phase==='ready'?new Intl.DateTimeFormat('en-US',{timeZone:state.timezone,dateStyle:'medium',timeStyle:'medium'}):null;
 const when=(value:string)=>format!.format(new Date(value));
 return <section aria-label="Saved work time" aria-busy={state.phase==='loading'} className="field-work-form">
  <p role="status">{state.message}</p>
  {state.phase==='signed-out'&&<a href="/sign-in">Sign in to view work time</a>}
  {state.phase==='unavailable'&&jobId&&<button type="button" className="secondary work-time-refresh" onClick={()=>void refresh.current?.()}>Refresh totals</button>}
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
    <div className="work-time-downloads">
     <button type="button" className="secondary" onClick={()=>void refresh.current?.('csv')}>Download CSV</button>
     <button type="button" className="secondary" onClick={()=>void refresh.current?.('json')}>Download JSON</button>
    </div>
   </>;
  })()}
  <nav aria-label="Work time navigation"><a href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>Saved job and history</a><a href="/schedule">Schedule</a></nav>
 </section>;
}
