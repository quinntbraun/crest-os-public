import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const calls = vi.hoisted(() => ({ csrf: vi.fn(), admit: vi.fn(), verify: vi.fn(), prepare: vi.fn(), confirm: vi.fn(), lookup: vi.fn() }));
vi.mock('../../src/security/session-request-guard.ts', () => ({ createSessionCsrfVerifier: () => calls.csrf }));
vi.mock('../../src/security/session-request-admission.ts', () => ({ createSessionRequestAdmission: () => calls.admit }));
vi.mock('../../src/security/session-lifecycle.ts', () => ({ createSessionLifecycle: () => ({ verify: calls.verify }) }));
import { createGoogleCalendarConsentHttp, googleCalendarConsentPrefix } from '../../src/operations/google-calendar-consent-http.ts';
import { googleCalendarInitialConsentPreview } from '../../src/operations/google-calendar-initial-consent.ts';
import { transportFixture } from '../support/transport';

const origin = 'https://crest.example.com', businessId = randomUUID(), actorId = randomUUID(), appSessionId = randomUUID();
const provider = { issuer: 'https://auth.example.com/auth/v1', subject: randomUUID(), sessionId: randomUUID(), expiresAt: Date.now() + 3600_000 };
const credential = randomBytes(32).toString('base64url'), cookie = '__Host-crest_session=' + credential;
const destinationId = randomUUID(), credentialId = randomUUID(), recoveryEpoch = randomUUID(), reviewId = randomUUID(), consentId = randomUUID();
const common = { destinationId, credentialId, recoveryEpoch }, disclosure = { clientName: false, serviceLabel: true, workAddress: false };
const previewInput = { ...common, ...disclosure };
const confirmInput = { ...previewInput, reviewId, payloadReviewed: true, sharingReviewed: true, notificationsReviewed: true };
const config = { origin, businessId, environment: 'production' as const, ingress: { kind: 'direct' as const }, connectionString: 'unused' };
const connection = { prepareConsent: calls.prepare, confirmConsent: calls.confirm, lookupConsent: calls.lookup };
const create = (enabled?: boolean) => createGoogleCalendarConsentHttp(config, {} as never, {} as never, connection, enabled);

function request(route: string, body: unknown = previewInput, options: { headers?: Record<string, string>; method?: string; signal?: AbortSignal } = {}) {
  const method = options.method ?? 'POST';
  return new Request(origin + googleCalendarConsentPrefix + route, {
    method, headers: { origin, cookie, 'content-type': 'application/json', ...options.headers },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(!['GET', 'HEAD'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.csrf.mockResolvedValue(appSessionId);
  calls.admit.mockResolvedValue(true);
  calls.verify.mockResolvedValue({ sessionId: appSessionId, actorId, provider });
  calls.prepare.mockResolvedValue({ ...common, reviewId, disclosure, expiresAt: '2026-11-14T00:00:00.000Z',
    googleOwner: 'fictional-owner@example.com', providerCalendarId: 'fixture@group.calendar.google.com',
    ...googleCalendarInitialConsentPreview(origin, disclosure), internal: 'never return this' });
  calls.confirm.mockResolvedValue({ state: 'active', destinationId, consentId, generation: '1', internal: 'never return this' });
  calls.lookup.mockResolvedValue({ state: 'absent' });
});

describe('private Calendar owner consent HTTP', () => {
  it('is disabled by default and rejects unknown or noncanonical routes', async () => {
    expect((await create()(request('preview'), transportFixture())).status).toBe(404);
    for (const route of ['unknown', 'preview/', 'preview?x=1', '%70review', 'callback']) {
      expect((await create(true)(request(route), transportFixture())).status).toBe(404);
    }
    const method = await create(true)(request('preview', null, { method: 'GET' }), transportFixture());
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
    expect(calls.csrf).not.toHaveBeenCalled();
  });

  it('rejects bad socket, origin, cookie, shape, duplicate or unconfirmed input before admission', async () => {
    const run = create(true), peer = transportFixture();
    expect((await run(request('preview'), {} as never)).status).toBe(400);
    for (const headers of [{ origin: 'https://other.example.com' }, { 'sec-fetch-site': 'cross-site' }, { cookie: '' },
      { cookie: cookie + '; ' + cookie }, { 'content-type': 'text/plain' }]) {
      expect((await run(request('preview', previewInput, { headers: headers as Record<string, string> }), peer)).status).toBe(400);
    }
    for (const bad of [{ ...previewInput, businessId }, { ...previewInput, serviceLabel: 1 }, { ...previewInput, recoveryEpoch: 'invalid' },
      JSON.stringify(previewInput).replace('"clientName":false', '"clientName":false,"clientName":true'), 'x'.repeat(2050)]) {
      expect((await run(request('preview', bad), peer)).status).toBe(400);
    }
    expect((await run(request('confirm', { ...confirmInput, sharingReviewed: false }), peer)).status).toBe(400);
    expect(calls.csrf).not.toHaveBeenCalled();
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it('uses socket, CSRF and durable admission before fresh owner proof and passes the pinned epoch', async () => {
    let observedHash: Buffer | undefined;
    calls.prepare.mockImplementation(async authority => {
      observedHash = authority.credentialHash;
      expect(authority).toEqual({ credentialHash: createHash('sha256').update(credential).digest(), businessId, actorId,
        appSessionId, recoveryEpoch, connectionGeneration: '0', authIssuer: provider.issuer, authSubject: provider.subject,
        authProviderSessionId: provider.sessionId, providerValidUntil: provider.expiresAt });
      return { ...common, reviewId, disclosure, expiresAt: '2026-11-14T00:00:00.000Z',
        googleOwner: 'fictional-owner@example.com', providerCalendarId: 'fixture@group.calendar.google.com',
        ...googleCalendarInitialConsentPreview(origin, disclosure), internal: 'never return this' };
    });
    const response = await create(true)(request('preview'), transportFixture());
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview).toMatchObject({ schemaVersion: 1, destinationId, credentialId, reviewId, disclosure, example: { summary: 'Crest job · Sample Detail' } });
    expect(preview).not.toHaveProperty('internal');
    expect(preview).not.toHaveProperty('recoveryEpoch');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(observedHash?.every(byte => byte === 0)).toBe(true);
    expect(calls.verify).toHaveBeenCalledWith(credential, expect.any(AbortSignal), 'background', true);
    expect(calls.csrf.mock.invocationCallOrder[0]).toBeLessThan(calls.admit.mock.invocationCallOrder[0]!);
    expect(calls.admit.mock.invocationCallOrder[0]).toBeLessThan(calls.verify.mock.invocationCallOrder[0]!);
  });

  it('stops on CSRF failure, exhausted admission or mismatched verified session', async () => {
    const run = create(true), peer = transportFixture();
    calls.csrf.mockRejectedValueOnce(Error('private'));
    expect((await run(request('preview'), peer)).status).toBe(400);
    calls.admit.mockResolvedValueOnce(false);
    const limited = await run(request('preview'), peer);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    calls.verify.mockResolvedValueOnce({ sessionId: randomUUID(), actorId, provider });
    expect((await run(request('preview'), peer)).status).toBe(400);
    expect(calls.prepare).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and reports uncertain acknowledgement without another write', async () => {
    const run = create(true), peer = transportFixture();
    const success = await run(request('confirm', confirmInput), peer);
    expect(await success.json()).toEqual({ schemaVersion: 1, state: 'active', destinationId, consentId, generation: '1' });
    calls.confirm.mockRejectedValueOnce(Error('private database detail'));
    const unknown = await run(request('confirm', confirmInput), peer);
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ error: 'GOOGLE_CALENDAR_CONSENT_OUTCOME_UNKNOWN' });
    expect(calls.confirm).toHaveBeenCalledTimes(2);
    expect(calls.lookup).not.toHaveBeenCalled();
    const status = await run(request('status', { ...common, reviewId }), peer);
    expect(await status.json()).toEqual({ schemaVersion: 1, state: 'absent' });
    expect(calls.confirm).toHaveBeenCalledTimes(2);
    calls.lookup.mockResolvedValueOnce({ state: 'changed' });
    expect(await (await run(request('status', { ...common, reviewId }), peer)).json()).toEqual({ schemaVersion: 1, state: 'changed' });
  });
});
