import {it,expect,vi,afterEach} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {schedulingOriginalKinds,parseSchedulingOriginalResult} from '../../src/operations/scheduling-original-contract.ts';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../src/client/pending-scheduling.ts';
import {openPendingOriginalOperation} from '../../src/client/pending-original-operation.ts';
import {schedulingOriginalFixture} from '../fixtures/scheduling-original.ts';
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
afterEach(()=>vi.unstubAllGlobals());
it.each(schedulingOriginalKinds)('only clears acknowledged %s after a complete matching typed receipt',async kind=>{
 const {original,envelope}=schedulingOriginalFixture(kind),binding=randomBytes(32).toString('base64url'),memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}},store=createPendingSchedulingStore(storage,kind);
 store.write({schemaVersion:1,businessId:original.businessId,binding,reference:original.reference});const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(envelope),{headers:{'content-type':'application/json','cache-control':'private, no-store'}}));vi.stubGlobal('fetch',fetcher);
 expect(await openPendingOriginalOperation(kind,storage,original.businessId)!.reconcile(proof(),signal())).toBe('committed');expect(memory.size).toBe(0);expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({originalJson:JSON.stringify(original)});expect(fetcher.mock.calls[0]![0]).toBe('/api/business/scheduling/original');
});
it.each(schedulingOriginalKinds)('retains %s when the server envelope changes an opaque original reference',async kind=>{
 const {original,envelope}=schedulingOriginalFixture(kind),memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}},store=createPendingSchedulingStore(storage,kind);store.write({schemaVersion:1,businessId:original.businessId,binding:randomBytes(32).toString('base64url'),reference:original.reference});
 const changed=structuredClone(envelope);const ref=changed.original.reference;if('priorEventId' in ref)Object.assign(ref,{priorEventId:randomUUID()});else if('expectedModeSequence' in ref)Object.assign(ref,{expectedModeSequence:'2'});else if('latestAppointmentId' in ref)Object.assign(ref,{latestAppointmentId:randomUUID()});else if('expectedJobVersion' in ref)Object.assign(ref,{expectedJobVersion:'99'});else Object.assign(ref,{expectedSequence:kind.endsWith('initialize')?'1':'2'});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(changed),{headers:{'content-type':'application/json','cache-control':'private, no-store'}})));await expect(openPendingOriginalOperation(kind,storage,original.businessId)!.reconcile(proof(),signal())).rejects.toThrow();expect(memory.has(pendingSchedulingKeys[kind])).toBe(true);
});
it('rejects a recorded observation and rejects impossible receipt version/action without discarding identity',()=>{
 const {original,envelope}=schedulingOriginalFixture('operations.job.reschedule');expect(()=>parseSchedulingOriginalResult({schemaVersion:1,state:'original_recorded',original},original)).toThrow();expect(()=>parseSchedulingOriginalResult({...envelope,result:{...envelope.result,receipt:{...envelope.result.receipt,version:'99'}}},original)).toThrow();expect(()=>parseSchedulingOriginalResult({...envelope,result:{...envelope.result,receipt:{...envelope.result.receipt,action:'confirm'}}},original)).toThrow();
});
it('persists no draft, refuses duplicate decoded storage keys and never overwrites another unresolved request',()=>{
 const {original}=schedulingOriginalFixture('operations.job.book'),memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}},store=createPendingSchedulingStore(storage,'operations.job.book'),pending={schemaVersion:1 as const,businessId:original.businessId,binding:randomBytes(32).toString('base64url'),reference:original.reference};
 expect(()=>store.write({...pending,payload:{customerName:'private draft'}} as typeof pending)).toThrow();expect(memory.size).toBe(0);store.write(pending);expect(()=>store.write(pending)).toThrow();const key=pendingSchedulingKeys['operations.job.book'];memory.set(key,memory.get(key)!.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'));expect(()=>store.read()).toThrow();expect(memory.has(key)).toBe(true);
});
