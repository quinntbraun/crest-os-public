import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { cleanGoogleCalendarOAuthResponse, createGoogleCalendarOAuth, googleCalendarOAuthIssuer, googleCalendarOAuthScope } from
  '../../src/operations/google-calendar-oauth.ts';
import type { GoogleCalendarOAuthAttemptStore, GoogleCalendarOAuthOwner } from '../../src/operations/google-calendar-oauth.ts';

const callbackUri = 'https://crest.example.com/api/google-calendar/callback';
const clientId = 'fictional-calendar.apps.googleusercontent.com';
const verifierKeyId = 'test-calendar-key';
const signal = new AbortController().signal;
const fictionalCode = 'fictional/authorization-code_1';
type Pending = Parameters<GoogleCalendarOAuthAttemptStore['begin']>[0];
const scope = (): GoogleCalendarOAuthOwner => ({
  businessId: randomUUID(), actorId: randomUUID(), appSessionId: randomUUID(), recoveryEpoch: randomUUID(), connectionGeneration: '2',
});
const hash = (text: string) => createHash('sha256').update(text, 'ascii').digest();
function callback(state: string, parameters: Record<string, string> = { code: fictionalCode }) {
  return new Request(callbackUri + '?' + new URLSearchParams({ state, ...parameters }));
}

async function fixture() {
  const pending = new Map<string, Pending>();
  const begin = vi.fn<GoogleCalendarOAuthAttemptStore['begin']>(async request => {
    pending.set(request.attemptId, request);
    return { attemptId: request.attemptId, expiresAt: new Date(Date.now() + 299_000).toISOString() };
  });
  const consume = vi.fn<GoogleCalendarOAuthAttemptStore['consume']>(async request => {
    const prior = pending.get(request.attemptId);
    if (!prior || !prior.stateDigest.equals(request.stateDigest) || JSON.stringify(prior.owner) !== JSON.stringify(request.owner) ||
      JSON.stringify(prior.client) !== JSON.stringify(request.client)) return null;
    pending.delete(request.attemptId);
    return { attemptId: prior.attemptId, verifierKeyId, verifierEnvelope: prior.verifierEnvelope };
  });
  const config = { clientId, callbackUri, verifierKeyId, calendarKeyMaterial: randomBytes(32), store: { begin, consume } };
  const oauth = await createGoogleCalendarOAuth(config);
  const owner = scope();
  async function start() {
    const response = await oauth.begin(owner, signal);
    const location = new URL(response.headers.get('Location')!);
    return { response, location, state: location.searchParams.get('state')! };
  }
  return { config, oauth, begin, consume, owner, start };
}

describe('server-only Google Calendar authorization', () => {
  it('commits a bound hashed state and sealed verifier before the exact narrow S256 redirect', async () => {
    const { start, begin, oauth, owner } = await fixture();
    const { response, location, state } = await start();
    expect(response.status).toBe(303);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(location.origin + location.pathname).toBe(googleCalendarOAuthIssuer + '/o/oauth2/v2/auth');
    const challenge = location.searchParams.get('code_challenge');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: clientId, redirect_uri: callbackUri, scope: googleCalendarOAuthScope, response_type: 'code',
      access_type: 'offline', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    const retained = begin.mock.calls[0]![0];
    expect(state).toMatch(new RegExp('^' + retained.attemptId + '\\.[A-Za-z0-9_-]{43}$'));
    expect(retained.stateDigest).toEqual(hash(state));
    expect(JSON.stringify(retained)).not.toContain(state);
    expect(Buffer.from(retained.verifierEnvelope.protected!, 'base64url').toString()).toBe(
      '{"alg":"dir","enc":"A256GCM","kid":"test-calendar-key","typ":"application/vnd.crest.google-calendar-pkce.v1"}');
    expect(Buffer.from(retained.verifierEnvelope.aad!, 'base64url').toString()).toBe([
      'crest.google-calendar-pkce.v1', retained.attemptId, owner.businessId, owner.actorId, owner.appSessionId,
      owner.recoveryEpoch, owner.connectionGeneration, googleCalendarOAuthIssuer, clientId, callbackUri,
    ].join('\n'));
    const accepted = await oauth.callback(callback(state, { code: fictionalCode, iss: googleCalendarOAuthIssuer,
      scope: googleCalendarOAuthScope, authuser: '0', prompt: 'consent' }), owner, signal);
    expect(accepted.state).toBe('exchange_pending');
    if (accepted.state !== 'exchange_pending') throw Error('Missing test exchange');
    expect(() => JSON.stringify(accepted)).toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    const exchange = accepted.exchange.takeForOAuthLibrary();
    expect(exchange).toEqual({ code: fictionalCode, codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      issuer: googleCalendarOAuthIssuer, clientId, callbackUri, scope: googleCalendarOAuthScope });
    expect(hash(exchange.codeVerifier).toString('base64url')).toBe(challenge);
    expect(JSON.stringify(retained)).not.toContain(exchange.codeVerifier);
    expect(() => accepted.exchange.takeForOAuthLibrary()).toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    expect(await oauth.callback(callback(state), owner, signal)).toEqual({ state: 'restart' });
  });

  it('keeps state random, rejects cross-session or generation guesses, and allows only one concurrent consumption', async () => {
    const { start, oauth, owner } = await fixture();
    const first = await start(), second = await start();
    expect(first.state).not.toBe(second.state);
    expect(first.location.searchParams.get('code_challenge')).not.toBe(second.location.searchParams.get('code_challenge'));
    expect(await oauth.callback(callback(first.state), { ...owner, appSessionId: randomUUID() }, signal)).toEqual({ state: 'restart' });
    expect(await oauth.callback(callback(first.state), { ...owner, connectionGeneration: '3' }, signal)).toEqual({ state: 'restart' });
    expect(await oauth.callback(callback(first.state.slice(0, 37) + second.state.slice(37)), owner, signal)).toEqual({ state: 'restart' });
    expect((await Promise.all([oauth.callback(callback(first.state), owner, signal), oauth.callback(callback(first.state), owner, signal)]))
      .map(result => result.state).sort()).toEqual(['exchange_pending', 'restart']);
  });

  it('rejects malformed, mixed, duplicate or misdirected callbacks before attempting consumption', async () => {
    const { start, oauth, owner, consume } = await fixture();
    const { state } = await start();
    const query = '?state=' + state + '&code=fictional';
    const wrong = [
      new Request(callbackUri + query, { method: 'POST' }),
      new Request(callbackUri + '/extra' + query),
      new Request('https://attacker.example.com/api/google-calendar/callback' + query),
      new Request(callbackUri + query + '#secret'),
      new Request(callbackUri + query + '&state=' + state),
      new Request(callbackUri + query + '&co%64e=duplicate'),
      new Request(callbackUri + query + '&access_token=unexpected'),
      new Request(callbackUri + query + '&error=access_denied'),
      new Request(callbackUri + query + '&iss=https%3A%2F%2Fattacker.example.com'),
      new Request(callbackUri + query + '&prompt=%E0%80%AF'),
      new Request(callbackUri + query + '&prompt=%ZZ'),
      new Request(callbackUri + '?state=' + state + '&code=%0aexample'),
      new Request(callbackUri + '?state=' + state + '&code=' + 'a'.repeat(4500)),
      new Request(callbackUri + '?state=' + state),
      new Request(callbackUri + '?state=' + state + '&code='),
    ];
    for (const request of wrong) expect(await oauth.callback(request, owner, signal)).toEqual({ state: 'restart' });
    expect(consume).not.toHaveBeenCalled();
    expect((await oauth.callback(callback(state), owner, signal)).state).toBe('exchange_pending');
  });

  it('consumes provider denial and unsafe scope once and exposes no raw errors', async () => {
    const { start, oauth, owner, consume } = await fixture();
    const denied = await start();
    expect(await oauth.callback(callback(denied.state, { error: 'access_denied', error_description: 'Untrusted provider text' }), owner, signal))
      .toEqual({ state: 'denied' });
    expect(await oauth.callback(callback(denied.state), owner, signal)).toEqual({ state: 'restart' });
    const review = await start();
    expect(await oauth.callback(callback(review.state, { code: fictionalCode, scope: googleCalendarOAuthScope + ' https://example.com/broad' }),
      owner, signal)).toEqual({ state: 'review' });
    expect(await oauth.callback(callback(review.state), owner, signal)).toEqual({ state: 'restart' });
    consume.mockRejectedValueOnce(new Error('private database error'));
    expect(await oauth.callback(callback((await start()).state), owner, signal)).toEqual({ state: 'restart' });
    const clean = cleanGoogleCalendarOAuthResponse();
    expect(clean.status).toBe(303);
    expect(clean.headers.get('Location')).toBe('/settings/google-calendar');
    expect(clean.headers.get('Cache-Control')).toBe('no-store');
    expect(clean.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await clean.text()).toBe('');
  });

  it('fails closed on wrong encryption purpose or key, tampering, invalid commit receipts and abort', async () => {
    const { start, config, oauth, owner, begin, consume } = await fixture();
    const wrongKey = await createGoogleCalendarOAuth({ ...config, calendarKeyMaterial: randomBytes(32) });
    expect(await wrongKey.callback(callback((await start()).state), owner, signal)).toEqual({ state: 'restart' });
    const other = await start();
    const source = begin.mock.calls.at(-1)![0];
    const envelope = source.verifierEnvelope;
    consume.mockResolvedValueOnce({ attemptId: source.attemptId, verifierKeyId, verifierEnvelope: {
      ...envelope, ciphertext: (envelope.ciphertext.startsWith('A') ? 'B' : 'A') + envelope.ciphertext.slice(1),
    } });
    expect(await oauth.callback(callback(other.state), owner, signal)).toEqual({ state: 'restart' });
    begin.mockResolvedValueOnce(null);
    await expect(oauth.begin(owner, signal)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    begin.mockImplementationOnce(async request => ({ attemptId: request.attemptId, expiresAt: new Date(Date.now() - 1).toISOString() }));
    await expect(oauth.begin(owner, signal)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    begin.mockRejectedValueOnce(new Error('private database error'));
    await expect(oauth.begin(owner, signal)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    const aborted = AbortSignal.abort();
    expect(await oauth.callback(callback(other.state), owner, aborted)).toEqual({ state: 'restart' });
    await expect(oauth.begin(owner, aborted)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    for (const uri of [callbackUri + '?extra=1', callbackUri.replace('https:', 'http:'), callbackUri.replace('crest.example.com', 'evil@crest.example.com')]) {
      await expect(createGoogleCalendarOAuth({ ...config, callbackUri: uri })).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    }
  });
});
