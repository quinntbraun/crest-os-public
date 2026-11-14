import {describe,it,expect} from 'vitest';
import {summarizeWorkTime,WorkTimeError} from '../../src/operations/work-time.ts';
import type {RecordedWorkInterval} from '../../src/operations/work-time.ts';
const at=(minute:number)=>new Date(Date.UTC(2026,10,4,14,minute)).toISOString().replace('.000Z','.000000Z');
const interval=(kind:'active'|'pause',start:number,end:number|null):RecordedWorkInterval=>({kind,startedAt:at(start),endedAt:end===null?null:at(end)});
describe('BR07 recorded work time',()=>{
 it('derives60 active and10 paused minutes from a70-minute recorded session',()=>{
  const result=summarizeWorkTime([interval('active',0,30),interval('pause',30,40),interval('active',40,70)],at(90));
  expect(result).toEqual({observedAt:at(90),firstStartedAt:at(0),closedThrough:at(70),closedActiveMicroseconds:'3600000000',closedPauseMicroseconds:'600000000',observedActiveMicroseconds:'3600000000',observedPauseMicroseconds:'600000000',elapsedMicroseconds:'4200000000',unrecordedMicroseconds:'0',openInterval:null,continuous:true});
 });
 it('retains open work separately from closed evidence and advances only through a new supplied observation',()=>{
  const records=[interval('active',0,10),interval('pause',10,20),interval('active',20,null)];
  const saved=JSON.stringify(records),first=summarizeWorkTime(records,at(25)),reloaded=summarizeWorkTime(JSON.parse(saved),at(25)),later=summarizeWorkTime(records,at(30));
  expect(reloaded).toEqual(first);expect(first.closedActiveMicroseconds).toBe('600000000');expect(first.observedActiveMicroseconds).toBe('900000000');expect(later.closedActiveMicroseconds).toBe(first.closedActiveMicroseconds);expect(later.observedActiveMicroseconds).toBe('1200000000');expect(later.observedPauseMicroseconds).toBe('600000000');expect(later.openInterval).toEqual({kind:'active',startedAt:at(20)});expect(JSON.stringify(records)).toBe(saved);
 });
 it('preserves open pause and a zero observed interval without inventing an end',()=>{
  const result=summarizeWorkTime([interval('active',0,10),interval('pause',10,null)],at(10));
  expect(result.openInterval).toEqual({kind:'pause',startedAt:at(10)});expect(result.closedThrough).toBe(at(10));expect(result.closedPauseMicroseconds).toBe('0');expect(result.observedPauseMicroseconds).toBe('0');
 });
 it('exposes an unrecorded gap instead of treating it as labor or pause',()=>{
  const result=summarizeWorkTime([interval('active',0,10),interval('pause',15,20)],at(30));
  expect(result.continuous).toBe(false);expect(result.unrecordedMicroseconds).toBe('300000000');expect(result.elapsedMicroseconds).toBe('1200000000');expect(result.observedActiveMicroseconds).toBe('600000000');expect(result.observedPauseMicroseconds).toBe('300000000');
 });
 it('uses exact UTC microseconds across the Unix epoch and does not round to milliseconds',()=>{
  const result=summarizeWorkTime([{kind:'active',startedAt:'1969-12-31T23:59:59.999999Z',endedAt:'1970-01-01T00:00:00.000001Z'}],'1970-01-01T00:00:00.000002Z');
  expect(result.closedActiveMicroseconds).toBe('2');expect(result.elapsedMicroseconds).toBe('2');expect(JSON.parse(JSON.stringify(result))).toEqual(result);
 });
 it('counts overnight waiting as pause through actual UTC instants, independent of DST wall labels',()=>{
  const result=summarizeWorkTime([{kind:'active',startedAt:'2026-11-01T05:00:00.000000Z',endedAt:'2026-11-01T05:30:00.000000Z'},{kind:'pause',startedAt:'2026-11-01T05:30:00.000000Z',endedAt:'2026-11-02T05:30:00.000000Z'},{kind:'active',startedAt:'2026-11-02T05:30:00.000000Z',endedAt:'2026-11-02T06:00:00.000000Z'}],'2026-11-02T06:00:00.000000Z');
  expect(result.observedActiveMicroseconds).toBe('3600000000');expect(result.observedPauseMicroseconds).toBe('86400000000');expect(result.elapsedMicroseconds).toBe('90000000000');
 });
 it('represents no recorded session as absent elapsed time',()=>{
  const result=summarizeWorkTime([],at(0));expect(result.firstStartedAt).toBeNull();expect(result.elapsedMicroseconds).toBeNull();expect(result.openInterval).toBeNull();expect(result.closedActiveMicroseconds).toBe('0');
 });
 it('does not add idle time after the last recorded closed interval',()=>{
  const result=summarizeWorkTime([interval('active',0,10)],at(120));expect(result.elapsedMicroseconds).toBe('600000000');expect(result.closedThrough).toBe(at(10));
 });
 for(const [label,records,observed]of [
  ['overlapping work and pause',[interval('active',0,20),interval('pause',10,30)],at(30)],
  ['reverse chronology',[interval('active',20,30),interval('active',0,10)],at(30)],
  ['negative interval',[interval('active',20,10)],at(30)],
  ['two open intervals',[interval('active',0,null),interval('pause',10,null)],at(20)],
  ['closed interval after an open interval',[interval('active',0,null),interval('pause',20,30)],at(40)],
  ['future closed evidence',[interval('active',0,30)],at(20)],
  ['future open start',[interval('active',30,null)],at(20)],
  ['missing end field',[{kind:'active',startedAt:at(0)}],at(20)],
  ['unknown kind',[{kind:'travel',startedAt:at(0),endedAt:at(10)}],at(20)],
  ['unreviewed extra field',[{...interval('active',0,10),duration:5}],at(20)],
  ['rounded source timestamp',[{kind:'active',startedAt:'2026-11-04T14:00:00Z',endedAt:at(10)}],at(20)],
  ['invalid observation',[interval('active',0,10)],'not a date'],
  ['non-array source',null,at(20)]
 ]as const)it('rejects '+label,()=>{expect(()=>summarizeWorkTime(records,observed)).toThrow(WorkTimeError);});
 it('seals summary values without modifying the source',()=>{
  const records=Object.freeze([Object.freeze(interval('active',0,null))]),result=summarizeWorkTime(records,at(10));expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.openInterval)).toBe(true);expect(records[0]?.endedAt).toBeNull();
 });
});
