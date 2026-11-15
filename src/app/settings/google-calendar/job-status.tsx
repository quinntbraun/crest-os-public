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

export function SyntheticCalendarJobStatus({ jobId, recoveryEpoch }: { jobId: string; recoveryEpoch: string }) {
  const [status, setStatus] = useState<GoogleCalendarJobStatus | null>(null);
  const [message, setMessage] = useState('Checking Calendar status…');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (active.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController(), { signal } = controller;
    active.current = controller;
    setStatus(null);
    setBusy(true);
    setMessage('Checking Calendar status…');
    try {
      const result = await readSyntheticCalendarJobStatus(jobId, recoveryEpoch, signal);
      if (!signal.aborted) {
        setStatus(result);
        setMessage(descriptions[result.state]);
      }
    } catch {
      if (!signal.aborted) setMessage('Crest could not verify Calendar status for this saved job.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, [jobId, recoveryEpoch]);

  useEffect(() => {
    function hide() {
      active.current?.abort();
      active.current = null;
      setStatus(null);
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

  return <section aria-label="Saved appointment sync" aria-busy={busy}>
    <h2>Saved appointment sync</h2>
    <p role="status">{message}</p>
    {status?.lastConfirmedAt && <p className="field-help">
      Last confirmed version {status.lastConfirmedVersion} of {status.appointmentVersion} ·{' '}
      <time dateTime={status.lastConfirmedAt}>{timestamp.format(new Date(status.lastConfirmedAt))} UTC</time>
    </p>}
    <button className="secondary" type="button" disabled={busy} onClick={() => void check()}>Check Calendar status</button>
    {' '}<a href={'/schedule?job=' + jobId}>Open saved job</a>
  </section>;
}
