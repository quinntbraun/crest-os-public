import { projectGoogleCalendarAppointment } from './google-calendar-projection.ts';
import type { CalendarDisclosure } from './google-calendar-projection.ts';

const sampleIds = ['1', '2', '3', '4', '5', '6'].map(tail => 'bb881100-ac11-4200-a920-00000000000' + tail) as
  [string, string, string, string, string, string];

export function googleCalendarInitialConsentPreview(trustedOrigin: string, disclosure: CalendarDisclosure) {
  const [businessId, jobId, destinationId, eventUuid, marker, appointmentId] = sampleIds;
  const projected = projectGoogleCalendarAppointment({ businessId, jobId, destinationId, eventUuid, marker }, {
    businessId, jobId, appointmentId, appointmentSequence: '1', action: 'book', confirmation: 'confirmed',
    time: {
      timezone: 'America/Indiana/Indianapolis', start_at: '2026-11-13T15:00:00.000000Z', end_at: '2026-11-13T16:00:00.000000Z',
      local_start: '2026-11-13T10:00:00.000000', local_end: '2026-11-13T11:00:00.000000',
      start_offset_minutes: -300, end_offset_minutes: -300,
    },
  }, { trustedOrigin, disclosure, fields: { clientName: 'Sample Client', serviceLabel: 'Sample Detail', workAddress: '123 Sample Lane' } });
  if (projected.action !== 'publish') throw Error('GOOGLE_CALENDAR_PREVIEW_REQUIRED');
  return Object.freeze({
    payloadVersion: 1 as const,
    calendarName: 'Crest Jobs',
    example: projected.event,
    sharingReview: 'In Google Calendar, open Settings for Crest Jobs and review access permissions and sharing with specific people.',
    notificationReview: 'Review event notifications in Google Calendar and lock-screen previews on your phone. Crest disables event reminders it creates.',
  });
}
