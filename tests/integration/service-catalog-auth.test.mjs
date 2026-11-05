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
import {createOriginalOperationDirectory} from '../../src/security/original-operation-directory.ts';
import {bindServiceOriginalReceipt} from '../../src/commercial/service-original-operation.ts';
import {createServer} from 'node:http';
import {createServiceHttp} from '../../src/commercial/service-http.ts';
import {createBrowserSessionFlow} from '../../src/security/browser-session-flow.ts';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap;
const registered44=process.env.CREST_CATALOG_TEST_PROFILE==='registered44';
assert(process.env.CREST_CATALOG_TEST_PROFILE===undefined||registered44,'only the explicit catalog construction/registered44 fixtures are supported');
const signal=()=>new AbortController().signal;
const payload=(patch={})=>({code:'synthetic-'+randomUUID(),active:true,definition:{name:'Synthetic Auth interior',inclusions:'Vacuum.\nApplicable leather care.',exclusions:'No exterior protection.',internalGuidance:'Synthetic private note',rangeLowCents:'0',rangeHighCents:null,estimatedSeconds:'5430'},...patch});
const request=(f,patch={})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,serviceId:randomUUID(),expectedRevision:'0',payload:payload(),...patch});
async function transaction(run){await client.query('BEGIN');try{const v=await run();await client.query('COMMIT');return v;}catch(e){await client.query('ROLLBACK');throw e;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);const prior=(await sandbox.apply(target,await sandbox.prefix(43))).history;
 if(registered44){
  const current=await sandbox.apply(target,await sandbox.prefix(44));assert.equal(current.history.length,44);assert.deepEqual(current.history.slice(0,43),prior);
  assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(44))).history,current.history);
 }else{
  for(const name of ['service-catalog-storage','service-catalog-commands','service-catalog-resolution']){
   const sql=await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'),meta=JSON.parse(await readFile(new URL('../../planning/proposals/'+name+'.json',import.meta.url),'utf8'));
   assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);await transaction(()=>client.query(sql));
  }
  assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(43))).history,prior); // observe owned proposal roles for cleanup
 }
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
 return{...f,issued,subject:user.id,factorId:factor.id,credential:issued.cookieValueForResponse(),api:createServiceDirectory(config,boundary,tokens)};
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
const originalRef=(f,r)=>({schemaVersion:1,businessId:f.business,commandType:'catalog.service.save',reference:{operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,serviceId:r.serviceId,expectedRevision:r.expectedRevision}});
test('genuine MFA owner retires only the absent catalog original and late save cannot replay it',async()=>{
 const f=await fixture(),r=request(f),original=originalRef(f,r),recovery=createOriginalOperationDirectory(config,boundary,tokens);
 assert.equal((await recovery.lookup(f.credential,original,signal())).forServer().state,'absent');
 const intent={schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Owner reviewed this lost service scope.'},saved=await recovery.retire(f.credential,intent,signal()),decision=saved.forServer();assert.equal(decision.state,'retired');assert.throws(()=>JSON.stringify(saved),/ORIGINAL_OPERATION_VALUE_PRIVATE/);
 assert.deepEqual((await recovery.lookup(f.credential,original,signal())).forServer(),decision);assert.deepEqual((await recovery.retire(f.credential,intent,signal())).forServer(),decision);
 assert.deepEqual((await f.api.save(f.credential,r,signal())).forServer(),{state:'conflict',reason:'operation'});
 const stored=JSON.parse(await facts(f));assert.equal(stored.services.length,0);assert.equal(stored.operations.length,1);assert.equal(stored.audit.length,1);
});
test('genuine MFA catalog observation still requires its exact typed original receipt',async()=>{
 const f=await fixture(),r=request(f),original=originalRef(f,r),first=(await f.api.save(f.credential,r,signal())).forServer(),recovery=createOriginalOperationDirectory(config,boundary,tokens);
 const observation=(await recovery.retire(f.credential,{schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Check original before replacing.'},signal())).forServer();assert.equal(observation.state,'original_recorded');
 assert.throws(()=>bindServiceOriginalReceipt(observation,original));assert.deepEqual(bindServiceOriginalReceipt((await f.api.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal())).forServer(),original),first);
 const wrong={...original,reference:{...original.reference,serviceId:randomUUID()}};assert.throws(()=>bindServiceOriginalReceipt(first,wrong));assert.equal(JSON.parse(await facts(f)).operations.length,1);
});
test('genuine provider revocation blocks catalog retirement before claiming an original',async()=>{
 const f=await fixture(),r=request(f),original=originalRef(f,r),recovery=createOriginalOperationDirectory(config,boundary,tokens),provider=JSON.parse(await facts(f)).sessions[0].provider_session_id;
 await client.query('DELETE FROM auth.sessions WHERE id=$1',[provider]);const before=await facts(f);
 await assert.rejects(recovery.retire(f.credential,{schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Must not commit after provider revocation.'},signal()),e=>e.message==='ORIGINAL_OPERATION_NOT_SUBMITTED');assert(await facts(f)===before,'provider loss must not claim a catalog retirement or change local activity');
});

async function withHttp(f,run,enabled=true){
 let origin,handler;
 // Actual loopback sockets are permitted only by environment:test. Production
 // still requires TLS, fixed origin and trusted incoming-message evidence.
 const server=createServer(async(req,res)=>{try{
  const incoming=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:req,duplex:'half'}:{})});
  const response=await handler(incoming,transportFromIncomingMessage(req));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  origin='http://127.0.0.1:'+server.address().port;const httpConfig={...config,origin,businessId:f.business,ingress:{kind:'direct'}};
  handler=createServiceHttp(httpConfig,boundary,tokens,enabled);
  const flow=createBrowserSessionFlow({...httpConfig,loginKey:randomBytes(32),owner:{subject:f.subject,factorId:f.factorId}},boundary,tokens);
  const session=await flow.session({method:'POST',headers:new Headers({origin,'content-type':'application/json'})},f.credential,signal());
  const post=async(route,value={},headers={})=>{
   const response=await fetch(origin+'/api/business/services/'+route,{method:'POST',redirect:'error',headers:{origin,'content-type':'application/json',cookie:'__Host-crest_session='+f.credential,'x-crest-csrf':session.csrfTokenForResponse(),...headers},body:typeof value==='string'?value:JSON.stringify(value)});
   assert.match(response.headers.get('cache-control')??'',/no-store/);return{status:response.status,value:await response.json(),binding:response.headers.get('x-crest-edit-binding')};
  };
  await run(post);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
function wire(r){const{businessId,payload,...ref}=r;void businessId;return{...ref,code:payload.code,active:payload.active,...payload.definition};}
const businessFacts=async f=>{const all=JSON.parse(await facts(f));return JSON.stringify({services:all.services,operations:all.operations,audit:all.audit});};
test('genuine authenticated catalog HTTP saves, reloads, edits and retains its original receipt/history',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  const context=await post('context');assert.equal(context.status,200);assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.equal(context.value.businessId,f.business);assert.equal(context.value.recoveryEpoch,f.epoch);
  const saved=await post('save',wire(r));assert.equal(saved.status,200);const first=bindServiceOriginalReceipt(saved.value,originalRef(f,r));assert.equal(first.receipt.serviceRevision,'1');
  let page=await post('list',{search:'Auth interior',afterId:null,includeInactive:false,pageSize:20});assert.equal(page.status,200);assert.equal(page.value.services[0].content.name,r.payload.definition.name);
  const edit=request(f,{serviceId:r.serviceId,expectedRevision:'1',payload:{...r.payload,definition:{...r.payload.definition,name:'Synthetic revised scope'}}});
  const changed=await post('save',wire(edit));assert.equal(changed.status,200);assert.equal(changed.value.receipt.serviceRevision,'2');
  const original=await post('operation',{operationId:r.operationId});assert.deepEqual(original.value,first);
  const history=await post('history',{serviceId:r.serviceId,afterRevision:'0',pageSize:20});assert.equal(history.status,200);assert.equal(history.value.history.length,2);assert.equal(history.value.history[0].content.name,r.payload.definition.name);assert.equal(history.value.history[1].content.name,edit.payload.definition.name);
  const stale=await post('save',wire(request(f,{serviceId:r.serviceId,expectedRevision:'1',payload:r.payload})));assert.equal(stale.status,409);assert.deepEqual(stale.value,{state:'conflict',reason:'version',currentRevision:'2'});
  const noChange=await post('save',wire(request(f,{serviceId:r.serviceId,expectedRevision:'2',payload:edit.payload})));assert.deepEqual(noChange.value,{state:'unchanged',serviceId:r.serviceId,currentRevision:'2'});
 });
});
test('actual catalog HTTP rejects authority injection, duplicate keys and invalid CSRF without business writes',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  const before=await businessFacts(f);
  assert.equal((await post('save',{...wire(r),businessId:randomUUID()})).status,400);
  const duplicate=JSON.stringify(wire(r)).replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1');assert.equal((await post('save',duplicate)).status,400);
  assert.equal((await post('save',wire(r),{'x-crest-csrf':randomBytes(32).toString('base64url')})).status,400);
  assert.equal((await post('save',wire(r),{origin:'https://foreign.example.com'})).status,400);
  assert(await businessFacts(f)===before,'rejected catalog requests must not change source, operations or audit');
 });
});
test('actual catalog HTTP provider loss rejects a save without claiming the operation',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);const before=await businessFacts(f),result=await post('save',wire(r));
  assert.equal(result.status,503);assert.equal(result.value.error,'SERVICE_SAVE_NOT_SUBMITTED');assert(await businessFacts(f)===before,'revoked provider cannot claim a catalog save');
 });
});
test('actual catalog HTTP remains closed without explicit candidate composition',async()=>{
 const f=await fixture();await withHttp(f,async post=>{const before=await businessFacts(f);assert.equal((await post('context')).status,404);assert.equal((await post('save',wire(request(f)))).status,404);assert(await businessFacts(f)===before,'closed candidate HTTP must not change business facts');},false);
});
