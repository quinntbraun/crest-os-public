import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),rename:vi.fn(),settings:vi.fn(),lookup:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/business-name-command.ts',async original=>({...await original<typeof import('../../src/security/business-name-command.ts')>(),createBusinessNameCommand:()=>calls.rename}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.settings}));
vi.mock('../../src/security/business-operation-lookup.ts',()=>({createBusinessOperationLookup:()=>calls.lookup}));
import {createBusinessHttp} from '../../src/security/business-http';
import {BusinessNameCommandError} from '../../src/security/business-name-command';
import {transportFixture} from '../support/transport';
const origin='https://crest.example.com',businessId=randomUUID(),epoch=randomUUID(),operation=randomUUID(),opaque=randomBytes(32).toString('base64url');
const cookie=`__Host-crest_session=${opaque}`,config={origin,businessId,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'unused'};
const command=()=>({schemaVersion:1,operationId:operation,recoveryEpoch:epoch,expectedVersion:'9007199254740993',legalName:' Exact synthetic \u00e9 '});
const context=()=>({schemaVersion:1,businessId,legalName:'Synthetic name',businessVersion:'9007199254740993',writeState:'ready',recoveryEpoch:epoch});
const receipt=()=>({state:'committed',operationId:operation,recoveryEpoch:epoch,receipt:{schemaVersion:1,businessId,businessVersion:'9007199254740994',auditEventId:randomUUID()}});
const dispatch=()=>createBusinessHttp(config,{} as never,{} as never);
const request=(path='settings',body:unknown={},headers:Record<string,string>={},method='POST',signal?:AbortSignal)=>new Request(origin+'/api/business/'+path,{method,headers:{origin,'content-type':'application/json',cookie,...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
const projection=(value:object)=>({forServer:()=>value,toJSON:()=>{throw new Error('private projection');}});
beforeEach(()=>{vi.resetAllMocks();calls.admit.mockResolvedValue(true);calls.csrf.mockResolvedValue(randomUUID());calls.settings.mockResolvedValue(projection(context()));calls.rename.mockResolvedValue(projection(receipt()));calls.lookup.mockResolvedValue(projection({state:'absent'}));});
async function failure(response:Response,status=400,error='BUSINESS_REQUEST_FAILED'){
  expect(response.status).toBe(status);expect(await response.json()).toEqual({error});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('access-control-allow-origin')).toBe(false);
}
it('requires an explicit canonical trusted business UUID',()=>{expect(()=>createBusinessHttp({...config,businessId:'bad'},{} as never,{} as never)).toThrow('BUSINESS_HTTP_CONFIGURATION_REQUIRED');});
it('settings requires CSRF then durable ordinary admission before private typed work, with no implicit serialization',async()=>{
  const response=await dispatch()(request(),transportFixture());expect(await response.json()).toEqual(context());expect(response.headers.has('set-cookie')).toBe(false);
  expect(calls.csrf).toHaveBeenCalledWith(expect.any(Request),opaque,expect.any(AbortSignal));expect(calls.admit).toHaveBeenCalledWith(opaque,'ordinary',expect.any(AbortSignal));expect(calls.settings).toHaveBeenCalledWith(opaque,businessId,expect.any(AbortSignal));
  expect(calls.csrf.mock.invocationCallOrder[0]).toBeLessThan(calls.admit.mock.invocationCallOrder[0]!);expect(calls.admit.mock.invocationCallOrder[0]).toBeLessThan(calls.settings.mock.invocationCallOrder[0]!);
});
it('injects only the configured business and preserves every pinned typed rename value',async()=>{
  const input=command(),value=receipt();calls.rename.mockResolvedValue(projection(value));const response=await dispatch()(request('rename',input),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual(value);
  expect(calls.rename).toHaveBeenCalledWith(opaque,{...input,businessId},expect.any(AbortSignal));expect(calls.admit).toHaveBeenCalledTimes(1);
});
it('returns a stable non-authorizing edit binding only for the verified settings session',async()=>{
  const session=randomUUID();calls.csrf.mockResolvedValue(session);const run=dispatch(),first=await run(request(),transportFixture()),second=await run(request(),transportFixture());
  const expected=createHash('sha256').update('crest.business.edit.v1\0').update(businessId).update('\0').update(session).digest('base64url');
  expect(first.headers.get('x-crest-edit-binding')).toBe(expected);expect(second.headers.get('x-crest-edit-binding')).toBe(expected);expect(expected).not.toContain(session);expect(expected).not.toBe(createHash('sha256').update(opaque).digest('base64url'));
  calls.csrf.mockResolvedValue(randomUUID());expect((await run(request(),transportFixture())).headers.get('x-crest-edit-binding')).not.toBe(expected);
  expect((await run(request('operation',{operationId:operation}),transportFixture())).headers.has('x-crest-edit-binding')).toBe(false);
});
it('historical lookup returns committed original epoch or absence with no context read or replacement ID',async()=>{
  const run=dispatch();expect(await(await run(request('operation',{operationId:operation}),transportFixture())).json()).toEqual({state:'absent'});
  const value=receipt();calls.lookup.mockResolvedValue(projection(value));expect(await(await run(request('operation',{operationId:operation}),transportFixture())).json()).toEqual(value);
  expect(calls.lookup).toHaveBeenCalledWith(opaque,{businessId,operationId:operation},expect.any(AbortSignal));expect(calls.settings).not.toHaveBeenCalled();expect(calls.rename).not.toHaveBeenCalled();
});
it.each([{state:'conflict',reason:'operation'},{state:'conflict',reason:'version',currentVersion:'9007199254740994'}])('returns an explicit409 conflict without a second attempt',async value=>{
  calls.rename.mockResolvedValue(projection(value));const response=await dispatch()(request('rename',command()),transportFixture());expect(response.status).toBe(409);expect(await response.json()).toEqual(value);expect(calls.rename).toHaveBeenCalledTimes(1);
});
it.each(['missing','rename/','%72ename','settings?secret=value'])('rejects noncanonical path %s without database/provider work',async path=>{
  await failure(await dispatch()(request(path,command()),transportFixture()),404);expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();
});
it.each(['GET','PATCH','OPTIONS'])('allows POST only, never %s',async method=>{
  const response=await dispatch()(request('settings',{}, {},method),transportFixture());expect(response.headers.get('allow')).toBe('POST');await failure(response,405);expect(calls.csrf).not.toHaveBeenCalled();
});
it.each([{origin:'https://evil.example.com'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'},{cookie:''},{cookie:`${cookie}; ${cookie}`}])('rejects invalid request guards before proof/admission work',async headers=>{
  await failure(await dispatch()(request('settings',{},headers),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();
});
it.each([{...command(),businessId:randomUUID()},{...command(),actorId:randomUUID()},{...command(),legalName:{nested:'wrong'}},'[]','{"operationId":"a","operationId":"b"}', 'x'.repeat(8193)])('rejects wrong, nested, duplicated or excessive bodies before admission',async body=>{
  await failure(await dispatch()(request('rename',body),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.rename).not.toHaveBeenCalled();
});
it('rejects duplicate escaped keys even when the parsed key allowlist otherwise matches',async()=>{
  const body=JSON.stringify(command()).replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1');await failure(await dispatch()(request('rename',body),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();
});
it('invalid CSRF never consumes another session allowance or reaches typed work',async()=>{
  calls.csrf.mockRejectedValue(new Error('private proof detail'));await failure(await dispatch()(request(),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();expect(calls.settings).not.toHaveBeenCalled();
});
it('exhaustion returns a bounded429 hint and blocks all typed work',async()=>{
  calls.admit.mockResolvedValue(false);const response=await dispatch()(request(),transportFixture());expect(response.headers.get('retry-after')).toBe('60');await failure(response,429,'BUSINESS_REQUEST_LIMITED');expect(calls.settings).not.toHaveBeenCalled();
});
it('uncertain admission fails closed without retry or SDK work',async()=>{
  calls.admit.mockRejectedValue(new Error('private database detail'));await failure(await dispatch()(request(),transportFixture()),503);expect(calls.admit).toHaveBeenCalledTimes(1);expect(calls.settings).not.toHaveBeenCalled();
});
it.each([['BUSINESS_RENAME_INPUT_REQUIRED',400],['BUSINESS_RENAME_NOT_SUBMITTED',503],['BUSINESS_RENAME_DENIED',403],['RECOVERY_REVIEW_REQUIRED',409],['BUSINESS_RENAME_OUTCOME_UNKNOWN',503]] as const)('maps only fixed typed command error %s',async(code,status)=>{
  calls.rename.mockRejectedValue(new BusinessNameCommandError(code));await failure(await dispatch()(request('rename',command()),transportFixture()),status,code);expect(calls.rename).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();
});
it.each(['unexpected','projection','cancelled'])('preserves Outcome Unknown after possible submission on %s',async kind=>{
  const controller=new AbortController();calls.rename.mockImplementation(async()=>{if(kind==='unexpected')throw new Error('private SQL or SDK detail');if(kind==='cancelled'){controller.abort();return projection(receipt());}return {forServer(){throw new BusinessNameCommandError('BUSINESS_RENAME_RESULT_PRIVATE');}};});
  await failure(await dispatch()(request('rename',command(),{},'POST',controller.signal),transportFixture()),503,'BUSINESS_RENAME_OUTCOME_UNKNOWN');expect(calls.rename).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();
});
it('cannot use forged transport objects or unencrypted production sockets',async()=>{
  const run=dispatch();await failure(await run(request(),{} as never));await failure(await run(request(),transportFixture({encrypted:false})));expect(calls.csrf).not.toHaveBeenCalled();
});
it('cancellation before dispatch stops all database and provider work',async()=>{
  const controller=new AbortController();controller.abort();await failure(await dispatch()(request('settings',{}, {},'POST',controller.signal),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();
});
