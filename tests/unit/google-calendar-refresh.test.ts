import {randomBytes,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGoogleCalendarRefresh} from '../../src/operations/google-calendar-refresh.ts';
import {createGoogleCalendarCredentialStore} from '../../src/operations/google-calendar-credential-store.ts';
import {createGoogleCalendarOAuthTransport} from '../../src/operations/google-calendar-oauth-transport.ts';
import {googleCalendarOAuthScope} from '../../src/operations/google-calendar-oauth.ts';
import {googleCalendarWorkerStatements as sql} from '../../src/operations/google-calendar-database.ts';

async function fixture(){
 const clientId='refresh-fixture.apps.googleusercontent.com',clientSecret='fictional-secret',callbackUri='https://crest.example.com/api/google-calendar/callback',credentialKeyId='fixture-key';
 const store=await createGoogleCalendarCredentialStore({activeKeyId:credentialKeyId,calendarKeyMaterial:randomBytes(32)});
 const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({access_token:'replacement-access',token_type:'Bearer',expires_in:3600}));
 const oauth=createGoogleCalendarOAuthTransport({clientId,clientSecret,callbackUri,request,admit:async()=>true});
 const target={businessId:randomUUID(),destinationId:randomUUID(),recoveryEpoch:randomUUID(),generation:'1'};
 const binding={...target,connectionGeneration:target.generation,clientId,credentialId:randomUUID(),version:'1'};
 const retained=oauth.openRetained({clientId,scope:googleCalendarOAuthScope,accessToken:'expired-access',refreshToken:'retained-refresh',expiresAt:Date.now()-1000,refreshExpiresAt:null});
 const sealed=await store.seal(binding,retained);
 const claim={state:'claimed',claimId:randomUUID(),deadline:new Date(Date.now()+30000).toISOString(),credentialId:binding.credentialId,version:'1',...sealed,admissionVersion:1};
 const query=vi.fn<(statement:string,values:unknown[],signal:AbortSignal)=>Promise<unknown>>().mockImplementation(async(statement,values)=>statement===sql.refreshClaim?claim:{state:values[5]});
 const run=createGoogleCalendarRefresh({clientId,clientSecret,callbackUri,credentialKeyId,store,query,request});
 return {run,query,request,claim,target,binding,store,oauth};
}

describe('durable Calendar credential refresh',()=>{
 it('preserves the retained refresh token and seals the next version before returning access',async()=>{
  const f=await fixture();const result=await f.run(f.target,new AbortController().signal);
  expect(result.state).toBe('refreshed');expect(f.request).toHaveBeenCalledTimes(1);
  const finish=f.query.mock.calls.find(call=>call[0]===sql.refreshFinish)!;
  expect(finish[1][5]).toBe('rotated');
  const opened=await f.store.open({...f.binding,version:'2'},{keyId:finish[1][6],envelope:finish[1][7]},f.oauth.openRetained);
  expect(opened.forPrivateCredentialStore()).toMatchObject({accessToken:'replacement-access',refreshToken:'retained-refresh'});
 });
 it('withholds the usable replacement until persistence acknowledges it',async()=>{
  const f=await fixture();let acknowledge!:(value:unknown)=>void;let reached!:()=>void;
  const atFinish=new Promise<void>(resolve=>{reached=resolve;});
  f.query.mockImplementation(async(statement)=>statement===sql.refreshClaim?f.claim:new Promise(resolve=>{acknowledge=resolve;reached();}));
  let settled=false;const pending=f.run(f.target,new AbortController().signal).then(result=>{settled=true;return result;});
  await atFinish;expect(settled).toBe(false);acknowledge({state:'rotated'});expect((await pending).state).toBe('refreshed');
 });
 it('does not return or retry a replacement after a lost persistence acknowledgement',async()=>{
  const f=await fixture();f.query.mockImplementation(async statement=>{if(statement===sql.refreshClaim)return f.claim;throw Error('lost acknowledgement');});
  expect(await f.run(f.target,new AbortController().signal)).toEqual({state:'uncertain'});expect(f.request).toHaveBeenCalledTimes(1);
 });
 it.each([true,false])('reports reconnect only when its outcome is durably confirmed (%s)',async acknowledged=>{
  const f=await fixture();f.request.mockImplementation(async()=>Response.json({error:'invalid_grant'},{status:400}));
  f.query.mockImplementation(async statement=>statement===sql.refreshClaim?f.claim:{state:acknowledged?'reconnect':'review'});
  expect(await f.run(f.target,new AbortController().signal)).toEqual({state:acknowledged?'reconnect':'uncertain'});
 });
 it('refuses a claim without the new budget-admission protocol',async()=>{
  const f=await fixture();f.query.mockResolvedValue({...f.claim,admissionVersion:0});
  expect(await f.run(f.target,new AbortController().signal)).toEqual({state:'review'});expect(f.request).not.toHaveBeenCalled();
 });
 it.each(['busy','delayed'])('sends nothing when the shared claim is %s',async state=>{
  const f=await fixture();f.query.mockResolvedValue({state});
  expect(await f.run(f.target,new AbortController().signal)).toEqual({state:'delayed'});expect(f.request).not.toHaveBeenCalled();
 });
 it('does not claim or send after cancellation',async()=>{
  const f=await fixture();expect(await f.run(f.target,AbortSignal.abort())).toEqual({state:'review'});
  expect(f.query).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
 });
});
