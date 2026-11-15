import { authentication } from './authentication';
import { exactCustomerObject as exact, customerUuid as uuid } from '../customer/customer-contract';
import { binding } from './business-settings';
import type { CalendarDisclosure } from '../operations/google-calendar-projection';
import { parseGoogleCalendarJobStatus } from '../operations/google-calendar-job-status';

export type CalendarConsentContext = Readonly<{ destinationId: string; credentialId: string; recoveryEpoch: string }>;
export type CalendarConsentReference = CalendarConsentContext & Readonly<{ reviewId: string }>;
export type CalendarConsentReceipt = Readonly<{ state: 'active'; consentId: string; generation: '1' }>;
export type CalendarConsentStatus = CalendarConsentReceipt | Readonly<{ state: 'absent' | 'changed' }>;
export type CalendarSetupState =
  | Readonly<{ state: 'ready' | 'active' | 'review'; context: null }>
  | Readonly<{ state: 'staged' | 'active'; context: CalendarConsentContext }>;

const contextKeys = ['destinationId', 'credentialId', 'recoveryEpoch'];
const flagKeys = ['clientName', 'serviceLabel', 'workAddress'] as const;
const reviewKeys = ['schemaVersion', 'reviewId', 'destinationId', 'credentialId', 'expiresAt', 'providerCalendarId', 'googleOwner',
  'disclosure', 'payloadVersion', 'calendarName', 'example', 'sharingReview', 'notificationReview'];
const eventKeys = ['id', 'summary', 'description', 'start', 'end', 'status', 'visibility', 'transparency', 'reminders', 'extendedProperties'];
const referenceKeys = [...contextKeys, 'reviewId'];

function requireConsent(condition: unknown): asserts condition {
  if (!condition) throw Error('GOOGLE_CALENDAR_CONSENT_CLIENT_FAILED');
}

function contextFields(value: CalendarConsentContext): CalendarConsentContext {
  requireConsent(value && contextKeys.every(key => uuid(value[key as keyof CalendarConsentContext])));
  const { destinationId, credentialId, recoveryEpoch } = value;
  return { destinationId, credentialId, recoveryEpoch };
}

function referenceFields(value: CalendarConsentReference): CalendarConsentReference {
  requireConsent(uuid(value?.reviewId));
  return { ...contextFields(value), reviewId: value.reviewId };
}

function matchingContext(a: CalendarConsentContext, b: CalendarConsentContext) {
  return a.destinationId === b.destinationId && a.credentialId === b.credentialId && a.recoveryEpoch === b.recoveryEpoch;
}

export function googleCalendarConsentReferenceStore(context: CalendarConsentContext,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const pinned = contextFields(context);
  const key = 'crest.calendar-consent.pending.v1';
  function read() {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    requireConsent(raw.length <= 256);
    const value: unknown = JSON.parse(raw);
    requireConsent(exact(value, referenceKeys) && uuid(value.destinationId) && uuid(value.credentialId) &&
      uuid(value.recoveryEpoch) && uuid(value.reviewId));
    const reference = referenceFields({ destinationId: value.destinationId, credentialId: value.credentialId,
      recoveryEpoch: value.recoveryEpoch, reviewId: value.reviewId });
    requireConsent(matchingContext(reference, pinned));
    return reference;
  }
  function matches(value: CalendarConsentReference) {
    const current = read();
    return !!current && matchingContext(current, value) && current.reviewId === value.reviewId;
  }
  return {
    read,
    retain(value: CalendarConsentReference) {
      const reference = referenceFields(value);
      requireConsent(matchingContext(reference, pinned) && read() === null);
      storage.setItem(key, JSON.stringify(reference));
      requireConsent(matches(reference));
    },
    clear(value: CalendarConsentReference) {
      requireConsent(matches(value));
      storage.removeItem(key);
      requireConsent(read() === null);
    },
  };
}

function visibleText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    !/[\p{Cc}\p{Cs}\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(value);
}

function clock(value: unknown) {
  requireConsent(exact(value, ['dateTime', 'timeZone']) && visibleText(value.dateTime, 32) && visibleText(value.timeZone, 100) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.dateTime) && Number.isFinite(Date.parse(value.dateTime)));
  // Validate the provider time zone before it reaches the formatter.
  new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone });
  return { dateTime: value.dateTime, timeZone: value.timeZone };
}

function example(value: unknown, flags: CalendarDisclosure) {
  requireConsent(exact(value, flags.workAddress ? [...eventKeys, 'location'] : eventKeys) &&
    typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) && value.status === 'confirmed' &&
    value.visibility === 'private' && value.transparency === 'opaque' && exact(value.reminders, ['useDefault']) &&
    value.reminders.useDefault === false && exact(value.extendedProperties, ['private']) &&
    exact(value.extendedProperties.private, ['crestMapping']) && uuid(value.extendedProperties.private.crestMapping));
  const title = ['Crest job', flags.serviceLabel && 'Sample Detail', flags.clientName && 'Sample Client'].filter(Boolean).join(' · ');
  requireConsent(value.summary === title && (flags.workAddress ? value.location === '123 Sample Lane' : value.location === undefined));
  const prefix = 'View the saved appointment in Crest OS: ';
  requireConsent(visibleText(value.description, 512) && value.description.startsWith(prefix));
  const url = new URL(value.description.slice(prefix.length));
  const job = url.searchParams.get('job');
  requireConsent(url.protocol === 'https:' && url.origin === window.location.origin && url.pathname === '/schedule' &&
    uuid(job) && url.href === url.origin + '/schedule?job=' + job);
  const start = clock(value.start), end = clock(value.end);
  requireConsent(start.timeZone === end.timeZone && Date.parse(start.dateTime) < Date.parse(end.dateTime));
  return { title, start, end, location: flags.workAddress ? '123 Sample Lane' : null };
}

function selectedFields(value: CalendarDisclosure): CalendarDisclosure {
  requireConsent(exact(value, flagKeys) && flagKeys.every(key => typeof value[key] === 'boolean'));
  return { clientName: value.clientName, serviceLabel: value.serviceLabel, workAddress: value.workAddress };
}

function previewResult(value: unknown, context: CalendarConsentContext, selected: CalendarDisclosure) {
  requireConsent(exact(value, reviewKeys) && value.schemaVersion === 1 && value.payloadVersion === 1 &&
    value.destinationId === context.destinationId && value.credentialId === context.credentialId && uuid(value.reviewId) &&
    value.calendarName === 'Crest Jobs' && visibleText(value.providerCalendarId, 280) &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group\.calendar\.google\.com$/.test(value.providerCalendarId) &&
    visibleText(value.googleOwner, 254) && /^[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value.googleOwner) &&
    visibleText(value.sharingReview, 400) && visibleText(value.notificationReview, 400) && typeof value.expiresAt === 'string');
  const disclosure = value.disclosure;
  requireConsent(exact(disclosure, flagKeys) && flagKeys.every(key => disclosure[key] === selected[key]));
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  requireConsent(Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + 660000);
  return { reference: referenceFields({ ...context, reviewId: value.reviewId }), expiresAt, calendarName: value.calendarName,
    googleOwner: value.googleOwner, sharingReview: value.sharingReview, notificationReview: value.notificationReview,
    example: example(value.example, selected) };
}

function receipt(value: unknown, reference: CalendarConsentReference): CalendarConsentReceipt {
  requireConsent(exact(value, ['schemaVersion', 'state', 'destinationId', 'consentId', 'generation']) &&
    value.schemaVersion === 1 && value.state === 'active' && value.destinationId === reference.destinationId &&
    uuid(value.consentId) && value.generation === '1');
  return { state: 'active', consentId: value.consentId, generation: value.generation };
}

async function post(route: 'consent/preview' | 'consent/confirm' | 'consent/status' | 'setup-state' | 'stage-fictional' | 'job-status',
  body: object, external: AbortSignal): Promise<unknown> {
  const signal = AbortSignal.any([external, AbortSignal.timeout(40000)]);
  signal.throwIfAborted();
  const proof = await authentication.session(signal);
  requireConsent(binding.test(proof.csrfToken) && proof.expiresAt > Date.now());
  signal.throwIfAborted();
  const response = await fetch('/api/business/google-calendar/' + route, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { 'content-type': 'application/json', 'x-crest-csrf': proof.csrfToken }, body: JSON.stringify(body), signal,
  });
  const reader = response.body?.getReader();
  requireConsent(reader);
  let size = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    requireConsent(response.status === 200 && /^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '') &&
      response.headers.get('cache-control')?.includes('no-store'));
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      requireConsent(part.value.byteLength > 0 && (size += part.value.byteLength) <= 8192);
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const json = text + decoder.decode();
  const value: unknown = JSON.parse(json);
  // These responses contain small plain objects. Reject duplicate JSON names.
  const nodes = [value];
  let fields = 0;
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    requireConsent(!Array.isArray(node));
    const children = Object.values(node) as unknown[];
    fields += children.length;
    requireConsent(fields <= 40);
    nodes.push(...children);
  }
  requireConsent((json.match(/"(?:[^"\\]|\\.)*"|:/g) ?? []).filter(token => token === ':').length === fields);
  return value;
}

export const googleCalendarConsent = Object.freeze({
  async preview(context: CalendarConsentContext, selection: CalendarDisclosure, signal: AbortSignal) {
    const bound = contextFields(context), selected = selectedFields(selection);
    return previewResult(await post('consent/preview', { ...bound, ...selected }, signal), bound, selected);
  },
  async confirm(reference: CalendarConsentReference, selection: CalendarDisclosure, signal: AbortSignal) {
    const bound = referenceFields(reference);
    return receipt(await post('consent/confirm', { ...bound, ...selectedFields(selection),
      payloadReviewed: true, sharingReviewed: true, notificationsReviewed: true }, signal), bound);
  },
  async status(reference: CalendarConsentReference, signal: AbortSignal): Promise<CalendarConsentStatus> {
    const bound = referenceFields(reference);
    const value = await post('consent/status', bound, signal);
    if (exact(value, ['schemaVersion', 'state']) && value.schemaVersion === 1 &&
      (value.state === 'absent' || value.state === 'changed')) return { state: value.state };
    return receipt(value, bound);
  },
});

export async function readSyntheticCalendarJobStatus(jobId: string, recoveryEpoch: string, signal: AbortSignal) {
  requireConsent(uuid(jobId) && uuid(recoveryEpoch));
  return parseGoogleCalendarJobStatus(await post('job-status', { jobId, recoveryEpoch }, signal), jobId);
}

export async function readSyntheticCalendarSetup(recoveryEpoch: string, signal: AbortSignal, stage = false): Promise<CalendarSetupState> {
  requireConsent(uuid(recoveryEpoch));
  const value = stage ? await post('stage-fictional', { recoveryEpoch, confirmed: true }, signal)
    : await post('setup-state', { recoveryEpoch }, signal);
  if (exact(value, ['schemaVersion', 'state']) && value.schemaVersion === 1 &&
    (value.state === 'ready' || value.state === 'review' || value.state === 'active')) return { state: value.state, context: null };
  requireConsent(exact(value, ['schemaVersion', 'state', ...contextKeys]) && value.schemaVersion === 1 &&
    (value.state === 'staged' || value.state === 'active') && uuid(value.destinationId) && uuid(value.credentialId) &&
    value.recoveryEpoch === recoveryEpoch);
  return { state: value.state, context: { destinationId: value.destinationId, credentialId: value.credentialId, recoveryEpoch } };
}
