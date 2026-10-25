import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),save:vi.fn(),list:vi.fn(),history:vi.fn(),lookup:vi.fn(),context:vi.fn(),change:vi.fn(),stateLookup:vi.fn(),events:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/customer/lead-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-directory.ts')>(),createLeadDirectory:()=>calls}));
vi.mock('../../src/customer/lead-state-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-state-directory.ts')>(),createLeadStateDirectory:()=>({change:calls.change,lookup:calls.stateLookup,events:calls.events})}));
vi.mock('../../src/customer/lead-vehicle-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-vehicle-directory.ts')>(),createLeadVehicleDirectory:()=>({})}));
import {LeadStateDirectoryError} from '../../src/customer/lead-state-directory.ts';
vi.mock('../../src/customer/lead-address-directory.ts',()=>({createLeadAddressDirectory:()=>({}),LeadAddressDirectoryError:class extends Error{}}));
import {createLeadHttp} from '../../src/customer/lead-http.ts';
import {LeadDirectoryError} from '../../src/customer/lead-directory.ts';
import {draftFromLead} from '../../src/customer/lead-contract.ts';
import {leadFixture} from '../support/lead-fixture.ts';
import {leadBusiness} from '../support/lead-fixture.ts';
import {transportFixture} from '../support/transport';
const origin='https://crest.example.com',opaque=randomBytes(32).toString('base64url'),cookie=`__Host-crest_session=${opaque}`,epoch=randomUUID(),operation=randomUUID(),row=leadFixture();
const config={origin,businessId:leadBusiness,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'unused'};
const dispatch=()=>createLeadHttp(config,{} as never,{} as never);
const projection=(value:object)=>({forServer:()=>value,toJSON:()=>{throw new Error('private');}});
const save=()=>({schemaVersion:1,operationId:operation,leadId:row.id,recoveryEpoch:epoch,expectedVersion:'0',...draftFromLead(row)});
const receipt=()=>({state:'committed',operationId:operation,recoveryEpoch:epoch,receipt:{schemaVersion:1,businessId:leadBusiness,leadId:row.id,leadVersion:'1',auditEventId:randomUUID()}});
const listing=()=>({schemaVersion:1,businessId:leadBusiness,leads:[row],hasMore:false});
const request=(path='context',body:unknown={},headers:Record<string,string>={},method='POST',signal?:AbortSignal)=>new Request(origin+'/api/business/leads/'+path,{method,headers:{origin,'content-type':'application/json',cookie,...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
beforeEach(()=>{vi.resetAllMocks();calls.change.mockResolvedValue(projection({state:"conflict",reason:"state"}));calls.stateLookup.mockResolvedValue(projection({state:"absent"}));calls.events.mockResolvedValue(projection({state:"absent"}));calls.csrf.mockResolvedValue(randomUUID());calls.admit.mockResolvedValue(true);calls.save.mockResolvedValue(projection(receipt()));calls.list.mockResolvedValue(projection(listing()));calls.lookup.mockResolvedValue(projection({state:'absent'}));calls.history.mockResolvedValue(projection({state:'absent'}));calls.context.mockResolvedValue(projection({schemaVersion:1,businessId:leadBusiness,writeState:'ready',recoveryEpoch:epoch,legalName:'Private unneeded field'}));});
async function failure(response:Response,status=400,error='LEAD_REQUEST_FAILED'){
  expect(response.status).toBe(status);expect(await response.json()).toEqual({error});expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('access-control-allow-origin')).toBe(false);
}
it('requires a canonical configured business',()=>expect(()=>createLeadHttp({...config,businessId:'browser supplied'},{} as never,{} as never)).toThrow('LEAD_HTTP_CONFIGURATION_REQUIRED'));
it('preserves complete multibyte intake above the ordinary8KiB request cap',async()=>{
 const input={...save(),notes:'😀'.repeat(4000),availability:'é'.repeat(4000),requestedScope:'\n'.repeat(4000)};
 expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(8192);
 const response=await dispatch()(request('save',input),transportFixture());expect(response.status).toBe(200);expect(calls.save.mock.calls[0]![1].draft).toMatchObject({notes:input.notes,availability:input.availability,requestedScope:input.requestedScope});
});
it.each([{...save(),state:'won'},{...save(),lostReason:'invented'},{...save(),sourceSnapshot:'invented'},{...save(),quoteSendId:randomUUID()}])('intake cannot supply lifecycle or source-snapshot authority: %o',async input=>{await failure(await dispatch()(request('save',input),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();expect(calls.save).not.toHaveBeenCalled();});
it('context checks crm read and current authority after committed admission, returning a session-bound advisory edit marker',async()=>{
 const session=randomUUID();calls.csrf.mockResolvedValue(session);const response=await dispatch()(request(),transportFixture());
 expect(await response.json()).toEqual({schemaVersion:1,businessId:leadBusiness,writeState:'ready',recoveryEpoch:epoch});expect(calls.list).toHaveBeenCalledWith(opaque,{businessId:leadBusiness,search:'',afterId:null,includeLost:false,pageSize:1},expect.any(AbortSignal));
 expect(calls.csrf.mock.invocationCallOrder[0]).toBeLessThan(calls.admit.mock.invocationCallOrder[0]!);expect(calls.admit.mock.invocationCallOrder[0]).toBeLessThan(calls.list.mock.invocationCallOrder[0]!);expect(calls.list.mock.invocationCallOrder[0]).toBeLessThan(calls.context.mock.invocationCallOrder[0]!);
 const marker=createHash('sha256').update('crest.lead.edit.v1\0').update(leadBusiness).update('\0').update(session).digest('base64url');expect(response.headers.get('x-crest-edit-binding')).toBe(marker);expect(marker).not.toBe(createHash('sha256').update(opaque).digest('base64url'));
});
it('paused context keeps null epoch and never substitutes authority',async()=>{calls.context.mockResolvedValue(projection({schemaVersion:1,businessId:leadBusiness,writeState:'paused',recoveryEpoch:null}));expect(await(await dispatch()(request(),transportFixture())).json()).toEqual({schemaVersion:1,businessId:leadBusiness,writeState:'paused',recoveryEpoch:null});});
it('flat save injects only the configured business and preserves stable IDs, raw values and exact version',async()=>{
 const value=receipt(),input={...save(),expectedVersion:'9007199254740993',phone:' Raw phone é /001 ',estimatedCents:'9007199254740993',notes:'\\N\n=private é 😀',followUpAt:'2026-10-25T10:00:00.123456Z'};calls.save.mockResolvedValue(projection(value));const response=await dispatch()(request('save',input),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual(value);
 const {schemaVersion,operationId,leadId,recoveryEpoch,expectedVersion,...draft}=input;expect(calls.save).toHaveBeenCalledWith(opaque,{schemaVersion,businessId:leadBusiness,operationId,leadId,recoveryEpoch,expectedVersion,draft},expect.any(AbortSignal));expect(calls.save).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();expect(calls.context).not.toHaveBeenCalled();
});
it.each([{state:'conflict',reason:'operation'},{state:'conflict',reason:'lead'},{state:'conflict',reason:'version',currentVersion:'9007199254740994'}])('conflicts remain409 without retry or replacement: %o',async value=>{calls.save.mockResolvedValue(projection(value));const response=await dispatch()(request('save',save()),transportFixture());expect(response.status).toBe(409);expect(await response.json()).toEqual(value);expect(calls.save).toHaveBeenCalledTimes(1);});
it('directory preserves the exact page cursor/archive intent and safely JSON-encodes source text',async()=>{
 const value=listing();value.leads=[leadFixture({label:'<script>private</script>'})];calls.list.mockResolvedValue(projection(value));const input={search:'%_literal',afterId:row.id,includeLost:true,pageSize:50},response=await dispatch()(request('list',input),transportFixture());expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');expect(await response.json()).toEqual(value);expect(calls.list).toHaveBeenCalledWith(opaque,{businessId:leadBusiness,...input},expect.any(AbortSignal));expect(response.headers.has('x-crest-edit-binding')).toBe(false);
});
it('historical operation lookup and source history never call save or current context',async()=>{
 const run=dispatch(),value=receipt();calls.lookup.mockResolvedValue(projection(value));expect(await(await run(request('operation',{operationId:operation}),transportFixture())).json()).toEqual(value);
 const input={leadId:row.id,afterVersion:'9007199254740993',pageSize:20};expect(await(await run(request('history',input),transportFixture())).json()).toEqual({state:'absent'});expect(calls.history).toHaveBeenCalledWith(opaque,{businessId:leadBusiness,...input},expect.any(AbortSignal));expect(calls.save).not.toHaveBeenCalled();expect(calls.context).not.toHaveBeenCalled();
});
it.each(['missing','context/','%63ontext','context?query=private','toString','__proto__'])('rejects noncanonical route %s before IO',async path=>{await failure(await dispatch()(request(path),transportFixture()),404);expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();});
it.each(['GET','PATCH','OPTIONS'])('requires POST, never%s',async method=>{const response=await dispatch()(request('context',{}, {},method),transportFixture());expect(response.headers.get('allow')).toBe('POST');await failure(response,405);expect(calls.csrf).not.toHaveBeenCalled();});
it.each([{origin:'https://evil.example.com'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'},{cookie:''},{cookie:`${cookie}; ${cookie}`}])('rejects request protection failures before authorization: %o',async headers=>{await failure(await dispatch()(request('save',save(),headers),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.admit).not.toHaveBeenCalled();});
it.each([{...save(),businessId:randomUUID()},{...save(),actorId:randomUUID()},{...save(),phone:{nested:'bad'}},{...save(),expectedVersion:1},{...save(),estimatedCents:1.5},{...save(),label:'line\nbreak'},'[]','x'.repeat(131073)])('rejects malformed or authority-bearing save before admission: %o',async input=>{await failure(await dispatch()(request('save',input),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.save).not.toHaveBeenCalled();});
it('rejects escaped duplicate flat keys before CSRF/admission',async()=>{const raw=JSON.stringify(save()).replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1');await failure(await dispatch()(request('save',raw),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();});
it.each([['list',{search:'',afterId:null,includeLost:false,pageSize:51}],['history',{leadId:row.id,afterVersion:'0',pageSize:21}],['operation',{operationId:'not UUID'}]] as const)('rejects invalid%s arguments before admission',async(route,input)=>{await failure(await dispatch()(request(route,input),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();});
it('CSRF failure never consumes allowance or reaches vehicle work',async()=>{calls.csrf.mockRejectedValue(new Error('private detail'));await failure(await dispatch()(request(),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();expect(calls.list).not.toHaveBeenCalled();});
it('limited or uncertain admission stops all domain work without a retry',async()=>{calls.admit.mockResolvedValue(false);let response=await dispatch()(request('save',save()),transportFixture());expect(response.headers.get('retry-after')).toBe('60');await failure(response,429,'LEAD_REQUEST_LIMITED');calls.admit.mockRejectedValue(new Error('private SQL'));response=await dispatch()(request('save',save()),transportFixture());await failure(response,503);expect(calls.save).not.toHaveBeenCalled();});
it.each([['LEAD_SAVE_NOT_SUBMITTED',503],['LEAD_SAVE_DENIED',403],['RECOVERY_REVIEW_REQUIRED',409],['LEAD_SAVE_OUTCOME_UNKNOWN',503]] as const)('maps only fixed save error%s',async(code,status)=>{calls.save.mockRejectedValue(new LeadDirectoryError(code));await failure(await dispatch()(request('save',save()),transportFixture()),status,code);expect(calls.save).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();});
it.each(['unexpected','projection','cancelled'])('possible submitted save stays unknown after%s',async mode=>{const controller=new AbortController();calls.save.mockImplementation(async()=>{if(mode==='unexpected')throw new Error('private SQL detail');if(mode==='projection')return {forServer(){throw new Error('private projection');}};controller.abort();return projection(receipt());});await failure(await dispatch()(request('save',save(),{},'POST',controller.signal),transportFixture()),503,'LEAD_SAVE_OUTCOME_UNKNOWN');expect(calls.save).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();});
it('denies forged or unencrypted production transport and pre-dispatch cancellation',async()=>{const run=dispatch();await failure(await run(request(),{} as never));await failure(await run(request(),transportFixture({encrypted:false})));const controller=new AbortController();controller.abort();await failure(await run(request('context',{}, {},'POST',controller.signal),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();});

const stateChange=()=>({schemaVersion:1,operationId:operation,leadId:row.id,recoveryEpoch:epoch,expectedVersion:'1',fromState:'new',toState:'lost',reason:' Original reason é 😀\n retained '});
it('status writes pin configured scope and exact original intent after ordinary CSRF/admission',async()=>{
 const input=stateChange(),response=await dispatch()(request('state',input),transportFixture());expect(response.status).toBe(409);expect(await response.json()).toEqual({state:'conflict',reason:'state'});
 expect(calls.change.mock.calls[0]![1]).toEqual({schemaVersion:1,businessId:leadBusiness,operationId:operation,leadId:row.id,recoveryEpoch:epoch,expectedVersion:'1',draft:{fromState:'new',toState:'lost',reason:input.reason}});
 expect(calls.save).not.toHaveBeenCalled();expect(calls.admit).toHaveBeenCalledWith(opaque,'ordinary',expect.any(AbortSignal));
});
it.each([{toState:'won'},{toState:'quote_sent'},{fromState:'lost',toState:'lost'},{reason:null},{expectedVersion:'0'},{businessId:randomUUID()},{followUpAt:null},{acceptanceId:randomUUID()}])('rejects invalid or fabricated status authority before session/database work %#',async patch=>{
 await failure(await dispatch()(request('state',{...stateChange(),...patch}),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.change).not.toHaveBeenCalled();
});
it.each([['LEAD_STATE_NOT_SUBMITTED',503],['LEAD_STATE_DENIED',403],['RECOVERY_REVIEW_REQUIRED',409],['LEAD_STATE_OUTCOME_UNKNOWN',503]] as const)('status preserves %s outcome',async(code,status)=>{
 calls.change.mockRejectedValue(new LeadStateDirectoryError(code));await failure(await dispatch()(request('state',stateChange()),transportFixture()),status,code);
});
it('status uncertain transport never becomes a replacement intake save',async()=>{
 calls.change.mockRejectedValue(new Error('private unavailable detail'));await failure(await dispatch()(request('state',stateChange()),transportFixture()),503,'LEAD_STATE_OUTCOME_UNKNOWN');expect(calls.change).toHaveBeenCalledTimes(1);expect(calls.save).not.toHaveBeenCalled();
});
it('status receipt lookup and event page are separately scoped fresh reads',async()=>{
 const handler=dispatch();expect((await handler(request('state-operation',{operationId:operation}),transportFixture())).status).toBe(200);expect(calls.stateLookup.mock.calls[0]![1]).toEqual({businessId:leadBusiness,operationId:operation});
 expect((await handler(request('state-events',{leadId:row.id,afterVersion:'2',pageSize:50}),transportFixture())).status).toBe(200);expect(calls.events.mock.calls[0]![1]).toEqual({businessId:leadBusiness,leadId:row.id,afterVersion:'2',pageSize:50});expect(calls.change).not.toHaveBeenCalled();
});
it('status writes stop at origin, CSRF or admission failure',async()=>{
 await failure(await dispatch()(request('state',stateChange(),{origin:'https://other.example.com'}),transportFixture()));expect(calls.change).not.toHaveBeenCalled();
 calls.csrf.mockRejectedValue(new Error());await failure(await dispatch()(request('state',stateChange()),transportFixture()));expect(calls.change).not.toHaveBeenCalled();
 calls.csrf.mockResolvedValue(randomUUID());calls.admit.mockResolvedValue(false);await failure(await dispatch()(request('state',stateChange()),transportFixture()),429,'LEAD_REQUEST_LIMITED');expect(calls.change).not.toHaveBeenCalled();
});

it('event history emits the exact validated source wire schema consumed by the status client',async()=>{
 const page={schemaVersion:1,businessId:leadBusiness,leadId:row.id,leadVersion:'1',events:[],hasMore:false};calls.events.mockResolvedValue(projection({state:'found',...page}));
 const response=await dispatch()(request('state-events',{leadId:row.id,afterVersion:'0',pageSize:20}),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual(page);
});
