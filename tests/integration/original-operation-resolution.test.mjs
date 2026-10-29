// Registered41 -> registered42 and independent restore. Disposable PostgreSQL; no live
// business data, production authority, fake race timers or admission resets.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,mkdir,copyFile,chmod,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseOriginalOperationReference,parseOriginalOperationOutcome,originalOperationKinds as currentOriginalKinds} from '../../src/security/original-operation-reference.ts';
// This fixture proves the immutable registered42/43 eleven-kind baseline.
// Catalog resolution is proved after its explicit proposal in the catalog drill.
// This fixture proves the immutable registered42 eleven-kind contract. Later
// catalog/quote extensions have their own mandatory current-source fixtures.
const originalOperationKinds=currentOriginalKinds.filter(kind=>kind!=='catalog.service.save'&&kind!=='quote.draft.save');
import {verifyBusinessHistoryEvidence} from '../../src/security/business-history-evidence.ts';
import {formatBusinessHistoryCsv} from '../../src/security/business-history-csv.ts';
import {decodeCustomerCsv} from '../support/customer-fixture.ts';
import {backupLegacy42Database as backupDatabase,restoreDatabase as restoreCurrentDatabase,connect,keyPair,privateWorkspace,recoveryCluster,inventory,run} from '../support/recovery-drill.mjs';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {createBusinessSourceCollector} from '../../src/security/business-foundation-collector.ts';
import {formatBusinessFoundationBundle} from '../../src/security/business-foundation-bundle.ts';
import {verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
import {formatBusinessSourceBundle} from '../../src/security/business-source-bundle.ts';
import {verifyBusinessSourceBundle} from '../../src/security/business-source-verifier.ts';
import {exerciseNeutralSourceImport} from '../support/neutral-source-import.mjs';

let sandbox,target,client,web,web2,bootstrap,login,pid2,prior,registered,unsafeOwnerRefused=false;
let recovery,restored,restoredWeb,recoveryOwner,recoveryPlans,recoveryDecisions,recoveryOriginal,recoveryCommitted,recoveryHistory,recoveryBackup,sourceAfterCapture,postSnapshot;
const issuer='https://auth.example.com/auth/v1',reason=' Owner reviewed lost draft é 😀\nRetire this original only. ';
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const query=(c,sql,args)=>c.query(sql,args).then(r=>r.rows[0].value);
const retire=(f,original,c=web,why=reason)=>query(c,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),f.epoch,original,why]);
const lookup=(f,original,c=web)=>query(c,'SELECT crest_commands.lookup_original_operation_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),original]);
const customerDraft=()=>({displayName:'Synthetic resolution customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});
const addressDraft=()=>({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null});
const vehicleDraft=()=>({label:'Synthetic resolution vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null});
const leadDraft=()=>({label:'Synthetic resolution lead',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null});
const vehicleReport=()=>({vehicleId:null,reportedVehicle:{schemaVersion:1,label:'Synthetic report',year:null,make:null,model:null,color:null,vin:null,plate:null,notes:null},requestedServices:{schemaVersion:1,text:'Reported only'},conditionNotes:null,archived:false,archiveReason:null});
async function session(f,age='1 second',connection=client){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await connection.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await connection.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-$6::interval AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32),age]);
 return {...f,provider,session,hash};
}
async function state(age='1 second'){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic resolution owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic resolution business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session({actor,subject,business,epoch},age);
}
async function seed(f,kind){const plan=await originalPlan(f,kind);assert.equal((await plan.run(f,web)).state,'committed');return plan.original.reference;}
async function originalPlan(f,kind){
 const operationId=randomUUID(),id=randomUUID();let fields,run;
 const simple=(command,args)=>(g,c)=>query(c,`SELECT crest_commands.${command}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value`,[...auth(g),g.epoch,operationId,...args]);
 switch(kind){
  case 'business.rename':fields={expectedVersion:'1'};run=(g,c)=>query(c,'SELECT crest_commands.rename_business($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',[...auth(g),g.epoch,operationId,'1','Explicit synthetic rename']);break;
  case 'crm.customer.save':fields={customerId:id,expectedVersion:'0'};run=simple('save_customer',[id,'0',customerDraft()]);break;
  case 'crm.vehicle.save':fields={vehicleId:id,expectedVersion:'0'};run=simple('save_vehicle',[id,'0',vehicleDraft()]);break;
  case 'crm.address.save':{const parent=await seed(f,'crm.customer.save');fields={customerId:parent.customerId,addressId:id,expectedVersion:'0'};run=(g,c)=>query(c,'SELECT crest_commands.save_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(g),g.epoch,operationId,id,parent.customerId,'0',addressDraft()]);break;}
  case 'crm.vehicle.association':{const customer=await seed(f,'crm.customer.save'),vehicle=await seed(f,'crm.vehicle.save');fields={action:'open',associationId:id,vehicleId:vehicle.vehicleId,expectedVersion:'0',nextAssociationId:null};const body={action:'open',associationId:id,customerId:customer.customerId,vehicleId:vehicle.vehicleId,effectiveAt:'2026-10-25T01:02:03.123456Z',relationship:'owner',isBilling:true,evidence:null,reason:null,nextAssociationId:null};run=(g,c)=>query(c,'SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',[...auth(g),g.epoch,operationId,'0',body]);break;}
  case 'crm.lead.source.save':fields={leadSourceId:id,expectedVersion:'0'};run=simple('save_lead_source',[id,'0',{label:'Synthetic original source',kind:'Owner recorded',active:true,referralCustomerId:null}]);break;
  case 'crm.lead.save':fields={leadId:id,expectedVersion:'0'};run=simple('save_lead',[id,'0',leadDraft()]);break;
  case 'crm.lead.state':{const parent=await seed(f,'crm.lead.save');fields={leadId:parent.leadId,expectedVersion:'1'};run=(g,c)=>query(c,'SELECT crest_commands.change_lead_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth(g),g.epoch,operationId,parent.leadId,'1',{fromState:'new',toState:'lost',reason:'Explicit synthetic lost reason'}]);break;}
  case 'crm.lead.vehicle.save':case 'crm.lead.address.save':{const parent=await seed(f,'crm.lead.save'),vehicle=kind==='crm.lead.vehicle.save';fields={leadId:parent.leadId,[vehicle?'leadVehicleId':'leadAddressId']:id,expectedVersion:'0'};run=(g,c)=>query(c,`SELECT crest_commands.save_lead_${vehicle?'vehicle':'address'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value`,[...auth(g),g.epoch,operationId,parent.leadId,id,'0',vehicle?vehicleReport():addressDraft()]);break;}
  case 'crm.lead.convert':{const parent=await seed(f,'crm.lead.save'),customerId=randomUUID(),body={customer:{kind:'new',id:customerId,draft:customerDraft()},vehicles:[],addresses:[]};fields={conversionId:id,leadId:parent.leadId,expectedLeadVersion:'1',customerId};run=(g,c)=>query(c,'SELECT crest_commands.convert_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(g),g.epoch,operationId,id,parent.leadId,'1',body]);break;}
  default:throw new Error('Unsupported synthetic original kind');
 }
 return {original:parseOriginalOperationReference({schemaVersion:1,businessId:f.business,commandType:kind,reference:{operationId,recoveryEpoch:f.epoch,...fields}}),run};
}
async function evidence(f){const out={};for(const table of ['crest.customers','crest.addresses','crest.vehicles','crest.customer_vehicles','crest.lead_sources','crest.leads','crest.lead_vehicles','crest.lead_addresses','crest.lead_events','crest.lead_conversions','crest.conversion_links','crest_private.operations','crest_private.audit_events'])out[table]=(await client.query(`SELECT to_jsonb(v) AS value FROM ${table} v WHERE business_id=$1 ORDER BY id`,[f.business])).rows;out.business=(await client.query('SELECT legal_name,version::text FROM crest.businesses WHERE id=$1',[f.business])).rows;return out;}
async function waitForLock(pid){let blocked=false;const end=Date.now()+1500;while(Date.now()<end){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked;if(blocked)break;}assert.equal(blocked,true,'second device must actually wait for the first transaction');}

before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(41));
 const sql=await readFile(new URL('../../supabase/migrations/20261026010000_original_operation_resolution.sql',import.meta.url),'utf8');
 await client.query('ALTER ROLE crest_command_owner LOGIN');try{await client.query('BEGIN');await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_OPERATION_RESOLUTION_REVIEW_REQUIRED');unsafeOwnerRefused=true;}finally{await client.query('ROLLBACK');await client.query('ALTER ROLE crest_command_owner NOLOGIN');}
 registered=await sandbox.apply(target,await sandbox.prefix(42));
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 login='crest_resolution_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}pid2=(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
},{timeout:240000});
after(async()=>{await restoredWeb?.end();await restored?.end();await recovery?.close();await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('registered42 refuses unsafe owners, preserves all41 prior migrations and reapplies idempotently',async()=>{assert(unsafeOwnerRefused);assert.equal(prior.history.length,41);assert.equal(registered.history.length,42);assert.deepEqual(registered.history.slice(0,41),prior.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(42))).history,registered.history);assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.operations WHERE command_type='operation.retire'")).rows[0].n,0);});
for(const kind of originalOperationKinds){
 test('retirement blocks the late original '+kind+' before domain effects',async()=>{const f=await state(),plan=await originalPlan(f,kind),first=await retire(f,plan.original);assert.equal(first.state,'retired');assert.deepEqual(parseOriginalOperationOutcome(first,plan.original),first);assert.deepEqual(await lookup(f,plan.original),first);const retained=await evidence(f);assert.deepEqual(await plan.run(f,web),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(f),retained);});
 test('committed original '+kind+' remains unchanged and requires its typed receipt',async()=>{const f=await state(),plan=await originalPlan(f,kind);assert.equal((await plan.run(f,web)).state,'committed');const retained=await evidence(f),observed=await retire(f,plan.original);assert.deepEqual(observed,{schemaVersion:1,state:'original_recorded',original:plan.original});assert.deepEqual(await lookup(f,plan.original),observed);assert.deepEqual(await evidence(f),retained);});
}
test('same retirement returns the original decision and changed review cannot replace it',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),first=await retire(f,plan.original);assert.deepEqual(await retire(f,plan.original),first);const retained=await evidence(f);assert.deepEqual(await retire(f,plan.original,web,'Changed review'),{state:'conflict',reason:'operation'});const changed={...plan.original,reference:{...plan.original.reference,customerId:randomUUID()}};assert.deepEqual(await retire(f,changed),{state:'conflict',reason:'operation'});await assert.rejects(lookup(f,changed),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);});
test('absent resolution is only an observation and creates no operation or audit',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),retained=await evidence(f);assert.deepEqual(await lookup(f,plan.original),{state:'absent'});assert.deepEqual(await evidence(f),retained);});
test('equivalent numeric schema spellings retain one canonical retirement across replay and lookup',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),alternate=JSON.stringify(plan.original).replace('"schemaVersion":1,','"schemaVersion":1.000,');assert.notEqual(alternate,JSON.stringify(plan.original));const first=await retire(f,alternate);assert.equal(first.state,'retired');assert.deepEqual(parseOriginalOperationOutcome(first,plan.original),first);assert.deepEqual(await retire(f,plan.original),first);assert.deepEqual(await lookup(f,plan.original),first);assert.deepEqual(await lookup(f,alternate),first);assert.equal((await client.query("SELECT (result->'original'->'schemaVersion')::text AS schema FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2",[f.business,plan.original.reference.operationId])).rows[0].schema,'1');});
for(const winner of ['original','retirement'])for(const commit of [true,false])test('two real devices '+winner+' transaction '+(commit?'commits':'rolls back')+' before the competing claim',async()=>{
 const f=await state(),second=await session(f),plan=await originalPlan(f,'crm.customer.save');let pending;
 await web.query('BEGIN');try{
  const first=winner==='original'?await plan.run(f,web):await retire(f,plan.original,web);assert.equal(first.state,winner==='original'?'committed':'retired');
  pending=winner==='original'?retire(second,plan.original,web2):plan.run(second,web2);void pending.catch(()=>undefined);await waitForLock(pid2);await web.query(commit?'COMMIT':'ROLLBACK');const result=await pending;
  const expected=winner==='original'?(commit?'original_recorded':'retired'):(commit?'conflict':'committed');assert.equal(result.state,expected);if(result.state==='conflict')assert.equal(result.reason,'operation');const stored=(await client.query('SELECT command_type FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[f.business,plan.original.reference.operationId])).rows;assert.equal(stored.length,1);assert.equal(stored[0].command_type,expected==='retired'||expected==='conflict'?'operation.retire':'crm.customer.save');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customers WHERE business_id=$1',[f.business])).rows[0].n,stored[0].command_type==='operation.retire'?0:1);
 }finally{await web.query('ROLLBACK');if(pending)await pending.catch(()=>undefined);}
});
test('paused history remains readable; a fresh epoch never rebases the original',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),first=await retire(f,plan.original),epoch=randomUUID();await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,epoch]);assert.deepEqual(await lookup(f,plan.original),first);await assert.rejects(retire({...f,epoch},plan.original),e=>e.message==='RECOVERY_REVIEW_REQUIRED');await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(plan.run(f,web),e=>e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await plan.run({...f,epoch},web),{state:'conflict',reason:'operation'});assert.deepEqual(await lookup({...f,epoch},plan.original),first);});
test('nonrecent owner cannot retire or inspect resolution metadata',async()=>{const f=await state('20 minutes'),plan=await originalPlan(f,'crm.customer.save'),retained=await evidence(f);await assert.rejects(retire(f,plan.original),e=>e.code==='42501');await assert.rejects(lookup(f,plan.original),e=>e.code==='42501');assert.deepEqual(await evidence(f),retained);});
test('foreign owner cannot inspect or replace another actors claim in the same business',async()=>{const f=await state(),other=await state(),plan=await originalPlan(f,'crm.customer.save'),first=await retire(f,plan.original);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[f.business,other.actor]);const foreign={...other,business:f.business,epoch:f.epoch},retained=await evidence(f);assert.deepEqual(await lookup(foreign,plan.original),{state:'absent'});assert.deepEqual(await retire(foreign,plan.original),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(f),retained);assert.deepEqual(await lookup(f,plan.original),first);});
test('revoked credentials and a foreign business cannot claim retirement',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),other=await state(),retained=await evidence(f);await assert.rejects(retire(other,plan.original),e=>e.code==='22023');await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.session]);await assert.rejects(retire(f,plan.original),e=>e.code==='42501');assert.deepEqual(await evidence(f),retained);});
test('failed retirement audit rolls back the claim and permits the genuine original',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save'),retained=await evidence(f);await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_resolution_refusal CHECK(entity_kind<>'operations') NOT VALID");try{await assert.rejects(retire(f,plan.original),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_resolution_refusal');}assert.equal((await plan.run(f,web)).state,'committed');});
test('retirement and audit are immutable even through a reusable web session',async()=>{const f=await state(),plan=await originalPlan(f,'crm.customer.save');await retire(f,plan.original);for(const sql of ['SELECT * FROM crest_private.operations','UPDATE crest_private.operations SET result=NULL','DELETE FROM crest_private.audit_events','SELECT crest_private.operation_retirement_result($1,$2,$3)'])await assert.rejects(web.query(sql,sql.includes('$1')?[f.business,f.actor,plan.original]:undefined),e=>e.code==='42501');await assert.rejects(web.query('SET ROLE crest_command_owner'),e=>e.code==='42501');for(const sql of ["UPDATE crest_private.operations SET payload_hash=repeat('a',64) WHERE business_id=$1 AND operation_id=$2",'DELETE FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2','DELETE FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2'])await assert.rejects(client.query(sql,[f.business,plan.original.reference.operationId]),e=>e.code==='55000');});
test('SQL reference validator agrees with the pure contract on every supported original',async()=>{const f=await state();for(const kind of originalOperationKinds){const plan=await originalPlan(f,kind);assert.equal((await client.query('SELECT crest_private.original_operation_reference_valid($1) AS valid',[plan.original])).rows[0].valid,true);for(const malformed of [{...plan.original,actorId:f.actor},{...plan.original,commandType:'finance.post'},{...plan.original,reference:{...plan.original.reference,draft:{notes:'Never retained'}}}])assert.equal((await client.query('SELECT crest_private.original_operation_reference_valid($1) AS valid',[malformed])).rows[0].valid,false);}});

test('all eleven retirement decisions retain complete common-format operation and audit evidence in one ordinary history snapshot',async()=>{
 const f=await state(),decisions=new Map();
 for(const kind of originalOperationKinds){const plan=await originalPlan(f,kind),decision=await retire(f,plan.original,web,' =Reviewed, "original" é 😀\n\\N\t'+kind);assert.equal(decision.state,'retired');decisions.set(plan.original.reference.operationId,decision);}
 const committed=await originalPlan(f,'crm.customer.save');assert.equal((await committed.run(f,web)).state,'committed');assert.equal((await retire(f,committed.original)).state,'original_recorded');
 await assert.rejects(web.query('SELECT crest_commands.business_history_export_context($1)',[f.business]),e=>e.code==='42501');
 const reader=await sandbox.connect(target),coverage=JSON.parse(await readFile(new URL('../support/registered42-export-coverage.json',import.meta.url),'utf8'));
 await reader.query('SET ROLE crest_export');
 const records=async context=>{
  const out=[];
  for(const kind of ['operation','audit_event']){
   let cursor=null,finished=false;
   for(let page=0;page<100;page++){
    const rows=(await reader.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,5)',[f.business,context.snapshotToken,kind,cursor])).rows;
    if(!rows.length){finished=true;break;}
    for(const row of rows)out.push({kind,recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash});
    cursor=rows.at(-1).record_id;
   }
   assert(finished,'ordinary history must finish its bounded pages');
  }
  return out;
 };
 let later,afterLater,initial;
 await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const context=(await reader.query('SELECT crest_commands.business_history_export_context($1) AS value',[f.business])).rows[0].value;
  initial=Number(context.recordCounts.operation);assert(initial>=12);assert.equal(context.recordCounts.operation,context.recordCounts.audit_event);
  later=await originalPlan(f,'crm.customer.save');assert.equal((await retire(f,later.original)).state,'retired');afterLater=await evidence(f);
  const rows=await records(context),serialized=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context,evidenceBytes:rows.reduce((n,row)=>n+Buffer.byteLength(row.canonicalEvidence),0),records:rows}),report=verifyBusinessHistoryEvidence(serialized,{businessId:f.business});
  assert.equal(report.records.length,initial*2);assert.equal(report.completePortableExport,false);assert.equal(report.completeBackup,false);
  const csv=formatBusinessHistoryCsv(serialized,{businessId:f.business});
  const decodedOperations=decodeCustomerCsv(csv.operations.csv,csv.operations.escapeMap).map(row=>({...row,schema_version:Number(row.schema_version),result_schema_version:Number(row.result_schema_version)}));
  assert.deepEqual(decodedOperations,rows.filter(row=>row.kind==='operation').map(row=>JSON.parse(row.canonicalEvidence).row));
  assert.deepEqual(decodeCustomerCsv(csv.audits.csv,csv.audits.escapeMap),rows.filter(row=>row.kind==='audit_event').map(row=>JSON.parse(row.canonicalEvidence).row));
  assert.deepEqual(JSON.parse(csv.manifest).recordCounts,context.recordCounts);assert.equal(JSON.parse(csv.manifest).completeBackup,false);
  const operations=new Map(),audits=new Map();
  for(const item of rows){
   assert.equal(item.evidenceHash,createHash('sha256').update(item.canonicalEvidence).digest('hex'));
   const source=JSON.parse(item.canonicalEvidence),table=item.kind==='operation'?'crest_private.operations':'crest_private.audit_events';
   assert.deepEqual(Object.keys(source.row).sort(),coverage.tables.find(t=>t.table===table).required.toSorted());
   assert.equal(source.row.business_id,f.business);assert.equal(source.row.actor_id,f.actor);assert.notEqual(source.row.operation_id,later.original.reference.operationId);
   (item.kind==='operation'?operations:audits).set(source.row.operation_id,source.row);
  }
  for(const [id,decision] of decisions){
   const operation=operations.get(id),audit=audits.get(id);assert(operation&&audit);
   assert.equal(operation.command_type,'operation.retire');assert.equal(operation.id,decision.retirement.operationRowId);assert.deepEqual(JSON.parse(operation.result),decision);
   assert.equal(audit.id,decision.retirement.auditEventId);assert.equal(audit.entity_kind,'operations');assert.equal(audit.entity_id,operation.id);assert.equal(audit.action,'retire');assert.equal(audit.reason,decision.retirement.reason);
   assert.equal(audit.hash_input,audit.payload);assert.equal(audit.event_hash,createHash('sha256').update(audit.hash_input).digest('hex'));
   assert.deepEqual(JSON.parse(audit.delta),{schemaVersion:1,before:null,after:{schemaVersion:1,operationRowId:operation.id,original:decision.original,recoveryEpoch:decision.retirement.recoveryEpoch,reason:decision.retirement.reason}});
  }
  assert.equal(operations.get(committed.original.reference.operationId).command_type,'crm.customer.save');assert.deepEqual(await evidence(f),afterLater);
 }finally{await reader.query('ROLLBACK');}
 await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{const context=(await reader.query('SELECT crest_commands.business_history_export_context($1) AS value',[f.business])).rows[0].value;assert.equal(context.recordCounts.operation,String(initial+1));assert((await records(context)).some(row=>JSON.parse(row.canonicalEvidence).row.operation_id===later.original.reference.operationId));}finally{await reader.query('ROLLBACK');await reader.end();}
 assert.deepEqual(await evidence(f),afterLater);
});
test('reasons preserve Unicode and whitespace while invalid reasons create no claim',async()=>{const f=await state();for(const why of ['', ' \t\r\n','\u00a0\ufeff','bad\u0001','bad\u007f','😀'.repeat(2001)]){const plan=await originalPlan(f,'crm.customer.save'),retained=await evidence(f);await assert.rejects(retire(f,plan.original,web,why),e=>e.code==='22023');assert.deepEqual(await evidence(f),retained);}for(const why of ['v','😀'.repeat(2000),reason]){const plan=await originalPlan(f,'crm.customer.save');assert.equal((await retire(f,plan.original,web,why)).retirement.reason,why);}});
for(const role of ['customer','vehicle','address','lead'])test('retired derived conversion '+role+' rolls back parent, every other child and all mappings',async()=>{
 const f=await state(),parent=await seed(f,'crm.lead.save'),operation=randomUUID(),conversion=randomUUID(),customerId=randomUUID(),vehicleId=randomUUID(),addressId=randomUUID();
 const reportVehicle=randomUUID(),reportAddress=randomUUID();assert.equal((await query(web,'SELECT crest_commands.save_lead_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,randomUUID(),parent.leadId,reportVehicle,'0',vehicleReport()])).state,'committed');assert.equal((await query(web,'SELECT crest_commands.save_lead_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,randomUUID(),parent.leadId,reportAddress,'0',addressDraft()])).state,'committed');
 const target=role==='customer'?customerId:role==='vehicle'?vehicleId:role==='address'?addressId:parent.leadId,child=(await client.query('SELECT crest_private.conversion_child_operation($1,$2,$3,$4,$5) AS id',[f.business,operation,conversion,role,target])).rows[0].id;
 const fields=role==='customer'?{customerId,expectedVersion:'0'}:role==='vehicle'?{vehicleId,expectedVersion:'0'}:role==='address'?{customerId,addressId,expectedVersion:'0'}:{leadId:parent.leadId,expectedVersion:'1'},original=parseOriginalOperationReference({schemaVersion:1,businessId:f.business,commandType:'crm.'+role+'.save',reference:{operationId:child,recoveryEpoch:f.epoch,...fields}});await retire(f,original);const retained=await evidence(f),body={customer:{kind:'new',id:customerId,draft:customerDraft()},vehicles:[{linkId:randomUUID(),leadVehicleId:reportVehicle,expectedLeadVehicleVersion:'1',target:{kind:'new',id:vehicleId,draft:vehicleDraft()}}],addresses:[{linkId:randomUUID(),leadAddressId:reportAddress,expectedLeadAddressVersion:'1',target:{kind:'new',id:addressId,draft:addressDraft()}}]};
 const result=await query(web,'SELECT crest_commands.convert_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,operation,conversion,parent.leadId,'1',body]);assert.equal(result.state,'conflict');assert.deepEqual(await evidence(f),retained);
});

async function capturedHistory(connection,businessId){
 const context=(await connection.query('SELECT crest_commands.business_history_export_context($1) AS value',[businessId])).rows[0].value,records=[];
 for(const kind of ['operation','audit_event']){
  let cursor=null,finished=false;
  for(let page=0;page<100;page++){
   const rows=(await connection.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',[businessId,context.snapshotToken,kind,cursor])).rows;
   if(!rows.length){finished=true;break;}
   for(const row of rows)records.push({kind,recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash});
   cursor=rows.at(-1).record_id;
  }
  assert(finished,'synthetic history capture must finish its declared pages');
 }
 const serialized=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context,evidenceBytes:records.reduce((n,row)=>n+Buffer.byteLength(row.canonicalEvidence),0),records}),report=verifyBusinessHistoryEvidence(serialized,{businessId}),csv=formatBusinessHistoryCsv(serialized,{businessId});
 const operations=decodeCustomerCsv(csv.operations.csv,csv.operations.escapeMap).map(row=>({...row,schema_version:Number(row.schema_version),result_schema_version:Number(row.result_schema_version)})),audits=decodeCustomerCsv(csv.audits.csv,csv.audits.escapeMap);
 assert.deepEqual(operations,records.filter(row=>row.kind==='operation').map(row=>JSON.parse(row.canonicalEvidence).row));assert.deepEqual(audits,records.filter(row=>row.kind==='audit_event').map(row=>JSON.parse(row.canonicalEvidence).row));
 return {context,records,operations,audits,report,csv};
}

test('independently keyed registered42 encrypted recovery retains all eleven retirement decisions after original key loss',async()=>{
 const directory=await privateWorkspace(),kit=join(directory,'emergency-kit'),point=join(directory,'point');await mkdir(kit,{mode:0o700});await mkdir(point,{mode:0o700});const keys=await keyPair(kit),emergency=join(kit,'independent-key.txt');await copyFile(keys.path,emergency);await chmod(emergency,0o600);
 recoveryOwner=await state();const f=recoveryOwner;recoveryPlans=[];recoveryDecisions=new Map();
 for(const kind of originalOperationKinds){const plan=await originalPlan(f,kind),decision=await retire(f,plan.original,web,' =Owner review, "original" é 😀\n\\N\t'+kind);assert.equal(decision.state,'retired');recoveryPlans.push(plan);recoveryDecisions.set(plan.original.reference.operationId,decision);}
 recoveryOriginal=await originalPlan(f,'crm.customer.save');recoveryCommitted=await recoveryOriginal.run(f,web);assert.equal(recoveryCommitted.state,'committed');
 recoveryBackup=await backupDatabase(client,target,point,keys.recipient,async()=>{
  recoveryHistory=await capturedHistory(client,f.business);
  for(const decision of recoveryDecisions.values()){const row=recoveryHistory.operations.find(item=>item.operation_id===decision.original.reference.operationId);assert(row);assert.deepEqual(JSON.parse(row.result),decision);}
  postSnapshot=await originalPlan(f,'crm.customer.save');assert.equal((await retire(f,postSnapshot.original)).state,'retired');
 });assert.equal(recoveryBackup.manifest.schemaVersion,42);assert.equal(recoveryBackup.manifest.completeBackup,false);sourceAfterCapture=await inventory(client);
 recovery=await recoveryCluster();const url=await recovery.database();await unlink(keys.path);
 await assert.rejects(restoreCurrentDatabase(point,emergency,url),e=>e.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest');
 const output=await run(process.execPath,['tests/support/restore-original-operation.mjs',point,emergency],{env:{...process.env,CREST_TEST_DATABASE_URL:'',CREST_RECOVERY_DRILL_TARGET:url}});assert.match(output.toString(),/^Synthetic isolated original-operation restore and verification completed\s*$/);
 restored=await connect(url);assert.deepEqual(await inventory(restored),recoveryBackup.manifest.rows);
 const restoredLogin='crest_resolution_restored_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');await restored.query('CREATE ROLE '+restoredLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await restored.query('GRANT crest_web TO '+restoredLogin);const connection=new URL(url);connection.username=restoredLogin;connection.password=password;restoredWeb=await connect(connection.toString());await restoredWeb.query('SET ROLE crest_web');
},{timeout:240000});

test('restored retirement operation and audit JSON and CSV exclude the later decision without changing source history',async()=>{
 assert(restored);await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{const actual=await capturedHistory(restored,recoveryOwner.business);assert.deepEqual(actual.records,recoveryHistory.records);assert.deepEqual(actual.operations,recoveryHistory.operations);assert.deepEqual(actual.audits,recoveryHistory.audits);assert.deepEqual(JSON.parse(actual.csv.manifest).recordCounts,JSON.parse(recoveryHistory.csv.manifest).recordCounts);assert.equal(actual.report.completeBackup,false);assert.equal(actual.report.completePortableExport,false);}finally{await restored.query('ROLLBACK');}
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[recoveryOwner.business,postSnapshot.original.reference.operationId])).rows[0].n,0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[recoveryOwner.business,postSnapshot.original.reference.operationId])).rows[0].n,1);
});

test('restored recent owner reads paused historical retirements and unchanged original receipt while late originals remain fenced under fresh authority',async()=>{
 assert(restoredWeb);const f=await session(recoveryOwner,'1 second',restored),epoch=randomUUID();
 await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,epoch]);
 for(const plan of recoveryPlans)assert.deepEqual(await lookup(f,plan.original,restoredWeb),recoveryDecisions.get(plan.original.reference.operationId));
 assert.deepEqual(await lookup(f,recoveryOriginal.original,restoredWeb),{schemaVersion:1,state:'original_recorded',original:recoveryOriginal.original});
 const originalReceipt=()=>query(restoredWeb,'SELECT crest_commands.lookup_customer_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),recoveryOriginal.original.reference.operationId]);assert.deepEqual(await originalReceipt(),recoveryCommitted);
 await assert.rejects(retire({...f,epoch},recoveryPlans[0].original,restoredWeb),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
 await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
 for(const plan of recoveryPlans){await assert.rejects(plan.run(f,restoredWeb),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await plan.run({...f,epoch},restoredWeb),{state:'conflict',reason:'operation'});assert.deepEqual(await lookup({...f,epoch},plan.original,restoredWeb),recoveryDecisions.get(plan.original.reference.operationId));}
 await restored.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);await assert.rejects(lookup(f,recoveryPlans[0].original,restoredWeb),e=>e.code==='42501');await assert.rejects(originalReceipt(),e=>e.code==='42501');
});

test('registered42 restore preserves all499 source columns, closed roles and immutable retirement and audit evidence',async()=>{
 assert(restored);const manifest=JSON.parse(await readFile(new URL('../support/registered42-export-coverage.json',import.meta.url),'utf8'));assert.equal(manifest.migrationCount,42);
 const columns=(await restored.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN ('crest','crest_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum")).rows;
 assert.deepEqual(verifyExportCoverage(manifest,columns,42),{assurance:'schema_inventory_only',tables:33,requiredColumns:489,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 for(const role of ['crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'])assert.equal((await restored.query('SELECT NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL AS closed FROM pg_roles WHERE rolname=$1',[role])).rows[0].closed,true);
 const operation=recoveryPlans[0].original.reference.operationId;
 for(const table of ['crest_private.operations','crest_private.audit_events']){await assert.rejects(restoredWeb.query('SELECT * FROM '+table),e=>e.code==='42501');for(const sql of ['UPDATE '+table+' SET operation_id=operation_id WHERE business_id=$1 AND operation_id=$2','DELETE FROM '+table+' WHERE business_id=$1 AND operation_id=$2'])await assert.rejects(restored.query(sql,[recoveryOwner.business,operation]),e=>e.code==='55000');}
 await assert.rejects(restoredWeb.query('SET ROLE crest_command_owner'),e=>e.code==='42501');assert.deepEqual(await inventory(client),sourceAfterCapture);
});

// Same restricted export identity and existing command-generated sources as
// production capture. Temporary login exists only for each disposable case.
async function withSourceCollector(f,work){
 const name='crest_source_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
 try{await sandbox.admin.query(`GRANT crest_export TO ${name} WITH INHERIT FALSE`);const url=new URL(target);url.username=name;url.password=password;return await work({connectionString:url.toString(),environment:'test',businessId:f.business});}
 finally{await sandbox.admin.query(`DROP ROLE ${name}`);}
}
const sourceInventory=[['customers','crest.customers','customer','customers'],['addresses','crest.addresses','address','addresses'],['vehicles','crest.vehicles','vehicle','vehicles'],['associations','crest.customer_vehicles','association','associations'],['leadSources','crest.lead_sources','lead_source','lead_sources'],['leads','crest.leads','lead','leads'],['leadEvents','crest.lead_events','lead_event','events'],['leadVehicles','crest.lead_vehicles','lead_vehicle','leadVehicles'],['leadAddresses','crest.lead_addresses','lead_address','leadAddresses'],['conversions','crest.lead_conversions','lead_conversion','conversions'],['links','crest.conversion_links','conversion_link','links']];
test('business source collector captures every command-generated CRM source and conversion link with exact native pages and no source changes',async()=>{
 const f=await state();for(const kind of originalOperationKinds)if(kind!=='crm.lead.convert')await seed(f,kind);
 for(let i=0;i<21;i++)await seed(f,'crm.customer.save');
 const lead=(await seed(f,'crm.lead.save')).leadId,vehicle=randomUUID(),address=randomUUID();
 assert.equal((await query(web,'SELECT crest_commands.save_lead_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,0,$13) AS value',[...auth(f),f.epoch,randomUUID(),lead,vehicle,vehicleReport()])).state,'committed');
 assert.equal((await query(web,'SELECT crest_commands.save_lead_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,0,$13) AS value',[...auth(f),f.epoch,randomUUID(),lead,address,addressDraft()])).state,'committed');
 const body={customer:{kind:'new',id:randomUUID(),draft:customerDraft()},vehicles:[{linkId:randomUUID(),leadVehicleId:vehicle,expectedLeadVehicleVersion:'1',target:{kind:'new',id:randomUUID(),draft:{...vehicleDraft(),year:2025}}}],addresses:[{linkId:randomUUID(),leadAddressId:address,expectedLeadAddressVersion:'1',target:{kind:'new',id:randomUUID(),draft:{...addressDraft(),latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000'}}}]};
 assert.equal((await query(web,'SELECT crest_commands.convert_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,1,$13) AS value',[...auth(f),f.epoch,randomUUID(),randomUUID(),lead,body])).state,'committed');
 await withSourceCollector(f,async config=>{
  const before=await evidence(f),sealed=await createBusinessSourceCollector(config)(new AbortController().signal),value=sealed.forServer(),crm=JSON.parse(value.crm);
  assert.throws(()=>JSON.stringify(sealed),/BUSINESS_FOUNDATION_CAPTURE_PRIVATE/);assert.equal(value.capture,'single_connection_repeatable_read');assert.equal(crm.generationId,value.generationId);assert.equal(crm.observedAt,value.observedAt);
  assert.equal(crm.completePortableExport,false);assert.equal(crm.completeBackup,false);assert.equal(Object.keys(crm.contexts).length,10);assert.equal(Object.keys(crm.pages).length,11);
  let count=0;
  for(const [name,table,routine,field]of sourceInventory){
   const actual=crm.pages[name].flatMap(text=>JSON.parse(text)[field]),expected=(await client.query(`SELECT crest_private.${routine}_projection(t) AS row FROM ${table} t WHERE business_id=$1 ORDER BY id`,[f.business])).rows.map(r=>r.row);
   assert(actual.length>0,name+' must contain a real source');assert.deepEqual(actual,expected);count+=actual.length;
   const context=JSON.parse(crm.contexts[name==='links'?'conversions':name]);assert.equal(context.businessId,f.business);for(const text of crm.pages[name])assert.equal(JSON.parse(text).snapshotToken,context.snapshotToken);
  }
  assert(crm.pages.customers.length>=2);assert.equal(crm.recordCount,count);assert.equal(count+['configuration','identity','history'].reduce((n,k)=>n+JSON.parse(value[k]).records.length,0),value.recordCount);
  assert(value.crm.includes('-89.00000000000000000001'));assert.equal(JSON.parse(crm.pages.links[0]).links.length,2);assert.deepEqual(await evidence(f),before);
  const bundle=formatBusinessFoundationBundle(value,{businessId:f.business}),formatted=bundle.forServer(),manifest=JSON.parse(formatted.manifest);
  assert.throws(()=>JSON.stringify(bundle),/BUSINESS_FOUNDATION_BUNDLE_REVIEW_REQUIRED/);
  const part=name=>{const value=formatted.parts.find(p=>p.name===name);assert(value);assert.equal(value.bytes,Buffer.byteLength(value.content));assert.equal(value.sha256,createHash('sha256').update(value.content).digest('hex'));assert(value.bytes<=8*1024*1024);return value.content;};
  const restored={};
  for(const name of ['configuration','identity','history']){
   const collection=manifest.sourceCollections[name],records=collection.pages.flatMap((file,index)=>{const page=JSON.parse(part(file));assert.equal(page.page,index+1);assert.equal(page.group,name);assert.equal(page.generationId,value.generationId);assert.deepEqual(page.context,collection.context);return page.records;});
   assert.deepEqual(records,JSON.parse(value[name]).records);
   restored[name]=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:value.generationId,context:collection.context,evidenceBytes:collection.evidenceBytes,records});
  }
  verifyBusinessFoundationEvidence(restored.configuration,restored.identity,restored.history,{businessId:f.business});
  const entities={business:'businesses',membership:'memberships',recovery_authority:'business_recovery_authorities',actor:'actors',role_capability:'role_capabilities',identity_event:'identity_events',operation:'operations',audit_event:'audit_events'};
  for(const [kind,entity]of Object.entries(entities)){
   const records=['configuration','identity','history'].flatMap(name=>JSON.parse(value[name]).records).filter(row=>row.kind===kind).map(row=>JSON.parse(row.canonicalEvidence).row);
   const matrix=readCustomerCsv(part(entity+'.csv')),columns=matrix.shift(),dictionary=JSON.parse(part(entity+'_dictionary.json')),escapes=JSON.parse(part(entity+'_escape_map.json')).escapes;
   const decoded=matrix.map(cells=>Object.fromEntries(columns.map((column,index)=>{
    let cell=cells[index];if(cell==='\\N')return[column,null];
    if(escapes.some(e=>e.row_id===cells[columns.indexOf('id')]&&e.column===column)){assert(cell.startsWith("'"));cell=cell.slice(1);}
    cell=cell.replaceAll('\\\\','\\');if(dictionary.booleanColumns?.includes(column))cell=cell==='true';if(['schema_version','result_schema_version'].includes(column))cell=Number(cell);return[column,cell];
   })));
   assert.deepEqual(decoded,records,entity+' CSV must retain every captured column');
  }
  assert.equal(manifest.completePortableExport,false);assert.equal(manifest.completeBackup,false);assert.deepEqual(await evidence(f),before);
  const allSealed=formatBusinessSourceBundle(sealed,{businessId:f.business,appReleaseId:'a'.repeat(40),sourceSchemaVersion:42}),all=allSealed.forServer(),allManifest=JSON.parse(all.manifest);
  assert.throws(()=>JSON.stringify(allSealed),/BUSINESS_SOURCE_BUNDLE_REVIEW_REQUIRED/);assert.equal(all.parts.filter(p=>p.name.endsWith('.csv')).length,19);
  for(const [index,p]of all.parts.entries()){assert.equal(p.bytes,Buffer.byteLength(p.content));assert.equal(p.sha256,createHash('sha256').update(p.content).digest('hex'));assert.deepEqual(allManifest.parts[index],{name:p.name,contentType:p.contentType,bytes:p.bytes,sha256:p.sha256});}
  const text=name=>{const p=all.parts.find(p=>p.name===name);assert(p);return p.content;};
  const csvEntities={customers:'customers',addresses:'addresses',vehicles:'vehicles',associations:'customer_vehicles',leadSources:'lead_sources',leads:'leads',leadEvents:'lead_events',leadVehicles:'lead_vehicles',leadAddresses:'lead_addresses',conversions:'lead_conversions',links:'conversion_links'};
  for(const [name,, ,field]of sourceInventory){
   const collection=allManifest.sourceCollections[name],originalContext=crm.contexts[name==='links'?'conversions':name];assert.equal(text(collection.context),originalContext);assert.deepEqual(collection.pages.map(text),crm.pages[name]);
   const at=all.parts.findIndex(p=>p.name===csvEntities[name]+'.csv'),matrix=readCustomerCsv(all.parts[at].content),columns=matrix.shift(),escapes=JSON.parse(all.parts[at+1].content).escapes;
   const decoded=matrix.map(cells=>Object.fromEntries(columns.map((column,index)=>{
    let cell=cells[index];if(cell==='\\N')return[column,null];if(escapes.some(e=>e.row_id===cells[columns.indexOf('id')]&&e.column===column)){assert(cell.startsWith("'"));cell=cell.slice(1);}cell=cell.replaceAll('\\\\','\\');
    if(['outreach_opt_out','is_billing','active'].includes(column)){assert(['true','false'].includes(cell));cell=cell==='true';}if(column==='year'){assert(/^[1-9][0-9]{3}$/.test(cell));cell=Number(cell);}if(['source_snapshot','reported_vehicle','requested_services','request'].includes(column))cell=JSON.parse(cell);return[column,cell];
   })));
   assert.deepEqual(decoded,crm.pages[name].flatMap(p=>JSON.parse(p)[field]),name+' source and CSV must agree on every field');
  }
  assert.equal(allManifest.evidenceBytes,value.evidenceBytes);assert.equal(allManifest.recordCount,value.recordCount);assert.equal(allManifest.completePortableExport,false);assert.equal(allManifest.completeBackup,false);assert.deepEqual(await evidence(f),before);
  const independentlyVerified=verifyBusinessSourceBundle({manifest:Buffer.from(all.manifest),parts:all.parts.map(part=>({name:part.name,bytes:Buffer.from(part.content)}))},{businessId:f.business,appReleaseId:'a'.repeat(40)});
  const reconstructed=independentlyVerified.forServer();for(const name of ['configuration','identity','history','crm'])assert.deepEqual(JSON.parse(reconstructed[name]),JSON.parse(value[name]));
  assert.equal(Object.keys(reconstructed.rows).length,19);assert(reconstructed.csvSourceRowsVerified);assert(reconstructed.rawSourceReconstructionVerified);assert.equal(reconstructed.completePortableExport,false);assert.equal(reconstructed.completeBackup,false);
  await exerciseNeutralSourceImport(sandbox,independentlyVerified);assert.deepEqual(await evidence(f),before);
  console.log('Verified nineteen source CSV projections in a fresh extension-free PostgreSQL database with enforced relationships');
 });
});
test('business source collector keeps CRM rows and their audit history on the original real snapshot across a concurrent command', {timeout:30000},async()=>{
 const f=await state(),customer=(await seed(f,'crm.customer.save')).customerId,newOperation=randomUUID(),lock=await sandbox.connect(target);let locked=false,pending;
 try{await withSourceCollector(f,async config=>{
  await lock.query('BEGIN');await lock.query('LOCK TABLE crest.lead_conversions IN ACCESS EXCLUSIVE MODE');locked=true;
  pending=createBusinessSourceCollector(config)(new AbortController().signal).then(value=>({value}),error=>({error}));
  let observed=false;const deadline=performance.now()+1500;
  while(performance.now()<deadline){const r=await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_business_capture' AND wait_event_type='Lock' AND backend_xmin IS NOT NULL");if(r.rows[0].n===1){observed=true;break;}}
  assert(observed,'capture must own a real snapshot before the concurrent customer command');
  assert.equal((await query(web,'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',[...auth(f),f.epoch,newOperation,customer,{...customerDraft(),displayName:'Synthetic newer CRM source'}])).state,'committed');
  await lock.query('COMMIT');locked=false;const result=await pending;assert(!result.error,'old complete capture must succeed');
  const old=result.value.forServer(),oldCrm=JSON.parse(old.crm),oldRow=JSON.parse(oldCrm.pages.customers[0]).customers[0];assert.equal(oldRow.id,customer);assert.equal(oldRow.version,'1');assert.equal(oldRow.display_name,'Synthetic resolution customer');assert(!old.history.includes(newOperation));
  const fresh=(await createBusinessSourceCollector(config)(new AbortController().signal)).forServer(),next=JSON.parse(JSON.parse(fresh.crm).pages.customers[0]).customers[0];assert.equal(next.version,'2');assert.equal(next.display_name,'Synthetic newer CRM source');assert(fresh.history.includes(newOperation));assert.notEqual(old.generationId,fresh.generationId);
 });}finally{if(locked)await lock.query('ROLLBACK');await pending;await lock.end();}
});
test('business source collector fails the whole private capture when one late CRM source permission is unavailable',async()=>{
 const f=await state();await seed(f,'crm.customer.save');const before=await evidence(f);
 await withSourceCollector(f,async config=>{
  await client.query('REVOKE EXECUTE ON FUNCTION crest_commands.lead_address_snapshot_page(uuid,text,uuid,integer) FROM crest_export');
  try{await assert.rejects(createBusinessSourceCollector(config)(new AbortController().signal),e=>e.message==='BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED'&&!('cause' in e));}
  finally{await client.query('GRANT EXECUTE ON FUNCTION crest_commands.lead_address_snapshot_page(uuid,text,uuid,integer) TO crest_export');}
  const value=(await createBusinessSourceCollector(config)(new AbortController().signal)).forServer();assert.equal(JSON.parse(value.crm).recordCount,1);assert.deepEqual(await evidence(f),before);
 });
});
