'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../client/authentication';
import {businessSettings} from '../client/business-settings';
import {leads} from '../client/leads';
import {appointmentHolds} from '../client/appointment-holds';

type HoldPage=Awaited<ReturnType<typeof appointmentHolds.list>>;
type LeadPage=Awaited<ReturnType<typeof leads.list>>;
type View={phase:'checking'|'signed-out'|'unavailable'|'ready';name:string;paused:boolean;followUps:LeadPage|null;proposals:HoldPage|null;message:string;checkedAt:number|null};
const initial:View={phase:'checking',name:'',paused:false,followUps:null,proposals:null,message:'Checking workspace access…',checkedAt:null};
async function snapshot(signal:AbortSignal):Promise<View>{
  try{
    const proof=await authentication.session(signal),{context}=await businessSettings.settings(proof,signal);
    let followUps:LeadPage|null=null;
    try{followUps=await leads.list(context.businessId,{search:'',afterId:null,includeLost:true,pageSize:50},proof,signal);}catch{/* Unavailable is not empty. */}
    let proposals:HoldPage|null=null;
    try{proposals=await appointmentHolds.list(context.businessId,{afterId:null,pageSize:5},proof,signal);}catch{/* Unavailable is not an empty schedule. */}
    return {phase:'ready',name:context.legalName,paused:context.writeState==='paused',followUps,proposals,message:'Workspace access verified.',checkedAt:Date.now()};
  }catch(error){return {...initial,phase:error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable',message:error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to open your workspace.':'Workspace access could not be verified. Check the local services and try again.'};}
}
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
  return <main className="workspace-home" aria-busy={view.phase==='checking'}>
    <p className="eyebrow">Crest Detailing</p><h1>Today</h1>
    <p role="status" aria-live="polite">{view.message}</p>
    {view.phase==='signed-out'&&<section className="home-panel"><h2>Your day starts here</h2><p>Customers, vehicles, and lead follow-ups in one place. Use your account and authenticator to continue.</p><a className="primary-action" href="/sign-in">Sign in to Crest OS</a></section>}
    {view.phase==='unavailable'&&<div className="notice"><p>No current business information is shown until access is confirmed.</p><a href="/sign-in">Check sign-in</a></div>}
    {view.phase==='ready'&&<>
      <p className="business-name">{view.name}</p>
      {view.paused&&<p className="notice">Changes are paused for recovery review. You can still review available records and history.</p>}
      <section className="home-panel"><h2>Start with a customer</h2><p>Find contact details, add a customer, or review their saved history.</p><a className="primary-action" href="/customers">Open customers</a><a className="text-action" href="/vehicles">Find a vehicle</a></section>
      <section className="home-panel"><h2>Prepare the next quote</h2><p>Copy a saved service scope, enter your amounts, and retain the draft and its history.</p><a className="primary-action" href="/quotes">Open quote drafts</a><a className="text-action" href="/services">Manage services</a><p className="field-help">Draft preparation only. Approval, sending and acceptance are still being built.</p></section>
      <section className="home-panel" aria-label="Lead follow-ups"><div className="section-heading"><h2>Follow-ups</h2><a href="/leads">All leads</a></div>
        {view.followUps===null?<p>Follow-ups could not be loaded. Open leads to check; this does not mean there are none.</p>:<>
          {view.followUps.hasMore&&<p className="notice">Showing reminders from the first 50 leads. Open leads to review the remaining records.</p>}
          {reminders.length===0?<p>No follow-up dates recorded{view.followUps.hasMore?' in this page of leads':''}.</p>:<ul className="follow-up-list">{reminders.map(lead=><li key={lead.id}><strong>{lead.label}</strong><span>{new Date(lead.follow_up_at!).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</span><span>{lead.state==='lost'?'Lost lead · follow-up retained':lead.state.replaceAll('_',' ')}</span></li>)}</ul>}
          <p className="field-help">Recorded lead reminders, including lost leads. These are not booked jobs. Times use this device’s timezone.</p>
        </>}
      </section>
      {view.proposals!==null&&<section className="home-panel" aria-label="Unconfirmed appointment proposals"><div className="section-heading"><h2>Proposed times</h2><a href="/appointment-holds">Review proposals</a></div>{view.proposals.holds.length===0?<p>No saved proposals on this page.</p>:<ul className="follow-up-list">{view.proposals.holds.map(hold=><li key={hold.id}><strong>{hold.label}</strong><span>{hold.local_start.slice(0,16).replace('T',' ')} · {hold.timezone}</span><span>{hold.state==='withdrawn'?'Withdrawn':'Unconfirmed · does not reserve time'}</span></li>)}</ul>}<p className="field-help">First page of retained proposals, including withdrawals. {view.proposals.hasMore?'More proposals are available. ':''}These are not confirmed bookings.</p><a className="primary-action" href="/appointment-holds">Propose a time</a></section>}
      <section className="home-panel"><h2>Something didn’t save?</h2><p>Review an interrupted save before submitting the change again.</p><a href="/save-review">Review interrupted saves</a></section>
      <aside className="capability-note"><h2>Still being built</h2><p>Quote approval and sending, scheduling, jobs, photos, invoices, payments, expenses, reporting, complete business exports, and Google Calendar are not available in this workspace yet.</p></aside>
      <p className="field-help">Checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleTimeString()}. Refresh for current information.</p>
    </>}
    {view.phase!=='checking'&&<button type="button" className="secondary" onClick={()=>{setView(initial);void load();}}>Refresh workspace</button>}
    <p className="field-help">Synthetic testing only. This build is not approved for real Crest records.</p>
  </main>;
}
