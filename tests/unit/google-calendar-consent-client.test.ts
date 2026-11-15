import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleCalendarConsent, googleCalendarConsentReferenceStore } from '../../src/client/google-calendar-consent';
import { googleCalendarInitialConsentPreview } from '../../src/operations/google-calendar-initial-consent';

const origin = 'https://crest.example.test';
const context = {
  destinationId: 'aabb0000-0101-4000-a900-000000000001',
  credentialId: 'aabb0000-0101-4000-a900-000000000002',
  recoveryEpoch: 'aabb0000-0101-4000-a900-000000000003',
};
const reference = { ...context, reviewId: 'aabb0000-0101-4000-a900-000000000004' };
const consentId = 'aabb0000-0101-4000-a900-000000000005';
const minimal = { clientName: false, serviceLabel: false, workAddress: false };
const csrfToken = 'A'.repeat(43);
const signal = new AbortController().signal;

function ready(selected = minimal) {
  return { ...googleCalendarInitialConsentPreview(origin, selected), disclosure: selected, schemaVersion: 1,
    reviewId: reference.reviewId, credentialId: context.credentialId, destinationId: context.destinationId,
    expiresAt: new Date(Date.now() + 300000).toISOString(), googleOwner: 'fictional@example.test',
    providerCalendarId: 'fictional@group.calendar.google.com' };
}

function transport(answers: (Response | Error)[]) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/auth/session') return Response.json({ csrfToken, expiresAt: Date.now() + 300000 });
    const answer = answers.shift();
    if (!answer || answer instanceof Error) throw answer ?? Error('unexpected request');
    return answer;
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('window', { location: { origin } });
  return fetch;
}

function privateJson(value: object, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Google Calendar consent browser boundary', () => {
  it('submits only owner-selected booleans and validates the real minimal projection', async () => {
    const fetch = transport([privateJson(ready())]);
    const result = await googleCalendarConsent.preview(context, minimal, signal);
    expect(result.reference).toEqual(reference);
    expect(result.example).toMatchObject({ title: 'Crest job', location: null });
    const [url, request] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/business/google-calendar/consent/preview');
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', headers: { 'x-crest-csrf': csrfToken } });
    expect(JSON.parse(String(request.body))).toEqual({ ...context, ...minimal });
  });

  it('refuses wider disclosure, duplicate JSON keys and external preview links', async () => {
    const correct = ready(), example = correct.example;
    const duplicate = new Response(JSON.stringify(correct).replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1'),
      { headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json' } });
    transport([privateJson({ ...correct, disclosure: { ...minimal, clientName: true } }), duplicate,
      privateJson({ ...correct, example: { ...example, description: example.description.replace(origin, 'https://wrong.test') } })]);
    for (let index = 0; index < 3; index++) {
      await expect(googleCalendarConsent.preview(context, minimal, signal)).rejects.toThrow('GOOGLE_CALENDAR_CONSENT_CLIENT_FAILED');
    }
  });

  it('uses only the original opaque status reference after a lost confirm response', async () => {
    const fetch = transport([Error('network failed'), privateJson({ schemaVersion: 1, state: 'absent' }),
      privateJson({ schemaVersion: 1, state: 'active', destinationId: context.destinationId, consentId, generation: '1' })]);
    await expect(googleCalendarConsent.confirm(reference, minimal, signal)).rejects.toThrow('network failed');
    await expect(googleCalendarConsent.status(reference, signal)).resolves.toEqual({ state: 'absent' });
    await expect(googleCalendarConsent.status(reference, signal)).resolves.toEqual({ state: 'active', consentId, generation: '1' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/session', '/api/business/google-calendar/consent/confirm',
      '/api/auth/session', '/api/business/google-calendar/consent/status',
      '/api/auth/session', '/api/business/google-calendar/consent/status',
    ]);
    const [, confirm] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    const [, status] = fetch.mock.calls[5] as unknown as [string, RequestInit];
    expect(JSON.parse(String(confirm.body))).toEqual({ ...reference, ...minimal, payloadReviewed: true,
      sharingReviewed: true, notificationsReviewed: true });
    expect(JSON.parse(String(status.body))).toEqual(reference);
  });

  it('keeps no account, consent choices or proof in the tab reference', () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; },
      removeItem: () => { raw = null; } };
    const store = googleCalendarConsentReferenceStore(context, storage);
    const extra = { ...reference, googleOwner: 'fictional@example.test', csrfToken, ...minimal };
    store.retain(extra);
    expect(JSON.parse(raw!)).toEqual(reference);
    expect(() => store.retain(reference)).toThrow();
    const foreign = googleCalendarConsentReferenceStore({ ...context, destinationId: consentId }, storage);
    expect(() => foreign.read()).toThrow();
    expect(store.read()).toEqual(reference);
    store.clear(reference);
    expect(store.read()).toBeNull();
  });
});
