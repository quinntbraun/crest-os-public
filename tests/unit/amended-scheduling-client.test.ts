import {it,expect,vi,afterEach} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {scheduling} from '../../src/client/scheduling';
import {parseBookJobCommand,parseCancelJobCommand,bindBookingCommandReceipt} from '../../src/operations/amended-booking-contract';
import {syntheticBookingRequest} from '../fixtures/confirmed-booking';
import {schedulingOriginalFixture} from '../fixtures/scheduling-original';
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const response=(v:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json','cache-control':'private, no-store',...headers}});
const book=()=>{const q=syntheticBookingRequest();return parseBookJobCommand({...q,schemaVersion:2,payload:{...q.payload,allocationPlans:q.payload.allocationPlans.map(p=>({...p,entitlementVersionId:randomUUID()}))}});};
const cancel=()=>{const q=book();return parseCancelJobCommand({schemaVersion:2,businessId:q.businessId,operationId:randomUUID(),recoveryEpoch:q.recoveryEpoch,jobId:q.jobId,expectedJobVersion:'1',payload:{reason:'Synthetic visit cancellation',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},allocationPlans:[{sourceAllocationId:randomUUID(),entitlementVersionId:randomUUID(),expectedPlanId:randomUUID(),expectedSequence:'2'}]}});};
afterEach(()=>vi.unstubAllGlobals());
it.each(['book','cancel'] as const)('transports exact revised %s observations and binds its own receipt without a legacy downgrade',async kind=>{
 const q=kind==='book'?book():cancel(),template=schedulingOriginalFixture(kind==='book'?'operations.job.book':'operations.job.cancel').envelope.result;
 const receipt={...template,operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,receipt:{...template.receipt,schemaVersion:2,businessId:q.businessId,jobId:q.jobId}},fetcher=vi.fn<typeof fetch>().mockResolvedValue(response(receipt));vi.stubGlobal('fetch',fetcher);
 const result=kind==='book'?await scheduling.book(bookRequest(q),proof(),signal()):await scheduling.cancel(parseCancelJobCommand(q),proof(),signal());expect(result).toEqual(receipt);expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(Object.fromEntries(Object.entries(q).filter(([key])=>key!=='businessId')));
 fetcher.mockResolvedValue(response({...receipt,receipt:{...receipt.receipt,schemaVersion:1}}));await expect(kind==='book'?scheduling.book(bookRequest(q),proof(),signal()):scheduling.cancel(parseCancelJobCommand(q),proof(),signal())).rejects.toMatchObject({kind:'unknown'});expect(fetcher).toHaveBeenCalledTimes(2);
});
const bookRequest=(q:unknown)=>parseBookJobCommand(q);
it('keeps strict legacy commands and refuses missing revised observations or unknown profiles',()=>{
 const legacy=syntheticBookingRequest();expect(parseBookJobCommand(legacy)).toEqual(legacy);expect(()=>parseBookJobCommand({...legacy,schemaVersion:2})).toThrow();expect(()=>parseBookJobCommand({...legacy,schemaVersion:3})).toThrow();const q=cancel();expect(()=>parseCancelJobCommand({...q,schemaVersion:1})).toThrow();
 const template=schedulingOriginalFixture('operations.job.book').envelope.result,value={...template,operationId:legacy.operationId,recoveryEpoch:legacy.recoveryEpoch,receipt:{...template.receipt,businessId:legacy.businessId,jobId:legacy.jobId}};expect(bindBookingCommandReceipt(value,'book',legacy)).toEqual(value);expect(()=>bindBookingCommandReceipt({...value,receipt:{...value.receipt,schemaVersion:2}},'book',legacy)).toThrow();
});
it('exposes revised scheduling only from the authenticated workspace capability header',async()=>{
 const q=book(),value={schemaVersion:1,businessId:q.businessId,operatorId:q.payload.operatorId,timezone:'UTC',modeVersion:null,writeState:'ready',recoveryEpoch:q.recoveryEpoch},binding=randomBytes(32).toString('base64url'),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(value,{'x-crest-edit-binding':binding})).mockResolvedValueOnce(response(value,{'x-crest-edit-binding':binding,'x-crest-amended-scheduling':'1'}));vi.stubGlobal('fetch',fetcher);expect(await scheduling.workspace(proof(),signal())).not.toHaveProperty('amendedSchedulingAvailable');expect(await scheduling.workspace(proof(),signal())).toHaveProperty('amendedSchedulingAvailable',true);
});
