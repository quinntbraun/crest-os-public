import 'server-only';
import { customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { isGoogleCalendarQuotaError, readGoogleCalendarJson } from './google-calendar-provider.ts';
import type { GoogleCalendarRetainedGrant } from './google-calendar-oauth-transport.ts';

const calendarApi = 'https://www.googleapis.com/calendar/v3/calendars/';
const calendarTitle = 'Crest Jobs';
const calendarIdPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group\.calendar\.google\.com$/;
const calendarOwnerPattern = /^[^\s@\p{Cc}\p{Cf}\p{Cs}]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u;

export type GoogleCalendarDestinationContext = Readonly<{
  businessId: string;
  actorId: string;
  recoveryEpoch: string;
  connectionGeneration: string;
  attemptId: string;
}>;

export type ReviewedGoogleCalendarDestination = Readonly<{
  destinationId: string;
  providerCalendarId: string;
  reviewedCalendarOwner: string;
}>;

type Verification =
  | Readonly<{ state: 'verified'; destinationId: string }>
  | Readonly<{ state: 'paused' | 'delayed' | 'reconnect' | 'review' }>;

// Both callbacks are trusted server boundaries. The review lookup must prove
// retained app-created provenance and the separately reviewed account, and
// admission must commit the one request under the same OAuth attempt and quota.
export type GoogleCalendarDestinationReview = Readonly<{
  admit: (context: GoogleCalendarDestinationContext, signal: AbortSignal) => Promise<unknown>;
}>;

export function createGoogleCalendarDestinationVerifier(config: Readonly<{
  request: typeof fetch;
  review: GoogleCalendarDestinationReview;
  timeoutMs?: number;
}>) {
  const { request, review } = config;
  const timeoutMs = config.timeoutMs ?? 8_000;
  if (typeof request !== 'function' || typeof review?.admit !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15_000) throw Error('GOOGLE_CALENDAR_DESTINATION_CONFIGURATION_REQUIRED');

  return async function verify(context: GoogleCalendarDestinationContext, grant: GoogleCalendarRetainedGrant,
    external: AbortSignal): Promise<Verification> {
    const { businessId, actorId, recoveryEpoch, connectionGeneration, attemptId } = context;
    if (![businessId, actorId, recoveryEpoch, attemptId].every(customerUuid) || !customerVersion(connectionGeneration, true)) {
      return { state: 'review' };
    }
    const signal = AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]);
    const binding = Object.freeze({ businessId, actorId, recoveryEpoch, connectionGeneration, attemptId });
    let target: ReviewedGoogleCalendarDestination;
    try {
      signal.throwIfAborted();
      const value = await review.admit(binding, signal);
      signal.throwIfAborted();
      if (value === null) return { state: 'paused' };
      if (!exact(value, ['destinationId', 'providerCalendarId', 'reviewedCalendarOwner']) || !customerUuid(value.destinationId) ||
        typeof value.providerCalendarId !== 'string' || !calendarIdPattern.test(value.providerCalendarId) ||
        typeof value.reviewedCalendarOwner !== 'string' || value.reviewedCalendarOwner.length > 254 ||
        !calendarOwnerPattern.test(value.reviewedCalendarOwner)) return { state: 'review' };
      target = Object.freeze({ destinationId: value.destinationId, providerCalendarId: value.providerCalendarId,
        reviewedCalendarOwner: value.reviewedCalendarOwner });
    } catch { return { state: 'paused' }; }

    if (grant.expiresAt <= Date.now()) return { state: 'reconnect' };
    const endpoint = calendarApi + encodeURIComponent(target.providerCalendarId) + '?fields=kind,id,summary,dataOwner';
    let response: Response | undefined;
    try {
      const { accessToken } = grant.forPrivateCredentialStore();
      response = await request(endpoint, { method: 'GET', signal, credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' } });
      signal.throwIfAborted();
      if (response.redirected || (response.url && response.url !== endpoint)) return { state: 'review' };
      if (response.status === 401) return { state: 'reconnect' };
      if (response.status === 429 || response.status >= 500) return { state: 'delayed' };
      if (response.status === 403) {
        return { state: isGoogleCalendarQuotaError(await readGoogleCalendarJson(response, signal, 4096)) ? 'delayed' : 'review' };
      }
      if (response.status !== 200) return { state: 'review' };
      const calendar = await readGoogleCalendarJson(response, signal, 4096);
      if (!exact(calendar, ['kind', 'id', 'summary', 'dataOwner']) || calendar.kind !== 'calendar#calendar' ||
        calendar.id !== target.providerCalendarId || calendar.summary !== calendarTitle ||
        calendar.dataOwner !== target.reviewedCalendarOwner) return { state: 'review' };
      // This confirms the retained target's metadata only. Calendar access
      // does not identify the authorized Google subject or prove private ACLs.
      return { state: 'verified', destinationId: target.destinationId };
    } catch { return { state: response ? 'review' : 'delayed' }; }
    finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }
  };
}
