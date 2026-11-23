import {describe,it,expect} from 'vitest';
import {recoveryProtectionStatus,nextRecoveryBackupSlot} from '../../src/tooling/recovery-protection-policy.ts';
const snapshot='2026-11-23T00:20:00.000Z';
describe('canonical backup age and UTC schedule policy',()=>{
 it.each([
  ['2026-11-23T08:19:59.999Z','current'],['2026-11-23T08:20:00.000Z','warning'],
  ['2026-11-23T12:19:59.999Z','warning'],['2026-11-23T12:20:00.000Z','critical'],
  ['2026-11-24T00:19:59.999Z','critical'],['2026-11-24T00:20:00.000Z','breach']
 ])('applies exact snapshot-age boundaries at %s', (now,level)=>{
  expect(recoveryProtectionStatus(now,snapshot)).toMatchObject({level,ordinaryFinancialWritesBlocked:false,completeBackup:false,recoveryObjectiveBreachVerified:level==='breach'});
 });
 it('does not invent a last complete point or a measured24-hour breach before a baseline exists',()=>{
  expect(recoveryProtectionStatus(snapshot,null)).toMatchObject({level:'unprotected',ageMilliseconds:null,attentionRequired:true,recoveryObjectiveBreachVerified:false,ordinaryFinancialWritesBlocked:false});
 });
 it('returns recovery status only when a newer authoritative snapshot replaces an old one',()=>{
  const now='2026-11-24T00:21:00.000Z';expect(recoveryProtectionStatus(now,snapshot).level).toBe('breach');
  expect(recoveryProtectionStatus(now,'2026-11-24T00:20:00.000Z')).toMatchObject({level:'current',ageMilliseconds:'60000'});
 });
 it('rejects a future snapshot, invalid clock and normalized impossible calendar dates',()=>{
  expect(()=>recoveryProtectionStatus(snapshot,'2026-11-23T00:20:00.001Z')).toThrow('RECOVERY_PROTECTION_REVIEW_REQUIRED');
  for(const invalid of ['2026-02-30T00:20:00.000Z','2026-11-23T00:20:00Z','not-a-date'])expect(()=>recoveryProtectionStatus(invalid,snapshot)).toThrow('RECOVERY_PROTECTION_REVIEW_REQUIRED');
 });
 it.each([
  ['2026-11-23T00:19:59.999Z','2026-11-23T00:20:00.000Z'],['2026-11-23T00:20:00.000Z','2026-11-23T06:20:00.000Z'],
  ['2026-11-23T23:59:59.999Z','2026-11-24T00:20:00.000Z'],['2026-12-31T18:20:00.000Z','2027-01-01T00:20:00.000Z'],
  ['2026-03-08T06:20:00.000Z','2026-03-08T12:20:00.000Z'],['2026-11-01T06:20:00.000Z','2026-11-01T12:20:00.000Z']
 ])('keeps the six-hour UTC schedule through day/year/DST boundaries at %s',(after,expected)=>{expect(nextRecoveryBackupSlot(after)).toBe(expected);});
});
