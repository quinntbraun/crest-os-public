import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGoogleCalendarConnection} from '../../src/operations/google-calendar-connection.ts';
import {googleCalendarSetupStatements as sql} from '../../src/operations/google-calendar-database.ts';

// Real PKCE sealing/consumption with explicit database/provider ports. This
// checks the application's admission boundary, not owner or Google acceptance.
it.each([undefined,0,1,null])('production initial exchange requires committed budget protocol 1 (%s)',async protocol=>{
 const callbackUri='https://crest.example.com/api/google-calendar/callback',verifierKeyId='test-pkce';
 const authority={businessId:randomUUID(),actorId:randomUUID(),appSessionId:randomUUID(),recoveryEpoch:randomUUID(),connectionGeneration:'0',credentialHash:randomBytes(32),authIssuer:'https://identity.example.com',authSubject:randomUUID(),authProviderSessionId:randomUUID(),providerValidUntil:Date.now()+3600000};
 let retained:unknown[]=[];
 const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'invalid_grant'},{status:400}));
 const query=vi.fn(async(statement:string,values:unknown[])=>{
  if(statement===sql.begin){retained=values;return {attemptId:values[13],expiresAt:new Date(Date.now()+299000).toISOString()};}
  if(statement===sql.consume)return {attemptId:retained[13],verifierKeyId,verifierEnvelope:retained[16]};
  if(statement===sql.budgetedCreationExchange)return protocol===null?null:{attemptId:values[12],deadline:new Date(Date.now()+30000).toISOString(),...(protocol===undefined?{}:{admissionVersion:protocol})};
  throw Error('Unexpected database statement');
 });
 const connection=await createGoogleCalendarConnection({clientId:'fixture-client.apps.googleusercontent.com',clientSecret:'fictional-secret',callbackUri,verifierKeyId,credentialKeyId:'test-grants',calendarKeyMaterial:randomBytes(32),committedQuery:query,request,budgetedExchanges:true});
 const url=new URL((await connection.begin(authority,new AbortController().signal)).headers.get('location')!);
 const callback=new Request(callbackUri+'?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'fictional-code'}));
 const result=await connection.initialCreationCallback(callback,authority,new AbortController().signal);
 expect(request).toHaveBeenCalledTimes(protocol===1?1:0);expect(result.state).toBe(protocol===1?'reconnect':protocol===null?'restart':'uncertain');
 expect(query.mock.calls.some(call=>call[0]===sql.exchange)).toBe(false);
});
