import 'server-only';
import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readGoogleCalendarJson } from './google-calendar-provider.ts';
import type { GoogleCalendarRetainedGrant } from './google-calendar-oauth-transport.ts';

const endpoint = 'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner';
const title = 'Crest Jobs';
const markerPrefix = 'Crest OS calendar reference ';
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group\.calendar\.google\.com$/;
const ownerPattern = /^[^\s@\p{Cc}\p{Cf}\p{Cs}]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u;

type Outcome =
  | Readonly<{ state: 'created'; providerCalendarId: string; observedGoogleOwner: string; marker: string }>
  | Readonly<{ state: 'review' | 'uncertain' }>;

// No automatic creation/retry. The caller supplies a previously confirmed
// attempt and a newly exchanged exact-scope grant, with one committed quota
// admission and append-only result recording for this specific operation.
export function createGoogleCalendarSecondaryCreator(config: Readonly<{
  request: typeof fetch;
  admit: (attemptId: string, signal: AbortSignal) => Promise<unknown>;
  finish: (attemptId: string, outcome: Outcome, signal: AbortSignal) => Promise<boolean>;
  timeoutMs?: number;
}>) {
  const { request, admit, finish } = config, timeoutMs = config.timeoutMs ?? 8_000;
  if (typeof request !== 'function' || typeof admit !== 'function' || typeof finish !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15_000) throw Error('GOOGLE_CALENDAR_CREATION_CONFIGURATION_REQUIRED');

  return async (attemptId: string, grant: GoogleCalendarRetainedGrant, external: AbortSignal) => {
    if (!customerUuid(attemptId) || external.aborted || grant.expiresAt <= Date.now()) return { state: 'paused' as const };
    const signal = AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]);
    let admitted: unknown;
    try { admitted = await admit(attemptId, signal); }
    catch { return { state: 'uncertain' as const }; }
    if (admitted === null) return { state: 'paused' as const };
    if (!exact(admitted, ['correlationMarker', 'reviewedGoogleOwner']) || !customerUuid(admitted.correlationMarker) ||
      typeof admitted.reviewedGoogleOwner !== 'string' || admitted.reviewedGoogleOwner.length > 254 ||
      !ownerPattern.test(admitted.reviewedGoogleOwner)) return { state: 'uncertain' as const };
    const marker = admitted.correlationMarker, description = markerPrefix + marker;
    let outcome: Outcome = { state: 'uncertain' };
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      const { accessToken } = grant.forPrivateCredentialStore();
      response = await request(endpoint, {
        method: 'POST', signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ summary: title, description }),
      });
      signal.throwIfAborted();
      if (!response.redirected && (!response.url || response.url === endpoint) && (response.status === 200 || response.status === 201)) {
        const calendar = await readGoogleCalendarJson(response, signal, 4096);
        if (exact(calendar, ['kind', 'id', 'summary', 'description', 'dataOwner']) && calendar.kind === 'calendar#calendar' &&
          typeof calendar.id === 'string' && idPattern.test(calendar.id) && calendar.summary === title &&
          calendar.description === description && calendar.dataOwner === admitted.reviewedGoogleOwner) {
          outcome = { state: 'created', providerCalendarId: calendar.id, observedGoogleOwner: admitted.reviewedGoogleOwner, marker };
        } else outcome = { state: 'review' };
      }
    } catch { /* a failed response does not establish that no calendar was created */ }
    finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }
    try {
      if (await finish(attemptId, outcome, external)) {
        // Exact provider identifiers and owner evidence remain on the server.
        return { state: outcome.state };
      }
    } catch { /* a lost persistence acknowledgement cannot justify a retry */ }
    return { state: 'uncertain' as const };
  };
}
