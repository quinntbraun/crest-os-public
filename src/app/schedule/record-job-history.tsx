'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {postScheduling,SchedulingClientError} from '../../client/scheduling-transport';
import {parseRecordJobHistoryPage,parseRecordJobHistoryRequest} from '../../operations/record-job-history-contract';

type Job=ReturnType<typeof parseRecordJobHistoryPage>['jobs'][number];
type View={phase:'idle'|'loading'|'ready'|'failed'|'limited';jobs:readonly Job[];hasMore:boolean;focusJob:string|null};
const initial:View={phase:'idle',jobs:[],hasMore:false,focusJob:null};
const states={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const modes={mobile:'Mobile detail',dropoff:'Drop-off',pickup_return:'Pickup and return'};

function visitTime(row:Job){
  return new Intl.DateTimeFormat('en-US',{
    timeZone:row.timezone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',
  }).format(new Date(row.startAt));
}

function jobHref(row:Job,kind:'customer'|'vehicle'){
  const query=new URLSearchParams({job:row.jobId});
  if(row.jobVehicleId)query.set('vehicle',row.jobVehicleId);
  query.set('from',kind);
  return '/schedule?'+query;
}

export function RecordJobHistory({businessId,recordId,kind,initiallyOpen=false}:{businessId:string;recordId:string;kind:'customer'|'vehicle';initiallyOpen?:boolean}){
  const id=useId(),active=useRef<AbortController|null>(null),details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    if(!initiallyOpen||!details.current)return;
    details.current.open=true;
    details.current.querySelector('summary')?.focus();
  },[initiallyOpen]);
  const [view,setView]=useState(initial);
  useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
  useEffect(()=>{if(view.focusJob)document.getElementById(id+'-'+view.focusJob)?.focus();},[id,view.focusJob]);

  async function load(mode:'first'|'retry'|'older'='first'){
    const append=mode==='older'||mode==='retry'&&view.jobs.length>0;
    if(active.current||append&&!view.hasMore)return;
    const previous=append?view.jobs:[],last=previous.at(-1);
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
    const request=parseRecordJobHistoryRequest({
      kind,recordId,afterRecordedAt:last?.recordedAt??null,afterEntryId:last?.jobVehicleId??last?.jobId??null,pageSize:10,
    });
    active.current=controller;
    setView({...view,phase:'loading',focusJob:null});
    try{
      const proof=await authentication.session(signal);
      const response=await postScheduling('record-jobs',request,proof,signal);
      if(response.status!==200)throw Error();
      const page=parseRecordJobHistoryPage(response.value,businessId,request);
      signal.throwIfAborted();
      if(active.current!==controller)return;
      const known=new Set(previous.map(job=>job.jobId));
      if(page.jobs.some(job=>known.has(job.jobId)))throw Error();
      setView({phase:'ready',jobs:[...previous,...page.jobs],hasMore:page.hasMore,focusJob:mode==='first'?null:page.jobs[0]?.jobId??'summary'});
    }catch(error){
      if(!controller.signal.aborted&&active.current===controller){
        const phase=error instanceof SchedulingClientError&&error.kind==='limited'?'limited':'failed';
        setView({...view,phase,focusJob:null});
      }
    }finally{
      if(active.current===controller)active.current=null;
    }
  }

  return <details ref={details} className="record-job-history" onToggle={event=>{
    if(event.currentTarget.open&&view.phase==='idle')void load();
    if(!event.currentTarget.open&&active.current){
      active.current.abort();
      active.current=null;
      setView(previous=>({...previous,phase:previous.jobs.length?'ready':'idle',focusJob:null}));
    }
  }}>
    <summary id={id+'-summary'}>Saved visits</summary>
    {view.phase==='loading'&&<p role="status">Loading saved visits…</p>}
    {view.phase==='failed'&&<p role="status">Saved visits couldn’t be loaded.</p>}
    {view.phase==='limited'&&<p role="status">Saved visits are temporarily limited. Wait a minute before trying again.</p>}
    {view.phase==='ready'&&view.jobs.length===0&&<p role="status">No saved visits for this record.</p>}
    {view.jobs.length>0&&<>
      <p className="field-help">Most recently booked first.</p>
      <ul className="record-job-list">{view.jobs.map(row=>{
        const time=visitTime(row),label=row.customerName??row.vehicleLabels.join(' · ');
        return <li key={row.jobId}>
          <div><time dateTime={row.startAt}>{time}</time><strong>{label}</strong><span>{states[row.state]} · {modes[row.fulfillmentMode]}</span></div>
          <a id={id+'-'+row.jobId} href={jobHref(row,kind)} aria-label={'Open saved job for '+label+' on '+time}>Open saved job</a>
        </li>;
      })}</ul>
    </>}
    {view.phase==='failed'||view.phase==='limited'?<button type="button" className="secondary" onClick={()=>void load('retry')}>Retry saved visits</button>:
      view.hasMore&&<button type="button" className="secondary" onClick={()=>void load('older')} disabled={view.phase==='loading'}>Load older visits</button>}
  </details>;
}
