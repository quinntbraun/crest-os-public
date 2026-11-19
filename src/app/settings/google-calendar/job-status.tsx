'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readSyntheticCalendarJobStatus } from '../../../client/google-calendar-consent';
import type { GoogleCalendarJobStatus } from '../../../operations/google-calendar-job-status';

const descriptions: Record<GoogleCalendarJobStatus['state'], string> = {
  disconnected: 'Calendar is disconnected.',
  not_queued: 'This saved appointment has no Calendar update queued.',
  pending: 'A Calendar update is waiting.',
  in_progress: 'A Calendar update is in progress.',
  synced: 'The current appointment is synced to the fictional calendar.',
  removed: 'The cancelled appointment has no active event in the fictional calendar.',
  delayed: 'A Calendar update is delayed. Crest has yet to confirm the original result.',
  reconnect: 'Reconnect Calendar to continue.',
  review: 'Review the Calendar connection before sending any further changes.',
};
const timestamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
export const calendarJobStatusLabels: Record<GoogleCalendarJobStatus['state'], string> = {
  disconnected: 'Disconnected', not_queued: 'Not queued', pending: 'Waiting', in_progress: 'In progress',
  synced: 'Synced · fictional', removed: 'Removed · fictional', delayed: 'Unconfirmed', reconnect: 'Reconnect', review: 'Needs review',
};

export function SyntheticCalendarJobStatus({ jobId, recoveryEpoch, appointmentSequence }: { jobId: string; recoveryEpoch: string; appointmentSequence?:string }) {
  const [status, setStatus] = useState<GoogleCalendarJobStatus | null>(null);
  const [message, setMessage] = useState('Checking Calendar status…');
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const active = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (active.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController(), { signal } = controller;
    active.current = controller;
    setStatus(null);
    setCheckFailed(false);
    setBusy(true);
    setMessage('Checking Calendar status…');
    try {
      const result = await readSyntheticCalendarJobStatus(jobId, recoveryEpoch, signal);
      if (!signal.aborted) {
        if(appointmentSequence&&result.appointmentVersion!==appointmentSequence){
          setCheckFailed(true);
          setMessage('The appointment changed. Reload appointment activity before reviewing its sync.');
          return;
        }
        setStatus(result);
        setMessage(descriptions[result.state]);
      }
    } catch {
      if (!signal.aborted) {
        setCheckFailed(true);
        setMessage('Crest could not verify Calendar status for this saved job.');
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, [jobId, recoveryEpoch, appointmentSequence]);

  useEffect(() => {
    function hide() {
      active.current?.abort();
      active.current = null;
      setStatus(null);
      setCheckFailed(false);
      setMessage('Check Calendar status to reload.');
      setBusy(false);
    }
    function visibility() { if (document.visibilityState === 'hidden') hide(); else void check(); }
    function restore(event: PageTransitionEvent) { if (event.persisted) void check(); }
    const initial = window.setTimeout(() => void check(), 0);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      window.clearTimeout(initial);
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, [check]);

  return <section className="calendar-job-summary" aria-label="Saved appointment sync" aria-busy={busy}>
    <h2 tabIndex={-1}>Saved appointment sync</h2>
    <p className="field-help">Fictional calendar · No events are sent to Google.</p>
    <ul className="calendar-activity-list" role="list" aria-label="Appointment sync activity">
    <li className="calendar-activity-row" data-state={busy?'checking':status?.state??(checkFailed?'failed':'unverified')}>
    <div className="calendar-activity-body">
      <div className="calendar-activity-heading"><h3>Selected appointment</h3><span className="calendar-activity-state">{busy?'Checking':status?calendarJobStatusLabels[status.state]:checkFailed?'Check failed':'Not verified'}</span></div>
      <p role="status">{message}</p>
      {status&&<p className="calendar-activity-version">Appointment version <strong>{status.appointmentVersion}</strong></p>}
      {status?.lastConfirmedAt && <details className="calendar-sync-evidence"><summary>Sync evidence</summary><dl className="calendar-setup-facts">
        <div><dt>Last successful sync</dt><dd><time dateTime={status.lastConfirmedAt}>{timestamp.format(new Date(status.lastConfirmedAt))} UTC</time></dd></div>
        <div><dt>Confirmed appointment version</dt><dd>{status.lastConfirmedVersion} of {status.appointmentVersion}</dd></div>
      </dl></details>}
    </div>
    <div className="calendar-settings-actions calendar-activity-actions">
      <button className="secondary" type="button" disabled={busy} onClick={() => void check()}>Check Calendar status</button>
      <a href={'/schedule?job=' + jobId}>Open saved job</a>
    </div>
    </li></ul>
  </section>;
}
