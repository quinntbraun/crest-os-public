'use client';

import { useEffect, useRef, useState } from 'react';
import { authentication } from '../../../client/authentication';
import { businessSettings } from '../../../client/business-settings';
import { readSyntheticCalendarSetup } from '../../../client/google-calendar-consent';
import type { CalendarSetupState } from '../../../client/google-calendar-consent';
import { GoogleCalendarConsentPanel } from '../google-calendar-consent';
import { SyntheticCalendarJobStatus } from './job-status';

type State = { status: CalendarSetupState; recoveryEpoch: string } | null;

export function SyntheticGoogleCalendarSettings({ jobId }: { jobId: string | null }) {
  const [loaded, setLoaded] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('Checking Calendar setup…');
  const active = useRef<AbortController | null>(null);
  const focus = useRef<HTMLParagraphElement>(null);
  const stageNeedsRead = useRef(false);

  useEffect(() => {
    function load() { void loadState(); }
    function hide() {
      active.current?.abort();
      active.current = null;
      setLoaded(null);
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
    if (active.current) return;
    const controller = new AbortController(), { signal } = controller;
    active.current = controller;
    const staging = stageEpoch !== undefined;
    if (staging) stageNeedsRead.current = true;
    setBusy(true);
    setMessage(staging ? 'Preparing the fictional calendar…' : 'Checking Calendar setup…');
    try {
      let recoveryEpoch = stageEpoch;
      if (!recoveryEpoch) {
        const proof = await authentication.session(signal);
        const settings = await businessSettings.settings(proof, signal);
        if (signal.aborted) return;
        if (!settings.syntheticCalendarAvailable) {
          setAvailable(false);
          setLoaded(null);
          setMessage('Calendar setup is unavailable in this workspace.');
          return;
        }
        setAvailable(true);
        if (settings.context.writeState !== 'ready') {
          setLoaded(null);
          setMessage('Calendar setup is paused while Crest reviews recovery.');
          return;
        }
        recoveryEpoch = settings.context.recoveryEpoch;
      }
      const status = await readSyntheticCalendarSetup(recoveryEpoch, signal, staging);
      if (signal.aborted) return;
      stageNeedsRead.current = false;
      setLoaded({ status, recoveryEpoch });
      setMessage(status.state === 'review' ? 'Calendar setup needs review before it can continue.' : '');
    } catch {
      if (!signal.aborted) {
        setLoaded(null);
        setMessage(stageNeedsRead.current ? 'Crest could not confirm setup. Check its saved status before continuing.' :
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

  return <section aria-label="Fictional Calendar setup" aria-busy={busy}>
    {available && <p className="field-help">Fictional setup. This workspace uses a simulated Google account and sends no events to Google.</p>}
    <p ref={focus} role="status" tabIndex={-1} className="field-help">{message}</p>
    {loaded?.status.state === 'ready' && <form onSubmit={event => {
      event.preventDefault();
      if (!stageNeedsRead.current) void loadState(loaded.recoveryEpoch, true);
    }}>
      <p>Prepare a fictional Crest Jobs calendar and review what your events would share.</p>
      <button type="submit" disabled={busy}>Prepare fictional calendar</button>
    </form>}
    {loaded?.status.context && <GoogleCalendarConsentPanel context={loaded.status.context} saved={loaded.status.state === 'active'} simulated/>}
    {loaded?.status.state === 'active' && !loaded.status.context && <p>Calendar consent is saved.</p>}
    {jobId && loaded && <SyntheticCalendarJobStatus key={jobId + loaded.recoveryEpoch} jobId={jobId} recoveryEpoch={loaded.recoveryEpoch}/>}
    {(!loaded || loaded.status.state === 'review') && !busy && <button className="secondary" type="button"
      onClick={() => void loadState(undefined, true)}>Check setup status</button>}
  </section>;
}
