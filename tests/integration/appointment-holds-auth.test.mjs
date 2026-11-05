// Genuine password/TOTP, app session/CSRF and actual Node HTTP composition.
// A test-only relative-URL/cookie transport bridge runs the real browser clients
// in Node. It does not fabricate Auth/SQL responses or prove browser cookie/TLS
// acceptance. All accounts, businesses, ports and data are disposable synthetic.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'rolldown';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {TOTP,URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
let createProviderBoundary,createLiveProviderSessionLookup,createProviderTokenStore,createBoundedNodeServer,bindApplicationHandler,writeAuthenticationResponse,createHoldHttp,transportFromIncomingMessage,authentication,customers,appointmentHolds;
async function runtime(){
 const root=fileURLToPath(new URL('../../',import.meta.url));await mkdir(join(root,'.local'),{recursive:true});const directory=await mkdtemp(join(root,'.local/appointment-auth-runtime-')),entry=join(directory,'entry.ts'),output=join(directory,'runtime.mjs');
 const exports=[['src/security/provider-auth.ts',['createProviderBoundary']],['src/security/provider-session-db.ts',['createLiveProviderSessionLookup']],['src/security/provider-token-store.ts',['createProviderTokenStore']],['src/server/node-server.ts',['createBoundedNodeServer','bindApplicationHandler','writeAuthenticationResponse']],['src/operations/appointment-hold-http.ts',['createHoldHttp']],['src/security/trusted-transport.ts',['transportFromIncomingMessage']],['src/client/authentication.ts',['authentication']],['src/client/customers.ts',['customers']],['src/client/appointment-holds.ts',['appointmentHolds']]];
 await writeFile(entry,exports.map(([file,names])=>'export {'+names.join(',')+'} from '+JSON.stringify(join(root,file).replaceAll('\\','/'))+';').join('\n'));
 await build({input:entry,platform:'node',external:id=>id!=='server-only'&&!id.startsWith('.')&&!isAbsolute(id),resolve:{conditionNames:['react-server','node','import','default']},output:{file:output,format:'esm',minify:false,sourcemap:false},onwarn(warning){throw Error('QUOTE_REVIEW_AUTH_RUNTIME_BUILD_FAILED:'+warning.code);}});
 const compiled=await readFile(output);console.log('SYNTHETIC_QUOTE_REVIEW_RUNTIME '+JSON.stringify({sha256:sha(compiled),bytes:compiled.length}));return import(pathToFileURL(output).href);
}
const sha=value=>createHash('sha256').update(value).digest('hex'),signal=()=>new AbortController().signal,sqlUrl=new URL('../../supabase/migrations/20261028040000_appointment_proposals.sql',import.meta.url),metaUrl=new URL('../../planning/APPOINTMENT_SCHEMA47_ADOPTION.json',import.meta.url),sql=await readFile(sqlUrl,'utf8'),metadataText=await readFile(metaUrl,'utf8'),meta=JSON.parse(metadataText),source={sqlSha256:sha(sql),metadataSha256:sha(metadataText),sqlBytes:Buffer.byteLength(sql)},loginKey=randomBytes(32);
let sandbox,target,client,service,login,config,provider,tokens,bootstrap,prior;
async function transaction(work){await client.query('BEGIN');try{const result=await work();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
before(async()=>{
 ({createProviderBoundary,createLiveProviderSessionLookup,createProviderTokenStore,createBoundedNodeServer,bindApplicationHandler,writeAuthenticationResponse,createHoldHttp,transportFromIncomingMessage,authentication,customers,appointmentHolds}=await runtime());
 assert.equal(meta.repositoryRegistration,47);assert.equal(meta.migration.sha256,source.sqlSha256);assert.equal(meta.migration.bytes,source.sqlBytes);
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=(await sandbox.apply(target,await sandbox.prefix(47))).history;assert.equal(prior.length,47);
 login='crest_review_http_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);provider=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));tokens=await createProviderTokenStore('synthetic-review-http',[{id:'synthetic-review-http',key:randomBytes(32)}]);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 console.log('SYNTHETIC_QUOTE_REVIEW_SOURCE '+JSON.stringify(source));
},{timeout:240000});
after(async()=>{try{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);}finally{await sandbox?.close();const current={sqlSha256:sha(await readFile(sqlUrl)),metadataSha256:sha(await readFile(metaUrl))};console.log('SYNTHETIC_QUOTE_REVIEW_SOURCE_AFTER '+JSON.stringify({...current,sourceUnchanged:current.sqlSha256===source.sqlSha256&&current.metadataSha256===source.metadataSha256,registeredReleaseClaim:false}));}});
async function fixture(){
 const email='synthetic-review-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'review_http_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'review_http_enroll_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic review HTTP MFA'}),'review_http_enroll'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'review_http_enroll_verify');
 const f=await transaction(async()=>{const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic review HTTP owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id,business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic review HTTP business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return {actor,business,epoch};});
 return {...f,subject:user.id,factorId:factor.id,credentials:()=>({email,password,code:totp.generate(),trusted:false})};
}
async function withHttp(f,work,{reviewEnabled=true,businessId=f.business,factoryOnly=false}={}){
 const realFetch=globalThis.fetch,server=createBoundedNodeServer(),jar=new Map(),requests=[],responses=[];let origin,dropNext=null,providerCalls=0;
 const counted=Object.freeze({...provider,verifyAccess:async(...args)=>{providerCalls++;return provider.verifyAccess(...args);}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;assert.notEqual(server.address().port,4319);
 // The real login protocol pins one server key per database. Each ephemeral
 // listener shares that key; this preserves rather than resets admission.
 const settings={...config,origin,businessId,loginKey,owner:{subject:f.subject,factorId:f.factorId},ingress:{kind:'direct'}};
 if(factoryOnly){const handler=createHoldHttp(settings,counted,tokens);server.on('request',(request,response)=>{void(async()=>{const r=await handler(new Request(origin+request.url,{method:request.method,headers:request.headers,...request.method==='POST'?{body:Readable.toWeb(request),duplex:'half'}:{}}),transportFromIncomingMessage(request));await writeAuthenticationResponse(response,r,signal());})().catch(()=>response.destroy());});}
 else bindApplicationHandler(server,{origin,environment:'test',authentication:{configuration:settings,provider:counted,tokens},business:{businessId},customers:true,operationResolution:true,syntheticAppointmentHolds:reviewEnabled},async(_request,response)=>{response.writeHead(404);response.end();});
 server.prependListener('request',request=>requests.push(new URL(request.url,origin).pathname));
 globalThis.fetch=async(resource,options)=>{
  if(typeof resource!=='string'||!resource.startsWith('/api/'))return realFetch(resource,options);
  const headers=new Headers(options?.headers);headers.set('origin',origin);if(jar.size)headers.set('cookie',[...jar].map(([name,value])=>name+'='+value).join('; '));const response=await realFetch(origin+resource,{...options,headers});responses.push({path:resource,status:response.status});
  for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';',1)[0],at=first.indexOf('='),name=first.slice(0,at),value=first.slice(at+1);assert(['__Host-crest_login','__Host-crest_session'].includes(name));assert.match(cookie,/; Secure(?:;|$)/);assert.match(cookie,/; HttpOnly(?:;|$)/);if(/; Max-Age=0(?:;|$)/.test(cookie))jar.delete(name);else jar.set(name,value);}
  if(resource===dropNext){dropNext=null;await response.arrayBuffer();throw new Error('SYNTHETIC_REVIEW_ACKNOWLEDGMENT_DROPPED');}return response;
 };
 try{
  if(!factoryOnly)await authentication.login(f.credentials(),signal());assert(factoryOnly||jar.has('__Host-crest_session'));const proof=()=>authentication.session(signal());
  const raw=async(path,body={},patch={})=>{const p=factoryOnly?null:await proof(),headers={'content-type':'application/json',...p?{'x-crest-csrf':p.csrfToken}:{},...patch};const response=await fetch('/api/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers,body:JSON.stringify(body)});assert.match(response.headers.get('cache-control')??'',/no-store/);return {status:response.status,value:await response.json(),headers:response.headers};};
  await work({proof,raw,requests,responses,drop(path){dropNext=path;},providerCalls:()=>providerCalls,credential:()=>jar.get('__Host-crest_session')});
 }finally{globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

async function seed(f,http){
 const customerId=randomUUID(),p=await http.proof();assert.equal((await customers.save(f.business,{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:f.epoch,customerId,expectedVersion:'0',draft:{displayName:'Synthetic appointment recipient',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}},p,signal())).state,'committed');
 return {schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,holdId:randomUUID(),expectedSequence:'0',payload:{customer_id:customerId,lead_id:null,label:'Synthetic proposed time é 雪',state:'proposed',start_at:'2026-10-29T14:00:00.123456Z',end_at:'2026-10-29T15:00:00.123456Z',timezone:'America/Indiana/Indianapolis',local_start:'2026-10-29T10:00:00.123456',local_end:'2026-10-29T11:00:00.123456',start_offset_minutes:-240,end_offset_minutes:-240,notes:'PRIVATE_SYNTHETIC_PROPOSAL_NOTE',reason:null}};
}
const reference=r=>({operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,holdId:r.holdId,expectedSequence:r.expectedSequence});
test('genuine password/MFA session saves, reopens, revises, withdraws and retrieves exact original',async()=>{
 const f=await fixture();await withHttp(f,async http=>{
 const context=await appointmentHolds.context(await http.proof(),signal());assert.equal(context.context.businessId,f.business);assert.equal(context.context.recoveryEpoch,f.epoch);
 const r=await seed(f,http),saved=await appointmentHolds.save(r,await http.proof(),signal());assert.equal(saved.state,'committed');assert.equal(saved.receipt.sequence,'1');
 const revised={...r,operationId:randomUUID(),expectedSequence:'1',payload:{...r.payload,label:'Revised proposed time',reason:'Owner reviewed changed request'}},changed=await appointmentHolds.save(revised,await http.proof(),signal());assert.equal(changed.receipt.sequence,'2');
 const withdrawn=await appointmentHolds.save({...revised,operationId:randomUUID(),expectedSequence:'2',payload:{...revised.payload,state:'withdrawn',reason:'Owner withdrew unconfirmed proposal'}},await http.proof(),signal());assert.equal(withdrawn.receipt.sequence,'3');
 const history=await appointmentHolds.history(f.business,{holdId:r.holdId,afterSequence:'0',pageSize:20},await http.proof(),signal());assert.equal(history.currentSequence,'3');assert.equal(history.versions[0].notes,r.payload.notes);assert.equal(history.versions[2].state,'withdrawn');assert.equal(history.versions[0].start_at,r.payload.start_at);
 assert.deepEqual(await appointmentHolds.lookup(f.business,reference(r),await http.proof(),signal()),saved);assert.equal((await appointmentHolds.list(f.business,{afterId:null,pageSize:5},await http.proof(),signal())).holds[0].state,'withdrawn');
 });assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(47))).history,prior);
});
test('actual stale request remains a definite nonchange and foreign session cannot read configured business',async()=>{
 const f=await fixture();await withHttp(f,async http=>{const r=await seed(f,http);assert.equal((await appointmentHolds.save(r,await http.proof(),signal())).state,'committed');const conflict=await appointmentHolds.save({...r,operationId:randomUUID()},await http.proof(),signal());assert.deepEqual(conflict,{state:'conflict',reason:'version',currentSequence:'1'});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.appointment_hold_versions WHERE business_id=$1',[f.business])).rows[0].n,1);});
 const foreign=await fixture();await withHttp(foreign,async http=>{await assert.rejects(appointmentHolds.context(await http.proof(),signal()));assert.equal((await http.raw('business/appointment-holds/list',{afterId:null,pageSize:5})).status,503);},{businessId:f.business});
});
test('paused authority prevents new write while original receipt remains readable',async()=>{
 const f=await fixture();await withHttp(f,async http=>{const r=await seed(f,http),saved=await appointmentHolds.save(r,await http.proof(),signal());await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(appointmentHolds.save({...r,operationId:randomUUID()},await http.proof(),signal()),e=>e.kind==='recovery');assert.deepEqual(await appointmentHolds.lookup(f.business,reference(r),await http.proof(),signal()),saved);});
});
test('lost real acknowledgment remains unknown without retry and resolves exact original',async()=>{
 const f=await fixture();await withHttp(f,async http=>{const r=await seed(f,http);http.drop('/api/business/appointment-holds/save');await assert.rejects(appointmentHolds.save(r,await http.proof(),signal()),e=>e.kind==='unknown');assert.equal(http.requests.filter(p=>p==='/api/business/appointment-holds/save').length,1);const saved=await appointmentHolds.lookup(f.business,reference(r),await http.proof(),signal());assert.equal(saved.state,'committed');assert.equal(saved.receipt.sequence,'1');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.appointment_hold_versions WHERE business_id=$1',[f.business])).rows[0].n,1);});
});
test('revoked genuine provider session cannot submit a new proposal',async()=>{
 const f=await fixture();await withHttp(f,async http=>{const r=await seed(f,http),p=await http.proof();await client.query('DELETE FROM auth.sessions WHERE user_id=$1',[f.subject]);await assert.rejects(appointmentHolds.save(r,p,signal()));assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.appointment_hold_versions WHERE business_id=$1',[f.business])).rows[0].n,0);});
});
test('Node capability and direct factory are closed unless explicitly synthetic-enabled',async()=>{
 const f=await fixture();await withHttp(f,async http=>{const r=await http.raw('business/appointment-holds/context');assert.equal(r.status,503);assert.equal(r.value.error,'HOLD_REQUEST_FAILED');},{reviewEnabled:false});
 await withHttp(f,async http=>{const r=await http.raw('business/appointment-holds/context');assert.equal(r.status,503);assert.equal(r.value.error,'HOLD_REQUEST_FAILED');assert.equal(http.providerCalls(),0);},{factoryOnly:true});
});
