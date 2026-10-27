// Genuine Auth SDK + encrypted local session + restricted PostgreSQL candidate.
// Includes a worker/port composition with simulated storage. Separate genuine
// SQL/SDK/HTTP custody cases prove object effects. No hosted service activation.
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
import {sessionCredentialHash} from '../../src/security/session-credential.ts';
import {sessionDatabase} from '../../src/security/session-database.ts';
import {createSourceExportDatabaseJournal} from '../../src/security/source-export-database-journal.ts';
import {createBusinessSourceJournalCollector} from '../../src/security/business-foundation-collector.ts';
import {createBusinessSourceJournalExportWorker} from '../../src/security/business-source-export-worker.ts';
import {bindSourceExportJournalWorker} from '../../src/security/source-export-journal-worker-port.ts';
import {createSourceExportOwnerAccess} from '../../src/security/source-export-owner-access.ts';
import {Readable} from 'node:stream';
import {createSourceExportHttp} from '../../src/security/source-export-http.ts';
import {sourceExportReferenceToWire,sourceExportRetirementToWire} from '../../src/security/source-export-http-contract.ts';
import {createCsrfToken} from '../../src/security/request-protection.ts';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';
import {createBoundedNodeServer,writeOriginalOperationResponse} from '../../src/server/node-server.ts';
let sandbox,target,client,service,login,readerLogin,readerUrl,config,boundary,tokens,lifecycle,database,verifications=0;
const signal=()=>new AbortController().signal,sha=text=>createHash('sha256').update(text).digest('hex'),release='a'.repeat(40);
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target)).history.length,42);
 await client.query('BEGIN');try{for(const name of ['jobs','snapshots','parts','ready','journal-reads','request-resolution'])await client.query(await readFile(new URL('../../planning/proposals/source-export-'+name+'.sql',import.meta.url),'utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 login='crest_export_auth_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};database=sessionDatabase(config);
 readerLogin='crest_export_read_0'+randomBytes(8).toString('hex');const readerPassword=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+readerLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+readerPassword+"'");await sandbox.admin.query('GRANT crest_export TO '+readerLogin+' WITH INHERIT FALSE');const readerAddress=new URL(target);readerAddress.username=readerLogin;readerAddress.password=readerPassword;readerUrl=readerAddress.toString();
 service=await startRealAuthService(target);const actual=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));boundary={...actual,async verifyAccess(...args){verifications++;return actual.verifyAccess(...args);}};
 tokens=await createProviderTokenStore('synthetic-export-auth',[{id:'synthetic-export-auth',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);
},{timeout:240000});
after(async()=>{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);if(readerLogin)await sandbox.admin.query('DROP ROLE '+readerLogin);await sandbox?.close();});
async function fixture(){
 const email='synthetic-export-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'export_user').user;assert(user?.id);const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'export_enrollment_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic export MFA'}),'export_enrollment'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'export_enrollment_verify');
 const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;let actor,business,epoch;await client.query('BEGIN');try{
  actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic export Auth owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic export Auth business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  // Only this disposable business is deliberately runnable. The registered
  // recovery authority defaults to paused; never weaken that product fence.
  const root=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch,writes_enabled",[business,actor])).rows[0];assert.equal(root.writes_enabled,true);epoch=root.active_epoch;await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse(),verified=await lifecycle.verify(credential,signal(),'background',true),hash=sessionCredentialHash(credential),jobId=randomUUID(),lease=randomUUID(),operation=randomUUID();let job;
 try{const args=[hash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,new Date(verified.provider.expiresAt),business,epoch];
  await database.commandTransaction(q=>q('SELECT crest_commands.request_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[...args,randomUUID(),jobId,release]),signal());
  job=(await database.commandTransaction(q=>q('SELECT crest_commands.claim_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',[...args,randomUUID(),jobId,'1',lease]),signal())).receipt.job;
 }finally{hash.fill(0);}
 const claim={formatVersion:1,profile:'crest.business-source-journal-bundle.v1',businessId:business,actorId:actor,exportJobId:jobId,recoveryEpoch:epoch,leaseId:lease},observedAt=(await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"') AS value")).rows[0].value;
 const plan={formatVersion:1,claim,generationId:randomUUID(),observedAt,appReleaseId:release,sourceSchemaVersion:43,manifestSha256:'c'.repeat(64),parts:[{partId:randomUUID(),fileName:'example.csv',contentType:'text/csv; charset=utf-8',bytes:7,sha256:'b'.repeat(64)},{partId:randomUUID(),fileName:'source_manifest.json',contentType:'application/json',bytes:9,sha256:'c'.repeat(64)}],totalBytes:16,referenceClosureComplete:false,completePortableExport:false,completeBackup:false};
 const planSha256=sha(JSON.stringify(plan)),parts=plan.parts.map(p=>({claim,generationId:plan.generationId,planSha256,partId:p.partId,intent:{formatVersion:1,objectKey:'exports/'+business+'/'+jobId+'/'+plan.generationId+'/'+p.partId+'.jwe',keyId:'synthetic-export-key',plaintextBytes:p.bytes,plaintextSha256:p.sha256,ciphertextBytes:1024,ciphertextSha256:'d'.repeat(64)}}));
 return{business,actor,epoch,issued,credential,job,operation,claim,plan,parts,port:createSourceExportDatabaseJournal(config,boundary,tokens,job,operation),authorize:JSON.stringify(claim),snapshot:JSON.stringify({plan,planSha256}),ready:JSON.stringify({plan,planSha256,parts})};
}
async function facts(f){const out={};for(const table of ['export_jobs','export_job_snapshots','export_part_intents','export_part_verifications','export_job_completions','operations','audit_events'])out[table]=(await client.query('SELECT to_jsonb(v) AS value FROM crest_private.'+table+' v WHERE business_id=$1 ORDER BY to_jsonb(v)::text',[f.business])).rows;return out;}
async function stage(f,name,raw){const result=await f.port[name](f.credential,raw,signal());assert.deepEqual(result,{formatVersion:1,stage:name,requestSha256:sha(raw)});return result;}
async function throughParts(f){await stage(f,'authorize',f.authorize);await stage(f,'snapshot',f.snapshot);for(const p of f.parts){const raw=JSON.stringify(p);await stage(f,'intent',raw);await stage(f,'verified',raw);}}
test('genuine Auth database journal commits all five stages with fresh provider verification and exact original Ready recovery',async()=>{
 const f=await fixture(),before=verifications;await throughParts(f);await stage(f,'ready',f.ready);assert.equal(verifications-before,7);const saved=await facts(f);assert.equal(saved.export_job_snapshots.length,1);assert.equal(saved.export_part_intents.length,2);assert.equal(saved.export_part_verifications.length,2);assert.equal(saved.export_job_completions.length,1);assert.equal(saved.export_jobs[0].value.state,'Ready');assert.equal(saved.export_job_completions[0].value.request_text,f.ready);
 const result=(await f.port.lookupReady(f.credential,f.ready,signal())).forServer();assert.equal(result.state,'committed');assert.equal(result.operationId,f.operation);assert.equal(result.receipt.command.reference.leaseId,f.claim.leaseId);await stage(f,'ready',f.ready);assert.deepEqual(await facts(f),saved);
});
test('genuine Auth database journal refuses changed local scope and invalid credentials without journal writes',async()=>{
 const f=await fixture(),saved=await facts(f),before=verifications;await assert.rejects(f.port.authorize(f.credential,JSON.stringify({...f.claim,businessId:randomUUID()}),signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');assert.equal(verifications,before);await assert.rejects(f.port.authorize('invalid',f.authorize,signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth local revocation between journal stages refuses a later snapshot without changing retained evidence',async()=>{
 const f=await fixture();await stage(f,'authorize',f.authorize);const saved=await facts(f);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.issued.evidence.sessionId]);await assert.rejects(f.port.snapshot(f.credential,f.snapshot,signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth journal preserves the recovery fence after an original intent without recording verification',async()=>{
 const f=await fixture();await stage(f,'snapshot',f.snapshot);const raw=JSON.stringify(f.parts[0]);await stage(f,'intent',raw);const saved=await facts(f);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(f.port.verified(f.credential,raw,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth journal rejects provider-session loss after verified parts before Ready publication',async()=>{
 const f=await fixture();await throughParts(f);const saved=await facts(f);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);await assert.rejects(f.port.ready(f.credential,f.ready,signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth journal withholds Ready after an actual SQL audit failure and an explicit original retry retains one completion',async()=>{
 const f=await fixture();await throughParts(f);const saved=await facts(f);await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_journal_ready_refusal CHECK(action<>'ready') NOT VALID");try{await assert.rejects(f.port.ready(f.credential,f.ready,signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN');assert.deepEqual(await facts(f),saved);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_journal_ready_refusal');}await stage(f,'ready',f.ready);assert.equal((await facts(f)).export_job_completions[0].value.operation_id,f.operation);
});
test('genuine Auth journal refuses a different authenticated actor even when that actor owns another business',async()=>{
 const f=await fixture(),other=await fixture(),saved=await facts(f);await assert.rejects(f.port.authorize(other.credential,f.authorize,signal()),e=>e.message==='SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth Ready lookup is read-only during pause and an absent original remains unproven',async()=>{
 const f=await fixture(),before=await facts(f);assert.deepEqual((await f.port.lookupReady(f.credential,f.ready,signal())).forServer(),{state:'absent'});assert.deepEqual(await facts(f),before);await throughParts(f);await stage(f,'ready',f.ready);const saved=await facts(f);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.equal((await f.port.lookupReady(f.credential,f.ready,signal())).forServer().state,'committed');await assert.rejects(f.port.ready(f.credential,f.ready,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await facts(f),saved);
});

test('genuine Auth joint worker commits every independently verified file through fresh database journal checks',{timeout:180000},async()=>{
 const f=await fixture(),before=verifications,candidates=new WeakMap(),objects=new Map();let credentials=0,parts=0;
 // Storage is intentionally simulated here; the separate real SQL/SDK/HTTP
 // worker test proves encrypted custody. This case proves real Auth composition.
 const store={
  async prepare(bytes,binding){const intent={formatVersion:1,objectKey:'exports/'+binding.businessId+'/'+binding.exportJobId+'/'+binding.generationId+'/'+binding.partId+'.jwe',keyId:'synthetic-auth-worker',plaintextBytes:bytes.length,plaintextSha256:sha(bytes),ciphertextBytes:bytes.length+128,ciphertextSha256:'d'.repeat(64)},prepared={intentForServer:()=>intent,toJSON(){throw Error('PRIVATE');}};candidates.set(prepared,intent);return prepared;},
  async writeCandidate(prepared){const intent=candidates.get(prepared);assert(intent);assert.equal(objects.has(intent.objectKey),false);const current=await facts(f);assert.equal(current.export_part_intents.length,parts+1);assert.equal(current.export_part_verifications.length,parts);objects.set(intent.objectKey,intent);parts++;return intent;}
 };
 const port=bindSourceExportJournalWorker(f.port,async()=>{credentials++;return f.credential;}),worker=createBusinessSourceJournalExportWorker({businessId:f.business,appReleaseId:release},createBusinessSourceJournalCollector({connectionString:readerUrl,environment:'test',businessId:f.business}),store,port),delivered=await worker.run(f.claim,signal()),result=delivered.forJournalWorker();
 assert.equal(Object.hasOwn(delivered,'forServer'),false);assert.equal(result.parts,parts);assert(parts>100);assert.equal(credentials,2*parts+3);assert.equal(verifications-before,credentials);
 const saved=await facts(f);assert.equal(saved.export_jobs[0].value.state,'Ready');assert.equal(saved.export_job_snapshots.length,1);assert.equal(saved.export_part_intents.length,parts);assert.equal(saved.export_part_verifications.length,parts);assert.equal(saved.export_job_completions.length,1);const raw=saved.export_job_completions[0].value.request_text,original=JSON.parse(raw);assert.equal(original.plan.sourceSchemaVersion,43);assert.equal(original.plan.claim.profile,'crest.business-source-journal-bundle.v1');assert.equal(original.parts.length,parts);assert.equal((await f.port.lookupReady(f.credential,raw,signal())).forServer().state,'committed');assert.deepEqual(await facts(f),saved);
});

test('genuine Auth owner export access preserves one original request and reads status and receipt during pause',async()=>{
 const f=await fixture();await throughParts(f);await stage(f,'ready',f.ready);
 const access=createSourceExportOwnerAccess(config,boundary,tokens,f.business),original={schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:randomUUID(),recoveryEpoch:f.epoch,exportJobId:randomUUID(),appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}},start=verifications;
 const requested=await access.request(f.credential,original,signal()),first=requested.forServer();assert.equal(first.state,'committed');assert.equal(first.receipt.job.state,'Queued');assert.equal(first.receipt.job.actor_id,f.actor);assert.deepEqual(first.receipt.command,original);assert.throws(()=>JSON.stringify(requested),e=>e.message==='SOURCE_EXPORT_ACCESS_PRIVATE');
 const saved=await facts(f);assert.equal((await access.status(f.credential,original.reference.exportJobId,signal())).forServer().job.state,'Queued');assert.deepEqual((await access.lookupRequest(f.credential,original,signal())).forServer(),first);assert.deepEqual((await access.request(f.credential,original,signal())).forServer(),first);assert.equal(verifications-start,4);assert.deepEqual(await facts(f),saved);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(access.request(f.credential,original,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual((await access.lookupRequest(f.credential,original,signal())).forServer(),first);assert.equal((await access.status(f.credential,original.reference.exportJobId,signal())).forServer().job.state,'Queued');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth owner export access refuses provider-session loss before request or private reads',async()=>{
 const f=await fixture(),access=createSourceExportOwnerAccess(config,boundary,tokens,f.business),original={schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:randomUUID(),recoveryEpoch:f.epoch,exportJobId:randomUUID(),appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}},saved=await facts(f);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);await assert.rejects(access.request(f.credential,original,signal()),e=>e.message==='SOURCE_EXPORT_REQUEST_NOT_SUBMITTED');await assert.rejects(access.status(f.credential,f.job.id,signal()),e=>e.message==='SOURCE_EXPORT_READ_FAILED');await assert.rejects(access.lookupRequest(f.credential,original,signal()),e=>e.message==='SOURCE_EXPORT_READ_FAILED');assert.deepEqual(await facts(f),saved);
});

test('genuine Auth export retirement preserves the older original and current decision through pause',async()=>{
 const f=await fixture(),access=createSourceExportOwnerAccess(config,boundary,tokens,f.business),original={schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:randomUUID(),recoveryEpoch:f.epoch,exportJobId:randomUUID(),appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}},current=randomUUID();await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,current]);const review={schemaVersion:1,recoveryEpoch:current,original,reason:'Reviewed synthetic interrupted export'},start=verifications,first=(await access.retireRequest(f.credential,review,signal())).forServer();assert.equal(first.state,'retired');assert.deepEqual(first.original,original);assert.equal(first.retirement.recoveryEpoch,current);assert.equal(first.original.reference.recoveryEpoch,f.epoch);const saved=await facts(f);assert.deepEqual((await access.lookupResolution(f.credential,original,signal())).forServer(),first);assert.deepEqual((await access.retireRequest(f.credential,review,signal())).forServer(),first);assert.equal(verifications-start,3);assert.deepEqual(await facts(f),saved);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.deepEqual((await access.lookupResolution(f.credential,original,signal())).forServer(),first);const next={...review,original:{...original,reference:{...original.reference,operationId:randomUUID()}}};await assert.rejects(access.retireRequest(f.credential,next,signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await facts(f),saved);
});
test('genuine Auth export resolution preserves a committed original and refuses revoked sessions',async()=>{
 const f=await fixture(),access=createSourceExportOwnerAccess(config,boundary,tokens,f.business),original={schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:f.job.request_operation_id,recoveryEpoch:f.epoch,exportJobId:f.job.id,appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}},review={schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Reviewed synthetic original'},saved=await facts(f),observation=(await access.retireRequest(f.credential,review,signal())).forServer();assert.equal(observation.state,'original_recorded');assert.equal((await access.lookupRequest(f.credential,original,signal())).forServer().receipt.job.state,'Queued');assert.equal((await access.status(f.credential,f.job.id,signal())).forServer().job.state,'Running');assert.deepEqual(await facts(f),saved);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);await assert.rejects(access.retireRequest(f.credential,review,signal()),e=>e.message==='SOURCE_EXPORT_RESOLUTION_NOT_SUBMITTED');await assert.rejects(access.lookupResolution(f.credential,original,signal()),e=>e.message==='SOURCE_EXPORT_READ_FAILED');assert.deepEqual(await facts(f),saved);
});

// Test-only composition over actual loopback sockets. The product server does
// not register these proposal routes. Mint a real session-bound CSRF fixture;
// all HTTP guards, admission, provider verification and SQL remain genuine.
async function exportHttp(f,work){
 const server=createBoundedNodeServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port,handler=createSourceExportHttp({...config,origin,businessId:f.business,ingress:{kind:'direct'}},boundary,tokens,true),csrf=createCsrfToken(f.issued.evidence.sessionId),hash=csrf.hashForDatabase();
 try{
  await client.query('INSERT INTO crest_private.session_csrf_tokens(session_id,token_hash) VALUES($1,$2)',[f.issued.evidence.sessionId,hash]);
  server.on('request',async(message,outgoing)=>{
   const controller=new AbortController(),abort=()=>{if(!outgoing.writableFinished)controller.abort();};message.once('aborted',abort);outgoing.once('close',abort);
   try{const request=new Request(origin+message.url,{method:message.method,headers:message.headers,...(!['GET','HEAD'].includes(message.method)?{body:Readable.toWeb(message),duplex:'half'}:{}),signal:controller.signal});await writeOriginalOperationResponse(outgoing,await handler(request,transportFromIncomingMessage(message)),controller.signal);}catch{outgoing.destroy();}finally{message.off('aborted',abort);outgoing.off('close',abort);}
  });
  const post=(route,body,headers={})=>fetch(origin+'/api/business/exports/'+route,{method:'POST',headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin',cookie:'__Host-crest_session='+f.credential,'x-crest-csrf':csrf.tokenForResponse(),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  return await work(post);
 }finally{hash.fill(0);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const originalRequest=f=>({schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:f.job.request_operation_id,recoveryEpoch:f.epoch,exportJobId:f.job.id,appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}});
async function httpValue(response,status=200){assert.equal(response.status,status);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('cdn-cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);return response.json();}
test('genuine Auth export HTTP preserves original request receipts separately from current job status over real sockets',async()=>{
 const f=await fixture(),original=originalRequest(f),wire=sourceExportReferenceToWire(original),saved=await facts(f),start=verifications;
 await exportHttp(f,async post=>{
  const receipt=await httpValue(await post('request',wire));assert.equal(receipt.state,'committed');assert.equal(receipt.receipt.job.state,'Queued');assert.deepEqual(receipt.receipt.command,original);assert.equal(receipt.receipt.job.actor_id,f.actor);
  assert.deepEqual(await httpValue(await post('original',wire)),receipt);assert.equal((await httpValue(await post('status',{exportJobId:f.job.id}))).job.state,'Running');
  const review={schemaVersion:1,recoveryEpoch:f.epoch,original,reason:'Reviewed synthetic HTTP original'};assert.equal((await httpValue(await post('retire',sourceExportRetirementToWire(review)))).state,'original_recorded');assert.equal((await httpValue(await post('resolution',wire))).state,'original_recorded');
 });assert.equal(verifications-start,5);assert.deepEqual(await facts(f),saved);
});
test('genuine Auth export HTTP retires an absent old original without rebasing it and preserves its decision during pause',async()=>{
 const f=await fixture(),original={...originalRequest(f),reference:{...originalRequest(f).reference,operationId:randomUUID(),exportJobId:randomUUID()}},wire=sourceExportReferenceToWire(original),current=randomUUID();await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,current]);
 await exportHttp(f,async post=>{
  assert.deepEqual(await httpValue(await post('original',wire)),{state:'absent'});assert.deepEqual(await httpValue(await post('resolution',wire)),{state:'absent'});
  const review={schemaVersion:1,recoveryEpoch:current,original,reason:'Reviewed synthetic old HTTP original'},retired=await httpValue(await post('retire',sourceExportRetirementToWire(review)));assert.equal(retired.state,'retired');assert.deepEqual(retired.original,original);assert.equal(retired.retirement.recoveryEpoch,current);const saved=await facts(f);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.deepEqual(await httpValue(await post('resolution',wire)),retired);assert.deepEqual(await httpValue(await post('request',wire),409),{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual(await facts(f),saved);
 });
});
test('genuine Auth export HTTP refuses invalid CSRF, foreign scope and revoked provider authority without private writes',async()=>{
 const f=await fixture(),other=await fixture(),original=originalRequest(f),wire=sourceExportReferenceToWire(original),saved=await facts(f),start=verifications;
 await exportHttp(f,async post=>{
  assert.deepEqual(await httpValue(await post('request',wire,{'x-crest-csrf':randomBytes(32).toString('base64url')}),400),{error:'SOURCE_EXPORT_REQUEST_FAILED'});
  assert.deepEqual(await httpValue(await post('original',wire,{cookie:'__Host-crest_session='+other.credential}),400),{error:'SOURCE_EXPORT_REQUEST_FAILED'});
  assert.deepEqual(await httpValue(await post('request',sourceExportReferenceToWire({...original,businessId:other.business})),400),{error:'SOURCE_EXPORT_REQUEST_FAILED'});assert.equal(verifications,start);
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);assert.deepEqual(await httpValue(await post('request',wire),503),{error:'SOURCE_EXPORT_REQUEST_NOT_SUBMITTED'});assert.deepEqual(await httpValue(await post('original',wire),503),{error:'SOURCE_EXPORT_READ_FAILED'});
 });assert.deepEqual(await facts(f),saved);
});
