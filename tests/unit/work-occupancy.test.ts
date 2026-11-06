import {describe,it,expect} from 'vitest';
import {recordedOperatorOccupancy,WorkOccupancyError} from '../../src/operations/work-occupancy.ts';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const at=(minute:number)=>new Date(Date.UTC(2026,10,5,12,minute)).toISOString().replace('.000Z','.000000Z');
const work=(n:number,start:number,end:number|null,kind:'active'|'pause'='active',job=1,operator=100)=>({id:id(n),jobId:id(job),operatorId:id(operator),kind,startedAt:at(start),endedAt:end===null?null:at(end)});
const leg=(n:number,start:number,end:number|null,operator=100)=>({id:id(n),operatorId:id(operator),departedAt:at(start),arrivedAt:end===null?null:at(end)});
describe('BR07 actual work and physical travel occupancy',()=>{
 it('reconstructs arrival, work, supply-trip pause and resumed work from original records after reload',()=>{
  const w=[work(10,10,20),work(11,20,40,'pause'),work(12,40,null)],t=[leg(20,0,10),leg(21,25,35)];
  const before=JSON.stringify({w,t}),result=recordedOperatorOccupancy(w,t,at(60)),saved=JSON.parse(before);
  expect(recordedOperatorOccupancy(saved.w,saved.t,at(60))).toEqual(result);expect(JSON.stringify({w,t})).toBe(before);
  expect(result.map(v=>[v.source,v.id])).toEqual([['travel',id(20)],['work',id(10)],['travel',id(21)],['work',id(12)]]);
  expect(result.at(-1)?.endedAt).toBeNull();expect(Object.isFrozen(result)).toBe(true);expect(result.every(Object.isFrozen)).toBe(true);
 });
 it('allows an open supply trip while the only work session remains paused',()=>{
  expect(recordedOperatorOccupancy([work(10,0,10),work(11,10,null,'pause')],[leg(20,15,null)],at(20))).toHaveLength(2);
 });
 it('preserves closed zero-length evidence without treating it as active occupancy',()=>{
  expect(recordedOperatorOccupancy([work(10,5,5)],[leg(20,0,10)],at(20))).toHaveLength(2);
 });
 it('keeps equal UUIDs from independent typed source tables distinct',()=>{
  expect(recordedOperatorOccupancy([work(10,10,20)],[leg(10,0,10)],at(30))).toHaveLength(2);
 });
 it('permits independent operators without merging their time',()=>{
  const result=recordedOperatorOccupancy([work(10,0,null,'active',1,100),work(11,0,null,'active',2,101)],[leg(20,0,null,102)],at(10));
  expect(result.map(v=>v.operatorId)).toEqual([id(100),id(101),id(102)]);
 });
 it('returns no invented travel or labor for an empty source',()=>expect(recordedOperatorOccupancy([],[],at(0))).toEqual([]));
 it('sorts shuffled source deterministically using precise instants',()=>{
  const w=[work(12,20,30),work(10,0,10)],t=[leg(20,10,20)];
  expect(recordedOperatorOccupancy(w,t,at(40))).toEqual(recordedOperatorOccupancy(w.slice().reverse(),t,at(40)));
 });
 it('detects a single microsecond overlap instead of rounding it away',()=>{
  const w={...work(10,0,10),endedAt:'2026-11-05T12:10:00.000001Z'};
  expect(()=>recordedOperatorOccupancy([w],[leg(20,10,20)],at(30))).toThrow(WorkOccupancyError);
 });
 for(const [label,w,t]of [
  ['labor over an outbound leg',[work(10,5,15)],[leg(20,0,10)]],
  ['labor over a supply trip',[work(10,0,30)],[leg(20,10,20)]],
  ['work resumed before supply arrival',[work(10,0,10),work(11,10,20,'pause'),work(12,20,null)],[leg(20,15,25)]],
  ['overlapping active work across two jobs',[work(10,0,20),work(11,10,30,'active',2)],[]],
  ['second job during a historical pause',[work(10,0,30,'pause'),work(11,10,20,'active',2)],[]],
  ['second unfinished job while paused',[work(10,0,null,'pause'),work(11,10,null,'active',2)],[]],
  ['two open intervals at the same observation',[work(10,0,null),work(11,0,null)],[]],
  ['one job open for two operators',[work(10,0,null,'active',1,100),work(11,0,null,'active',1,101)],[]],
  ['two overlapping closed legs',[],[leg(20,0,20),leg(21,10,30)]],
  ['two open physical legs',[],[leg(20,0,null),leg(21,10,null)]],
  ['new active interval overlaps a just-opened leg',[work(10,0,null)],[leg(20,0,null)]],
  ['negative work interval',[work(10,20,10)],[]],
  ['negative travel interval',[],[leg(20,20,10)]],
  ['future work',[work(10,70,null)],[]],
  ['future work end',[work(10,0,70)],[]],
  ['future departure',[],[leg(20,70,null)]],
  ['future arrival',[],[leg(20,0,70)]],
  ['duplicate work source ID',[work(10,0,10),work(10,10,20)],[]],
  ['duplicate travel source ID',[],[leg(20,0,10),leg(20,10,20)]],
  ['missing work end',[{id:id(10),jobId:id(1),operatorId:id(100),kind:'active',startedAt:at(0)}],[]],
  ['missing travel end',[],[{id:id(20),operatorId:id(100),departedAt:at(0)}]],
  ['extra unreviewed work field',[{...work(10,0,10),duration:10}],[]],
  ['extra unreviewed travel field',[],[{...leg(20,0,10),distance:10}]],
  ['bad work operator',[{...work(10,0,10),operatorId:'owner'}],[]],
  ['bad job ID',[{...work(10,0,10),jobId:''}],[]],
  ['bad travel ID',[],[{...leg(20,0,10),id:'travel'}]],
  ['unsupported interval kind',[{...work(10,0,10),kind:'travel'}],[]],
  ['rounded work timestamp',[{...work(10,0,10),startedAt:'2026-11-05T12:00:00Z'}],[]],
  ['rounded travel timestamp',[],[{...leg(20,0,10),departedAt:'2026-11-05T12:00:00Z'}]],
 ]as const)it('requires review for '+label,()=>expect(()=>recordedOperatorOccupancy(w,t,at(60))).toThrow(WorkOccupancyError));
 it.each([null,{},'work'])('rejects non-array work source %s',w=>expect(()=>recordedOperatorOccupancy(w,[],at(0))).toThrow(WorkOccupancyError));
 it.each([null,{},'travel'])('rejects non-array travel source %s',t=>expect(()=>recordedOperatorOccupancy([],t,at(0))).toThrow(WorkOccupancyError));
 it('requires a valid precise server observation',()=>expect(()=>recordedOperatorOccupancy([],[],'now')).toThrow(WorkOccupancyError));
});
