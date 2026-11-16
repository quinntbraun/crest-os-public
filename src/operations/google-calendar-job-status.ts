import { customerInstant as instant, customerUuid as uuid, customerVersion as version,
  exactCustomerObject as exact } from '../customer/customer-contract.ts';

const states = ['disconnected', 'not_queued', 'pending', 'in_progress', 'synced', 'removed', 'delayed', 'reconnect', 'review'] as const;
type CalendarJobState = typeof states[number];

export function parseGoogleCalendarJobStatus(value: unknown, expectedJob: string) {
  if (!exact(value, ['schemaVersion', 'jobId', 'appointmentVersion', 'state', 'lastConfirmedVersion', 'lastConfirmedAt']) ||
    value.schemaVersion !== 1 || !uuid(value.jobId) || value.jobId !== expectedJob || !version(value.appointmentVersion) ||
    typeof value.state !== 'string' || !(states as readonly string[]).includes(value.state)) throw Error('GOOGLE_CALENDAR_JOB_STATUS_UNVERIFIED');
  const { lastConfirmedVersion, lastConfirmedAt } = value;
  if (!(lastConfirmedVersion === null && lastConfirmedAt === null) &&
    !(version(lastConfirmedVersion) && instant(lastConfirmedAt) && BigInt(lastConfirmedVersion) <= BigInt(value.appointmentVersion)))
    throw Error('GOOGLE_CALENDAR_JOB_STATUS_UNVERIFIED');
  if (['synced', 'removed'].includes(value.state) && lastConfirmedVersion !== value.appointmentVersion)
    throw Error('GOOGLE_CALENDAR_JOB_STATUS_UNVERIFIED');
  return { schemaVersion: 1, jobId: value.jobId, appointmentVersion: value.appointmentVersion, state: value.state as CalendarJobState,
    lastConfirmedVersion, lastConfirmedAt };
}

export type GoogleCalendarJobStatus = ReturnType<typeof parseGoogleCalendarJobStatus>;
