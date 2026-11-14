import { customerUuid, customerVersion } from '../customer/customer-contract.ts';
import { parseScheduleTime } from './schedule-time.ts';
import type { ScheduleTime } from './schedule-time.ts';

// Allocate eventUuid and marker once when persisting a job/destination mapping.
// Appointment revisions, reconnects and recovery must keep that identity.
export type CalendarMapping = Readonly<{
  businessId: string;
  jobId: string;
  destinationId: string;
  eventUuid: string;
  marker: string;
}>;

export type CalendarDisclosure = Readonly<{
  clientName: boolean;
  serviceLabel: boolean;
  workAddress: boolean;
}>;

type CalendarOptionalFields = Readonly<{
  clientName?: string | null;
  serviceLabel?: string | null;
  workAddress?: string | null;
}>;

type CalendarAppointment = Readonly<{
  businessId: string;
  jobId: string;
  appointmentId: string;
  appointmentSequence: string;
}> & (
  | Readonly<{ action: 'book' | 'confirm'; confirmation: 'confirmed'; time: ScheduleTime }>
  | Readonly<{ action: 'complete'; confirmation: 'confirmed' }>
  | Readonly<{ action: 'propose'; confirmation: 'proposed' }>
  | Readonly<{ action: 'withdraw'; confirmation: 'withdrawn' }>
  | Readonly<{ action: 'cancel'; confirmation: 'cancelled' }>
);

export type GoogleCalendarEvent = Readonly<{
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: Readonly<{ dateTime: string; timeZone: string }>;
  end: Readonly<{ dateTime: string; timeZone: string }>;
  status: 'confirmed';
  visibility: 'private';
  transparency: 'opaque';
  reminders: Readonly<{ useDefault: false }>;
  extendedProperties: Readonly<{ private: Readonly<{ crestMapping: string }> }>;
}>;

export function requireCalendarProjection(condition: unknown): asserts condition {
  if (!condition) throw Error('GOOGLE_CALENDAR_PROJECTION_REVIEW_REQUIRED');
}

function publishedText(value: string | null | undefined, limit: number) {
  if (value === undefined || value === null) return '';
  const text = value.trim().normalize('NFC');
  // Summary and location are plain text. Reject controls, unpaired surrogates,
  // bidi overrides, markup and embedded URLs in the approved display fields.
  requireCalendarProjection([...text].length <= limit &&
    !/[\p{Cc}\p{Cs}\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069<>]|(?:https?:|javascript:|data:|www\.)/iu.test(text) &&
    !/\S+@\S+\.[\p{L}]{2,}|(?:\d[\s().-]*){9,}\d|\p{Sc}\s*\d/iu.test(text));
  return text;
}

function scheduleLink(trustedOrigin: string, jobId: string) {
  let origin: URL;
  try { origin = new URL(trustedOrigin); }
  catch { throw Error('GOOGLE_CALENDAR_PROJECTION_REVIEW_REQUIRED'); }
  requireCalendarProjection(origin.protocol === 'https:' && origin.origin === trustedOrigin);
  const url = new URL('/schedule', origin);
  url.searchParams.set('job', jobId);
  return url.href;
}

export function calendarEventId(eventUuid: string) {
  requireCalendarProjection(customerUuid(eventUuid) && eventUuid !== '00000000-0000-0000-0000-000000000000');
  return eventUuid.replaceAll('-', '');
}

// The worker supplies the committed transition and retained consent snapshot.
// This builds an intent only. It confers no right to dispatch or modify Crest.
export function projectGoogleCalendarAppointment(mapping: CalendarMapping, appointment: CalendarAppointment, options: Readonly<{
  trustedOrigin: string;
  disclosure: CalendarDisclosure;
  fields?: CalendarOptionalFields;
}>) {
  requireCalendarProjection(customerUuid(mapping.businessId) && customerUuid(mapping.jobId) && customerUuid(mapping.destinationId) &&
    customerUuid(mapping.marker) && mapping.marker !== '00000000-0000-0000-0000-000000000000' &&
    new Set([mapping.businessId, mapping.jobId, mapping.destinationId, mapping.marker, mapping.eventUuid]).size === 5 &&
    mapping.businessId === appointment.businessId && mapping.jobId === appointment.jobId &&
    customerUuid(appointment.appointmentId) && customerVersion(appointment.appointmentSequence));
  const identity = Object.freeze({
    businessId: mapping.businessId, destinationId: mapping.destinationId, jobId: mapping.jobId,
    appointmentId: appointment.appointmentId, appointmentSequence: appointment.appointmentSequence,
    eventId: calendarEventId(mapping.eventUuid), marker: mapping.marker,
  });

  switch (appointment.action) {
    case 'propose':
    case 'withdraw':
      requireCalendarProjection(appointment.confirmation === (appointment.action === 'propose' ? 'proposed' : 'withdrawn'));
      return Object.freeze({ action: 'unchanged' as const, identity });
    case 'complete':
      requireCalendarProjection(appointment.confirmation === 'confirmed');
      return Object.freeze({ action: 'retain' as const, identity });
    case 'cancel':
      requireCalendarProjection(appointment.confirmation === 'cancelled');
      return Object.freeze({ action: 'remove' as const, identity });
    case 'book':
    case 'confirm': {
      requireCalendarProjection(appointment.confirmation === 'confirmed');
      const time = parseScheduleTime(appointment.time);
      const { trustedOrigin, disclosure, fields } = options;
      requireCalendarProjection(typeof disclosure.clientName === 'boolean' && typeof disclosure.serviceLabel === 'boolean' &&
        typeof disclosure.workAddress === 'boolean');
      const client = disclosure.clientName ? publishedText(fields?.clientName, 200) : '';
      const service = disclosure.serviceLabel ? publishedText(fields?.serviceLabel, 200) : '';
      const address = disclosure.workAddress ? publishedText(fields?.workAddress, 512) : '';
      const event: GoogleCalendarEvent = Object.freeze({
        id: identity.eventId,
        summary: ['Crest job', service, client].filter(Boolean).join(' · '),
        description: 'View the saved appointment in Crest OS: ' + scheduleLink(trustedOrigin, mapping.jobId),
        ...(address ? { location: address } : {}),
        start: Object.freeze({ dateTime: time.start_at, timeZone: time.timezone }),
        end: Object.freeze({ dateTime: time.end_at, timeZone: time.timezone }),
        status: 'confirmed', visibility: 'private', transparency: 'opaque',
        reminders: Object.freeze({ useDefault: false }),
        extendedProperties: Object.freeze({ private: Object.freeze({ crestMapping: identity.marker }) }),
      });
      return Object.freeze({ action: 'publish' as const, identity, event });
    }
    default:
      throw Error('GOOGLE_CALENDAR_PROJECTION_REVIEW_REQUIRED');
  }
}
