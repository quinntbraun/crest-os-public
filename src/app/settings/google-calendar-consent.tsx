'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { googleCalendarConsent, googleCalendarConsentReferenceStore } from '../../client/google-calendar-consent';
import type { CalendarConsentContext, CalendarConsentReference } from '../../client/google-calendar-consent';
import styles from './google-calendar-consent.module.css';

const minimal = { clientName: false, serviceLabel: false, workAddress: false };
const fields = [
  ['clientName', 'Client display name'],
  ['serviceLabel', 'Service label'],
  ['workAddress', 'Work address'],
] as const;
const reviewLabels = [
  ['payload', 'I reviewed the event fields that Crest will share.'],
  ['sharing', 'I checked who can access Crest Jobs in Google Calendar.'],
  ['notifications', 'I checked Calendar notifications and lock-screen previews.'],
] as const;
const simulatedReviewLabels = [
  ['payload', 'I reviewed the example event fields.'],
  ['sharing', 'I read how to check who can access Crest Jobs.'],
  ['notifications', 'I read how to check notifications and lock-screen previews.'],
] as const;
const unreviewed = { payload: false, sharing: false, notifications: false };
type Preview = Awaited<ReturnType<typeof googleCalendarConsent.preview>>;
type Completion = { step: 'active' | 'changed'; message: string };
type State =
  | { step: 'loading' | 'select' | 'blocked'; message: string }
  | Completion
  | { step: 'review'; message: string; preview: Preview }
  | { step: 'pending'; message: string; reference: CalendarConsentReference };

function store(context: CalendarConsentContext) {
  return googleCalendarConsentReferenceStore(context, window.sessionStorage);
}

export function GoogleCalendarConsentPanel({ context, saved = false, simulated = false }:
  { context: CalendarConsentContext | null; saved?: boolean; simulated?: boolean }) {
  if (!context) return null;
  // A new setup/session fence gets a new in-memory review and no stale fields.
  return <StagedCalendarConsent key={context.destinationId + context.credentialId + context.recoveryEpoch}
    context={context} saved={saved} simulated={simulated}/>;
}

function StagedCalendarConsent({ context, saved, simulated }: { context: CalendarConsentContext; saved: boolean; simulated: boolean }) {
  const { destinationId, credentialId, recoveryEpoch } = context;
  const id = useId();
  const [state, setState] = useState<State>({ step: 'loading', message: 'Checking for an interrupted setup…' });
  const [selected, setSelected] = useState(minimal);
  const [reviewed, setReviewed] = useState(unreviewed);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const completed = useRef<Completion | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const acknowledgements = simulated ? simulatedReviewLabels : reviewLabels;

  useEffect(() => {
    function resume() {
      if (completed.current) {
        setState(completed.current);
        return;
      }
      try {
        const pending = store({ destinationId, credentialId, recoveryEpoch }).read();
        setState(pending ? { step: 'pending', reference: pending, message: 'Check whether the earlier consent was saved.' }
          : saved ? { step: 'active', message: 'Crest confirmed that your Calendar consent was saved.' } : { step: 'select', message: '' });
      } catch {
        setState({ step: 'blocked', message: 'Crest could not verify this tab’s setup record. Reopen the original setup before confirming.' });
      }
    }
    function clearPrivateView() {
      active.current?.abort();
      active.current = null;
      setBusy(false);
      setSelected(minimal);
      setReviewed(unreviewed);
      setState({ step: 'loading', message: 'Calendar review is hidden.' });
    }
    function visibility() {
      if (document.visibilityState === 'hidden') clearPrivateView();
      else resume();
    }
    function pageShown(event: PageTransitionEvent) {
      if (event.persisted) resume();
    }
    resume();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', clearPrivateView);
    window.addEventListener('pageshow', pageShown);
    return () => {
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', clearPrivateView);
      window.removeEventListener('pageshow', pageShown);
    };
  }, [destinationId, credentialId, recoveryEpoch, saved]);

  const previewExpiresAt = state.step === 'review' ? state.preview.expiresAt : null;
  useEffect(() => {
    if (previewExpiresAt === null) return;
    const timer = window.setTimeout(() => {
      setReviewed(unreviewed);
      setState(current => current.step === 'review'
        ? { step: 'select', message: 'The review expired. Load a fresh event preview.' } : current);
    }, Math.max(0, previewExpiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [previewExpiresAt]);

  async function run<T>(request: (signal: AbortSignal) => Promise<T>, settle: (result: T) => void, failed: () => void) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const result = await request(controller.signal);
      if (active.current === controller && !controller.signal.aborted) settle(result);
    } catch {
      if (active.current === controller && !controller.signal.aborted) failed();
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        status.current?.focus();
      }
    }
  }

  function preview() {
    if (state.step !== 'select') return;
    setState({ step: 'select', message: 'Loading the event preview…' });
    void run(signal => googleCalendarConsent.preview(context, selected, signal),
      result => {
        setReviewed(unreviewed);
        setState({ step: 'review', message: 'Event preview ready.', preview: result });
      },
      () => setState({ step: 'select', message: 'Crest could not load the preview. Check your connection or sign in again.' }));
  }

  function resolved(reference: CalendarConsentReference, step: 'active' | 'changed') {
    let cleared = true;
    try { store(context).clear(reference); } catch { cleared = false; }
    const message = step === 'active' ? 'Crest confirmed that your Calendar consent was saved.' :
      'The original consent was saved and the connection has changed. Open the current Calendar settings to review it.';
    completed.current = { step, message: cleared ? message : message + ' This tab could not clear the recovery reference.' };
    setState(completed.current);
  }

  function confirm() {
    if (active.current || state.step !== 'review' || !acknowledgements.every(([key]) => reviewed[key])) return;
    if (Date.now() >= state.preview.expiresAt) {
      setReviewed(unreviewed);
      setState({ step: 'select', message: 'The review expired. Load a fresh event preview.' });
      return;
    }
    const { reference } = state.preview;
    try {
      store(context).retain(reference);
    } catch {
      setState({ step: 'blocked', message: 'Confirmation could not start. Crest could not safely retain the recovery reference.' });
      status.current?.focus();
      return;
    }
    setReviewed(unreviewed);
    setState({ step: 'pending', reference, message: 'Saving Calendar consent…' });
    void run(signal => googleCalendarConsent.confirm(reference, selected, signal), () => resolved(reference, 'active'),
      () => setState({ step: 'pending', reference, message: 'Crest could not confirm the save. Check its status before continuing.' }));
  }

  function check() {
    if (state.step !== 'pending') return;
    const { reference } = state;
    setState({ step: 'pending', reference, message: 'Checking the original consent…' });
    void run(signal => googleCalendarConsent.status(reference, signal), result => {
      if (result.state === 'absent') {
        setState({ step: 'pending', reference, message: 'Crest has no confirmed save yet. Check again before starting a new review.' });
      } else {
        resolved(reference, result.state);
      }
    }, () => setState({ step: 'pending', reference, message: 'Crest could not check the original consent. Keep this tab open and try the status check again.' }));
  }

  return <section className={'notice ' + styles.panel} aria-labelledby={id + '-heading'} aria-busy={busy}>
    <h2 id={id + '-heading'}>Google Calendar</h2>
    <p className="field-help">{simulated ? 'Review how confirmed appointments would appear in Crest Jobs.' :
      'Send confirmed appointments to Crest Jobs. Your Crest schedule stays the source of truth.'}</p>
    <p ref={status} tabIndex={-1} role="status" aria-atomic="true" className="field-help">{state.message}</p>
    {state.step === 'select' && <form onSubmit={event => { event.preventDefault(); preview(); }}>
      <p>By default, Google gets a generic job title, an opaque job reference, confirmed times and time zone, and a sign-in link to Crest.</p>
      <details className={styles.options}>
        <summary>Optional details to share</summary>
        <fieldset disabled={busy}>
          <legend className="visually-hidden">Extra event details</legend>
          {fields.map(([key, label]) => <label className="trust" key={key}>
            <input type="checkbox" checked={selected[key]} onChange={event => {
              const checked = event.currentTarget.checked;
              setSelected(current => ({ ...current, [key]: checked }));
            }}/>
            {label}
          </label>)}
        </fieldset>
      </details>
      <button type="submit" disabled={busy}>Review shared event</button>
    </form>}
    {state.step === 'review' && <form onSubmit={event => { event.preventDefault(); confirm(); }}>
      <h3>Review what Google receives</h3>
      <dl className={styles.preview}>
        <dt>Calendar</dt><dd>{state.preview.calendarName}</dd>
        <dt>Google account</dt><dd>{state.preview.googleOwner}</dd>
        <dt>Example event</dt><dd>{state.preview.example.title}</dd>
        <dt>Confirmed time</dt><dd>{formatExampleTime(state.preview.example)}</dd>
        {state.preview.example.location && <><dt>Example location</dt><dd>{state.preview.example.location}</dd></>}
        <dt>Reference and link</dt><dd>Opaque job reference and a link that requires Crest sign-in</dd>
        <dt>Visibility and reminders</dt><dd>Private event with inherited reminders disabled</dd>
      </dl>
      <p className="field-help">This example uses fictional data. Google Calendar sharing and device previews can still expose event details.</p>
      <p className="field-help">{state.preview.sharingReview}</p>
      <p className="field-help">{state.preview.notificationReview}</p>
      <fieldset className={styles.checks} disabled={busy}>
        <legend>{simulated ? 'Before saving fictional consent' : 'Before enabling Calendar sync'}</legend>
        {acknowledgements.map(([key, label]) => <label className="trust" key={key}>
          <input type="checkbox" checked={reviewed[key]} onChange={event => {
            const checked = event.currentTarget.checked;
            setReviewed(current => ({ ...current, [key]: checked }));
          }}/>
          {label}
        </label>)}
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" disabled={busy || !acknowledgements.every(([key]) => reviewed[key])}>Save Calendar consent</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => {
          setReviewed(unreviewed);
          setState({ step: 'select', message: '' });
        }}>Change shared details</button>
      </div>
    </form>}
    {state.step === 'pending' && <button type="button" className="secondary" disabled={busy} onClick={check}>Check save status</button>}
  </section>;
}

function formatExampleTime(example: Preview['example']) {
  const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: example.start.timeZone });
  return formatter.formatRange(new Date(example.start.dateTime), new Date(example.end.dateTime)) + ' · ' +
    example.start.timeZone.replaceAll('_', ' ');
}
