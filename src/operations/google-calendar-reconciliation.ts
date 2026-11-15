import { customerInstant } from '../customer/customer-contract.ts';
import { scheduleInstantMicroseconds } from './schedule-time.ts';
import type { GoogleCalendarEvent, projectGoogleCalendarAppointment } from './google-calendar-projection.ts';

type Intent = ReturnType<typeof projectGoogleCalendarAppointment>;
export type CalendarObservation =
  | Readonly<{ state: 'present'; event: unknown }>
  | Readonly<{ state: 'missing'; destinationVerified: boolean }>
  | Readonly<{ state: 'review' }>;

export type ConfirmedCalendarEvent = Readonly<{ event: GoogleCalendarEvent; etag: string }>;
export type CalendarMutation =
  | Readonly<{ action: 'insert'; desired: GoogleCalendarEvent }>
  | Readonly<{ action: 'update'; previous: ConfirmedCalendarEvent; desired: GoogleCalendarEvent }>
  | Readonly<{ action: 'delete'; previous: ConfirmedCalendarEvent }>;

type CalendarDecision =
  | Readonly<{ state: 'unchanged' | 'removed' | 'review' }>
  | Readonly<{ state: 'confirmed'; confirmed: ConfirmedCalendarEvent }>
  | Readonly<{ state: 'dispatch'; mutation: CalendarMutation }>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function instant(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return;
  const [, wall, digits = '', offset] = match;
  if (/[^0]/.test(digits.slice(6))) return;
  const local = wall + '.' + digits.slice(0, 6).padEnd(6, '0') + 'Z';
  if (!customerInstant(local)) return;
  if (offset === 'Z') return scheduleInstantMicroseconds(local);
  const minutes = Number(offset!.slice(1, 3)) * 60 + Number(offset!.slice(4));
  if (minutes > 840 || Number(offset!.slice(4)) >= 60 || offset === '-00:00') return;
  return scheduleInstantMicroseconds(local) - BigInt(offset![0] === '-' ? -minutes : minutes) * 60_000_000n;
}

function timeMatches(value: unknown, expected: GoogleCalendarEvent['start']) {
  const time = record(value);
  return time?.date === undefined && time?.timeZone === expected.timeZone &&
    instant(time.dateTime) === scheduleInstantMicroseconds(expected.dateTime);
}

function absentOrEmptyArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

export function calendarEventEtag(value: unknown): value is string {
  return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,256}"$/.test(value);
}

// Compare the retained payload, not just the provider ID or ownership marker.
// The organizer must be the calendar where the authenticated read occurred.
export function confirmGoogleCalendarProjection(observed: unknown, expected: GoogleCalendarEvent): ConfirmedCalendarEvent | null {
  const remote = record(observed);
  if (!remote || remote.id !== expected.id || !calendarEventEtag(remote.etag) ||
    remote.status !== 'confirmed' || remote.visibility !== expected.visibility ||
    (remote.transparency ?? 'opaque') !== expected.transparency ||
    remote.summary !== expected.summary || remote.description !== expected.description ||
    (remote.location ?? '') !== (expected.location ?? '') ||
    !timeMatches(remote.start, expected.start) || !timeMatches(remote.end, expected.end) ||
    record(remote.organizer)?.self !== true ||
    !absentOrEmptyArray(remote.attendees) || remote.attendeesOmitted === true ||
    !absentOrEmptyArray(remote.recurrence) || remote.recurringEventId !== undefined ||
    !absentOrEmptyArray(remote.attachments) || remote.conferenceData !== undefined || remote.hangoutLink !== undefined ||
    remote.locked === true || remote.endTimeUnspecified === true ||
    (remote.eventType ?? 'default') !== 'default') return null;
  const reminders = record(remote.reminders);
  const properties = record(remote.extendedProperties);
  if (reminders?.useDefault !== false || !absentOrEmptyArray(reminders.overrides) ||
    record(properties?.private)?.crestMapping !== expected.extendedProperties.private.crestMapping) return null;
  return { event: expected, etag: remote.etag };
}

function sameIdentity(event: GoogleCalendarEvent, intent: Intent) {
  return event.id === intent.identity.eventId && event.extendedProperties.private.crestMapping === intent.identity.marker;
}

// Use only for work that the durable journal proves has never been dispatched.
// Uncertain work goes through reconcileGoogleCalendarMutation first.
export function planGoogleCalendarMutation(intent: Intent, previous: ConfirmedCalendarEvent | null, observation: CalendarObservation): CalendarDecision {
  if (intent.action === 'unchanged' || intent.action === 'retain') return { state: 'unchanged' };
  if (!previous) {
    if (observation.state !== 'missing' || !observation.destinationVerified) return { state: 'review' };
    return intent.action === 'remove' ? { state: 'unchanged' } : { state: 'dispatch', mutation: { action: 'insert', desired: intent.event } };
  }
  if (!sameIdentity(previous.event, intent) || observation.state !== 'present' ||
    confirmGoogleCalendarProjection(observation.event, previous.event)?.etag !== previous.etag) return { state: 'review' };
  if (intent.action === 'remove') return { state: 'dispatch', mutation: { action: 'delete', previous } };
  const desired = confirmGoogleCalendarProjection(observation.event, intent.event);
  return desired ? { state: 'confirmed', confirmed: desired } : { state: 'dispatch', mutation: { action: 'update', previous, desired: intent.event } };
}

// Input is the exact mutation recorded before I/O, not a newly projected job.
// A retry is explicitly the same mutation, subject to the worker's fences.
export function reconcileGoogleCalendarMutation(mutation: CalendarMutation, observation: CalendarObservation): CalendarDecision {
  if (observation.state === 'missing' && observation.destinationVerified) {
    if (mutation.action === 'delete') return { state: 'removed' };
    if (mutation.action === 'insert') return { state: 'dispatch', mutation };
  }
  if (observation.state !== 'present') return { state: 'review' };
  if (mutation.action !== 'delete') {
    const expected = confirmGoogleCalendarProjection(observation.event, mutation.desired);
    if (expected) return { state: 'confirmed', confirmed: expected };
  }
  if (mutation.action !== 'insert' &&
    confirmGoogleCalendarProjection(observation.event, mutation.previous.event)?.etag === mutation.previous.etag) {
    return { state: 'dispatch', mutation };
  }
  return { state: 'review' };
}
