import {it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createBookJobController} from '../../src/client/book-job-controller';
import {initialBookingPayload,bookingWindow} from '../../src/client/booking-form';
import {createPendingSchedulingStore} from '../../src/client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../src/client/scheduling';
import {lookupSchedulingOriginal} from '../../src/client/scheduling-original';
import {addresses} from '../../src/client/customer-addresses';
import {AuthenticationError} from '../../src/client/authentication';
import {parseBookingAgreement} from '../../src/operations/booking-context-contract';
import type {BookJobSave} from '../../src/operations/confirmed-booking-contract';
import {bookingContextFixture} from '../fixtures/booking-context';
function committed(q:BookJobSave){const audit=randomUUID();return {state:'committed' as const,operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,receipt:{schemaVersion:1 as const,businessId:q.businessId,jobId:q.jobId,version:'1',appointmentId:randomUUID(),appointmentSequence:'1',jobAuditEventId:audit,sourceAuditIds:[audit]}};}
function setup(){
 const f=bookingContextFixture(),record=parseBookingAgreement(f.agreement,f.q.businessId,f.agreement.familyId);if('state'in record)throw Error();
 const map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}},store=createPendingSchedulingStore(storage,'operations.job.book');
 const proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000},context={binding:randomBytes(32).toString('base64url'),context:{schemaVersion:1 as const,businessId:f.q.businessId,operatorId:f.q.payload.operatorId,timezone:'UTC',modeVersion:null,writeState:'ready' as const,recoveryEpoch:randomUUID()}},session=vi.fn(async()=>proof);
 const api={...scheduling,workspace:vi.fn(async()=>context),agreement:vi.fn(async()=>record),book:vi.fn(async(q:BookJobSave)=>committed(q))},lookup=vi.fn<typeof lookupSchedulingOriginal>().mockResolvedValue({state:'absent'}),addressApi={...addresses,list:vi.fn(async()=>({addresses:[],hasMore:false}))},change=vi.fn();
 const controller=createBookJobController({store,api,session,lookup,addressApi,change});
 const payload=()=>({...initialBookingPayload(record,context.context.operatorId,controller.view().jobId,'UTC'),workLocation:f.q.payload.workLocation,appointment:f.q.payload.appointment,conflictReview:{expectedAppointmentIds:[],expectedUnknownTravel:false,overrideReason:null}});
 return {f,record,map,storage,store,context,session,api,lookup,addressApi,controller,payload};
}
it('binds a complete booking to fresh accepted scope and clears only its acknowledged pending identity',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);await f.controller.save(f.payload());expect(f.api.book).toHaveBeenCalledOnce();const q=f.api.book.mock.calls[0]![0];expect(q).toMatchObject({businessId:f.context.context.businessId,expectedModeSequence:'0',recoveryEpoch:f.context.context.recoveryEpoch});expect(f.controller.view()).toMatchObject({phase:'committed',savedJobId:q.jobId,agreement:null,context:null,addresses:[]});expect(f.store.read()).toBeNull();f.controller.dispose();
});
it('retains only opaque identity after a lost reply and finds the exact original without another save',async()=>{
 const f=setup();let saved!:ReturnType<typeof committed>;f.api.book.mockImplementationOnce(async q=>{saved=committed(q);throw new SchedulingClientError('unknown');});await f.controller.load(f.record.familyId);await f.controller.save(f.payload());expect(f.controller.view()).toMatchObject({phase:'pending',canRetry:false,agreement:null});const raw=[...f.map.values()][0]!;expect(raw).not.toContain('Synthetic');expect(Object.keys(JSON.parse(raw).reference).sort()).toEqual(['expectedModeSequence','jobId','operationId','recoveryEpoch']);f.lookup.mockResolvedValueOnce(saved);await f.controller.check();expect(f.controller.view()).toMatchObject({phase:'committed',savedJobId:saved.receipt.jobId});expect(f.api.book).toHaveBeenCalledOnce();expect(f.store.read()).toBeNull();f.controller.dispose();
});
it('reloaded pending identity cannot retry a private draft that no longer exists',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.api.book.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.save(f.payload());f.controller.suspend();await f.controller.load(f.record.familyId);expect(f.controller.view()).toMatchObject({phase:'pending',canRetry:false,agreement:null});expect(f.controller.view().message).toContain('private draft is unavailable');await f.controller.retry();expect(f.api.book).toHaveBeenCalledOnce();expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('explicit retry checks the original again and reuses unchanged command identity and content',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);const payload=f.payload();f.api.book.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.save(payload);const first=f.api.book.mock.calls[0]![0];await f.controller.check();expect(f.controller.view().canRetry).toBe(true);await f.controller.retry();expect(f.api.book).toHaveBeenCalledTimes(2);expect(f.api.book.mock.calls[1]![0]).toEqual(first);expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.controller.view().phase).toBe('committed');f.controller.dispose();
});
it('does not disclose or inspect another authenticated context’s original reference',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.api.book.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.save(f.payload());f.api.workspace.mockResolvedValueOnce({...f.context,binding:randomBytes(32).toString('base64url')});await f.controller.check();expect(f.controller.view()).toMatchObject({phase:'pending',reference:'',canRetry:false});expect(f.lookup).not.toHaveBeenCalled();expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('makes a failed reference-storage write accurately not submitted and sends nothing',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.storage.setItem=()=>{throw Error('storage unavailable');};await f.controller.save(f.payload());expect(f.api.book).not.toHaveBeenCalled();expect(f.controller.view()).toMatchObject({phase:'blocked',agreement:null});expect(f.controller.view().message).toContain('No booking was submitted');f.controller.dispose();
});
it('rejects altered accepted totals before creating a pending reference',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);const payload=f.payload(),plan=payload.allocationPlans[0]!,part=plan.parts[0]!;await f.controller.save({...payload,allocationPlans:[{...plan,parts:[{...part,grossInclusiveCents:(BigInt(part.grossInclusiveCents)+1n).toString(),amountCents:(BigInt(part.amountCents)+1n).toString()}]}]});expect(f.api.book).not.toHaveBeenCalled();expect(f.store.read()).toBeNull();expect(f.controller.view().phase).toBe('ready');f.controller.dispose();
});
it('stale scope conflicts remove only the known failed request and require fresh review',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.api.book.mockResolvedValueOnce({state:'conflict',reason:'allocation'} as never);await f.controller.save(f.payload());expect(f.controller.view()).toMatchObject({phase:'review',agreement:null,savedJobId:''});expect(f.store.read()).toBeNull();expect(f.api.book).toHaveBeenCalledOnce();f.controller.dispose();
});
it('hiding during dispatch preserves the original identity and ignores a late successful reply',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);let resolve!:(v:ReturnType<typeof committed>)=>void;f.api.book.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const saving=f.controller.save(f.payload());await vi.waitFor(()=>expect(f.api.book).toHaveBeenCalledOnce());const q=f.api.book.mock.calls[0]![0];f.controller.suspend();resolve(committed(q));await saving;expect(f.controller.view()).toMatchObject({phase:'pending',agreement:null,savedJobId:'',canRetry:false});expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('fresh sign-in denial clears private facts without submitting a request',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.session.mockRejectedValueOnce(new AuthenticationError('denied'));await f.controller.save(f.payload());expect(f.controller.view()).toMatchObject({phase:'signed-out',agreement:null,context:null});expect(f.api.book).not.toHaveBeenCalled();expect(f.store.read()).toBeNull();f.controller.dispose();
});
it('a failed optional address lookup does not pretend there are no saved addresses',async()=>{
 const f=setup();f.addressApi.list.mockRejectedValueOnce(Error());await f.controller.load(f.record.familyId);expect(f.controller.view()).toMatchObject({phase:'ready',addressesAvailable:false,addresses:[]});f.controller.dispose();
});
it('retains exact real instants and reviewed offsets across a repeated daylight-saving hour',()=>{
 expect(bookingWindow('2026-11-01T05:30:00.123456Z','2026-11-01T06:30:00.123456Z','America/Indiana/Indianapolis')).toMatchObject({local_start:'2026-11-01T01:30:00.123456',local_end:'2026-11-01T01:30:00.123456',start_offset_minutes:-240,end_offset_minutes:-300});
});
it('does not call a confirmed server save unknown when only local reference cleanup fails',async()=>{
 const f=setup();let saved!:ReturnType<typeof committed>;f.api.book.mockImplementationOnce(async q=>{saved=committed(q);return saved;});await f.controller.load(f.record.familyId);f.storage.removeItem=()=>{throw Error('storage unavailable');};await f.controller.save(f.payload());expect(f.controller.view()).toMatchObject({phase:'pending',savedJobId:saved.receipt.jobId,canRetry:false});expect(f.controller.view().message).toContain('server confirmed this job was saved');expect(f.store.read()).not.toBeNull();f.storage.removeItem=key=>{f.map.delete(key);};f.lookup.mockResolvedValueOnce(saved);await f.controller.check();expect(f.controller.view().phase).toBe('committed');expect(f.api.book).toHaveBeenCalledOnce();f.controller.dispose();
});
it('keeps a known rollback distinct from an unknown save when local reference cleanup fails',async()=>{
 const f=setup();await f.controller.load(f.record.familyId);f.storage.removeItem=()=>{throw Error();};f.api.book.mockResolvedValueOnce({state:'conflict',reason:'review'} as never);await f.controller.save(f.payload());expect(f.controller.view()).toMatchObject({phase:'pending',savedJobId:'',canRetry:false});expect(f.controller.view().message).toContain('No booking was saved. Local reference cleanup');await f.controller.check();expect(f.controller.view().canRetry).toBe(false);expect(f.api.book).toHaveBeenCalledOnce();f.controller.dispose();
});
it('does not invite another booking when all accepted scope is already assigned',async()=>{
 const f=setup(),jobId=randomUUID(),assigned=parseBookingAgreement({...f.record,sources:f.record.sources.map(source=>({...source,planId:randomUUID(),planSequence:'1',parts:source.parts.map(part=>({...part,jobId,state:'assigned'}))}))},f.record.businessId,f.record.familyId);if('state'in assigned)throw Error();f.api.agreement.mockResolvedValueOnce(assigned);await f.controller.load(f.record.familyId);expect(f.controller.view()).toMatchObject({phase:'blocked',agreement:null});expect(f.controller.view().message).toContain('No unassigned accepted work remains');expect(f.api.book).not.toHaveBeenCalled();f.controller.dispose();
});
