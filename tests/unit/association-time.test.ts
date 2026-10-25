import {it,expect} from 'vitest';
import {associationCurrentTime} from '../../src/app/vehicles/association-time';
it('records only the explicit current-time sample as six-digit UTC without altering entered source times',()=>{expect(associationCurrentTime(new Date('2026-10-25T01:02:03.123Z'))).toBe('2026-10-25T01:02:03.123000Z');expect(associationCurrentTime(new Date('2026-10-25T01:02:03.000Z'))).toBe('2026-10-25T01:02:03.000000Z');});
it('preserves actual leap-day and UTC date boundaries without local-time inference',()=>{expect(associationCurrentTime(new Date('2024-02-29T23:59:59.999Z'))).toBe('2024-02-29T23:59:59.999000Z');expect(associationCurrentTime(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000000Z');});
it('refuses invalid and out-of-contract civil dates',()=>{for(const date of [new Date(NaN),new Date('0000-01-01T00:00:00Z'),new Date('+010000-01-01T00:00:00Z')])expect(()=>associationCurrentTime(date)).toThrow('ASSOCIATION_TIME_INVALID');});
