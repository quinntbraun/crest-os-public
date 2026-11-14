import { hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { flattenedDecrypt } from 'jose';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createGoogleCalendarCredentialStore } from '../../src/operations/google-calendar-credential-store.ts';
import { googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarOAuthTransport } from '../../src/operations/google-calendar-oauth-transport.ts';

const clientId = 'fictional-calendar.apps.googleusercontent.com', activeKeyId = 'test-calendar-credential';
const callbackUri = 'https://crest.example.com/api/google-calendar/callback';

async function fixture() {
  const calendarKeyMaterial = randomBytes(32);
  const config = { activeKeyId, calendarKeyMaterial };
  const store = await createGoogleCalendarCredentialStore(config);
  const request = vi.fn<typeof fetch>();
  const transport = createGoogleCalendarOAuthTransport({ clientId, callbackUri, request,
    clientSecret: 'fictional-secret', admit: async () => true });
  const binding = { clientId, businessId: randomUUID(), destinationId: randomUUID(), credentialId: randomUUID(),
    recoveryEpoch: randomUUID(), connectionGeneration: '1', version: '1' };
  const material = { clientId, scope: googleCalendarOAuthScope, accessToken: 'fictional-access-token',
    refreshToken: 'fictional-refresh-token', expiresAt: Date.now() + 1000, refreshExpiresAt: null };
  return { config, store, request, transport, binding, material, grant: transport.openRetained(material) };
}

describe('Google Calendar credential sealing', () => {
  it('round-trips a nonserializable provider grant using the exact SQL envelope profile', async () => {
    const { store, transport, binding, material, grant } = await fixture();
    const sealed = await store.seal(binding, grant);
    expect(sealed.keyId).toBe(activeKeyId);
    expect(Object.keys(sealed.envelope).sort()).toEqual(['aad', 'ciphertext', 'iv', 'protected', 'tag']);
    expect(Buffer.from(sealed.envelope.protected!, 'base64url').toString()).toBe(
      '{"alg":"dir","enc":"A256GCM","kid":"test-calendar-credential","typ":"application/vnd.crest.google-calendar-credentials.v1"}');
    expect(Buffer.from(sealed.envelope.aad!, 'base64url').toString()).toBe([
      'crest.google-calendar-credentials.v1', binding.businessId, binding.destinationId, '1', binding.recoveryEpoch,
      clientId, googleCalendarOAuthScope, binding.credentialId, '1',
    ].join('\n'));
    expect(JSON.stringify(sealed)).not.toContain(material.refreshToken);
    expect(JSON.stringify(sealed)).not.toContain(material.accessToken);
    expect((await store.seal(binding, grant)).envelope.iv).not.toBe(sealed.envelope.iv);
    const opened = await store.open(binding, sealed, transport.openRetained);
    expect(() => JSON.stringify(opened)).toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    expect(opened.forPrivateCredentialStore()).toEqual(material);
  });

  it('rejects a changed tenant, destination, generation, recovery epoch, client, credential or version before opening', async () => {
    const { store, transport, binding, grant } = await fixture();
    const sealed = await store.seal(binding, grant);
    const restore = vi.fn(transport.openRetained);
    for (const change of [
      { businessId: randomUUID() }, { destinationId: randomUUID() }, { connectionGeneration: '2' }, { recoveryEpoch: randomUUID() },
      { clientId: 'other.apps.googleusercontent.com' }, { credentialId: randomUUID() }, { version: '2' }, { version: '01' },
    ]) await expect(store.open({ ...binding, ...change }, sealed, restore)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    expect(restore).not.toHaveBeenCalled();
  });

  it('rejects PKCE keys, other key material, malformed envelopes, bad tags and plaintext fields', async () => {
    const { config, store, transport, binding, grant } = await fixture();
    const sealed = await store.seal(binding, grant);
    const pkceKey = Buffer.from(hkdfSync('sha256', config.calendarKeyMaterial, 'crest.google-calendar-pkce.v1', activeKeyId, 32));
    await expect(flattenedDecrypt(sealed.envelope, pkceKey)).rejects.toThrow();
    const wrong = await createGoogleCalendarCredentialStore({ ...config, calendarKeyMaterial: randomBytes(32) });
    await expect(wrong.open(binding, sealed, transport.openRetained)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
    const mutate = (value: string) => (value.startsWith('A') ? 'B' : 'A') + value.slice(1);
    for (const variant of [
      { ...sealed, keyId: 'different-key' }, { ...sealed, envelope: { ...sealed.envelope, tag: mutate(sealed.envelope.tag!) } },
      { ...sealed, envelope: { ...sealed.envelope, ciphertext: sealed.envelope.ciphertext + '=' } },
      { ...sealed, envelope: { ...sealed.envelope, refreshToken: 'plaintext' } },
    ]) await expect(store.open(binding, variant, transport.openRetained)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
  });

  it('seals the rotated grant for the next SQL version and preserves an omitted refresh token', async () => {
    const { store, transport, request, binding, material, grant } = await fixture();
    const first = await store.seal(binding, grant);
    const previous = await store.open(binding, first, transport.openRetained);
    request.mockResolvedValueOnce(Response.json({ access_token: 'fictional-replacement', token_type: 'Bearer', expires_in: 3600 }));
    const refreshed = await transport.refresh(previous, new AbortController().signal);
    expect(refreshed.state).toBe('granted');
    if (refreshed.state !== 'granted') throw Error('Expected a fictional refresh');
    const next = { ...binding, version: '2' };
    const second = await store.seal(next, refreshed.grant);
    expect((await store.open(next, second, transport.openRetained)).forPrivateCredentialStore()).toMatchObject({
      accessToken: 'fictional-replacement', refreshToken: material.refreshToken,
    });
    await expect(store.open(binding, second, transport.openRetained)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
  });
});
