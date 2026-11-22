import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import type {JWK} from 'jose';
import {beforeAll,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGoogleCalendarIdentityVerifier} from '../../src/operations/google-calendar-identity.ts';
import {createGoogleCalendarOAuth,googleCalendarOAuthIssuer,googleCalendarOAuthScope,googleCalendarIdentityScope} from '../../src/operations/google-calendar-oauth.ts';
import type {GoogleCalendarOAuthAttemptStore} from '../../src/operations/google-calendar-oauth.ts';
import {createGoogleCalendarOAuthTransport} from '../../src/operations/google-calendar-oauth-transport.ts';
import {createGoogleCalendarCredentialStore} from '../../src/operations/google-calendar-credential-store.ts';
const clientId='identity-fixture.apps.googleusercontent.com',callbackUri='https://crest.example.com/api/google-calendar/callback',subject='123456789012345678901',nonce='N'.repeat(43),accessToken='fictional-access';
let pair:Awaited<ReturnType<typeof generateKeyPair>>,jwk:JWK;
beforeAll(async()=>{pair=await generateKeyPair('RS256');jwk={...await exportJWK(pair.publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};});
async function signed(changes:Record<string,unknown>={},headers:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000);return new SignJWT({iss:googleCalendarOAuthIssuer,aud:clientId,sub:subject,iat:now,exp:now+3600,nonce,...changes}).setProtectedHeader({alg:'RS256',kid:'fixture-key',...headers}).sign(pair.privateKey);
}
const keysRequest=()=>vi.fn<typeof fetch>(async url=>{expect(url).toBe('https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]});});
it('verifies a real RSA signature, account subject, nonce, audience and access-token hash using only fixed public keys',async()=>{
 const request=keysRequest(),verify=createGoogleCalendarIdentityVerifier(clientId,request);
 const token=await signed({at_hash:createHash('sha256').update(accessToken).digest().subarray(0,16).toString('base64url')});
 expect(await verify(token,accessToken,nonce,new AbortController().signal)).toEqual({issuer:googleCalendarOAuthIssuer,subject});
 await verify(token,accessToken,nonce,new AbortController().signal);expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0]![1]).toMatchObject({credentials:'omit',redirect:'error',headers:{accept:'application/json'}});
});
it.each([
 {nonce:'wrong'}, {iss:'https://other.example.com'}, {aud:'other-client.apps.googleusercontent.com'}, {azp:'other-client.apps.googleusercontent.com'},
 {sub:''}, {sub:'subject with whitespace'}, {iat:Math.floor(Date.now()/1000)+60}, {exp:Math.floor(Date.now()/1000)-60}, {at_hash:'wrong'},
])('rejects a signed token with invalid binding or lifetime %j',async changes=>{
 await expect(createGoogleCalendarIdentityVerifier(clientId,keysRequest())(await signed(changes),accessToken,nonce,new AbortController().signal)).rejects.toThrow('GOOGLE_CALENDAR_OAUTH_FAILED');
});
it('refuses an unsigned token and an unrelated signing key',async()=>{
 const verify=createGoogleCalendarIdentityVerifier(clientId,keysRequest());
 await expect(verify('eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3JnZWQifQ.x',accessToken,nonce,new AbortController().signal)).rejects.toThrow();
 const other=await generateKeyPair('RS256');const now=Math.floor(Date.now()/1000);
 const token=await new SignJWT({iss:googleCalendarOAuthIssuer,aud:clientId,sub:subject,nonce,iat:now,exp:now+3600}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).sign(other.privateKey);
 await expect(verify(token,accessToken,nonce,new AbortController().signal)).rejects.toThrow();
});
it('does not follow a token-selected key URL or retrieve keys after cancellation',async()=>{
 const request=keysRequest(),verify=createGoogleCalendarIdentityVerifier(clientId,request);
 await expect(verify(await signed({}, {jku:'https://attacker.example.com/keys'}),accessToken,nonce,new AbortController().signal)).rejects.toThrow();
 expect(request.mock.calls.every(call=>call[0]==='https://www.googleapis.com/oauth2/v3/certs')).toBe(true);
 const cancelled=keysRequest();await expect(createGoogleCalendarIdentityVerifier(clientId,cancelled)(await signed(),accessToken,nonce,AbortSignal.abort())).rejects.toThrow();expect(cancelled).not.toHaveBeenCalled();
});
it('carries the nonce through real PKCE, seals verified identity and preserves it on refresh without an extra ID token',async()=>{
 type Pending=Parameters<GoogleCalendarOAuthAttemptStore['begin']>[0];let pending:Pending|undefined;
 const materialKey=randomBytes(32),verifierKeyId='fixture-pkce';
 const oauth=await createGoogleCalendarOAuth({clientId,callbackUri,verifierKeyId,calendarKeyMaterial:materialKey,withIdentity:true,store:{
  async begin(value){pending=value;return {attemptId:value.attemptId,expiresAt:new Date(Date.now()+299000).toISOString()};},
  async consume(value){if(!pending||pending.attemptId!==value.attemptId||!pending.stateDigest.equals(value.stateDigest))return null;const prior=pending;pending=undefined;return {attemptId:prior.attemptId,verifierKeyId,verifierEnvelope:prior.verifierEnvelope};},
 }});
 const owner={businessId:randomUUID(),actorId:randomUUID(),appSessionId:randomUUID(),recoveryEpoch:randomUUID(),connectionGeneration:'0'};
 const url=new URL((await oauth.begin(owner,new AbortController().signal)).headers.get('location')!);
 expect(url.searchParams.get('scope')).toBe(googleCalendarIdentityScope);expect(url.searchParams.get('prompt')).toBe('consent');expect(url.searchParams.get('nonce')).not.toBe(url.searchParams.get('code_challenge'));
 const callback=await oauth.callback(new Request(callbackUri+'?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'fictional-code'})),owner,new AbortController().signal);
 if(callback.state!=='exchange_pending')throw Error('Expected an actual PKCE exchange');
 let wrongRefresh=false;
 const request=vi.fn<typeof fetch>(async(target,init)=>{
  if(target==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  expect(target).toBe('https://oauth2.googleapis.com/token');const refresh=new URLSearchParams(init!.body as URLSearchParams).get('grant_type')==='refresh_token';
  return Response.json({access_token:refresh?'refreshed-access':accessToken,token_type:'Bearer',expires_in:3600,scope:'openid '+googleCalendarOAuthScope,...(refresh?wrongRefresh?{id_token:await signed({sub:'another-account'})}:{}:{refresh_token:'fictional-refresh',id_token:await signed({nonce:url.searchParams.get('nonce')})})});
 });
 const transport=createGoogleCalendarOAuthTransport({clientId,clientSecret:'fictional-secret',callbackUri,request,admit:async()=>true,verifyIdentity:createGoogleCalendarIdentityVerifier(clientId,request)});
 const exchanged=await transport.exchange(callback.exchange,new AbortController().signal);if(exchanged.state!=='granted')throw Error('Signed exchange was refused');
 expect(exchanged.grant.identity).toEqual({issuer:googleCalendarOAuthIssuer,subject});expect(()=>JSON.stringify(exchanged.grant)).toThrow();
 const store=await createGoogleCalendarCredentialStore({activeKeyId:'fixture-grants',calendarKeyMaterial:materialKey});
 const binding={businessId:owner.businessId,destinationId:randomUUID(),recoveryEpoch:owner.recoveryEpoch,connectionGeneration:'1',clientId,credentialId:randomUUID(),version:'1'};
 const sealed=await store.seal(binding,exchanged.grant),retained=await store.open(binding,sealed,transport.openRetained);
 expect(retained.identity).toEqual(exchanged.grant.identity);expect(retained.forPrivateCredentialStore().scope).toBe(googleCalendarIdentityScope);
 const refreshed=await transport.refresh(retained,new AbortController().signal);if(refreshed.state!=='granted')throw Error('Bound refresh was refused');
 expect(refreshed.grant.identity).toEqual(retained.identity);expect(refreshed.grant.forPrivateCredentialStore().refreshToken).toBe('fictional-refresh');
 wrongRefresh=true;expect((await transport.refresh(refreshed.grant,new AbortController().signal)).state).toBe('uncertain');
});
