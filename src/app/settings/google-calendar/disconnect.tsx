'use client';
import {useEffect,useRef,useState} from 'react';
import {AuthenticationError} from '../../../client/authentication';
import {readGoogleCalendarConnection,disconnectGoogleCalendar,readGoogleCalendarDisconnect,readGoogleCalendarReconnect,beginGoogleCalendarReconnect} from '../../../client/google-calendar-consent';
import type {GoogleCalendarReconnectInfo} from '../../../client/google-calendar-consent';
import type {CalendarConnectionSummary,CalendarDisconnectStatus} from '../../../operations/google-calendar-disconnect-contract';

export function GoogleCalendarDisconnectPanel({recoveryEpoch,onAccessDenied,onDisconnected}:{recoveryEpoch:string;onAccessDenied:()=>void;onDisconnected:()=>void}){
 const [summary,setSummary]=useState<CalendarConnectionSummary|null>(null);
 const [status,setStatus]=useState<CalendarDisconnectStatus|null>(null);
 const [reconnect,setReconnect]=useState<GoogleCalendarReconnectInfo|null>(null),[reconnectReviewed,setReconnectReviewed]=useState(false);
 const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null),operation=useRef<string|null>(null),feedback=useRef<HTMLParagraphElement>(null);
 const denied=useRef(onAccessDenied),changed=useRef(onDisconnected);
 useEffect(()=>{denied.current=onAccessDenied;changed.current=onDisconnected;},[onAccessDenied,onDisconnected]);
 useEffect(()=>{
  async function load(){
   if(active.current||document.visibilityState==='hidden')return;
   const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Checking Google access…');
   try{
    const value=await readGoogleCalendarConnection(recoveryEpoch,controller.signal);
    const saved=value.state==='disconnected'&&value.disconnectId?await readGoogleCalendarDisconnect(recoveryEpoch,value.destinationId,value.disconnectId,controller.signal):null;
    const renewed=(value.state==='active'||value.state==='paused'||saved?.state==='disconnected')?await readGoogleCalendarReconnect(recoveryEpoch,controller.signal):null;
    if(controller.signal.aborted)return;setSummary(value);setStatus(saved);setReconnect(renewed);setReconnectReviewed(false);setMessage('');
   }catch(error){if(!controller.signal.aborted){setSummary(null);setStatus(null);setReconnect(null);setReconnectReviewed(false);setMessage('Crest could not verify Google access. Check its saved status before continuing.');if(error instanceof AuthenticationError&&error.kind==='denied')denied.current();}}
   finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  function hide(){active.current?.abort();active.current=null;setSummary(null);setStatus(null);setReconnect(null);setReconnectReviewed(false);setConfirmed(false);setBusy(false);setMessage('');}
  function visibility(){if(document.visibilityState==='hidden')hide();else void load();}
  function restore(event:PageTransitionEvent){if(event.persisted)void load();}
  void load();document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',restore);
  return()=>{hide();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',restore);};
 },[recoveryEpoch]);

 async function act(action:'check'|'disconnect'|'revoke'){
  if(active.current||document.visibilityState==='hidden')return;
  if(action==='disconnect'&&(!summary||!('destinationId'in summary)||!['active','paused'].includes(summary.state)||!confirmed))return;
  if(action==='revoke'&&(!status||status.state!=='ready_to_revoke'||!summary||!('destinationId'in summary)))return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage(action==='disconnect'?'Stopping Calendar sync…':action==='revoke'?'Revoking Google access…':'Checking saved status…');
  try{
   let saved:CalendarDisconnectStatus|null=null;
   if(action==='disconnect'&&summary&&'destinationId'in summary){
    operation.current??=crypto.randomUUID();
    changed.current();
    saved=await disconnectGoogleCalendar({recoveryEpoch,destinationId:summary.destinationId,generation:summary.generation,operationId:operation.current},controller.signal);
   }else if(action==='revoke'&&summary&&'destinationId'in summary&&status){
    saved=await readGoogleCalendarDisconnect(recoveryEpoch,summary.destinationId,status.disconnectId,controller.signal,true);
   }
   const value=await readGoogleCalendarConnection(recoveryEpoch,controller.signal);
   if(value.state==='disconnected'&&value.disconnectId&&!saved)saved=await readGoogleCalendarDisconnect(recoveryEpoch,value.destinationId,value.disconnectId,controller.signal);
   const renewed=(value.state==='active'||value.state==='paused'||saved?.state==='disconnected')?await readGoogleCalendarReconnect(recoveryEpoch,controller.signal):null;
   if(controller.signal.aborted)return;
   setSummary(value);setStatus(saved);setReconnect(renewed);setReconnectReviewed(false);setConfirmed(false);setMessage('Saved status checked.');
  }catch(error){if(!controller.signal.aborted){setMessage('Crest could not confirm the outcome. Check saved status before continuing.');setSummary(null);setStatus(null);setReconnect(null);setReconnectReviewed(false);setConfirmed(false);if(error instanceof AuthenticationError&&error.kind==='denied')denied.current();}}
  finally{if(active.current===controller){active.current=null;setBusy(false);feedback.current?.focus();}}
 }
 async function connectAgain(){
  if(active.current||!reconnectReviewed||reconnect?.state!=='ready'||document.visibilityState==='hidden')return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Opening Google to verify the original account…');
  try{const location=await beginGoogleCalendarReconnect(recoveryEpoch,reconnect,controller.signal);if(!controller.signal.aborted&&active.current===controller)window.location.assign(location);}
  catch(error){if(!controller.signal.aborted){setReconnect(null);setReconnectReviewed(false);setMessage('Crest could not open the connection. Check saved status before continuing.');if(error instanceof AuthenticationError&&error.kind==='denied')denied.current();}}
  finally{if(active.current===controller){active.current=null;setBusy(false);feedback.current?.focus();}}
 }
 const canDisconnect=summary&&'destinationId'in summary&&(summary.state==='active'||summary.state==='paused');
 return <section className="settings-card" aria-labelledby="calendar-google-access" aria-busy={busy}>
  <h2 id="calendar-google-access">Google access</h2>
  <p ref={feedback} role="status" tabIndex={-1} className="settings-feedback">{message}</p>
  {canDisconnect&&<form onSubmit={event=>{event.preventDefault();void act('disconnect');}}>
   <p>Disconnecting stops new appointment sync immediately. Crest then lets requests already in progress settle before revoking Google access. Existing Calendar events remain.</p>
   <label className="trust"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/> Stop syncing appointments with Google Calendar.</label>
   <button type="submit" className="secondary" disabled={busy||!confirmed}>Disconnect Calendar</button>
  </form>}
  {status&&<>
   <p>{status.state==='draining'?'Sync is stopped. Requests already in progress are settling.':status.state==='ready_to_revoke'?'Sync is stopped. You can now revoke Google access.':status.state==='revoking'?'Sync is stopped. A Google access revocation request is pending.':status.state==='disconnected'?'Google confirmed access revocation. Calendar sync is disconnected.':status.state==='delayed'?'Sync is stopped. Revocation is waiting for the shared request limit.':'Sync is stopped. Google access revocation could not be confirmed. Review Crest’s access in your Google account.'}</p>
   {'reviewRequired'in status&&status.reviewRequired&&<p className="field-help">Some earlier requests need review. Check Google Calendar for changes whose outcome Crest could not confirm.</p>}
   {status.state==='ready_to_revoke'&&<button type="button" disabled={busy} onClick={()=>void act('revoke')}>Revoke Google access</button>}
  </>}
  {summary?.state==='absent'&&<p>No saved Google Calendar connection.</p>}
  {summary?.state==='review'&&<p>This connection needs review before it can be changed.</p>}
  {reconnect?.state==='ready'&&<form onSubmit={event=>{event.preventDefault();void connectAgain();}}>
   <h3>Reconnect the saved calendar</h3>
   <p>Continue using <strong>{reconnect.googleOwner}</strong>. Crest will verify the original account and reuse the saved Crest Jobs calendar. You will review sharing again before the renewed connection syncs appointments.</p>
   <label className="trust"><input type="checkbox" checked={reconnectReviewed} disabled={busy} onChange={event=>setReconnectReviewed(event.target.checked)}/> Verify this Google account and reconnect the saved calendar.</label>
   <button type="submit" disabled={busy||!reconnectReviewed}>Reconnect with Google</button>
  </form>}
  {reconnect?.state==='unavailable'&&<p className="field-help">A new Google connection is unavailable until the current connection review or recovery is resolved.</p>}
  <button type="button" className="secondary" disabled={busy} onClick={()=>void act('check')}>Check saved status</button>
 </section>;
}
