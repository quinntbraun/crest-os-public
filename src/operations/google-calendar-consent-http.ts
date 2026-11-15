import 'server-only';
import { customerUuid } from '../customer/customer-contract.ts';
import { readBrowserCookies } from '../security/browser-http.ts';
import { privateJsonResponse, readFlatJsonBody } from '../security/private-http.ts';
import { createRequestProtection } from '../security/request-protection.ts';
import { sessionCredentialHash } from '../security/session-credential.ts';
import { createSessionLifecycle } from '../security/session-lifecycle.ts';
import { createSessionRequestAdmission } from '../security/session-request-admission.ts';
import { createSessionCsrfVerifier } from '../security/session-request-guard.ts';
import { createTrustedTransport } from '../security/trusted-transport.ts';
import type { IngressConfiguration, transportFromIncomingMessage } from '../security/trusted-transport.ts';
import type { SessionDatabaseConfiguration } from '../security/session-database.ts';
import type { createGoogleCalendarConnection, GoogleCalendarConnectionAuthority } from './google-calendar-connection.ts';

export const googleCalendarConsentPrefix = '/api/business/google-calendar/consent/';
const common = ['destinationId', 'credentialId', 'recoveryEpoch'] as const;
const disclosure = ['clientName', 'serviceLabel', 'workAddress'] as const;
const acknowledgements = ['payloadReviewed', 'sharingReviewed', 'notificationsReviewed'] as const;
const inputs = {
  preview: [...common, ...disclosure],
  confirm: [...common, 'reviewId', ...disclosure, ...acknowledgements],
  status: [...common, 'reviewId'],
} as const;

type Config = SessionDatabaseConfiguration & Readonly<{
  origin: string;
  businessId: string;
  ingress: IngressConfiguration;
}>;
type Connection = Pick<Awaited<ReturnType<typeof createGoogleCalendarConnection>>, 'prepareConsent' | 'confirmConsent' | 'lookupConsent'>;
type Provider = Parameters<typeof createSessionLifecycle>[1];
type Tokens = Parameters<typeof createSessionLifecycle>[2];
type Peer = ReturnType<typeof transportFromIncomingMessage>;

export function googleCalendarConsentFailure(status: 400 | 404 | 405 | 409 | 429 | 503 = 400,
  error = 'GOOGLE_CALENDAR_CONSENT_REQUEST_FAILED') {
  const response = privateJsonResponse({ error }, status);
  if (status === 405) response.headers.set('Allow', 'POST');
  if (status === 429) response.headers.set('Retry-After', '60');
  return response;
}

// Dedicated handler only. No route is installed by constructing this factory.
// The connection receives only the trusted executor's committed SQL calls.
export function createGoogleCalendarConsentHttp(config: Config, provider: Provider, tokens: Tokens,
  connection: Connection, enabled = false): (request: Request, peer: Peer) => Promise<Response> {
  if (enabled !== true) return async () => googleCalendarConsentFailure(404);
  if (!customerUuid(config.businessId)) throw Error('GOOGLE_CALENDAR_CONSENT_CONFIGURATION_REQUIRED');
  const { origin, businessId } = config;
  const protect = createRequestProtection(config);
  const resolve = createTrustedTransport(config);
  const verifyCsrf = createSessionCsrfVerifier(config);
  const admit = createSessionRequestAdmission(config);
  const sessions = createSessionLifecycle(config, provider, tokens);

  return async (request: Request, peer: Peer) => {
    let hash: Buffer | undefined;
    let admitted = false;
    let confirming = false;
    try {
      const url = new URL(request.url);
      const route = url.pathname.slice(googleCalendarConsentPrefix.length) as keyof typeof inputs;
      if (!url.pathname.startsWith(googleCalendarConsentPrefix) || !Object.hasOwn(inputs, route) ||
        request.url !== origin + googleCalendarConsentPrefix + route) return googleCalendarConsentFailure(404);
      if (request.method !== 'POST') return googleCalendarConsentFailure(405);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
      signal.throwIfAborted();
      resolve(request, peer);
      protect.requireOrigin(request);
      const cookie = readBrowserCookies(request.headers).session;
      if (!cookie) return googleCalendarConsentFailure();
      const body = await readFlatJsonBody(new Request(request, { signal }), inputs[route], 2048);
      const { destinationId, credentialId, recoveryEpoch, reviewId, clientName, serviceLabel, workAddress } = body;
      if (!customerUuid(destinationId) || !customerUuid(credentialId) || !customerUuid(recoveryEpoch) ||
        (route !== 'preview' && !customerUuid(reviewId)) ||
        (route !== 'status' && disclosure.some(key => typeof body[key] !== 'boolean')) ||
        (route === 'confirm' && acknowledgements.some(key => body[key] !== true))) return googleCalendarConsentFailure();
      const sessionId = await verifyCsrf(request, cookie, signal);
      admitted = true;
      if (!await admit(cookie, 'ordinary', signal)) return googleCalendarConsentFailure(429, 'GOOGLE_CALENDAR_CONSENT_LIMITED');
      const owner = await sessions.verify(cookie, signal, 'background', true);
      if (sessionId !== owner.sessionId || signal.aborted) return googleCalendarConsentFailure();
      hash = sessionCredentialHash(cookie);
      const authority: GoogleCalendarConnectionAuthority = {
        credentialHash: hash, businessId, actorId: owner.actorId, appSessionId: sessionId, recoveryEpoch,
        connectionGeneration: '0', authIssuer: owner.provider.issuer, authSubject: owner.provider.subject,
        authProviderSessionId: owner.provider.sessionId, providerValidUntil: owner.provider.expiresAt,
      };
      const flags = { clientName: clientName === true, serviceLabel: serviceLabel === true, workAddress: workAddress === true };
      if (route === 'preview') {
        const preview = await connection.prepareConsent(authority, destinationId, credentialId, flags, signal);
        if (!preview || signal.aborted) return googleCalendarConsentFailure(409, 'GOOGLE_CALENDAR_REVIEW_UNAVAILABLE');
        const { reviewId, expiresAt, providerCalendarId, googleOwner, disclosure: selected, payloadVersion, calendarName,
          example, sharingReview, notificationReview } = preview;
        return privateJsonResponse({ schemaVersion: 1, reviewId, destinationId, credentialId, expiresAt, providerCalendarId,
          googleOwner, disclosure: selected, payloadVersion, calendarName, example, sharingReview, notificationReview });
      }
      if (route === 'status') {
        const status = await connection.lookupConsent(authority, destinationId, credentialId, reviewId as string, signal);
        if (!status || signal.aborted) return googleCalendarConsentFailure(409, 'GOOGLE_CALENDAR_REVIEW_UNAVAILABLE');
        return privateJsonResponse(status.state === 'active'
          ? { schemaVersion: 1, state: 'active', destinationId, consentId: status.consentId, generation: status.generation }
          : { schemaVersion: 1, state: status.state });
      }
      confirming = true;
      const receipt = await connection.confirmConsent(authority, { destinationId, credentialId, reviewId: reviewId as string,
        disclosure: flags, payloadReviewed: true, sharingReviewed: true, notificationsReviewed: true }, signal);
      if (!receipt || signal.aborted) return googleCalendarConsentFailure(503, 'GOOGLE_CALENDAR_CONSENT_OUTCOME_UNKNOWN');
      return privateJsonResponse({ schemaVersion: 1, state: 'active', destinationId, consentId: receipt.consentId, generation: receipt.generation });
    } catch {
      if (confirming) return googleCalendarConsentFailure(503, 'GOOGLE_CALENDAR_CONSENT_OUTCOME_UNKNOWN');
      return googleCalendarConsentFailure(admitted ? 503 : 400);
    } finally { hash?.fill(0); }
  };
}
