// Explicit session/connection ports exercise HTTP authority selection, not real
// Google authorization, a database commit or production TLS acceptance.
import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),verify:vi.fn(),settings:vi.fn(),state:vi.fn(),begin:vi.fn(),confirm:vi.fn(),callback:vi.fn(),jobStatus:vi.fn(),connection:vi.fn(),disconnect:vi.fn(),disconnectStatus:vi.fn(),abandon:vi.fn(),reconnectTarget:vi.fn(),startReconnect:vi.fn(),reconnectCallback:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:calls.verify})}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.settings}));
vi.mock('../../src/operations/google-calendar-connection.ts',()=>({createGoogleCalendarConnection:async()=>({setupState:calls.state,begin:calls.begin,confirmCreation:calls.confirm,initialCreationCallback:calls.callback,jobStatus:calls.jobStatus,connectionStatus:calls.connection,beginDisconnect:calls.disconnect,disconnectStatus:calls.disconnectStatus,abandonCreation:calls.abandon,reconnectTarget:calls.reconnectTarget,startReconnect:calls.startReconnect,callback:calls.reconnectCallback})}));
import {createProductionGoogleCalendarRuntime} from '../../src/operations/google-calendar-production-runtime';
import {createProductionCapabilities,productionCalendarWorkerBaseCapabilities} from '../../src/security/production-capabilities';
import {transportFixture} from '../support/transport';

const origin='https://crest.example.com',businessId=randomUUID(),sessionId=randomUUID(),actorId=randomUUID(),epoch=randomUUID(),attemptId=randomUUID(),credential=randomBytes(32).toString('base64url');
const config={origin,businessId,environment:'production' as const,connectionString:'postgresql://crest_runtime:fixture-only@database.example.com/crest',ingress:{kind:'direct' as const},productionCapabilities:createProductionCapabilities({productionActivation:'ready'},businessId,[...productionCalendarWorkerBaseCapabilities,'googleCalendar'])};
const calendar={connectionString:'postgresql://crest_calendar_setup:fixture-only@database.example.com/crest',clientId:'crest-owner-client.apps.googleusercontent.com',clientSecret:'fixture-only-client-secret',verifierKeyId:'calendar-pkce',credentialKeyId:'calendar-grants',calendarKeyMaterial:randomBytes(32),googleOwner:'crest-owner@example.com'};
const provider={issuer:'https://identity.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+3600000};
const handler=()=>createProductionGoogleCalendarRuntime(config,{} as Parameters<typeof createProductionGoogleCalendarRuntime>[1],{} as Parameters<typeof createProductionGoogleCalendarRuntime>[2],calendar);
const post=(route:string,body:object)=>new Request(origin+'/api/business/google-calendar/'+route,{method:'POST',headers:{Origin:origin,Cookie:'__Host-crest_session='+credential,'Content-Type':'application/json','X-Crest-Csrf':'A'.repeat(43)},body:JSON.stringify(body)});
it('requires explicit confirmed intent and fresh owner authority to retire an unsent authorization',async()=>{
 const operationId=randomUUID();calls.abandon.mockResolvedValue({schemaVersion:1,state:'abandoned',attemptId});
 const run=handler();expect((await run(post('abandon-authorization',{recoveryEpoch:epoch,attemptId,operationId,confirmed:false}),transportFixture())).status).toBe(409);
 expect(calls.abandon).not.toHaveBeenCalled();
 expect((await run(post('abandon-authorization',{recoveryEpoch:epoch,attemptId,operationId,confirmed:true}),transportFixture())).status).toBe(200);
 expect(calls.abandon.mock.calls[0]!.slice(1,3)).toEqual([attemptId,operationId]);expect(calls.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);expect(calls.begin).not.toHaveBeenCalled();
});
it('returns restart availability only from the database setup state',async()=>{
 calls.state.mockResolvedValueOnce({schemaVersion:1,state:'authorization_pending',attemptId});
 const response=await handler()(post('setup-state',{recoveryEpoch:epoch}),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual({schemaVersion:1,state:'authorization_pending',attemptId});
});
it('requires explicit intent and fresh owner proof before a live disconnect',async()=>{
 const destinationId=randomUUID(),operationId=randomUUID();calls.disconnect.mockResolvedValue({state:'delayed',disconnectId:randomUUID()});
 const run=handler();expect((await run(post('disconnect',{recoveryEpoch:epoch,destinationId,generation:'1',operationId,confirmed:false}),transportFixture())).status).toBe(409);
 expect(calls.disconnect).not.toHaveBeenCalled();
 expect((await run(post('disconnect',{recoveryEpoch:epoch,destinationId,generation:'1',operationId,confirmed:true}),transportFixture())).status).toBe(200);
 expect(calls.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);
 expect(calls.disconnect.mock.calls[0]!.slice(1,4)).toEqual([destinationId,'1',operationId]);expect(calls.state).not.toHaveBeenCalled();
});
it('keeps read-only disconnect checks separate from explicit revocation',async()=>{
 const destinationId=randomUUID(),disconnectId=randomUUID();calls.disconnectStatus.mockResolvedValue({state:'delayed',disconnectId});
 const run=handler();for(const route of ['disconnect-status','revoke'])expect((await run(post(route,{recoveryEpoch:epoch,destinationId,disconnectId}),transportFixture())).status).toBe(200);
 expect(calls.disconnectStatus.mock.calls.map(call=>call[4])).toEqual([false,true]);expect(calls.begin).not.toHaveBeenCalled();
});
it('refuses revocation before the actual session verifier accepts the request',async()=>{
 calls.verify.mockRejectedValueOnce(Error('session refused'));
 expect((await handler()(post('revoke',{recoveryEpoch:epoch,destinationId:randomUUID(),disconnectId:randomUUID()}),transportFixture())).status).toBe(409);
 expect(calls.disconnectStatus).not.toHaveBeenCalled();
});
beforeEach(()=>{
 calls.connection.mockResolvedValue({state:'absent'});calls.reconnectTarget.mockResolvedValue(null);calls.reconnectCallback.mockResolvedValue({state:'staged'});
 vi.clearAllMocks();calls.csrf.mockResolvedValue(sessionId);calls.admit.mockResolvedValue(true);calls.verify.mockResolvedValue({sessionId,actorId,provider});calls.state.mockResolvedValue({schemaVersion:1,state:'ready'});calls.confirm.mockResolvedValue(true);calls.callback.mockResolvedValue({state:'staged'});calls.settings.mockResolvedValue({forServer:()=>({writeState:'ready',recoveryEpoch:epoch})});
 calls.begin.mockResolvedValue(new Response(null,{status:303,headers:{Location:'https://accounts.google.com/o/oauth2/v2/auth?state='+attemptId+'.'+'A'.repeat(43)}}));
});
it('does not disclose the original private subject in reconnect information',async()=>{
 const destinationId=randomUUID();calls.reconnectTarget.mockResolvedValueOnce({destinationId,generation:'4',issuer:'https://accounts.google.com',subject:'private-original-google-subject',providerCalendarId:'private-calendar@group.calendar.google.com'});
 const response=await handler()(post('reconnect-info',{recoveryEpoch:epoch}),transportFixture());expect(response.status).toBe(200);
 expect(await response.json()).toEqual({schemaVersion:1,state:'ready',destinationId,generation:'4',googleOwner:calendar.googleOwner});
});
it('requires explicit intent and uses the configured account for reconnect start',async()=>{
 const destinationId=randomUUID();calls.startReconnect.mockImplementation(()=>calls.begin());
 const run=handler();const body={recoveryEpoch:epoch,destinationId,generation:'4',googleOwner:calendar.googleOwner,confirmed:true};
 expect((await run(post('start-reconnect',{...body,confirmed:false}),transportFixture())).status).toBe(409);expect(calls.startReconnect).not.toHaveBeenCalled();
 expect((await run(post('start-reconnect',body),transportFixture())).status).toBe(200);expect(calls.startReconnect.mock.calls[0]!.slice(1,4)).toEqual([destinationId,'4',calendar.googleOwner]);expect(calls.confirm).not.toHaveBeenCalled();
});
it('selects reconnect generation from private saved authority without falling back to calendar creation',async()=>{
 const destinationId=randomUUID();calls.connection.mockResolvedValue({state:'active',destinationId,generation:'5',disconnectId:null});
 calls.reconnectTarget.mockResolvedValueOnce({destinationId,generation:'5',issuer:'https://accounts.google.com',subject:'original-account'});
 const request=new Request(origin+'/api/google-calendar/callback?state='+attemptId+'.'+'A'.repeat(43)+'&code=fixture-only-code',{headers:{Cookie:'__Host-crest_session='+credential}});
 expect((await handler()(request,transportFixture())).status).toBe(303);expect(calls.reconnectCallback.mock.calls[0]![1].connectionGeneration).toBe('5');expect(calls.callback).not.toHaveBeenCalled();
 calls.reconnectCallback.mockClear();expect((await handler()(request,transportFixture())).status).toBe(303);expect(calls.reconnectCallback).not.toHaveBeenCalled();expect(calls.callback).not.toHaveBeenCalled();
});
it('records reviewed account intent under fresh owner authority before returning a Google authorization URL',async()=>{
 const response=await handler()(post('start-authorization',{recoveryEpoch:epoch,googleOwner:calendar.googleOwner,confirmed:true}),transportFixture());expect(response.status).toBe(200);
 const value=await response.json();expect(Object.keys(value)).toEqual(['authorizationUrl']);expect(new URL(value.authorizationUrl).searchParams.get('login_hint')).toBe(calendar.googleOwner);
 expect(calls.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);expect(calls.confirm.mock.calls[0]!.slice(1,4)).toEqual([attemptId,calendar.googleOwner,true]);expect(calls.callback).not.toHaveBeenCalled();
 const authority=calls.begin.mock.calls[0]![0];expect(authority.businessId).toBe(businessId);expect(authority.appSessionId).toBe(sessionId);expect(authority.recoveryEpoch).toBe(epoch);expect([...authority.credentialHash]).toEqual(Array(32).fill(0));
});
it('does not reveal configured account information when database business/epoch authority is refused',async()=>{
 calls.state.mockRejectedValueOnce(Error('denied'));
 const response=await handler()(post('connection-info',{recoveryEpoch:epoch}),transportFixture());expect(response.status).toBe(409);expect(await response.text()).not.toContain(calendar.googleOwner);
});
it('rejects changed account intent and the fixture stage route without invoking provider callback',async()=>{
 const run=handler();expect((await run(post('start-authorization',{recoveryEpoch:epoch,googleOwner:'different@example.com',confirmed:true}),transportFixture())).status).toBe(409);
 expect((await run(post('stage-fictional',{recoveryEpoch:epoch,confirmed:true}),transportFixture())).status).toBe(404);expect(calls.begin).not.toHaveBeenCalled();expect(calls.callback).not.toHaveBeenCalled();
});
it('binds a callback to the fresh session/current recovery epoch and always cleans the URL',async()=>{
 const request=new Request(origin+'/api/google-calendar/callback?state='+attemptId+'.'+'A'.repeat(43)+'&code=fixture-only-code',{headers:{Cookie:'__Host-crest_session='+credential}});
 const response=await handler()(request,transportFixture());expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('/settings/google-calendar');expect(response.headers.get('referrer-policy')).toBe('no-referrer');expect(await response.text()).toBe('');
 expect(calls.csrf).not.toHaveBeenCalled();expect(calls.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);const authority=calls.callback.mock.calls[0]![1];expect(authority.appSessionId).toBe(sessionId);expect(authority.recoveryEpoch).toBe(epoch);expect(calls.callback.mock.calls[0]![0]).toBe(request);
});
it('cleans denied or failed callbacks without a code, state or exception in the response',async()=>{
 const run=handler();const denied=await run(new Request(origin+'/api/google-calendar/callback?code=private-code'),transportFixture());expect(denied.status).toBe(303);expect(calls.callback).not.toHaveBeenCalled();
 calls.callback.mockRejectedValueOnce(Error('must-not-reflect'));
 const failed=await run(new Request(origin+'/api/google-calendar/callback?code=private-code',{headers:{Cookie:'__Host-crest_session='+credential}}),transportFixture());expect(failed.status).toBe(303);expect(failed.headers.get('location')).toBe('/settings/google-calendar');expect(await failed.text()).toBe('');
});
