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
import { createProviderTokenStore,ProviderTokenStorageError } from '../../src/security/provider-token-store.ts';
import { createSessionCredential } from '../../src/security/session-credential.ts';
import { createSessionRevoker } from '../../src/security/session-revocation-db.ts';
import { createSessionLifecycle,SessionLifecycleError } from '../../src/security/session-lifecycle.ts';

let sandbox,client,target,service,lookup,boundary,login,loginOwned=false,runtimeUrl,keys,revoke,lifecycle,store,prior,receipt,refreshReceipt,legacy,legacyBefore;
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
  refreshReceipt=await sandbox.apply(target);
  store=await createProviderTokenStore('primary',[{id:'primary',key:randomBytes(32)}]);
  lifecycle=createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},boundary,store);
});
after(async()=>{await service?.close();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
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
  assert.deepEqual((await sandbox.apply(target)).history,refreshReceipt.history);
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
  const f=await provision(),actor=await linkActor(f),issued=await issue(f),cookie=issued.cookieValueForResponse();
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
  const f=await provision(),actor=await linkActor(f),material=await fresh(f),credential=createSessionCredential(),id=randomUUID();
  const encrypted=await store.encrypt(material.tokensForServerStorage(),{actorId:actor.id,appSessionId:id,securityEpoch:actor.current_security_epoch,providerSessionId:material.identity.sessionId,subject:f.subject,issuer:service.issuer});
  const args=[id,credential.hashForDatabase(),actor.id,actor.current_security_epoch,service.issuer,f.subject,material.identity.sessionId,new Date(material.identity.passwordAt),new Date(material.identity.totpAt),false,Buffer.from(encrypted.ciphertext),encrypted.keyId,randomUUID()];
  const sql='SELECT crest_commands.issue_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)';
  for(const [index,value] of [[3,randomUUID()],[5,randomUUID()],[6,randomUUID()],[1,Buffer.alloc(31)],[7,new Date(Date.now()-16*60*1000)],[8,new Date(Date.now()+60000)],[9,null]]){
    const altered=[...args];altered[index]=value;await asWeb(async()=>{await assert.rejects(client.query(sql,altered),e=>['42501','22023'].includes(e.code));});
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query(sql,args),e=>e.code==='25001');}finally{await client.query('ROLLBACK');}
  await asWeb(async()=>{await client.query(sql,args);});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE id=$1',[id])).rows[0].n,0);
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

test('schema7 grants only ciphertext/provenance updates and rejects stale, malformed or nonfresh SQL calls',async()=>{
  for(const field of ['provider_token_ciphertext','key_id','version','updated_by','operation_id'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.app_sessions',$1,'UPDATE') AS allowed",[field])).rows[0].allowed,true);
  for(const field of ['id','actor_id','token_hash','provider_session_id','issued_security_epoch','authenticated_at','created_at','reauth_at','last_active_at','expires_at','trusted','revoked_at'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.app_sessions',$1,'UPDATE') AS allowed",[field])).rows[0].allowed,false);
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
  const short=await startRealAuthService(target,{jwtExpiry:8});
  try{
    const f=await provision({provider:short});await linkActor(f,short.issuer);
    const provider=createProviderBoundary({issuer:short.issuer,publicKey:short.publicKey,environment:'test'},lookup);
    const gate=createSessionLifecycle({connectionString:runtimeUrl,environment:'test'},provider,store),issued=await issue(f,false,gate),before=await sessionRow(issued);
    const remaining=issued.evidence.provider.expiresAt-Date.now();assert(remaining>0&&remaining<=8000,'actual Auth must apply the short test-only JWT lifetime');
    await delay(remaining+25);const evidence=await gate.verify(issued.cookieValueForResponse(),signal()),after=await sessionRow(issued);
    assert(evidence.provider.expiresAt>Date.now());assert.equal(evidence.provider.passwordAt,issued.evidence.provider.passwordAt);assert.equal(evidence.provider.totpAt,issued.evidence.provider.totpAt);
    assert.equal(BigInt(after.version),BigInt(before.version)+1n);unchangedSession(before,after);
  }finally{await short.close();}
});
