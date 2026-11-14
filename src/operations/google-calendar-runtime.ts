import 'server-only';
import { customerUuid as uuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readBrowserCookies } from '../security/browser-http.ts';
import { privateJsonResponse, readFlatJsonBody } from '../security/private-http.ts';
import { createRequestProtection } from '../security/request-protection.ts';
import { sessionCredentialHash } from '../security/session-credential.ts';
import { createSessionLifecycle } from '../security/session-lifecycle.ts';
import { createSessionRequestAdmission } from '../security/session-request-admission.ts';
import { createSessionCsrfVerifier } from '../security/session-request-guard.ts';
import { createTrustedTransport } from '../security/trusted-transport.ts';
import { createGoogleCalendarConnection } from './google-calendar-connection.ts';
import { createGoogleCalendarConsentHttp, googleCalendarConsentFailure, googleCalendarConsentPrefix } from './google-calendar-consent-http.ts';
import { syntheticGoogleCalendarSetupDatabase } from './google-calendar-database.ts';
import { parseGoogleCalendarJobStatus } from './google-calendar-job-status.ts';
import { googleCalendarOAuthScope } from './google-calendar-oauth.ts';

export { googleCalendarConsentFailure };
export const googleCalendarRuntimePrefix = '/api/business/google-calendar/';
export const syntheticGoogleCalendarIdentity = Object.freeze({
  clientId: 'crest-fictional-calendar.apps.googleusercontent.com',
  googleOwner: 'calendar-owner@example.test',
  verifierKeyId: 'fictional-calendar-pkce',
  credentialKeyId: 'fictional-calendar-grant',
});

export type SyntheticGoogleCalendarConfiguration = Readonly<{ connectionString: string; calendarKeyMaterial: Uint8Array;
  worker?: Readonly<{ connectionString: string }> }>;
type Config = Parameters<typeof createGoogleCalendarConsentHttp>[0];
type Peer = Parameters<ReturnType<typeof createGoogleCalendarConsentHttp>>[1];
const statePath = googleCalendarRuntimePrefix + 'setup-state';
const stagePath = googleCalendarRuntimePrefix + 'stage-fictional';
const jobStatusPath = googleCalendarRuntimePrefix + 'job-status';
const callbackPath = '/api/google-calendar/callback';
const calendarId = 'crest-fictional-appointments@group.calendar.google.com';

// Entirely in-process. A malformed or newly introduced provider URL fails here
// without reaching the network. No real provider credentials can be configured.
const fictionalProvider: typeof fetch = async (url, init) => {
  if (init?.method === 'POST' && url === 'https://oauth2.googleapis.com/token')
    return Response.json({ access_token: 'fictional-calendar-access', refresh_token: 'fictional-calendar-refresh',
      expires_in: 3600, token_type: 'Bearer', scope: googleCalendarOAuthScope });
  if (init?.method === 'POST' && url === 'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner' &&
    new Headers(init.headers).get('authorization') === 'Bearer fictional-calendar-access' && typeof init.body === 'string') {
    const value: unknown = JSON.parse(init.body);
    if (exact(value, ['summary', 'description']) && value.summary === 'Crest Jobs' && typeof value.description === 'string')
      return Response.json({ kind: 'calendar#calendar', id: calendarId, summary: value.summary, description: value.description,
        dataOwner: syntheticGoogleCalendarIdentity.googleOwner });
  }
  return new Response(null, { status: 400 });
};

function verifiedState(value: unknown, epoch: string) {
  if (exact(value, ['schemaVersion', 'state']) && value.schemaVersion === 1 &&
    (value.state === 'ready' || value.state === 'active' || value.state === 'review')) return value;
  if (exact(value, ['schemaVersion', 'state', 'destinationId', 'credentialId', 'recoveryEpoch']) && value.schemaVersion === 1 &&
    (value.state === 'staged' || value.state === 'active') && uuid(value.destinationId) && uuid(value.credentialId) &&
    value.recoveryEpoch === epoch) return value;
  throw Error('GOOGLE_CALENDAR_SETUP_UNVERIFIED');
}

export function createSyntheticGoogleCalendarRuntime(config: Config, provider: Parameters<typeof createGoogleCalendarConsentHttp>[1],
  tokens: Parameters<typeof createGoogleCalendarConsentHttp>[2], synthetic: SyntheticGoogleCalendarConfiguration) {
  const origin = new URL(config.origin);
  if (config.environment !== 'test' || !uuid(config.businessId) || config.origin !== origin.origin || origin.protocol !== 'https:' ||
    !['127.0.0.1', '[::1]'].includes(origin.hostname) || !(synthetic.calendarKeyMaterial instanceof Uint8Array) ||
    synthetic.calendarKeyMaterial.byteLength !== 32) throw Error('GOOGLE_CALENDAR_SYNTHETIC_CONFIGURATION_REQUIRED');
  const callbackUri = origin.origin + callbackPath;
  const key = Buffer.from(synthetic.calendarKeyMaterial);
  const committedQuery = syntheticGoogleCalendarSetupDatabase({ environment: 'test', connectionString: synthetic.connectionString });
  const composition = createGoogleCalendarConnection({ ...syntheticGoogleCalendarIdentity, callbackUri, clientSecret: 'fictional-calendar-only',
    calendarKeyMaterial: key, committedQuery, request: fictionalProvider }).then(connection => ({
    connection, consent: createGoogleCalendarConsentHttp(config, provider, tokens, connection, true),
  }), () => null);
  const resolve = createTrustedTransport(config), protect = createRequestProtection(config);
  const csrf = createSessionCsrfVerifier(config), admit = createSessionRequestAdmission(config);
  const sessions = createSessionLifecycle(config, provider, tokens);

  return async (request: Request, peer: Peer): Promise<Response> => {
    let hash: Buffer | undefined;
    let authorized = false;
    let staging = false;
    try {
      const url = new URL(request.url);
      const runtime = await composition;
      if (!runtime) return googleCalendarConsentFailure(503);
      if (url.pathname.startsWith(googleCalendarConsentPrefix)) return runtime.consent(request, peer);
      if (![statePath, stagePath, jobStatusPath].includes(url.pathname) || request.url !== origin.origin + url.pathname)
        return googleCalendarConsentFailure(404);
      if (request.method !== 'POST') return googleCalendarConsentFailure(405);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(40000)]);
      signal.throwIfAborted();
      resolve(request, peer);
      protect.requireOrigin(request);
      const cookie = readBrowserCookies(request.headers).session;
      if (!cookie) return googleCalendarConsentFailure();
      const stage = url.pathname === stagePath;
      const jobStatus = url.pathname === jobStatusPath;
      const body = await readFlatJsonBody(new Request(request, { signal }),
        stage ? ['recoveryEpoch', 'confirmed'] : jobStatus ? ['recoveryEpoch', 'jobId'] : ['recoveryEpoch'], 2048);
      if (!uuid(body.recoveryEpoch) || (stage && body.confirmed !== true)) return googleCalendarConsentFailure();
      const jobId = jobStatus ? body.jobId : null;
      if (jobStatus && !uuid(jobId)) return googleCalendarConsentFailure();
      const sessionId = await csrf(request, cookie, signal);
      if (!await admit(cookie, 'ordinary', signal)) return googleCalendarConsentFailure(429, 'GOOGLE_CALENDAR_CONSENT_LIMITED');
      const owner = await sessions.verify(cookie, signal, 'background', !jobStatus);
      if (sessionId !== owner.sessionId || signal.aborted) return googleCalendarConsentFailure();
      authorized = true;
      hash = sessionCredentialHash(cookie);
      const authority = {
        credentialHash: hash, businessId: config.businessId, actorId: owner.actorId, appSessionId: sessionId,
        recoveryEpoch: body.recoveryEpoch, connectionGeneration: '0', authIssuer: owner.provider.issuer,
        authSubject: owner.provider.subject, authProviderSessionId: owner.provider.sessionId, providerValidUntil: owner.provider.expiresAt,
      };
      if (uuid(jobId)) {
        const value = await runtime.connection.jobStatus(authority, jobId, signal);
        if (signal.aborted) return googleCalendarConsentFailure();
        return value === null ? googleCalendarConsentFailure(404) : privateJsonResponse(parseGoogleCalendarJobStatus(value, jobId));
      }
      const readState = async () => verifiedState(await runtime.connection.setupState(authority, signal), authority.recoveryEpoch);
      const current = await readState();
      if (!stage || current.state !== 'ready') return privateJsonResponse(current);

      staging = true;
      const redirect = await runtime.connection.begin(authority, signal);
      const location = redirect.headers.get('location');
      if (!location) throw Error();
      const auth = new URL(location);
      const state = auth.searchParams.get('state');
      const attemptId = state?.split('.')[0];
      if (auth.origin !== 'https://accounts.google.com' || !state || !uuid(attemptId) ||
        !await runtime.connection.confirmCreation(authority, attemptId, syntheticGoogleCalendarIdentity.googleOwner, true, signal))
        throw Error();
      // Exercise the real parsing, PKCE admission, sealing and original-grant
      // promotion. The synthetic callback never enters the browser or router.
      const callback = new Request(callbackUri + '?' + new URLSearchParams({ state, code: 'fictional/calendar-code' }), { signal });
      const result = await runtime.connection.initialCreationCallback(callback, authority, signal);
      if (result.state !== 'staged') throw Error();
      const saved = await readState();
      if (saved.state !== 'staged' || saved.credentialId !== result.credentialId || signal.aborted) throw Error();
      return privateJsonResponse(saved);
    } catch {
      return googleCalendarConsentFailure(staging ? 503 : authorized ? 409 : 400,
        staging ? 'GOOGLE_CALENDAR_SETUP_OUTCOME_UNKNOWN' : 'GOOGLE_CALENDAR_SETUP_UNAVAILABLE');
    } finally { hash?.fill(0); }
  };
}
