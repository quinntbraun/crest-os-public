import {randomBytes,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGoogleCalendarDisconnect} from '../../src/operations/google-calendar-disconnect.ts';
import {createGoogleCalendarCredentialStore} from '../../src/operations/google-calendar-credential-store.ts';
import {createGoogleCalendarOAuthTransport} from '../../src/operations/google-calendar-oauth-transport.ts';
import {googleCalendarOAuthScope} from '../../src/operations/google-calendar-oauth.ts';
import {googleCalendarSetupStatements as sql} from '../../src/operations/google-calendar-database.ts';
import {parseCalendarConnectionSummary,parseCalendarDisconnectStatus} from '../../src/operations/google-calendar-disconnect-contract.ts';

async function fixture(){
 const clientId='disconnect-fixture.apps.googleusercontent.com',clientSecret='fictional-secret',callbackUri='https://crest.example.com/api/google-calendar/callback',credentialKeyId='fixture-key';
 const store=await createGoogleCalendarCredentialStore({activeKeyId:credentialKeyId,calendarKeyMaterial:randomBytes(32)});
 const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(null,{status:200}));
 const transport=createGoogleCalendarOAuthTransport({clientId,clientSecret,callbackUri,request,admit:async()=>false});
 const args=[randomBytes(32),randomUUID(),randomUUID(),'https://identity.example.com',randomUUID(),randomUUID(),new Date(Date.now()+3600000),randomUUID(),randomUUID()];
 const destinationId=randomUUID(),disconnectId=randomUUID(),deadline=new Date(Date.now()+30000).toISOString();
 const binding={businessId:args[7] as string,recoveryEpoch:args[8] as string,destinationId,connectionGeneration:'1',clientId,credentialId:randomUUID(),version:'2'};
 const grant=transport.openRetained({clientId,scope:googleCalendarOAuthScope,accessToken:'fictional-access',refreshToken:'fictional-refresh',expiresAt:Date.now()+3600000,refreshExpiresAt:null});
 const sealed=await store.seal(binding,grant);
 const retained={credentialId:binding.credentialId,version:'2',...sealed,generation:'1',deadline};
 const state=(value:string)=>({state:value,disconnectId,drainUntil:new Date().toISOString(),unresolvedMutations:0,reviewRequired:value==='revocation_uncertain'});
 const query=vi.fn<(statement:string,values:unknown[],signal:AbortSignal)=>Promise<unknown>>().mockImplementation(async(statement,values)=>{
  if(statement===sql.revocationCredential)return retained;
  if(values[11]==='admit')return {state:'revocation_admitted',disconnectId,attemptId:values[12],deadline,admissionVersion:1};
  return state(values[11]==='read'?'ready_to_revoke':values[11]==='revoked'?'disconnected':'revocation_uncertain');
 });
 const runtime=createGoogleCalendarDisconnect({clientId,clientSecret,callbackUri,credentialKeyId,store,query,request});
 return {runtime,args,destinationId,disconnectId,retained,query,request,state};
}
describe('Calendar disconnect provider boundary',()=>{
 it('opens a bound credential only after committed admission, then returns the saved revocation outcome',async()=>{
  const f=await fixture();const result=await f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal);
  expect(result.state).toBe('disconnected');expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/revoke');
  expect(new URLSearchParams(f.request.mock.calls[0]![1]!.body as URLSearchParams).get('token')).toBe('fictional-refresh');
  expect(f.query.mock.calls.map(call=>call[0])).toEqual([sql.disconnectStatus,sql.disconnectStatus,sql.revocationCredential,sql.disconnectStatus]);
  expect(f.query.mock.calls.at(-1)![1][11]).toBe('revoked');expect(JSON.stringify(result)).not.toContain('fictional');
 });
 it.each(['draining','revoking','disconnected','revocation_uncertain'])('does not issue or retry provider traffic while %s',async state=>{
  const f=await fixture();f.query.mockResolvedValue(f.state(state));
  expect((await f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).state).toBe(state);
  expect(f.request).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledTimes(1);
 });
 it('does not send when the shared request budget is exhausted',async()=>{
  const f=await fixture();f.query.mockImplementation(async(_statement,values)=>values[11]==='read'?f.state('ready_to_revoke'):{state:'delayed',disconnectId:f.disconnectId});
  expect((await f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).state).toBe('delayed');expect(f.request).not.toHaveBeenCalled();
 });
 it('does not adopt an older unbudgeted admission protocol',async()=>{
  const f=await fixture();f.query.mockImplementation(async(_statement,values)=>values[11]==='read'?f.state('ready_to_revoke'):{state:'revocation_admitted',disconnectId:f.disconnectId,attemptId:values[12],deadline:f.retained.deadline,admissionVersion:0});
  await expect(f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).rejects.toThrow();expect(f.request).not.toHaveBeenCalled();
 });
 it('retains uncertainty when the provider reply is lost',async()=>{
  const f=await fixture();f.request.mockRejectedValue(Error('lost reply'));
  expect((await f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).state).toBe('revocation_uncertain');
  expect(f.query.mock.calls.at(-1)![1][11]).toBe('uncertain');expect(f.request).toHaveBeenCalledTimes(1);
 });
 it('does not report success when saving the provider outcome fails',async()=>{
  const f=await fixture();const implementation=f.query.getMockImplementation()!;
  f.query.mockImplementation(async(statement,values,signal)=>{if(values[11]==='revoked')throw Error('lost commit');return implementation(statement,values,signal);});
  await expect(f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).rejects.toThrow('lost commit');expect(f.request).toHaveBeenCalledTimes(1);
 });
 it('rejects unbound credential data before contacting Google',async()=>{
  const f=await fixture();const implementation=f.query.getMockImplementation()!;
  f.query.mockImplementation(async(statement,values,signal)=>statement===sql.revocationCredential?{...f.retained,version:'3'}:implementation(statement,values,signal));
  expect((await f.runtime.continue(f.args,f.destinationId,f.disconnectId,new AbortController().signal)).state).toBe('revocation_uncertain');expect(f.request).not.toHaveBeenCalled();
 });
 it('rejects misleading or secret-bearing public results',()=>{
  const disconnectId=randomUUID();expect(()=>parseCalendarConnectionSummary({state:'disconnected',destinationId:randomUUID(),generation:'2',disconnectId:null})).toThrow();
  expect(()=>parseCalendarDisconnectStatus({state:'disconnected',disconnectId,drainUntil:new Date().toISOString(),unresolvedMutations:1,reviewRequired:false},disconnectId)).toThrow();
  expect(()=>parseCalendarConnectionSummary({state:'absent',envelope:{}})).toThrow();
 });
});
