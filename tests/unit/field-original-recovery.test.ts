import {randomUUID,randomBytes} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {fieldOriginalKinds,parseFieldOriginal,parseFieldOriginalResult} from '../../src/operations/field-original-contract';
import {originalOperationFixture} from '../support/original-operation-fixture';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../src/client/pending-scheduling';
import {openPendingOriginalOperation} from '../../src/client/pending-original-operation';
import {lookupSchedulingOriginal} from '../../src/client/scheduling-original';
function packet(kind:typeof fieldOriginalKinds[number]){
 const original=parseFieldOriginal(originalOperationFixture(kind)),ref=original.reference;
 const target='legVersionId'in ref?{subjectId:ref.legId,sourceRecordId:randomUUID(),sourceVersion:'2'}:
  'jobId'in ref?{subjectId:ref.jobId,sourceRecordId:ref.jobId,
   sourceVersion:(BigInt(ref.expectedJobVersion)+(kind==='operations.job.work_boundary.correct'?0n:1n)).toString()}:
  {subjectId:ref.legId,sourceRecordId:randomUUID(),sourceVersion:'expectedEvidenceVersion'in ref?
   (BigInt(ref.expectedEvidenceVersion)+1n).toString():ref.expectedLegVersionId===null?'1':'2'};
 const auditCount=kind==='operations.job.work_boundary.correct'?2:kind==='operations.job.work_start.correct'||kind==='operations.job.work_end.correct'?3:1;
 const result={state:'committed',receipt:{schemaVersion:1,commandType:kind,businessId:original.businessId,actorId:randomUUID(),
  operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,...target,sourceAuditIds:Array.from({length:auditCount},()=>randomUUID())}};
 return {schemaVersion:1,original,result};
}
const proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
afterEach(()=>vi.unstubAllGlobals());
it.each(fieldOriginalKinds)('binds the source-verified minimal %s receipt and keeps private field values out',kind=>{
 const p=packet(kind),r=parseFieldOriginalResult(p,p.original);expect(r.state).toBe('committed');expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.state==='committed'&&r.receipt.sourceAuditIds)).toBe(true);expect(JSON.stringify(r)).not.toMatch(/location|odometer|amount|notes|payload|hash/i);
 for(const key of ['operationId','recoveryEpoch','businessId','subjectId','sourceRecordId']){
  const ref=p.original.reference;
  const value=key==='sourceRecordId'&&'legVersionId'in ref?ref.legVersionId:
   key==='sourceRecordId'&&!('jobId'in ref)?'invalid':randomUUID();
  const wrong={...p,result:{...p.result,receipt:{...p.result.receipt,[key]:value}}};
  expect(()=>parseFieldOriginalResult(wrong,p.original)).toThrow();
 }
 expect(()=>parseFieldOriginalResult({...p,result:{...p.result,receipt:{...p.result.receipt,sourceVersion:'0'}}},p.original)).toThrow();
 expect(()=>parseFieldOriginalResult({...p,result:{...p.result,receipt:{...p.result.receipt,sourceAuditIds:[]}}},p.original)).toThrow();
 expect(()=>parseFieldOriginalResult({schemaVersion:1,state:'original_recorded',original:p.original},p.original)).toThrow();
 expect(parseFieldOriginalResult({state:'absent'},p.original)).toEqual({state:'absent'});
});
it.each(fieldOriginalKinds)('reconciles %s through the existing authenticated scheduling transport before clearing',async kind=>{
 const p=packet(kind),memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
 const store=createPendingSchedulingStore(storage,kind),binding=randomBytes(32).toString('base64url');store.write({schemaVersion:1,businessId:p.original.businessId,binding,reference:p.original.reference});
 expect(JSON.stringify([...memory])).not.toMatch(/location|reason|odometer|actualMiles|payload|hash/i);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json','cache-control':'private, no-store'}}));vi.stubGlobal('fetch',fetcher);
 const target=openPendingOriginalOperation(kind,storage,p.original.businessId)!;expect(await target.reconcile(proof(),new AbortController().signal)).toBe('committed');expect(memory.has(pendingSchedulingKeys[kind])).toBe(false);expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/business/scheduling/original',expect.any(Object));
});
it.each(['action','expectedLegVersionId','expectedJobVersion','expectedEvidenceVersion','location','draft'])('rejects mismatched or private field reference %s',key=>{
 for(const kind of fieldOriginalKinds){
  const p=packet(kind),validAtMax=kind==='operations.job.work_boundary.correct'||kind==='operations.mobile_departure.correct';
  const value=key==='expectedJobVersion'||key==='expectedEvidenceVersion'?validAtMax?'9223372036854775808':'9223372036854775807':'Untrusted private value';
  const original={...p.original,reference:{...p.original.reference,[key]:value}};
  expect(()=>parseFieldOriginal(original)).toThrow();
 }
});
it('retrieves the largest permitted audit-reference list within the existing private response limit',async()=>{
 const p=packet('operations.job.complete');p.result.receipt.sourceAuditIds=Array.from({length:10000},()=>randomUUID());expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(1048576);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json','cache-control':'private, no-store'}})));
 const r=await lookupSchedulingOriginal(p.original,proof(),new AbortController().signal);expect(r.state).toBe('committed');if(r.state==='committed'&&'sourceAuditIds'in r.receipt)expect(r.receipt.sourceAuditIds).toHaveLength(10000);
});
it('still refuses an oversized typed audit list even when its private response fits the transport limit',async()=>{
 const p=packet('operations.job.complete');p.result.receipt.sourceAuditIds=Array.from({length:10001},()=>randomUUID());
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json','cache-control':'private, no-store'}})));
 await expect(lookupSchedulingOriginal(p.original,proof(),new AbortController().signal)).rejects.toThrow();
});
