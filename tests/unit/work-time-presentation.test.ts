import {describe,expect,it} from 'vitest';
import {parseJobWorkTime} from '../../src/operations/job-work-time-contract';
import {workIntervalChain,workIntervalChanges,workTimeDuration} from '../../src/app/schedule/work/time/work-time-presentation';
const business='10000000-0000-4000-8000-000000000001',job='10000000-0000-4000-8000-000000000002';
const id=(n:number)=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const at=(minute:number)=>'2026-11-18T10:'+String(minute).padStart(2,'0')+':00.000000Z';
function data(){
 const first={intervalId:id(1),versionId:id(1),sequence:'1',kind:'active',startedAt:at(0),endedAt:null,pauseReason:null,recordReason:null,changeKind:'open',replacesVersionId:null,recordedAt:at(0)};
 const closed={...first,versionId:id(2),sequence:'2',endedAt:at(10),changeKind:'close',replacesVersionId:id(1),recordedAt:at(10)};
 const corrected={...closed,versionId:id(3),sequence:'3',endedAt:at(12),changeKind:'correct',replacesVersionId:id(2),recordReason:'  Retained reason\r\nexact  ',recordedAt:at(20)};
 const pause={...first,intervalId:id(4),versionId:id(4),kind:'pause',startedAt:at(12),endedAt:at(15),pauseReason:'Equipment check',recordReason:'Paper evidence',changeKind:'record',recordedAt:at(20)};
 const value=parseJobWorkTime({schemaVersion:1,businessId:business,jobId:job,jobVersion:'5',jobState:'completed',observedAt:at(30),intervalVersions:[first,closed,pause,corrected]},business,job);
 if('state'in value)throw Error();return value;
}
describe('work interval evidence presentation',()=>{
 it('attaches only the current interval replacement chain, retaining version order',()=>{const loaded=data();expect(workIntervalChain(loaded,loaded.intervals[0]!)?.map(row=>row.sequence)).toEqual(['1','2','3']);expect(workIntervalChain(loaded,loaded.intervals[1]!)?.map(row=>row.intervalId)).toEqual([id(4)]);});
 it('refuses broken replacement identity and skipped versions',()=>{const loaded=data(),current=loaded.intervals[0]!;for(const replacement of [{...current,replacesVersionId:id(9)},{...current,sequence:'4'}])expect(workIntervalChain({...loaded,record:{...loaded.record,intervalVersions:loaded.record.intervalVersions.map(row=>row.versionId===current.versionId?replacement:row)}},current)).toBeNull();});
 it('refuses an interval that is not current in the supplied snapshot',()=>{const loaded=data();expect(workIntervalChain(loaded,loaded.record.intervalVersions[0]!)).toBeNull();});
 it('compares changed timing only against the exact adjacent replacement',()=>{const loaded=data(),rows=workIntervalChain(loaded,loaded.intervals[0]!)!;expect(workIntervalChanges(rows[1],rows[2]!)).toEqual([{key:'endedAt',label:'End',before:at(10),after:at(12)}]);expect(rows[2]!.recordReason).toBe('  Retained reason\r\nexact  ');});
 it('does not compare different intervals, a skipped version or an unrelated replacement',()=>{const loaded=data(),current=loaded.intervals[0]!,previous=loaded.record.intervalVersions[1]!;expect(workIntervalChanges(loaded.intervals[1],current)).toBeNull();expect(workIntervalChanges(previous,{...current,sequence:'4'})).toBeNull();expect(workIntervalChanges(previous,{...current,replacesVersionId:id(9)})).toBeNull();});
 it('retains null endpoints and subsecond changes exactly',()=>{const loaded=data(),first=loaded.record.intervalVersions[0]!,closed=loaded.record.intervalVersions[1]!;expect(workIntervalChanges(first,closed)).toEqual([{key:'endedAt',label:'End',before:null,after:at(10)}]);expect(workIntervalChanges(closed,{...loaded.intervals[0]!,endedAt:'2026-11-18T10:10:00.000001Z'})).toEqual([{key:'endedAt',label:'End',before:at(10),after:'2026-11-18T10:10:00.000001Z'}]);});
 it('keeps duration display below one second honest and does not round up',()=>{expect(workTimeDuration('0')).toBe('0s');expect(workTimeDuration('1')).toBe('<1s');expect(workTimeDuration('999999')).toBe('<1s');expect(workTimeDuration('1999999')).toBe('1s');expect(workTimeDuration('60000000')).toBe('1m 0s');expect(workTimeDuration('3600000000')).toBe('1h 0m 0s');});
});
