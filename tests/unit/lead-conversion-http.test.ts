import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),convert:vi.fn(),lookup:vi.fn(),read:vi.fn(),links:vi.fn(),factory:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>({})}));
vi.mock('../../src/customer/lead-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-directory.ts')>(),createLeadDirectory:()=>({})}));
vi.mock('../../src/customer/lead-state-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-state-directory.ts')>(),createLeadStateDirectory:()=>({})}));
vi.mock('../../src/customer/lead-vehicle-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-vehicle-directory.ts')>(),createLeadVehicleDirectory:()=>({})}));
vi.mock('../../src/customer/lead-address-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-address-directory.ts')>(),createLeadAddressDirectory:()=>({})}));
vi.mock('../../src/customer/lead-conversion-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-conversion-directory.ts')>(),createLeadConversionDirectory:()=>{calls.factory();return calls;}}));
import {createLeadHttp} from '../../src/customer/lead-http';
import {LeadConversionDirectoryError} from '../../src/customer/lead-conversion-directory';
import {leadConversionToWire} from '../../src/customer/lead-conversion-command-contract';
import {conversionRecordFixture,conversionLinkFixture,conversionBusiness as business} from '../support/lead-conversion-record-fixture';
import {transportFixture} from '../support/transport';
const origin='https://crest.example.com',opaque=randomBytes(32).toString('base64url'),cookie='__Host-crest_session='+opaque;
const config={origin,businessId:business,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'mock'};
const parent=()=>conversionRecordFixture(),wire=()=>leadConversionToWire(parent().request),dispatch=(enabled=true)=>createLeadHttp(config,{} as never,{} as never,enabled);
const request=(route='convert',body:unknown=wire(),patch:Record<string,string>={},method='POST')=>new Request(origin+'/api/business/leads/'+route,{method,headers:{origin,'content-type':'application/json',cookie,...patch},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const privateValue=(v:object)=>({forServer:()=>v,toJSON:()=>{throw new Error('private');}});
beforeEach(()=>{vi.resetAllMocks();calls.events.length=0;calls.csrf.mockImplementation(async()=>{calls.events.push('csrf');return randomUUID();});calls.admit.mockImplementation(async()=>{calls.events.push('admit');return true;});calls.convert.mockImplementation(async()=>{calls.events.push('convert');return privateValue({state:'conflict',reason:'source'});});for(const fn of [calls.lookup,calls.read,calls.links])fn.mockResolvedValue(privateValue({state:'absent'}));});
async function failure(r:Response,status:number,error='LEAD_REQUEST_FAILED'){expect(r.status).toBe(status);expect(await r.json()).toEqual({error});expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");expect(r.headers.has('set-cookie')).toBe(false);expect(r.headers.has('access-control-allow-origin')).toBe(false);}
it.each([['convert',()=>wire()],['conversion-operation',()=>({operationId:parent().operation_id})],['conversion',()=>({leadId:parent().lead_id})],['conversion-links',()=>({leadId:parent().lead_id,conversionId:parent().id,afterId:null,pageSize:50})]] as const)('keeps %s closed without explicit conversion composition',async(route,body)=>{await failure(await dispatch(false)(request(route,body()),transportFixture()),404);expect(calls.factory).not.toHaveBeenCalled();expect(calls.csrf).not.toHaveBeenCalled();});
it('uses configured business authority, CSRF and shared admission before one fixed conversion',async()=>{
 const r=await dispatch()(request(),transportFixture());expect(r.status).toBe(409);expect(await r.json()).toEqual({state:'conflict',reason:'source'});expect(calls.events).toEqual(['csrf','admit','convert']);expect(calls.convert.mock.calls[0]![0]).toBe(opaque);expect(calls.convert.mock.calls[0]![1]).toEqual(parent().request);expect(calls.convert).toHaveBeenCalledTimes(1);
});
it.each(['business','outcome','nestedDuplicate','outerDuplicate','oversize','selectionObject'])('rejects %s body before admission or mutation',async which=>{
 let body:unknown=wire();if(which==='business')body={...wire(),businessId:randomUUID()};if(which==='outcome')body={...wire(),state:'won'};if(which==='nestedDuplicate')body={...wire(),selectionsJson:wire().selectionsJson.replace('"customer":','"customer":null,"customer":')};if(which==='outerDuplicate')body=JSON.stringify(wire()).replace('"leadId":','"leadId":"'+parent().lead_id+'","leadId":');if(which==='oversize')body={...wire(),selectionsJson:'x'.repeat(131073)};if(which==='selectionObject')body={...wire(),selectionsJson:JSON.parse(wire().selectionsJson)};
 await failure(await dispatch()(request('convert',body),transportFixture()),400);expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();expect(calls.convert).not.toHaveBeenCalled();
});
it('denies foreign origins, missing cookies and CSRF without converting or incrementing domain work',async()=>{
 await failure(await dispatch()(request('convert',wire(),{origin:'https://foreign.example.com'}),transportFixture()),400);await failure(await dispatch()(request('convert',wire(),{cookie:''}),transportFixture()),400);calls.csrf.mockRejectedValueOnce(new Error('private CSRF detail'));await failure(await dispatch()(request(),transportFixture()),400);expect(calls.admit).not.toHaveBeenCalled();expect(calls.convert).not.toHaveBeenCalled();
});
it('retains durable ordinary rate limits without dispatch or retries',async()=>{
 calls.admit.mockResolvedValue(false);const r=await dispatch()(request(),transportFixture());await failure(r,429,'LEAD_REQUEST_LIMITED');expect(r.headers.get('retry-after')).toBe('60');expect(calls.convert).not.toHaveBeenCalled();
});
it.each([['LEAD_CONVERSION_NOT_SUBMITTED',503],['LEAD_CONVERSION_DENIED',403],['RECOVERY_REVIEW_REQUIRED',409],['LEAD_CONVERSION_OUTCOME_UNKNOWN',503]] as const)('returns fixed %s semantics and no raw cause',async(code,status)=>{
 calls.convert.mockRejectedValue(new LeadConversionDirectoryError(code));await failure(await dispatch()(request(),transportFixture()),status,code);expect(calls.convert).toHaveBeenCalledTimes(1);
});
it('treats a raw post-dispatch exception as unknown and sends no replacement',async()=>{calls.convert.mockRejectedValue(new Error('private SQL/customer details'));await failure(await dispatch()(request(),transportFixture()),503,'LEAD_CONVERSION_OUTCOME_UNKNOWN');expect(calls.convert).toHaveBeenCalledTimes(1);});
it('routes original receipt, retained source and manually paged links without reusing conversion authority',async()=>{
 const d=dispatch(),rows=[['conversion-operation',{operationId:parent().operation_id},calls.lookup],['conversion',{leadId:parent().lead_id},calls.read],['conversion-links',{leadId:parent().lead_id,conversionId:parent().id,afterId:null,pageSize:50},calls.links]] as const;
 for(const [route,body,fn]of rows){const r=await d(request(route,body),transportFixture());expect(r.status).toBe(200);expect(await r.json()).toEqual({state:'absent'});expect(fn.mock.calls[0]![1]).toEqual({...body,businessId:business});}expect(calls.convert).not.toHaveBeenCalled();expect(calls.admit).toHaveBeenCalledTimes(3);
});
it('projects found directory models into the exact source and mapping wire schemas',async()=>{
 const source={schemaVersion:1,businessId:business,conversion:parent()},page={...source,links:[conversionLinkFixture(),conversionLinkFixture('address')],hasMore:false};
 calls.read.mockResolvedValue(privateValue({state:'found',...source}));calls.links.mockResolvedValue(privateValue({state:'found',...page}));const d=dispatch();
 expect(await (await d(request('conversion',{leadId:parent().lead_id}),transportFixture())).json()).toEqual(source);
 expect(await (await d(request('conversion-links',{leadId:parent().lead_id,conversionId:parent().id,afterId:null,pageSize:50}),transportFixture())).json()).toEqual(page);
});
