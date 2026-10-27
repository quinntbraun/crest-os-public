// Genuine Auth + restricted SQL admission bridge. Disposable synthetic data only.
// Proposal is applied inside this fixture, never registered or production enabled.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {TOTP,URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createSourceExportExecutionAccess,consumeSourceExportExecutionAdmission} from '../../src/security/source-export-execution-access.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap;
const signal=()=>new AbortController().signal,release='a'.repeat(40);
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(43))).history.length,43);
 await client.query('BEGIN');try{await client.query(await readFile(new URL('../../planning/proposals/source-export-execution-admission.sql',import.meta.url),'utf8'));await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
 login='crest_admission_auth_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);
 boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));
 tokens=await createProviderTokenStore('synthetic-admission-auth',[{id:'synthetic-admission-auth',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function fixture(){
 const email='synthetic-admission-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url');
 const user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'admission_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'admission_enrollment_password');
 const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic admission MFA'}),'admission_enrollment'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);
 authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'admission_enrollment_verify');
 let actor,business,epoch;await client.query('BEGIN');try{
  actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic admission Auth owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic admission Auth business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse();
 const original={schemaVersion:1,businessId:business,commandType:'export.request',reference:{operationId:randomUUID(),recoveryEpoch:epoch,exportJobId:randomUUID(),appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}};
 return{business,actor,epoch,issued,credential,original,access:createSourceExportExecutionAccess(config,boundary,tokens,business,release)};
}
async function facts(f){const out={};for(const table of ['export_jobs','operations','audit_events'])out[table]=(await client.query('SELECT to_jsonb(t) AS value FROM crest_private.'+table+' t WHERE business_id=$1 ORDER BY id',[f.business])).rows;return out;}
test('genuine Auth admission mints one private observation after actual COMMIT and never from a recorded replay',async()=>{
 const f=await fixture(),value=await f.access.request(f.credential,f.original,signal());
 assert.equal(value.state,'created');const saved=await facts(f);assert.equal(saved.operations.length,1);assert.equal(saved.audit_events.length,1);assert.equal(saved.export_jobs.length,1);
 assert.deepEqual(saved.operations[0].value.result,value.forServer().receipt);
 const work=consumeSourceExportExecutionAdmission(value,signal());assert.deepEqual(work.command,f.original);assert.equal(work.job.actor_id,f.actor);
 assert.throws(()=>JSON.stringify(value),/SOURCE_EXPORT_EXECUTION_PRIVATE/);assert.throws(()=>consumeSourceExportExecutionAdmission(value,signal()),/SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED/);
 const repeated=await f.access.request(f.credential,f.original,signal());assert.equal(repeated.state,'recorded');assert.deepEqual(repeated.forServer(),value.forServer());
 assert.throws(()=>consumeSourceExportExecutionAdmission(repeated,signal()),/SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED/);assert.deepEqual(await facts(f),saved);
});
test('genuine Auth admission refuses local revocation and provider-session loss without original writes',async()=>{
 for(const kind of ['local','provider']){
  const f=await fixture(),saved=await facts(f);
  if(kind==='local')await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.issued.evidence.sessionId]);
  else await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);
  await assert.rejects(f.access.request(f.credential,f.original,signal()),e=>e.message==='SOURCE_EXPORT_EXECUTION_NOT_SUBMITTED');assert.deepEqual(await facts(f),saved);
 }
});
test('genuine Auth admission retains the current recovery pause and epoch fences',async()=>{
 for(const rotate of [false,true]){
  const f=await fixture(),saved=await facts(f);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=$2,active_epoch=$3,version=version+1 WHERE business_id=$1',[f.business,rotate,rotate?randomUUID():f.epoch]);
  await assert.rejects(f.access.request(f.credential,f.original,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await facts(f),saved);
 }
});
test('genuine Auth admission rolls back actual SQL audit failure; explicit retry can create exactly once',async()=>{
 const f=await fixture(),saved=await facts(f);
 await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_admission_auth_refusal CHECK(entity_kind<>'export_jobs') NOT VALID");
 try{await assert.rejects(f.access.request(f.credential,f.original,signal()),e=>e.message==='SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');assert.deepEqual(await facts(f),saved);}
 finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_admission_auth_refusal');}
 const created=await f.access.request(f.credential,f.original,signal());assert.equal(created.state,'created');assert.equal(consumeSourceExportExecutionAdmission(created,signal()).job.id,f.original.reference.exportJobId);assert.equal((await facts(f)).operations.length,1);
});
test('genuine Auth admission never accepts another authenticated owner for the retained business',async()=>{
 const f=await fixture(),other=await fixture(),saved=await facts(f);
 await assert.rejects(f.access.request(other.credential,f.original,signal()),e=>e.message==='SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth admission conflict never mints another observation or original',async()=>{
 const f=await fixture();await f.access.request(f.credential,f.original,signal());const saved=await facts(f);
 const changed=structuredClone(f.original);changed.reference.exportJobId=randomUUID();
 const conflict=await f.access.request(f.credential,changed,signal());assert.equal(conflict.state,'conflict');assert.equal(conflict.forServer().reason,'operation');
 assert.throws(()=>consumeSourceExportExecutionAdmission(conflict,signal()),/SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED/);assert.deepEqual(await facts(f),saved);
});
