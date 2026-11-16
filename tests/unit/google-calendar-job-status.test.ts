import { describe, expect, it } from 'vitest';
import { parseGoogleCalendarJobStatus } from '../../src/operations/google-calendar-job-status.ts';

const job = '123e4567-e89b-42d3-a456-426614174001';
const pending = { schemaVersion: 1, jobId: job, appointmentVersion: '3', state: 'pending',
  lastConfirmedVersion: '1', lastConfirmedAt: '2026-11-03T17:30:00.123456Z' };

describe('Calendar job status authority and exact version', () => {
  it('retains the previous confirmation on a newer pending appointment', () => {
    expect(parseGoogleCalendarJobStatus(pending, job)).toEqual(pending);
  });

  it('requires the current appointment version to report sync or removal', () => {
    for (const state of ['synced', 'removed']) {
      expect(() => parseGoogleCalendarJobStatus({ ...pending, state }, job)).toThrow();
      const current = { ...pending, state, lastConfirmedVersion: '3' };
      expect(parseGoogleCalendarJobStatus(current, job)).toEqual(current);
    }
  });

  it('rejects an unrelated job, extra provider details, and incomplete or impossible confirmation', () => {
    const invalid = [
      { ...pending, jobId: '123e4567-e89b-42d3-a456-426614174002' },
      { ...pending, providerEventId: 'fictional-event' },
      { ...pending, lastConfirmedVersion: '4' },
      { ...pending, lastConfirmedAt: null },
    ];
    for (const value of invalid) expect(() => parseGoogleCalendarJobStatus(value, job)).toThrow();
  });
});
