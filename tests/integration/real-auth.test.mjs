import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { TOTP,URI } from 'otpauth';
import { createRemoteJWKSet,decodeJwt,jwtVerify } from 'jose';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { startRealAuthService,authResult } from '../support/real-auth-service.mjs';
import { createProviderBoundary,ProviderAuthenticationError } from '../../src/security/provider-auth.ts';
import { createLiveProviderSessionLookup } from '../../src/security/provider-session-db.ts';
import { localSessionEligibility } from '../../src/security/session-policy.ts';

let sandbox,client,target,service,lookup,boundary,login,loginOwned=false,runtimeUrl,keys;
const signal=()=>new AbortController().signal;
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();
  lookup=createLiveProviderSessionLookup({connectionString:runtimeUrl,environment:'test'});
  service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},lookup);
  keys=createRemoteJWKSet(new URL(`${service.issuer}/.well-known/jwks.json`),{headers:{apikey:service.publicKey}});
});
after(async()=>{await service?.close();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
async function denied(work){await assert.rejects(work,e=>e instanceof ProviderAuthenticationError&&e.message==='PROVIDER_AUTHENTICATION_FAILED'&&e.cause===undefined);}
async function provision({confirmed=true,enroll=true,backup=false}={}) {
  const email=`synthetic-${randomUUID()}@example.com`,password=randomBytes(32).toString('base64url');
  const user=authResult(await service.admin.admin.createUser({email,password,email_confirm:confirmed}),'provision').user;
  assert(user?.id,'provider must return a durable subject');const sdk=service.sdk();await sdk.initialize();
  if(!confirmed||!enroll)return {subject:user.id,email,password,sdk};
  authResult(await sdk.signInWithPassword({email,password}),'enrollment_password');
  const add=async()=>{
    const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:`Synthetic ${randomUUID()}`}), 'enroll');
    const totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP,'provider must return a TOTP URI');
    authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'enrollment_verify');
    return {factorId:factor.id,totp};
  };
  const primary=await add(),secondary=backup?await add():null;
  return {subject:user.id,email,password,sdk,...primary,secondary};
}
const fresh=fixture=>boundary.authenticatePasswordTotp({email:fixture.email,password:fixture.password,factorId:fixture.factorId,code:fixture.totp.generate()},{subject:fixture.subject});
const bound=material=>({subject:material.identity.subject,sessionId:material.identity.sessionId});
const access=material=>material.tokensForServerStorage().accessToken;
async function cryptographicallyValid(material){await jwtVerify(access(material),keys,{algorithms:['ES256'],issuer:service.issuer,audience:'authenticated'});}
function wrongCode(totp){const valid=new Set([-2,-1,0,1,2].map(delta=>totp.generate({timestamp:Date.now()+delta*30000})));let n=0;while(valid.has(String(n).padStart(6,'0')))n++;return String(n).padStart(6,'0');}
async function localState(fixture,material){
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query('BEGIN');let actor;
  try {
    actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic Auth owner',$1,$2,$3,$3,'manual') RETURNING *",[service.issuer,fixture.subject,bootstrap])).rows[0];
    const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic Auth business','UTC',$1,$1,'manual') RETURNING id",[actor.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor.id]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor.id]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const authAt=new Date(Math.min(material.identity.passwordAt,material.identity.totpAt));
  const session=(await client.query("WITH moment AS (SELECT date_trunc('milliseconds',clock_timestamp()) AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,created_by,updated_by) SELECT $1,$2,$3,$4,stamp,$5,stamp,stamp+interval '12 hours',false,$1,$1 FROM moment RETURNING id",[actor.id,material.identity.sessionId,randomBytes(32),actor.current_security_epoch,authAt])).rows[0].id;
  return {actor:actor.id,session};
}
async function local(id){
  const r=(await client.query("SELECT s.*,a.kind,a.disabled_at,a.current_security_epoch,clock_timestamp() AS now FROM crest_private.app_sessions s JOIN crest_private.actors a ON a.id=s.actor_id WHERE s.id=$1",[id])).rows[0];
  return localSessionEligibility({actorId:r.actor_id,issuedSecurityEpoch:r.issued_security_epoch,trusted:r.trusted,createdAt:r.created_at.getTime(),authenticatedAt:r.authenticated_at.getTime(),lastActiveAt:r.last_active_at.getTime(),expiresAt:r.expires_at.getTime(),revokedAt:r.revoked_at?.getTime()??null,reauthAt:r.reauth_at?.getTime()??null},
    {id:r.actor_id,kind:r.kind,securityEpoch:r.current_security_epoch,disabled:r.disabled_at!==null},r.now.getTime(),'foreground',true);
}

test('real Auth publishes only public keys and public signup remains disabled',async()=>{
  const r=await fetch(`${service.issuer}/.well-known/jwks.json`);assert(r.ok,'public signing keys require no API credential');const jwks=await r.json();
  assert.equal(jwks.keys.length,1);assert.equal(jwks.keys[0].alg,'ES256');for(const field of ['d','k','p','q'])assert(!(field in jwks.keys[0]),'private key material must not be public');
  const sdk=service.sdk();const result=await sdk.signUp({email:`synthetic-${randomUUID()}@example.com`,password:randomBytes(32).toString('hex')});assert(result.error,'public signup must deny');
});
test('real password/TOTP, signed JWT, restricted DB reader and local app session prerequisites join without authorizing data',async()=>{
  const f=await provision(),material=await fresh(f);await cryptographicallyValid(material);
  const identity=await boundary.verifyAccess(access(material),bound(material));assert.equal(identity.state,'provider_verified');assert(identity.localSessionAndTenantVerificationRequired);
  assert.equal(await lookup(f.subject,identity.sessionId,signal()),true);
  const state=await localState(f,material);assert.equal((await local(state.session)).state,'locally_eligible');
  await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[state.session]);
  assert.equal((await local(state.session)).reason,'REVOKED');assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
  assert.throws(()=>JSON.stringify(material),/PROVIDER_AUTHENTICATION_FAILED/);
});
test('local security-epoch change invalidates app eligibility despite a still-valid real provider session',async()=>{
  const f=await provision(),material=await fresh(f),state=await localState(f,material);
  await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),state.actor]);
  assert.equal((await local(state.session)).state,'denied');assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
});
test('AAL1 and confirmed accounts without verified TOTP never produce provider evidence',async()=>{
  const f=await provision({enroll:false});const password=authResult(await f.sdk.signInWithPassword({email:f.email,password:f.password}),'password_only');
  const token=password.session.access_token,payload=decodeJwt(token);await denied(boundary.verifyAccess(token,{subject:f.subject,sessionId:payload.session_id}));
  await denied(boundary.authenticatePasswordTotp({email:f.email,password:f.password,factorId:randomUUID(),code:'123456'},{subject:f.subject}));
});
test('unconfirmed identity and incorrect password deny through the actual Auth API',async()=>{
  const f=await provision({confirmed:false});await denied(boundary.authenticatePasswordTotp({email:f.email,password:f.password,factorId:randomUUID(),code:'123456'},{subject:f.subject}));
  const verified=await provision();await denied(boundary.authenticatePasswordTotp({email:verified.email,password:'synthetic-wrong-password',factorId:verified.factorId,code:verified.totp.generate()},{subject:verified.subject}));
});
test('wrong TOTP, factor and durable subject clean up the new attempt without revoking another device',async()=>{
  const f=await provision(),material=await fresh(f);
  const credentials={email:f.email,password:f.password,factorId:f.factorId,code:wrongCode(f.totp)};
  await denied(boundary.authenticatePasswordTotp(credentials,{subject:f.subject}));
  await denied(boundary.authenticatePasswordTotp({...credentials,code:f.totp.generate(),factorId:randomUUID()},{subject:f.subject}));
  await denied(boundary.authenticatePasswordTotp({...credentials,code:f.totp.generate()},{subject:randomUUID()}));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1 AND aal='aal1'",[f.subject])).rows[0].n,0);
  assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
});
test('actual MFA challenges are single-use on sequential replay',async()=>{
  const f=await provision();const challenge=authResult(await f.sdk.mfa.challenge({factorId:f.factorId}),'challenge');
  const params={factorId:f.factorId,challengeId:challenge.id,code:f.totp.generate()};
  authResult(await f.sdk.mfa.verify(params),'challenge_verify');assert((await f.sdk.mfa.verify(params)).error,'replayed challenge must deny');
});
test('refresh rotates tokens while retaining the session and genuine password/TOTP times',async()=>{
  const f=await provision(),material=await fresh(f),sdk=service.sdk();authResult(await sdk.setSession({access_token:access(material),refresh_token:material.tokensForServerStorage().refreshToken}),'set_refresh_session');
  await delay(1100);const refreshed=authResult(await sdk.refreshSession(),'refresh').session;assert(refreshed,'real refresh must return session');
  assert(refreshed.refresh_token!==material.tokensForServerStorage().refreshToken,'refresh token must rotate');
  assert(decodeJwt(refreshed.access_token).iat>decodeJwt(access(material)).iat,'refresh must advance JWT issue time');
  const observed=await boundary.verifyAccess(refreshed.access_token,bound(material));
  assert.equal(observed.passwordAt,material.identity.passwordAt);assert.equal(observed.totpAt,material.identity.totpAt);assert.equal(observed.sessionId,material.identity.sessionId);
});
test('two actual device sessions coexist; local provider logout revokes only the selected device and its refresh',async()=>{
  const f=await provision(),a=await fresh(f),b=await fresh(f);assert(a.identity.sessionId!==b.identity.sessionId,'devices need different sessions');
  authResult(await service.admin.admin.signOut(access(a),'local'),'local_logout');await cryptographicallyValid(a);
  assert.equal(await lookup(f.subject,a.identity.sessionId,signal()),false);await denied(boundary.verifyAccess(access(a),bound(a)));
  assert.equal((await boundary.verifyAccess(access(b),bound(b))).state,'provider_verified');
  assert((await service.sdk().refreshSession({refresh_token:a.tokensForServerStorage().refreshToken})).error,'revoked refresh must deny');
});
test('administrator factor removal downgrades associated sessions even while a second verified factor remains',async()=>{
  const f=await provision({backup:true}),material=await fresh(f);
  authResult(await service.admin.admin.mfa.deleteFactor({userId:f.subject,id:f.factorId}),'factor_delete');await cryptographicallyValid(material);
  const profile=authResult(await service.sdk().getUser(access(material)),'backup_factor_profile').user;
  assert(profile.factors.some(factor=>factor.id===f.secondary.factorId&&factor.status==='verified'),'backup factor remains verified');
  assert.equal((await client.query('SELECT aal FROM auth.sessions WHERE id=$1',[material.identity.sessionId])).rows[0].aal,'aal1');
  assert.equal(await lookup(f.subject,material.identity.sessionId,signal()),false);await denied(boundary.verifyAccess(access(material),bound(material)));
});
test('provider ban rejects existing JWTs through online user verification',async()=>{
  const f=await provision(),material=await fresh(f);authResult(await service.admin.admin.updateUserById(f.subject,{ban_duration:'1h'}),'ban');
  await cryptographicallyValid(material);await denied(boundary.verifyAccess(access(material),bound(material)));
});
test('provider account deletion preserves the durable app actor while denying its formerly valid session',async()=>{
  const f=await provision(),material=await fresh(f),state=await localState(f,material);authResult(await service.admin.admin.deleteUser(f.subject),'delete_user');
  await cryptographicallyValid(material);await denied(boundary.verifyAccess(access(material),bound(material)));
  assert.equal((await client.query('SELECT auth_user_id FROM crest_private.actors WHERE id=$1',[state.actor])).rows[0].auth_user_id,f.subject);
});
test('a database lookup outage denies an otherwise valid real Auth session',async()=>{
  const f=await provision(),material=await fresh(f),db=new URL(runtimeUrl);db.port='1';
  const unavailable=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup({connectionString:db.toString(),environment:'test'}));
  await denied(unavailable.verifyAccess(access(material),bound(material)));
});
test('Auth outage denies despite cached public keys and recovers with a new online check',async()=>{
  const f=await provision(),material=await fresh(f);await boundary.verifyAccess(access(material),bound(material));await service.stop();
  try{await denied(boundary.verifyAccess(access(material),bound(material)));}finally{await service.restart();}
  assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
});
