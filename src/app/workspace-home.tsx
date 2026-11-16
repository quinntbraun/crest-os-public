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
type View={phase:'checking'|'signed-out'|'unavailable'|'ready';name:string;paused:boolean;followUps:FollowUps|null;identity:{context:Settings;binding:string}|null;proposals:HoldPage|null;schedule:HomeSchedule|null;message:string;checkedAt:number|null};
const initial:View={phase:'checking',name:'',paused:false,followUps:null,identity:null,proposals:null,schedule:null,message:'Checking workspace access…',checkedAt:null};
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
    return {phase:'ready',name:context.legalName,paused:context.writeState==='paused',followUps,identity:{context,binding:loaded.binding},proposals,schedule,message:'Workspace access verified.',checkedAt:Date.now()};
  }catch(error){return {...initial,phase:error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable',message:error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to open your workspace.':'Workspace access could not be verified. Check the local services and try again.'};}
}
const shortcuts=[
  {href:'/customers',name:'Customers',detail:'Contacts and vehicles',glyph:'◎'},
  {href:'/quotes',name:'Quotes',detail:'Estimates and approvals',glyph:'≡'},
  {href:'/expenses',name:'Expenses',detail:'Receipts and supplier bills',glyph:'◇'},
  {href:'/settings/accounts',name:'Accounting',detail:'Reports and reconciliation',glyph:'▤'},
] as const;
const shown=(count:number,more:boolean)=>more?count+' shown':String(count);
const visitStates={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const dateLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
const shortTime=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
const visitDate=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',month:'short',day:'numeric'}).format(new Date(value));
const when=(value:string,timezone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
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
  const quickActions=<nav className="home-shortcuts" aria-label="Quick actions">{shortcuts.map(({href,name,detail,glyph})=>
        <a href={href} key={href} aria-label={'Open '+name.toLowerCase()}>
          <span className="shortcut-glyph" aria-hidden="true">{glyph}</span><span><strong>{name}</strong><small>{detail}</small></span><span aria-hidden="true">↗</span>
        </a>)}</nav>;
  const checking=view.phase==='checking';
  return <main className="workspace-home" aria-busy={checking}>
    <div className="today-heading">
      <div>
        <p className="today-business">{view.phase==='ready'?view.name:'Crest Detailing'}</p>
        <h1>Today</h1>
        {view.phase==='ready'&&view.schedule&&<p><time dateTime={view.schedule.fromDate}>{dateLabel.format(new Date(view.schedule.fromDate+'T12:00:00Z'))}</time></p>}
      </div>
      {view.phase==='ready'&&view.schedule&&<a className="primary-action" href="/schedule">Open schedule <span aria-hidden="true">↗</span></a>}
    </div>
    <p className={view.phase==='ready'?'visually-hidden':'notice'} role="status" aria-live="polite">{view.message}</p>
    {view.phase==='signed-out'&&<section className="home-panel"><h2>Sign in</h2><p>Use your Crest OS account and authenticator to open your workspace.</p><a className="primary-action" href="/sign-in">Sign in to Crest OS</a></section>}
    {view.phase==='unavailable'&&<div className="notice"><p>No current business information is shown until access is confirmed.</p><a href="/sign-in">Check sign-in</a></div>}
    {checking&&<div className="today-loading" aria-hidden="true"><span/><span/><span/></div>}
    {view.phase==='ready'&&<div className="today-content">
      {view.paused&&<p className="notice">Changes are paused for recovery review. You can still review available records and history.</p>}
      <nav className="today-overview" aria-label="Work at a glance">
        <a href="/schedule"><span>Upcoming visits</span><strong data-unavailable={!view.schedule?.visits||undefined}>{view.schedule?.visits?shown(visits.length,view.schedule.visits.hasMore):'Unavailable'}</strong><span>Next seven days</span><span className="overview-arrow" aria-hidden="true">↗</span></a>
        <a href="#lead-follow-ups"><span>Lead follow-ups</span><strong data-unavailable={!view.followUps||undefined}>{view.followUps?shown(reminders.length,view.followUps.hasMore):'Unavailable'}</strong><span>Leads with a follow-up date</span><span className="overview-arrow" aria-hidden="true">↗</span></a>
        <a href="/appointment-holds"><span>Proposed times</span><strong data-unavailable={!view.proposals||undefined}>{view.proposals?shown(view.proposals.holds.length,view.proposals.hasMore):'Unavailable'}</strong><span>Saved proposal records</span><span className="overview-arrow" aria-hidden="true">↗</span></a>
      </nav>
      {visits.length===0&&quickActions}
      <div className="today-grid">
      <div className="today-primary">
      <section className="home-panel" aria-label="Upcoming saved visits"><div className="section-heading"><h2>Upcoming visits</h2></div>
        {view.schedule===null||view.schedule.visits===null?<p>Upcoming visits could not be verified. <a href="/schedule">Check the schedule</a>.</p>:<><p className="field-help">Confirmed appointments over the next seven days.</p>{visits.length===0?<p>{view.schedule.visits.hasMore?'No active visits on this page. Open Schedule to review remaining visits.':'No active saved visits in the next seven days.'}</p>:<ul className="today-visits">{visits.map(job=><li key={job.jobId}>
          <time dateTime={job.startAt}><strong>{shortTime(job.startAt,job.timezone)}</strong><span>{visitDate(job.startAt,job.timezone)}</span></time>
          <div><a href={'/schedule?job='+encodeURIComponent(job.jobId)} aria-label={'Review visit for '+job.customerName}>{job.customerName}</a>
            <p>{job.vehicleLabels.join(' · ')}{job.vehicleCount>job.vehicleLabels.length?' · '+(job.vehicleCount-job.vehicleLabels.length)+' more vehicles':''}</p>
            <p><strong>{visitStates[job.state]}</strong> · Until {visitDate(job.startAt,job.timezone)===visitDate(job.endAt,job.timezone)?'':visitDate(job.endAt,job.timezone)+' '}{shortTime(job.endAt,job.timezone)}{job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}{job.timezone!==view.schedule?.timezone?' · '+job.timezone:''}</p>
          </div></li>)}</ul>}{view.schedule.visits.hasMore&&<p className="field-help">More saved visits are available. Open Schedule for the remaining records.</p>}</>}
        <details className="home-changes" open={!changes||changes.items.length>0}><summary>Appointment changes to review</summary>{!changes?<p>Proposed changes could not be verified. Open Schedule to check.</p>:<>{changes.items.length===0?<p>No proposed appointment changes recorded.</p>:<ul className="follow-up-list">{changes.items.map(({head})=><li key={head.job.id}><a href={'/schedule?job='+encodeURIComponent(head.job.id)}>Review {head.confirmationDraft?.customerName??'saved job'}</a><span>Proposed: {when(head.latestAppointment.start_at,head.latestAppointment.timezone)}</span><span>Confirmed slot: {when(head.appointment.start_at,head.appointment.timezone)}</span></li>)}</ul>}{changes.hasMore&&<p>More proposed changes are available in Schedule.</p>}<p className="field-help">All dates. Proposals reserve no new time.</p></>}</details>
      </section>
      {visits.length>0&&quickActions}
      </div>
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
      <section className="home-panel" id="lead-follow-ups" aria-labelledby="lead-follow-ups-title" aria-busy={followUpLoading}><div className="section-heading"><h2 id="lead-follow-ups-title" tabIndex={-1} ref={followUpHeading}>Lead follow-ups</h2><a href="/leads">All leads</a></div>
        {view.followUps===null?<p>Follow-ups could not be loaded. Open Leads to check.</p>:<>
          {view.followUps.kind==='legacy'&&view.followUps.hasMore&&<p className="field-help">Showing reminders from the first 50 leads.</p>}
          {reminders.length===0?<p>{laterFollowUps?'No later follow-ups.':view.followUps.kind==='legacy'&&view.followUps.hasMore?'No follow-ups among the first 50 leads.':'No follow-up dates recorded.'}</p>:
            <ul className="follow-up-list lead-follow-up-list">{reminders.map(lead=>{
              const overdue=view.followUps?.observedAt&&lead.followUpAt<=view.followUps.observedAt;
              return <li key={lead.id}>
                <a href={'/leads?lead='+encodeURIComponent(lead.id)}>{lead.label}</a>
                <div><time dateTime={lead.followUpAt}>{view.schedule?when(lead.followUpAt,view.schedule.timezone):new Date(lead.followUpAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time>
                  {overdue&&<span className="follow-up-overdue">Overdue</span>}
                  {lead.state!=='new'&&<span>{lead.state==='lost'?'Lost lead':lead.state.replaceAll('_',' ')}</span>}
                </div>
              </li>;
            })}</ul>}
          {reminders.length>0&&<p className="field-help">Times in {view.schedule?.timezone??'this device’s time zone'}.</p>}
          {view.followUps.kind==='indexed'&&(view.followUps.hasMore||laterFollowUps)&&<div className="lead-follow-up-pagination">
            {laterFollowUps&&<button className="secondary" type="button" disabled={followUpLoading} onClick={()=>void changeFollowUps(true)}>First reminders</button>}
            {view.followUps.hasMore&&<button className="secondary" type="button" disabled={followUpLoading} onClick={()=>void changeFollowUps(false)}>More follow-ups</button>}
          </div>}
        </>}
      </section>
      {view.proposals!==null&&<section className="home-panel" aria-label="Unconfirmed appointment proposals"><div className="section-heading"><h2>Proposed times</h2><a href="/appointment-holds">Review proposals</a></div>{view.proposals.holds.length===0?<p>No saved proposals on this page.</p>:<ul className="follow-up-list">{view.proposals.holds.map(hold=><li key={hold.id}><strong>{hold.label}</strong><span>{hold.local_start.slice(0,16).replace('T',' ')} · {hold.timezone}</span><span>{hold.state==='withdrawn'?'Withdrawn':'Unconfirmed · does not reserve time'}</span></li>)}</ul>}<p className="field-help">First page of retained proposals, including withdrawals. {view.proposals.hasMore?'More proposals are available. ':''}These are not confirmed bookings.</p><a className="primary-action" href="/appointment-holds">Propose a time</a></section>}
      </div></div>
      <div className="today-footer"><a href="/save-review">Review interrupted saves</a><p className="field-help">Last checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</p></div>
    </div>}
    <button type="button" className="secondary today-refresh" aria-disabled={checking} onClick={()=>{if(!checking){setView(initial);void load();}}}>Refresh workspace</button>
  </main>;
}
