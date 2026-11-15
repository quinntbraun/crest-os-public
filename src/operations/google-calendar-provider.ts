import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { customerUuid } from '../customer/customer-contract.ts';
import { calendarEventId, requireCalendarProjection } from './google-calendar-projection.ts';
import { calendarEventEtag, confirmGoogleCalendarProjection } from './google-calendar-reconciliation.ts';
import type { CalendarObservation, CalendarMutation, ConfirmedCalendarEvent } from './google-calendar-reconciliation.ts';

type RequestKind = 'read_event' | 'verify_destination' | CalendarMutation['action'];
type ProviderState = 'paused' | 'delayed' | 'reconnect' | 'review' | 'uncertain';
type ProviderResult =
  | Readonly<{ state: 'present'; event: unknown }>
  | Readonly<{ state: 'missing' | 'removed' | ProviderState }>;
type ProviderObservation = CalendarObservation | Readonly<{ state: 'paused' }> |
  Readonly<{ state: 'delayed' }> | Readonly<{ state: 'reconnect' }>;
type MutationResult = Readonly<{ state: 'confirmed'; confirmed: ConfirmedCalendarEvent }> |
  Readonly<{ state: 'removed' | ProviderState }>;

const responseLimit = 64 * 1024;
const googleCalendarBase = 'https://www.googleapis.com/calendar/v3/calendars/';

export function googleCalendarMutationBody(mutation: CalendarMutation): string {
  if (mutation.action === 'delete') return '';
  const event = mutation.desired;
  return JSON.stringify({
    id: event.id, summary: event.summary, description: event.description, location: event.location ?? '',
    start: { dateTime: event.start.dateTime, timeZone: event.start.timeZone },
    end: { dateTime: event.end.dateTime, timeZone: event.end.timeZone },
    status: 'confirmed', visibility: 'private', transparency: 'opaque', reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { crestMapping: event.extendedProperties.private.crestMapping } },
  });
}

export async function readGoogleCalendarJson(response: Response, signal: AbortSignal, limit = responseLimit): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const length = response.headers.get('content-length');
  if (!/^application\/json\s*(?:;|$)/i.test(contentType) || (length !== null &&
    (!/^\d{1,10}$/.test(length) || Number(length) > limit))) throw Error();
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, json = '';
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw Error();
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode()) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function isGoogleCalendarQuotaError(value: unknown) {
  if (value === null || typeof value !== 'object' || !('error' in value)) return false;
  const error = value.error;
  if (error === null || typeof error !== 'object' || !('errors' in error) || !Array.isArray(error.errors)) return false;
  return error.errors.length > 0 && error.errors.every((entry: unknown) =>
    entry !== null && typeof entry === 'object' && 'reason' in entry &&
    (entry.reason === 'rateLimitExceeded' || entry.reason === 'userRateLimitExceeded' || entry.reason === 'quotaExceeded'));
}

// Trusted server adapter only. Admission must atomically reserve the shared
// project budget and recheck destination, lease, generation and recovery
// authority. Each network attempt, including destination verification, uses it.
// The worker retains the mutation before calling apply and fences finalization.
export function createGoogleCalendarProvider(config: Readonly<{
  calendarId: string;
  eventUuid: string;
  marker: string;
  admit: (kind: RequestKind, signal: AbortSignal) => Promise<string | Readonly<{ state: 'delayed' }> | null>;
  request?: typeof fetch;
  timeoutMs?: number;
}>) {
  const { calendarId, marker, admit } = config;
  const fetchGoogle = config.request ?? fetch, timeoutMs = config.timeoutMs ?? 8000;
  const eventId = calendarEventId(config.eventUuid);
  requireCalendarProjection(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group\.calendar\.google\.com$/.test(calendarId) &&
    customerUuid(marker) && marker !== config.eventUuid && marker !== '00000000-0000-0000-0000-000000000000' &&
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15_000);
  const calendarUrl = googleCalendarBase + encodeURIComponent(calendarId);
  const eventsUrl = calendarUrl + '/events';
  const eventUrl = eventsUrl + '/' + eventId;

  async function request(kind: RequestKind, url: string, method: string, signal: AbortSignal, payload?: string, etag?: string): Promise<ProviderResult> {
    const writing = method !== 'GET';
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let token: string | Readonly<{ state: 'delayed' }> | null;
    try {
      bounded.throwIfAborted();
      token = await admit(kind, bounded);
      bounded.throwIfAborted();
      if (token && typeof token === 'object' && token.state === 'delayed') return { state: 'delayed' };
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(token)) return { state: 'paused' };
    } catch {
      return { state: 'paused' };
    }
    let response: Response | undefined;
    try {
      response = await fetchGoogle(url, {
        method, signal: bounded, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: {
          authorization: 'Bearer ' + token, accept: 'application/json',
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(etag === undefined ? {} : { 'if-match': etag }),
        },
        ...(payload === undefined ? {} : { body: payload }),
      });
      bounded.throwIfAborted();
      if (response.status === 401) return { state: 'reconnect' };
      if (response.status === 429) return { state: 'delayed' };
      if (response.status === 403) return { state: isGoogleCalendarQuotaError(await readGoogleCalendarJson(response, bounded)) ? 'delayed' : 'review' };
      if (response.status >= 500) return { state: writing ? 'uncertain' : 'delayed' };
      if (response.status === 409 && kind === 'insert') return { state: 'uncertain' };
      if (response.status === 404 && kind === 'read_event') return { state: 'missing' };
      if (response.status === 204 && kind === 'delete') return { state: 'removed' };
      if (response.status !== 200 && !(kind === 'insert' && response.status === 201)) return { state: 'review' };
      if (kind === 'delete') return { state: 'uncertain' };
      return { state: 'present', event: await readGoogleCalendarJson(response, bounded) };
    } catch {
      // Network errors may include URLs, tokens and provider payloads. Return
      // only a stable classification, and preserve unknown write outcomes.
      return { state: writing && response?.status !== 403 ? 'uncertain' : response ? 'review' : 'delayed' };
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
    }
  }

  async function observe(signal: AbortSignal): Promise<ProviderObservation> {
    const result = await request('read_event', eventUrl, 'GET', signal);
    if (result.state === 'present') return result;
    if (result.state === 'paused' || result.state === 'delayed' || result.state === 'reconnect') return { state: result.state };
    if (result.state !== 'missing') return { state: 'review' };
    const destination = await request('verify_destination', calendarUrl + '?fields=id', 'GET', signal);
    if (destination.state === 'paused' || destination.state === 'delayed' || destination.state === 'reconnect') return { state: destination.state };
    if (destination.state !== 'present' || destination.event === null || typeof destination.event !== 'object' ||
      !('id' in destination.event) || destination.event.id !== calendarId) return { state: 'review' };
    return { state: 'missing', destinationVerified: true };
  }

  async function apply(mutation: CalendarMutation, signal: AbortSignal, retainedBody?: string): Promise<MutationResult> {
    const previous = mutation.action === 'insert' ? null : mutation.previous;
    const desired = mutation.action === 'delete' ? null : mutation.desired;
    if ((previous && (previous.event.id !== eventId || previous.event.extendedProperties.private.crestMapping !== marker ||
      !calendarEventEtag(previous.etag))) ||
      (desired && (desired.id !== eventId || desired.extendedProperties.private.crestMapping !== marker))) {
      return { state: 'review' };
    }
    // List only managed fields. A persisted row cannot add arbitrary provider
    // fields by smuggling extra properties into a body.
    const payload = desired ? googleCalendarMutationBody(mutation) : undefined;
    if (retainedBody !== undefined) {
      try {
        const equal = payload ? isDeepStrictEqual(JSON.parse(payload), JSON.parse(retainedBody)) : retainedBody === '';
        if (!equal || Buffer.byteLength(retainedBody, 'utf8') > 8192) return { state: 'review' };
      } catch { return { state: 'review' }; }
    }
    if (payload && Buffer.byteLength(payload, 'utf8') > 8192) return { state: 'review' };
    const method = { insert: 'POST', update: 'PUT', delete: 'DELETE' }[mutation.action];
    const url = (mutation.action === 'insert' ? eventsUrl : eventUrl) + '?sendUpdates=none';
    const result = await request(mutation.action, url, method, signal, payload === undefined ? undefined : retainedBody ?? payload, previous?.etag);
    if (result.state === 'present') {
      const confirmed = desired && confirmGoogleCalendarProjection(result.event, desired);
      return confirmed ? { state: 'confirmed', confirmed } : { state: 'uncertain' };
    }
    return { state: result.state === 'missing' ? 'review' : result.state };
  }
  return { observe, apply };
}
