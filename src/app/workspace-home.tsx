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
    <p className="eyebrow">Crest Detailing</p><h1>Today</h1>
    <p role="status" aria-live="polite">{view.message}</p>
    {view.phase==='signed-out'&&<section className="home-panel"><h2>Your day starts here</h2><p>Customers, vehicles, and lead follow-ups in one place. Use your account and authenticator to continue.</p><a className="primary-action" href="/sign-in">Sign in to Crest OS</a></section>}
    {view.phase==='unavailable'&&<div className="notice"><p>No current business information is shown until access is confirmed.</p><a href="/sign-in">Check sign-in</a></div>}
    {view.phase==='ready'&&<>
      <p className="business-name">{view.name}</p>
      {view.paused&&<p className="notice">Changes are paused for recovery review. You can still review available records and history.</p>}
      <nav className="home-shortcuts" aria-label="Quick actions"><a href="/customers">Open customers</a><a href="/quotes">Open quotes</a><a href="/schedule">Open schedule</a></nav>
      <section className="home-panel" aria-label="Upcoming saved visits"><div className="section-heading"><h2>Upcoming visits</h2><a href="/schedule">Full schedule</a></div>
        {view.schedule===null||view.schedule.visits===null?<p>Upcoming visits could not be verified. Open Schedule to check; this does not mean there are none.</p>:<><p className="field-help">Next seven business dates · {view.schedule.timezone}. Confirmed appointment times are shown.</p>{visits.length===0?<p>{view.schedule.visits.hasMore?'No active visits on this page. Open Schedule to review remaining visits.':'No active saved visits in the next seven days.'}</p>:<ul className="follow-up-list">{visits.map(job=><li key={job.jobId}><a href={'/schedule?job='+encodeURIComponent(job.jobId)} aria-label={'Review visit for '+job.customerName}>{job.customerName}</a><time dateTime={job.startAt}>{when(job.startAt,job.timezone)} – {when(job.endAt,job.timezone)} · {job.timezone}</time><span>{job.vehicleLabels.join(' · ')}{job.vehicleCount>job.vehicleLabels.length?' · '+(job.vehicleCount-job.vehicleLabels.length)+' more vehicles':''}</span><span>{({scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'})[job.state]}{job.pendingAppointment?' · Time change proposed; confirmed time shown':''}{job.unknownTravel?' · Travel needs review':''}</span></li>)}</ul>}{view.schedule.visits.hasMore&&<p className="field-help">More saved visits are available. Open Schedule for the remaining records.</p>}</>}
        <details className="home-changes" open={!changes||changes.items.length>0}><summary>Appointment changes to review</summary>{!changes?<p>Proposed changes could not be verified. Open Schedule to check.</p>:<>{changes.items.length===0?<p>No proposed appointment changes recorded.</p>:<ul className="follow-up-list">{changes.items.map(({head})=><li key={head.job.id}><a href={'/schedule?job='+encodeURIComponent(head.job.id)}>Review {head.confirmationDraft?.customerName??'saved job'}</a><span>Proposed: {when(head.latestAppointment.start_at,head.latestAppointment.timezone)}</span><span>Confirmed slot: {when(head.appointment.start_at,head.appointment.timezone)}</span></li>)}</ul>}{changes.hasMore&&<p>More proposed changes are available in Schedule.</p>}<p className="field-help">All dates. Proposals reserve no new time.</p></>}</details>
      </section>
      <section className="home-panel" aria-label="Lead follow-ups"><div className="section-heading"><h2>Follow-ups</h2><a href="/leads">All leads</a></div>
        {view.followUps===null?<p>Follow-ups could not be loaded. Open leads to check; this does not mean there are none.</p>:<>
          {view.followUps.hasMore&&<p className="notice">Showing reminders from the first 50 leads. Open leads to review the remaining records.</p>}
          {reminders.length===0?<p>No follow-up dates recorded{view.followUps.hasMore?' in this page of leads':''}.</p>:<ul className="follow-up-list">{reminders.map(lead=><li key={lead.id}><strong>{lead.label}</strong><span>{new Date(lead.follow_up_at!).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</span><span>{lead.state==='lost'?'Lost lead · follow-up retained':lead.state.replaceAll('_',' ')}</span></li>)}</ul>}
          <p className="field-help">Recorded lead reminders, including lost leads. These are not booked jobs. Times use this device’s timezone.</p>
        </>}
      </section>
      {view.proposals!==null&&<section className="home-panel" aria-label="Unconfirmed appointment proposals"><div className="section-heading"><h2>Proposed times</h2><a href="/appointment-holds">Review proposals</a></div>{view.proposals.holds.length===0?<p>No saved proposals on this page.</p>:<ul className="follow-up-list">{view.proposals.holds.map(hold=><li key={hold.id}><strong>{hold.label}</strong><span>{hold.local_start.slice(0,16).replace('T',' ')} · {hold.timezone}</span><span>{hold.state==='withdrawn'?'Withdrawn':'Unconfirmed · does not reserve time'}</span></li>)}</ul>}<p className="field-help">First page of retained proposals, including withdrawals. {view.proposals.hasMore?'More proposals are available. ':''}These are not confirmed bookings.</p><a className="primary-action" href="/appointment-holds">Propose a time</a></section>}
      <p><a href="/save-review">Review interrupted saves</a></p>
      <aside className="capability-note"><h2>Still being built</h2><p>Combined-agreement and additional-vehicle scheduling, field work, photos, invoices, payments, full accounting and reporting, complete business exports, and Google Calendar are not available in this workspace yet. Paid-expense recording is available from Workspace → Expenses; receipt attachment remains unfinished.</p></aside>
      <p className="field-help">Checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleTimeString()}. Refresh for current information.</p>
    </>}
    {view.phase!=='checking'&&<button type="button" className="secondary" onClick={()=>{setView(initial);void load();}}>Refresh workspace</button>}
    <p className="field-help">Synthetic testing only. This build is not approved for real Crest records.</p>
  </main>;
}
