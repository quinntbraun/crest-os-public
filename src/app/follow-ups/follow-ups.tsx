'use client';
import {useEffect,useRef,useState} from 'react';
import {createLeadFollowUps,groupLeadFollowUps,initialLeadFollowUpView} from '../../client/lead-follow-ups';
import type {LeadFollowUp} from '../../client/lead-follow-ups';

function Reminders({rows}:{rows:readonly LeadFollowUp[]}){
  return <ul className="follow-up-list">{rows.map(row=><li key={row.id}>
    <a href={'/leads?lead='+row.id}>{row.label}</a>
    <time dateTime={row.at}>{new Date(row.at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time>
    <span>{row.state==='lost'?'Lost lead · follow-up retained':row.state.replaceAll('_',' ')}</span>
  </li>)}</ul>;
}
export function LeadFollowUps(){
  const [view,setView]=useState(initialLeadFollowUpView),current=useRef<ReturnType<typeof createLeadFollowUps>|null>(null);
  useEffect(()=>{
    const controller=createLeadFollowUps({change:setView});current.current=controller;void controller.load();
    const hide=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restore=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
    return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
  },[]);
  const groups=view.checkedAt===null?{due:[],upcoming:[]}:groupLeadFollowUps(view.rows,view.checkedAt);
  return <section aria-label="Recorded lead follow-ups" aria-busy={view.busy}>
    <p role="status" aria-live="polite">{view.message}</p>
    {view.phase==='ready'&&<>
      <p>Checked {view.checkedAt===null?'':new Date(view.checkedAt).toLocaleString()}. Times use this device’s timezone.</p>
      {view.hasMore&&<p className="notice">More leads remain. These reminders cover only the {view.scanned} leads checked so far.</p>}
      <section className="home-panel" aria-label="Follow-ups due now"><h2>Due now</h2>{groups.due.length?<Reminders rows={groups.due}/>:<p>No follow-ups due in the leads checked.</p>}</section>
      <section className="home-panel" aria-label="Upcoming follow-ups"><h2>Upcoming</h2>{groups.upcoming.length?<Reminders rows={groups.upcoming}/>:<p>No upcoming follow-ups in the leads checked.</p>}</section>
      {view.hasMore&&!view.limited&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.more()}>Check next 50 leads</button>}
      {view.limited&&<p className="notice">This review reached its 1,000-lead limit. Use lead search to review the remaining records.</p>}
      {!view.hasMore&&<p className="field-help">All {view.scanned} leads checked. This is a live paged review; records can change between pages. Refresh after editing.</p>}
      <p className="field-help">Explicitly recorded dates, including lost leads. No message is sent, no reminder is completed, and no job is booked by opening a lead.</p>
    </>}
    {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to Crest OS</a>}
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.load()}>Refresh follow-ups</button>
    <nav className="section-heading" aria-label="Follow-up navigation"><a href="/leads">All leads</a><a href="/">Today</a></nav>
  </section>;
}
