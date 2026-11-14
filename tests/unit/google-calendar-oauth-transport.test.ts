import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createGoogleCalendarOAuth, googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarOAuthTransport } from '../../src/operations/google-calendar-oauth-transport.ts';
import type { GoogleCalendarOAuthAttemptStore } from '../../src/operations/google-calendar-oauth.ts';

const clientId = 'fictional-crest.apps.googleusercontent.com', clientSecret = 'fictional-server-secret';
const callbackUri = 'https://crest.example.com/api/google-calendar/callback';
const signal = new AbortController().signal;
const tokenUrl = 'https://oauth2.googleapis.com/token', revokeUrl = 'https://oauth2.googleapis.com/revoke';
const success = (changes: Record<string, unknown> = {}) => Response.json({
  access_token: 'fictional-access-token', refresh_token: 'fictional-rotated-token',
  scope: googleCalendarOAuthScope, token_type: 'Bearer', expires_in: 3600, ...changes,
});

async function fixture() {
  const request = vi.fn<typeof fetch>();
  const admit = vi.fn<Parameters<typeof createGoogleCalendarOAuthTransport>[0]['admit']>(async () => true);
  const transport = createGoogleCalendarOAuthTransport({ clientId, clientSecret, callbackUri, request, admit });
  type Pending = Parameters<GoogleCalendarOAuthAttemptStore['begin']>[0];
  const pending = new Map<string, Pending>();
  const oauth = await createGoogleCalendarOAuth({
    clientId, callbackUri, verifierKeyId: 'test-key', calendarKeyMaterial: randomBytes(32), store: {
      async begin(value) {
        pending.set(value.attemptId, value);
        return { attemptId: value.attemptId, expiresAt: new Date(Date.now() + 298_000).toISOString() };
      },
      async consume(value) {
        const row = pending.get(value.attemptId);
        if (!row || !row.stateDigest.equals(value.stateDigest)) return null;
        pending.delete(value.attemptId);
        return { attemptId: value.attemptId, verifierKeyId: row.verifierKeyId, verifierEnvelope: row.verifierEnvelope };
      },
    },
  });
  const owner = { businessId: randomUUID(), actorId: randomUUID(), appSessionId: randomUUID(),
    recoveryEpoch: randomUUID(), connectionGeneration: '1' };
  async function callbackMaterial() {
    const response = await oauth.begin(owner, signal);
    const url = new URL(response.headers.get('Location')!);
    const params = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'fictional/oauth-code' });
    const result = await oauth.callback(new Request(callbackUri + '?' + params), owner, signal);
    if (result.state !== 'exchange_pending') throw Error('Synthetic callback did not produce an exchange');
    return { material: result.exchange, challenge: url.searchParams.get('code_challenge') };
  }
  const stored = {
    clientId, scope: googleCalendarOAuthScope, accessToken: 'fictional-old-access', refreshToken: 'fictional-retained-refresh',
    expiresAt: Date.now() - 5000, refreshExpiresAt: Date.now() + 86_400_000,
  };
  return { request, admit, transport, callbackMaterial, stored, retained: transport.openRetained(stored) };
}

function sent(request: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) {
  const [url, init] = request.mock.calls[index]!;
  return { url, init, form: Object.fromEntries(init!.body as URLSearchParams) };
}

describe('held Google Calendar OAuth transport', () => {
  it('does not consume exchange material or request Google before admission, then sends only the pinned code/PKCE form', async () => {
    const { request, admit, transport, callbackMaterial } = await fixture();
    const { material, challenge } = await callbackMaterial();
    admit.mockResolvedValueOnce(false);
    expect(await transport.exchange(material, signal)).toEqual({ state: 'paused' });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(success({ refresh_token_expires_in: 7200 }));
    const exchanged = await transport.exchange(material, signal);
    expect(exchanged.state).toBe('granted');
    if (exchanged.state !== 'granted') throw Error('Expected fictional grant');
    expect(() => JSON.stringify(exchanged)).toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    expect(exchanged.grant.forPrivateCredentialStore()).toMatchObject({
      accessToken: 'fictional-access-token', refreshToken: 'fictional-rotated-token', clientId, scope: googleCalendarOAuthScope,
    });
    expect(exchanged.grant.refreshExpiresAt).toBeGreaterThan(exchanged.grant.expiresAt);
    const { url, init, form } = sent(request);
    expect(admit.mock.calls[1]![0]).toEqual({ kind: 'exchange', attemptId: material.attemptId });
    expect(url).toBe(tokenUrl);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(form).toEqual({
      grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUri,
      code: 'fictional/oauth-code', code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(createHash('sha256').update(form.code_verifier!, 'ascii').digest('base64url')).toBe(challenge);
    expect(await transport.exchange(material, signal)).toEqual({ state: 'review' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('preserves omitted refresh material and accepts a replacement without extending the original known lifetime', async () => {
    const { request, transport, retained, stored } = await fixture();
    request.mockResolvedValueOnce(success({ refresh_token: undefined, scope: undefined }))
      .mockResolvedValueOnce(success({ refresh_token_expires_in: 7 * 86_400 }));
    const refreshed = await transport.refresh(retained, signal);
    expect(refreshed.state).toBe('granted');
    if (refreshed.state !== 'granted') throw Error('Expected fictional refresh');
    expect(refreshed.grant.forPrivateCredentialStore()).toMatchObject({
      refreshToken: stored.refreshToken, refreshExpiresAt: stored.refreshExpiresAt,
    });
    const rotated = await transport.refresh(refreshed.grant, signal);
    expect(rotated.state).toBe('granted');
    if (rotated.state !== 'granted') throw Error('Expected fictional rotation');
    expect(rotated.grant.forPrivateCredentialStore()).toMatchObject({
      refreshToken: 'fictional-rotated-token', refreshExpiresAt: stored.refreshExpiresAt,
    });
    expect(sent(request).form).toEqual({
      grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: stored.refreshToken,
    });
    const expired = transport.openRetained({ ...stored, refreshExpiresAt: Date.now() - 1 });
    expect(await transport.refresh(expired, signal)).toEqual({ state: 'reconnect' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects broad or incomplete grant scopes and distinguishes denial, throttling and uncertainty', async () => {
    const { request, transport, retained, callbackMaterial } = await fixture();
    const { material } = await callbackMaterial();
    request.mockResolvedValueOnce(success({ scope: undefined }));
    expect(await transport.exchange(material, signal)).toEqual({ state: 'review' });
    request.mockResolvedValueOnce(success({ scope: googleCalendarOAuthScope + ' https://www.googleapis.com/auth/calendar' }))
      .mockResolvedValueOnce(success({ id_token: 'unexpected' }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'secret' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: 'rate_limit_exceeded' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_client' }, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error('raw transport secret'));
    for (const state of ['review', 'review', 'reconnect', 'delayed', 'review', 'delayed', 'uncertain', 'uncertain']) {
      expect(await transport.refresh(retained, signal)).toEqual({ state });
    }
    expect(request).toHaveBeenCalledTimes(9);
  });

  it('bounds responses and rejects redirect, duplicate keys, invalid successful tokens and an aborted request', async () => {
    const { request, transport, retained } = await fixture();
    request.mockResolvedValueOnce(new Response('{"scope":"old","sco\\u0070e":"duplicate"}', {
      headers: { 'content-type': 'application/json' },
    })).mockResolvedValueOnce(new Response('x'.repeat(17_000), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999' } }))
      .mockResolvedValueOnce(Response.redirect('https://unexpected.example.com', 307))
      .mockResolvedValueOnce(success({ access_token: 'malformed token' }))
      .mockImplementationOnce(async (_url, init) => {
        expect(init?.signal?.aborted).toBe(false);
        throw Error('response unavailable');
      });
    for (let i = 0; i < 6; i++) expect(await transport.refresh(retained, signal)).toEqual({ state: 'uncertain' });
    expect(await transport.refresh(retained, AbortSignal.abort())).toEqual({ state: 'paused' });
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('revokes only the admitted prior refresh grant with no token in the URL and never retries an uncertain revocation', async () => {
    const { request, admit, transport, retained, stored } = await fixture();
    admit.mockRejectedValueOnce(Error('not admitted'));
    expect(await transport.revoke(retained, signal)).toEqual({ state: 'paused' });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_token' }, { status: 400 }));
    expect(await transport.revoke(retained, signal)).toEqual({ state: 'revoked' });
    expect(sent(request).url).toBe(revokeUrl);
    expect(sent(request).form).toEqual({ token: stored.refreshToken });
    expect(admit.mock.calls[1]![0]).toEqual({ kind: 'revoke', retained });
    expect(await transport.revoke(retained, signal)).toEqual({ state: 'uncertain' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
