'use client';
import {SignInLink} from "../../sign-in-link";


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AuthenticationError, authentication } from '../../../client/authentication';
import { businessSettings } from '../../../client/business-settings';
import { readSyntheticCalendarSetup,readCalendarConnectionInfo,beginGoogleCalendarConnection,abandonGoogleCalendarAuthorization } from '../../../client/google-calendar-consent';
import type { CalendarSetupState,CalendarConnectionInfo } from '../../../client/google-calendar-consent';
import { GoogleCalendarConsentPanel } from '../google-calendar-consent';
import { SyntheticCalendarJobStatus } from './job-status';
import { CalendarAppointmentActivity } from './activity';
import {GoogleCalendarDisconnectPanel} from './disconnect';

type State = { status: CalendarSetupState; recoveryEpoch: string } | null;

export function SyntheticGoogleCalendarSettings({ jobId }: { jobId: string | null }) {
  const [loaded, setLoaded] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('Checking Calendar setup…');
  const active = useRef<AbortController | null>(null);
  const focus = useRef<HTMLParagraphElement>(null);
  const stageNeedsRead = useRef(false);
  const [signInRequired, setSignInRequired] = useState(false);
  const [connectionInfo,setConnectionInfo]=useState<CalendarConnectionInfo|null>(null);
  const [ownerReviewed,setOwnerReviewed]=useState(false);
  const [calendarMode,setCalendarMode]=useState<'production'|'test'|null>(null);
  const liveMode=useRef(false);
  const restartOperation=useRef<{attemptId:string;operationId:string}|null>(null);
  const accessDenied = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setLoaded(null);
    setConnectionInfo(null);setOwnerReviewed(false);
    setBusy(false);
    setSignInRequired(true);
    setMessage('Sign in again to review Calendar setup.');
  }, []);
  useLayoutEffect(() => {
    if (signInRequired) focus.current?.focus();
  }, [signInRequired]);

  useEffect(() => {
    function load() { void loadState(); }
    function hide() {
      active.current?.abort();
      active.current = null;
      setLoaded(null);
      setConnectionInfo(null);setOwnerReviewed(false);
      setSignInRequired(false);
      setBusy(false);
    }
    function visibility() { if (document.visibilityState === 'hidden') hide(); else load(); }
    function restore(event: PageTransitionEvent) { if (event.persisted) load(); }
    load();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  async function loadState(stageEpoch?: string, moveFocus = false) {
    if (active.current||stageEpoch!==undefined&&liveMode.current) return;
    const controller = new AbortController(), { signal } = controller;
    active.current = controller;
    const staging = stageEpoch !== undefined;
    if (staging) stageNeedsRead.current = true;
    setBusy(true);
    setSignInRequired(false);
    setMessage(staging ? 'Preparing the fictional calendar…' : 'Checking Calendar setup…');
    try {
      let recoveryEpoch = stageEpoch;
      let info:CalendarConnectionInfo|null=null;
      if (!recoveryEpoch) {
        const proof = await authentication.session(signal);
        const settings = await businessSettings.settings(proof, signal);
        if (signal.aborted) return;
        if (!settings.syntheticCalendarAvailable) {
          setAvailable(false);
          setLoaded(null);
          setConnectionInfo(null);setOwnerReviewed(false);
          setMessage('Calendar setup is unavailable in this workspace.');
          return;
        }
        setAvailable(true);
        liveMode.current=settings.calendarMode==='production';setCalendarMode(liveMode.current?'production':'test');
        if (settings.context.writeState !== 'ready') {
          setLoaded(null);
          setConnectionInfo(null);setOwnerReviewed(false);
          setMessage('Calendar setup is paused while Crest reviews recovery.');
          return;
        }
        recoveryEpoch = settings.context.recoveryEpoch;
        if(settings.calendarMode==='production')info=await readCalendarConnectionInfo(recoveryEpoch,signal);
      }
      const status = await readSyntheticCalendarSetup(recoveryEpoch, signal, staging);
      if (signal.aborted) return;
      stageNeedsRead.current = false;
      setLoaded({ status, recoveryEpoch });
      setConnectionInfo(info);setOwnerReviewed(false);
      setMessage(status.state === 'review' ? 'Calendar setup needs review before it can continue.' :
        staging ? 'Crest Jobs is prepared. Review what an event would share.' : moveFocus ? 'Calendar setup verified.' : '');
    } catch (error) {
      if (!signal.aborted) {
        setLoaded(null);
        setConnectionInfo(null);setOwnerReviewed(false);
        const denied=error instanceof AuthenticationError&&error.kind==='denied';
        setSignInRequired(denied);
        setMessage(denied ? 'Sign in again to review Calendar setup.' : stageNeedsRead.current ? 'Crest could not confirm setup. Check its saved status before continuing.' :
          'Crest could not verify Calendar setup. Check your connection and sign-in.');
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        if (moveFocus) focus.current?.focus();
      }
    }
  }
  async function connectGoogle(){
    if(active.current||!loaded||loaded.status.state!=='ready'||!connectionInfo||!ownerReviewed)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Opening Google…');
    try{
      const location=await beginGoogleCalendarConnection(loaded.recoveryEpoch,connectionInfo.googleOwner,controller.signal);
      if(!controller.signal.aborted&&active.current===controller)window.location.assign(location);
    }catch(error){
      if(!controller.signal.aborted){if(error instanceof AuthenticationError&&error.kind==='denied'){accessDenied();return;}
        setLoaded(null);setConnectionInfo(null);setOwnerReviewed(false);setMessage('Google connection was not confirmed. Check the saved setup status before continuing.');}
    }finally{if(active.current===controller){active.current=null;setBusy(false);focus.current?.focus();}}
  }
  async function restartAuthorization(){
    if(active.current||!liveMode.current||!loaded||loaded.status.state!=='authorization_pending'||!ownerReviewed)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Retiring the previous authorization link…');
    const {attemptId}=loaded.status;
    if(restartOperation.current?.attemptId!==attemptId)restartOperation.current={attemptId,operationId:crypto.randomUUID()};
    try{
      await abandonGoogleCalendarAuthorization(loaded.recoveryEpoch,attemptId,restartOperation.current.operationId,controller.signal);
      if(controller.signal.aborted)return;
      setLoaded({recoveryEpoch:loaded.recoveryEpoch,status:{state:'ready',context:null}});setOwnerReviewed(false);restartOperation.current=null;
      setMessage('The previous link is retired. Review your account below to open a new Google connection.');
    }catch(error){if(!controller.signal.aborted){setLoaded(null);setConnectionInfo(null);setOwnerReviewed(false);setMessage('Crest could not confirm the restart. Check saved setup status before continuing.');if(error instanceof AuthenticationError&&error.kind==='denied')accessDenied();}}
    finally{if(active.current===controller){active.current=null;setBusy(false);focus.current?.focus();}}
  }

  const context = loaded?.status.context;
  const consentSaved = loaded?.status.state === 'active';
  const calendarPrepared = Boolean(context || consentSaved);

  function confirmSavedConsent() {
    if (!context) return;
    setLoaded(current => current && context && current.status.context === context
      ? { ...current, status: { state: 'active', context } }
      : current);
    setMessage('');
  }

  return <section aria-label={calendarMode==='test'?'Fictional Calendar setup':'Google Calendar setup'} aria-busy={busy} className="calendar-settings-layout">
    {available && loaded && <section className="settings-card calendar-setup-summary" aria-labelledby="calendar-setup-overview">
      <h2 id="calendar-setup-overview">Setup overview</h2>
      <dl className="calendar-setup-facts">
        <div><dt>Google account</dt><dd>{connectionInfo?(loaded.status.state==='ready'?connectionInfo.googleOwner:'Reviewed during setup'):'Simulated account'}</dd></div>
        <div><dt>Calendar</dt><dd>{calendarPrepared ? 'Crest Jobs' : loaded.status.state === 'review' ? 'Needs review' : loaded.status.state==='authorization_pending'?'Authorization not finished':'Waiting for preparation'}</dd></div>
        <div><dt>Event sharing</dt><dd>{consentSaved ? 'Consent saved' : calendarPrepared ? 'Review required' : 'Available after preparation'}</dd></div>
      </dl>
      <p className="field-help">{connectionInfo?'Appointments are sent only after you review and save sharing consent.':'This workspace sends no events to Google.'}</p>
    </section>}
    <div className="calendar-settings-detail">
    <p ref={focus} role="status" tabIndex={-1} className="settings-feedback">{message}</p>
    {loaded?.status.state==='authorization_pending'&&calendarMode==='production'&&<form className="settings-card calendar-prepare" onSubmit={event=>{event.preventDefault();void restartAuthorization();}}>
      <h2>Finish connecting Google</h2>
      <p>The previous authorization was not completed. You can retire its link and start again. Crest has not sent a request to create a Google calendar for this attempt.</p>
      <label className="trust"><input type="checkbox" checked={ownerReviewed} disabled={busy} onChange={event=>setOwnerReviewed(event.target.checked)}/> Retire the previous authorization link so I can start again.</label>
      <button type="submit" disabled={busy||!ownerReviewed}>Restart connection setup</button>
    </form>}
    {loaded?.status.state==='ready'&&connectionInfo&&<form className="settings-card calendar-prepare" onSubmit={event=>{event.preventDefault();void connectGoogle();}}>
      <h2>Connect Google Calendar</h2>
      <p>Create a separate Crest Jobs calendar using <strong>{connectionInfo.googleOwner}</strong>. Google will also confirm which account is connecting. You will review appointment sharing before Crest sends events.</p>
      <label className="trust"><input type="checkbox" checked={ownerReviewed} disabled={busy} onChange={event=>setOwnerReviewed(event.target.checked)}/> I will use this Google account and approve creation of the Crest Jobs calendar.</label>
      <button type="submit" disabled={busy||!ownerReviewed}>Continue to Google</button>
    </form>}
    {loaded?.status.state === 'ready' && !connectionInfo && <form className="settings-card calendar-prepare" onSubmit={event => {
      event.preventDefault();
      if (!stageNeedsRead.current) void loadState(loaded.recoveryEpoch, true);
    }}>
      <h2>Prepare Crest Jobs</h2>
      <p>Create the simulated calendar so you can preview a confirmed appointment and review its shared details.</p>
      <button type="submit" disabled={busy}>Prepare fictional calendar</button>
    </form>}
    {context && <GoogleCalendarConsentPanel context={context} saved={consentSaved} simulated={!connectionInfo} onConsentSaved={confirmSavedConsent} onAccessDenied={accessDenied}/>}
    {loaded?.status.state === 'active' && !loaded.status.context && <p>Calendar consent is saved.</p>}
    {calendarMode==='production'&&loaded&&<GoogleCalendarDisconnectPanel key={loaded.recoveryEpoch} recoveryEpoch={loaded.recoveryEpoch} onAccessDenied={accessDenied} onDisconnected={()=>setLoaded(current=>current?{...current,status:{state:'review',context:null}}:null)}/>}
    {jobId && loaded && !consentSaved && <SyntheticCalendarJobStatus key={jobId + loaded.recoveryEpoch} jobId={jobId} recoveryEpoch={loaded.recoveryEpoch} simulated={!connectionInfo} onAccessDenied={accessDenied}/>}
    {signInRequired&&!busy&&<SignInLink className="primary-action" returnTo="calendar">Sign in again</SignInLink>}
    {(!loaded || loaded.status.state === 'review') && !busy && !signInRequired && <button className="secondary" type="button"
      onClick={() => void loadState(undefined, true)}>Check setup status</button>}
    </div>
    {loaded&&consentSaved&&<CalendarAppointmentActivity key={loaded.recoveryEpoch} initialJobId={jobId} recoveryEpoch={loaded.recoveryEpoch} simulated={!connectionInfo} onAccessDenied={accessDenied}/>}
  </section>;
}
