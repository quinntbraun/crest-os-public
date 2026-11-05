import {it,expect,vi,afterEach} from 'vitest';
import {randomBytes} from 'node:crypto';
import {scheduling,SchedulingClientError} from '../../src/client/scheduling.ts';
import {syntheticBookingRequest} from '../fixtures/confirmed-booking.ts';
import {schedulingOriginalFixture} from '../fixtures/scheduling-original.ts';
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
afterEach(()=>vi.unstubAllGlobals());
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});}
it('sends a complete booking only to the fixed private route and verifies its acknowledged receipt',async()=>{
 const q=syntheticBookingRequest(),template=schedulingOriginalFixture('operations.job.book').envelope.result,receipt={...template,operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,receipt:{...template.receipt,businessId:q.businessId,jobId:q.jobId}},fetcher=vi.fn<typeof fetch>().mockResolvedValue(response(receipt));vi.stubGlobal('fetch',fetcher);expect(await scheduling.book(q,proof(),signal())).toEqual(receipt);const [url,request]=fetcher.mock.calls[0]!;expect(url).toBe('/api/business/scheduling/book');expect(JSON.parse(request!.body as string)).toEqual(Object.fromEntries(Object.entries(q).filter(([key])=>key!=='businessId')));expect(request!.cache).toBe('no-store');expect(request!.redirect).toBe('error');
});
it('distinguishes a lost save response from rejection before submission without an automatic retry',async()=>{
 const q=syntheticBookingRequest(),fetcher=vi.fn<typeof fetch>().mockRejectedValue(Error('private network failure'));vi.stubGlobal('fetch',fetcher);await expect(scheduling.book(q,proof(),signal())).rejects.toMatchObject({kind:'unknown'});expect(fetcher).toHaveBeenCalledTimes(1);fetcher.mockClear();await expect(scheduling.book(q,{...proof(),expiresAt:Date.now()-1},signal())).rejects.toMatchObject({kind:'not_submitted'});expect(fetcher).not.toHaveBeenCalled();
});
it('keeps recovery fencing and known stale conflicts distinct from a successful save',async()=>{
 const q=syntheticBookingRequest(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({error:'RECOVERY_REVIEW_REQUIRED'},409)).mockResolvedValueOnce(response({state:'conflict',reason:'mode'},409));vi.stubGlobal('fetch',fetcher);await expect(scheduling.book(q,proof(),signal())).rejects.toMatchObject({kind:'recovery'});expect(await scheduling.book(q,proof(),signal())).toEqual({state:'conflict',reason:'mode'});
});
it('rejects duplicate response keys and missing private cache control instead of announcing a save',async()=>{
 const q=syntheticBookingRequest(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"state":"conflict","state":"conflict","reason":"mode"}',{status:409,headers:{'content-type':'application/json','cache-control':'no-store'}})).mockResolvedValueOnce(new Response('{}',{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);await expect(scheduling.book(q,proof(),signal())).rejects.toBeInstanceOf(SchedulingClientError);await expect(scheduling.workspace(proof(),signal())).rejects.toBeInstanceOf(SchedulingClientError);
});
