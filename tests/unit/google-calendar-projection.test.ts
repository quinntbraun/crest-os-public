import { describe, expect, it } from 'vitest';
import { calendarEventId, projectGoogleCalendarAppointment } from '../../src/operations/google-calendar-projection.ts';
import { confirmGoogleCalendarProjection, planGoogleCalendarMutation, reconcileGoogleCalendarMutation } from '../../src/operations/google-calendar-reconciliation.ts';

const uuid = (end: string) => 'f06a3dd0-9fe4-4b65-9079-00f0b5ad20' + end;
const mapping = { businessId: uuid('01'), jobId: uuid('02'), destinationId: uuid('03'), eventUuid: uuid('04'), marker: uuid('05') };
const key = { businessId: mapping.businessId, jobId: mapping.jobId, appointmentId: uuid('06'), appointmentSequence: '1' };
const options = {
  trustedOrigin: 'https://crest.example.com',
  disclosure: { clientName: false, serviceLabel: false, workAddress: false },
  fields: { clientName: 'Fictional Customer', serviceLabel: 'Interior detail', workAddress: '123 Fictional Lane' },
};
const time = {
  start_at: '2026-11-01T05:30:00.000001Z', end_at: '2026-11-01T06:30:00.000002Z',
  timezone: 'America/Indiana/Indianapolis', local_start: '2026-11-01T01:30:00.000001', local_end: '2026-11-01T01:30:00.000002',
  start_offset_minutes: -240, end_offset_minutes: -300,
};
const booked = projectGoogleCalendarAppointment(mapping, { ...key, action: 'book', confirmation: 'confirmed', time }, options);
const moved = projectGoogleCalendarAppointment(mapping, {
  ...key, action: 'confirm', confirmation: 'confirmed', appointmentId: uuid('07'), appointmentSequence: '3',
  time: {
    start_at: '2026-11-02T04:30:00.000001Z', end_at: '2026-11-02T05:30:00.000002Z',
    timezone: time.timezone, local_start: '2026-11-01T23:30:00.000001', local_end: '2026-11-02T00:30:00.000002',
    start_offset_minutes: -300, end_offset_minutes: -300,
  },
}, options);
if (booked.action !== 'publish' || moved.action !== 'publish') throw Error('Fictional fixture is invalid');
const cancelled = projectGoogleCalendarAppointment(mapping,
  { ...key, action: 'cancel', confirmation: 'cancelled', appointmentId: uuid('08'), appointmentSequence: '4' }, options);
const missing = { state: 'missing', destinationVerified: true } as const;
const remote = { ...booked.event, etag: '"first-verified-etag"', organizer: { self: true } };
const previous = confirmGoogleCalendarProjection(remote, booked.event)!;
const observed = (event: unknown) => ({ state: 'present' as const, event });

describe('Crest Google Calendar projection', () => {
  it('sends only the explicit default event fields and preserves both sides of a DST fold', () => {
    expect(booked.event).toEqual({
      id: calendarEventId(mapping.eventUuid), summary: 'Crest job',
      description: 'View the saved appointment in Crest OS: https://crest.example.com/schedule?job=' + mapping.jobId,
      start: { dateTime: time.start_at, timeZone: time.timezone }, end: { dateTime: time.end_at, timeZone: time.timezone },
      status: 'confirmed', visibility: 'private', transparency: 'opaque', reminders: { useDefault: false },
      extendedProperties: { private: { crestMapping: mapping.marker } },
    });
    expect(JSON.stringify(booked.event)).not.toContain(mapping.businessId);
    expect(JSON.stringify(booked.event)).not.toContain(mapping.destinationId);
    expect(JSON.stringify(booked.event)).not.toContain(key.appointmentId);
    expect(moved.event.id).toBe(booked.event.id);
    expect(moved.event.start.dateTime).toBe('2026-11-02T04:30:00.000001Z');
    const other = projectGoogleCalendarAppointment({ ...mapping, jobId: uuid('10'), eventUuid: uuid('11'), marker: uuid('12') },
      { ...key, jobId: uuid('10'), action: 'book', confirmation: 'confirmed', time }, options);
    expect(other.identity.eventId).not.toBe(booked.identity.eventId);
  });

  it('ignores proposed and withdrawn appointments and leaves a completed appointment alone', () => {
    const proposal = projectGoogleCalendarAppointment(mapping, { ...key, action: 'propose', confirmation: 'proposed' }, options);
    const withdrawal = projectGoogleCalendarAppointment(mapping, { ...key, action: 'withdraw', confirmation: 'withdrawn' }, options);
    const completion = projectGoogleCalendarAppointment(mapping, { ...key, action: 'complete', confirmation: 'confirmed' }, options);
    expect([proposal.action, withdrawal.action, completion.action, cancelled.action]).toEqual(['unchanged', 'unchanged', 'retain', 'remove']);
    for (const intent of [proposal, withdrawal, completion]) {
      expect(intent).not.toHaveProperty('event');
      expect(planGoogleCalendarMutation(intent, previous, missing)).toEqual({ state: 'unchanged' });
    }
  });

  it('requires each optional field to be opted in and rejects unsafe approved text', () => {
    const approved = { ...options, disclosure: { clientName: true, serviceLabel: false, workAddress: true } };
    const appointment = { ...key, action: 'book', confirmation: 'confirmed', time } as const;
    expect(projectGoogleCalendarAppointment(mapping, appointment, approved)).toMatchObject({
      event: { summary: 'Crest job · Fictional Customer', location: '123 Fictional Lane' },
    });
    for (const text of ['<a>Fake</a>', 'https://not-crest.example.com', 'Contact person@example.com', 'Call (555) 555-0123',
      '$499 detail', 'Customer\u202e', 'Customer\nname', '\ud800']) {
      const fields = { ...options.fields, clientName: text };
      expect(() => projectGoogleCalendarAppointment(mapping, appointment, { ...approved, fields })).toThrow('GOOGLE_CALENDAR_PROJECTION_REVIEW_REQUIRED');
    }
    expect(projectGoogleCalendarAppointment(mapping, appointment, {
      ...approved, fields: { ...options.fields, clientName: 'Jose\u0301', workAddress: '' },
    })).toMatchObject({ event: { summary: 'Crest job · José' } });
  });

  it('rejects mismatched tenant, malformed origins and inconsistent spring-forward times', () => {
    const appointment = { ...key, action: 'book', confirmation: 'confirmed', time } as const;
    expect(() => projectGoogleCalendarAppointment(mapping, { ...appointment, businessId: uuid('99') }, options)).toThrow();
    expect(() => projectGoogleCalendarAppointment({ ...mapping, marker: mapping.businessId }, appointment, options)).toThrow();
    for (const trustedOrigin of ['http://crest.example.com', 'https://user:secret@crest.example.com',
      'https://crest.example.com/forward', 'https://crest.example.com?token=secret']) {
      expect(() => projectGoogleCalendarAppointment(mapping, appointment, { ...options, trustedOrigin })).toThrow();
    }
    expect(() => projectGoogleCalendarAppointment(mapping, {
      ...appointment, time: { ...time, start_at: '2026-03-08T07:30:00.000001Z', local_start: '2026-03-08T02:30:00.000001' },
    }, options)).toThrow('SCHEDULE_TIME_REVIEW_REQUIRED');
  });
});

describe('Google Calendar event reconciliation', () => {
  it('requires both the marker and exact managed content, while accepting equivalent provider timestamp offsets', () => {
    expect(previous.event).toBe(booked.event);
    expect(confirmGoogleCalendarProjection({
      ...remote, start: { ...remote.start, dateTime: '2026-11-01T01:30:00.000001-04:00' },
      end: { ...remote.end, dateTime: '2026-11-01T01:30:00.000002000-05:00' },
    }, booked.event)).toEqual(previous);
    for (const changed of [
      { summary: 'Edited by Google' }, { organizer: { self: false } }, { attendees: [{ email: 'guest@example.com' }] },
      { attendeesOmitted: true }, { conferenceData: {} }, { reminders: { useDefault: true } },
      { extendedProperties: { private: { crestMapping: uuid('99') } } },
      { end: { ...remote.end, dateTime: '2026-11-01T06:30:00.000002001Z' } },
    ]) expect(confirmGoogleCalendarProjection({ ...remote, ...changed }, booked.event)).toBeNull();
  });

  it('requires proved absence for insertion and unchanged last-verified evidence for mutation', () => {
    expect(planGoogleCalendarMutation(booked, null, missing)).toMatchObject({ state: 'dispatch', mutation: { action: 'insert', desired: booked.event } });
    expect(planGoogleCalendarMutation(booked, null, observed(remote))).toEqual({ state: 'review' });
    expect(planGoogleCalendarMutation(booked, null, { state: 'missing', destinationVerified: false })).toEqual({ state: 'review' });
    expect(planGoogleCalendarMutation(moved, previous, missing)).toEqual({ state: 'review' });
    expect(planGoogleCalendarMutation(moved, previous, observed({ ...remote, etag: '"different"' }))).toEqual({ state: 'review' });
    expect(planGoogleCalendarMutation(moved, previous, observed(remote))).toEqual({
      state: 'dispatch', mutation: { action: 'update', previous, desired: moved.event },
    });
    expect(planGoogleCalendarMutation(cancelled, previous, observed(remote))).toEqual({
      state: 'dispatch', mutation: { action: 'delete', previous },
    });
  });

  it('reconciles ambiguous insert, update and cancellation against the original event only', () => {
    const insert = { action: 'insert', desired: booked.event } as const;
    const update = { action: 'update', previous, desired: moved.event } as const;
    const remove = { action: 'delete', previous } as const;
    expect(reconcileGoogleCalendarMutation(insert, observed(remote))).toEqual({ state: 'confirmed', confirmed: previous });
    expect(reconcileGoogleCalendarMutation(insert, observed({ ...remote, id: 'somethingelse' }))).toEqual({ state: 'review' });
    expect(reconcileGoogleCalendarMutation(insert, missing)).toEqual({ state: 'dispatch', mutation: insert });
    expect(reconcileGoogleCalendarMutation(update, observed(remote))).toEqual({ state: 'dispatch', mutation: update });
    expect(reconcileGoogleCalendarMutation(update, observed({ ...remote, ...moved.event, etag: '"new"' }))).toEqual({
      state: 'confirmed', confirmed: { event: moved.event, etag: '"new"' },
    });
    expect(reconcileGoogleCalendarMutation(update, missing)).toEqual({ state: 'review' });
    expect(reconcileGoogleCalendarMutation(remove, missing)).toEqual({ state: 'removed' });
    expect(reconcileGoogleCalendarMutation(remove, { state: 'missing', destinationVerified: false })).toEqual({ state: 'review' });
    expect(reconcileGoogleCalendarMutation(remove, observed({ ...remote, attendees: [{}] }))).toEqual({ state: 'review' });
  });
});
