// Genuine password/TOTP, restricted field commands and private HTTP on registered54.
// Not physical-device or owner delivery acceptance.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {field54Candidate} from '../support/field54-candidate.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {sessionCredentialHash} from '../../src/security/session-credential.ts';
import {createBookingDirectory} from '../../src/operations/confirmed-booking-directory.ts';
import {createFieldDirectory} from '../../src/operations/field-directory.ts';
import {fieldSessionOriginal} from '../../src/operations/field-session-contract.ts';
import {createOriginalOperationDirectory} from '../../src/security/original-operation-directory.ts';
import {createSchedulingHttp} from '../../src/operations/scheduling-http.ts';
import {createBrowserSessionFlow} from '../../src/security/browser-session-flow.ts';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {scheduling} from '../../src/client/scheduling.ts';
import {lookupSchedulingOriginal} from '../../src/client/scheduling-original.ts';
import {createPendingSchedulingStore} from '../../src/client/pending-scheduling.ts';
let sandbox,target,client,web,service,login,config,boundary,tokens,lifecycle,bootstrap,owner,other;
const providerFailures=[];
const signal=()=>new AbortController().signal;
async function transaction(work){await client.query('BEGIN');try{const result=await work();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
async function fixture(){
 const email='synthetic-booking-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'booking_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'booking_enroll_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic booking MFA'}),'booking_enroll'),totp=URI.parse(factor.totp.uri);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'booking_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic booking owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic booking business','America/Indiana/Indianapolis',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return {actor,business,epoch};
 });
 const generatedAt=Date.now();let issued;
 try{issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal());}
 catch(error){console.log('SYNTHETIC_FIELD_LOGIN_DIAGNOSTIC '+JSON.stringify({elapsedMs:Date.now()-generatedAt,codeGeneratedAtStepMs:generatedAt%30000,providerFailures,serviceFailures:service.diagnostics()}));throw error;}
 const credential=issued.cookieValueForResponse(),verified=await lifecycle.verify(credential,signal(),'background'),hash=sessionCredentialHash(credential);
 try{
  const parent=await createConfirmedBookingFixture({client,web,bootstrap})({...f,issuer:verified.provider.issuer,subject:verified.provider.subject,session:verified.sessionId,provider:verified.provider.sessionId,hash,deadline:new Date(verified.provider.expiresAt)});
  const rig=randomUUID(),payload={label:'Synthetic field equipment rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null};
  assert.equal((await web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',[...parent.auth(),parent.epoch,randomUUID(),rig,payload])).rows[0].result.state,'committed');
  const api=createBookingDirectory(config,boundary,tokens,true),q=confirmedBookingRequest(parent);q.payload.appointment.contact_snapshot={kind:'phone',value:'+12025550123'};
  assert.equal((await api.book(credential,q,signal())).forServer().state,'committed');
  return {...parent,credential,subject:user.id,factorId:factor.id,rig,job:q.jobId,api,field:createFieldDirectory(config,boundary,tokens)};
 }finally{hash.fill(0);}
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(53));
 const candidate=await field54Candidate(sandbox);assert.equal((await sandbox.apply(target)).registrySha256,candidate.registrySha256);
 login='crest_field_auth_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 service=await startRealAuthService(target,{diagnostic:true});const actualBoundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));
 const observed=method=>async(...args)=>{const at=Date.now();try{return await actualBoundary[method](...args);}catch(error){if(providerFailures.length<32)providerFailures.push({stage:method,elapsedMs:Date.now()-at,kind:['denied','unavailable','uncertain'].includes(error?.kind)?error.kind:'other'});throw error;}};
 boundary=Object.freeze({...actualBoundary,authenticatePasswordTotp:observed('authenticatePasswordTotp'),verifyAccess:observed('verifyAccess')});tokens=await createProviderTokenStore('synthetic-booking',[{id:'synthetic-booking',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await fixture();other=await fixture();
},{timeout:240000});
after(async()=>{await service?.close();await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function withSchedulingHttp(f,run,{enabled=true,fieldEnabled=true,businessId=f.business,dropOperation=null}={}){
 let origin,handler,providerCalls=0;const counted=Object.freeze({...boundary,verifyAccess:async(...args)=>{providerCalls++;return boundary.verifyAccess(...args);}});
 const server=createServer(async(req,res)=>{try{const incoming=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:req,duplex:'half'}:{})}),response=await handler(incoming,transportFromIncomingMessage(req));if(dropOperation&&req.url==='/api/business/scheduling/field-save'){res.destroy();return;}res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  origin='http://127.0.0.1:'+server.address().port;const httpConfig={...config,origin,businessId,ingress:{kind:'direct'}};handler=createSchedulingHttp(httpConfig,counted,tokens,enabled,enabled,fieldEnabled);
  const flow=createBrowserSessionFlow({...httpConfig,loginKey:randomBytes(32),owner:{subject:f.subject,factorId:f.factorId}},counted,tokens),session=await flow.session({method:'POST',headers:new Headers({origin,'content-type':'application/json'})},f.credential,signal());
  const post=async(body,headers={},path='/api/business/scheduling/original',method='POST')=>{
   const response=await fetch(origin+path,{method,redirect:'error',headers:{origin,'content-type':'application/json',cookie:'__Host-crest_session='+f.credential,'x-crest-csrf':session.csrfTokenForResponse(),...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});
   assert.match(response.headers.get('cache-control')??'',/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');return {status:response.status,value:await response.json(),allow:response.headers.get('allow'),fieldSession:response.headers.get('x-crest-field-session')};
  };assert(providerCalls>0);await run(post,()=>providerCalls,{origin,proof:{csrfToken:session.csrfTokenForResponse(),expiresAt:session.evidence.expiresAt}});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

const request=(f,action,version,patch={})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,jobId:f.job,expectedJobVersion:version,body:action==='depart'?{action,reason:null,trip:{drivenVehicleId:f.rig,origin:{schemaVersion:1,kind:'manual',locationText:'Synthetic equipment base',instructions:null},etaAt:null,notes:null}}:{action,reason:action==='pause'||action==='direct_arrive'?'Synthetic recorded reason':null},...patch});
const save=(f,q)=>f.field.saveSession(f.credential,q,signal());
const lookup=(f,q)=>f.api.lookupOriginal(f.credential,fieldSessionOriginal(q),signal());
const facts=async()=>{const out={};for(const name of ['jobs','work_intervals','travel_legs','operator_occupancy','job_events'])out[name]=(await client.query('SELECT row_to_json(v)::text AS row FROM crest.'+name+' v ORDER BY row_to_json(v)::text COLLATE "C"')).rows;out.auditEvents=(await client.query('SELECT row_to_json(v)::text AS row FROM crest_private.audit_events v ORDER BY row_to_json(v)::text COLLATE "C"')).rows;out.operations=(await client.query('SELECT row_to_json(v)::text AS row FROM crest_private.operations v ORDER BY row_to_json(v)::text COLLATE "C"')).rows;return out;};
const wire=q=>Object.fromEntries(Object.entries(q).filter(([key])=>key!=='businessId'));
let departed,arrived,paused,resumed;
test('genuine MFA departure commits one travel leg and verified private original after acknowledged COMMIT',async()=>{
 departed=request(owner,'depart','1');const value=await save(owner,departed),r=value.forServer();assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.sourceVersion,'2');assert.throws(()=>JSON.stringify(value),/FIELD_VALUE_PRIVATE/);assert.deepEqual((await lookup(owner,departed)).forServer(),r);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.travel_legs WHERE business_id=$1',[owner.business])).rows[0].n,1);
});
test('a fresh authenticated job read reloads en-route state and state-change history',async()=>{
 const api=createBookingDirectory(config,boundary,tokens,true),detail=(await api.read(owner.credential,{businessId:owner.business,jobId:owner.job},signal())).forServer();assert.equal(detail.job.state,'en_route');assert.equal(detail.job.version,'2');
 const page=(await api.history(owner.credential,{businessId:owner.business,jobId:owner.job,throughVersion:'2',afterVersion:'0',pageSize:20},signal())).forServer();assert.deepEqual(page.events.map(e=>e.action),['book','state_change']);assert.equal(page.events.at(-1).toState,'en_route');
});
test('genuine arrival closes travel and starts work; replay adds no source or audit rows',async()=>{
 arrived=request(owner,'arrive','2');const r=(await save(owner,arrived)).forServer();assert.equal(r.result.receipt.sourceVersion,'3');const before=await facts();assert.deepEqual((await save(owner,arrived)).forServer(),r);assert.deepEqual(await facts(),before);
 assert.equal((await owner.api.read(owner.credential,{businessId:owner.business,jobId:owner.job},signal())).forServer().job.state,'in_progress');
});
test('pause and resume retain exact source originals across fresh adapter reads',async()=>{
 paused=request(owner,'pause','3');assert.equal((await save(owner,paused)).forServer().result.receipt.sourceVersion,'4');resumed=request(owner,'resume','4');const r=(await save(owner,resumed)).forServer();assert.equal(r.result.receipt.sourceVersion,'5');
 const fresh=createBookingDirectory(config,boundary,tokens,true);assert.deepEqual((await fresh.lookupOriginal(owner.credential,fieldSessionOriginal(resumed),signal())).forServer(),r);assert.equal((await fresh.read(owner.credential,{businessId:owner.business,jobId:owner.job},signal())).forServer().job.state,'in_progress');
 const page=(await fresh.history(owner.credential,{businessId:owner.business,jobId:owner.job,throughVersion:'5',afterVersion:'0',pageSize:20},signal())).forServer();assert.deepEqual(page.events.map(e=>e.toState),['scheduled','en_route','in_progress','paused','in_progress']);
});
test('stale version, invalid state and changed-body replay refuse without mutation',async()=>{
 const before=await facts();assert.deepEqual((await save(owner,request(owner,'pause','4'))).forServer(),{state:'conflict',reason:'version'});assert.deepEqual((await save(owner,request(owner,'resume','5'))).forServer(),{state:'conflict',reason:'state'});assert.deepEqual((await save(owner,{...paused,body:{action:'pause',reason:'Changed synthetic body'}})).forServer(),{state:'conflict',reason:'operation'});assert.deepEqual(await facts(),before);
});
test('foreign business authority and copied session inputs cannot mutate or read another owner field original',async()=>{
 const before=await facts();await assert.rejects(save(other,request(owner,'pause','5')),/FIELD_SAVE_OUTCOME_UNKNOWN/);await assert.rejects(lookup(other,paused),/BOOKING_REQUEST_FAILED/);assert.deepEqual((await save(other,request(other,'direct_arrive','1',{jobId:owner.job}))).forServer(),{state:'conflict',reason:'job'});assert.deepEqual(await facts(),before);
});
test('recovery write pause refuses field saves while genuine original lookup remains available',async()=>{
 const before=await facts();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[owner.business]);try{await assert.rejects(save(owner,request(owner,'pause','5')),/RECOVERY_REVIEW_REQUIRED/);assert.equal((await lookup(owner,paused)).forServer().result.state,'committed');assert.deepEqual(await facts(),before);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[owner.business]);}
});
test('a real deferred COMMIT failure is uncertain and rolls back field, audit and operation rows',async()=>{
 const f=await fixture(),q=request(f,'direct_arrive','1'),before=await facts();await client.query("CREATE FUNCTION pg_temp.field_http_commit_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1899',MESSAGE='SYNTHETIC_FIELD_COMMIT_REFUSAL'; END $$");await client.query('CREATE CONSTRAINT TRIGGER synthetic_field_http_commit_refusal AFTER INSERT ON crest.work_intervals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.field_http_commit_refusal()');
 try{await assert.rejects(save(f,q),/FIELD_SAVE_OUTCOME_UNKNOWN/);}finally{await client.query('DROP TRIGGER synthetic_field_http_commit_refusal ON crest.work_intervals');}assert.deepEqual(await facts(),before);assert.deepEqual((await lookup(f,q)).forServer(),{state:'absent'});
});
test('private HTTP advertises field capability only when enabled and retains CSRF/origin/tenant/body boundaries',async()=>{
 const f=await fixture(),q=request(f,'direct_arrive','1');await withSchedulingHttp(f,async(post,calls)=>{
  assert.equal((await post({}, {},'/api/business/scheduling/workspace')).fieldSession,'1');const count=calls();for(const headers of [{'x-crest-csrf':''},{origin:'https://foreign-synthetic.example'},{cookie:''}])assert.equal((await post(wire(q),headers,'/api/business/scheduling/field-save')).status,400);
  assert.equal((await post({...wire(q),businessId:other.business},{},'/api/business/scheduling/field-save')).status,400);assert.equal((await post({...wire(q),body:{...q.body,unexpected:true}},{},'/api/business/scheduling/field-save')).status,400);assert.equal(calls(),count);assert.equal((await post({}, {},'/api/business/scheduling/field-save?job=private')).status,404);assert.equal((await post({}, {},'/api/business/scheduling/field-save','GET')).allow,'POST');
  const result=await post(wire(q),{},'/api/business/scheduling/field-save');assert.equal(result.status,200);assert.equal(result.value.result.receipt.sourceVersion,'2');assert.deepEqual(result.value,(await lookup(f,q)).forServer());
 });await withSchedulingHttp(f,async post=>{assert.equal((await post({}, {},'/api/business/scheduling/workspace')).fieldSession,null);assert.equal((await post(wire(q),{},'/api/business/scheduling/field-save')).status,503);},{fieldEnabled:false});
});
test('lost HTTP acknowledgement remains recoverable through the existing typed original route without a retry',async()=>{
 const f=await fixture(),q=request(f,'direct_arrive','1');await withSchedulingHttp(f,async post=>{await assert.rejects(post(wire(q),{},'/api/business/scheduling/field-save'));},{dropOperation:q.operationId});
 await withSchedulingHttp(f,async post=>{const r=await post({originalJson:JSON.stringify(fieldSessionOriginal(q))});assert.equal(r.status,200);assert.equal(r.value.result.receipt.sourceVersion,'2');});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[f.business,q.operationId])).rows[0].n,1);
});
test('explicit reviewed retirement blocks a late field write and preserves its absent source',async()=>{
 const f=await fixture(),q=request(f,'direct_arrive','1'),original=fieldSessionOriginal(q),review=createOriginalOperationDirectory(config,boundary,tokens);assert.equal((await review.retire(f.credential,{schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Owner reviewed this fictional interrupted request'},signal())).forServer().state,'retired');const before=await facts();assert.deepEqual((await save(f,q)).forServer(),{state:'conflict',reason:'operation'});assert.deepEqual(await facts(),before);assert.equal((await review.lookup(f.credential,original,signal())).forServer().state,'retired');
});
test('revoked genuine session and already aborted input are refused before field submission',async()=>{
 const f=await fixture(),q=request(f,'direct_arrive','1'),before=await facts(),controller=new AbortController();controller.abort();await assert.rejects(f.field.saveSession(f.credential,q,controller.signal),/FIELD_SAVE_NOT_SUBMITTED/);await lifecycle.logout(f.credential,signal());await assert.rejects(save(f,q),/FIELD_SAVE_NOT_SUBMITTED/);assert.deepEqual(await facts(),before);
});
test('the actual browser client saves field actions, reloads history and recovers a lost reply with only an opaque pending reference',async()=>{
 const f=await fixture();await withSchedulingHttp(f,async(post,calls,transport)=>{
  const actualFetch=globalThis.fetch;let dropNext=false,deliveries=0;
  globalThis.fetch=async(input,options)=>{if(typeof input==='string'&&input.startsWith('/api/business/scheduling/')){const headers=new Headers(options?.headers);headers.set('origin',transport.origin);headers.set('cookie','__Host-crest_session='+f.credential);const r=await actualFetch(transport.origin+input,{...options,headers});if(input.endsWith('/field-save')){deliveries++;if(dropNext){dropNext=false;await r.arrayBuffer();throw Error('Synthetic lost field acknowledgement');}}return r;}return actualFetch(input,options);};
  try{
   const context=await scheduling.workspace(transport.proof,signal());assert.equal(context.fieldSessionAvailable,true);const q=request(f,'depart','1'),saved=await scheduling.saveFieldSession(q,transport.proof,signal());assert.equal(saved.result.receipt.sourceVersion,'2');
   assert.equal((await scheduling.read(f.business,f.job,transport.proof,signal())).job.state,'en_route');const arrive=request(f,'arrive','2'),original=fieldSessionOriginal(arrive),memory=new Map(),store=createPendingSchedulingStore({getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},'operations.job.field');
   store.write({schemaVersion:1,businessId:f.business,binding:context.binding,reference:original.reference});dropNext=true;await assert.rejects(scheduling.saveFieldSession(arrive,transport.proof,signal()),e=>e.kind==='unknown');assert.equal(deliveries,2);assert.equal(memory.size,1);assert(![...memory.values()][0].includes('Synthetic'));
   const pinned=store.read();store.require(pinned);const recovered=await lookupSchedulingOriginal(original,transport.proof,signal());assert.equal(recovered.receipt.sourceVersion,'3');store.clear(pinned);assert.equal(memory.size,0);assert.equal(deliveries,2);
   assert.equal((await scheduling.read(f.business,f.job,transport.proof,signal())).job.state,'in_progress');const history=await scheduling.history({businessId:f.business,jobId:f.job,throughVersion:'3',afterVersion:'0',pageSize:20},transport.proof,signal());assert.deepEqual(history.events.map(e=>e.toState),['scheduled','en_route','in_progress']);
  }finally{globalThis.fetch=actualFetch;}
 });
});
test('two genuine adapters racing the same observed job commit one start and return one stale conflict',async()=>{
 const f=await fixture(),a=request(f,'direct_arrive','1'),b=request(f,'direct_arrive','1'),results=await Promise.all([save(f,a),save(f,b)]),values=results.map(r=>r.forServer());assert.equal(values.filter(r=>'result'in r&&r.result.state==='committed').length,1);assert.deepEqual(values.find(r=>r.state==='conflict'),{state:'conflict',reason:'version'});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.work_intervals WHERE business_id=$1',[f.business])).rows[0].n,1);
});
