import {it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createJobChangeController} from '../../src/client/job-change-controller';
import type {JobChangeKind} from '../../src/client/job-change-controller';
import {createPendingSchedulingStore} from '../../src/client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../src/client/scheduling';
import {lookupSchedulingOriginal} from '../../src/client/scheduling-original';
import type {ScheduleChangePayload} from '../../src/operations/confirmed-reschedule-contract';
import {jobChangeFixture,jobChangeCommitted} from '../fixtures/job-change';
function setup(kind:JobChangeKind,proposed=false){
 const f=jobChangeFixture(proposed),map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}},store=createPendingSchedulingStore(storage,kind==='cancel'?'operations.job.cancel':'operations.job.reschedule'),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000},context={binding:randomBytes(32).toString('base64url'),context:{schemaVersion:1 as const,businessId:f.q.businessId,operatorId:f.q.payload.operatorId,timezone:'UTC',modeVersion:f.mode,writeState:'ready' as const,recoveryEpoch:randomUUID()}};
 const api={...scheduling,workspace:vi.fn(async()=>context),resources:vi.fn(async()=>f.resources),cancel:vi.fn<typeof scheduling.cancel>().mockImplementation(async request=>jobChangeCommitted(request) as Awaited<ReturnType<typeof scheduling.cancel>>),reschedule:vi.fn<typeof scheduling.reschedule>().mockImplementation(async request=>jobChangeCommitted(request) as Awaited<ReturnType<typeof scheduling.reschedule>>)},lookup=vi.fn<typeof lookupSchedulingOriginal>().mockResolvedValue({state:'absent'}),controller=createJobChangeController({kind,store,api,lookup,session:async()=>proof,change:()=>{}}),payload=kind==='cancel'?f.cancel:f.proposal,mutate=kind==='cancel'?api.cancel:api.reschedule;
 return {f,context,map,storage,store,api,lookup,controller,payload,mutate};
}
it.each(['cancel','reschedule'] as const)('%s binds the original version and keeps only its committed outcome',async kind=>{
 const f=setup(kind);await f.controller.load(f.f.q.jobId);await f.controller.save(f.payload);expect(f.mutate).toHaveBeenCalledOnce();expect(f.mutate.mock.calls[0]![0]).toMatchObject({expectedJobVersion:'1',jobId:f.f.q.jobId,recoveryEpoch:f.context.context.recoveryEpoch});expect(f.controller.view()).toMatchObject({phase:'committed',resources:null,context:null,savedJobId:f.f.q.jobId,savedVersion:'2'});expect(f.store.read()).toBeNull();f.controller.dispose();
});
it.each(['cancel','reschedule'] as const)('%s recovers a lost committed reply without repeating the mutation',async kind=>{
 const f=setup(kind);f.mutate.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load(f.f.q.jobId);await f.controller.save(f.payload);const request=f.mutate.mock.calls[0]![0],result=jobChangeCommitted(request);expect(f.controller.view()).toMatchObject({phase:'pending',resources:null,canRetry:false});const text=[...f.map.values()][0]!;expect(text).not.toContain('Synthetic');expect(text).not.toContain('amountCents');f.lookup.mockResolvedValueOnce(result);await f.controller.check();expect(f.controller.view()).toMatchObject({phase:'committed',savedVersion:'2'});expect(f.mutate).toHaveBeenCalledOnce();expect(f.store.read()).toBeNull();f.controller.dispose();
});
it.each(['cancel','reschedule'] as const)('%s cannot retry an absent original after the private draft is cleared',async kind=>{
 const f=setup(kind);f.mutate.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load(f.f.q.jobId);await f.controller.save(f.payload);f.controller.suspend();await f.controller.load(f.f.q.jobId);expect(f.controller.view()).toMatchObject({phase:'pending',canRetry:false,resources:null});await f.controller.retry();expect(f.mutate).toHaveBeenCalledOnce();expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it.each(['cancel','reschedule'] as const)('%s requires status review before an explicit identical retry',async kind=>{
 const f=setup(kind);f.mutate.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load(f.f.q.jobId);await f.controller.save(f.payload);const original=f.mutate.mock.calls[0]![0];await f.controller.check();expect(f.controller.view().canRetry).toBe(true);await f.controller.retry();expect(f.mutate).toHaveBeenCalledTimes(2);expect(f.mutate.mock.calls[1]![0]).toEqual(original);expect(f.lookup).toHaveBeenCalledTimes(2);f.controller.dispose();
});
it('retains correct server-confirmed status when only local cleanup fails',async()=>{
 const f=setup('cancel');await f.controller.load(f.f.q.jobId);f.storage.removeItem=()=>{throw Error();};await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'pending',savedJobId:f.f.q.jobId,savedVersion:'2',canRetry:false});expect(f.controller.view().message).toContain('server confirmed this change was saved');expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('does not submit when the pending identity cannot be stored and verified',async()=>{
 const f=setup('reschedule');await f.controller.load(f.f.q.jobId);f.storage.setItem=()=>{throw Error();};await f.controller.save(f.payload);expect(f.mutate).not.toHaveBeenCalled();expect(f.controller.view()).toMatchObject({phase:'blocked',resources:null});expect(f.controller.view().message).toContain('No request was submitted');f.controller.dispose();
});
it('refuses to combine a loaded job with a different authenticated context',async()=>{
 const f=setup('cancel');await f.controller.load(f.f.q.jobId);f.api.workspace.mockResolvedValueOnce({...f.context,binding:randomBytes(32).toString('base64url')});await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'unavailable',resources:null});expect(f.mutate).not.toHaveBeenCalled();expect(f.store.read()).toBeNull();f.controller.dispose();
});
it('a stale-job response is a known rollback and needs current facts before another change',async()=>{
 const f=setup('cancel');await f.controller.load(f.f.q.jobId);f.api.cancel.mockResolvedValueOnce({state:'conflict',reason:'version'});await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'review',resources:null});expect(f.controller.view().message).toContain('No new change was saved');expect(f.store.read()).toBeNull();f.controller.dispose();
});
it('refuses an acknowledged receipt for an unrelated resulting version',async()=>{
 const f=setup('cancel');await f.controller.load(f.f.q.jobId);f.api.cancel.mockImplementationOnce(async request=>{const result=jobChangeCommitted(request);return {...result,receipt:{...result.receipt,version:'99'}} as Awaited<ReturnType<typeof scheduling.cancel>>;});await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'pending',savedJobId:'',savedVersion:''});expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('does not expose change controls after actual work starts',async()=>{
 const f=setup('cancel');f.api.resources.mockResolvedValueOnce({...f.f.resources,head:{...f.f.resources.head,job:{...f.f.resources.head.job,state:'in_progress',first_work_at:f.f.resources.head.job.created_at}}});await f.controller.load(f.f.q.jobId);expect(f.controller.view()).toMatchObject({phase:'blocked',resources:null});expect(f.mutate).not.toHaveBeenCalled();f.controller.dispose();
});
it.each(['confirm','withdraw'] as const)('binds %s to the actual saved proposal, preserving job identity',async action=>{
 const f=setup('reschedule',true);await f.controller.load(f.f.q.jobId);const latest=f.f.resources.head.latestAppointment,payload:ScheduleChangePayload=action==='withdraw'?{action,reason:'Synthetic proposal withdrawn.',latestAppointmentId:latest.id,expectedModeSequence:null,appointment:null,customerConfirmation:null,conflictReview:null}:{action,reason:'Synthetic customer confirmed.',latestAppointmentId:latest.id,expectedModeSequence:'1',appointment:null,customerConfirmation:{channel:'phone',effectiveAt:f.f.resources.head.job.updated_at,evidenceNote:'Synthetic customer confirmed this exact saved proposal.'},conflictReview:{expectedAppointmentIds:[],expectedUnknownTravel:false,unknownTravelReviewed:false,overrideReason:null}};await f.controller.save(payload);expect(f.api.reschedule.mock.calls[0]![0]).toMatchObject({jobId:f.f.q.jobId,expectedJobVersion:'2',payload:{action,latestAppointmentId:latest.id}});expect(f.controller.view()).toMatchObject({phase:'committed',savedVersion:'3'});f.controller.dispose();
});
it('ignores a late committed cancellation reply after private details are hidden',async()=>{
 const f=setup('cancel');await f.controller.load(f.f.q.jobId);let resolve!:(value:Awaited<ReturnType<typeof scheduling.cancel>>)=>void;f.api.cancel.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const saving=f.controller.save(f.payload);await vi.waitFor(()=>expect(f.api.cancel).toHaveBeenCalledOnce());const request=f.api.cancel.mock.calls[0]![0];f.controller.suspend();resolve(jobChangeCommitted(request) as Awaited<ReturnType<typeof scheduling.cancel>>);await saving;expect(f.controller.view()).toMatchObject({phase:'pending',resources:null,savedJobId:'',canRetry:false});expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
