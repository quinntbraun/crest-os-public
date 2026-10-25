import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),save:vi.fn(),list:vi.fn(),history:vi.fn(),lookup:vi.fn(),context:vi.fn(),leadList:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/customer/lead-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-directory.ts')>(),createLeadDirectory:()=>({list:calls.leadList})}));
vi.mock('../../src/customer/lead-state-directory.ts',()=>({createLeadStateDirectory:()=>({}),LeadStateDirectoryError:class extends Error{}}));
vi.mock('../../src/customer/lead-vehicle-directory.ts',async original=>({...await original<typeof import('../../src/customer/lead-vehicle-directory.ts')>(),createLeadVehicleDirectory:()=>calls}));
import {createLeadHttp} from '../../src/customer/lead-http.ts';
import {LeadVehicleDirectoryError} from '../../src/customer/lead-vehicle-directory.ts';
import {draftFromLeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {leadVehicleDraftToWire} from '../../src/customer/lead-vehicle-http-contract.ts';
import {leadVehicleFixture} from '../support/lead-vehicle-fixture.ts';
import {transportFixture} from '../support/transport';
const row=leadVehicleFixture(),origin='https://crest.example.com',opaque=randomBytes(32).toString('base64url'),epoch=randomUUID(),operation=randomUUID();
const config={origin,businessId:row.business_id,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'unused'};
const dispatch=()=>createLeadHttp(config,{} as never,{} as never),projection=(value:object)=>({forServer:()=>value,toJSON(){throw new Error('private');}});
const input=()=>({schemaVersion:1,operationId:operation,recoveryEpoch:epoch,leadId:row.lead_id,leadVehicleId:row.id,expectedVersion:'0',...leadVehicleDraftToWire(draftFromLeadVehicle(row))});
const receipt=()=>({state:'committed',operationId:operation,recoveryEpoch:epoch,receipt:{schemaVersion:1,businessId:row.business_id,leadId:row.lead_id,leadVehicleId:row.id,leadVehicleVersion:'1',auditEventId:randomUUID()}});
const request=(route='vehicle-save',body:unknown=input(),headers:Record<string,string>={},method='POST',signal?:AbortSignal)=>new Request(origin+'/api/business/leads/'+route,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-crest_session='+opaque,...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
beforeEach(()=>{vi.resetAllMocks();calls.csrf.mockResolvedValue(randomUUID());calls.admit.mockResolvedValue(true);calls.save.mockResolvedValue(projection(receipt()));calls.lookup.mockResolvedValue(projection({state:'absent'}));calls.list.mockResolvedValue(projection({state:'absent'}));calls.history.mockResolvedValue(projection({state:'absent'}));});
async function failure(r:Response,status=400,error='LEAD_REQUEST_FAILED'){
 expect(r.status).toBe(status);expect(await r.json()).toEqual({error});expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");expect(r.headers.has('set-cookie')).toBe(false);expect(r.headers.has('access-control-allow-origin')).toBe(false);
}
it('pins configured business and reconstructs complete original Unicode report after CSRF and ordinary admission',async()=>{
 const body={...input(),expectedVersion:'9007199254740993',reportedYear:-42,reportedLabel:'Incomplete report é 😀',reportedVin:' Raw 001 ',reportedNotes:'😀'.repeat(2000),requestedServicesText:'\n'.repeat(4000),conditionNotes:'é'.repeat(4000)},value=receipt();calls.save.mockResolvedValue(projection(value));
 expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(8192);const r=await dispatch()(request('vehicle-save',body),transportFixture());expect(await r.json()).toEqual(value);
 const submitted=calls.save.mock.calls[0]![1];expect(submitted).toMatchObject({businessId:row.business_id,operationId:operation,leadId:row.lead_id,leadVehicleId:row.id,expectedVersion:body.expectedVersion,recoveryEpoch:epoch,draft:{reportedVehicle:{schemaVersion:1,label:body.reportedLabel,year:-42,vin:body.reportedVin,notes:body.reportedNotes},requestedServices:{schemaVersion:1,text:body.requestedServicesText},conditionNotes:body.conditionNotes}});
 expect(calls.csrf.mock.invocationCallOrder[0]).toBeLessThan(calls.admit.mock.invocationCallOrder[0]!);expect(calls.admit.mock.invocationCallOrder[0]).toBeLessThan(calls.save.mock.invocationCallOrder[0]!);expect(calls.admit).toHaveBeenCalledWith(opaque,'ordinary',expect.any(AbortSignal));expect(calls.context).not.toHaveBeenCalled();expect(calls.leadList).not.toHaveBeenCalled();
});
it.each([{businessId:randomUUID()},{actorId:randomUUID()},{reportedVehicle:{}},{requestedServices:{}},{quoteId:randomUUID()},{customerId:randomUUID()},{reportedYear:1.5},{reportedLabel:null},{expectedVersion:1},{vehicleId:'not UUID'},{archived:true,archiveReason:' '},{conditionNotes:{nested:'invalid'}}])('rejects fabricated authority or malformed flat report before admission %#',async patch=>{await failure(await dispatch()(request('vehicle-save',{...input(),...patch}),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.save).not.toHaveBeenCalled();});
it('rejects escaped duplicate keys, missing fields and oversized input before CSRF',async()=>{
 const missing={...input()} as Record<string,unknown>;delete missing.reportedNotes;
 for(const body of [JSON.stringify(input()).replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'),missing,'x'.repeat(131073)])await failure(await dispatch()(request('vehicle-save',body),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();
});
it.each(['GET','OPTIONS','PUT'])('requires POST for vehicle routes, never %s',async method=>{const r=await dispatch()(request('vehicle-save',{}, {},method),transportFixture());expect(r.headers.get('allow')).toBe('POST');await failure(r,405);expect(calls.csrf).not.toHaveBeenCalled();});
it.each(['vehicle-save/','%76ehicle-save','vehicle-save?extra=1'])('rejects noncanonical vehicle route %s',async path=>{await failure(await dispatch()(request(path),transportFixture()),404);expect(calls.csrf).not.toHaveBeenCalled();});
it.each([{origin:'https://evil.example.com'},{'sec-fetch-site':'cross-site'},{cookie:''},{'content-type':'text/plain'}])('rejects request-protection failures before vehicle work %#',async headers=>{await failure(await dispatch()(request('vehicle-save',input(),headers),transportFixture()));expect(calls.csrf).not.toHaveBeenCalled();expect(calls.save).not.toHaveBeenCalled();});
it('CSRF failure, limited and uncertain admission stop all writes',async()=>{
 calls.csrf.mockRejectedValueOnce(new Error('private'));await failure(await dispatch()(request(),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();
 calls.admit.mockResolvedValueOnce(false);const r=await dispatch()(request(),transportFixture());expect(r.headers.get('retry-after')).toBe('60');await failure(r,429,'LEAD_REQUEST_LIMITED');
 calls.admit.mockRejectedValueOnce(new Error('private SQL'));await failure(await dispatch()(request(),transportFixture()),503);expect(calls.save).not.toHaveBeenCalled();
});
it.each([{state:'conflict',reason:'parent'},{state:'conflict',reason:'vehicle'},{state:'conflict',reason:'lead_vehicle'},{state:'conflict',reason:'operation'},{state:'conflict',reason:'version',currentVersion:'9007199254740994'}])('returns definite conflicts without retry %#',async value=>{calls.save.mockResolvedValue(projection(value));const r=await dispatch()(request(),transportFixture());expect(r.status).toBe(409);expect(await r.json()).toEqual(value);expect(calls.save).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();});
it.each([['LEAD_VEHICLE_NOT_SUBMITTED',503],['LEAD_VEHICLE_DENIED',403],['RECOVERY_REVIEW_REQUIRED',409],['LEAD_VEHICLE_OUTCOME_UNKNOWN',503]] as const)('preserves fixed save outcome %s',async(code,status)=>{calls.save.mockRejectedValue(new LeadVehicleDirectoryError(code));await failure(await dispatch()(request(),transportFixture()),status,code);expect(calls.save).toHaveBeenCalledTimes(1);expect(calls.lookup).not.toHaveBeenCalled();});
it('post-submission cancellation or invalid projection stays unknown without leaking details',async()=>{
 const controller=new AbortController();calls.save.mockImplementationOnce(async()=>{controller.abort();return projection(receipt());});await failure(await dispatch()(request('vehicle-save',input(),{},'POST',controller.signal),transportFixture()),503,'LEAD_VEHICLE_OUTCOME_UNKNOWN');
 calls.save.mockResolvedValueOnce({forServer(){throw new Error('private SQL');}});await failure(await dispatch()(request(),transportFixture()),503,'LEAD_VEHICLE_OUTCOME_UNKNOWN');expect(calls.lookup).not.toHaveBeenCalled();
});
it('projects exact page/history wire schemas and binds every read to original parent/source/cursors',async()=>{
 const list={schemaVersion:1,businessId:row.business_id,leadId:row.lead_id,leadVersion:'9',leadVehicles:[row],hasMore:false},history={schemaVersion:1,businessId:row.business_id,leadVehicle:row,history:[],hasMore:false};calls.list.mockResolvedValue(projection({state:'found',...list}));calls.history.mockResolvedValue(projection({state:'found',...history}));
 const run=dispatch(),listing={leadId:row.lead_id,afterId:null,includeArchived:true,pageSize:10},cursor={leadId:row.lead_id,leadVehicleId:row.id,afterVersion:'9007199254740993',pageSize:5};
 expect(await(await run(request('vehicle-list',listing),transportFixture())).json()).toEqual(list);expect(await(await run(request('vehicle-history',cursor),transportFixture())).json()).toEqual(history);
 expect(calls.list.mock.calls[0]![1]).toEqual({businessId:row.business_id,...listing});expect(calls.history.mock.calls[0]![1]).toEqual({businessId:row.business_id,...cursor});
 const original=receipt();calls.lookup.mockResolvedValue(projection(original));expect(await(await run(request('vehicle-operation',{operationId:operation}),transportFixture())).json()).toEqual(original);expect(calls.lookup.mock.calls[0]![1]).toEqual({businessId:row.business_id,operationId:operation});expect(calls.save).not.toHaveBeenCalled();expect(calls.context).not.toHaveBeenCalled();
});
it.each([['vehicle-list',{leadId:row.lead_id,afterId:null,includeArchived:false,pageSize:51}],['vehicle-history',{leadId:row.lead_id,leadVehicleId:row.id,afterVersion:'0',pageSize:21}],['vehicle-operation',{operationId:'invalid'}]] as const)('rejects invalid %s read before allowance',async(route,body)=>{await failure(await dispatch()(request(route,body),transportFixture()));expect(calls.admit).not.toHaveBeenCalled();});
it('missing parents remain absent, while read failure never claims absence or leaks private data',async()=>{
 const run=dispatch(),body={leadId:row.lead_id,afterId:null,includeArchived:true,pageSize:10};expect(await(await run(request('vehicle-list',body),transportFixture())).json()).toEqual({state:'absent'});
 calls.list.mockRejectedValue(new Error('private label'));await failure(await run(request('vehicle-list',body),transportFixture()),503);expect(calls.save).not.toHaveBeenCalled();
});
