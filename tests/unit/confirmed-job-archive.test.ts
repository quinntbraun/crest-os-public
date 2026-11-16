import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {buildConfirmedJobArchive} from '../../src/operations/confirmed-job-archive.ts';
import {confirmedJobRecords} from '../fixtures/confirmed-job-records.ts';
import {decodeCustomerCsv} from '../support/customer-fixture';
describe('saved confirmed job display-history archive',()=>{
 it('retains the distinct field effective, job-update and event-recording stamps and refuses a mixed head',async()=>{
  const f=confirmedJobRecords(),time=(offset:number)=>new Date(Date.parse(f.event.recordedAt)+offset).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),effectiveAt=time(1),updatedAt=time(2),recordedAt=time(3),operationId='99999999-9999-4999-8999-999999999999',field={...f.event,id:'88888888-8888-4888-8888-888888888888',sequence:'2',operationId,recordedAt,effectiveAt,fromState:'scheduled',toState:'en_route',action:'state_change',appointment:null,draft:null,customerCommunication:null},head={...f.head,job:{...f.head.job,version:'2',state:'en_route',updated_at:updatedAt,operation_id:operationId}};
  const parts=unzipSync(await buildConfirmedJobArchive({head,events:[f.event,field]})),saved=JSON.parse(strFromU8(parts['saved_job_history.json']!));expect(saved.events[1].effectiveAt).toBe(effectiveAt);expect(saved.events[1].recordedAt).toBe(recordedAt);expect(saved.head.job.updated_at).toBe(updatedAt);
  for(const event of [{...field,effectiveAt:recordedAt},{...field,recordedAt:effectiveAt},{...field,actorId:'77777777-7777-4777-8777-777777777777'},{...field,operationId:'77777777-7777-4777-8777-777777777777'},{...field,toState:'paused'}])await expect(buildConfirmedJobArchive({head,events:[f.event,event]})).rejects.toThrow();
 });
 it('retains distinct event recording and effective timestamps from one acknowledged command',async()=>{
  const {head,event}=confirmedJobRecords();event.recordedAt=new Date(new Date(event.effectiveAt).getTime()+1000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
  const parts=unzipSync(await buildConfirmedJobArchive({head,events:[event]})),saved=JSON.parse(strFromU8(parts['saved_job_history.json']!));expect(saved.events[0].recordedAt).toBe(event.recordedAt);expect(saved.events[0].effectiveAt).toBe(head.job.created_at);expect(saved.events[0].recordedAt).not.toBe(saved.events[0].effectiveAt);
 });
 it('round trips formula-leading text, SQL null, literal backslashes, normalized JSON and exact microseconds',async()=>{
  const {head,event}=confirmedJobRecords();const reason=' =Synthetic formula\nUnicode ★ \\N';Object.assign(event,{reason});Object.assign(head.appointment,{reason});Object.assign(head.latestAppointment,{reason});Object.assign(event.appointment,{reason});
  const parts=unzipSync(await buildConfirmedJobArchive({head,events:[event]})),read=(name:string)=>decodeCustomerCsv(strFromU8(parts[name+'.csv']!),strFromU8(parts[name+'_escape_map.json']!));
  const json=(v:unknown)=>{expect(typeof v).toBe('string');return JSON.parse(v as string);};
  expect(read('job')[0]!.version).toBe('1');expect(read('job')[0]!.completed_at).toBeNull();expect(json(read('job')[0]!.work_location_snapshot)).toEqual(head.job.work_location_snapshot);
  expect(read('appointments')[0]!.start_at).toBe(head.appointment.start_at);expect(read('appointments')[0]!.local_start).toBe(head.appointment.local_start);expect(read('appointments')[0]!.reason).toBe(event.reason);expect(read('history')[0]!.reason).toBe(event.reason);expect(read('history')[0]!.fromState).toBeNull();expect(json(read('history')[0]!.draft)).toEqual(event.draft);
  expect(JSON.parse(strFromU8(parts['saved_job_history.json']!)).events[0]).toEqual(event);
 });
 it('provides verifiable hashes and truthful partial-export boundaries',async()=>{
  const {head,event}=confirmedJobRecords(),parts=unzipSync(await buildConfirmedJobArchive({head,events:[event]})),manifest=JSON.parse(strFromU8(parts['manifest.json']!));expect(Object.keys(parts)).toHaveLength(9);expect(manifest).toMatchObject({throughVersion:'1',completeCrestExport:false,completeBackup:false,referenceClosureComplete:false,originalHashInputsIncluded:false,unsavedDraftIncluded:false});
  for(const part of manifest.parts){expect(parts[part.name]!.length).toBe(part.bytes);expect(createHash('sha256').update(parts[part.name]!).digest('hex')).toBe(part.sha256);}
 });
 for(const kind of ['missing','gap','mixed-business','substituted-head','invented-sent','wrong-current-appointment'] as const)it('refuses '+kind,async()=>{
  const {head,event}=confirmedJobRecords();if(kind==='missing')await expect(buildConfirmedJobArchive({head,events:[]})).rejects.toThrow();
  else{if(kind==='gap')event.sequence='2';if(kind==='mixed-business')event.appointment.business_id='99999999-9999-4999-8999-999999999999';if(kind==='substituted-head')head.job.updated_at='2026-01-01T00:00:00.000000Z';if(kind==='invented-sent')event.draft.state='sent';if(kind==='wrong-current-appointment')head.appointment.id='99999999-9999-4999-8999-999999999999';await expect(buildConfirmedJobArchive({head,events:[event]})).rejects.toThrow();}
 });
});
