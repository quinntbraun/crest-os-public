import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {originalOperations} from '../../src/client/original-operations';
import {originalOperationLookupToWire,originalOperationRetirementToWire} from '../../src/security/original-operation-http-contract';
import {retirementFixture,retiredOutcomeFixture} from '../support/original-operation-fixture.ts';
const fetcher=vi.fn(),input=retirementFixture(),signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const headers={'content-type':'application/json','cache-control':'private, no-store'};
const response=(value:unknown,status=200,patch:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...patch}});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async()=>response(retiredOutcomeFixture(input)));});
it('dispatches one exact private review with fresh proof and no generated replacement identity',async()=>{
 const current=proof();expect(await originalOperations.retire(input,current,signal())).toMatchObject({state:'retired',original:input.original,retirement:{reason:input.reason,recoveryEpoch:input.recoveryEpoch}});expect(fetcher).toHaveBeenCalledTimes(1);
 const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe('/api/business/original-operations/retire');expect(options).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':current.csrfToken}});expect(JSON.parse(options.body)).toEqual(originalOperationRetirementToWire(input));
});
it.each(['operation','epoch','reason','business','target','audit','timestamp'])('rejects a substituted %s retirement receipt as unknown',async issue=>{
 const value=retiredOutcomeFixture(input),original=structuredClone(value.original);value.original=original;
 if(issue==='operation')Object.assign(original.reference,{operationId:randomUUID()});if(issue==='epoch')value.retirement.recoveryEpoch=randomUUID();if(issue==='reason')value.retirement.reason='Changed review';if(issue==='business')Object.assign(original,{businessId:randomUUID()});if(issue==='target')Object.assign(original.reference,{customerId:randomUUID()});if(issue==='audit')Object.assign(value.retirement,{auditEventId:'invalid'});if(issue==='timestamp')value.retirement.recordedAt='yesterday';
 fetcher.mockResolvedValueOnce(response(value));await expect(originalOperations.retire(input,proof(),signal())).rejects.toMatchObject({kind:'unknown',message:'ORIGINAL_OPERATION_REQUEST_FAILED'});expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['conflict','original_recorded'])('retains %s as a nonterminal observation without another request',async state=>{
 const value=state==='conflict'?{state,reason:'operation'}:{schemaVersion:1,state,original:input.original};fetcher.mockResolvedValueOnce(response(value));expect(await originalOperations.retire(input,proof(),signal())).toEqual(value);expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([['ORIGINAL_OPERATION_NOT_SUBMITTED',503,'not_submitted'],['RECOVERY_REVIEW_REQUIRED',409,'recovery'],['ORIGINAL_OPERATION_REQUEST_LIMITED',429,'limited'],['ORIGINAL_OPERATION_OUTCOME_UNKNOWN',503,'unknown']] as const)('keeps fixed %s response semantics without retrying',async(error,status,kind)=>{
 fetcher.mockResolvedValueOnce(response({error},status));await expect(originalOperations.retire(input,proof(),signal())).rejects.toMatchObject({kind});expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['input','expired proof','invalid proof','already aborted'])('rejects %s before any fetch',async issue=>{
 const controller=new AbortController(),current=proof();let request:unknown=input;
 if(issue==='input')request={...input,draft:'Forbidden'};if(issue==='expired proof')current.expiresAt=Date.now()-1;if(issue==='invalid proof')current.csrfToken='invalid';if(issue==='already aborted')controller.abort();
 await expect(originalOperations.retire(request,current,controller.signal)).rejects.toMatchObject({kind:issue==='input'?'input':'not_submitted'});expect(fetcher).not.toHaveBeenCalled();
});
it('pins original and review before asynchronous transport can modify caller data',async()=>{
 const request=structuredClone(input),expected=structuredClone(input);fetcher.mockImplementationOnce(async()=>{Object.assign(request,{reason:'Changed'});Object.assign(request.original.reference,{operationId:randomUUID()});return response(retiredOutcomeFixture(expected));});
 expect(await originalOperations.retire(request,proof(),signal())).toMatchObject({original:expected.original,retirement:{reason:expected.reason}});expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(originalOperationRetirementToWire(expected));
});
it.each(['network loss','wrong content type','cacheable reply','oversized reply','duplicate root','duplicate reference','invalid UTF-8','BOM','wrong status','absent retirement','extra conflict'])('retains an uncertain retirement after %s',async issue=>{
 const value=retiredOutcomeFixture(input),body=JSON.stringify(value);let r=response(value);
 if(issue==='wrong content type')r=response(value,200,{'content-type':'text/plain'});if(issue==='cacheable reply')r=response(value,200,{'cache-control':'public, max-age=3600'});
 if(issue==='oversized reply')r=new Response(' '.repeat(16385)+body,{headers});if(issue==='duplicate root')r=new Response(body.replace('{','{"schemaVersion":1,'),{headers});if(issue==='duplicate reference')r=new Response(body.replace('"reference":{','"reference":{"operationId":"'+input.original.reference.operationId+'",'),{headers});
 if(issue==='invalid UTF-8')r=new Response(new Uint8Array([123,34,255,34,125]),{headers});if(issue==='BOM')r=new Response('\ufeff'+body,{headers});if(issue==='wrong status')r=response(value,201);if(issue==='absent retirement')r=response({state:'absent'});if(issue==='extra conflict')r=response({state:'conflict',reason:'operation',private:'Forbidden'});
 if(issue==='network loss')fetcher.mockRejectedValueOnce(new Error('Private transport detail'));else fetcher.mockResolvedValueOnce(r);
 const error=await originalOperations.retire(input,proof(),signal()).catch(e=>e);expect(error).toMatchObject({kind:'unknown',message:'ORIGINAL_OPERATION_REQUEST_FAILED'});expect(error).not.toHaveProperty('cause');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('aborts a stalled response stream, cancels reading and preserves the uncertain retirement',async()=>{
 const controller=new AbortController();let cancelled=false;
 fetcher.mockResolvedValueOnce(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers}));
 const pending=originalOperations.retire(input,proof(),controller.signal);await Promise.resolve();controller.abort();await expect(pending).rejects.toMatchObject({kind:'unknown'});expect(cancelled).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['absent','conflict','original_recorded','retired'])('looks up %s only for the exact original and never dispatches a retirement',async state=>{
 const value=state==='retired'?retiredOutcomeFixture(input):state==='original_recorded'?{schemaVersion:1,state,original:input.original}:state==='conflict'?{state,reason:'operation'}:{state};fetcher.mockResolvedValueOnce(response(value));
 expect(await originalOperations.lookup(input.original,proof(),signal())).toEqual(value);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![0]).toBe('/api/business/original-operations/resolution');expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(originalOperationLookupToWire(input.original));
});
it('retains historical retirement authority and reason without rebasing to the current review',async()=>{
 const value=retiredOutcomeFixture(input);value.retirement.recoveryEpoch=randomUUID();value.retirement.reason='Historical review';fetcher.mockResolvedValueOnce(response(value));expect(await originalOperations.lookup(input.original,proof(),signal())).toEqual(value);
});
it.each(['foreign original','lookup failure','malformed conflict','mismatched error status'])('rejects %s lookup evidence without another request',async issue=>{
 let value:unknown={state:'absent'},status=200;
 if(issue==='foreign original')value=retiredOutcomeFixture(retirementFixture());if(issue==='lookup failure'){value={error:'ORIGINAL_OPERATION_READ_FAILED'};status=503;}if(issue==='malformed conflict')value={state:'conflict',reason:'operation',details:'Private'};if(issue==='mismatched error status'){value={error:'ORIGINAL_OPERATION_NOT_SUBMITTED'};status=200;}
 fetcher.mockResolvedValueOnce(response(value,status));await expect(originalOperations.lookup(input.original,proof(),signal())).rejects.toMatchObject({kind:'unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);
});
