import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),retire:vi.fn(),lookup:vi.fn(),factory:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/original-operation-directory.ts',async original=>({...await original<typeof import('../../src/security/original-operation-directory.ts')>(),createOriginalOperationDirectory:()=>{calls.factory();return calls;}}));
import {createOriginalOperationHttp} from '../../src/security/original-operation-http.ts';
import {OriginalOperationDirectoryError} from '../../src/security/original-operation-directory.ts';
import {originalOperationLookupToWire,originalOperationRetirementToWire} from '../../src/security/original-operation-http-contract.ts';
import {retirementFixture,retiredOutcomeFixture} from '../support/original-operation-fixture.ts';
import {transportFixture} from '../support/transport.ts';

const intent=retirementFixture(),origin='https://crest.example.com',opaque=randomBytes(32).toString('base64url'),cookie='__Host-crest_session='+opaque;
const config={origin,businessId:intent.original.businessId,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'mock'};
const dispatch=(enabled=true)=>createOriginalOperationHttp(config,{} as never,{} as never,enabled);
const request=(route='retire',body:unknown=originalOperationRetirementToWire(intent),headers:Record<string,string>={},method='POST')=>new Request(origin+'/api/business/original-operations/'+route,{method,headers:{origin,'content-type':'application/json',cookie,...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const privateValue=(value:object)=>({forServer:()=>value,toJSON:()=>{throw new Error('private');}});
beforeEach(()=>{
 vi.resetAllMocks();calls.events.length=0;
 calls.csrf.mockImplementation(async()=>{calls.events.push('csrf');return randomUUID();});calls.admit.mockImplementation(async()=>{calls.events.push('admit');return true;});
 calls.retire.mockImplementation(async()=>{calls.events.push('retire');return privateValue(retiredOutcomeFixture(intent));});calls.lookup.mockImplementation(async()=>{calls.events.push('lookup');return privateValue({state:'absent'});});
});
async function failure(response:Response,status:number,error='ORIGINAL_OPERATION_REQUEST_FAILED'){
 expect(response.status).toBe(status);expect(await response.json()).toEqual({error});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('cdn-cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();
}
it('keeps both paths closed without explicit trusted opt-in or any directory work',async()=>{
 const handler=createOriginalOperationHttp(config,{} as never,{} as never);await failure(await handler(request(),transportFixture()),404);await failure(await handler(request('resolution',originalOperationLookupToWire(intent.original)),transportFixture()),404);expect(calls.factory).not.toHaveBeenCalled();expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();
});
it('passes the pinned original and separate review epoch only after origin, CSRF and committed admission',async()=>{
 const response=await dispatch()(request(),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'retired',original:intent.original,retirement:{reason:intent.reason,recoveryEpoch:intent.recoveryEpoch}});
 expect(calls.events).toEqual(['csrf','admit','retire']);expect(calls.retire).toHaveBeenCalledTimes(1);expect(calls.retire.mock.calls[0]![1]).toEqual(intent);expect(calls.admit.mock.calls[0]![1]).toBe('ordinary');expect(response.headers.get('cache-control')).toContain('no-store');
});
it.each(['absent','conflict','original_recorded','retired'])('returns only a fresh %s resolution observation without retirement dispatch',async state=>{
 const value=state==='retired'?retiredOutcomeFixture(intent):state==='original_recorded'?{schemaVersion:1,state,original:intent.original}:state==='conflict'?{state,reason:'operation'}:{state};calls.lookup.mockImplementationOnce(async()=>{calls.events.push('lookup');return privateValue(value);});
 const response=await dispatch()(request('resolution',originalOperationLookupToWire(intent.original)),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual(value);expect(calls.events).toEqual(['csrf','admit','lookup']);expect(calls.lookup.mock.calls[0]![1]).toEqual(intent.original);expect(calls.retire).not.toHaveBeenCalled();
});
it.each(['unknown','retire/','retire?query=1','retire#fragment','../settings'])('rejects unknown or altered path %s before authority work',async route=>{
 await failure(await dispatch()(request(route),transportFixture()),404);expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();expect(calls.retire).not.toHaveBeenCalled();
});
it('requires POST with the normal private failure headers',async()=>{const response=await dispatch()(request('retire',undefined,{},'GET'),transportFixture());expect(response.headers.get('allow')).toBe('POST');await failure(response,405);expect(calls.csrf).not.toHaveBeenCalled();});
it.each(['origin','cookie','content type','cross site','CSRF'])('rejects invalid %s before admission and commands',async issue=>{
 const headers:Record<string,string>={};if(issue==='origin')headers.origin='https://foreign.example.com';if(issue==='cookie')headers.cookie='';if(issue==='content type')headers['content-type']='text/plain';if(issue==='cross site')headers['sec-fetch-site']='cross-site';if(issue==='CSRF')calls.csrf.mockRejectedValueOnce(new Error('Private proof detail'));
 await failure(await dispatch()(request('retire',originalOperationRetirementToWire(intent),headers),transportFixture()),400);expect(calls.admit).not.toHaveBeenCalled();expect(calls.retire).not.toHaveBeenCalled();
});
it.each(['foreign business','extra actor','draft','duplicate outer','duplicate inner','malformed UTF-8','oversized stream','content encoding'])('rejects %s input before CSRF/admission',async issue=>{
 const wire=originalOperationRetirementToWire(intent);let body:unknown=wire,req:Request;
 if(issue==='foreign business')body={...wire,originalJson:wire.originalJson.replace(intent.original.businessId,randomUUID())};if(issue==='extra actor')body={...wire,actorId:randomUUID()};if(issue==='draft')body={...wire,draft:'Private'};
 if(issue==='duplicate outer')body=JSON.stringify(wire).replace('{','{"schemaVersion":1,');if(issue==='duplicate inner')body={...wire,originalJson:wire.originalJson.replace('{','{"schemaVersion":1,')};if(issue==='oversized stream')body=' '.repeat(16385);
 req=request('retire',body,issue==='content encoding'?{'content-encoding':'gzip'}:{});
 if(issue==='malformed UTF-8')req=new Request(req.url,{method:'POST',headers:req.headers,body:new Uint8Array([123,34,255,34,125])});
 await failure(await dispatch()(req,transportFixture()),400);expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();expect(calls.retire).not.toHaveBeenCalled();
});
it('retains the ordinary admission limit without refund, delay or retry',async()=>{
 calls.admit.mockResolvedValueOnce(false);const response=await dispatch()(request(),transportFixture());expect(response.headers.get('retry-after')).toBe('60');await failure(response,429,'ORIGINAL_OPERATION_REQUEST_LIMITED');expect(calls.admit).toHaveBeenCalledTimes(1);expect(calls.retire).not.toHaveBeenCalled();
});
it.each([['ORIGINAL_OPERATION_NOT_SUBMITTED',503],['ORIGINAL_OPERATION_OUTCOME_UNKNOWN',503],['RECOVERY_REVIEW_REQUIRED',409]] as const)('retains fixed %s semantics without exposing a database cause',async(code,status)=>{
 calls.retire.mockRejectedValueOnce(new OriginalOperationDirectoryError(code));await failure(await dispatch()(request(),transportFixture()),status,code);expect(calls.retire).toHaveBeenCalledTimes(1);
});
it('sanitizes arbitrary post-dispatch failures as unknown and does not retry',async()=>{calls.retire.mockRejectedValueOnce(new Error('Private SQL/credential details'));await failure(await dispatch()(request(),transportFixture()),503,'ORIGINAL_OPERATION_OUTCOME_UNKNOWN');expect(calls.retire).toHaveBeenCalledTimes(1);});
it('sanitizes a lookup failure while leaving the original request unmodified',async()=>{calls.lookup.mockRejectedValueOnce(new OriginalOperationDirectoryError('ORIGINAL_OPERATION_READ_FAILED'));await failure(await dispatch()(request('resolution',originalOperationLookupToWire(intent.original)),transportFixture()),503,'ORIGINAL_OPERATION_READ_FAILED');expect(calls.lookup.mock.calls[0]![1]).toEqual(intent.original);expect(calls.retire).not.toHaveBeenCalled();});
it.each(['before request','during admission','after dispatch'])('handles an abort %s without a replacement request',async stage=>{
 const controller=new AbortController(),req=new Request(request(),{signal:controller.signal});
 if(stage==='before request')controller.abort();if(stage==='during admission')calls.admit.mockImplementationOnce(async()=>{controller.abort();return true;});if(stage==='after dispatch')calls.retire.mockImplementationOnce(async()=>{controller.abort();return privateValue(retiredOutcomeFixture(intent));});
 await failure(await dispatch()(req,transportFixture()),stage==='before request'?400:503,stage==='after dispatch'?'ORIGINAL_OPERATION_OUTCOME_UNKNOWN':'ORIGINAL_OPERATION_REQUEST_FAILED');expect(calls.retire).toHaveBeenCalledTimes(stage==='after dispatch'?1:0);
});
