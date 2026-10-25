import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {request as nodeRequest} from 'node:http';
import { TOTP,URI } from 'otpauth';
import { createRemoteJWKSet,decodeJwt,jwtVerify } from 'jose';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { startRealAuthService,authResult } from '../support/real-auth-service.mjs';
import { createProviderBoundary,ProviderAuthenticationError } from '../../src/security/provider-auth.ts';
import { createLiveProviderSessionLookup } from '../../src/security/provider-session-db.ts';
import { localSessionEligibility } from '../../src/security/session-policy.ts';
import { createProviderTokenStore,ProviderTokenStorageError } from '../../src/security/provider-token-store.ts';
import { createSessionCredential } from '../../src/security/session-credential.ts';
import { createSessionRevoker } from '../../src/security/session-revocation-db.ts';
import { createSessionLifecycle,SessionLifecycleError } from '../../src/security/session-lifecycle.ts';
import {createBrowserSessionFlow,BrowserSessionError} from '../../src/security/browser-session-flow.ts';
import {createLoginFingerprinter} from '../../src/security/login-admission.ts';
import {createCsrfToken} from '../../src/security/request-protection.ts';
import {createTenantContextReader,TenantReadError} from '../../src/security/tenant-read.ts';
import {createBusinessSettingsContextReader,BusinessSettingsContextError} from '../../src/security/business-settings-context.ts';
import {createBusinessNameCommand,BusinessNameCommandError} from '../../src/security/business-name-command.ts';
import {createBusinessOperationLookup,BusinessOperationLookupError} from '../../src/security/business-operation-lookup.ts';
import {createMutationTransaction,MutationBoundaryError} from '../../src/security/mutation-transaction.ts';
import {verifyProviderRecoveryEvidenceCollection} from '../../src/security/provider-recovery-evidence-verification.ts';
import {verifySessionRecoveryEvidence} from '../../src/security/session-metadata-evidence.ts';
import {verifyBusinessHistoryEvidence} from '../../src/security/business-history-evidence.ts';
import {verifyBusinessIdentityEvidence} from '../../src/security/business-identity-evidence.ts';
import {verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence.ts';
import {createBrowserBodyReader,readBrowserCookies,loginContextResponse,loginResponse,sessionResponse,logoutResponse,BrowserHttpError} from '../../src/security/browser-http.ts';
import {createSessionRequestAdmission,SessionAdmissionError} from '../../src/security/session-request-admission.ts';
import {authenticationServer} from '../support/authentication-server.mjs';

let sandbox,client,target,service,lookup,boundary,login,loginOwned=false,runtimeUrl,keys,revoke,lifecycle,store,prior,receipt,refreshReceipt,refreshGrants,currentReceipt,browserReceipt,admissionReceipt,tenantReceipt,fenceReceipt,storageReceipt,lookupReceipt,renameReceipt,settingsReceipt,cleanupReceipt,inventoryReceipt,evidenceReceipt,attemptsReceipt,targetsReceipt,finishReceipt,requestReceipt,executorReceipt,reviewReceipt,exportReceipt,referenceReceipt,configurationReceipt,historyReceipt,identityReceipt,metadataReceipt,customerReceipt,roundtripReceipt,addressReceipt,vehicleReceipt,associationReceipt,leadReceipt,leadStateReceipt,leadVehicleReceipt,upgradeProof,upgradeContext,legacy,legacyBefore,leadAddressReceipt;
const signal=()=>new AbortController().signal;
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(5));
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();
  lookup=createLiveProviderSessionLookup({connectionString:runtimeUrl,environment:'test'});
  revoke=createSessionRevoker({connectionString:runtimeUrl,environment:'test'});
  service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},lookup);
  keys=createRemoteJWKSet(new URL(`${service.issuer}/.well-known/jwks.json`),{headers:{apikey:service.publicKey}});
  // Existing synthetic schema5 app state, retained across the schema6 upgrade.
  legacy=await localState({subject:randomUUID()},{identity:{passwordAt:Date.now()-1000,totpAt:Date.now()-1000,sessionId:randomUUID()}});
  legacyBefore=(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].row;
  receipt=await sandbox.apply(target,await sandbox.prefix(6));
  refreshReceipt=await sandbox.apply(target,await sandbox.prefix(7));
  refreshGrants=(await client.query("SELECT attname,has_column_privilege('crest_session_owner',attrelid,attnum,'UPDATE') AS allowed FROM pg_attribute WHERE attrelid='crest_private.app_sessions'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attname")).rows;
  currentReceipt=await sandbox.apply(target,await sandbox.prefix(8));
  browserReceipt=await sandbox.apply(target,await sandbox.prefix(9));
  upgradeProof=(await client.query('INSERT INTO crest_private.session_csrf_tokens(session_id,token_hash) VALUES($1,$2) RETURNING to_jsonb(session_csrf_tokens) AS row',[legacy.session,randomBytes(32)])).rows[0].row;
  upgradeContext=(await client.query("WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp) INSERT INTO crest_private.login_contexts(id,credential_hash,ip_hash,csrf_hash,created_at,expires_at) SELECT gen_random_uuid(),$1,$2,$3,stamp,stamp+interval '10 minutes' FROM moment RETURNING to_jsonb(login_contexts) AS row",[randomBytes(32),randomBytes(32),randomBytes(32)])).rows[0].row;
  admissionReceipt=await sandbox.apply(target,await sandbox.prefix(10));tenantReceipt=await sandbox.apply(target,await sandbox.prefix(11));fenceReceipt=await sandbox.apply(target,await sandbox.prefix(12));storageReceipt=await sandbox.apply(target,await sandbox.prefix(13));lookupReceipt=await sandbox.apply(target,await sandbox.prefix(14));renameReceipt=await sandbox.apply(target,await sandbox.prefix(15));settingsReceipt=await sandbox.apply(target,await sandbox.prefix(16));cleanupReceipt=await sandbox.apply(target,await sandbox.prefix(17));inventoryReceipt=await sandbox.apply(target,await sandbox.prefix(18));evidenceReceipt=await sandbox.apply(target,await sandbox.prefix(19));attemptsReceipt=await sandbox.apply(target,await sandbox.prefix(20));targetsReceipt=await sandbox.apply(target,await sandbox.prefix(21));finishReceipt=await sandbox.apply(target,await sandbox.prefix(22));requestReceipt=await sandbox.apply(target,await sandbox.prefix(23));executorReceipt=await sandbox.apply(target,await sandbox.prefix(24));reviewReceipt=await sandbox.apply(target,await sandbox.prefix(25));exportReceipt=await sandbox.apply(target,await sandbox.prefix(26));referenceReceipt=await sandbox.apply(target,await sandbox.prefix(27));configurationReceipt=await sandbox.apply(target,await sandbox.prefix(28));historyReceipt=await sandbox.apply(target,await sandbox.prefix(29));identityReceipt=await sandbox.apply(target,await sandbox.prefix(30));metadataReceipt=await sandbox.apply(target,await sandbox.prefix(31));customerReceipt=await sandbox.apply(target,await sandbox.prefix(32));roundtripReceipt=await sandbox.apply(target,await sandbox.prefix(33));addressReceipt=await sandbox.apply(target,await sandbox.prefix(34));vehicleReceipt=await sandbox.apply(target,await sandbox.prefix(35));associationReceipt=await sandbox.apply(target,await sandbox.prefix(36));leadReceipt=await sandbox.apply(target,await sandbox.prefix(37));leadStateReceipt=await sandbox.apply(target,await sandbox.prefix(38));leadVehicleReceipt=await sandbox.apply(target,await sandbox.prefix(39));leadAddressReceipt=await sandbox.apply(target);
  store=await createProviderTokenStore('primary',[{id:'primary',key:randomBytes(32)}]);
  lifecycle=createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},boundary,store);
});
after(async()=>{await service?.close();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
async function retainedInventory(actor,id=randomUUID()){
  const c=await sandbox.connect(target);await c.query('BEGIN');try{await c.query('SET LOCAL ROLE crest_inventory');const result=(await c.query('SELECT crest_commands.record_provider_inventory($1,$2,$3,NULL,100) AS result',[id,actor.id,service.issuer])).rows[0].result;await c.query('COMMIT');return result;}finally{await c.query('ROLLBACK');await c.end();}
}
async function providerInventory(actor){
  const c=await sandbox.connect(target);await c.query('BEGIN READ ONLY');try{await c.query('SET LOCAL ROLE crest_inventory');return (await c.query('SELECT * FROM crest_commands.provider_session_inventory($1,$2,NULL,100)',[actor.id,service.issuer])).rows;}finally{await c.query('ROLLBACK');await c.end();}
}
async function cleanupRequest(actor,finishId){
  const c=await sandbox.connect(target);await c.query('BEGIN');try{await c.query('SET LOCAL ROLE crest_inventory');const r=(await c.query('SELECT crest_commands.request_provider_cleanup($1,$2,$3,$4) AS result',[randomUUID(),finishId,actor.id,service.issuer])).rows[0].result;await c.query('COMMIT');assert.equal(r.evidence.state,'pending_review');assert.equal(createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex'),r.evidenceHash);return r;}finally{await c.query('ROLLBACK');await c.end();}
}
async function executeCleanup(actor,requestId){
 const c=await sandbox.connect(target);try{await c.query('SET ROLE crest_cleanup');const r=(await c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3) AS result',[requestId,actor.id,service.issuer])).rows[0].result;assert.equal(createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex'),r.evidenceHash);return r;}finally{await c.end();}
}
async function denied(work){await assert.rejects(work,e=>e instanceof ProviderAuthenticationError&&e.message==='PROVIDER_AUTHENTICATION_FAILED'&&e.cause===undefined);}
async function provision({confirmed=true,enroll=true,backup=false,provider=service}={}) {
  const email=`synthetic-${randomUUID()}@example.com`,password=randomBytes(32).toString('base64url');
  const user=authResult(await provider.admin.admin.createUser({email,password,email_confirm:confirmed}),'provision').user;
  assert(user?.id,'provider must return a durable subject');const sdk=provider.sdk();await sdk.initialize();
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
async function linkActor(fixture,issuer=service.issuer){
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query('BEGIN');let actor;
  try {
    actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic Auth owner',$1,$2,$3,$3,'manual') RETURNING *",[issuer,fixture.subject,bootstrap])).rows[0];
    const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic Auth business','UTC',$1,$1,'manual') RETURNING id",[actor.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor.id]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor.id]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  return actor;
}
async function localState(fixture,material){
  const actor=await linkActor(fixture);
  const authAt=new Date(Math.min(material.identity.passwordAt,material.identity.totpAt)),credential=createSessionCredential();
  const session=(await client.query("WITH moment AS (SELECT date_trunc('milliseconds',clock_timestamp()) AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,created_by,updated_by) SELECT $1,$2,$3,$4,stamp,$5,stamp,stamp+interval '12 hours',false,$1,$1 FROM moment RETURNING id",[actor.id,material.identity.sessionId,credential.hashForDatabase(),actor.current_security_epoch,authAt])).rows[0].id;
  return {actor:actor.id,session,credential};
}
const issue=(f,trusted=false,gate=lifecycle)=>gate.login({email:f.email,password:f.password,factorId:f.factorId,code:f.totp.generate()},{subject:f.subject},trusted,signal());
async function lifecycleDenied(work){await assert.rejects(work,e=>e instanceof SessionLifecycleError&&e.message==='SESSION_LIFECYCLE_FAILED'&&e.cause===undefined);}
async function asWeb(work){await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_web');return await work();}finally{await client.query('ROLLBACK');}}
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
  await revoke(state.credential.cookieValueForResponse(),signal());
  assert.equal((await local(state.session)).reason,'REVOKED');assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
  assert.throws(()=>JSON.stringify(material),/PROVIDER_AUTHENTICATION_FAILED/);
});
test('local security-epoch change invalidates app eligibility despite a still-valid real provider session',async()=>{
  const f=await provision(),material=await fresh(f),state=await localState(f,material);
  await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),state.actor]);
  assert.equal((await local(state.session)).state,'denied');assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
});

test('real provider tokens survive encrypted database storage and key rotation; row swaps and revocation deny',async()=>{
  const f=await provision(),material=await fresh(f),state=await localState(f,material);
  const row=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[state.session])).rows[0];
  const binding={actorId:state.actor,appSessionId:state.session,providerSessionId:row.provider_session_id,securityEpoch:row.issued_security_epoch,subject:f.subject,issuer:service.issuer};
  const first=randomBytes(32),second=randomBytes(32),store=await createProviderTokenStore('first',[{id:'first',key:first}]);
  const encrypted=await store.encrypt(material.tokensForServerStorage(),binding);
  const persist=async record=>client.query('UPDATE crest_private.app_sessions SET provider_token_ciphertext=$1,key_id=$2,version=version+1 WHERE id=$3',[Buffer.from(record.ciphertext),record.keyId,state.session]);
  await persist(encrypted);
  const load=async()=>{const r=(await client.query('SELECT provider_token_ciphertext,key_id FROM crest_private.app_sessions WHERE id=$1',[state.session])).rows[0];return {ciphertext:r.provider_token_ciphertext,keyId:r.key_id};};
  const saved=await load();assert(Buffer.isBuffer(saved.ciphertext));assert(!saved.ciphertext.includes(Buffer.from(access(material))));assert(!saved.ciphertext.includes(Buffer.from(material.tokensForServerStorage().refreshToken)));
  const restored=(await store.decrypt(saved,binding)).tokensForProvider();assert.equal(restored.refreshToken,material.tokensForServerStorage().refreshToken);
  assert.equal((await boundary.verifyAccess(restored.accessToken,bound(material))).state,'provider_verified');assert.equal((await local(state.session)).state,'locally_eligible');
  await assert.rejects(store.decrypt(saved,{...binding,appSessionId:randomUUID()}),ProviderTokenStorageError);
  const rotated=await createProviderTokenStore('second',[{id:'first',key:first},{id:'second',key:second}]);
  await persist(await rotated.encrypt((await rotated.decrypt(saved,binding)).tokensForProvider(),binding));
  const current=await load();assert.equal(current.keyId,'second');await assert.rejects(store.decrypt(current,binding),ProviderTokenStorageError);
  const updated=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[state.session])).rows[0];
  for(const field of ['created_at','authenticated_at','expires_at','last_active_at'])assert.equal(updated[field].getTime(),row[field].getTime());
  const events=JSON.stringify((await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1',[state.session])).rows);
  for(const secret of [access(material),restored.refreshToken,'provider_token_ciphertext','key_id'])assert(!events.includes(secret),'audit projection excludes provider secrets and storage metadata');
  await revoke(state.credential.cookieValueForResponse(),signal());
  const cleared=await load();assert.equal(cleared.ciphertext,null);assert.equal(cleared.keyId,null);await assert.rejects(rotated.decrypt(cleared,binding),ProviderTokenStorageError);
  assert.equal((await local(state.session)).reason,'REVOKED');
  // A stale ciphertext copy can still decrypt: current database revocation must
  // be checked for every request. Encryption never confers session authority.
  assert.equal((await rotated.decrypt(current,binding)).tokensForProvider().accessToken,restored.accessToken);
});
test('AAL1 and confirmed accounts without verified TOTP never produce provider evidence',async()=>{
  const f=await provision({enroll:false});const password=authResult(await f.sdk.signInWithPassword({email:f.email,password:f.password}),'password_only');
  const token=password.session.access_token,payload=decodeJwt(token),actor=await linkActor(f);const observation=(await providerInventory(actor)).find(r=>r.provider_session_id===payload.session_id);assert(observation);assert.equal(observation.provider_aal,'aal1');assert.equal(observation.app_session_id,null);assert.equal(observation.cleanup_reference_id,null);const saved=await retainedInventory(actor);assert.equal(saved.evidence.observations.find(r=>r.provider_session_id===payload.session_id).classification,'unregistered_review');assert.deepEqual(await retainedInventory(actor,saved.evidence.requestId),saved);await denied(boundary.verifyAccess(token,{subject:f.subject,sessionId:payload.session_id}));
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
  const f=await provision(),material=await fresh(f),state=await localState(f,material);await boundary.verifyAccess(access(material),bound(material));await service.stop();
  try{await denied(boundary.verifyAccess(access(material),bound(material)));await revoke(state.credential.cookieValueForResponse(),signal());assert.equal((await local(state.session)).reason,'REVOKED');}finally{await service.restart();}
  assert.equal((await boundary.verifyAccess(access(material),bound(material))).state,'provider_verified');
  assert.equal((await local(state.session)).reason,'REVOKED');
});

test('schema5 upgrade retains existing local rows and append-only CLI history',async()=>{
  assert.equal(prior.history.length,5);assert.equal(receipt.history.length,6);assert.deepEqual(receipt.history.slice(0,5),prior.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].row,legacyBefore);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_events WHERE session_id=$1',[legacy.session])).rows[0].n,1);
  assert.equal(refreshReceipt.history.length,7);assert.deepEqual(refreshReceipt.history.slice(0,6),receipt.history);
  assert.equal(currentReceipt.history.length,8);assert.deepEqual(currentReceipt.history.slice(0,7),refreshReceipt.history);
  assert.equal(browserReceipt.history.length,9);assert.deepEqual(browserReceipt.history.slice(0,8),currentReceipt.history);
  assert.equal(admissionReceipt.history.length,10);assert.deepEqual(admissionReceipt.history.slice(0,9),browserReceipt.history);
  assert.equal(tenantReceipt.history.length,11);assert.deepEqual(tenantReceipt.history.slice(0,10),admissionReceipt.history);
  assert.equal(fenceReceipt.history.length,12);assert.deepEqual(fenceReceipt.history.slice(0,11),tenantReceipt.history);
  assert.equal(storageReceipt.history.length,13);assert.deepEqual(storageReceipt.history.slice(0,12),fenceReceipt.history);
  assert.equal(lookupReceipt.history.length,14);assert.deepEqual(lookupReceipt.history.slice(0,13),storageReceipt.history);
  assert.equal(renameReceipt.history.length,15);assert.deepEqual(renameReceipt.history.slice(0,14),lookupReceipt.history);
  assert.equal(settingsReceipt.history.length,16);assert.deepEqual(settingsReceipt.history.slice(0,15),renameReceipt.history);
  assert.equal(cleanupReceipt.history.length,17);assert.deepEqual(cleanupReceipt.history.slice(0,16),settingsReceipt.history);
  assert.equal(inventoryReceipt.history.length,18);assert.deepEqual(inventoryReceipt.history.slice(0,17),cleanupReceipt.history);
  assert.equal(evidenceReceipt.history.length,19);assert.deepEqual(evidenceReceipt.history.slice(0,18),inventoryReceipt.history);
  assert.equal(attemptsReceipt.history.length,20);assert.deepEqual(attemptsReceipt.history.slice(0,19),evidenceReceipt.history);
  assert.equal(targetsReceipt.history.length,21);assert.deepEqual(targetsReceipt.history.slice(0,20),attemptsReceipt.history);
  assert.equal(executorReceipt.history.length,24);assert.deepEqual(executorReceipt.history.slice(0,23),requestReceipt.history);assert.equal(requestReceipt.history.length,23);assert.deepEqual(requestReceipt.history.slice(0,22),finishReceipt.history);assert.equal(finishReceipt.history.length,22);assert.deepEqual(finishReceipt.history.slice(0,21),targetsReceipt.history);
  assert.equal(reviewReceipt.history.length,25);assert.deepEqual(reviewReceipt.history.slice(0,24),executorReceipt.history);assert.equal(exportReceipt.history.length,26);assert.deepEqual(exportReceipt.history.slice(0,25),reviewReceipt.history);assert.equal(referenceReceipt.history.length,27);assert.deepEqual(referenceReceipt.history.slice(0,26),exportReceipt.history);assert.equal(configurationReceipt.history.length,28);assert.deepEqual(configurationReceipt.history.slice(0,27),referenceReceipt.history);assert.equal(historyReceipt.history.length,29);assert.deepEqual(historyReceipt.history.slice(0,28),configurationReceipt.history);assert.equal(identityReceipt.history.length,30);assert.deepEqual(identityReceipt.history.slice(0,29),historyReceipt.history);assert.equal(metadataReceipt.history.length,31);assert.deepEqual(metadataReceipt.history.slice(0,30),identityReceipt.history);assert.equal(customerReceipt.history.length,32);assert.deepEqual(customerReceipt.history.slice(0,31),metadataReceipt.history);assert.equal(roundtripReceipt.history.length,33);assert.deepEqual(roundtripReceipt.history.slice(0,32),customerReceipt.history);assert.equal(addressReceipt.history.length,34);assert.deepEqual(addressReceipt.history.slice(0,33),roundtripReceipt.history);assert.equal(vehicleReceipt.history.length,35);assert.deepEqual(vehicleReceipt.history.slice(0,34),addressReceipt.history);assert.equal(associationReceipt.history.length,36);assert.deepEqual(associationReceipt.history.slice(0,35),vehicleReceipt.history);assert.equal(leadReceipt.history.length,37);assert.deepEqual(leadReceipt.history.slice(0,36),associationReceipt.history);assert.equal(leadStateReceipt.history.length,38);assert.deepEqual(leadStateReceipt.history.slice(0,37),leadReceipt.history);assert.equal(leadVehicleReceipt.history.length,39);assert.deepEqual(leadVehicleReceipt.history.slice(0,38),leadStateReceipt.history);assert.equal(leadAddressReceipt.history.length,40);assert.deepEqual(leadAddressReceipt.history.slice(0,39),leadVehicleReceipt.history);assert.deepEqual((await sandbox.apply(target)).history,leadAddressReceipt.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(c) AS row FROM crest_private.session_csrf_tokens c WHERE id=$1',[upgradeProof.id])).rows[0].row,upgradeProof);
  assert.deepEqual((await client.query('SELECT to_jsonb(c) AS row FROM crest_private.login_contexts c WHERE id=$1',[upgradeContext.id])).rows[0].row,upgradeContext);
});

test('real password/TOTP and fresh SDK evidence join exact tenant membership without exporting reusable authority',async()=>{
  const f=await provision(),actor=await linkActor(f),issued=await issue(f),business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  const read=createTenantContextReader({connectionString:runtimeUrl,environment:'test'},boundary,store),before=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[issued.evidence.sessionId])).rows[0];
  const context=await read(issued.cookieValueForResponse(),business,signal());assert.throws(()=>JSON.stringify(context),TenantReadError);
  assert.deepEqual(context.forServer(),{actorId:actor.id,businessId:business,currency:'USD',timezone:'UTC'});
  const after=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[issued.evidence.sessionId])).rows[0];
  for(const field of ['authenticated_at','last_active_at','expires_at'])assert.equal(after[field].getTime(),before[field].getTime());assert.equal(after.version,before.version);
  await assert.rejects(read(issued.cookieValueForResponse(),randomUUID(),signal()),e=>e instanceof TenantReadError&&e.cause===undefined);
  authResult(await service.admin.admin.signOut((await store.decrypt({keyId:after.key_id,ciphertext:after.provider_token_ciphertext},
    {actorId:actor.id,appSessionId:after.id,providerSessionId:after.provider_session_id,securityEpoch:after.issued_security_epoch,subject:f.subject,issuer:service.issuer})).tokensForProvider().accessToken,'local'),'tenant_selected_logout');
  await assert.rejects(read(issued.cookieValueForResponse(),business,signal()),e=>e instanceof TenantReadError&&e.cause===undefined);
});

test('membership change after genuine SDK verification is reread by the guarded tenant routine',async()=>{
  const f=await provision(),actor=await linkActor(f),issued=await issue(f),business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const backup=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic tenant backup',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,randomUUID(),bootstrap])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,backup,actor.id]);
  let changed=false;const provider={...boundary,async verifyAccess(...args){const result=await boundary.verifyAccess(...args);if(!changed){changed=true;await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[business,actor.id]);}return result;}};
  const read=createTenantContextReader({connectionString:runtimeUrl,environment:'test'},provider,store);
  await assert.rejects(read(issued.cookieValueForResponse(),business,signal()),e=>e instanceof TenantReadError&&e.message==='TENANT_READ_FAILED'&&e.cause===undefined);
  assert(changed,'real SDK verification barrier must execute');
});
test('issuance owner and functions retain forced RLS, lock-only identity rights and no runtime table exposure',async()=>{
  const role=(await client.query("SELECT * FROM pg_roles WHERE rolname='crest_session_owner'")).rows[0];
  for(const field of ['rolcanlogin','rolinherit','rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication'])assert.equal(role[field],false);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid=$1 OR member=$1',[role.oid])).rows[0].n,0);
  for(const schema of ['crest','crest_private','crest_commands','auth','public'])assert.equal((await client.query("SELECT has_schema_privilege('crest_session_owner',$1,'CREATE') AS allowed",[schema])).rows[0].allowed,false);
  for(const table of ['auth.users','auth.sessions','auth.refresh_tokens','crest_private.identity_events','crest_private.business_recovery_authorities'])assert.equal((await client.query("SELECT has_table_privilege('crest_session_owner',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
  const policies=(await client.query("SELECT pg_get_expr(polwithcheck,polrelid) AS check FROM pg_policy WHERE polname IN ('session_actor_lock','session_business_lock')")).rows;assert.equal(policies.length,2);assert(policies.every(p=>p.check==='false'));
  await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_session_owner');await assert.rejects(client.query('UPDATE crest_private.actors SET id=id WHERE id=$1',[legacy.actor]),e=>['42501','23514'].includes(e.code));}finally{await client.query('ROLLBACK');}
  for(const fn of ['session_actor_context(text,uuid)','issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)','app_session_snapshot(bytea)']){
    const f=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[`crest_commands.${fn}`])).rows[0];assert(f.prosecdef);assert.equal(f.owner,'crest_session_owner');assert.deepEqual(f.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
    for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_command_owner','crest_auth_reader'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,`crest_commands.${fn}`])).rows[0].allowed,false);
  }
  await asWeb(async()=>{await assert.rejects(client.query('SELECT * FROM crest_private.app_sessions'),e=>e.code==='42501');});
});
test('actual password/TOTP login issues hashed opaque material with encrypted tokens and exact untrusted lifetime',async()=>{
  const f=await provision(),actor=await linkActor(f);let marker;
  const tracked={...boundary,authenticatePasswordTotp:async(...args)=>{
    const rows=(await client.query('SELECT * FROM crest_private.provider_login_attempts WHERE actor_id=$1',[actor.id])).rows;assert.equal(rows.length,1);marker=rows[0];
    assert.equal(marker.issued_security_epoch,actor.current_security_epoch);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[marker.reserved_app_session_id])).rows[0].n,0);
    const [input,binding,signal,observe]=args;assert.equal(typeof observe,'function');
    return boundary.authenticatePasswordTotp(input,binding,signal,async(reference,currentSignal)=>{
      await observe(reference,currentSignal);
      const t=(await client.query('SELECT * FROM crest_private.provider_login_targets WHERE attempt_id=$1',[marker.attempt_id])).rows[0];
      assert(t);assert.equal(t.provider_session_id,reference.sessionId);assert.equal(t.password_at.getTime(),reference.passwordAt);
      assert.equal((await client.query('SELECT aal FROM auth.sessions WHERE id=$1',[reference.sessionId])).rows[0].aal,'aal1');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[marker.reserved_app_session_id])).rows[0].n,0);
    });
  }};
  const issued=await issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},tracked,store)),cookie=issued.cookieValueForResponse();
  assert.equal(issued.evidence.sessionId,marker.reserved_app_session_id);
  assert.equal((await client.query("SELECT operation_id FROM crest_private.session_events WHERE session_id=$1 AND action='CREATED'",[issued.evidence.sessionId])).rows[0].operation_id,marker.attempt_id);
  assert.throws(()=>JSON.stringify(issued),SessionLifecycleError);assert.equal(Buffer.from(cookie,'base64url').length,32);
  const row=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[issued.evidence.sessionId])).rows[0];
  assert.equal(row.actor_id,actor.id);assert(!row.token_hash.includes(Buffer.from(cookie)));assert(row.provider_token_ciphertext);assert.equal(row.key_id,'primary');
  assert.equal(row.expires_at.getTime()-row.created_at.getTime(),12*60*60*1000);assert.equal(issued.evidence.expiresAt,row.expires_at.getTime());
  assert.equal(issued.evidence.state,'session_verified');assert(issued.evidence.tenantAndRequestVerificationRequired);
  const evidence=await lifecycle.verify(cookie,signal(),'background',true);assert.equal(evidence.foregroundActivityAt,null);assert.equal(evidence.provider.subject,f.subject);
  const audit=JSON.stringify((await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1',[row.id])).rows);for(const omitted of [cookie,'token_hash','provider_token_ciphertext'])assert(!audit.includes(omitted));
});
test('two issued devices coexist with exact trusted lifetime; verification proposes activity without writing it',async()=>{
  const f=await provision();await linkActor(f);const a=await issue(f,true),b=await issue(f,true);assert.notEqual(a.evidence.sessionId,b.evidence.sessionId);
  const before=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[b.evidence.sessionId])).rows[0];assert.equal(before.expires_at.getTime()-before.created_at.getTime(),720*60*60*1000);
  const evidence=await lifecycle.verify(b.cookieValueForResponse(),signal(),'foreground',true);assert(Number.isSafeInteger(evidence.foregroundActivityAt));
  const after=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[b.evidence.sessionId])).rows[0];assert.equal(after.version,before.version);assert.equal(after.last_active_at.getTime(),before.last_active_at.getTime());
  await revoke(a.cookieValueForResponse(),signal());await lifecycleDenied(lifecycle.verify(a.cookieValueForResponse(),signal()));assert.equal((await lifecycle.verify(b.cookieValueForResponse(),signal())).sessionId,b.evidence.sessionId);
});
test('a valid provider user without a linked owner never receives an app session or automatic membership',async()=>{
  const f=await provision(),before=(await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions')).rows[0].n;
  await lifecycleDenied(issue(f));assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions')).rows[0].n,before);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.actors WHERE auth_user_id=$1',[f.subject])).rows[0].n,0);
});
test('live security-epoch changes deny retrieval without a cached positive decision',async()=>{
  const f=await provision(),actor=await linkActor(f),issued=await issue(f);await lifecycle.verify(issued.cookieValueForResponse(),signal());
  await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),actor.id]);await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
});
test('disabled actors deny retrieval even while provider identity and another local owner remain valid',async()=>{
  const f=await provision(),actor=await linkActor(f),issued=await issue(f),bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const backup=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic backup',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,randomUUID(),bootstrap])).rows[0].id;
  const business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,backup,actor.id]);
  await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[actor.id]);await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
});
test('provider logout invalidates issued local evidence despite a still-signed access JWT',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),row=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[issued.evidence.sessionId])).rows[0];
  const binding={actorId:row.actor_id,appSessionId:row.id,providerSessionId:row.provider_session_id,securityEpoch:row.issued_security_epoch,subject:f.subject,issuer:service.issuer};
  const access=(await store.decrypt({keyId:row.key_id,ciphertext:row.provider_token_ciphertext},binding)).tokensForProvider().accessToken;
  authResult(await service.admin.admin.signOut(access,'local'),'issued_local_signout');await jwtVerify(access,keys,{algorithms:['ES256'],issuer:service.issuer,audience:'authenticated'});
  await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
});
test('ciphertext substitution between issued sessions fails before it can establish evidence',async()=>{
  const f=await provision(),g=await provision();await linkActor(f);await linkActor(g);const a=await issue(f),b=await issue(g);
  await client.query('UPDATE crest_private.app_sessions SET provider_token_ciphertext=(SELECT provider_token_ciphertext FROM crest_private.app_sessions WHERE id=$1),version=version+1 WHERE id=$2',[a.evidence.sessionId,b.evidence.sessionId]);
  await lifecycleDenied(lifecycle.verify(b.cookieValueForResponse(),signal()));assert.equal((await lifecycle.verify(a.cookieValueForResponse(),signal())).sessionId,a.evidence.sessionId);
});
test('revocation committed during real provider verification is caught by the final database reread',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f);let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  // Synchronization wraps the real lookup; it never supplies a fake result.
  const gate=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},async(subject,session,signal)=>{const live=await lookup(subject,session,signal);entered();await held;return live;});
  const racing=createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store),pending=racing.verify(issued.cookieValueForResponse(),signal()),result=lifecycleDenied(pending);
  try{await Promise.race([ready,delay(5000).then(()=>{throw new Error('real lookup barrier was not reached');})]);await revoke(issued.cookieValueForResponse(),signal());}finally{release();}
  await result;
});
test('unknown/wrong encryption keys fail closed while the original valid session remains unchanged',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),wrong=await createProviderTokenStore('primary',[{id:'primary',key:randomBytes(32)}]);
  await lifecycleDenied(createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},boundary,wrong).verify(issued.cookieValueForResponse(),signal()));
  assert.equal((await lifecycle.verify(issued.cookieValueForResponse(),signal())).sessionId,issued.evidence.sessionId);
});
test('direct SQL rejects stale epoch/provider identity, malformed hash and stale/future authentication times',async()=>{
  const f=await provision(),actor=await linkActor(f),attempt=(await client.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),service.issuer,f.subject])).rows[0].result;
  const material=await boundary.authenticatePasswordTotp({email:f.email,password:f.password,factorId:f.factorId,code:f.totp.generate()},{subject:f.subject},signal(),async reference=>{
    await client.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8)',[attempt.attemptId,actor.id,attempt.securityEpoch,service.issuer,f.subject,reference.sessionId,new Date(reference.passwordAt),new Date(reference.expiresAt)]);
  }),credential=createSessionCredential(),id=attempt.appSessionId;
  const encrypted=await store.encrypt(material.tokensForServerStorage(),{actorId:actor.id,appSessionId:id,securityEpoch:actor.current_security_epoch,providerSessionId:material.identity.sessionId,subject:f.subject,issuer:service.issuer});
  const args=[id,credential.hashForDatabase(),actor.id,actor.current_security_epoch,service.issuer,f.subject,material.identity.sessionId,new Date(material.identity.passwordAt),new Date(material.identity.totpAt),false,Buffer.from(encrypted.ciphertext),encrypted.keyId,attempt.attemptId];
  const sql='SELECT crest_commands.issue_open_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)';
  for(const [index,value] of [[3,randomUUID()],[5,randomUUID()],[6,randomUUID()],[1,Buffer.alloc(31)],[7,new Date(Date.now()-16*60*1000)],[8,new Date(Date.now()+60000)],[9,null]]){
    const altered=[...args];altered[index]=value;await asWeb(async()=>{await assert.rejects(client.query(sql,altered),e=>['42501','22023'].includes(e.code));});
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query(sql,args),e=>e.code==='25001');}finally{await client.query('ROLLBACK');}
  await asWeb(async()=>{await client.query(sql,args);});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[id])).rows[0].n,0);
});
test('a committed stop rejects a delayed genuine MFA result without issuing a session or affecting another device',async()=>{
  const f=await provision(),actor=await linkActor(f),other=await issue(f);let entered,release;
  const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const gate={...boundary,authenticatePasswordTotp:async(...args)=>{const material=await boundary.authenticatePasswordTotp(...args);entered();await held;return material;}};
  const result=lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));let attempt;
  try{await atBarrier(ready);attempt=(await client.query('SELECT * FROM crest_private.provider_login_attempts WHERE actor_id=$1 AND reserved_app_session_id<>$2',[actor.id,other.evidence.sessionId])).rows[0];assert(attempt);
    const c=await sandbox.connect(runtimeUrl);try{await c.query('SET ROLE crest_web');const r=(await c.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[attempt.attempt_id,actor.id,attempt.issued_security_epoch,service.issuer,f.subject,'stopped_review'])).rows[0].result;assert.equal(r.evidence.phase,'stopped_review');const selected=await cleanupRequest(actor,r.evidence.finishId);assert.equal(selected.evidence.attemptId,attempt.attempt_id);assert.equal(selected.evidence.cleanupReferenceId,null);assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1 AND user_id=$2',[selected.evidence.providerSessionId,f.subject])).rows[0].n,1);}finally{await c.end();}
  }finally{release();}await result;
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[attempt.reserved_app_session_id])).rows[0].n,0);
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});
test('registration-finish failure stops and revokes its exact genuine session before provider cleanup',async()=>{
  const f=await provision(),actor=await linkActor(f),other=await issue(f);let cleanupObserved=false;
  const gate={...boundary,signOutLocal:async(...args)=>{
    const row=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND id<>$2',[actor.id,other.evidence.sessionId])).rows[0];assert(row?.revoked_at);assert.equal(row.provider_token_ciphertext,null);
    assert.deepEqual((await client.query('SELECT phase FROM crest_private.provider_login_finishes f JOIN crest_private.provider_login_attempts a ON a.attempt_id=f.attempt_id WHERE a.reserved_app_session_id=$1',[row.id])).rows.map(r=>r.phase),['stopped_review']);
    const stopped=(await client.query("SELECT id FROM crest_private.provider_login_finishes f JOIN crest_private.provider_login_attempts a ON a.attempt_id=f.attempt_id WHERE a.reserved_app_session_id=$1 AND phase='stopped_review'",[row.id])).rows[0];const selected=await cleanupRequest(actor,stopped.id);assert.equal(selected.evidence.appSessionId,row.id);assert.equal(selected.evidence.providerSessionId,row.provider_session_id);assert(selected.evidence.cleanupReferenceId);assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1 AND user_id=$2',[row.provider_session_id,f.subject])).rows[0].n,1);
    cleanupObserved=true;await boundary.signOutLocal(...args);
  }};
  await client.query("CREATE FUNCTION crest_private.real_finish_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_REAL_FINISH_FAILURE'; END $$");await client.query("CREATE TRIGGER zz_real_finish_failure BEFORE INSERT ON crest_private.provider_login_finishes FOR EACH ROW WHEN (NEW.phase='registration_closed') EXECUTE FUNCTION crest_private.real_finish_failure_probe()");
  try{await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));}finally{await client.query('DROP TRIGGER zz_real_finish_failure ON crest_private.provider_login_finishes');await client.query('DROP FUNCTION crest_private.real_finish_failure_probe()');}
  assert(cleanupObserved);assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('wrong actual TOTP retains the signed target while cleanup leaves the other app device valid',async()=>{
  const f=await provision(),actor=await linkActor(f),other=await issue(f);
  await lifecycleDenied(lifecycle.login({email:f.email,password:f.password,factorId:f.factorId,code:wrongCode(f.totp)},{subject:f.subject},false,signal()));
  const rows=(await client.query('SELECT t.*,a.reserved_app_session_id FROM crest_private.provider_login_targets t JOIN crest_private.provider_login_attempts a USING(attempt_id) WHERE t.actor_id=$1',[actor.id])).rows;assert.equal(rows.length,2);
  const failed=rows.find(r=>r.reserved_app_session_id!==other.evidence.sessionId);assert(failed);assert.deepEqual((await client.query('SELECT phase FROM crest_private.provider_login_finishes WHERE attempt_id=$1',[failed.attempt_id])).rows.map(r=>r.phase),['stopped_review']);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[failed.reserved_app_session_id])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[failed.provider_session_id])).rows[0].n,0);
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});
test('actual target receipt write failure stops login and scopes cleanup to its new password session',async()=>{
  const f=await provision(),actor=await linkActor(f),other=await issue(f);let reference;
  const gate={...boundary,authenticatePasswordTotp:async(input,binding,signal,observe)=>boundary.authenticatePasswordTotp(input,binding,signal,async(r,s)=>{
    reference=r;assert.equal((await client.query('SELECT aal FROM auth.sessions WHERE id=$1',[r.sessionId])).rows[0].aal,'aal1');await observe(r,s);
  })};
  await client.query("CREATE FUNCTION crest_private.real_target_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_REAL_TARGET_FAILURE'; END $$");await client.query('CREATE TRIGGER zz_real_target_failure BEFORE INSERT ON crest_private.provider_login_targets FOR EACH ROW EXECUTE FUNCTION crest_private.real_target_failure_probe()');
  try{await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));}finally{await client.query('DROP TRIGGER zz_real_target_failure ON crest_private.provider_login_targets');await client.query('DROP FUNCTION crest_private.real_target_failure_probe()');}
  assert(reference);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_login_targets WHERE provider_session_id=$1',[reference.sessionId])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[reference.sessionId])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_login_attempts WHERE actor_id=$1',[actor.id])).rows[0].n,2);
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('epoch change during actual provider login cannot rebase a durable attempt',async()=>{
  const f=await provision(),actor=await linkActor(f);let calls=0;
  const gate={...boundary,authenticatePasswordTotp:async(...args)=>{calls++;const result=await boundary.authenticatePasswordTotp(...args);
    await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),actor.id]);return result;}};
  await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));assert.equal(calls,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,0);
  const rows=(await client.query('SELECT * FROM crest_private.provider_login_attempts WHERE actor_id=$1',[actor.id])).rows;assert.equal(rows.length,1);assert.equal(rows[0].issued_security_epoch,actor.current_security_epoch);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_login_targets WHERE attempt_id=$1',[rows[0].attempt_id])).rows[0].n,1);
});
test('failed durable begin prevents all provider password requests',async()=>{
  const f=await provision(),actor=await linkActor(f);let calls=0;
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const backup=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic begin backup',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,randomUUID(),bootstrap])).rows[0].id;
  const business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,backup,actor.id]);
  await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[actor.id]);
  const gate={...boundary,authenticatePasswordTotp:async(...args)=>{calls++;return boundary.authenticatePasswordTotp(...args);}};
  await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));assert.equal(calls,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_login_attempts WHERE actor_id=$1',[actor.id])).rows[0].n,0);
});

test('issuance waiting on an actor root rereads a newly committed security epoch and releases no credential',async()=>{
  const f=await provision(),actor=await linkActor(f),locker=await sandbox.connect(target);await locker.query('BEGIN');await locker.query('SELECT id FROM crest_private.actors WHERE id=$1 FOR UPDATE',[actor.id]);
  const pending=issue(f),result=lifecycleDenied(pending);let blocked=false;
  try{
    const deadline=Date.now()+5000;while(!blocked&&Date.now()<deadline){blocked=(await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_session_lifecycle' AND wait_event_type='Lock'")).rows[0].n>0;if(!blocked)await delay(10);}
    assert(blocked,'actual issuance must wait on the held actor root');await locker.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),actor.id]);await locker.query('COMMIT');await result;
  }finally{await locker.query('ROLLBACK');}
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,0);
});
test('retrieval cancellation and database failure return generic errors and retain no lifecycle connection',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),locker=await sandbox.connect(target),controller=new AbortController();
  await locker.query('BEGIN');await locker.query('LOCK TABLE crest_private.app_sessions IN ACCESS EXCLUSIVE MODE');
  const pending=lifecycle.verify(issued.cookieValueForResponse(),controller.signal),result=lifecycleDenied(pending);let blocked=false;
  try{const deadline=Date.now()+2000;while(!blocked&&Date.now()<deadline){blocked=(await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_session_lifecycle' AND wait_event_type='Lock'")).rows[0].n>0;if(!blocked)await delay(10);}assert(blocked);controller.abort();await result;}finally{await locker.query('ROLLBACK');}
  const url=new URL(runtimeUrl);url.port='1';await lifecycleDenied(createSessionLifecycle({connectionString:url.toString(),environment:'test'},boundary,store).verify(issued.cookieValueForResponse(),signal()));
  await lifecycleDenied(createSessionLifecycle({connectionString:target,environment:'test'},boundary,store).verify(issued.cookieValueForResponse(),signal()));
  assert.equal((await lifecycle.verify(issued.cookieValueForResponse(),signal())).sessionId,issued.evidence.sessionId);
  assert.equal((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_session_lifecycle'")).rows[0].n,0);
});
test('provider outage after creation commits releases no credential and revokes the newly persisted local session',async()=>{
  const f=await provision(),actor=await linkActor(f);let stopped=false;
  // Pause the actual provider only after the actual login lookup succeeds.
  // SQL insertion stays available; the required post-insert online check fails.
  const gate=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},async(subject,session,signal)=>{
    const live=await lookup(subject,session,signal);if(!stopped){stopped=true;await service.stop();}return live;
  });
  try{await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));}finally{if(stopped)await service.restart();}
  const rows=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows;assert.equal(rows.length,1);assert(rows[0].revoked_at);assert.equal(rows[0].provider_token_ciphertext,null);assert.equal(rows[0].key_id,null);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_events WHERE session_id=$1',[rows[0].id])).rows[0].n,2);
  assert.deepEqual((await client.query('SELECT phase FROM crest_private.provider_login_finishes f JOIN crest_private.provider_login_attempts a ON a.attempt_id=f.attempt_id WHERE a.reserved_app_session_id=$1 ORDER BY phase',[rows[0].id])).rows.map(r=>r.phase),['registration_closed','stopped_review']);
});

const sessionRow=async issued=>(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[issued.evidence.sessionId])).rows[0];
function unchangedSession(before,after){
  for(const field of ['id','actor_id','provider_session_id','issued_security_epoch','trusted'])assert.equal(after[field],before[field]);
  for(const field of ['created_at','authenticated_at','expires_at','last_active_at','reauth_at'])assert.equal(after[field]?.getTime()??null,before[field]?.getTime()??null);
  assert(after.token_hash.equals(before.token_hash),'credential hash must remain unchanged');
}
async function tokenMaterial(row,f,provider=service,ring=store){
  return (await ring.decrypt({keyId:row.key_id,ciphertext:row.provider_token_ciphertext},
    {actorId:row.actor_id,appSessionId:row.id,providerSessionId:row.provider_session_id,securityEpoch:row.issued_security_epoch,subject:f.subject,issuer:provider.issuer})).tokensForProvider();
}
function heldRefresh(){
  let entered,release,first=true;const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const gate=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},async(subject,session,signal)=>{
    const live=await lookup(subject,session,signal);
    if(first){first=false;entered();await held;}return live;
  });
  return {ready,release,lifecycle:createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)};
}
async function atBarrier(ready){await Promise.race([ready,delay(5000).then(()=>{throw new Error('actual refresh lookup barrier was not reached');})]);}
async function waitForRefreshLock(){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    if((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND application_name='crest_session_refresh' AND wait_event_type='Lock'",[new URL(target).pathname.slice(1)])).rows[0].n>0)return;
    await delay(10);
  }
  assert.fail('second refresh must wait on the actual session row lock');
}

test('locked refresh rotates encrypted real provider tokens without renewing login, activity or local lifetime',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f,true),before=await sessionRow(issued),old=await tokenMaterial(before,f);
  const events=(await client.query('SELECT count(*)::int AS n FROM crest_private.session_events WHERE session_id=$1',[before.id])).rows[0].n;
  const evidence=await lifecycle.refresh(issued.cookieValueForResponse(),signal()),after=await sessionRow(issued),current=await tokenMaterial(after,f);
  assert.equal(evidence.state,'session_verified');assert(evidence.tenantAndRequestVerificationRequired);assert.equal(evidence.foregroundActivityAt,null);
  assert.equal(evidence.provider.passwordAt,issued.evidence.provider.passwordAt);assert.equal(evidence.provider.totpAt,issued.evidence.provider.totpAt);
  assert(current.refreshToken!==old.refreshToken,'provider refresh token must rotate');assert(!after.provider_token_ciphertext.equals(before.provider_token_ciphertext),'ciphertext must be replaced');
  assert.equal(BigInt(after.version),BigInt(before.version)+1n);unchangedSession(before,after);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_events WHERE session_id=$1',[before.id])).rows[0].n,events,'same-key refresh is not authentication or foreground activity');
});

test('two overlapping real refresh requests serialize and reuse the winner instead of replaying stale material',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),before=await sessionRow(issued),held=heldRefresh();
  const first=held.lifecycle.refresh(issued.cookieValueForResponse(),signal());let second;
  // Attach handlers immediately so a barrier failure cannot cause an unhandled rejection.
  const results=[first.then(value=>({value}),()=>({failed:true}))];
  try{await atBarrier(held.ready);second=held.lifecycle.refresh(issued.cookieValueForResponse(),signal());results.push(second.then(value=>({value}),()=>({failed:true})));await waitForRefreshLock();}finally{held.release();}
  for(const result of await Promise.all(results)){assert(!result.failed,'both overlapping refresh requests must verify');assert.equal(result.value.sessionId,before.id);}
  const after=await sessionRow(issued);assert.equal(BigInt(after.version),BigInt(before.version)+1n);unchangedSession(before,after);
});

test('refresh migrates to the configured encryption key while retaining safe history and unchanged authentication',async()=>{
  const f=await provision();await linkActor(f);const first=randomBytes(32),second=randomBytes(32);
  const original=await createProviderTokenStore('first',[{id:'first',key:first}]),rotated=await createProviderTokenStore('second',[{id:'first',key:first},{id:'second',key:second}]);
  const config={connectionString:runtimeUrl,environment:'test'},issued=await issue(f,false,createSessionLifecycle(config,boundary,original)),before=await sessionRow(issued);
  await createSessionLifecycle(config,boundary,rotated).refresh(issued.cookieValueForResponse(),signal());const after=await sessionRow(issued);
  assert.equal(after.key_id,'second');unchangedSession(before,after);
  await assert.rejects(tokenMaterial(after,f,service,original),ProviderTokenStorageError);
  assert((await tokenMaterial(after,f,service,rotated)).refreshToken,'current key must decrypt replacement');
  const events=(await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1',[after.id])).rows;assert.equal(events.length,2);
  const serialized=JSON.stringify(events);for(const omitted of ['key_id','provider_token_ciphertext','token_hash'])assert(!serialized.includes(omitted),'key change history excludes secret storage metadata');
});

test('revocation committed first prevents refresh and cannot restore deleted ciphertext',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f);await revoke(issued.cookieValueForResponse(),signal());const before=await sessionRow(issued);
  await lifecycleDenied(lifecycle.refresh(issued.cookieValueForResponse(),signal()));const after=await sessionRow(issued);
  assert(after.revoked_at);assert.equal(after.provider_token_ciphertext,null);assert.equal(after.key_id,null);assert.equal(after.version,before.version);
});

test('actual Auth outage during refresh fails once, revokes locally and leaves the other device recoverable',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),other=await issue(f);
  await service.stop();
  try{await lifecycleDenied(lifecycle.refresh(issued.cookieValueForResponse(),signal()));}finally{await service.restart();}
  const row=await sessionRow(issued);assert(row.revoked_at);assert.equal(row.provider_token_ciphertext,null);assert.equal(row.key_id,null);
  await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('revocation waits for a held refresh and then irreversibly clears the replacement',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),held=heldRefresh();
  const refreshing=held.lifecycle.refresh(issued.cookieValueForResponse(),signal()).then(()=>undefined,()=>undefined);let revoking;
  try{await atBarrier(held.ready);revoking=revoke(issued.cookieValueForResponse(),signal());held.release();await revoking;}finally{held.release();await refreshing;}
  const row=await sessionRow(issued);assert(row.revoked_at);assert.equal(row.provider_token_ciphertext,null);assert.equal(row.key_id,null);
  await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
});

test('cancellation after actual provider rotation rolls back and revokes only the affected local session',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),other=await issue(f),held=heldRefresh(),controller=new AbortController();
  const result=lifecycleDenied(held.lifecycle.refresh(issued.cookieValueForResponse(),controller.signal));
  try{await atBarrier(held.ready);controller.abort();await result;}finally{held.release();}
  const row=await sessionRow(issued);assert(row.revoked_at);assert.equal(row.provider_token_ciphertext,null);assert.equal(row.key_id,null);
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('loss of the owned transaction connection after rotation fails closed and leaves no held refresh connection',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),held=heldRefresh();
  const result=lifecycleDenied(held.lifecycle.refresh(issued.cookieValueForResponse(),signal()));
  try{
    await atBarrier(held.ready);
    const rows=(await sandbox.admin.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND application_name='crest_session_refresh'",[new URL(target).pathname.slice(1),login])).rows;
    assert.equal(rows.length,1,'terminate only this fixture-owned refresh backend');
    assert.equal((await sandbox.admin.query('SELECT pg_terminate_backend($1) AS stopped',[rows[0].pid])).rows[0].stopped,true);await result;
  }finally{held.release();}
  const row=await sessionRow(issued);assert(row.revoked_at);assert.equal(row.provider_token_ciphertext,null);
  assert.equal((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND application_name='crest_session_refresh'",[new URL(target).pathname.slice(1)])).rows[0].n,0);
});

test('provider revocation between real exchange and SQL replacement is rechecked before ciphertext can commit',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),before=await sessionRow(issued),old=await tokenMaterial(before,f);let stopped=false;
  const gate=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},async(subject,session,signal)=>{
    const live=await lookup(subject,session,signal);if(!stopped){stopped=true;authResult(await service.admin.admin.signOut(old.accessToken,'local'),'refresh_race_signout');}return live;
  });
  await lifecycleDenied(createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store).refresh(issued.cookieValueForResponse(),signal()));
  assert(stopped);const after=await sessionRow(issued);assert(after.revoked_at);assert.equal(after.provider_token_ciphertext,null);assert.equal(after.key_id,null);
  assert.equal(BigInt(after.version),BigInt(before.version)+1n,'only local revocation commits after failed replacement');unchangedSession(before,after);
});

test('refresh accepts no unknown encryption key and cannot extend an expired local session',async()=>{
  const f=await provision();await linkActor(f);const issued=await issue(f),before=await sessionRow(issued),wrong=await createProviderTokenStore('other',[{id:'other',key:randomBytes(32)}]);
  await lifecycleDenied(createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},boundary,wrong).refresh(issued.cookieValueForResponse(),signal()));
  assert.equal((await sessionRow(issued)).version,before.version);
  await delay(20);await client.query("UPDATE crest_private.app_sessions SET expires_at=created_at+interval '1 millisecond',version=version+1 WHERE id=$1",[before.id]);
  const expired=await sessionRow(issued);await lifecycleDenied(lifecycle.refresh(issued.cookieValueForResponse(),signal()));const after=await sessionRow(issued);
  assert.equal(after.version,expired.version);assert(after.provider_token_ciphertext.equals(expired.provider_token_ciphertext),'expired local session cannot refresh or replace its tokens');
});

test('historical refresh grants and schema15 activity grants remain exact; stale/malformed/nonfresh calls deny',async()=>{
  const allowed=['provider_token_ciphertext','key_id','version','updated_by','operation_id'].sort();
  assert.deepEqual(refreshGrants.filter(r=>r.allowed).map(r=>r.attname),allowed);
  const current=(await client.query("SELECT attname FROM pg_attribute WHERE attrelid='crest_private.app_sessions'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('crest_session_owner',attrelid,attnum,'UPDATE') ORDER BY attname")).rows.map(r=>r.attname);
  assert.deepEqual(current,[...allowed,'last_active_at'].sort());
  for(const field of ['provider_token_ciphertext','key_id','version','updated_by','operation_id'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.app_sessions',$1,'UPDATE') AS allowed",[field])).rows[0].allowed,true);
  for(const field of ['id','actor_id','token_hash','provider_session_id','issued_security_epoch','authenticated_at','created_at','reauth_at','expires_at','trusted','revoked_at'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.app_sessions',$1,'UPDATE') AS allowed",[field])).rows[0].allowed,false);
  for(const fn of ['lock_app_session(bytea)','replace_session_tokens(bytea,bigint,bytea,text,uuid)']){
    const name=`crest_commands.${fn}`,row=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[name])).rows[0];
    assert(row.prosecdef);assert.equal(row.owner,'crest_session_owner');assert.deepEqual(row.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
    for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_command_owner','crest_auth_reader'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,name])).rows[0].allowed,false);
  }
  const f=await provision();await linkActor(f);const issued=await issue(f),row=await sessionRow(issued),args=[row.token_hash,row.version,row.provider_token_ciphertext,row.key_id,randomUUID()];
  const sql='SELECT crest_commands.replace_session_tokens($1,$2,$3,$4,$5)';
  for(const [index,value] of [[0,Buffer.alloc(31)],[1,'0'],[2,Buffer.alloc(0)],[2,Buffer.alloc(65537)],[3,'invalid key'],[4,null]]){
    const bad=[...args];bad[index]=value;await asWeb(async()=>{await assert.rejects(client.query(sql,bad),e=>e.code==='22023');});
  }
  await asWeb(async()=>{const bad=[...args];bad[1]=String(BigInt(row.version)+1n);await assert.rejects(client.query(sql,bad),e=>e.code==='40001');});
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query(sql,args),e=>e.code==='25001');}finally{await client.query('ROLLBACK');}
  assert.equal((await sessionRow(issued)).version,row.version);
});

test('an actually expired access JWT refreshes automatically using the original signed AMR reference',async()=>{
  const short=await startRealAuthService(target,{jwtExpiry:120});
  try{
    const f=await provision({provider:short});await linkActor(f,short.issuer);
    const provider=createProviderBoundary({issuer:short.issuer,publicKey:short.publicKey,environment:'test'},lookup);
    const gate=createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},provider,store),issued=await issue(f,false,gate),before=await sessionRow(issued);
    const remaining=issued.evidence.provider.expiresAt-Date.now();assert(remaining>90000&&remaining<=120000,'actual Auth must apply the test-only lifetime above the SDK MFA refresh margin');
    await delay(remaining+25);const evidence=await gate.verify(issued.cookieValueForResponse(),signal()),after=await sessionRow(issued);
    assert(evidence.provider.expiresAt>Date.now());assert.equal(evidence.provider.passwordAt,issued.evidence.provider.passwordAt);assert.equal(evidence.provider.totpAt,issued.evidence.provider.totpAt);
    assert.equal(BigInt(after.version),BigInt(before.version)+1n);unchangedSession(before,after);
  }finally{await short.close();}
});

const browserOrigin='https://crest.example.test',browserKey=randomBytes(32);let browserAddress=0;
const browserIp=()=>`192.0.2.${++browserAddress}`;
const browserRequest=(token='',overrides={})=>new Request(`${browserOrigin}/auth`,{method:'POST',headers:{origin:browserOrigin,'content-type':'application/json','sec-fetch-site':'same-origin','x-crest-csrf':token,...overrides}});
const browserFlow=(f,provider=boundary,key=browserKey)=>createBrowserSessionFlow({connectionString:runtimeUrl,environment:'test',origin:browserOrigin,loginKey:key,owner:{subject:f.subject,factorId:f.factorId}},provider,store);
const browserInput=f=>({email:f.email,password:f.password,code:f.totp.generate(),trusted:false});
async function browserDenied(work){await assert.rejects(work,error=>error instanceof BrowserSessionError&&error.message==='BROWSER_SESSION_FAILED'&&error.cause===undefined);}
async function browserLogin(flow,f,address=browserIp(),previous){
  const context=await flow.beginLogin(browserRequest(),address,signal());
  return flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal(),previous);
}
async function browserContext(cookie){
  const hash=createHash('sha256').update(cookie).digest();
  try{return (await client.query('SELECT * FROM crest_private.login_contexts WHERE credential_hash=$1',[hash])).rows[0];}finally{hash.fill(0);}
}

test('anonymous context stores only hashes, expires after ten minutes and retires the previously presented context',async()=>{
  const f=await provision(),flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal());
  assert.throws(()=>JSON.stringify(context),BrowserSessionError);const row=await browserContext(context.cookieValueForResponse());
  assert.equal(row.expires_at.getTime()-row.created_at.getTime(),600000);assert.equal(context.expiresAt,row.expires_at.getTime());
  assert(!row.credential_hash.includes(Buffer.from(context.cookieValueForResponse())));assert(!row.csrf_hash.includes(Buffer.from(context.csrfTokenForResponse())));
  await flow.beginLogin(browserRequest(),address,signal(),context.cookieValueForResponse());const retired=await browserContext(context.cookieValueForResponse());assert(retired.consumed_at);assert.equal(retired.csrf_hash,null);
  await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal()));
});

test('anonymous context requires matching IP and CSRF proof before consuming or invoking actual Auth',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal());
  const before=(await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1',[f.subject])).rows[0].n;
  await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse()),browserIp(),context.cookieValueForResponse(),browserInput(f),signal()));
  await browserDenied(flow.login(browserRequest(),address,context.cookieValueForResponse(),browserInput(f),signal()));
  await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse(),{origin:'https://evil.example.test'}),address,context.cookieValueForResponse(),browserInput(f),signal()));
  assert.equal((await browserContext(context.cookieValueForResponse())).consumed_at,null);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1',[f.subject])).rows[0].n,before);
  assert.equal((await flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal())).evidence.state,'session_verified');
});

test('browser orchestration consumes the context before actual password/TOTP issuance and returns no provider tokens',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal());
  const issued=await flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal());assert.throws(()=>JSON.stringify(issued),BrowserSessionError);
  assert(issued.evidence.tenantAndRequestVerificationRequired);const row=await sessionRow(issued),pending=await browserContext(context.cookieValueForResponse());
  assert(pending.consumed_at);assert.equal(pending.csrf_hash,null);assert(row.provider_token_ciphertext);assert.equal(row.expires_at.getTime()-row.created_at.getTime(),43200000);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_csrf_tokens WHERE session_id=$1',[row.id])).rows[0].n,1);
  await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal()));
  assert.equal((await lifecycle.verify(issued.cookieValueForResponse(),signal())).sessionId,row.id);
});

test('concurrent replay of one context permits exactly one real provider login and one app session',async()=>{
  const f=await provision(),actor=await linkActor(f),flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal());
  const before=(await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1',[f.subject])).rows[0].n;
  const results=await Promise.allSettled(Array.from({length:2},()=>flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal())));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason instanceof BrowserSessionError).length,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1',[f.subject])).rows[0].n,before+1);
});

test('browser replacement atomically retires the previous local cookie while a second device remains valid',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),old=await browserLogin(flow,f),other=await browserLogin(flow,f),replacement=await browserLogin(flow,f,browserIp(),old.cookieValueForResponse());
  assert(replacement.cookieValueForResponse()!==old.cookieValueForResponse(),'replacement needs independent opaque material');
  const oldRow=await sessionRow(old);assert(oldRow.revoked_at);assert.equal(oldRow.provider_token_ciphertext,null);assert.equal(oldRow.key_id,null);
  await lifecycleDenied(lifecycle.verify(old.cookieValueForResponse(),signal()));assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
  assert.equal((await lifecycle.verify(replacement.cookieValueForResponse(),signal())).sessionId,replacement.evidence.sessionId);
});

test('failed CSRF insertion rolls back replacement without retiring the prior local session',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),old=await browserLogin(flow,f),fresh=await browserLogin(flow,f);
  const oldRow=await sessionRow(old),newRow=await sessionRow(fresh),proof=(await client.query('SELECT token_hash FROM crest_private.session_csrf_tokens WHERE session_id=$1',[newRow.id])).rows[0].token_hash;
  await asWeb(async()=>{await assert.rejects(client.query('SELECT crest_commands.bind_browser_session($1,$2,$3)',[newRow.token_hash,proof,oldRow.token_hash]),error=>error.code==='23505');});
  assert.equal((await sessionRow(old)).revoked_at,null);assert.equal((await lifecycle.verify(old.cookieValueForResponse(),signal())).sessionId,oldRow.id);
});

test('session CSRF reissue supports eight tabs without renewing authentication, activity, expiry or row version',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),issued=await browserLogin(flow,f),before=await sessionRow(issued);let current=issued;
  for(let i=0;i<9;i++)current=await flow.session(browserRequest(),issued.cookieValueForResponse(),signal());
  const after=await sessionRow(issued);unchangedSession(before,after);assert.equal(after.version,before.version);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_csrf_tokens WHERE session_id=$1',[before.id])).rows[0].n,8);
  await browserDenied(flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal()));assert.equal((await sessionRow(issued)).revoked_at,null);
  assert.equal((await flow.logout(browserRequest(current.csrfTokenForResponse()),current.cookieValueForResponse(),signal())).localRevoked,true);
});

test('just-issued CSRF proof survives trimming even when retained proof timestamps are ahead',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),issued=await browserLogin(flow,f);
  for(let i=0;i<7;i++)await flow.session(browserRequest(),issued.cookieValueForResponse(),signal());
  await client.query("UPDATE crest_private.session_csrf_tokens SET created_at=clock_timestamp()+interval '1 hour' WHERE session_id=$1",[issued.evidence.sessionId]);
  const current=await flow.session(browserRequest(),issued.cookieValueForResponse(),signal());
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_csrf_tokens WHERE session_id=$1',[issued.evidence.sessionId])).rows[0].n,8);
  assert.equal((await flow.logout(browserRequest(current.csrfTokenForResponse()),current.cookieValueForResponse(),signal())).localRevoked,true);
});

test('browser logout commits local revocation before the real public-key SDK provider signout and preserves another device',async()=>{
  const f=await provision(),actor=await linkActor(f);let checked=false,issued;
  const inspected={...boundary,async signOutLocal(...args){assert((await sessionRow(issued)).revoked_at,'provider signout must follow local commit');const reference=(await client.query('SELECT state,provider_session_id FROM crest_private.provider_cleanup_references WHERE app_session_id=$1',[issued.evidence.sessionId])).rows;assert.deepEqual(reference,[{state:'review_required',provider_session_id:issued.evidence.provider.sessionId}]);checked=true;return boundary.signOutLocal(...args);}};
  const flow=browserFlow(f,inspected);issued=await browserLogin(flow,f);const other=await browserLogin(flow,f),result=await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal());
  assert(checked);assert.deepEqual(result,{localRevoked:true,providerSignedOut:true});assert.equal(await lookup(f.subject,issued.evidence.provider.sessionId,signal()),false);
  const observed=await providerInventory(actor);assert(!observed.some(r=>r.app_session_id===issued.evidence.sessionId));assert(observed.some(r=>r.app_session_id===other.evidence.sessionId&&r.local_revoked_at===null));
  const saved=await retainedInventory(actor);assert(!saved.evidence.observations.some(r=>r.app_session_id===issued.evidence.sessionId));assert.equal(saved.evidence.observations.find(r=>r.app_session_id===other.evidence.sessionId).classification,'registered_observed');
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('actual provider outage after local logout cannot restore the app session or clear another device',async()=>{
  const f=await provision(),actor=await linkActor(f);let issued,stopped=false;
  const gate={...boundary,async signOutLocal(...args){assert((await sessionRow(issued)).revoked_at);stopped=true;await service.stop();return boundary.signOutLocal(...args);}};
  const flow=browserFlow(f,gate);issued=await browserLogin(flow,f);const other=await browserLogin(flow,f);
  try{assert.deepEqual(await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal()),{localRevoked:true,providerSignedOut:false});}finally{if(stopped)await service.restart();}
  const observed=await providerInventory(actor),revokedObservation=observed.find(r=>r.app_session_id===issued.evidence.sessionId);assert(revokedObservation);assert(revokedObservation.local_revoked_at);assert(revokedObservation.cleanup_reference_id);assert.equal(revokedObservation.provider_aal,'aal2');assert(observed.some(r=>r.app_session_id===other.evidence.sessionId&&r.local_revoked_at===null));
  const saved=await retainedInventory(actor);assert.equal(saved.evidence.observations.find(r=>r.app_session_id===issued.evidence.sessionId).classification,'local_revocation_review');assert.equal(saved.evidence.observations.find(r=>r.app_session_id===other.evidence.sessionId).classification,'registered_observed');assert.deepEqual(await retainedInventory(actor,saved.evidence.requestId),saved);
  const row=await sessionRow(issued);assert(row.revoked_at);assert.equal(row.provider_token_ciphertext,null);await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
  assert.deepEqual((await client.query('SELECT state,provider_session_id,source_version::text FROM crest_private.provider_cleanup_references WHERE app_session_id=$1',[issued.evidence.sessionId])).rows,[{state:'review_required',provider_session_id:issued.evidence.provider.sessionId,source_version:row.version}]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_cleanup_references WHERE app_session_id=$1',[other.evidence.sessionId])).rows[0].n,0);
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('expired and epoch-invalid browser sessions can still revoke locally using retained CSRF proof',async()=>{
  const f=await provision(),actor=await linkActor(f),flow=browserFlow(f),expired=await browserLogin(flow,f),stale=await browserLogin(flow,f);
  await delay(20);await client.query("UPDATE crest_private.app_sessions SET expires_at=created_at+interval '1 millisecond',version=version+1 WHERE id=$1",[expired.evidence.sessionId]);
  assert.equal((await flow.logout(browserRequest(expired.csrfTokenForResponse()),expired.cookieValueForResponse(),signal())).localRevoked,true);
  await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),actor.id]);
  assert.equal((await flow.logout(browserRequest(stale.csrfTokenForResponse()),stale.cookieValueForResponse(),signal())).localRevoked,true);assert((await sessionRow(stale)).revoked_at);
});

test('replayed logout is idempotent while wrong-session or foreign-origin CSRF never revokes the target',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),a=await browserLogin(flow,f),b=await browserLogin(flow,f);
  await browserDenied(flow.logout(browserRequest(a.csrfTokenForResponse()),b.cookieValueForResponse(),signal()));
  await browserDenied(flow.logout(browserRequest(b.csrfTokenForResponse(),{origin:'https://evil.example.test'}),b.cookieValueForResponse(),signal()));assert.equal((await sessionRow(b)).revoked_at,null);
  await flow.logout(browserRequest(a.csrfTokenForResponse()),a.cookieValueForResponse(),signal());const before=await sessionRow(a);
  assert.equal((await flow.logout(browserRequest(a.csrfTokenForResponse()),a.cookieValueForResponse(),signal())).localRevoked,true);assert.equal((await sessionRow(a)).version,before.version);
});

test('expired anonymous contexts and bootstrap budgets deny before provider authentication',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal()),row=await browserContext(context.cookieValueForResponse());
  await client.query("UPDATE crest_private.login_contexts SET created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes' WHERE id=$1",[row.id]);
  await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),browserInput(f),signal()));
  const budgetIp=browserIp();for(let i=0;i<20;i++)await flow.beginLogin(browserRequest(),budgetIp,signal());
  await browserDenied(flow.beginLogin(browserRequest(),budgetIp,signal()));
  await browserDenied(browserFlow(f,boundary,randomBytes(32)).beginLogin(browserRequest(),browserIp(),signal()));
});

test('global bootstrap budget bounds stored anonymous state without creating authentication authority',async()=>{
  const f=await provision(),flow=browserFlow(f),count=(await client.query("SELECT count(*)::int AS n FROM crest_private.login_contexts WHERE created_at>clock_timestamp()-interval '15 minutes'")).rows[0].n;
  const seeded=(await client.query("WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp) INSERT INTO crest_private.login_contexts(id,credential_hash,ip_hash,csrf_hash,created_at,expires_at) SELECT gen_random_uuid(),sha256(convert_to(gen_random_uuid()::text,'UTF8')),sha256(convert_to(gen_random_uuid()::text,'UTF8')),sha256(convert_to(gen_random_uuid()::text,'UTF8')),moment.stamp,moment.stamp+interval '10 minutes' FROM generate_series(1,$1) CROSS JOIN moment RETURNING id",[1000-count])).rows.map(row=>row.id);
  try{await browserDenied(flow.beginLogin(browserRequest(),browserIp(),signal()));}finally{await client.query('DELETE FROM crest_private.login_contexts WHERE id=ANY($1::uuid[])',[seeded]);}
});

test('durable login admission is mandatory before every actual password/TOTP attempt',async()=>{
  const f=await provision(),actor=await linkActor(f),flow=browserFlow(f),address=browserIp();
  for(let i=0;i<5;i++){const context=await flow.beginLogin(browserRequest(),address,signal());await browserDenied(flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),{...browserInput(f),password:'synthetic-wrong-password'},signal()));}
  await browserDenied(browserLogin(flow,f,address));assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,0);
  const digest=createLoginFingerprinter(browserKey)(f.email,address).parametersForDatabase()[0];assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.login_attempts WHERE identifier_hash=$1',[digest])).rows[0].n,5);
});

test('binding rechecks a provider revocation after real issuance and retains the previous cookie on failure',async()=>{
  const f=await provision(),actor=await linkActor(f),normal=browserFlow(f),old=await browserLogin(normal,f);let stopped=false;
  const gate=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},async(subject,session,signal)=>{
    const live=await lookup(subject,session,signal),rows=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND provider_session_id=$2',[actor.id,session])).rows;
    if(!stopped&&rows.length){stopped=true;const tokens=await tokenMaterial(rows[0],f);authResult(await service.admin.admin.signOut(tokens.accessToken,'local'),'browser_bind_race');}return live;
  });
  await browserDenied(browserLogin(browserFlow(f,gate),f,browserIp(),old.cookieValueForResponse()));assert(stopped);
  assert.equal((await sessionRow(old)).revoked_at,null);assert.equal((await lifecycle.verify(old.cookieValueForResponse(),signal())).sessionId,old.evidence.sessionId);
  const rows=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND id<>$2',[actor.id,old.evidence.sessionId])).rows;assert.equal(rows.length,1);assert(rows[0].revoked_at);assert.equal(rows[0].provider_token_ciphertext,null);
});

test('browser state tables/functions retain forced RLS and least privilege with no runtime table exposure',async()=>{
  for(const table of ['login_contexts','session_csrf_tokens']){
    const row=(await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[`crest_private.${table}`])).rows[0];assert(row.relrowsecurity&&row.relforcerowsecurity);assert.equal(row.owner,'crest_schema_owner');
    assert.equal((await client.query("SELECT has_table_privilege('crest_web',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[`crest_private.${table}`])).rows[0].allowed,false);
  }
  for(const [fn,owner] of [['create_login_context(uuid,bytea,bytea,bytea,bytea,bytea)','crest_login_owner'],['login_context_snapshot(bytea,bytea)','crest_login_owner'],['consume_login_context(bytea,bytea,bytea)','crest_login_owner'],['bind_browser_session(bytea,bytea,bytea)','crest_session_owner'],['browser_csrf_snapshot(bytea)','crest_session_owner']]){
    const name=`crest_commands.${fn}`,row=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[name])).rows[0];assert(row.prosecdef);assert.equal(row.owner,owner);assert.deepEqual(row.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
    for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_auth_reader'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,name])).rows[0].allowed,false);
  }
});

test('direct browser-state SQL rejects malformed inputs and nonfresh transaction snapshots',async()=>{
  for(const sql of ["SELECT crest_commands.login_context_snapshot(decode('aa','hex'),decode('bb','hex'))","SELECT crest_commands.consume_login_context(NULL,NULL,NULL)","SELECT crest_commands.bind_browser_session(NULL,NULL,NULL)","SELECT crest_commands.browser_csrf_snapshot(NULL)"]){await asWeb(async()=>{await assert.rejects(client.query(sql),error=>error.code==='22023');});}
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query('SELECT crest_commands.browser_csrf_snapshot($1)',[randomBytes(32)]),error=>error.code==='25001');}finally{await client.query('ROLLBACK');}
  const f=await provision();await linkActor(f);const issued=await browserLogin(browserFlow(f),f);await revoke(issued.cookieValueForResponse(),signal());const row=await sessionRow(issued);
  await asWeb(async()=>{await assert.rejects(client.query('SELECT crest_commands.bind_browser_session($1,$2,NULL)',[row.token_hash,createCsrfToken(row.id).hashForDatabase()]),error=>error.code==='42501');});
});

test('actual MFA browser handoffs round-trip through bounded HTTP bodies and cookie-only credentials',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),address=browserIp();
  const read=createBrowserBodyReader({origin:browserOrigin,environment:'test'});
  const request=(body,csrf='',cookie='')=>new Request(`${browserOrigin}/api/auth`,{method:'POST',headers:{origin:browserOrigin,'content-type':'application/json','x-crest-csrf':csrf,cookie},body:JSON.stringify(body)});
  const begin=request({});await read(begin,'empty');const context=await flow.beginLogin(begin,address,signal());
  const pending=loginContextResponse(context),pendingBody=await pending.json(),pendingPair=pending.headers.getSetCookie()[0].split(';')[0];
  assert.deepEqual(Object.keys(pendingBody).sort(),['csrfToken','expiresAt']);assert(!JSON.stringify(pendingBody).includes(context.cookieValueForResponse()));
  const loginRequest=request(browserInput(f),pendingBody.csrfToken,pendingPair),parsed=await read(loginRequest,'login');
  const issued=await flow.login(loginRequest,address,readBrowserCookies(loginRequest.headers).login,parsed,signal());
  const response=loginResponse(issued,parsed.trusted),body=await response.json(),sessionPair=response.headers.getSetCookie()[0].split(';')[0];
  assert.equal(response.headers.getSetCookie().length,2);assert(!response.headers.getSetCookie()[0].includes('Max-Age'));
  for(const secret of [issued.cookieValueForResponse(),f.password,f.subject,issued.evidence.actorId,issued.evidence.provider.sessionId])assert(!JSON.stringify(body).includes(secret));
  const cookie=readBrowserCookies(new Headers({cookie:sessionPair})).session;
  assert.equal((await lifecycle.verify(cookie,signal())).sessionId,issued.evidence.sessionId);
  const before=await sessionRow(issued),proofRequest=request({},'',sessionPair);await read(proofRequest,'empty');
  const proof=sessionResponse(await flow.session(proofRequest,cookie,signal())),proofBody=await proof.json();assert.deepEqual(proof.headers.getSetCookie(),[]);
  unchangedSession(before,await sessionRow(issued));assert.equal((await sessionRow(issued)).version,before.version);
  const logoutRequest=request({},proofBody.csrfToken,sessionPair);await read(logoutRequest,'empty');
  const out=logoutResponse(await flow.logout(logoutRequest,cookie,signal()));assert.deepEqual(await out.json(),{localRevoked:true,providerSignedOut:true});
  assert(out.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));await lifecycleDenied(lifecycle.verify(cookie,signal()));
});

test('actual trusted-session response preserves the database deadline and bad HTTP JSON cannot consume pending login',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),address=browserIp(),context=await flow.beginLogin(browserRequest(),address,signal());
  const read=createBrowserBodyReader({origin:browserOrigin,environment:'test'});
  const malformed=new Request(browserOrigin,{method:'POST',headers:{origin:browserOrigin,'content-type':'application/json','x-crest-csrf':context.csrfTokenForResponse()},body:'{"email":"x","password":"x","code":"123456","trusted":false,"trusted":true}'});
  await assert.rejects(read(malformed,'login'),BrowserHttpError);assert.equal((await browserContext(context.cookieValueForResponse())).consumed_at,null);
  const input={...browserInput(f),trusted:true},issued=await flow.login(browserRequest(context.csrfTokenForResponse()),address,context.cookieValueForResponse(),input,signal());
  const original=(await sessionRow(issued)).expires_at.getTime(),response=loginResponse(issued,input.trusted);
  const maxAge=Number(/Max-Age=(\d+)/.exec(response.headers.getSetCookie()[0])[1]);assert(maxAge>0&&maxAge<=2592000);
  assert(response.headers.getSetCookie()[0].includes(`Expires=${new Date(original).toUTCString()}`));
  assert.equal((await response.json()).expiresAt,original);assert.equal((await sessionRow(issued)).expires_at.getTime(),original);
  await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal());
});

const sessionAdmit=(issued,bucket='ordinary',config={connectionString:runtimeUrl,environment:'test'},external=signal())=>
  createSessionRequestAdmission(config)(issued.cookieValueForResponse(),bucket,external);
const admissionCount=async(issued,bucket='ordinary')=>(await client.query('SELECT count(*)::int AS n FROM crest_private.session_request_admissions WHERE session_id=$1 AND bucket=$2',[issued.evidence.sessionId,bucket])).rows[0].n;
async function seedAdmissions(issued,count,bucket='ordinary',age='0 seconds'){
  await client.query("INSERT INTO crest_private.session_request_admissions(session_id,bucket,admitted_at) SELECT $1,$2,clock_timestamp()-$4::interval FROM generate_series(1,$3)",[issued.evidence.sessionId,bucket,count,age]);
}
async function admissionFixture(){const f=await provision();await linkActor(f);const flow=browserFlow(f),issued=await browserLogin(flow,f);return {f,flow,issued};}
async function admissionBlocked(minimum=1){
  const deadline=Date.now()+600;
  while(Date.now()<deadline){
    if((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'",[new URL(target).pathname.slice(1),login])).rows[0].n>=minimum)return;
    await delay(5);
  }
  assert.fail('session admission must wait on the actual database session root');
}

test('durable session limit admits exactly120 requests and survives fresh adapters without changing authentication or audit',async()=>{
  const {issued}=await admissionFixture(),before=await sessionRow(issued),events=(await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1 ORDER BY id',[issued.evidence.sessionId])).rows;
  for(let i=0;i<120;i++)assert.equal(await sessionAdmit(issued),true);
  for(let i=0;i<3;i++)assert.equal(await sessionAdmit(issued),false);
  assert.equal(await admissionCount(issued),120);const after=await sessionRow(issued);unchangedSession(before,after);assert.equal(after.version,before.version);assert(after.provider_token_ciphertext.equals(before.provider_token_ciphertext));
  assert.deepEqual((await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1 ORDER BY id',[issued.evidence.sessionId])).rows,events);
});

test('saturated ordinary work cannot prevent local-first logout and independent devices retain separate budgets',async()=>{
  const {f,flow,issued}=await admissionFixture(),other=await browserLogin(flow,f);await seedAdmissions(issued,120);
  assert.equal(await sessionAdmit(issued),false);assert.equal(await sessionAdmit(other),true);
  assert.deepEqual(await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal()),{localRevoked:true,providerSignedOut:true});
  assert.equal(await admissionCount(issued,'logout'),1);assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

test('logout allowance is independently bounded and never borrows ordinary capacity',async()=>{
  const {flow,issued}=await admissionFixture();await seedAdmissions(issued,120,'logout');
  await browserDenied(flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal()));assert.equal((await sessionRow(issued)).revoked_at,null);
  assert.equal(await admissionCount(issued,'logout'),120);assert.equal(await sessionAdmit(issued),true);
  await client.query("UPDATE crest_private.session_request_admissions SET admitted_at=clock_timestamp()-interval '61 seconds' WHERE session_id=$1 AND bucket='logout'",[issued.evidence.sessionId]);
  assert.equal((await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal())).localRevoked,true);
});

test('rolling minute TTL retains recent work, prunes expired work, and counts future timestamps conservatively',async()=>{
  const {issued}=await admissionFixture();await seedAdmissions(issued,120,'ordinary','30 seconds');assert.equal(await sessionAdmit(issued),false);
  await client.query("UPDATE crest_private.session_request_admissions SET admitted_at=clock_timestamp()-interval '60 seconds' WHERE session_id=$1",[issued.evidence.sessionId]);
  assert.equal(await sessionAdmit(issued),true);assert.equal(await admissionCount(issued),1);
  await client.query('DELETE FROM crest_private.session_request_admissions WHERE session_id=$1',[issued.evidence.sessionId]);
  await seedAdmissions(issued,120,'ordinary','-1 hour');assert.equal(await sessionAdmit(issued),false);assert.equal(await admissionCount(issued),120);
});

test('concurrent requests share one session root and admit exactly one remaining place',async()=>{
  const {issued}=await admissionFixture();await seedAdmissions(issued,119);const locker=await sandbox.connect(target);
  await locker.query('BEGIN');await locker.query('SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE',[issued.evidence.sessionId]);
  const pending=Promise.all(Array.from({length:12},()=>sessionAdmit(issued))).then(values=>({values}),error=>({error}));
  try{await admissionBlocked(2);}finally{await locker.query('ROLLBACK');}
  const result=await pending;assert(!result.error,'parallel reservations must finish inside existing runtime lock bounds');assert.equal(result.values.filter(Boolean).length,1);assert.equal(await admissionCount(issued),120);
});

test('a blocked session does not create a global admission lock or block another device',async()=>{
  const {f,flow,issued}=await admissionFixture(),other=await browserLogin(flow,f),locker=await sandbox.connect(target);
  await locker.query('BEGIN');await locker.query('SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE',[issued.evidence.sessionId]);
  const pending=sessionAdmit(issued).then(value=>({value}),error=>({error}));
  try{await admissionBlocked();assert.equal(await sessionAdmit(other),true);}finally{await locker.query('ROLLBACK');}
  assert.deepEqual(await pending,{value:true});
});

test('rolled-back SQL reservations disappear but committed adapter reservations survive downstream failure',async()=>{
  const {issued}=await admissionFixture(),hash=createHash('sha256').update(issued.cookieValueForResponse()).digest();
  await asWeb(async()=>assert.equal((await client.query('SELECT crest_commands.admit_session_request($1,$2) AS admitted',[hash,'ordinary'])).rows[0].admitted,true));
  assert.equal(await admissionCount(issued),0);
  await assert.rejects((async()=>{assert.equal(await sessionAdmit(issued),true);throw new Error('synthetic downstream failure');})());
  assert.equal(await admissionCount(issued),1);hash.fill(0);
});

test('unknown credentials, malformed SQL and stale isolation cannot allocate or bypass session counters',async()=>{
  const {issued}=await admissionFixture(),hash=createHash('sha256').update(issued.cookieValueForResponse()).digest(),sql='SELECT crest_commands.admit_session_request($1,$2)';
  assert.equal(await createSessionRequestAdmission({connectionString:runtimeUrl,environment:'test'})(createSessionCredential().cookieValueForResponse(),'ordinary',signal()),false);
  for(const args of [[null,'ordinary'],[Buffer.alloc(31),'ordinary'],[hash,null],[hash,'Ordinary'],[hash,'upload']])await asWeb(async()=>await assert.rejects(client.query(sql,args),error=>error.code==='22023'));
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query(sql,[hash,'ordinary']),error=>error.code==='25001');}finally{await client.query('ROLLBACK');}
  assert.equal(await admissionCount(issued),0);hash.fill(0);
});

test('session counters have forced RLS, bounded expired-only cleanup and no mutable runtime grants',async()=>{
  const {issued}=await admissionFixture(),name='crest_private.session_request_admissions',fn='crest_commands.admit_session_request(bytea,text)';
  const table=(await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[name])).rows[0];
  assert(table.relrowsecurity&&table.relforcerowsecurity);assert.equal(table.owner,'crest_schema_owner');
  const routine=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert(routine.prosecdef);assert.equal(routine.owner,'crest_session_owner');assert.deepEqual(routine.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
  for(const role of ['crest_web','anon','authenticated','service_role','crest_worker','crest_login_owner','crest_command_owner','crest_recovery','crest_auth_reader']){
    assert.equal((await client.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role,name])).rows[0].allowed,false);
    if(role!=='crest_web')assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);
  }
  for(const operation of ['UPDATE','TRUNCATE','TRIGGER','MAINTAIN'])assert.equal((await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed',['crest_session_owner',name,operation])).rows[0].allowed,false);
  await seedAdmissions(issued,300,'ordinary','61 seconds');assert.equal(await sessionAdmit(issued),true);assert.equal(await admissionCount(issued),61,'prune at most240 expired rows then add one');
  await client.query('BEGIN');try{
    await client.query('SET LOCAL ROLE crest_session_owner');const removed=await client.query('DELETE FROM crest_private.session_request_admissions WHERE session_id=$1',[issued.evidence.sessionId]);assert.equal(removed.rowCount,60,'owner may delete expired rows only');
    await assert.rejects(client.query('UPDATE crest_private.session_request_admissions SET admitted_at=clock_timestamp()'),error=>error.code==='42501');
  }finally{await client.query('ROLLBACK');}
});

test('session admission cancellation, database locks and overprivileged connections fail closed without session mutation',async()=>{
  const {issued}=await admissionFixture(),before=await sessionRow(issued),controller=new AbortController();controller.abort();
  await assert.rejects(sessionAdmit(issued,'ordinary',undefined,controller.signal),SessionAdmissionError);
  await assert.rejects(sessionAdmit(issued,'ordinary',{connectionString:target,environment:'test'}),SessionAdmissionError);
  const locker=await sandbox.connect(target);await locker.query('BEGIN');await locker.query('SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE',[issued.evidence.sessionId]);
  try{await assert.rejects(sessionAdmit(issued),error=>error instanceof SessionAdmissionError&&error.message==='SESSION_ADMISSION_FAILED'&&error.cause===undefined);}finally{await locker.query('ROLLBACK');}
  assert.equal(await admissionCount(issued),0);assert.equal((await sessionRow(issued)).version,before.version);assert.equal(await sessionAdmit(issued),true);
});

test('browser proof reissue enforces admission before provider work and invalid Origin or logout CSRF cannot consume capacity',async()=>{
  const {f,issued}=await admissionFixture();let providerCalls=0;
  const wrapped={...boundary,async verifyAccess(...args){providerCalls++;return boundary.verifyAccess(...args);}},flow=browserFlow(f,wrapped);
  await browserDenied(flow.session(browserRequest('',{origin:'https://evil.example.test'}),issued.cookieValueForResponse(),signal()));assert.equal(await admissionCount(issued),0);
  await browserDenied(flow.logout(browserRequest(createCsrfToken(randomUUID()).tokenForResponse()),issued.cookieValueForResponse(),signal()));assert.equal(await admissionCount(issued,'logout'),0);
  await seedAdmissions(issued,120);await browserDenied(flow.session(browserRequest(),issued.cookieValueForResponse(),signal()));assert.equal(providerCalls,0);
  assert.equal((await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal())).localRevoked,true);
});

test('a work reservation is never authentication: revoked or expired sessions remain denied except local logout',async()=>{
  const {flow,issued}=await admissionFixture();await revoke(issued.cookieValueForResponse(),signal());
  assert.equal(await sessionAdmit(issued),true);await browserDenied(flow.session(browserRequest(),issued.cookieValueForResponse(),signal()));
  assert.equal((await flow.logout(browserRequest(issued.csrfTokenForResponse()),issued.cookieValueForResponse(),signal())).localRevoked,true);
  const next=await admissionFixture();await delay(5);await client.query("UPDATE crest_private.app_sessions SET expires_at=created_at+interval '1 millisecond',version=version+1 WHERE id=$1",[next.issued.evidence.sessionId]);
  assert.equal(await sessionAdmit(next.issued),true);await browserDenied(next.flow.session(browserRequest(),next.issued.cookieValueForResponse(),signal()));
  assert.equal((await next.flow.logout(browserRequest(next.issued.csrfTokenForResponse()),next.issued.cookieValueForResponse(),signal())).localRevoked,true);
});

const httpFixture=(f,provider=boundary)=>authenticationServer({connectionString:runtimeUrl,loginKey:browserKey,owner:{subject:f.subject,factorId:f.factorId}},provider,store);
const responseCookie=(response,name)=>response.headers.getSetCookie().find(value=>value.startsWith(name+'='))?.split(';')[0];
const cookieValue=pair=>pair.slice(pair.indexOf('=')+1);
async function httpPending(server,headers={}){
  const response=await server.request('bootstrap',{},headers);assert.equal(response.status,200);
  const pair=responseCookie(response,'__Host-crest_login');assert(pair);const body=await response.json();
  assert.deepEqual(Object.keys(body),['csrfToken','expiresAt']);return {pair,...body};
}
async function httpLogin(server,f,{trusted=false,previous}={}){
  const pending=await httpPending(server),response=await server.request('login',{...browserInput(f),trusted},{cookie:[pending.pair,previous].filter(Boolean).join('; '),'x-crest-csrf':pending.csrfToken});
  assert.equal(response.status,200);const pair=responseCookie(response,'__Host-crest_session');assert(pair);
  const evidence=await lifecycle.verify(cookieValue(pair),signal()),body=await response.json();assert.deepEqual(Object.keys(body),['csrfToken','expiresAt']);
  return {pair,response,evidence,...body};
}
async function httpFailure(response,status=400){
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:'AUTHENTICATION_REQUEST_FAILED'});
  assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
  assert(!response.headers.has('set-cookie'));assert(!response.headers.has('access-control-allow-origin'));
}

test('socket HTTP bootstrap, actual password/TOTP, proof and logout preserve private handoff and database deadlines',async()=>{
  const f=await provision();await linkActor(f);const server=await httpFixture(f);
  try{
    const issued=await httpLogin(server,f),before=await sessionRow(issued),set=issued.response.headers.getSetCookie()[0];
    for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert(set.includes(flag));assert(!set.includes('Max-Age='));
    assert.equal(issued.expiresAt,before.expires_at.getTime());
    const response=await server.request('session',{}, {cookie:issued.pair});assert.equal(response.status,200);assert(!response.headers.has('set-cookie'));
    const proof=await response.json();assert.deepEqual(Object.keys(proof),['csrfToken','expiresAt']);assert.equal(proof.expiresAt,issued.expiresAt);
    unchangedSession(before,await sessionRow(issued));assert.equal(await admissionCount(issued),1);
    await httpFailure(await server.request('logout',{}, {cookie:issued.pair,'x-crest-csrf':randomBytes(32).toString('base64url')}));assert.equal((await sessionRow(issued)).revoked_at,null);
    const out=await server.request('logout',{}, {cookie:issued.pair,'x-crest-csrf':proof.csrfToken});assert.equal(out.status,200);
    assert.deepEqual(await out.json(),{localRevoked:true,providerSignedOut:true});assert(out.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));
    await lifecycleDenied(lifecycle.verify(cookieValue(issued.pair),signal()));
    await httpFailure(await server.request('session',{}, {cookie:issued.pair}));
  }finally{await server.close();}
});

test('socket HTTP trusted replacement revokes only the presented device and preserves its original persistent deadline',async()=>{
  const f=await provision();await linkActor(f);const server=await httpFixture(f);
  try{
    const old=await httpLogin(server,f),other=await httpLogin(server,f),replacement=await httpLogin(server,f,{trusted:true,previous:old.pair});
    const stored=await sessionRow(replacement),cookie=replacement.response.headers.getSetCookie()[0];
    assert(stored.trusted);assert(cookie.includes('Expires='+new Date(stored.expires_at).toUTCString()));assert.match(cookie,/Max-Age=\d+/);
    assert((await sessionRow(old)).revoked_at);assert.equal((await sessionRow(other)).revoked_at,null);
    const response=await server.request('session',{}, {cookie:replacement.pair});assert.equal(response.status,200);assert(!response.headers.has('set-cookie'));
    assert.equal((await response.json()).expiresAt,stored.expires_at.getTime());assert.equal((await sessionRow(replacement)).expires_at.getTime(),stored.expires_at.getTime());
    const out=await server.request('logout',{}, {cookie:replacement.pair,'x-crest-csrf':replacement.csrfToken});assert.equal(out.status,200);await out.json();
    assert.equal((await lifecycle.verify(cookieValue(other.pair),signal())).sessionId,other.evidence.sessionId);
  }finally{await server.close();}
});

test('socket HTTP malformed requests and forged forwarding claims cannot consume pending login or select the IP budget',async()=>{
  const f=await provision(),actor=await linkActor(f),server=await httpFixture(f);
  try{
    const pending=await httpPending(server,{'x-forwarded-for':'198.51.100.1','forwarded':'for=203.0.113.1'}),row=await browserContext(cookieValue(pending.pair));
    const parameters=createLoginFingerprinter(browserKey)('login-context','127.0.0.1').parametersForDatabase();
    try{assert(row.ip_hash.equals(parameters[1]));}finally{for(const value of parameters)value.fill(0);}
    const headers={cookie:pending.pair,'x-crest-csrf':pending.csrfToken};
    await httpFailure(await server.request('login',browserInput(f),{...headers,origin:'https://evil.example.com'}));
    await httpFailure(await server.request('login',{...browserInput(f),factorId:f.factorId},headers));
    await httpFailure(await server.request('login','{"email":"x","password":"x","code":"123456","trusted":false,"trusted":true}',headers));
    await httpFailure(await server.request('login',browserInput(f),headers,'PATCH'),405);
    await httpFailure(await server.request('login?credential=forged',browserInput(f),headers),404);
    await httpFailure(await server.request('bootstrap',{}, {},'OPTIONS'),405);
    assert.equal((await browserContext(cookieValue(pending.pair))).consumed_at,null);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n,0);
    const response=await server.request('login',browserInput(f),{...headers,'x-forwarded-for':'203.0.113.2','x-real-ip':'203.0.113.3'});assert.equal(response.status,200);await response.json();
    await httpFailure(await server.request('login',browserInput(f),headers));
    const second=await httpPending(server,{'x-forwarded-for':'203.0.113.4'});assert((await browserContext(cookieValue(second.pair))).ip_hash.equals(row.ip_hash));
  }finally{await server.close();}
});

test('socket HTTP logout remains available after ordinary saturation and commits locally before failed provider signout',async()=>{
  const f=await provision();await linkActor(f);let observed=false,issued;
  const provider={...boundary,async signOutLocal(){assert((await sessionRow(issued)).revoked_at);observed=true;throw new Error('synthetic provider unavailability');}},server=await httpFixture(f,provider);
  try{
    issued=await httpLogin(server,f);const other=await httpLogin(server,f);await seedAdmissions(issued,120);
    await httpFailure(await server.request('session',{}, {cookie:issued.pair}));
    const out=await server.request('logout',{}, {cookie:issued.pair,'x-crest-csrf':issued.csrfToken});assert.equal(out.status,200);
    assert.deepEqual(await out.json(),{localRevoked:true,providerSignedOut:false});assert(observed);assert(out.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));
    assert.equal(await admissionCount(issued,'logout'),1);await lifecycleDenied(lifecycle.verify(cookieValue(issued.pair),signal()));
    assert.equal((await lifecycle.verify(cookieValue(other.pair),signal())).sessionId,other.evidence.sessionId);
  }finally{await server.close();}
});

test('unexposed-login cleanup requires this flow issuance and revokes only that new session without request admission',async()=>{
  const f=await provision();await linkActor(f);const flow=browserFlow(f),issued=await browserLogin(flow,f),other=await browserLogin(flow,f),foreign=browserFlow(f);
  await browserDenied(foreign.discardUnexposedLogin(issued));
  const proof=await flow.session(browserRequest(),other.cookieValueForResponse(),signal());await browserDenied(flow.discardUnexposedLogin(proof));
  await browserDenied(flow.discardUnexposedLogin({cookieValueForResponse:()=>issued.cookieValueForResponse()}));
  await seedAdmissions(issued,120,'logout');await flow.discardUnexposedLogin(issued);
  assert((await sessionRow(issued)).revoked_at);await lifecycleDenied(lifecycle.verify(issued.cookieValueForResponse(),signal()));
  assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
  await browserDenied(flow.discardUnexposedLogin(issued));
});

async function waitForRevokedLogin(actor,excluded){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    const rows=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND id<>$2',[actor.id,excluded])).rows;
    if(rows.length===1&&rows[0].revoked_at&&await lookup(actor.auth_user_id,rows[0].provider_session_id,signal())===false)return rows[0];
    await delay(20);
  }
  assert.fail('failed delivery must revoke only its newly issued local session');
}

test('actual Node response-write failure cleans up new Auth/local issuance while an existing device remains live',async()=>{
  const f=await provision(),actor=await linkActor(f),server=await httpFixture(f);
  try{
    const other=await httpLogin(server,f),pending=await httpPending(server);
    server.server.prependOnceListener('request',(_request,response)=>{response.end=()=>{throw new Error('synthetic response-write failure');};});
    await assert.rejects(server.request('login',browserInput(f),{cookie:pending.pair,'x-crest-csrf':pending.csrfToken}));
    const failed=await waitForRevokedLogin(actor,other.evidence.sessionId);assert.equal(failed.provider_token_ciphertext,null);
    assert.equal(await lookup(f.subject,failed.provider_session_id,signal()),false);
    assert.equal((await lifecycle.verify(cookieValue(other.pair),signal())).sessionId,other.evidence.sessionId);
  }finally{await server.close();}
});

test('actual Node disconnect during issued-login verification propagates cancellation and cleans only the new session',async()=>{
  const f=await provision(),actor=await linkActor(f);let other,release,entered,closed;
  const barrier=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),disconnected=new Promise(resolve=>{closed=resolve;});let paused=false;
  const provider={...boundary,async verifyAccess(...args){
    const result=await boundary.verifyAccess(...args);
    if(other&&!paused&&(await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE actor_id=$1',[actor.id])).rows[0].n===2){paused=true;entered();await gate;}
    return result;
  }},server=await httpFixture(f,provider);
  try{
    other=await httpLogin(server,f);const pending=await httpPending(server);
    server.server.prependOnceListener('request',(_request,response)=>response.once('close',closed));
    const body=JSON.stringify(browserInput(f)),url=new URL('/api/auth/login',server.origin);
    const request=nodeRequest(url,{method:'POST',headers:{origin:server.origin,'content-type':'application/json','content-length':Buffer.byteLength(body),cookie:pending.pair,'x-crest-csrf':pending.csrfToken}});
    const outcome=new Promise(resolve=>{request.on('error',()=>resolve('disconnected'));request.on('response',response=>{response.resume();resolve('unexpected response');});});request.end(body);
    await Promise.race([barrier,delay(8000).then(()=>{throw new Error('issued login barrier not reached');})]);
    request.destroy();assert.equal(await outcome,'disconnected');await disconnected;release();
    const failed=await waitForRevokedLogin(actor,other.evidence.sessionId);assert.equal(failed.provider_token_ciphertext,null);
    assert.equal(await lookup(f.subject,failed.provider_session_id,signal()),false);
    assert.equal((await lifecycle.verify(cookieValue(other.pair),signal())).sessionId,other.evidence.sessionId);
  }finally{release();await server.close();}
});

// Historical generic-fence cases inspect only the fenced connection. Typed
// business.rename composition is exercised separately at the end of this suite.
async function mutationFixture(){
  const fixture=await provision(),actor=await linkActor(fixture),issued=await issue(fixture),business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  const authority=(await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[business])).rows[0].active_epoch;
  return {fixture,actor,issued,business,authority};
}
test('real SDK/JWT evidence fences one restricted transaction and closes its scope after commit',async()=>{
  const f=await mutationFixture();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
  const run=createMutationTransaction({connectionString:runtimeUrl,environment:'test'},{capability:'crm.manage',requireRecentAuth:false},boundary,store);
  const before=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[f.issued.evidence.sessionId])).rows[0];let captured;
  const result=await run(f.issued.cookieValueForResponse(),{businessId:f.business,recoveryEpoch:f.authority},async scope=>{
    captured=scope;assert.throws(()=>JSON.stringify(scope),MutationBoundaryError);
    assert.deepEqual(scope.contextForServer(),{actorId:f.actor.id,businessId:f.business,sessionId:f.issued.evidence.sessionId,recoveryEpoch:f.authority,capability:'crm.manage'});
    return scope.query("SELECT jsonb_build_object('principal',current_user,'isolation',current_setting('transaction_isolation'),'lock',current_setting('lock_timeout')) AS result",[]);
  },signal());
  assert.deepEqual(result,{principal:'crest_web',isolation:'read committed',lock:'3s'});
  await assert.rejects(captured.query('SELECT 1 AS result',[]),MutationBoundaryError);
  const after=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[f.issued.evidence.sessionId])).rows[0];for(const field of ['authenticated_at','last_active_at','expires_at'])assert.equal(after[field].getTime(),before[field].getTime());assert.equal(after.version,before.version);
});
test('real SDK authentication cannot bypass disabled writes or silently upgrade a stale pinned epoch',async()=>{
  const f=await mutationFixture(),run=createMutationTransaction({connectionString:runtimeUrl,environment:'test'},{capability:'crm.manage',requireRecentAuth:false},boundary,store);let calls=0;
  const work=async()=>{calls++;return null;},request={businessId:f.business,recoveryEpoch:f.authority};
  await assert.rejects(run(f.issued.cookieValueForResponse(),request,work,signal()),e=>e instanceof MutationBoundaryError&&e.message==='RECOVERY_REVIEW_REQUIRED'&&e.cause===undefined);
  const next=randomUUID();await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,writes_enabled=true,version=version+1 WHERE business_id=$2',[next,f.business]);
  await assert.rejects(run(f.issued.cookieValueForResponse(),request,work,signal()),e=>e instanceof MutationBoundaryError&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.equal(calls,0);assert.equal(request.recoveryEpoch,f.authority);
});
test('provider revocation after genuine JWT verification is rejected by the mutation fence before work',async()=>{
  const f=await mutationFixture();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
  let changed=false,calls=0;const provider={...boundary,async verifyAccess(...args){const result=await boundary.verifyAccess(...args);if(!changed){changed=true;authResult(await service.admin.admin.signOut(args[0],'local'),'mutation_provider_revoke');}return result;}};
  const run=createMutationTransaction({connectionString:runtimeUrl,environment:'test'},{capability:'crm.manage',requireRecentAuth:false},provider,store);
  await assert.rejects(run(f.issued.cookieValueForResponse(),{businessId:f.business,recoveryEpoch:f.authority},async()=>{calls++;return null;},signal()),e=>e instanceof MutationBoundaryError&&e.message==='MUTATION_BOUNDARY_FAILED'&&e.cause===undefined);assert(changed);assert.equal(calls,0);
});

// Read-only receipt fixtures; no business rename command is enabled here.
async function seedLookupReceipt(f){
  const operation=randomUUID();await client.query('BEGIN');try{
    await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'business.rename',1,$4,$5,$3,'manual')",[f.business,operation,f.actor.id,f.authority,'a'.repeat(64)]);
    const audit=(await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,'businesses',$1,2,'rename',$4,'manual') RETURNING id",[f.business,operation,f.actor.id,{schemaVersion:1,before:{legalName:'Synthetic before'},after:{legalName:'Synthetic after'}}])).rows[0].id;
    const result={schemaVersion:1,businessId:f.business,businessVersion:'2',auditEventId:audit};await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[f.business,operation,result]);await client.query('COMMIT');return {operation,result};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
test('actual SDK lookup returns only a typed historical receipt or absence without advancing activity',async()=>{
  const f=await mutationFixture(),record=await seedLookupReceipt(f),lookup=createBusinessOperationLookup({connectionString:runtimeUrl,environment:'test'},boundary,store);
  const before=(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[f.issued.evidence.sessionId])).rows[0].row;
  await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);
  const value=await lookup(f.issued.cookieValueForResponse(),{businessId:f.business,operationId:record.operation},signal());assert.deepEqual(value.forServer(),{state:'committed',operationId:record.operation,recoveryEpoch:f.authority,receipt:record.result});assert.throws(()=>JSON.stringify(value),BusinessOperationLookupError);
  assert.deepEqual((await lookup(f.issued.cookieValueForResponse(),{businessId:f.business,operationId:randomUUID()},signal())).forServer(),{state:'absent'});
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[f.issued.evidence.sessionId])).rows[0].row,before);
});
test('provider or membership revocation after genuine SDK verification denies operation evidence',async()=>{
  for(const kind of ['provider','membership']){
    const f=await mutationFixture(),record=await seedLookupReceipt(f);let changed=false;
    if(kind==='membership'){const backup=await linkActor(await provision());await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[f.business,backup.id,f.actor.id]);}
    const provider={...boundary,async verifyAccess(...args){const result=await boundary.verifyAccess(...args);if(!changed){changed=true;if(kind==='provider')authResult(await service.admin.admin.signOut(args[0],'local'),'lookup_provider_revoke');else await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor.id]);}return result;}};
    const lookup=createBusinessOperationLookup({connectionString:runtimeUrl,environment:'test'},provider,store);
    await assert.rejects(lookup(f.issued.cookieValueForResponse(),{businessId:f.business,operationId:record.operation},signal()),e=>e instanceof BusinessOperationLookupError&&e.message==='BUSINESS_OPERATION_LOOKUP_FAILED'&&e.cause===undefined);assert(changed);
  }
});

const renameInput=(f,patch={})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.authority,expectedVersion:'1',legalName:'Synthetic actual Auth name',...patch});
async function businessHttpFixture(provider=boundary){
  const f=await provision(),actor=await linkActor(f),business=(await client.query('SELECT business_id FROM crest.memberships WHERE actor_id=$1',[actor.id])).rows[0].business_id;
  const server=await authenticationServer({connectionString:runtimeUrl,loginKey:browserKey,owner:{subject:f.subject,factorId:f.factorId}},provider,store,business);
  const issued=await httpLogin(server,f);return {f,actor,business,server,issued,headers:{cookie:issued.pair,'x-crest-csrf':issued.csrfToken}};
}
async function businessHttpFailure(response,status=400,error='BUSINESS_REQUEST_FAILED'){
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error});assert.match(response.headers.get('cache-control'),/no-store/);assert(!response.headers.has('set-cookie'));assert(!response.headers.has('access-control-allow-origin'));
}
test('business socket HTTP reads paused/ready context and commits/replays/looks up one exact typed operation',async()=>{
  const f=await businessHttpFixture();try{
    const before=await sessionRow(f.issued);let response=await f.server.businessRequest('settings',{},f.headers);assert.equal(response.status,200);const editBinding=response.headers.get('x-crest-edit-binding');assert.match(editBinding,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(editBinding,f.issued.evidence.sessionId);const paused=await response.json();assert.equal(paused.writeState,'paused');assert.equal(paused.recoveryEpoch,null);assert.deepEqual(await sessionRow(f.issued),before);
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
    response=await f.server.businessRequest('settings',{},f.headers);assert.equal(response.status,200);assert.equal(response.headers.get('x-crest-edit-binding'),editBinding);const context=await response.json();
    const input={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:context.recoveryEpoch,expectedVersion:context.businessVersion,legalName:' Exact socket synthetic \u00e9 '};
    response=await f.server.businessRequest('rename',input,f.headers);assert.equal(response.status,200);const committed=await response.json();assert.equal(committed.state,'committed');assert.equal(committed.receipt.businessVersion,'2');
    assert.deepEqual(await(await f.server.businessRequest('rename',input,f.headers)).json(),committed);
    const after=await sessionRow(f.issued);assert.deepEqual(await(await f.server.businessRequest('operation',{operationId:input.operationId},f.headers)).json(),committed);assert.deepEqual(await sessionRow(f.issued),after);
    assert.deepEqual(await(await f.server.businessRequest('operation',{operationId:randomUUID()},f.headers)).json(),{state:'absent'});
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[f.business])).rows[0].n,1);assert.equal(await admissionCount(f.issued),6);
    const exporter=await sandbox.connect(target);await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{await exporter.query('SET LOCAL ROLE crest_export');const generationId=randomUUID(),ctx=(await exporter.query('SELECT crest_commands.business_history_export_context($1) AS result',[f.business])).rows[0].result;assert.deepEqual(ctx.recordCounts,{operation:'1',audit_event:'1'});
      const op=(await exporter.query("SELECT * FROM crest_commands.business_history_export_page($1,$2,'operation',NULL,20)",[f.business,ctx.snapshotToken])).rows[0],audit=(await exporter.query("SELECT * FROM crest_commands.business_history_export_page($1,$2,'audit_event',NULL,20)",[f.business,ctx.snapshotToken])).rows[0];
      const o=JSON.parse(op.canonical_evidence).row,a=JSON.parse(audit.canonical_evidence).row;assert.equal(o.operation_id,input.operationId);assert.deepEqual(JSON.parse(o.result),committed.receipt);assert.equal(a.id,committed.receipt.auditEventId);assert.equal(a.operation_id,input.operationId);assert.equal(a.payload,a.hash_input);assert.equal(a.event_hash,createHash('sha256').update(a.hash_input,'utf8').digest('hex'));assert.equal(JSON.parse(a.hash_input).operationId,input.operationId);
      for(const row of [op,audit]){assert.equal(row.representation,'snapshot_projection');assert.equal(row.evidence_hash,createHash('sha256').update(row.canonical_evidence,'utf8').digest('hex'));}
      const records=[op,audit].map((row,index)=>({kind:index===0?'operation':'audit_event',recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash}));
      const historyCollection={formatVersion:1,assurance:'snapshot_bytes_only',generationId,context:ctx,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records},verified=verifyBusinessHistoryEvidence(JSON.stringify(historyCollection),{businessId:f.business});assert.deepEqual(verified.records,records);assert.deepEqual(verified.requiredActorIds,[o.actor_id]);assert.equal(verified.referenceClosureComplete,false);
      const metadataContext=(await exporter.query('SELECT crest_commands.session_metadata_export_context($1,$2) AS result',[o.actor_id,service.issuer])).rows[0].result;
      const metadataRows=(await exporter.query('SELECT * FROM crest_commands.session_metadata_export_page($1,$2,$3,NULL,20)',[o.actor_id,service.issuer,metadataContext.snapshotToken])).rows;const currentMetadata=metadataRows.find(r=>r.record_id===f.issued.evidence.sessionId);assert(currentMetadata);const metadataBody=JSON.parse(currentMetadata.canonical_evidence);assert.equal(metadataBody.row.actor_id,o.actor_id);const nativeMetadata=(await client.query("SELECT to_jsonb(s)-ARRAY['token_hash','provider_token_ciphertext','key_id']||jsonb_build_object('version',version::text) AS row FROM crest_private.app_sessions s WHERE id=$1",[f.issued.evidence.sessionId])).rows[0].row;assert.deepEqual(metadataBody.row,nativeMetadata);assert.equal(currentMetadata.representation,'snapshot_projection');assert.equal(currentMetadata.evidence_hash,createHash('sha256').update(currentMetadata.canonical_evidence,'utf8').digest('hex'));for(const key of ['token_hash','provider_token_ciphertext','key_id'])assert(!Object.hasOwn(metadataBody.row,key));
      const identityContext=(await exporter.query('SELECT crest_commands.business_identity_export_context($1) AS result',[f.business])).rows[0].result;assert.equal(identityContext.recordCounts.role_capability,'5');
      async function identityRows(kind){const out=[];let cursor=null;for(let i=0;i<600;i++){const part=(await exporter.query('SELECT * FROM crest_commands.business_identity_export_page($1,$2,$3,$4,20)',[f.business,identityContext.snapshotToken,kind,cursor])).rows;out.push(...part);if(!part.length){assert.equal(String(out.length),identityContext.recordCounts[kind]);return out;}cursor=part.at(-1).record_id;}assert.fail('identity fixture page budget');}
      const profiles=await identityRows('actor');assert(profiles.some(r=>r.record_id===o.actor_id));
      const identities=await identityRows('identity_event');assert(identities.some(r=>{const row=JSON.parse(r.canonical_evidence).row;return row.entity_kind==='businesses'&&row.entity_id===f.business&&row.entity_version==='2'&&row.operation_id===input.operationId;}));
      for(const r of identities){const row=JSON.parse(r.canonical_evidence).row;assert.equal(row.event_hash,createHash('sha256').update(row.payload,'utf8').digest('hex'));assert.equal(r.evidence_hash,createHash('sha256').update(r.canonical_evidence,'utf8').digest('hex'));assert(row.business_id===null||row.business_id===f.business);}
      const identityRecords=[];for(const [kind,rows] of [['actor',profiles],['role_capability',await identityRows('role_capability')],['identity_event',identities]])for(const r of rows)identityRecords.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});
      const identityCollection={formatVersion:1,assurance:'snapshot_bytes_only',generationId,context:identityContext,evidenceBytes:identityRecords.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records:identityRecords},identityReport=verifyBusinessIdentityEvidence(JSON.stringify(identityCollection),{businessId:f.business});assert.deepEqual(identityReport.records,identityRecords);assert(identityReport.requiredActorIds.includes(o.actor_id));assert(identityReport.requiredConfigurationRows.some(r=>r.entityKind==='businesses'&&r.recordId===f.business&&r.entityVersion==='2'));assert.equal(identityReport.referenceClosureComplete,false);assert.equal(identityReport.configurationCurrentRowsVerified,false);
      const configurationContext=(await exporter.query('SELECT crest_commands.business_configuration_export_context($1) AS result',[f.business])).rows[0].result,configurationRecords=[];
      for(const kind of ['business','membership','recovery_authority']){let cursor=null,count=0,ended=false;for(let i=0;i<52;i++){const rows=(await exporter.query('SELECT * FROM crest_commands.business_configuration_export_page($1,$2,$3,$4,20)',[f.business,configurationContext.snapshotToken,kind,cursor])).rows;for(const r of rows)configurationRecords.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});count+=rows.length;if(!rows.length){ended=true;break;}cursor=rows.at(-1).record_id;}assert(ended);assert.equal(String(count),configurationContext.recordCounts[kind]);}
      const configurationCollection={formatVersion:1,assurance:'snapshot_bytes_only',generationId,context:configurationContext,evidenceBytes:configurationRecords.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records:configurationRecords},foundation=verifyBusinessFoundationEvidence(JSON.stringify(configurationCollection),JSON.stringify(identityCollection),JSON.stringify(historyCollection),{businessId:f.business});
      assert.equal(foundation.configurationCurrentRowsVerified,true);assert.equal(foundation.includedActorReferencesVerified,true);assert(foundation.requiredActorIds.includes(o.actor_id));assert.equal(foundation.consistentCaptureProven,false);assert.equal(foundation.referenceClosureComplete,false);assert.equal(foundation.completePortableExport,false);assert.equal(foundation.completeBackup,false);

    }finally{await exporter.query('ROLLBACK');await exporter.end();}assert.deepEqual(await sessionRow(f.issued),after);assert.equal(await admissionCount(f.issued),6);
    const other=await httpLogin(f.server,f.f),otherResponse=await f.server.businessRequest('settings',{}, {cookie:other.pair,'x-crest-csrf':other.csrfToken});assert.equal(otherResponse.status,200);assert.notEqual(otherResponse.headers.get('x-crest-edit-binding'),editBinding);await otherResponse.json();
  }finally{await f.server.close();}
});
test('business HTTP Origin/CSRF/body/cookie guards do not reserve work or call the SDK',async()=>{
  let providerCalls=0;const provider={...boundary,async verifyAccess(...args){providerCalls++;return boundary.verifyAccess(...args);}},f=await businessHttpFixture(provider);try{
    providerCalls=0;await businessHttpFailure(await f.server.businessRequest('settings',{}, {...f.headers,origin:'https://evil.example.com'}));
    await businessHttpFailure(await f.server.businessRequest('settings',{}, {...f.headers,'x-crest-csrf':randomBytes(32).toString('base64url')}));
    await businessHttpFailure(await f.server.businessRequest('settings',{businessId:randomUUID()},f.headers));
    await businessHttpFailure(await f.server.businessRequest('operation','{"operationId":"a","operationId":"b"}',f.headers));
    await businessHttpFailure(await f.server.businessRequest('settings',{}, {...f.headers,cookie:f.issued.pair+'; '+f.issued.pair}));
    await businessHttpFailure(await f.server.businessRequest('%73ettings',{},f.headers),404);await businessHttpFailure(await f.server.businessRequest('settings',{},f.headers,'GET'),405);
    assert.equal(providerCalls,0);assert.equal(await admissionCount(f.issued),0);
  }finally{await f.server.close();}
});
test('business/proof routes share durable admission; exhaustion stops SDK work and does not borrow logout capacity',async()=>{
  let providerCalls=0;const provider={...boundary,async verifyAccess(...args){providerCalls++;return boundary.verifyAccess(...args);}},f=await businessHttpFixture(provider);try{
    await seedAdmissions(f.issued,119);let response=await f.server.businessRequest('settings',{},f.headers);assert.equal(response.status,200);await response.json();assert.equal(await admissionCount(f.issued),120);providerCalls=0;
    for(const [path,body] of [['settings',{}],['operation',{operationId:randomUUID()}],['rename',{schemaVersion:1,operationId:randomUUID(),expectedVersion:'1',recoveryEpoch:randomUUID(),legalName:'Synthetic'}]])await businessHttpFailure(await f.server.businessRequest(path,body,f.headers),429,'BUSINESS_REQUEST_LIMITED');
    await httpFailure(await f.server.request('session',{}, {cookie:f.issued.pair}));assert.equal(providerCalls,0);assert.equal(await admissionCount(f.issued),120);
    const out=await f.server.request('logout',{},f.headers);assert.equal(out.status,200);assert.equal((await out.json()).localRevoked,true);assert.equal(await admissionCount(f.issued,'logout'),1);
  }finally{await f.server.close();}
});
test('business HTTP conflicts keep reservations and original epochs without automatic context substitution',async()=>{
  const f=await businessHttpFixture();try{
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);const context=await(await f.server.businessRequest('settings',{},f.headers)).json();
    const input={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:context.recoveryEpoch,expectedVersion:context.businessVersion,legalName:'Synthetic committed'};
    assert.equal((await f.server.businessRequest('rename',input,f.headers)).status,200);
    let response=await f.server.businessRequest('rename',{...input,operationId:randomUUID()},f.headers);assert.equal(response.status,409);assert.deepEqual(await response.json(),{state:'conflict',reason:'version',currentVersion:'2'});
    response=await f.server.businessRequest('rename',{...input,legalName:'Mismatched'},f.headers);assert.equal(response.status,409);assert.deepEqual(await response.json(),{state:'conflict',reason:'operation'});
    await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);
    await businessHttpFailure(await f.server.businessRequest('rename',input,f.headers),409,'RECOVERY_REVIEW_REQUIRED');const historical=await(await f.server.businessRequest('operation',{operationId:input.operationId},f.headers)).json();assert.equal(historical.recoveryEpoch,input.recoveryEpoch);
    assert.equal(await admissionCount(f.issued),6);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[f.business])).rows[0].n,1);
  }finally{await f.server.close();}
});
test('fresh SDK verification followed by provider revocation denies business HTTP without source changes',async()=>{
  let revokeNext=false;const provider={...boundary,async verifyAccess(...args){const value=await boundary.verifyAccess(...args);if(revokeNext){revokeNext=false;authResult(await service.admin.admin.signOut(args[0],'local'),'business_http_revoke');}return value;}},f=await businessHttpFixture(provider);try{
    revokeNext=true;await businessHttpFailure(await f.server.businessRequest('settings',{},f.headers),503);assert.equal(await admissionCount(f.issued),1);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[f.business])).rows[0].n,0);
  }finally{await f.server.close();}
});
test('an authenticated device cannot read or mutate another configured business',async()=>{
  const f=await businessHttpFixture(),other=await mutationFixture(),server=await authenticationServer({connectionString:runtimeUrl,loginKey:browserKey,owner:{subject:f.f.subject,factorId:f.f.factorId}},boundary,store,other.business);
  try{
    await businessHttpFailure(await server.businessRequest('settings',{},f.headers),503);
    await businessHttpFailure(await server.businessRequest('operation',{operationId:randomUUID()},f.headers),503);
    await businessHttpFailure(await server.businessRequest('rename',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:other.authority,expectedVersion:'1',legalName:'Forbidden synthetic'},f.headers),403,'BUSINESS_RENAME_DENIED');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[other.business])).rows[0].n,0);
  }finally{await server.close();await f.server.close();}
});
test('a committed business HTTP response discarded by the client is reconciled by explicit lookup before identical retry',async()=>{
  const f=await businessHttpFixture();try{
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);const context=await(await f.server.businessRequest('settings',{},f.headers)).json();
    const input={schemaVersion:1,operationId:randomUUID(),expectedVersion:context.businessVersion,recoveryEpoch:context.recoveryEpoch,legalName:'Synthetic uncertain delivery'};
    const response=await f.server.businessRequest('rename',input,f.headers);assert.equal(response.status,200);await response.body.cancel();
    const known=await(await f.server.businessRequest('operation',{operationId:input.operationId},f.headers)).json();assert.equal(known.state,'committed');assert.deepEqual(await(await f.server.businessRequest('rename',input,f.headers)).json(),known);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1',[f.business])).rows[0].n,1);
  }finally{await f.server.close();}
});
test('actual SDK settings context reads paused/ready state without changing session or supplying reusable authority',async()=>{
  const f=await mutationFixture(),read=createBusinessSettingsContextReader({connectionString:runtimeUrl,environment:'test'},boundary,store),cookie=f.issued.cookieValueForResponse();
  const before=(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[f.issued.evidence.sessionId])).rows[0].row;
  const paused=await read(cookie,f.business,signal());assert.throws(()=>JSON.stringify(paused),BusinessSettingsContextError);
  assert.deepEqual(paused.forServer(),{schemaVersion:1,businessId:f.business,legalName:'Synthetic Auth business',businessVersion:'1',writeState:'paused',recoveryEpoch:null});
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
  const ready=(await read(cookie,f.business,signal())).forServer();assert.equal(ready.recoveryEpoch,f.authority);assert.equal(ready.writeState,'ready');
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[f.issued.evidence.sessionId])).rows[0].row,before);
});
test('genuine SDK verification followed by provider revocation cannot disclose settings',async()=>{
  const f=await mutationFixture();let changed=false;
  const provider={...boundary,async verifyAccess(...args){const result=await boundary.verifyAccess(...args);if(!changed){changed=true;authResult(await service.admin.admin.signOut(args[0],'local'),'settings_provider_revoke');}return result;}};
  const read=createBusinessSettingsContextReader({connectionString:runtimeUrl,environment:'test'},provider,store);
  await assert.rejects(read(f.issued.cookieValueForResponse(),f.business,signal()),e=>e instanceof BusinessSettingsContextError&&e.message==='BUSINESS_SETTINGS_CONTEXT_FAILED'&&e.cause===undefined);assert(changed);
});
test('a fresh context after rotation cannot silently rebase a previously constructed typed command',async()=>{
  const f=await mutationFixture();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
  const read=createBusinessSettingsContextReader({connectionString:runtimeUrl,environment:'test'},boundary,store),run=createBusinessNameCommand({connectionString:runtimeUrl,environment:'test'},boundary,store),cookie=f.issued.cookieValueForResponse();
  const original=(await read(cookie,f.business,signal())).forServer();assert.equal(original.writeState,'ready');const pending=renameInput(f,{recoveryEpoch:original.recoveryEpoch,expectedVersion:original.businessVersion}),epoch=randomUUID();
  await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[epoch,f.business]);assert.equal((await read(cookie,f.business,signal())).forServer().recoveryEpoch,epoch);
  assert.equal(pending.recoveryEpoch,original.recoveryEpoch);await assert.rejects(run(cookie,pending,signal()),e=>e instanceof BusinessNameCommandError&&e.message==='RECOVERY_REVIEW_REQUIRED');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[f.business])).rows[0].n,0);
});
test('actual SDK business command commits once, preserves its receipt across retry and lookup, and advances only foreground activity',async()=>{
  const f=await mutationFixture();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
  const run=createBusinessNameCommand({connectionString:runtimeUrl,environment:'test'},boundary,store),r=renameInput(f),read=createBusinessOperationLookup({connectionString:runtimeUrl,environment:'test'},boundary,store),cookie=f.issued.cookieValueForResponse();
  const before=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[f.issued.evidence.sessionId])).rows[0];
  const result=await run(cookie,r,signal());assert.equal(result.forServer().state,'committed');assert.throws(()=>JSON.stringify(result),BusinessNameCommandError);assert.equal(result.forServer().receipt.businessVersion,'2');
  assert.deepEqual((await run(cookie,r,signal())).forServer(),result.forServer());assert.deepEqual((await read(cookie,{businessId:f.business,operationId:r.operationId},signal())).forServer(),result.forServer());
  const source=(await client.query('SELECT legal_name,version::text FROM crest.businesses WHERE id=$1',[f.business])).rows[0];assert.deepEqual(source,{legal_name:r.legalName,version:'2'});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[f.business,r.operationId])).rows[0].n,1);
  const after=(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[f.issued.evidence.sessionId])).rows[0];assert(after.last_active_at>=before.last_active_at);for(const field of ['authenticated_at','reauth_at','expires_at','provider_token_ciphertext','key_id'])assert.deepEqual(after[field],before[field]);
  const conflict=(await run(cookie,renameInput(f),signal())).forServer();assert.deepEqual(conflict,{state:'conflict',reason:'version',currentVersion:'2'});
});
test('genuine SDK verification followed by provider or membership revocation cannot commit a typed rename',async()=>{
  for(const kind of ['provider','membership']){
    const f=await mutationFixture();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);let changed=false;
    if(kind==='membership'){const backup=await linkActor(await provision());await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[f.business,backup.id,f.actor.id]);}
    const provider={...boundary,async verifyAccess(...args){const result=await boundary.verifyAccess(...args);if(!changed){changed=true;if(kind==='provider')authResult(await service.admin.admin.signOut(args[0],'local'),'rename_provider_revoke');else await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor.id]);}return result;}};
    const run=createBusinessNameCommand({connectionString:runtimeUrl,environment:'test'},provider,store),r=renameInput(f),before=(await client.query('SELECT to_jsonb(b) AS row FROM crest.businesses b WHERE id=$1',[f.business])).rows[0].row;
    await assert.rejects(run(f.issued.cookieValueForResponse(),r,signal()),e=>e instanceof BusinessNameCommandError&&e.message==='BUSINESS_RENAME_DENIED'&&e.cause===undefined);assert(changed);assert.deepEqual((await client.query('SELECT to_jsonb(b) AS row FROM crest.businesses b WHERE id=$1',[f.business])).rows[0].row,before);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1',[f.business])).rows[0].n,0);
  }
});
test('actual typed command rejects paused writes and stale-epoch replay while historical lookup preserves the original receipt',async()=>{
  const f=await mutationFixture(),run=createBusinessNameCommand({connectionString:runtimeUrl,environment:'test'},boundary,store),r=renameInput(f),cookie=f.issued.cookieValueForResponse();
  await assert.rejects(run(cookie,r,signal()),e=>e instanceof BusinessNameCommandError&&e.message==='RECOVERY_REVIEW_REQUIRED'&&e.cause===undefined);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);const result=(await run(cookie,r,signal())).forServer();
  await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);await assert.rejects(run(cookie,r,signal()),e=>e instanceof BusinessNameCommandError&&e.message==='RECOVERY_REVIEW_REQUIRED');
  const read=createBusinessOperationLookup({connectionString:runtimeUrl,environment:'test'},boundary,store);assert.deepEqual((await read(cookie,{businessId:f.business,operationId:r.operationId},signal())).forServer(),result);
});

test('exact maintenance removal after a genuine local stop erases provider authority and preserves another device',async()=>{
 const f=await provision(),actor=await linkActor(f),other=await issue(f);let material;
 const gate={...boundary,authenticatePasswordTotp:async(...args)=>{material=await boundary.authenticatePasswordTotp(...args);return material;},verifyAccess:async()=>{throw new ProviderAuthenticationError();},signOutLocal:async()=>{throw new ProviderAuthenticationError();}};
 await lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));assert(material);
 const row=(await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND id<>$2',[actor.id,other.evidence.sessionId])).rows[0];assert(row?.revoked_at);assert.equal(row.provider_token_ciphertext,null);assert.equal(row.key_id,null);
 const stopped=(await client.query("SELECT id FROM crest_private.provider_login_finishes f JOIN crest_private.provider_login_attempts a ON a.attempt_id=f.attempt_id WHERE a.reserved_app_session_id=$1 AND phase='stopped_review'",[row.id])).rows[0];const selected=await cleanupRequest(actor,stopped.id);assert.equal((await reconciliationReview(actor,selected.evidence.attemptId)).reviewState,'cleanup_outcome_unconfirmed_review');const r=await executeDuringEvidenceSnapshot(actor,selected.evidence.requestId);assert.equal((await reconciliationReview(actor,selected.evidence.attemptId)).reviewState,'cleanup_outcome_recorded');assert.equal(r.evidence.outcome,'provider_removed');assert.equal(r.evidence.providerSessionId,material.identity.sessionId);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[material.identity.sessionId])).rows[0].n,0);assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.mfa_amr_claims WHERE session_id=$1',[material.identity.sessionId])).rows[0].n,0);await cryptographicallyValid(material);await denied(boundary.verifyAccess(access(material),bound(material)));const sdk=service.sdk();await sdk.initialize();const refreshed=await sdk.refreshSession({refresh_token:material.tokensForServerStorage().refreshToken});assert(refreshed.error);assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);assert.deepEqual(await executeCleanup(actor,selected.evidence.requestId),r);
});
test('provider removal while a genuine MFA result is held prevents later app issuance and preserves another device',async()=>{
 const f=await provision(),actor=await linkActor(f),other=await issue(f);let entered,release,material;
 const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});const gate={...boundary,authenticatePasswordTotp:async(...args)=>{material=await boundary.authenticatePasswordTotp(...args);entered();await held;return material;}};
 const result=lifecycleDenied(issue(f,false,createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},gate,store)));let attempt,r;
 try{await atBarrier(ready);attempt=(await client.query('SELECT * FROM crest_private.provider_login_attempts WHERE actor_id=$1 AND reserved_app_session_id<>$2',[actor.id,other.evidence.sessionId])).rows[0];assert.equal((await reconciliationReview(actor,attempt.attempt_id)).reviewState,'finish_unconfirmed_review');const c=await sandbox.connect(runtimeUrl);let stop;try{await c.query('SET ROLE crest_web');stop=(await c.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[attempt.attempt_id,actor.id,attempt.issued_security_epoch,service.issuer,f.subject,'stopped_review'])).rows[0].result;}finally{await c.end();}const selected=await cleanupRequest(actor,stop.evidence.finishId);r=await executeDuringEvidenceSnapshot(actor,selected.evidence.requestId);assert.equal((await reconciliationReview(actor,attempt.attempt_id)).reviewState,'cleanup_outcome_recorded');assert.equal(r.evidence.outcome,'provider_removed');assert.equal(r.evidence.providerSessionId,material.identity.sessionId);}finally{release();}await result;
 assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[attempt.reserved_app_session_id])).rows[0].n,0);await denied(boundary.verifyAccess(access(material),bound(material)));assert.equal((await lifecycle.verify(other.cookieValueForResponse(),signal())).sessionId,other.evidence.sessionId);
});

async function reconciliationReview(actor,attemptId){const c=await sandbox.connect(target);try{await c.query('SET ROLE crest_inventory');return (await c.query('SELECT * FROM crest_commands.provider_reconciliation_review($1,$2,NULL,100)',[actor.id,service.issuer])).rows.find(r=>r.attempt_id===attemptId)?.observation;}finally{await c.end();}}

async function executeDuringEvidenceSnapshot(actor,requestId){
 const c=await sandbox.connect(target);let result;
 const rows=ctx=>c.query("SELECT * FROM crest_commands.provider_evidence_export_page($1,$2,$3,'cleanup_outcome',NULL,20)",[actor.id,service.issuer,ctx.snapshotToken]).then(r=>r.rows);
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
  await c.query('SET LOCAL ROLE crest_inventory');const ctx=(await c.query('SELECT crest_commands.provider_evidence_export_context($1,$2) AS result',[actor.id,service.issuer])).rows[0].result;
  assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);assert(BigInt(ctx.ledgerCounts.cleanup_outcome)<20n);assert(!(await rows(ctx)).some(r=>r.record_id===requestId));
  result=await executeCleanup(actor,requestId);assert(!(await rows(ctx)).some(r=>r.record_id===requestId));
 }finally{await c.query('ROLLBACK');await c.end();}
 const fresh=await sandbox.connect(target);await fresh.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
  await fresh.query('SET LOCAL ROLE crest_inventory');const ctx=(await fresh.query('SELECT crest_commands.provider_evidence_export_context($1,$2) AS result',[actor.id,service.issuer])).rows[0].result;
  const saved=(await fresh.query("SELECT * FROM crest_commands.provider_evidence_export_page($1,$2,$3,'cleanup_outcome',NULL,20)",[actor.id,service.issuer,ctx.snapshotToken])).rows.find(r=>r.record_id===requestId);
  assert.equal(saved.canonical_evidence,result.canonicalEvidence);assert.equal(saved.evidence_hash,createHash('sha256').update(saved.canonical_evidence,'utf8').digest('hex'));
  await verifyReferenceSnapshot(fresh,actor);
 }finally{await fresh.query('ROLLBACK');await fresh.end();}return result;
}

async function verifyReferenceSnapshot(connection,actor){
 const ctx=(await connection.query('SELECT crest_commands.provider_reference_export_context($1,$2) AS result',[actor.id,service.issuer])).rows[0].result;
 assert.equal(ctx.scope,'provider_session_references');const groups={};
 for(const kind of ['session_identity','session_event','cleanup_reference']){const rows=[];let cursor=null;for(let i=0;i<30;i++){const part=(await connection.query('SELECT * FROM crest_commands.provider_reference_export_page($1,$2,$3,$4,$5,20)',[actor.id,service.issuer,ctx.snapshotToken,kind,cursor])).rows;rows.push(...part);if(part.length<20)break;cursor=part.at(-1).record_id;}
  assert.equal(String(rows.length),ctx.ledgerCounts[kind]);for(const row of rows)assert.equal(row.evidence_hash,createHash('sha256').update(row.canonical_evidence,'utf8').digest('hex'));groups[kind]=rows;
 }
 const expected=(await client.query("SELECT id AS record_id,'stored_payload'::text AS representation,payload::text AS canonical_evidence,event_hash AS evidence_hash FROM crest_private.session_events WHERE actor_id=$1 ORDER BY id",[actor.id])).rows;assert.deepEqual(groups.session_event,expected);assert(groups.session_identity.length>0);
 for(const row of groups.session_identity){assert.equal(row.representation,'snapshot_projection');const b=JSON.parse(row.canonical_evidence);assert.equal(b.actorId,actor.id);assert.equal(b.providerIssuer,service.issuer);assert.equal((await client.query('SELECT provider_session_id FROM crest_private.app_sessions WHERE id=$1',[row.record_id])).rows[0].provider_session_id,b.providerSessionId);}
 for(const row of groups.cleanup_reference){assert.equal(row.representation,'snapshot_projection');const b=JSON.parse(row.canonical_evidence),event=groups.session_event.find(e=>e.record_id===b.sourceEventId);assert(event);assert.equal(event.evidence_hash,b.sourceEventHash);assert.equal(JSON.parse(event.canonical_evidence).after.id,b.appSessionId);assert.equal(typeof b.sourceVersion,'string');}
 const text=Object.values(groups).flat().map(r=>r.canonical_evidence).join('\n');for(const key of ['token_hash','provider_token_ciphertext','key_id','access_token','refresh_token'])assert(!text.includes('"'+key+'"'));
 const evidence=(await connection.query('SELECT crest_commands.provider_evidence_export_context($1,$2) AS result',[actor.id,service.issuer])).rows[0].result,records=[];
 for(const kind of ['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome']){let cursor=null,count=0;for(let i=0;i<30;i++){const part=(await connection.query('SELECT * FROM crest_commands.provider_evidence_export_page($1,$2,$3,$4,$5,20)',[actor.id,service.issuer,evidence.snapshotToken,kind,cursor])).rows;for(const r of part)records.push({kind,recordId:r.record_id,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});count+=part.length;if(part.length<20)break;cursor=part.at(-1).record_id;}assert.equal(String(count),evidence.ledgerCounts[kind]);}
 for(const kind of ['session_identity','session_event','cleanup_reference'])for(const r of groups[kind])records.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});
 const collection={formatVersion:2,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:evidence,referenceContext:ctx,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records};
 const verified=verifyProviderRecoveryEvidenceCollection(JSON.stringify(collection),{actorId:actor.id,issuer:service.issuer});assert.equal(verified.assurance,'internal_consistency_only');assert.deepEqual(verified.records,records);
 await connection.query('SET LOCAL ROLE crest_export');try{
  const metadataContext=(await connection.query('SELECT crest_commands.session_metadata_export_context($1,$2) AS result',[actor.id,service.issuer])).rows[0].result,metadataRecords=[];let cursor=null,ended=false;
  for(let i=0;i<52;i++){const rows=(await connection.query('SELECT * FROM crest_commands.session_metadata_export_page($1,$2,$3,$4,20)',[actor.id,service.issuer,metadataContext.snapshotToken,cursor])).rows;for(const r of rows)metadataRecords.push({kind:'session_metadata',recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});if(!rows.length){ended=true;break;}cursor=rows.at(-1).record_id;}assert(ended);assert.equal(String(metadataRecords.length),metadataContext.recordCount);
  const metadata={formatVersion:1,assurance:'snapshot_bytes_only',generationId:collection.generationId,context:metadataContext,evidenceBytes:metadataRecords.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records:metadataRecords},joined=verifySessionRecoveryEvidence(JSON.stringify(metadata),JSON.stringify(collection),{actorId:actor.id,issuer:service.issuer});
  assert.deepEqual(joined.metadata.records,metadataRecords);assert.deepEqual(joined.provider.records,records);assert(joined.requiredActorIds.includes(actor.id));assert.equal(joined.consistentCaptureProven,false);assert.equal(joined.referenceClosureComplete,false);assert.equal(joined.completePortableExport,false);assert.equal(joined.completeBackup,false);
 }finally{await connection.query('SET LOCAL ROLE crest_inventory');}
}
