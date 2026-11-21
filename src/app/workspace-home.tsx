'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../client/authentication';
import {businessSettings} from '../client/business-settings';
import {leads} from '../client/leads';
import {appointmentHolds} from '../client/appointment-holds';
import {readHomeSchedule} from '../client/home-schedule';
import type {HomeSchedule} from '../client/home-schedule';
import type {LeadFollowUp,LeadFollowUpQuery} from '../customer/lead-follow-up-contract';
import type {Settings} from '../client/business-settings';

type HoldPage=Awaited<ReturnType<typeof appointmentHolds.list>>;
type LeadPage=NonNullable<Awaited<ReturnType<typeof leads.followUps>>>;
type FollowUps=Readonly<{kind:'indexed'|'legacy';items:readonly LeadFollowUp[];hasMore:boolean;observedAt:string|null}>;
const firstFollowUps:LeadFollowUpQuery={afterAt:null,afterId:null,pageSize:8};
const indexed=(page:LeadPage):FollowUps=>({kind:'indexed',items:page.followUps,hasMore:page.hasMore,observedAt:page.observedAt});
const sameSettings=(a:Settings,b:Settings)=>a.businessId===b.businessId&&a.businessVersion===b.businessVersion&&a.writeState===b.writeState&&a.recoveryEpoch===b.recoveryEpoch;
type View={phase:'checking'|'signed-out'|'unavailable'|'ready';name:string;paused:boolean;followUps:FollowUps|null;firstOverdueLead:LeadFollowUp|null;identity:{context:Settings;binding:string}|null;proposals:HoldPage|null;schedule:HomeSchedule|null;message:string;checkedAt:number|null};
const initial:View={phase:'checking',name:'',paused:false,followUps:null,firstOverdueLead:null,identity:null,proposals:null,schedule:null,message:'Checking workspace access…',checkedAt:null};
async function snapshot(signal:AbortSignal):Promise<View>{
  try{
    const proof=await authentication.session(signal),loaded=await businessSettings.settings(proof,signal),{context}=loaded;
    let followUps:FollowUps|null=null;
    try{
      const page=await leads.followUps(context.businessId,firstFollowUps,proof,signal);
      if(page)followUps=indexed(page);
      else{
        const legacy=await leads.list(context.businessId,{search:'',afterId:null,includeLost:true,pageSize:50},proof,signal);
        const items=legacy.leads.flatMap(lead=>lead.follow_up_at===null?[]:[{id:lead.id,label:lead.label,state:lead.state,followUpAt:lead.follow_up_at}]);
        items.sort((a,b)=>a.followUpAt<b.followUpAt?-1:a.followUpAt>b.followUpAt?1:0);
        followUps={kind:'legacy',items,hasMore:legacy.hasMore,observedAt:null};
      }
    }catch{/* Unavailable is not empty. */}
    let proposals:HoldPage|null=null;
    try{proposals=await appointmentHolds.list(context.businessId,{afterId:null,pageSize:5},proof,signal);}catch{/* Unavailable is not an empty schedule. */}
    let schedule:HomeSchedule|null=null;
    try{schedule=await readHomeSchedule(context,proof,signal);}catch{/* Unavailable is not an empty calendar. */}
    const latestProof=await authentication.session(signal),latest=await businessSettings.settings(latestProof,signal);
    if(signal.aborted||loaded.binding!==latest.binding||!sameSettings(context,latest.context))throw Error('HOME_CONTEXT_CHANGED');
    const observedAt=followUps?.observedAt;
    const firstOverdueLead=observedAt?followUps?.items.find(lead=>lead.followUpAt<=observedAt)??null:null;
    return {phase:'ready',name:context.legalName,paused:context.writeState==='paused',followUps,firstOverdueLead,identity:{context,binding:loaded.binding},proposals,schedule,message:'Workspace access verified.',checkedAt:Date.now()};
  }catch(error){return {...initial,phase:error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable',message:error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to open your workspace.':'Workspace access could not be verified. Check the local services and try again.'};}
}
const visitStates={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const dateLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
const shortTime=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
const visitDate=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',month:'short',day:'numeric'}).format(new Date(value));
const when=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
type Visit=NonNullable<HomeSchedule['visits']>['jobs'][number];
const jobHref=(id:string)=>'/schedule?job='+encodeURIComponent(id)+'&from=today';
function VisitDetails({job,businessTimezone}:{job:Visit;businessTimezone:string|undefined}){
  const startDay=visitDate(job.startAt,job.timezone),endDay=visitDate(job.endAt,job.timezone);
  const additionalVehicles=job.vehicleCount-job.vehicleLabels.length;
  return <>
    <p>{job.vehicleLabels.join(' · ')}{additionalVehicles>0?' · '+additionalVehicles+' more vehicles':''}</p>
    <p>{visitStates[job.state]} · Until {startDay===endDay?'':endDay+' '}{shortTime(job.endAt,job.timezone)}
      {job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}{job.timezone!==businessTimezone?' · '+job.timezone:''}</p>
  </>;
}
export function WorkspaceHome(){
  const [view,setView]=useState<View>(initial),request=useRef<AbortController|null>(null),followUpRequest=useRef<AbortController|null>(null);
  const [followUpLoading,setFollowUpLoading]=useState(false),[laterFollowUps,setLaterFollowUps]=useState(false);
  const followUpHeading=useRef<HTMLHeadingElement>(null);
  const load=useCallback(()=>{
    followUpRequest.current?.abort();followUpRequest.current=null;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    void snapshot(controller.signal).then(next=>{
      if(!controller.signal.aborted){setView(next);setFollowUpLoading(false);setLaterFollowUps(false);}
    });
  },[]);
  useEffect(()=>{
    void load();
    const hide=()=>{if(document.visibilityState==='hidden'){request.current?.abort();followUpRequest.current?.abort();setView({...initial,phase:'unavailable',message:'Workspace paused while away. Refresh to check current information.'});}};
    const leave=()=>{request.current?.abort();followUpRequest.current?.abort();setView(initial);};
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
    return ()=>{request.current?.abort();followUpRequest.current?.abort();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
  },[load]);
  const reminders=view.followUps?.items??[];
  async function changeFollowUps(first:boolean){
    const pinned=view.identity,current=view.followUps,last=current?.items.at(-1);
    if(!pinned||current?.kind!=='indexed'||followUpRequest.current||(!first&&(!current.hasMore||!last)))return;
    const query:LeadFollowUpQuery=first?firstFollowUps:{...firstFollowUps,afterAt:last!.followUpAt,afterId:last!.id};
    const controller=new AbortController();followUpRequest.current=controller;setFollowUpLoading(true);
    const signal=controller.signal;
    const verify=async()=>{
      const proof=await authentication.session(signal),loaded=await businessSettings.settings(proof,signal);
      if(loaded.binding!==pinned.binding||!sameSettings(loaded.context,pinned.context))throw Error('HOME_CONTEXT_CHANGED');
      return proof;
    };
    try{
      const proof=await verify(),page=await leads.followUps(pinned.context.businessId,query,proof,signal);
      if(!page)throw Error('HOME_FOLLOW_UPS_UNAVAILABLE');
      await verify();signal.throwIfAborted();
      setView(previous=>previous===view?{...previous,followUps:indexed(page)}:previous);
      setLaterFollowUps(!first);
      followUpHeading.current?.focus();
    }catch{
      if(!signal.aborted)setView(previous=>previous===view?{...initial,phase:'unavailable',message:'Workspace access could not be verified. Refresh to check current information.'}:previous);
    }finally{
      if(followUpRequest.current===controller){followUpRequest.current=null;setFollowUpLoading(false);}
    }
  }
  const visits=view.schedule?.visits?.jobs.filter(job=>!['cancelled','completed'].includes(job.state))??[],changes=view.schedule?.changes;
  const activeVisit=visits.find(job=>job.state!=='scheduled');
  const upcomingVisit=visits.find(job=>Date.parse(job.endAt)>=(view.checkedAt??0));
  const nextVisit=activeVisit??upcomingVisit??visits[0];
  const visitHighlight=activeVisit?'Active visit':upcomingVisit?'Next confirmed visit':'Visit needs review';
  const otherVisits=visits.filter(job=>job.jobId!==nextVisit?.jobId);
  const clearSchedule=!nextVisit&&view.schedule?.visits?.hasMore===false;
  const maintenance=view.schedule?.maintenance?.entries??[];
  const firstMaintenance=clearSchedule?maintenance[0]:undefined;
  const earliestLead=clearSchedule?view.firstOverdueLead:null;
  const featureMaintenance=firstMaintenance&&(!earliestLead||firstMaintenance.effectiveDueAt<=earliestLead.followUpAt)?firstMaintenance:null;
  const featureLead=featureMaintenance?null:earliestLead;
  const featuredReminder=featureMaintenance??featureLead;
  const otherMaintenance=featureMaintenance?maintenance.slice(1):maintenance;
  const otherReminders=featureLead?reminders.filter(lead=>lead.id!==featureLead.id):reminders;
  const reminderTime=featureMaintenance?.effectiveDueAt??featureLead?.followUpAt;
  const maintenanceHref=featureMaintenance?.record.sourceJobId?jobHref(featureMaintenance.record.sourceJobId):
    featureMaintenance?'/customers?customer='+encodeURIComponent(featureMaintenance.record.customerId):null;
  const checking=view.phase==='checking';
  return <main className="workspace-home" aria-busy={checking}>
    <div className="today-heading">
      <div>
        <p className="today-business">{view.phase==='ready'?view.name:'Crest Detailing'}</p>
        <h1>Today</h1>
        {view.phase==='ready'&&view.schedule&&<p><time dateTime={view.schedule.fromDate}>{dateLabel.format(new Date(view.schedule.fromDate+'T12:00:00Z'))}</time></p>}
      </div>
    </div>
    <p className={view.phase==='ready'||checking?'visually-hidden':'notice'} role="status" aria-live="polite">{view.message}</p>
    {view.phase==='signed-out'&&<section className="home-panel"><h2>Sign in</h2><p>Use your Crest OS account and authenticator to open your workspace.</p><a className="primary-action" href="/sign-in">Sign in to Crest OS</a></section>}
    {view.phase==='unavailable'&&<div className="notice"><p>No current business information is shown until access is confirmed.</p><a href="/sign-in">Check sign-in</a></div>}
    {checking&&<div className="today-loading" aria-hidden="true">
      <div className="today-loading-body"><span className="workspace-skeleton"/><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div>
      <div className="today-grid"><div className="today-loading-body"><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div><div className="today-loading-body"><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div></div>
    </div>}
    {view.phase==='ready'&&<div className="today-content">
      {view.paused&&<p className="notice">Changes are paused for recovery review. You can still review available records and history.</p>}
      <div className="today-grid">
      <div className="today-primary">
      <section className="today-visit-feature" aria-label={nextVisit?visitHighlight:featuredReminder?'Next due item':'Upcoming visit status'}>
        {nextVisit?<div className="today-feature-content">
          <div>
            <p className="today-feature-label">{visitHighlight}</p>
            <h2>{nextVisit.customerName}</h2>
            <p className="today-feature-time"><time dateTime={nextVisit.startAt}>{visitDate(nextVisit.startAt,nextVisit.timezone)} · {shortTime(nextVisit.startAt,nextVisit.timezone)}</time></p>
            <VisitDetails job={nextVisit} businessTimezone={view.schedule?.timezone}/>
          </div>
          <a className="primary-action" href={jobHref(nextVisit.jobId)} aria-label={'Open visit for '+nextVisit.customerName}>Open visit <span aria-hidden="true">→</span></a>
        </div>:featuredReminder&&reminderTime&&view.schedule?<div className="today-feature-content">
          <div>
            <p className="today-feature-label">{featureMaintenance?'Maintenance due':'Overdue follow-up'}</p>
            <h2>{featureMaintenance?.customerName??featureLead?.label}</h2>
            <p className="today-feature-time"><time dateTime={reminderTime}>{when(reminderTime,view.schedule.timezone)}</time></p>
            {featureMaintenance?.vehicleLabel&&<p>{featureMaintenance.vehicleLabel}</p>}
            {featureLead?.state==='lost'&&<p>Lost lead</p>}
          </div>
          <div className="today-feature-actions">
            {featureMaintenance&&maintenanceHref&&<a className="primary-action" href={maintenanceHref}>{featureMaintenance.record.sourceJobId?'Open saved job':'Open customer'}</a>}
            {featureLead&&<a className="primary-action" href={'/leads?lead='+encodeURIComponent(featureLead.id)}>Open follow-up</a>}
            <a className="today-queue-link" href="/schedule">Open schedule</a>
          </div>
        </div>:<div className="today-feature-content">
          <div><h2>Upcoming visits</h2><p>{!view.schedule?.visits?'Upcoming visits could not be verified.':view.schedule.visits.hasMore?'No active visits in the loaded results.':'No active saved visits in the next seven days.'}</p></div>
          <a className="primary-action" href="/schedule">Open schedule <span aria-hidden="true">→</span></a>
        </div>}
      </section>
      <section className="home-panel" aria-label="Schedule review"><div className="section-heading"><h2>{nextVisit?'Seven-day agenda':'Schedule review'}</h2>{nextVisit&&<a className="today-queue-link" href="/schedule">Open schedule</a>}</div>
        {featuredReminder&&<p className="field-help">No active saved visits in the next seven days.</p>}
        {nextVisit&&otherVisits.length===0&&<p className="field-help">No other active visits in the loaded schedule.</p>}
        {otherVisits.length>0&&<ul className="today-visits">{otherVisits.map(job=><li key={job.jobId}>
          <time dateTime={job.startAt}><strong>{shortTime(job.startAt,job.timezone)}</strong><span>{visitDate(job.startAt,job.timezone)}</span></time>
          <div><a href={jobHref(job.jobId)}>{job.customerName}</a><VisitDetails job={job} businessTimezone={view.schedule?.timezone}/></div></li>)}</ul>}
        {view.schedule?.visits?.hasMore&&<p className="field-help">Open Schedule to review the remaining saved visits.</p>}
        <details className="home-changes" open={!changes||changes.items.length>0}><summary>Appointment changes to review</summary>{!changes?<p>Proposed changes could not be verified. Open Schedule to check.</p>:<>{changes.items.length===0?<p>No proposed appointment changes recorded.</p>:<ul className="follow-up-list">{changes.items.map(({head})=><li key={head.job.id}><a href={'/schedule?job='+encodeURIComponent(head.job.id)}>Review {head.confirmationDraft?.customerName??'saved job'}</a><span>Proposed: {when(head.latestAppointment.start_at,head.latestAppointment.timezone)}</span><span>Confirmed slot: {when(head.appointment.start_at,head.appointment.timezone)}</span></li>)}</ul>}{changes.hasMore&&<p>More proposed changes are available in Schedule.</p>}<p className="field-help">All dates. Proposals reserve no new time.</p></>}</details>
      </section>
      </div>
      <div className="today-secondary">
      {view.schedule&&'maintenance' in view.schedule&&<section className="home-panel" data-queue-state={view.schedule.maintenance===null?'unknown':otherMaintenance.length===0&&!view.schedule.maintenance?.next?'empty':'items'} aria-label="Due maintenance reminders">
        <h2>Maintenance due</h2>
        <p className="field-help">Due today or overdue in {view.schedule.timezone}.</p>
        {view.schedule.maintenance===null?<p>Saved reminders could not be verified. Refresh to try again.</p>:
          view.schedule.maintenance&&<>
            {otherMaintenance.length===0?<p>{featureMaintenance?'The due reminder is shown in the next task.':'No maintenance reminders due.'}</p>:
              <ul className="follow-up-list">{otherMaintenance.map(({record,customerName,vehicleLabel,effectiveDueAt})=>
                <li key={record.taskId}>
                  <strong>{customerName}</strong>{vehicleLabel&&<span>{vehicleLabel}</span>}
                  <time dateTime={effectiveDueAt}>{when(effectiveDueAt,view.schedule!.timezone)}</time>
                  <span>{record.state==='snoozed'?'Snoozed until this time':'Open'}</span>
                  {record.sourceJobId&&<a href={'/schedule?job='+encodeURIComponent(record.sourceJobId)}>Open saved job</a>}
                </li>)}</ul>}
            {view.schedule.maintenance.next&&<p className="field-help">Showing the first 20 due reminders.</p>}
          </>}
      </section>}
      <section className="home-panel" data-queue-state={view.followUps===null?'unknown':otherReminders.length===0&&!view.followUps.hasMore&&!laterFollowUps?'empty':'items'} id="lead-follow-ups" aria-labelledby="lead-follow-ups-title" aria-busy={followUpLoading}><div className="section-heading"><h2 id="lead-follow-ups-title" tabIndex={-1} ref={followUpHeading}>Lead follow-ups</h2><a href="/leads">All leads</a></div>
        {view.followUps?.hasMore&&otherReminders.length>0&&<p className="field-help">Showing {otherReminders.length} reminders.</p>}
        {view.followUps===null?<p>Follow-ups could not be loaded. Open Leads to check.</p>:<>
          {view.followUps.kind==='legacy'&&view.followUps.hasMore&&<p className="field-help">Showing reminders from the first 50 leads.</p>}
          {otherReminders.length===0?<p>{laterFollowUps?'No later follow-ups.':featureLead?'The first reminder is shown in the next task.':view.followUps.kind==='legacy'&&view.followUps.hasMore?'No follow-ups among the first 50 leads.':'No follow-up dates recorded.'}</p>:
            <ul className="follow-up-list lead-follow-up-list">{otherReminders.map(lead=>{
              const overdue=view.followUps?.observedAt&&lead.followUpAt<=view.followUps.observedAt;
              return <li key={lead.id}>
                <a href={'/leads?lead='+encodeURIComponent(lead.id)}>{lead.label}</a>
                <div><time dateTime={lead.followUpAt}>{view.schedule?when(lead.followUpAt,view.schedule.timezone):new Date(lead.followUpAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time>
                  {overdue&&<span className="follow-up-overdue">Overdue</span>}
                  {lead.state!=='new'&&<span>{lead.state==='lost'?'Lost lead':lead.state.replaceAll('_',' ')}</span>}
                </div>
              </li>;
            })}</ul>}
          {otherReminders.length>0&&<p className="field-help">Times in {view.schedule?.timezone??'this device’s time zone'}.</p>}
          {view.followUps.kind==='indexed'&&(view.followUps.hasMore||laterFollowUps)&&<div className="lead-follow-up-pagination">
            {laterFollowUps&&<button className="secondary" type="button" disabled={followUpLoading} onClick={()=>void changeFollowUps(true)}>First reminders</button>}
            {view.followUps.hasMore&&<button className="secondary" type="button" disabled={followUpLoading} onClick={()=>void changeFollowUps(false)}>More follow-ups</button>}
          </div>}
        </>}
      </section>
      <section className="home-panel" data-queue-state={view.proposals===null?'unknown':view.proposals.holds.length===0&&!view.proposals.hasMore?'empty':'items'} aria-label="Unconfirmed appointment proposals">
        <div className="section-heading"><h2>Proposed times</h2><a className="today-queue-link" href="/appointment-holds">Review proposals</a></div>
        {view.proposals===null?<p>Saved proposals could not be verified. Open Proposals to check.</p>:<>
          {view.proposals.holds.length===0?<p>No saved proposals on this page.</p>:<ul className="follow-up-list">{view.proposals.holds.map(hold=><li key={hold.id}><strong>{hold.label}</strong><span>{hold.local_start.slice(0,16).replace('T',' ')} · {hold.timezone}</span><span>{hold.state==='withdrawn'?'Withdrawn':'Unconfirmed · does not reserve time'}</span></li>)}</ul>}
          {(view.proposals.holds.length>0||view.proposals.hasMore)&&<p className="field-help">First page of retained proposals, including withdrawals. {view.proposals.hasMore?'More proposals are available. ':''}These are not confirmed bookings.</p>}
          <a className="today-queue-link" href="/appointment-holds">Propose a time</a>
        </>}
      </section>
      </div></div>
      <div className="today-footer"><a href="/save-review">Review interrupted saves</a><p className="field-help">Last checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</p></div>
    </div>}
    <button type="button" className="secondary today-refresh" aria-disabled={checking} onClick={()=>{if(!checking){setView(initial);void load();}}}>Refresh workspace</button>
  </main>;
}
