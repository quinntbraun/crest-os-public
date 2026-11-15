import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { projectGoogleCalendarAppointment } from '../../src/operations/google-calendar-projection.ts';
import { createGoogleCalendarProvider } from '../../src/operations/google-calendar-provider.ts';
import { confirmGoogleCalendarProjection, reconcileGoogleCalendarMutation } from '../../src/operations/google-calendar-reconciliation.ts';

const destination = 'synthetic.calendar@group.calendar.google.com';
const eventUuid = '57d95aa2-a407-432b-a916-d93d29d0a006';
const marker = '57d95aa2-a407-432b-a916-d93d29d0a007';
const mapping = {
  businessId: '57d95aa2-a407-432b-a916-d93d29d0a001', jobId: '57d95aa2-a407-432b-a916-d93d29d0a002',
  destinationId: '57d95aa2-a407-432b-a916-d93d29d0a003', eventUuid, marker,
};
const intent = projectGoogleCalendarAppointment(mapping, {
  businessId: mapping.businessId, jobId: mapping.jobId, appointmentId: '57d95aa2-a407-432b-a916-d93d29d0a004',
  appointmentSequence: '1', action: 'book', confirmation: 'confirmed',
  time: {
    timezone: 'UTC', start_at: '2026-11-13T10:00:00.000000Z', end_at: '2026-11-13T11:00:00.000000Z',
    local_start: '2026-11-13T10:00:00.000000', local_end: '2026-11-13T11:00:00.000000',
    start_offset_minutes: 0, end_offset_minutes: 0,
  },
}, { trustedOrigin: 'https://crest.example.com', disclosure: { clientName: false, serviceLabel: false, workAddress: false } });
if (intent.action !== 'publish') throw Error('Invalid fictional fixture');
const event = intent.event;
const etag = '"calendar-revision"';
const googleEvent = { ...event, etag, organizer: { self: true } };
const previous = confirmGoogleCalendarProjection(googleEvent, event)!;
const endpoint = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(destination);
const signal = () => new AbortController().signal;
const json = (payload: unknown, status = 200) => Response.json(payload, { status });
const insert = { action: 'insert', desired: event } as const;
const make = () => {
  const request = vi.fn<typeof fetch>();
  const admit = vi.fn<Parameters<typeof createGoogleCalendarProvider>[0]['admit']>(async () => 'fictional-token');
  return { provider: createGoogleCalendarProvider({ calendarId: destination, eventUuid, marker, request, admit }), request, admit };
};

describe('bounded Google Calendar event adapter', () => {
  it('keeps all external work behind admission and never redirects credentials', async () => {
    const { provider, request, admit } = make();
    admit.mockResolvedValueOnce(null);
    expect(await provider.apply(insert, signal())).toEqual({ state: 'paused' });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(json(googleEvent));
    expect(await provider.apply(insert, signal())).toEqual({ state: 'confirmed', confirmed: previous });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(endpoint + '/events?sendUpdates=none');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer fictional-token');
    expect(headers.has('if-match')).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(Object.keys(body)).not.toContain('attendees');
    expect(Object.keys(body)).not.toContain('conferenceData');
    expect(admit.mock.calls.map(([kind]) => kind)).toEqual(['insert', 'insert']);
  });

  it('fences edits and cancellations with the prior etag, including clearing withdrawn consent', async () => {
    const { provider, request } = make();
    request.mockResolvedValueOnce(json(googleEvent)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const earlier = { ...previous, event: { ...event, location: '12 Fictional Lane' } };
    expect(await provider.apply({ action: 'update', previous: earlier, desired: event }, signal())).toEqual({ state: 'confirmed', confirmed: previous });
    expect(await provider.apply({ action: 'delete', previous }, signal())).toEqual({ state: 'removed' });
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe(endpoint + '/events/' + event.id + '?sendUpdates=none');
      expect(new Headers(init?.headers).get('if-match')).toBe(etag);
    }
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).location).toBe('');
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(request.mock.calls[1]?.[1]).not.toHaveProperty('body');
    await expect(provider.apply({ action: 'delete', previous: { ...previous, etag: '*' } }, signal())).resolves.toEqual({ state: 'review' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an accessible destination with a missing event from a missing or substituted calendar', async () => {
    const { provider, request, admit } = make();
    request.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(json({ id: destination }));
    expect(await provider.observe(signal())).toEqual({ state: 'missing', destinationVerified: true });
    expect(admit.mock.calls.map(([kind]) => kind)).toEqual(['read_event', 'verify_destination']);
    expect(request.mock.calls[0]?.[0]).toBe(endpoint + '/events/' + event.id);
    expect(request.mock.calls[1]?.[0]).toBe(endpoint + '?fields=id');
    request.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(json({ id: 'someone@example.com' }));
    expect(await provider.observe(signal())).toEqual({ state: 'review' });
    expect(() => createGoogleCalendarProvider({ calendarId: 'primary', eventUuid, marker, admit, request })).toThrow();
  });

  it('classifies provider outcomes without returning secrets or retrying a write', async () => {
    const { provider, request } = make();
    request.mockResolvedValueOnce(json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403));
    request.mockResolvedValueOnce(json({ error: { errors: [{ reason: 'forbidden' }] } }, 403));
    request.mockResolvedValueOnce(new Response(null, { status: 401 }));
    request.mockResolvedValueOnce(new Response(null, { status: 429 }));
    request.mockResolvedValueOnce(new Response(null, { status: 409 }));
    request.mockResolvedValueOnce(new Response(null, { status: 412 }));
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    request.mockRejectedValueOnce(Error('synthetic credential-bearing provider failure'));
    request.mockResolvedValueOnce(json({ leaked: 'fictional secret', content: 'x'.repeat(65 * 1024) }));
    const outcomes = [];
    for (let i = 0; i < 9; i++) outcomes.push(await provider.apply(insert, signal()));
    expect(outcomes).toEqual(['delayed', 'review', 'reconnect', 'delayed', 'uncertain', 'review', 'uncertain', 'uncertain', 'uncertain'].map(state => ({ state })));
    expect(request).toHaveBeenCalledTimes(9);
  });

  it('uses the original event after a committed but lost response and checks its complete projection', async () => {
    const { provider, request } = make();
    request.mockRejectedValueOnce(Error('simulated response loss')).mockResolvedValueOnce(json(googleEvent));
    expect(await provider.apply(insert, signal())).toEqual({ state: 'uncertain' });
    const read = await provider.observe(signal());
    expect(read.state).toBe('present');
    if (read.state !== 'present') throw Error('Expected provider observation');
    expect(reconcileGoogleCalendarMutation(insert, read)).toEqual({ state: 'confirmed', confirmed: previous });
    expect(request.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET']);
  });
});
