// Genuine Auth/MFA, restricted backend login, actual PostgreSQL/COMMIT.
// Unregistered proposals apply only inside this disposable synthetic fixture.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {TOTP,URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createServiceDirectory} from '../../src/commercial/service-directory.ts';
import {createCustomerDirectory} from '../../src/customer/customer-directory.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap;
const signal=()=>new AbortController().signal;
const payload=(patch={})=>({code:'synthetic-'+randomUUID(),active:true,definition:{name:'Synthetic Auth interior',inclusions:'Vacuum.\nApplicable leather care.',exclusions:'No exterior protection.',internalGuidance:'Synthetic private note',rangeLowCents:'0',rangeHighCents:null,estimatedSeconds:'5430'},...patch});
const request=(f,patch={})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,serviceId:randomUUID(),expectedRevision:'0',payload:payload(),...patch});
async function transaction(run){await client.query('BEGIN');try{const v=await run();await client.query('COMMIT');return v;}catch(e){await client.query('ROLLBACK');throw e;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);const prior=(await sandbox.apply(target,await sandbox.prefix(43))).history;
 for(const name of ['service-catalog-storage','service-catalog-commands']){
  const sql=await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'),meta=JSON.parse(await readFile(new URL('../../planning/proposals/'+name+'.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);await transaction(()=>client.query(sql));
 }
 assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(43))).history,prior); // observe owned proposal roles for cleanup
 login='crest_catalog_auth_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));
 tokens=await createProviderTokenStore('synthetic-catalog',[{id:'synthetic-catalog',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function fixture(){
 const email='synthetic-catalog-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url');
 const user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'catalog_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'catalog_enroll_password');
 const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic catalog MFA'}),'catalog_enroll'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'catalog_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic catalog Auth owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic catalog Auth business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return{actor,business,epoch};
 });
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal());
 return{...f,issued,credential:issued.cookieValueForResponse(),api:createServiceDirectory(config,boundary,tokens)};
}
async function facts(f){return(await client.query("SELECT jsonb_build_object('services',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM crest.services s WHERE business_id=$1),'content',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.service_versions v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM crest_private.operations o WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM crest_private.audit_events a WHERE business_id=$1),'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM crest_private.app_sessions s WHERE actor_id=$2))::text AS value",[f.business,f.actor])).rows[0].value;}
const list=(f,patch={})=>f.api.list(f.credential,{businessId:f.business,search:'',afterId:null,includeInactive:true,pageSize:20,...patch},signal());
const history=(f,id,patch={})=>f.api.history(f.credential,{businessId:f.business,serviceId:id,afterRevision:'0',pageSize:20,...patch},signal());

test('genuine MFA service adapter commits, retains scope, archives/reopens and resolves original results',async()=>{
 const f=await fixture(),r=request(f),first=await f.api.save(f.credential,r,signal());assert.equal(first.forServer().state,'committed');assert.throws(()=>JSON.stringify(first),/SERVICE_VALUE_PRIVATE/);
 const revised={...r,operationId:randomUUID(),expectedRevision:'1',payload:{...r.payload,definition:{...r.payload.definition,name:'Revised synthetic scope'}}};await f.api.save(f.credential,revised,signal());
 const archived={...revised,operationId:randomUUID(),expectedRevision:'2',payload:{...revised.payload,active:false}},v3=await f.api.save(f.credential,archived,signal());assert.equal(v3.forServer().receipt.contentAuditEventId,null);
 const reopened={...archived,operationId:randomUUID(),expectedRevision:'3',payload:{...archived.payload,active:true}};await f.api.save(f.credential,reopened,signal());
 const h=(await history(f,r.serviceId)).forServer();assert.deepEqual(h.history.map(v=>v.action),['create','edit','archive','reopen']);assert.deepEqual(h.history.map(v=>v.content.sequence),['1','2','2','2']);assert.equal(h.service.version,'4');
 assert.deepEqual((await f.api.save(f.credential,r,signal())).forServer(),first.forServer());assert.deepEqual((await f.api.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal())).forServer(),first.forServer());
 assert.equal((await list(f)).forServer().services[0].content.name,'Revised synthetic scope');const page=(await history(f,r.serviceId,{pageSize:2})).forServer();assert.equal(page.hasMore,true);assert.equal((await history(f,r.serviceId,{afterRevision:'2',pageSize:2})).forServer().hasMore,false);
});
test('genuine adapter no-op and stale conflicts preserve exact source, audit, claim and activity',async()=>{
 const f=await fixture(),r=request(f);await f.api.save(f.credential,r,signal());const before=await facts(f),noop={...r,operationId:randomUUID(),expectedRevision:'1'};
 assert.deepEqual((await f.api.save(f.credential,noop,signal())).forServer(),{state:'unchanged',serviceId:r.serviceId,currentRevision:'1'});assert.equal(await facts(f),before);
 const stale={...r,operationId:randomUUID()};assert.deepEqual((await f.api.save(f.credential,stale,signal())).forServer(),{state:'conflict',reason:'version',currentRevision:'1'});assert.equal(await facts(f),before);
 assert.deepEqual((await f.api.lookup(f.credential,{businessId:f.business,operationId:noop.operationId},signal())).forServer(),{state:'absent'});
});
test('genuine other owner cannot save, read history or retrieve original receipts for the business',async()=>{
 const f=await fixture(),other=await fixture(),r=request(f);await f.api.save(f.credential,r,signal());const before=await facts(f);
 await assert.rejects(f.api.save(other.credential,request(f),signal()),e=>e.message==='SERVICE_SAVE_DENIED');
 await assert.rejects(f.api.history(other.credential,{businessId:f.business,serviceId:r.serviceId,afterRevision:'0',pageSize:20},signal()),e=>e.message==='SERVICE_REQUEST_FAILED');
 await assert.rejects(f.api.lookup(other.credential,{businessId:f.business,operationId:r.operationId},signal()),e=>e.message==='SERVICE_REQUEST_FAILED');assert.equal(await facts(f),before);
});
test('genuine local revoke, provider deletion and AAL downgrade refuse before catalog submission',async()=>{
 for(const kind of ['local','provider','aal']){
  const f=await fixture();if(kind==='local')await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.issued.evidence.sessionId]);
  else if(kind==='provider')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);else await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[f.issued.evidence.provider.sessionId]);
  const before=await facts(f);await assert.rejects(f.api.save(f.credential,request(f),signal()),e=>e.message==='SERVICE_SAVE_NOT_SUBMITTED');await assert.rejects(list(f),e=>e.message==='SERVICE_REQUEST_FAILED');assert.equal(await facts(f),before);
 }
});
test('genuine recovery pause and changed epoch preserve reads and require original authority review',async()=>{
 const f=await fixture(),r=request(f),v=await f.api.save(f.credential,r,signal());await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);const before=await facts(f);
 await assert.rejects(f.api.save(f.credential,r,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual((await f.api.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal())).forServer(),v.forServer());assert.equal((await history(f,r.serviceId)).forServer().service.id,r.serviceId);assert.equal(await facts(f),before);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,randomUUID()]);await assert.rejects(f.api.save(f.credential,r,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.equal(await facts(f),before);
});
test('actual deferred COMMIT refusal withholds success and leaves original lookup absent',async()=>{
 const f=await fixture(),r=request(f),before=await facts(f);
 await client.query("CREATE FUNCTION public.crest_catalog_adapter_probe() RETURNS trigger LANGUAGE plpgsql AS $probe$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic commit refusal'; END $probe$");await client.query('CREATE CONSTRAINT TRIGGER crest_catalog_adapter_probe AFTER INSERT OR UPDATE ON crest.services DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.crest_catalog_adapter_probe()');
 try{await assert.rejects(f.api.save(f.credential,r,signal()),e=>e.message==='SERVICE_SAVE_OUTCOME_UNKNOWN');assert.equal(await facts(f),before);assert.deepEqual((await f.api.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal())).forServer(),{state:'absent'});}
 finally{await client.query('DROP TRIGGER crest_catalog_adapter_probe ON crest.services');await client.query('DROP FUNCTION public.crest_catalog_adapter_probe()');}
 assert.equal((await f.api.save(f.credential,r,signal())).forServer().state,'committed');assert.equal(JSON.parse(await facts(f)).operations.length,1);
});
test('actual audit failure rolls back the source and foreground activity before explicit same-operation retry',async()=>{
 const f=await fixture(),r=request(f),before=await facts(f);await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_catalog_adapter_refusal CHECK(entity_kind NOT IN('services','service_versions')) NOT VALID");
 try{await assert.rejects(f.api.save(f.credential,r,signal()),e=>e.message==='SERVICE_SAVE_OUTCOME_UNKNOWN');assert.equal(await facts(f),before);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_catalog_adapter_refusal');}
 assert.equal((await f.api.save(f.credential,r,signal())).forServer().state,'committed');assert.equal(JSON.parse(await facts(f)).operations.length,1);
});
test('genuine customer operation collision preserves the earlier customer and its receipt',async()=>{
 const f=await fixture(),r=request(f),customers=createCustomerDirectory(config,boundary,tokens),customer=randomUUID();const first=await customers.save(f.credential,{schemaVersion:1,businessId:f.business,operationId:r.operationId,recoveryEpoch:f.epoch,customerId:customer,expectedVersion:'0',draft:{displayName:'Synthetic prior customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}},signal());const before=await facts(f);
 assert.deepEqual((await f.api.save(f.credential,r,signal())).forServer(),{state:'conflict',reason:'operation'});assert.equal(await facts(f),before);assert.deepEqual((await customers.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal())).forServer(),first.forServer());
});
test('invalid input and cancellation never leave a catalog operation',async()=>{
 const f=await fixture(),before=await facts(f),r=request(f);await assert.rejects(f.api.save(f.credential,{...r,expectedRevision:'0\n'},signal()),e=>e.message==='SERVICE_SAVE_NOT_SUBMITTED');const abort=new AbortController();abort.abort();await assert.rejects(f.api.save(f.credential,r,abort.signal),e=>e.message==='SERVICE_SAVE_NOT_SUBMITTED');assert.equal(await facts(f),before);
});
