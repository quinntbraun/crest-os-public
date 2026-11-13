import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createGoogleCalendarDestinationVerifier } from '../../src/operations/google-calendar-destination.ts';
import type { GoogleCalendarDestinationReview } from '../../src/operations/google-calendar-destination.ts';
import { googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarOAuthTransport } from '../../src/operations/google-calendar-oauth-transport.ts';

const clientId = 'fictional-calendar.apps.googleusercontent.com';
const callbackUri = 'https://crest.example.com/api/google-calendar/callback';
const calendarId = 'reviewed.secondary@group.calendar.google.com';
const calendarOwner = 'fictional-owner@example.com';
const signal = new AbortController().signal;
const json = (value: unknown, status = 200) => Response.json(value, { status });
const remote = { kind: 'calendar#calendar', id: calendarId, summary: 'Crest Jobs', dataOwner: calendarOwner };

function fixture() {
  const request = vi.fn<typeof fetch>();
  const context = { businessId: randomUUID(), actorId: randomUUID(), recoveryEpoch: randomUUID(), connectionGeneration: '1',
    attemptId: randomUUID() };
  const destination = { destinationId: randomUUID(), providerCalendarId: calendarId, reviewedCalendarOwner: calendarOwner };
  const admit = vi.fn<GoogleCalendarDestinationReview['admit']>(async () => destination);
  const verify = createGoogleCalendarDestinationVerifier({ request, review: { admit } });
  const transport = createGoogleCalendarOAuthTransport({ clientId, callbackUri, request, clientSecret: 'fictional-secret', admit: async () => false });
  const grant = transport.openRetained({ clientId, scope: googleCalendarOAuthScope, accessToken: 'fictional-access',
    refreshToken: 'fictional-refresh', expiresAt: Date.now() + 60_000, refreshExpiresAt: null });
  return { request, context, destination, admit, verify: () => verify(context, grant, signal) };
}

describe('reviewed Google Calendar destination', () => {
  it('reads only the exact admitted secondary calendar and returns only its local id', async () => {
    const { request, context, destination, admit, verify } = fixture();
    request.mockResolvedValueOnce(json(remote));
    expect(await verify()).toEqual({ state: 'verified', destinationId: destination.destinationId });
    expect(admit).toHaveBeenCalledWith(context, expect.any(AbortSignal));
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]!);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '?fields=kind,id,summary,dataOwner');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { authorization: 'Bearer fictional-access', accept: 'application/json' } });
    expect(init).not.toHaveProperty('body');
  });

  it('refuses primary calendars, arbitrary URLs and unadmitted requests before sending a token', async () => {
    const { request, destination, admit, verify } = fixture();
    admit.mockResolvedValueOnce({ ...destination, providerCalendarId: 'primary' })
      .mockResolvedValueOnce({ ...destination, providerCalendarId: 'https://attacker.example.com/calendar' })
      .mockResolvedValueOnce({ ...destination, reviewedCalendarOwner: '' });
    for (let i = 0; i < 3; i++) expect(await verify()).toEqual({ state: 'review' });
    admit.mockResolvedValueOnce(null).mockRejectedValueOnce(Error('private rejection'));
    expect(await verify()).toEqual({ state: 'paused' });
    expect(await verify()).toEqual({ state: 'paused' });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a same-title impostor, renamed calendar, changed or absent owner and unexpected fields', async () => {
    const { request, verify } = fixture();
    for (const value of [
      { ...remote, id: 'impostor@group.calendar.google.com' }, { ...remote, summary: 'Crest Jobs Copy' },
      { ...remote, dataOwner: 'other@example.com' }, { ...remote, dataOwner: undefined },
      { ...remote, kind: 'calendar#calendarListEntry' }, { ...remote, acl: 'unexpected' },
    ]) request.mockResolvedValueOnce(json(value));
    for (let i = 0; i < 6; i++) expect(await verify()).toEqual({ state: 'review' });
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('bounds the response, refuses redirects and distinguishes provider failures without retries', async () => {
    const { request, verify } = fixture();
    request.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403))
      .mockResolvedValueOnce(json({ error: { errors: [{ reason: 'forbidden' }] } }, 403))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.redirect('https://other.example.com', 307))
      .mockResolvedValueOnce(new Response('x'.repeat(4097), { headers: { 'content-type': 'application/json' } }))
      .mockRejectedValueOnce(Error('private provider data'));
    for (const state of ['reconnect', 'review', 'delayed', 'review', 'delayed', 'review', 'review', 'delayed']) {
      expect(await verify()).toEqual({ state });
    }
    expect(request).toHaveBeenCalledTimes(8);
  });
});
