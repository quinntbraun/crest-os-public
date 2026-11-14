'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../client/authentication';
import {businessSettings} from '../client/business-settings';
import {leads} from '../client/leads';
import {appointmentHolds} from '../client/appointment-holds';
import {readHomeSchedule} from '../client/home-schedule';
import type {HomeSchedule} from '../client/home-schedule';

type HoldPage=Awaited<ReturnType<typeof appointmentHolds.list>>;
type LeadPage=Awaited<ReturnType<typeof leads.list>>;
type View={phase:'checking'|'signed-out'|'unavailable'|'ready';name:string;paused:boolean;followUps:LeadPage|null;proposals:HoldPage|null;schedule:HomeSchedule|null;message:string;checkedAt:number|null};
const initial:View={phase:'checking',name:'',paused:false,followUps:null,proposals:null,schedule:null,message:'Checking workspace access…',checkedAt:null};
async function snapshot(signal:AbortSignal):Promise<View>{
  try{
    const proof=await authentication.session(signal),loaded=await businessSettings.settings(proof,signal),{context}=loaded;
    let followUps:LeadPage|null=null;
    try{followUps=await leads.list(context.businessId,{search:'',afterId:null,includeLost:true,pageSize:50},proof,signal);}catch{/* Unavailable is not empty. */}
    let proposals:HoldPage|null=null;
    try{proposals=await appointmentHolds.list(context.businessId,{afterId:null,pageSize:5},proof,signal);}catch{/* Unavailable is not an empty schedule. */}
    let schedule:HomeSchedule|null=null;
    try{schedule=await readHomeSchedule(context,proof,signal);}catch{/* Unavailable is not an empty calendar. */}
    const latestProof=await authentication.session(signal),latest=await businessSettings.settings(latestProof,signal);
    if(signal.aborted||loaded.binding!==latest.binding||context.businessId!==latest.context.businessId||context.businessVersion!==latest.context.businessVersion||context.writeState!==latest.context.writeState||context.recoveryEpoch!==latest.context.recoveryEpoch)throw Error('HOME_CONTEXT_CHANGED');
    return {phase:'ready',name:context.legalName,paused:context.writeState==='paused',followUps,proposals,schedule,message:'Workspace access verified.',checkedAt:Date.now()};
  }catch(error){return {...initial,phase:error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable',message:error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to open your workspace.':'Workspace access could not be verified. Check the local services and try again.'};}
}
const visitStates={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const dateLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
const shortTime=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
const visitDate=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',month:'short',day:'numeric'}).format(new Date(value));
const when=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function WorkspaceHome(){
  const [view,setView]=useState<View>(initial),request=useRef<AbortController|null>(null);
  const load=useCallback(()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    void snapshot(controller.signal).then(next=>{if(!controller.signal.aborted)setView(next);});
  },[]);
  useEffect(()=>{
    void load();
    const hide=()=>{if(document.visibilityState==='hidden'){request.current?.abort();setView({...initial,phase:'unavailable',message:'Workspace paused while away. Refresh to check current information.'});}};
    const leave=()=>{request.current?.abort();setView(initial);};
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
    return ()=>{request.current?.abort();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
  },[load]);
  const reminders=view.followUps?.leads.filter(lead=>lead.follow_up_at!==null).sort((a,b)=>a.follow_up_at!<b.follow_up_at!?-1:a.follow_up_at!>b.follow_up_at!?1:0)??[];
  const visits=view.schedule?.visits?.jobs.filter(job=>!['cancelled','completed'].includes(job.state))??[],changes=view.schedule?.changes;
  return <main className="workspace-home" aria-busy={view.phase==='checking'}>
    <div className="today-heading">
      <div>
        <h1>Today</h1>
        {view.phase==='ready'&&<p>{view.schedule&&<><time dateTime={view.schedule.fromDate}>{dateLabel.format(new Date(view.schedule.fromDate+'T12:00:00Z'))}</time><span aria-hidden="true"> · </span></>}{view.name}</p>}
      </div>
      {view.phase==='ready'&&view.schedule&&<a className="primary-action" href="/schedule">Open schedule</a>}
    </div>
    <p className={view.phase==='ready'?'visually-hidden':'notice'} role="status" aria-live="polite">{view.message}</p>
    {view.phase==='signed-out'&&<section className="home-panel"><h2>Sign in</h2><p>Use your Crest OS account and authenticator to open your workspace.</p><a className="primary-action" href="/sign-in">Sign in to Crest OS</a></section>}
    {view.phase==='unavailable'&&<div className="notice"><p>No current business information is shown until access is confirmed.</p><a href="/sign-in">Check sign-in</a></div>}
    {view.phase==='ready'&&<>
      {view.paused&&<p className="notice">Changes are paused for recovery review. You can still review available records and history.</p>}
      <div className="today-grid">
      <section className="home-panel" aria-label="Upcoming saved visits"><div className="section-heading"><h2>Upcoming visits</h2></div>
        {view.schedule===null||view.schedule.visits===null?<p>Upcoming visits could not be verified. <a href="/schedule">Check the schedule</a>.</p>:<><p className="field-help">Confirmed appointments over the next seven days.</p>{visits.length===0?<p>{view.schedule.visits.hasMore?'No active visits on this page. Open Schedule to review remaining visits.':'No active saved visits in the next seven days.'}</p>:<ul className="today-visits">{visits.map(job=><li key={job.jobId}>
          <time dateTime={job.startAt}><strong>{shortTime(job.startAt,job.timezone)}</strong><span>{visitDate(job.startAt,job.timezone)}</span></time>
          <div><a href={'/schedule?job='+encodeURIComponent(job.jobId)} aria-label={'Review visit for '+job.customerName}>{job.customerName}</a>
            <p>{job.vehicleLabels.join(' · ')}{job.vehicleCount>job.vehicleLabels.length?' · '+(job.vehicleCount-job.vehicleLabels.length)+' more vehicles':''}</p>
            <p><strong>{visitStates[job.state]}</strong> · Until {visitDate(job.startAt,job.timezone)===visitDate(job.endAt,job.timezone)?'':visitDate(job.endAt,job.timezone)+' '}{shortTime(job.endAt,job.timezone)}{job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}{job.timezone!==view.schedule?.timezone?' · '+job.timezone:''}</p>
          </div></li>)}</ul>}{view.schedule.visits.hasMore&&<p className="field-help">More saved visits are available. Open Schedule for the remaining records.</p>}</>}
        <details className="home-changes" open={!changes||changes.items.length>0}><summary>Appointment changes to review</summary>{!changes?<p>Proposed changes could not be verified. Open Schedule to check.</p>:<>{changes.items.length===0?<p>No proposed appointment changes recorded.</p>:<ul className="follow-up-list">{changes.items.map(({head})=><li key={head.job.id}><a href={'/schedule?job='+encodeURIComponent(head.job.id)}>Review {head.confirmationDraft?.customerName??'saved job'}</a><span>Proposed: {when(head.latestAppointment.start_at,head.latestAppointment.timezone)}</span><span>Confirmed slot: {when(head.appointment.start_at,head.appointment.timezone)}</span></li>)}</ul>}{changes.hasMore&&<p>More proposed changes are available in Schedule.</p>}<p className="field-help">All dates. Proposals reserve no new time.</p></>}</details>
      </section>
      <div className="today-secondary">
      {view.schedule&&'maintenance' in view.schedule&&<section className="home-panel" aria-label="Due maintenance reminders">
        <h2>Maintenance due</h2>
        <p className="field-help">Due today or overdue in {view.schedule.timezone}.</p>
        {view.schedule.maintenance===null?<p>Saved reminders could not be verified. Refresh to try again.</p>:
          view.schedule.maintenance&&<>
            {view.schedule.maintenance.entries.length===0?<p>No maintenance reminders due.</p>:
              <ul className="follow-up-list">{view.schedule.maintenance.entries.map(({record,customerName,vehicleLabel,effectiveDueAt})=>
                <li key={record.taskId}>
                  <strong>{customerName}</strong>{vehicleLabel&&<span>{vehicleLabel}</span>}
                  <time dateTime={effectiveDueAt}>{when(effectiveDueAt,view.schedule!.timezone)}</time>
                  <span>{record.state==='snoozed'?'Snoozed until this time':'Open'}</span>
                  {record.sourceJobId&&<a href={'/schedule?job='+encodeURIComponent(record.sourceJobId)}>Open saved job</a>}
                </li>)}</ul>}
            {view.schedule.maintenance.next&&<p className="field-help">Showing the first 20 due reminders.</p>}
          </>}
      </section>}
      <section className="home-panel" aria-label="Lead follow-ups"><div className="section-heading"><h2>Lead follow-ups</h2><a href="/leads">All leads</a></div>
        {view.followUps===null?<p>Follow-ups could not be loaded. Open Leads to check.</p>:<>
          {view.followUps.hasMore&&<p className="notice">Showing reminders from the first 50 leads. Open leads to review the remaining records.</p>}
          {reminders.length===0?<p>No follow-up dates recorded{view.followUps.hasMore?' in this page of leads':''}.</p>:<ul className="follow-up-list">{reminders.map(lead=><li key={lead.id}><strong>{lead.label}</strong><span>{new Date(lead.follow_up_at!).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</span><span>{lead.state==='lost'?'Lost lead · follow-up retained':lead.state.replaceAll('_',' ')}</span></li>)}</ul>}
          {reminders.length>0&&<p className="field-help">Times use this device’s time zone.</p>}
        </>}
      </section>
      {view.proposals!==null&&<section className="home-panel" aria-label="Unconfirmed appointment proposals"><div className="section-heading"><h2>Proposed times</h2><a href="/appointment-holds">Review proposals</a></div>{view.proposals.holds.length===0?<p>No saved proposals on this page.</p>:<ul className="follow-up-list">{view.proposals.holds.map(hold=><li key={hold.id}><strong>{hold.label}</strong><span>{hold.local_start.slice(0,16).replace('T',' ')} · {hold.timezone}</span><span>{hold.state==='withdrawn'?'Withdrawn':'Unconfirmed · does not reserve time'}</span></li>)}</ul>}<p className="field-help">First page of retained proposals, including withdrawals. {view.proposals.hasMore?'More proposals are available. ':''}These are not confirmed bookings.</p><a className="primary-action" href="/appointment-holds">Propose a time</a></section>}
      </div></div>
      <nav className="home-shortcuts" aria-label="Quick actions"><a href="/customers" aria-label="Open customers">Customers</a><a href="/quotes" aria-label="Open quotes">Quotes</a><a href="/expenses" aria-label="Open expenses">Expenses</a><a href="/settings/accounts" aria-label="Open accounting">Accounting</a></nav>
      <div className="today-footer"><a href="/save-review">Review interrupted saves</a><p className="field-help">Last checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</p></div>
    </>}
    {view.phase!=='checking'&&<button type="button" className="secondary today-refresh" onClick={()=>{setView(initial);void load();}}>Refresh workspace</button>}
  </main>;
}
