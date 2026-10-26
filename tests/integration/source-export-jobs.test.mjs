// Registered42 plus an unregistered forward43 candidate in a disposable DB.
// Actual PostgreSQL/provider schema and restricted logins; no hosted resources.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {S3Client} from '@aws-sdk/client-s3';
import {createEncryptedExportPartStore} from '../../src/files/export-part-store.ts';
import {readFile} from 'node:fs/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseSourceExportCommand,parseSourceExportCommitted} from '../../src/security/source-export-job-contract.ts';
let sandbox,target,client,web,web2,bootstrap,login,pid2,history,unsafeRefused=false;
const issuer='https://auth.example.com/auth/v1',release='a'.repeat(40);
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const query=(c,sql,args)=>c.query(sql,args).then(r=>r.rows[0].value);
const reference=(f,kind,job,operation,extras)=>({schemaVersion:1,businessId:f.business,commandType:kind,reference:{operationId:operation,recoveryEpoch:f.epoch,exportJobId:job,...extras}});
const checked=(value,command,actor)=>{if(value.state==='committed')assert.deepEqual(parseSourceExportCommitted(value,parseSourceExportCommand(command),actor),value);return value;};
const request=(f,job=randomUUID(),operation=randomUUID(),app=release,c=web)=>query(c,'SELECT crest_commands.request_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),f.epoch,operation,job,app]).then(value=>checked(value,reference(f,'export.request',job,operation,{appReleaseId:app,profile:'crest.business-source-bundle.v1',sourceSchemaVersion:43}),f.actor));
const claim=(f,job,version='1',lease=randomUUID(),operation=randomUUID(),c=web)=>query(c,'SELECT crest_commands.claim_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS value',[...auth(f),f.epoch,operation,job,version,lease]).then(value=>checked(value,reference(f,'export.claim',job,operation,{expectedVersion:version,leaseId:lease}),f.actor));
const expire=(f,job,version,lease,operation=randomUUID())=>query(web,'SELECT crest_commands.expire_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS value',[...auth(f),f.epoch,operation,job,version,lease]).then(value=>checked(value,reference(f,'export.expire',job,operation,{expectedVersion:version,leaseId:lease}),f.actor));
const stop=(f,job,version,operation=randomUUID())=>query(web,'SELECT crest_commands.stop_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),f.epoch,operation,job,version]).then(value=>checked(value,reference(f,'export.stop',job,operation,{expectedVersion:version}),f.actor));
const status=(f,job,c=web)=>query(c,'SELECT crest_commands.read_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),job]);
const lookup=(f,operation)=>query(web,'SELECT crest_commands.lookup_source_export_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),operation]);
async function session(f,age='1 second'){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH t AS MATERIALIZED(SELECT clock_timestamp()-$6::interval AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN t WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32),age]);return {...f,provider,session,hash};
}
async function state(age='1 second'){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic export owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic export business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session({actor,subject,business,epoch},age);
}
async function evidence(f){const result={};for(const table of ['export_jobs','export_job_attempts','operations','audit_events'])result[table]=(await client.query('SELECT to_jsonb(t) AS value FROM crest_private.'+table+' t WHERE business_id=$1 ORDER BY id',[f.business])).rows;return result;}
async function waitForLock(){const deadline=Date.now()+1500;let blocked=false;while(Date.now()<deadline){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid2])).rows[0]?.blocked;if(blocked)break;}assert.equal(blocked,true,'second device must really wait on the original operation');}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);history=(await sandbox.apply(target)).history;assert.equal(history.length,42);
 const sql=await readFile(new URL('../../planning/proposals/source-export-jobs.sql',import.meta.url),'utf8');
 await client.query('ALTER ROLE crest_command_owner LOGIN');try{await client.query('BEGIN');await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_EXPORT_JOB_SOURCE_REVIEW_REQUIRED');unsafeRefused=true;}finally{await client.query('ROLLBACK');await client.query('ALTER ROLE crest_command_owner NOLOGIN');}
 await client.query('BEGIN');try{await client.query(sql);await client.query(await readFile(new URL('../../planning/proposals/source-export-snapshots.sql',import.meta.url),'utf8'));await client.query(await readFile(new URL('../../planning/proposals/source-export-parts.sql',import.meta.url),'utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 login='crest_export_jobs_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}pid2=(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('proposed export jobs refuse unsafe source ownership and preserve all42 registered history rows',async()=>{assert(unsafeRefused);assert.equal(history.length,42);assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.export_jobs")).rows[0].n,0);assert.deepEqual((await client.query("SELECT relname,relrowsecurity,relforcerowsecurity,relowner='crest_schema_owner'::regrole AS owner FROM pg_class WHERE oid IN('crest_private.export_jobs'::regclass,'crest_private.export_job_attempts'::regclass) ORDER BY relname")).rows.map(r=>[r.relname,r.relrowsecurity,r.relforcerowsecurity,r.owner]),[['export_job_attempts',true,true,true],['export_jobs',true,true,true]]);});
test('a recent owner freezes one private source request and exact original receipt with a matching immutable audit',async()=>{
 const f=await state(),job=randomUUID(),op=randomUUID(),first=await request(f,job,op);assert.equal(first.state,'committed');assert.equal(first.receipt.schemaVersion,1);assert.equal(first.receipt.job.id,job);assert.equal(first.receipt.job.actor_id,f.actor);assert.equal(first.receipt.job.profile,'crest.business-source-bundle.v1');assert.equal(first.receipt.job.source_schema_version,43);assert.equal(first.receipt.job.app_release_id,release);assert.equal(first.receipt.job.state,'Queued');assert.equal(first.receipt.job.version,'1');assert.equal(first.receipt.job.lease_id,null);assert.deepEqual(await request(f,job,op),first);assert.deepEqual(await lookup(f,op),first);assert.deepEqual((await status(f,job)).job,first.receipt.job);
 const rows=(await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 AND event_hash=encode(sha256(convert_to(hash_input,\'UTF8\')),\'hex\')',[f.business,op])).rows;assert.equal(rows[0].n,1);assert(!JSON.stringify(first).includes(f.hash.toString('hex')));
});
test('changed release or job cannot reuse an original request operation',async()=>{const f=await state(),job=randomUUID(),op=randomUUID();await request(f,job,op);const kept=await evidence(f);assert.deepEqual(await request(f,job,op,'b'.repeat(40)),{state:'conflict',reason:'operation'});assert.deepEqual(await request(f,randomUUID(),op),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(f),kept);});
test('one active export per business rejects another request and rolls back its pending operation',async()=>{const f=await state();await request(f);const kept=await evidence(f),op=randomUUID();assert.deepEqual(await request(f,randomUUID(),op),{state:'conflict',reason:'active_or_identity'});assert.deepEqual(await lookup(f,op),{state:'absent'});assert.deepEqual(await evidence(f),kept);const other=await state();assert.equal((await request(other)).state,'committed');});
test('claim creates one immutable exact15minute attempt and an audited current lease',async()=>{const f=await state(),first=await request(f),job=first.receipt.job.id,lease=randomUUID(),op=randomUUID(),claimed=await claim(f,job,'1',lease,op);assert.equal(claimed.state,'committed');assert.equal(claimed.receipt.job.state,'Running');assert.equal(claimed.receipt.job.lease_id,lease);assert.equal(claimed.receipt.job.version,'2');assert.equal(claimed.receipt.job.attempt_count,1);assert.deepEqual(await claim(f,job,'1',lease,op),claimed);const x=(await client.query("SELECT id,attempt_no,lease_until=leased_at+interval '15 minutes' AS exact,leased_at=created_at AS stamped FROM crest_private.export_job_attempts WHERE business_id=$1",[f.business])).rows;assert.deepEqual(x,[{id:lease,attempt_no:1,exact:true,stamped:true}]);});
test('stale versions and already running state create no new operation or attempt',async()=>{const f=await state(),job=(await request(f)).receipt.job.id;await claim(f,job);const kept=await evidence(f),op=randomUUID();assert.deepEqual(await claim(f,job,'1',randomUUID(),op),{state:'conflict',reason:'version'});assert.deepEqual(await lookup(f,op),{state:'absent'});assert.deepEqual(await claim(f,job,'2'),{state:'conflict',reason:'state'});assert.deepEqual(await evidence(f),kept);});
test('another current business owner cannot claim someone elses frozen request but can explicitly stop it',async()=>{const f=await state(),other=await state(),job=(await request(f)).receipt.job.id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[f.business,other.actor]);const owner={...other,business:f.business,epoch:f.epoch};assert.deepEqual(await claim(owner,job),{state:'conflict',reason:'state'});const stopped=await stop(owner,job,'1');assert.equal(stopped.receipt.job.created_by,f.actor);assert.equal(stopped.receipt.job.updated_by,other.actor);assert.equal(stopped.receipt.job.state,'Failed');});
test('unknown and foreign job status reveal no rows and cannot be claimed',async()=>{const f=await state(),other=await state(),job=(await request(f)).receipt.job.id,kept=await evidence(f);assert.deepEqual(await status(other,job),{state:'absent'});assert.deepEqual(await claim(other,job),{state:'busy'});assert.deepEqual(await status(f,randomUUID()),{state:'absent'});assert.deepEqual(await evidence(f),kept);});
for(const app of [null,'short','A'.repeat(40)])test('malformed frozen release '+String(app)+' is refused before any request effect',async()=>{const f=await state(),kept=await evidence(f);await assert.rejects(request(f,randomUUID(),randomUUID(),app),e=>e.code==='22023');assert.deepEqual(await evidence(f),kept);});
test('nonrecent owner cannot request, claim, inspect status or inspect original receipts',async()=>{const f=await state(),job=(await request(f)).receipt.job.id,stale=await session(f,'20 minutes'),kept=await evidence(f);for(const work of [()=>request(stale),()=>claim(stale,job),()=>status(stale,job),()=>lookup(stale,randomUUID())])await assert.rejects(work(),e=>e.code==='42501');assert.deepEqual(await evidence(f),kept);});
test('revoked local and genuinely missing provider sessions cannot act on a queued export',async()=>{const f=await state(),job=(await request(f)).receipt.job.id,second=await session(f),kept=await evidence(f);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.session]);await assert.rejects(claim(f,job),e=>e.code==='42501');await client.query('DELETE FROM auth.sessions WHERE id=$1',[second.provider]);await assert.rejects(claim(second,job),e=>e.code==='42501');assert.deepEqual(await evidence(f),kept);});
test('a removed business membership cannot create, claim or inspect an export',async()=>{
 const f=await state(),other=await state(),job=(await request(f)).receipt.job.id;
 // Retain a genuine second owner so the last-owner integrity rule permits removal.
 await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[f.business,other.actor]);
 await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor]);
 const kept=await evidence(f);for(const work of [()=>request(f),()=>claim(f,job),()=>status(f,job),()=>lookup(f,randomUUID())])await assert.rejects(work(),e=>e.code==='42501');assert.deepEqual(await evidence(f),kept);
});
test('paused historical status remains readable while mutations and old epochs remain fenced',async()=>{const f=await state(),op=randomUUID(),first=await request(f,randomUUID(),op),job=first.receipt.job.id,epoch=randomUUID();await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business,epoch]);assert.equal((await status(f,job)).job.state,'Queued');assert.deepEqual(await lookup(f,op),first);await assert.rejects(claim({...f,epoch},job),e=>e.message==='RECOVERY_REVIEW_REQUIRED');await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(claim(f,job),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await claim({...f,epoch},job),{state:'conflict',reason:'state'});const closed=await stop({...f,epoch},job,'1');assert.equal(closed.receipt.job.recovery_epoch,f.epoch);assert.equal(closed.recoveryEpoch,epoch);assert.equal((await request({...f,epoch})).state,'committed');});
for(const commit of [true,false])test('two real devices skip a locked job; first claim '+(commit?'commits':'rolls back')+' without a second lease',async()=>{const f=await state(),second=await session(f),job=(await request(f)).receipt.job.id,lease=randomUUID(),op=randomUUID();await web.query('BEGIN');try{assert.equal((await claim(f,job,'1',lease,op,web)).state,'committed');assert.deepEqual(await claim(second,job,'1',randomUUID(),randomUUID(),web2),{state:'busy'});await web.query(commit?'COMMIT':'ROLLBACK');const result=await claim(second,job,'1',randomUUID(),randomUUID(),web2);assert.equal(result.state,commit?'conflict':'committed');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.export_job_attempts WHERE business_id=$1',[f.business])).rows[0].n,1);}finally{await web.query('ROLLBACK');}});
for(const commit of [true,false])test('two real devices wait for an identical original claim '+(commit?'commit':'rollback'),async()=>{const f=await state(),second=await session(f),job=(await request(f)).receipt.job.id,lease=randomUUID(),op=randomUUID();let pending;await web.query('BEGIN');try{const first=await claim(f,job,'1',lease,op,web);pending=claim(second,job,'1',lease,op,web2);void pending.catch(()=>undefined);await waitForLock();await web.query(commit?'COMMIT':'ROLLBACK');const result=await pending;assert.equal(result.state,'committed');if(commit)assert.deepEqual(result,first);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.export_job_attempts WHERE business_id=$1',[f.business])).rows[0].n,1);}finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}});
test('a live lease cannot be expired and a wrong lease/version never advances the job',async()=>{const f=await state(),job=(await request(f)).receipt.job.id,lease=randomUUID();await claim(f,job,'1',lease);const kept=await evidence(f);assert.deepEqual(await expire(f,job,'2',lease),{state:'conflict',reason:'state'});assert.deepEqual(await expire(f,job,'2',randomUUID()),{state:'conflict',reason:'state'});assert.deepEqual(await expire(f,job,'1',lease),{state:'conflict',reason:'version'});assert.deepEqual(await evidence(f),kept);});
test('explicit stop retains attempts and original claim receipts but releases active business exclusion',async()=>{const f=await state(),job=(await request(f)).receipt.job.id,lease=randomUUID(),op=randomUUID(),original=await claim(f,job,'1',lease,op);const stopped=await stop(f,job,'2');assert.equal(stopped.receipt.job.state,'Failed');assert.equal(stopped.receipt.job.failure_code,'OWNER_STOPPED');assert.equal(stopped.receipt.job.lease_id,null);assert.deepEqual(await lookup(f,op),original);assert.deepEqual(await claim(f,job,'1',lease,op),original);assert.equal((await status(f,job)).job.state,'Failed');assert.equal((await request(f)).state,'committed');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.export_job_attempts WHERE business_id=$1',[f.business])).rows[0].n,1);});
test('an audit failure rolls back request and lease/attempt/operation changes atomically',async()=>{const f=await state(),job=(await request(f)).receipt.job.id,kept=await evidence(f);await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_export_refusal CHECK(entity_kind<>'export_jobs') NOT VALID");try{await assert.rejects(claim(f,job),e=>e.code==='23514');assert.deepEqual(await evidence(f),kept);const other=await state(),empty=await evidence(other);await assert.rejects(request(other),e=>e.code==='23514');assert.deepEqual(await evidence(other),empty);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_export_refusal');}});
test('frozen source metadata and retained attempts cannot be rewritten or erased',async()=>{const f=await state(),job=(await request(f)).receipt.job.id;await claim(f,job);for(const sql of ["UPDATE crest_private.export_jobs SET app_release_id=repeat('b',40),version=version+1 WHERE business_id=$1","UPDATE crest_private.export_jobs SET state='Queued',lease_id=NULL,lease_until=NULL,version=version+1 WHERE business_id=$1",'DELETE FROM crest_private.export_jobs WHERE business_id=$1','UPDATE crest_private.export_job_attempts SET lease_until=lease_until+interval \'1 minute\' WHERE business_id=$1','DELETE FROM crest_private.export_job_attempts WHERE business_id=$1'])await assert.rejects(client.query(sql,[f.business]),e=>e.code==='55000');await assert.rejects(client.query('TRUNCATE crest_private.export_part_verifications,crest_private.export_part_intents,crest_private.export_job_snapshots,crest_private.export_job_attempts,crest_private.export_jobs'),e=>e.code==='55000');});
test('web credentials cannot read/write raw jobs, forge GUC access or assume command ownership',async()=>{const f=await state();await request(f);await web.query("SELECT set_config('crest.business_id',$1,false),set_config('crest.actor_id',$2,false)",[f.business,f.actor]);for(const sql of ['SELECT * FROM crest_private.export_jobs','SELECT * FROM crest_private.export_job_attempts','DELETE FROM crest_private.export_jobs','UPDATE crest_private.export_jobs SET version=version+1','SET ROLE crest_command_owner'])await assert.rejects(web.query(sql),e=>e.code==='42501');assert.equal((await status(f,(await client.query('SELECT id FROM crest_private.export_jobs WHERE business_id=$1',[f.business])).rows[0].id)).state,'found');});

// Administrative HISTORICAL fixture construction only, not a runtime clock
// override or a claim that a real15minute lease was waited out. Temporarily
// disable only the two source clock/state guards inside this setup transaction;
// all FK, immutable history, operation/audit preparation and deferred consistency
// checks remain. Restore both guards BEFORE COMMIT and every tested web call.
async function historicalRunning(f,count,expiryInMs){
 const job=randomUUID(),base=expiryInMs===undefined?Date.now()-86400000:Date.now()-count*3600000-900000+expiryInMs;let rootOperation,version=0,lastLease;
 async function fact(action,change){
  const operation=randomUUID();rootOperation??=operation;const original=reference(f,'export.'+action,job,operation,action==='request'?{appReleaseId:release,profile:'crest.business-source-bundle.v1',sourceSchemaVersion:43}:{expectedVersion:String(version),...(action==='stop'?{}:{leaseId:lastLease})});
  await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true),set_config('crest.operation_id',$3,true)",[f.business,f.actor,operation]);
  const before=version===0?null:await query(client,'SELECT crest_private.source_export_job_projection(j) AS value FROM crest_private.export_jobs j WHERE business_id=$1 AND id=$2',[f.business,job]);
  await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,repeat('d',64),$3,'manual')",[f.business,operation,f.actor,'export.'+action,f.epoch]);
  await change(operation,++version);
  const after=await query(client,'SELECT crest_private.source_export_job_projection(j) AS value FROM crest_private.export_jobs j WHERE business_id=$1 AND id=$2',[f.business,job]);
  const event=(await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,'export_jobs',$4,$5,$6,$7,'manual') RETURNING id",[f.business,operation,f.actor,job,version,action,{schemaVersion:1,before,after}])).rows[0].id;
  await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[f.business,operation,{schemaVersion:1,command:original,job:after,auditEventId:event}]);
 }
 await client.query('BEGIN');try{
  await client.query('ALTER TABLE crest_private.export_jobs DISABLE TRIGGER export_job_guard');await client.query('ALTER TABLE crest_private.export_job_attempts DISABLE TRIGGER export_attempt_guard');
  await fact('request',async(operation,v)=>{await client.query("INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,version,created_at,updated_at,created_by,updated_by,origin,operation_id) VALUES($1,$2,$3,'crest.business-source-bundle.v1',$4,43,$5,$6,'Queued',$7,$8,$7,$7,$3,$3,'manual',$6)",[job,f.business,f.actor,release,f.epoch,operation,new Date(base),v]);});
  for(let n=1;n<=count;n++){
   lastLease=randomUUID();const stamp=new Date(base+n*3600000),until=new Date(stamp.getTime()+900000);
   await fact('claim',async(operation,v)=>{
    await client.query("INSERT INTO crest_private.export_job_attempts(id,business_id,export_job_id,attempt_no,recovery_epoch,leased_at,lease_until,created_at,created_by,origin,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'manual',$9)",[lastLease,f.business,job,n,f.epoch,stamp,until,f.actor,operation]);
    await client.query("UPDATE crest_private.export_jobs SET state='Running',attempt_count=$3,lease_id=$4,lease_until=$5,failure_code=NULL,version=$6,updated_at=$7,updated_by=$8,operation_id=$9 WHERE business_id=$1 AND id=$2",[f.business,job,n,lastLease,until,v,stamp,f.actor,operation]);
   });
   if(n<count)await fact('expire',async(operation,v)=>{await client.query("UPDATE crest_private.export_jobs SET state='Queued',lease_id=NULL,lease_until=NULL,failure_code='LEASE_EXPIRED',next_run_at=$3,version=$4,updated_at=$3,updated_by=$5,operation_id=$6 WHERE business_id=$1 AND id=$2",[f.business,job,new Date(until.getTime()+60000),v,f.actor,operation]);});
  }
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('ALTER TABLE crest_private.export_jobs ENABLE TRIGGER export_job_guard');await client.query('ALTER TABLE crest_private.export_job_attempts ENABLE TRIGGER export_attempt_guard');await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
 assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid IN('crest_private.export_jobs'::regclass,'crest_private.export_job_attempts'::regclass) AND tgname IN('export_job_guard','export_attempt_guard') AND tgenabled='O'")).rows[0].n,2);
 assert.equal((await status(f,job)).job.state,'Running');return {job,version:String(version),lease:lastLease};
}
for(const [attempt,minutes]of [[1,1],[2,5],[3,15],[4,60],[5,60]])test('historical expired attempt '+attempt+' keeps its immutable facts and enforces retry/failure policy',async()=>{
 const f=await state(),seed=await historicalRunning(f,attempt),before=Date.now(),operation=randomUUID(),result=await expire(f,seed.job,seed.version,seed.lease,operation),j=result.receipt.job;
 assert.deepEqual(await lookup(f,operation),result);assert.equal(result.receipt.command.reference.leaseId,seed.lease);
 assert.throws(()=>parseSourceExportCommitted(result,parseSourceExportCommand(reference(f,'export.expire',seed.job,operation,{expectedVersion:seed.version,leaseId:randomUUID()})),f.actor),/SOURCE_EXPORT_COMMAND_REVIEW_REQUIRED/);
 assert.equal(result.state,'committed');assert.equal(j.state,attempt===5?'Failed':'Queued');assert.equal(j.attempt_count,attempt);assert.equal(j.lease_id,null);assert.equal(j.failure_code,'LEASE_EXPIRED');assert(Date.parse(j.next_run_at)>=before+minutes*60000&&Date.parse(j.next_run_at)<=Date.now()+minutes*60000);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.export_job_attempts WHERE business_id=$1',[f.business])).rows[0].n,attempt);const kept=await evidence(f);assert.deepEqual(await claim(f,seed.job,j.version),{state:'conflict',reason:'state'});assert.deepEqual(await evidence(f),kept);
});
const sha=text=>createHash('sha256').update(text).digest('hex');
const acknowledgment=(stage,original)=>({formatVersion:1,stage,requestSha256:sha(original)});
const authorizeWorker=(f,original,c=web)=>query(c,'SELECT crest_commands.authorize_source_export_worker($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...auth(f),f.epoch,original]);
const snapshot=(f,original,c=web)=>query(c,'SELECT crest_commands.record_source_export_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...auth(f),f.epoch,original]);
async function snapshotFixture(){
 const f=await state(),job=(await request(f)).receipt.job.id,lease=randomUUID();await claim(f,job,'1',lease);
 const current={formatVersion:1,profile:'crest.business-source-bundle.v1',businessId:f.business,actorId:f.actor,exportJobId:job,recoveryEpoch:f.epoch,leaseId:lease};
 // Preserve the database microseconds; a JS millisecond can precede this lease.
 const observedAt=(await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"') AS stamp")).rows[0].stamp;
 const plan={formatVersion:1,claim:current,generationId:randomUUID(),observedAt,appReleaseId:release,sourceSchemaVersion:43,manifestSha256:'c'.repeat(64),parts:[{partId:randomUUID(),fileName:'example.csv',contentType:'text/csv; charset=utf-8',bytes:7,sha256:'b'.repeat(64)},{partId:randomUUID(),fileName:'source_manifest.json',contentType:'application/json',bytes:9,sha256:'c'.repeat(64)}],totalBytes:16,referenceClosureComplete:false,completePortableExport:false,completeBackup:false};
 return {f,job,lease,current,plan,raw:()=>JSON.stringify({plan,planSha256:sha(JSON.stringify(plan))})};
}
async function snapshots(f){return (await client.query('SELECT to_jsonb(s) AS value FROM crest_private.export_job_snapshots s WHERE business_id=$1 ORDER BY generation_id',[f.business])).rows;}
test('worker authorization is a fresh live-lease check and exact-byte acknowledgment with no durable mutation',async()=>{
 const s=await snapshotFixture(),raw=JSON.stringify(s.current),before=await evidence(s.f);assert.deepEqual(await authorizeWorker(s.f,raw),acknowledgment('authorize',raw));assert.deepEqual(await evidence(s.f),before);assert.deepEqual(await snapshots(s.f),[]);
 await stop(s.f,s.job,'2');await assert.rejects(authorizeWorker(s.f,raw),e=>e.code==='42501');
});
test('snapshot freezes exact original request bytes and complete plan once under the current lease',async()=>{
 const s=await snapshotFixture(),raw=s.raw(),before=await evidence(s.f);assert.deepEqual(await snapshot(s.f,raw),acknowledgment('snapshot',raw));assert.deepEqual(await snapshot(s.f,raw),acknowledgment('snapshot',raw));const rows=await snapshots(s.f);assert.equal(rows.length,1);
 const r=rows[0].value;assert.equal(r.generation_id,s.plan.generationId);assert.equal(r.request_text,raw);assert.equal(r.request_sha256,sha(raw));assert.equal(r.plan_sha256,sha(JSON.stringify(s.plan)));assert.equal(r.file_count,2);assert.equal(r.total_bytes,16);assert.equal(r.actor_id,s.f.actor);assert.equal(r.lease_id,s.lease);assert.equal(r.operation_id,(await status(s.f,s.job)).job.operation_id);assert.deepEqual(await evidence(s.f),before);assert.equal((await status(s.f,s.job)).job.state,'Running');
});
for(const mode of ['generation','inventory','root-spacing'])test('an acknowledged snapshot cannot be replaced by '+mode,async()=>{
 const s=await snapshotFixture(),original=s.raw();await snapshot(s.f,original);const kept=await snapshots(s.f);
 if(mode==='generation')s.plan.generationId=randomUUID();if(mode==='inventory')s.plan.parts[0].sha256='d'.repeat(64);const changed=mode==='root-spacing'?' '+original:s.raw();
 await assert.rejects(snapshot(s.f,changed),e=>e.code==='23514'&&e.message==='CREST_EXPORT_SNAPSHOT_ALREADY_FROZEN');assert.deepEqual(await snapshots(s.f),kept);
});
const malformedPlans=[
 ['extra field',p=>{p.extra='forbidden';}],
 ['schema42',p=>{p.sourceSchemaVersion=42;}],
 ['different release',p=>{p.appReleaseId='d'.repeat(40);}],
 ['different actor',p=>{p.claim.actorId=randomUUID();}],
 ['different business',p=>{p.claim.businessId=randomUUID();}],
 ['different epoch',p=>{p.claim.recoveryEpoch=randomUUID();}],
 ['duplicate part identity',p=>{p.parts[1].partId=p.parts[0].partId;}],
 ['duplicate name',p=>{p.parts[0].fileName='source_manifest.json';p.parts[0].contentType='application/json';}],
 ['manifest first',p=>{p.parts.reverse();}],
 ['wrong MIME',p=>{p.parts[0].contentType='application/json';}],
 ['path traversal',p=>{p.parts[0].fileName='../source.csv';}],
 ['part limit',p=>{p.parts[0].bytes=8388609;p.totalBytes=8388618;}],
 ['fractional bytes',p=>{p.parts[0].bytes=1.5;p.totalBytes=10.5;}],
 ['total mismatch',p=>{p.totalBytes++;}],
 ['root checksum mismatch',p=>{p.manifestSha256='d'.repeat(64);}],
 ['complete backup claim',p=>{p.completeBackup=true;}],
 ['pre-lease observation',p=>{p.observedAt='2020-01-01T00:00:00+00:00';}],
 ['future observation',p=>{p.observedAt='2099-01-01T00:00:00+00:00';}],
 ['invalid calendar instant',p=>{p.observedAt='2026-02-30T00:00:00+00:00';}]
];
for(const [label,change]of malformedPlans)test('snapshot refuses '+label+' without durable effects',async()=>{const s=await snapshotFixture(),before=await evidence(s.f);change(s.plan);await assert.rejects(snapshot(s.f,s.raw()),e=>e.code==='22023');assert.deepEqual(await snapshots(s.f),[]);assert.deepEqual(await evidence(s.f),before);});
for(const mode of ['bad-hash','duplicate-root','duplicate-nested','malformed','oversized'])test('snapshot rejects '+mode+' original JSON before durable effects',async()=>{
 const s=await snapshotFixture();let raw=s.raw();if(mode==='bad-hash')raw=JSON.stringify({plan:s.plan,planSha256:'e'.repeat(64)});if(mode==='duplicate-root')raw=raw.replace('{"plan":','{"plan":null,"plan":');if(mode==='duplicate-nested')raw=raw.replace('"formatVersion":1','"formatVersion":0,"formatVersion":1');if(mode==='malformed')raw='{';if(mode==='oversized')raw=' '.repeat(1048577);
 await assert.rejects(snapshot(s.f,raw),e=>e.code==='22023');assert.deepEqual(await snapshots(s.f),[]);
});
for(const mode of ['revoked','provider-missing','stale','paused','epoch-changed','stopped','wrong-lease','foreign-owner'])test('snapshot and worker authorization recheck '+mode+' authority even for an original replay',async()=>{
 const s=await snapshotFixture(),raw=s.raw();await snapshot(s.f,raw);const kept=await snapshots(s.f);let acting=s.f,claimText=JSON.stringify(s.current);
 if(mode==='revoked')await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[s.f.session]);
 if(mode==='provider-missing')await client.query('DELETE FROM auth.sessions WHERE id=$1',[s.f.provider]);
 if(mode==='stale')acting=await session(s.f,'20 minutes');
 if(mode==='paused')await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[s.f.business]);
 if(mode==='epoch-changed'){acting={...s.f,epoch:randomUUID()};await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[s.f.business,acting.epoch]);}
 if(mode==='stopped')await stop(s.f,s.job,'2');
 if(mode==='wrong-lease'){s.current.leaseId=randomUUID();claimText=JSON.stringify(s.current);}
 if(mode==='foreign-owner')acting=await state();
 for(const work of [()=>snapshot(acting,mode==='wrong-lease'?s.raw():raw),()=>authorizeWorker(acting,claimText)])await assert.rejects(work(),e=>mode==='paused'?e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED':e.code==='42501');assert.deepEqual(await snapshots(s.f),kept);
});
for(const commit of [true,false])test('two real devices serialize snapshot '+(commit?'commit':'rollback')+' and preserve one original plan',async()=>{
 const s=await snapshotFixture(),second=await session(s.f),raw=s.raw();let pending;await web.query('BEGIN');
 try{await snapshot(s.f,raw);pending=snapshot(second,raw,web2);void pending.catch(()=>undefined);await waitForLock();await web.query(commit?'COMMIT':'ROLLBACK');assert.deepEqual(await pending,acknowledgment('snapshot',raw));assert.equal((await snapshots(s.f)).length,1);}
 finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('a competing changed snapshot waits then refuses replacement after the first commit',async()=>{
 const s=await snapshotFixture(),second=await session(s.f),raw=s.raw();let pending;await web.query('BEGIN');
 try{await snapshot(s.f,raw);s.plan.generationId=randomUUID();pending=snapshot(second,s.raw(),web2);void pending.catch(()=>undefined);await waitForLock();await web.query('COMMIT');await assert.rejects(pending,e=>e.message==='CREST_EXPORT_SNAPSHOT_ALREADY_FROZEN');assert.equal((await snapshots(s.f))[0].value.request_text,raw);}
 finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('an already expired historical lease cannot authorize or freeze a new snapshot',async()=>{
 const f=await state(),seed=await historicalRunning(f,1),s=await snapshotFixture();s.plan.claim={...s.current,businessId:f.business,actorId:f.actor,exportJobId:seed.job,recoveryEpoch:f.epoch,leaseId:seed.lease};
 for(const work of [()=>authorizeWorker(f,JSON.stringify(s.plan.claim)),()=>snapshot(f,s.raw())])await assert.rejects(work(),e=>e.message==='CREST_EXPORT_LIVE_LEASE_REQUIRED');assert.deepEqual(await snapshots(f),[]);
});
for(const stage of ['authorize','snapshot'])test('lease expiry while a real '+stage+' caller waits on the job refuses acknowledgment',async()=>{
 const f=await state(),seed=await historicalRunning(f,1,2500),s=await snapshotFixture();s.plan.claim={...s.current,businessId:f.business,actorId:f.actor,exportJobId:seed.job,recoveryEpoch:f.epoch,leaseId:seed.lease};let pending;
 await client.query('BEGIN');try{
  await client.query('SELECT id FROM crest_private.export_jobs WHERE business_id=$1 AND id=$2 FOR UPDATE',[f.business,seed.job]);
  pending=stage==='authorize'?authorizeWorker(f,JSON.stringify(s.plan.claim),web2):snapshot(f,s.raw(),web2);void pending.catch(()=>undefined);await waitForLock();
  const deadline=Date.now()+5000;while(!(await client.query('SELECT lease_until<=clock_timestamp() AS expired FROM crest_private.export_jobs WHERE business_id=$1 AND id=$2',[f.business,seed.job])).rows[0].expired){assert(Date.now()<deadline);await client.query('SELECT pg_sleep(0.05)');}
  await client.query('COMMIT');await assert.rejects(pending,e=>e.message==='CREST_EXPORT_LIVE_LEASE_REQUIRED');assert.deepEqual(await snapshots(f),[]);
 }finally{await client.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('a maximum1024-file64MiB snapshot plan retains exact original bytes within the fixed journal limit',async()=>{
 const s=await snapshotFixture();s.plan.parts=Array.from({length:1023},(_,i)=>({partId:randomUUID(),fileName:'file_'+String(i).padStart(4,'0')+'.csv',contentType:'text/csv; charset=utf-8',bytes:i<7?8388608:i===7?8388608-1016:1,sha256:'b'.repeat(64)}));s.plan.parts.push({partId:randomUUID(),fileName:'source_manifest.json',contentType:'application/json',bytes:1,sha256:s.plan.manifestSha256});s.plan.totalBytes=67108864;
 const raw=s.raw();assert(Buffer.byteLength(raw)<1048576);assert.deepEqual(await snapshot(s.f,raw),acknowledgment('snapshot',raw));const r=(await snapshots(s.f))[0].value;assert.equal(r.file_count,1024);assert.equal(r.total_bytes,67108864);assert.equal(r.request_text,raw);
});
for(const mode of ['file-count','total-bytes'])test('snapshot rejects the extra '+mode+' beyond its bounded inventory',async()=>{
 const s=await snapshotFixture(),count=mode==='file-count'?1024:8;s.plan.parts=Array.from({length:count},(_,i)=>({partId:randomUUID(),fileName:'file_'+String(i).padStart(4,'0')+'.csv',contentType:'text/csv; charset=utf-8',bytes:mode==='file-count'?1:8388608,sha256:'b'.repeat(64)}));s.plan.parts.push({partId:randomUUID(),fileName:'source_manifest.json',contentType:'application/json',bytes:1,sha256:s.plan.manifestSha256});s.plan.totalBytes=s.plan.parts.reduce((n,p)=>n+p.bytes,0);
 await assert.rejects(snapshot(s.f,s.raw()),e=>e.code==='22023');assert.deepEqual(await snapshots(s.f),[]);
});
test('snapshot persistence refuses raw web access, helper execution and retained-history removal',async()=>{
 const s=await snapshotFixture();await snapshot(s.f,s.raw());const kept=await snapshots(s.f);
 for(const sql of ['SELECT * FROM crest_private.export_job_snapshots','DELETE FROM crest_private.export_job_snapshots',"SELECT crest_private.export_json_object('{}',ARRAY[]::text[])","SELECT crest_private.guard_source_export_snapshot()"])await assert.rejects(web.query(sql),e=>e.code==='42501');
 for(const sql of ['DELETE FROM crest_private.export_job_snapshots WHERE business_id=$1','UPDATE crest_private.export_job_snapshots SET request_text=request_text WHERE business_id=$1'])await assert.rejects(client.query(sql,[s.f.business]),e=>e.code==='55000');await assert.rejects(client.query('TRUNCATE crest_private.export_part_verifications,crest_private.export_part_intents,crest_private.export_job_snapshots'),e=>e.code==='55000');assert.deepEqual(await snapshots(s.f),kept);
});

const intentPart=(f,original,c=web)=>query(c,'SELECT crest_commands.record_source_export_part_intent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...auth(f),f.epoch,original]);
const verifyPart=(f,original,c=web)=>query(c,'SELECT crest_commands.record_source_export_part_verified($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...auth(f),f.epoch,original]);
function partRequest(s,index=0){const p=s.plan.parts[index];return {claim:s.current,generationId:s.plan.generationId,planSha256:sha(JSON.stringify(s.plan)),partId:p.partId,intent:{formatVersion:1,objectKey:`exports/${s.f.business}/${s.job}/${s.plan.generationId}/${p.partId}.jwe`,keyId:'synthetic-key',plaintextBytes:p.bytes,plaintextSha256:p.sha256,ciphertextBytes:1024,ciphertextSha256:'d'.repeat(64)}};}
async function partRows(f){const result={};for(const name of ['export_part_intents','export_part_verifications'])result[name]=(await client.query('SELECT to_jsonb(p) AS value FROM crest_private.'+name+' p WHERE business_id=$1 ORDER BY part_id',[f.business])).rows;return result;}
async function partFixture(){const s=await snapshotFixture();await snapshot(s.f,s.raw());return {...s,payload:partRequest(s)};}
const partOriginal=s=>JSON.stringify(s.payload);
test('part intent freezes original ciphertext metadata before any separate verification fact',async()=>{
 const s=await partFixture(),raw=partOriginal(s),before=await evidence(s.f);assert.deepEqual(await intentPart(s.f,raw),acknowledgment('intent',raw));assert.deepEqual(await intentPart(s.f,raw),acknowledgment('intent',raw));const rows=await partRows(s.f);assert.equal(rows.export_part_intents.length,1);assert.equal(rows.export_part_verifications.length,0);
 const p=rows.export_part_intents[0].value;assert.equal(p.request_text,raw);assert.equal(p.request_sha256,sha(raw));assert.equal(p.ordinal,1);assert.equal(p.file_name,s.plan.parts[0].fileName);assert.equal(p.ciphertext_sha256,s.payload.intent.ciphertextSha256);assert.equal(p.object_key,s.payload.intent.objectKey);assert.equal(p.operation_id,(await status(s.f,s.job)).job.operation_id);assert.deepEqual(await evidence(s.f),before);
});
test('verification requires the original committed intent and retains a separate immutable server timestamp',async()=>{
 const s=await partFixture(),raw=partOriginal(s);await assert.rejects(verifyPart(s.f,raw),e=>e.message==='CREST_EXPORT_PART_INTENT_REQUIRED');assert.deepEqual(await partRows(s.f),{export_part_intents:[],export_part_verifications:[]});await intentPart(s.f,raw);const before=await partRows(s.f);assert.deepEqual(await verifyPart(s.f,raw),acknowledgment('verified',raw));assert.deepEqual(await verifyPart(s.f,raw),acknowledgment('verified',raw));const rows=await partRows(s.f);assert.deepEqual(rows.export_part_intents,before.export_part_intents);assert.equal(rows.export_part_verifications.length,1);const p=rows.export_part_verifications[0].value;assert.equal(p.request_text,raw);assert.equal(p.request_sha256,sha(raw));assert.equal(p.verified_at,p.created_at);assert.equal((await status(s.f,s.job)).job.state,'Running');
});
test('part ordering keeps the manifest last and refuses every advance past an unverified original',async()=>{
 const s=await partFixture(),first=partOriginal(s),last=JSON.stringify(partRequest(s,1));await assert.rejects(intentPart(s.f,last),e=>e.message==='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED');await intentPart(s.f,first);await assert.rejects(intentPart(s.f,last),e=>e.message==='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED');assert.equal((await partRows(s.f)).export_part_intents.length,1);await verifyPart(s.f,first);await intentPart(s.f,last);await verifyPart(s.f,last);assert.equal((await partRows(s.f)).export_part_verifications.length,2);assert.deepEqual(await intentPart(s.f,first),acknowledgment('intent',first));assert.deepEqual(await verifyPart(s.f,first),acknowledgment('verified',first));assert.equal((await status(s.f,s.job)).job.state,'Running');
});
for(const stage of ['intent','verified'])for(const mode of ['key','cipher-hash','cipher-bytes','spacing'])test(stage+' cannot replace an original part using changed '+mode,async()=>{
 const s=await partFixture(),original=partOriginal(s);await intentPart(s.f,original);const kept=await partRows(s.f);if(mode==='key')s.payload.intent.keyId='another-key';if(mode==='cipher-hash')s.payload.intent.ciphertextSha256='e'.repeat(64);if(mode==='cipher-bytes')s.payload.intent.ciphertextBytes++;const changed=mode==='spacing'?' '+original:partOriginal(s);
 await assert.rejects((stage==='intent'?intentPart:verifyPart)(s.f,changed),e=>e.code==='23514'&&e.message===(stage==='intent'?'CREST_EXPORT_PART_ALREADY_FROZEN':'CREST_EXPORT_PART_ORIGINAL_REQUIRED'));assert.deepEqual(await partRows(s.f),kept);
});
const invalidParts=[
 ['extra field',p=>{p.extra=true;}],['extra intent field',p=>{p.intent.extra=true;}],
 ['foreign actor',p=>{p.claim.actorId=randomUUID();}],['foreign business',p=>{p.claim.businessId=randomUUID();}],['different profile',p=>{p.claim.profile='full-backup';}],['different epoch',p=>{p.claim.recoveryEpoch=randomUUID();}],
 ['unknown part',p=>{p.partId=randomUUID();p.intent.objectKey='exports/'+p.claim.businessId+'/'+p.claim.exportJobId+'/'+p.generationId+'/'+p.partId+'.jwe';}],['foreign object key',p=>{p.intent.objectKey='exports/elsewhere.jwe';}],['invalid key id',p=>{p.intent.keyId='secret key';}],
 ['zero plain bytes',p=>{p.intent.plaintextBytes=0;}],['fractional plain bytes',p=>{p.intent.plaintextBytes=1.5;}],['oversized plain bytes',p=>{p.intent.plaintextBytes=8388609;}],['wrong original size',p=>{p.intent.plaintextBytes++;}],['wrong original hash',p=>{p.intent.plaintextSha256='e'.repeat(64);}],
 ['zero cipher bytes',p=>{p.intent.ciphertextBytes=0;}],['fractional cipher bytes',p=>{p.intent.ciphertextBytes=1.5;}],['oversized cipher bytes',p=>{p.intent.ciphertextBytes=16777217;}],['invalid cipher hash',p=>{p.intent.ciphertextSha256='A'.repeat(64);}]
];
for(const [label,change]of invalidParts)test('part input refuses '+label+' without durable changes',async()=>{const s=await partFixture();change(s.payload);const before=await partRows(s.f);for(const method of [intentPart,verifyPart])await assert.rejects(method(s.f,partOriginal(s)),e=>e.code==='22023');assert.deepEqual(await partRows(s.f),before);});
for(const mode of ['wrong-generation','wrong-plan'])test('part scope refuses '+mode+' without inventing a snapshot',async()=>{const s=await partFixture();if(mode==='wrong-generation'){s.payload.generationId=randomUUID();s.payload.intent.objectKey='exports/'+s.f.business+'/'+s.job+'/'+s.payload.generationId+'/'+s.payload.partId+'.jwe';}else s.payload.planSha256='e'.repeat(64);for(const method of [intentPart,verifyPart])await assert.rejects(method(s.f,partOriginal(s)),e=>e.code==='42501'&&e.message==='CREST_EXPORT_PART_SNAPSHOT_REQUIRED');assert.deepEqual(await partRows(s.f),{export_part_intents:[],export_part_verifications:[]});});
for(const mode of ['duplicate-root','duplicate-intent','malformed','oversized'])test('part input refuses '+mode+' original JSON before writes',async()=>{
 const s=await partFixture();let raw=partOriginal(s);if(mode==='duplicate-root')raw=raw.replace('{"claim":','{"claim":null,"claim":');if(mode==='duplicate-intent')raw=raw.replace('"formatVersion":1','"formatVersion":0,"formatVersion":1');if(mode==='malformed')raw='{';if(mode==='oversized')raw=' '.repeat(8193);
 for(const method of [intentPart,verifyPart])await assert.rejects(method(s.f,raw),e=>e.code==='22023');assert.deepEqual(await partRows(s.f),{export_part_intents:[],export_part_verifications:[]});
});
for(const mode of ['revoked','provider-missing','stale','paused','epoch-changed','stopped','wrong-lease','foreign-owner','same-business-owner','membership-removed'])test('both original part replays recheck '+mode+' authority before acknowledging',async()=>{
 const s=await partFixture(),original=partOriginal(s);await intentPart(s.f,original);await verifyPart(s.f,original);const kept=await partRows(s.f);let acting=s.f,raw=original;
 if(mode==='revoked')await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[s.f.session]);if(mode==='provider-missing')await client.query('DELETE FROM auth.sessions WHERE id=$1',[s.f.provider]);if(mode==='stale')acting=await session(s.f,'20 minutes');
 if(mode==='paused')await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[s.f.business]);if(mode==='epoch-changed'){acting={...s.f,epoch:randomUUID()};await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[s.f.business,acting.epoch]);}
 if(mode==='stopped')await stop(s.f,s.job,'2');if(mode==='wrong-lease'){s.payload.claim.leaseId=randomUUID();raw=partOriginal(s);}if(mode==='foreign-owner')acting=await state();
 if(mode==='same-business-owner'||mode==='membership-removed'){const other=await state();await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[s.f.business,other.actor]);if(mode==='same-business-owner')acting={...other,business:s.f.business,epoch:s.f.epoch};else await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[s.f.business,s.f.actor]);}
 for(const method of [intentPart,verifyPart])await assert.rejects(method(acting,raw),e=>mode==='paused'?e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED':e.code==='42501');assert.deepEqual(await partRows(s.f),kept);
});
for(const stage of ['intent','verified'])for(const commit of [true,false])test('two real devices serialize part '+stage+' '+(commit?'commit':'rollback')+' with one retained fact',async()=>{
 const s=await partFixture(),other=await session(s.f),raw=partOriginal(s),method=stage==='intent'?intentPart:verifyPart;if(stage==='verified')await intentPart(s.f,raw);let pending;await web.query('BEGIN');
 try{await method(s.f,raw);pending=method(other,raw,web2);void pending.catch(()=>undefined);await waitForLock();await web.query(commit?'COMMIT':'ROLLBACK');assert.deepEqual(await pending,acknowledgment(stage,raw));const rows=await partRows(s.f);assert.equal(rows.export_part_intents.length,1);assert.equal(rows.export_part_verifications.length,stage==='verified'?1:0);}
 finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('a competing ciphertext intent waits then cannot replace the committed original',async()=>{
 const s=await partFixture(),other=await session(s.f),raw=partOriginal(s);let pending;await web.query('BEGIN');try{await intentPart(s.f,raw);s.payload.intent.ciphertextSha256='e'.repeat(64);pending=intentPart(other,partOriginal(s),web2);void pending.catch(()=>undefined);await waitForLock();await web.query('COMMIT');await assert.rejects(pending,e=>e.message==='CREST_EXPORT_PART_ALREADY_FROZEN');assert.equal((await partRows(s.f)).export_part_intents[0].value.request_text,raw);}finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
for(const stage of ['intent','verified'])test('a refused '+stage+' insert rolls back without deleting the original part ledger',async()=>{
 const s=await partFixture(),raw=partOriginal(s),table=stage==='intent'?'export_part_intents':'export_part_verifications';if(stage==='verified')await intentPart(s.f,raw);const kept=await partRows(s.f);await client.query('ALTER TABLE crest_private.'+table+' ADD CONSTRAINT synthetic_part_refusal CHECK(false) NOT VALID');
 try{await assert.rejects((stage==='intent'?intentPart:verifyPart)(s.f,raw),e=>e.code==='23514');assert.deepEqual(await partRows(s.f),kept);}finally{await client.query('ALTER TABLE crest_private.'+table+' DROP CONSTRAINT synthetic_part_refusal');}
});
test('part tables force RLS, refuse raw web/helper grants and retain their immutable history',async()=>{
 const s=await partFixture(),raw=partOriginal(s);await intentPart(s.f,raw);await verifyPart(s.f,raw);const kept=await partRows(s.f);
 assert.deepEqual((await client.query("SELECT relrowsecurity,relforcerowsecurity,relowner='crest_schema_owner'::regrole AS owned FROM pg_class WHERE oid IN('crest_private.export_part_intents'::regclass,'crest_private.export_part_verifications'::regclass)")).rows,[{relrowsecurity:true,relforcerowsecurity:true,owned:true},{relrowsecurity:true,relforcerowsecurity:true,owned:true}]);
 for(const name of ['export_part_intents','export_part_verifications']){for(const action of ['SELECT * FROM','DELETE FROM'])await assert.rejects(web.query(action+' crest_private.'+name),e=>e.code==='42501');for(const sql of ['DELETE FROM crest_private.'+name+' WHERE business_id=$1','UPDATE crest_private.'+name+' SET request_text=request_text WHERE business_id=$1'])await assert.rejects(client.query(sql,[s.f.business]),e=>e.code==='55000');}
 await assert.rejects(web.query('SELECT crest_commands.record_source_export_part(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)'),e=>e.code==='42501');await assert.rejects(client.query('TRUNCATE crest_private.export_part_verifications,crest_private.export_part_intents'),e=>e.code==='55000');assert.deepEqual(await partRows(s.f),kept);
});
test('private INSERT guards independently refuse forged part projection metadata',async()=>{
 const s=await partFixture(),raw=partOriginal(s);await intentPart(s.f,raw);await verifyPart(s.f,raw);const rows=await partRows(s.f);
 for(const [name,key,value]of [['export_part_intents','ordinal',2],['export_part_verifications','actor_id',randomUUID()]]){const forged={...rows[name][0].value,[key]:value};await assert.rejects(client.query('INSERT INTO crest_private.'+name+' SELECT * FROM jsonb_populate_record(NULL::crest_private.'+name+',$1)',[forged]),e=>e.code==='23514'&&e.message==='CREST_EXPORT_PART_SOURCE_REQUIRED');}assert.deepEqual(await partRows(s.f),rows);
});

for(const stage of ['intent','verified'])test('part '+stage+' refuses a lease that expires during a real job-lock wait',async()=>{
 const f=await state(),seed=await historicalRunning(f,1,2500),s=await snapshotFixture();Object.assign(s.current,{businessId:f.business,actorId:f.actor,exportJobId:seed.job,recoveryEpoch:f.epoch,leaseId:seed.lease});Object.assign(s,{f,job:seed.job,lease:seed.lease});await snapshot(f,s.raw());s.payload=partRequest(s);const raw=partOriginal(s),method=stage==='intent'?intentPart:verifyPart;if(stage==='verified')await intentPart(f,raw);const kept=await partRows(f);let pending;
 await client.query('BEGIN');try{await client.query('SELECT id FROM crest_private.export_jobs WHERE business_id=$1 AND id=$2 FOR UPDATE',[f.business,seed.job]);pending=method(f,raw,web2);void pending.catch(()=>undefined);await waitForLock();const deadline=Date.now()+5000;while(!(await client.query('SELECT lease_until<=clock_timestamp() AS expired FROM crest_private.export_jobs WHERE business_id=$1 AND id=$2',[f.business,seed.job])).rows[0].expired){assert(Date.now()<deadline);await client.query('SELECT pg_sleep(0.05)');}await client.query('COMMIT');await assert.rejects(pending,e=>e.code==='42501'&&e.message==='CREST_EXPORT_LIVE_LEASE_REQUIRED');assert.deepEqual(await partRows(f),kept);}
 finally{await client.query('ROLLBACK');await pending?.catch(()=>undefined);}
});

// Actual SDK/SigV4/HTTP/JWE with real SQL commits around I/O; synthetic local
// storage only. This fixture is not hosted-provider conformance or Ready proof.
async function custodyFixture(onRequest,mode='normal'){
 const bucket='crest-journal-synthetic',access=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex'),key=randomBytes(32),objects=new Map(),requests=[];let origin,failure;
 const hmac=(k,v)=>createHmac('sha256',k).update(v).digest(),encode=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 function signed(req,url,bytes){
  const m=/^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(req.headers.authorization??'');if(!m)return false;const credential=m[1].split('/'),headers=m[2].split(';'),date=req.headers['x-amz-date'];if(credential.length!==5||credential[0]!==access||credential[2]!=='auto'||credential[3]!=='s3'||credential[4]!=='aws4_request'||!headers.includes('host')||req.headers['x-amz-content-sha256']!==sha(bytes)||typeof date!=='string'||!/^\d{8}T\d{6}Z$/.test(date))return false;
  const q=[...url.searchParams].map(([k,v])=>[encode(k),encode(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&'),canonicalHeaders=headers.map(name=>name+':'+String(req.headers[name]??'').trim().replace(/\s+/g,' ')+'\n').join(''),canonical=[req.method,url.pathname,q,canonicalHeaders,m[2],sha(bytes)].join('\n'),signing=hmac(hmac(hmac(hmac('AWS4'+secret,credential[1]),'auto'),'s3'),'aws4_request'),expected=hmac(signing,['AWS4-HMAC-SHA256',date,credential.slice(1).join('/'),sha(canonical)].join('\n'));return timingSafeEqual(expected,Buffer.from(m[3],'hex'));
 }
 const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,origin),chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(!url.pathname.startsWith('/'+bucket+'/')||!signed(req,url,bytes)){res.writeHead(403);res.end();return;}const objectKey=url.pathname.slice(('/'+bucket+'/').length);requests.push({method:req.method,key:objectKey});await onRequest(req.method,objectKey,bytes);
   if(req.method==='PUT'){assert.equal(req.headers['if-none-match'],'*');if(objects.has(objectKey)){res.writeHead(412,{'content-type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}objects.set(objectKey,Buffer.from(bytes));if(mode==='lost-put'){req.socket.destroy();return;}res.writeHead(200,{etag:'"opaque"'});res.end();return;}
   assert.equal(req.method,'GET');assert(objects.has(objectKey));const data=Buffer.from(objects.get(objectKey));if(mode==='corrupt-read')data[0]^=1;res.writeHead(200,{'content-type':'application/jose+json','content-length':data.length,etag:'"not-a-content-hash"'});res.end(data);
  }catch(e){failure=e;res.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 const sdk=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 try{const store=await createEncryptedExportPartStore(sdk,bucket,'journal-key',[{id:'journal-key',key}]);return {store,requests,objects,async close(){sdk.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(failure)throw failure;}};}
 catch(e){sdk.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw e;}
}
async function custodySource(){
 const s=await snapshotFixture(),bytes=[Buffer.from('example'),Buffer.from('{"x":123}')];for(const [i,b]of bytes.entries()){s.plan.parts[i].bytes=b.length;s.plan.parts[i].sha256=sha(b);}s.plan.manifestSha256=sha(bytes[1]);s.plan.totalBytes=bytes.reduce((n,b)=>n+b.length,0);await snapshot(s.f,s.raw());return {s,bytes};
}
function custodyBinding(s,index){const p=s.plan.parts[index];return {businessId:s.f.business,actorId:s.f.actor,exportJobId:s.job,generationId:s.plan.generationId,recoveryEpoch:s.f.epoch,partId:p.partId,fileName:p.fileName,contentType:p.contentType};}
async function preparedPart(s,bytes,index,store){const binding=custodyBinding(s,index),prepared=await store.prepare(bytes,binding,new AbortController().signal),payload={...partRequest(s,index),intent:prepared.intentForServer()},raw=JSON.stringify(payload);return {binding,prepared,payload,raw};}
test('real SQL intent commits before each signed PUT and independent JWE GET precedes each separate verification fact',async()=>{
 const {s,bytes}=await custodySource();const h=await custodyFixture(async(method,objectKey,ciphertext)=>{const rows=await partRows(s.f),row=rows.export_part_intents.find(r=>r.value.object_key===objectKey)?.value;assert(row,'original intent must already be committed and visible on every HTTP effect');assert(!rows.export_part_verifications.some(r=>r.value.part_id===row.part_id));if(method==='PUT'){assert.equal(sha(ciphertext),row.ciphertext_sha256);assert.equal(ciphertext.length,row.ciphertext_bytes);assert(!ciphertext.includes(bytes[0]));}});
 try{for(let i=0;i<2;i++){const p=await preparedPart(s,bytes[i],i,h.store);assert.deepEqual(await intentPart(s.f,p.raw),acknowledgment('intent',p.raw));assert.deepEqual(await h.store.writeCandidate(p.prepared,new AbortController().signal),p.payload.intent);assert.equal((await partRows(s.f)).export_part_verifications.length,i);const opened=await h.store.readVerified(p.payload.intent,p.binding,new AbortController().signal);assert.deepEqual(Buffer.from(opened.forServer().bytes),bytes[i]);opened.dispose();assert.deepEqual(await verifyPart(s.f,p.raw),acknowledgment('verified',p.raw));}assert.deepEqual(h.requests.map(r=>r.method),['PUT','GET','GET','PUT','GET','GET']);assert.equal((await partRows(s.f)).export_part_verifications.length,2);assert.equal((await status(s.f,s.job)).job.state,'Running');}
 finally{await h.close();}
});
test('a real lost committed PUT retains one SQL intent and explicit reconciliation reads the original candidate without another write',async()=>{
 const {s,bytes}=await custodySource(),h=await custodyFixture(async()=>{assert.equal((await partRows(s.f)).export_part_intents.length,1);},'lost-put');
 try{const p=await preparedPart(s,bytes[0],0,h.store);await intentPart(s.f,p.raw);await assert.rejects(h.store.writeCandidate(p.prepared,new AbortController().signal),e=>e.code==='EXPORT_OBJECT_WRITE_UNCERTAIN');assert.equal((await partRows(s.f)).export_part_verifications.length,0);assert.deepEqual(h.requests.map(r=>r.method),['PUT']);assert.deepEqual(await h.store.verifyCandidate(p.payload.intent,p.binding,new AbortController().signal),p.payload.intent);await verifyPart(s.f,p.raw);assert.deepEqual(h.requests.map(r=>r.method),['PUT','GET']);assert.equal(h.objects.size,1);assert.equal((await partRows(s.f)).export_part_verifications.length,1);}
 finally{await h.close();}
});
test('authority changed during a real ciphertext GET refuses the SQL verification while retaining the original unverified intent',async()=>{
 const {s,bytes}=await custodySource(),h=await custodyFixture(async method=>{if(method==='GET')await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[s.f.business]);});
 try{const p=await preparedPart(s,bytes[0],0,h.store);await intentPart(s.f,p.raw);await h.store.writeCandidate(p.prepared,new AbortController().signal);await assert.rejects(verifyPart(s.f,p.raw),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');const rows=await partRows(s.f);assert.equal(rows.export_part_intents.length,1);assert.equal(rows.export_part_verifications.length,0);assert.deepEqual(h.requests.map(r=>r.method),['PUT','GET']);}
 finally{await h.close();}
});
test('corruption in a real post-PUT read leaves the database intent unverified and blocks the next planned part',async()=>{
 const {s,bytes}=await custodySource(),h=await custodyFixture(async()=>{},'corrupt-read');try{const p=await preparedPart(s,bytes[0],0,h.store);await intentPart(s.f,p.raw);await assert.rejects(h.store.writeCandidate(p.prepared,new AbortController().signal),e=>e.code==='EXPORT_OBJECT_REVIEW_REQUIRED');await assert.rejects(intentPart(s.f,JSON.stringify(partRequest(s,1))),e=>e.message==='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED');assert.equal((await partRows(s.f)).export_part_verifications.length,0);assert.deepEqual(h.requests.map(r=>r.method),['PUT','GET']);}finally{await h.close();}
});
test('a lost caller acknowledgment after a real intent commit performs no HTTP and retains the original immutable candidate',async()=>{
 const {s,bytes}=await custodySource(),h=await custodyFixture(async()=>{});try{const p=await preparedPart(s,bytes[0],0,h.store);await assert.rejects(async()=>{await intentPart(s.f,p.raw);throw new Error('synthetic lost intent acknowledgment');},/synthetic lost intent acknowledgment/);assert.equal((await partRows(s.f)).export_part_intents[0].value.request_text,p.raw);assert.equal((await partRows(s.f)).export_part_verifications.length,0);assert.deepEqual(h.requests,[]);}finally{await h.close();}
});
test('a lost caller acknowledgment after a real verification commit reconciles exactly without another HTTP operation',async()=>{
 const {s,bytes}=await custodySource(),h=await custodyFixture(async()=>{});try{const p=await preparedPart(s,bytes[0],0,h.store);await intentPart(s.f,p.raw);await h.store.writeCandidate(p.prepared,new AbortController().signal);await assert.rejects(async()=>{await verifyPart(s.f,p.raw);throw new Error('synthetic lost verification acknowledgment');},/synthetic lost verification acknowledgment/);const kept=await partRows(s.f);assert.equal(kept.export_part_verifications.length,1);assert.deepEqual(await verifyPart(s.f,p.raw),acknowledgment('verified',p.raw));assert.deepEqual(await partRows(s.f),kept);assert.deepEqual(h.requests.map(r=>r.method),['PUT','GET']);}finally{await h.close();}
});
