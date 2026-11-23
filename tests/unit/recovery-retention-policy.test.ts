import {describe,it,expect} from 'vitest';
import {planRecoveryRetention} from '../../src/tooling/recovery-retention-policy.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const point=(n:number,snapshotAt:string,completedAt=snapshotAt,retainUntil='2028-12-31T00:00:00.000Z')=>({pointId:id(n),snapshotAt,completedAt,retainUntil});
const plan=(now:string,points:Parameters<typeof planRecoveryRetention>[0]['points'],timeZone='America/Chicago')=>planRecoveryRetention({now,timeZone,points});

describe('complete-point local-calendar retention planning',()=>{
 it('chooses the last successful point before Chicago month end, including the UTC next day',()=>{
  const result=plan('2026-11-02T12:00:00.000Z',[
   point(3,'2026-11-01T05:00:00.000Z'),point(1,'2026-10-31T23:00:00.000Z'),point(2,'2026-11-01T04:59:59.999Z')
  ]),month=result.designations.find(x=>x.kind==='month_end'&&x.localDate==='2026-10-31');
  expect(month).toMatchObject({pointId:id(2),boundaryExclusive:'2026-11-01T05:00:00.000Z'});
  expect(month?.minimumRetainUntil).toBe(new Date(Date.parse('2026-11-01T05:00:00.000Z')+400*86400000).toISOString());
 });
 it('excludes a candidate that starts before month end but completes after it',()=>{
  const result=plan('2026-11-02T12:00:00.000Z',[point(1,'2026-10-31T18:20:00.000Z'),point(2,'2026-11-01T04:00:00.000Z','2026-11-01T05:01:00.000Z')]);
  expect(result.designations.find(x=>x.kind==='month_end'&&x.localDate==='2026-10-31')?.pointId).toBe(id(1));
 });
 it.each([
  ['2026-03-09T12:00:00.000Z','2026-03-08','2026-03-09T05:00:00.000Z'],
  ['2026-11-02T12:00:00.000Z','2026-11-01','2026-11-02T06:00:00.000Z'],
  ['2028-03-01T12:00:00.000Z','2028-02-29','2028-03-01T06:00:00.000Z'],
  ['2027-01-01T12:00:00.000Z','2026-12-31','2027-01-01T06:00:00.000Z']
 ])('uses real local boundaries through DST/leap/year transitions at%s',(now,date,boundary)=>{
  const result=plan(now,[]);expect(result.designations.find(x=>x.kind==='daily'&&x.localDate===date)?.boundaryExclusive).toBe(boundary);
  expect(result.designations.filter(x=>x.kind==='daily')).toHaveLength(35);
 });
 it('does not turn a missing daily point into another copy of an older point',()=>{
  const result=plan('2026-11-03T12:00:00.000Z',[point(1,'2026-11-01T18:20:00.000Z')]);
  expect(result.designations.find(x=>x.kind==='daily'&&x.localDate==='2026-11-02')?.pointId).toBeNull();
  expect(result.designations.find(x=>x.kind==='daily'&&x.localDate==='2026-11-01')?.pointId).toBe(id(1));
  expect(result.missingBoundaryCount).toBeGreaterThan(0);
 });
 it('falls back to the last successful older month point while exposing an expired existing lock',()=>{
  const result=plan('2026-11-02T12:00:00.000Z',[point(1,'2026-09-30T18:20:00.000Z',undefined,'2026-10-08T18:20:00.000Z')]);
  expect(result.designations.find(x=>x.kind==='month_end'&&x.localDate==='2026-10-31')?.pointId).toBe(id(1));
  expect(result.points[0]).toMatchObject({existingLockInsufficient:true,existingLockExpired:true,currentlyRequired:true});
  expect(result.points[0]?.minimumRetainUntil).toBe('2027-12-06T05:00:00.000Z');
 });
 it('preserves longer existing protection and gives additional six-hour points seven days from snapshot',()=>{
  const result=plan('2026-11-23T15:00:00.000Z',[point(1,'2026-11-23T12:20:00.000Z')]);
  expect(result.points[0]).toMatchObject({minimumRetainUntil:'2026-11-30T12:20:00.000Z',retainUntil:'2028-12-31T00:00:00.000Z',existingLockInsufficient:false,designations:[]});
 });
 it('keeps all still-live400-day monthly boundaries, including more than twelve calendar months',()=>{
  const result=plan('2026-11-02T12:00:00.000Z',[]),months=result.designations.filter(x=>x.kind==='month_end');
  expect(months).toHaveLength(14);expect(months.at(-1)?.localDate).toBe('2025-09-30');
  expect(months.at(-1)?.minimumRetainUntil).toBe('2026-11-05T05:00:00.000Z');
  expect(months.every(x=>Date.parse(x.minimumRetainUntil)>Date.parse(result.evaluatedAt))).toBe(true);
 });
 it('handles fractional offsets and midnight gaps without substituting a different local date',()=>{
  expect(plan('2026-11-02T12:00:00.000Z',[],'Asia/Kathmandu').designations[0]?.boundaryExclusive).toBe('2026-11-01T18:15:00.000Z');
  expect(plan('2018-11-05T12:00:00.000Z',[],'America/Sao_Paulo').designations[0]?.boundaryExclusive).toBe('2018-11-05T02:00:00.000Z');
 });
 it('refuses duplicate IDs, future/completion inversions, invalid dates and timezone substitutions',()=>{
  const now='2026-11-23T15:00:00.000Z',p=point(1,'2026-11-23T12:20:00.000Z');
  for(const points of[[p,p],[{...p,snapshotAt:'2026-11-24T12:20:00.000Z'}],[{...p,completedAt:'2026-11-24T12:20:00.000Z'}],[{...p,snapshotAt:'2026-02-30T00:00:00.000Z'}],[{...p,retainUntil:'2026-11-22T00:00:00.000Z'}]])expect(()=>plan(now,points)).toThrow('RECOVERY_RETENTION_REVIEW_REQUIRED');
  for(const zone of['-06:00','America/Fictional',' America/Chicago'])expect(()=>plan(now,[],zone)).toThrow('RECOVERY_RETENTION_REVIEW_REQUIRED');
 });
 it('never authenticates inventory, applies retention or authorizes original deletion or backup success',()=>{
  expect(plan('2026-11-23T15:00:00.000Z',[])).toMatchObject({inventoryAuthenticated:false,retentionApplied:false,originalDeletionAuthorized:false,completeBackup:false});
 });
});
