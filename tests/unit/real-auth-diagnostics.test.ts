import {expect,it} from 'vitest';
import {classifyAuthServiceError,classifyTestDatabaseError,classifyAuthBridgeError,authBridgeObservation} from '../support/real-auth-diagnostics.mjs';

it('retains fixed provider routes and numeric timing without private request or reply fields',()=>{
 const result=authBridgeObservation({path:'/auth/v1/factors/00000000-0000-4000-8000-000000000001/verify?token=PRIVATE',method:'POST',status:422,date:'Thu, 19 Nov 2026 12:00:00 GMT',startedAt:1795089600100,finishedAt:1795089600500,body:Buffer.from(JSON.stringify({code:'mfa_verification_failed',message:'PRIVATE_SECRET',access_token:'PRIVATE_TOKEN',email:'PRIVATE_EMAIL'}))});
 expect(result).toEqual({route:'verify',method:'POST',status:422,startedAt:1795089600100,elapsedMs:400,providerDateOffsetMs:-500,code:'mfa_verification_failed'});
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE|00000000|token|email|secret/i);
});
it('does not echo unknown code-shaped secrets, paths, methods or malformed dates',()=>{
 const result=authBridgeObservation({path:'/PRIVATE_PATH?secret=PRIVATE',method:'PRIVATE',status:400,date:'PRIVATE',startedAt:NaN,finishedAt:-1,body:Buffer.from('{"code":"private_owner_secret","message":"PRIVATE"}')});
 expect(result).toEqual({route:'other',method:'other',status:400,startedAt:null,elapsedMs:null,providerDateOffsetMs:null,code:'other_provider_error'});
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private_owner/);
});
it('reads the pinned provider HTTP error code separately from its numeric status without exposing messages',()=>{
 const observe=(body:object)=>authBridgeObservation({path:'/auth/v1/user',method:'GET',status:500,date:null,startedAt:10,finishedAt:42,body:Buffer.from(JSON.stringify(body))});
 expect(observe({code:500,error_code:'unexpected_failure',msg:'PRIVATE_DATABASE_MESSAGE',error_id:'PRIVATE_ID'}).code).toBe('unexpected_failure');
 const unknown=observe({code:'invalid_credentials',error_code:'PRIVATE_CODE',msg:'PRIVATE_MESSAGE'});
 expect(unknown.code).toBe('other_provider_error');expect(JSON.stringify(unknown)).not.toContain('PRIVATE');
});
it('never inspects successful credential replies and bounds error parsing and timing',()=>{
 for(const [query,route]of [['password','password'],['refresh_token','refresh'],['PRIVATE','token_other']]){
  const result=authBridgeObservation({path:'/auth/v1/token?grant_type='+query,method:'POST',status:200,date:null,startedAt:10,finishedAt:200000,body:Buffer.from('{"access_token":"PRIVATE","code":"invalid_credentials"}')});
  expect(result.route).toBe(route);expect(result.code).toBeNull();expect(result.elapsedMs).toBeNull();expect(JSON.stringify(result)).not.toContain('PRIVATE');
 }
 expect(authBridgeObservation({path:'/auth/v1/user',method:'GET',status:500,date:null,startedAt:10,finishedAt:20,body:Buffer.alloc(1048577,120)}).code).toBeNull();
});
it('classifies an actual-style provider SQL timeout without retaining private log fields',()=>{const raw=JSON.stringify({level:'error',error:'context canceled: canceling statement due to statement timeout (SQLSTATE 57014) PRIVATE_TEST_SECRET',msg:'failed to load user',email:'synthetic@example.com',token:'PRIVATE_TEST_TOKEN'}),result=classifyAuthServiceError(raw);expect(result).toEqual({category:'statement_timeout',sqlState:'57014'});expect(JSON.stringify(result)).not.toMatch(/PRIVATE|synthetic|load user|email|token/);});
it('classifies pinned provider lookup stages and known database failures without retaining their contents',()=>{
 for(const [message,category]of [['error finding user: PRIVATE','user_lookup'],['error finding session: PRIVATE','session_lookup'],['error finding user: sql: Scan error on column PRIVATE','database_scan'],['error finding session: sql: transaction has already been committed or rolled back PRIVATE','transaction_closed'],['error finding user: context canceled PRIVATE','context_timeout']]){
  const result=classifyAuthServiceError(JSON.stringify({level:'error',error:message,msg:'PRIVATE',request_id:'PRIVATE'}));
  expect(result).toEqual({category,sqlState:null});expect(JSON.stringify(result)).not.toContain('PRIVATE');
 }
});
it('rejects malformed/oversized/nonerror lines and emits only a fixed category for unknown failures',()=>{for(const value of [null,{},'',JSON.stringify({level:'info',msg:'PRIVATE'}),'x'.repeat(65537)])expect(classifyAuthServiceError(value)).toBeNull();expect(classifyAuthServiceError(JSON.stringify({level:'error',msg:'PRIVATE_PASSWORD_TOKEN'}))).toEqual({category:'provider_error',sqlState:null});});
it('keeps database failure categories separate from raw SQL, parameters and messages',()=>{expect(classifyTestDatabaseError({code:'40P01',message:'PRIVATE secret deadlock'})).toEqual({category:'deadlock',sqlState:'40P01'});expect(classifyTestDatabaseError({message:'PRIVATE Query read timeout'})).toEqual({category:'query_or_connection_timeout',sqlState:null});expect(classifyTestDatabaseError({code:'PRIVATE_TOKEN',message:'PRIVATE'})).toEqual({category:'query_error',sqlState:null});});
it('classifies test bridge timeouts without retaining upstream URLs, bodies or credentials',()=>{for(const name of ['TimeoutError','AbortError'])expect(classifyAuthBridgeError({name,message:'PRIVATE upstream token',cause:{password:'PRIVATE'}})).toEqual({category:'bridge_timeout',sqlState:null});expect(classifyAuthBridgeError({name:'PRIVATE_TOKEN',message:'PRIVATE'})).toEqual({category:'bridge_failure',sqlState:null});expect(classifyAuthBridgeError(null)).toEqual({category:'bridge_failure',sqlState:null});});
