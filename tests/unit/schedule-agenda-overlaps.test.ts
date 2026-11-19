import {describe,it,expect} from 'vitest';
import {loadedAppointmentOverlaps} from '../../src/client/schedule-agenda-overlaps';

const visit=(jobId:string,start:string,end:string,operatorId='owner',state:'scheduled'|'cancelled'='scheduled')=>({jobId,operatorId,state,startAt:'2026-11-03T'+start+'Z',endAt:'2026-11-03T'+end+'Z'});
describe('loaded appointment time evidence',()=>{
 it('marks both actual overlapping appointments',()=>{expect([...loadedAppointmentOverlaps([visit('a','10:00:00.000000','11:00:00.000000'),visit('b','10:30:00.000000','11:30:00.000000')])].sort()).toEqual(['a','b']);});
 it('keeps touching appointment boundaries separate',()=>{expect(loadedAppointmentOverlaps([visit('a','10:00:00.000000','11:00:00.000000'),visit('b','11:00:00.000000','12:00:00.000000')]).size).toBe(0);});
 it('does not compare different operators',()=>{expect(loadedAppointmentOverlaps([visit('a','10:00:00.000000','11:00:00.000000','a'),visit('b','10:00:00.000000','11:00:00.000000','b')]).size).toBe(0);});
 it('excludes cancelled visits from both sides of a comparison',()=>{expect(loadedAppointmentOverlaps([visit('a','10:00:00.000000','11:00:00.000000','owner','cancelled'),visit('b','10:30:00.000000','11:30:00.000000')]).size).toBe(0);});
 it('compares exact microseconds rather than rounded milliseconds',()=>{expect([...loadedAppointmentOverlaps([visit('a','10:00:00.000000','10:00:00.000002'),visit('b','10:00:00.000001','10:00:00.000003')])].sort()).toEqual(['a','b']);expect(loadedAppointmentOverlaps([visit('a','10:00:00.000000','10:00:00.000001'),visit('b','10:00:00.000001','10:00:00.000002')]).size).toBe(0);});
 it('handles unsorted nested intervals without changing input order',()=>{const visits=[visit('c','10:40:00.000000','10:45:00.000000'),visit('a','10:00:00.000000','12:00:00.000000'),visit('b','10:30:00.000000','11:00:00.000000')];expect([...loadedAppointmentOverlaps(visits)].sort()).toEqual(['a','b','c']);expect(visits.map(row=>row.jobId)).toEqual(['c','a','b']);});
 it('leaves an empty or single loaded page unmarked',()=>{expect(loadedAppointmentOverlaps([]).size).toBe(0);expect(loadedAppointmentOverlaps([visit('a','10:00:00.000000','11:00:00.000000')]).size).toBe(0);});
});
