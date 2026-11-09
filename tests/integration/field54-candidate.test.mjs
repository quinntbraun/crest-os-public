// Actual coordinator and independent encrypted PostgreSQL restoration.
// Frozen registered54 and 53 recovery, then upgrade the restored 54 point.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {field54Candidate} from '../support/field54-candidate.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {captureFieldWorkspaceFixture,fieldWorkspaceContent} from '../support/field-workspace-source-fixture.mjs';
import {verifyNeutralFieldOccupancyRebuild} from '../support/field-occupancy-rebuild.mjs';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {requireSyntheticJobCompletion,requireSyntheticJobMileage} from '../../scripts/synthetic-migrations.mjs';
import {inventory,privateWorkspace,keyPair,restoreDatabase,backupLegacy53Database,restoreLegacy53Database,backupField54CandidateDatabase,restoreField54CandidateDatabase,backupLegacy55Database,restoreLegacy55Database,recoveryCluster,connect} from '../support/recovery-drill.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),value=async(c,q,a=[])=>(await c.query(q,a)).rows[0].value;
const coverage=JSON.parse(await readFile(new URL('../support/field54-export-coverage.json',import.meta.url)));
let restored54Target;
let sandbox,target,client,web,exporter,candidate,fixture,p,paused,enroute,prior53,keys,point53,point54,folder,manifest53,manifest54,source54,cluster53,cluster54,restored53,restored54,restoredExport,rebuild;
const logins=[];
async function loginAs(admin,url,role){
 const name='synthetic_field54_1'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 await admin.query('CREATE ROLE '+name+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await admin.query('GRANT '+role+' TO '+name);
 const u=new URL(url);u.username=name;u.password=password;const connection=await connect(u.toString());await connection.query('SET ROLE '+role);logins.push({admin,name,connection});return connection;
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await client.query("SET statement_timeout='30s'");
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 web=await loginAs(sandbox.admin,target,'crest_web');exporter=await loginAs(sandbox.admin,target,'crest_export');
 const accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});fixture=createFieldOperationFixture({client,web,accepted});
 p=await fixture.fixture({contact:true});prior53=await inventory(client);candidate=await field54Candidate(sandbox);
 folder=await privateWorkspace();keys=await keyPair(folder);point53=join(folder,'registered53');point54=join(folder,'candidate54');await mkdir(point53,{mode:0o700});await mkdir(point54,{mode:0o700});
},{timeout:240000});
after(async()=>{
 const failed=[];async function close(label,run){try{await run();}catch{failed.push(label);}}
 for(const entry of logins.reverse()){await close('owned_login_connection',()=>entry.connection?.end());await close('owned_login_role',()=>entry.admin?.query('DROP ROLE '+entry.name));}
 await close('restored54_connection',()=>restored54?.end());await close('restored53_connection',()=>restored53?.end());
 await close('owned54_cluster',()=>cluster54?.close());await close('owned53_cluster',()=>cluster53?.close());await close('owned_source_sandbox',()=>sandbox?.close());assert.deepEqual(failed,[]);
});
test('candidate reproduces registered54 and pins frozen53 plus all thirteen reviewed bodies',async()=>{
 assert.equal(candidate.parts.length,13);assert.equal(candidate.previousRegistrySha256,'033199a5f2e528f629799cdba48901bf2a4687df1eea3166b0cf7bfcf5ec3c67');
 const registered=await readFile(new URL('../support/registered54-migration-checksums.json',import.meta.url));assert.equal(JSON.parse(registered).migrations.length,54);assert.equal(sha(registered),candidate.registrySha256);assert.equal(sha(await readFile(new URL('../../supabase/migrations/'+candidate.file,import.meta.url))),candidate.sha256);
 for(const part of candidate.parts){const body=await readFile(join(sandbox.root,part.path));assert.equal(sha(body),part.sha256);assert(Buffer.from(candidate.sql).subarray(part.offset,part.offset+part.bytes).equals(body));}
});
test('encrypted frozen53 point retains the original populated source',async()=>{
 manifest53=(await backupLegacy53Database(client,target,point53,keys.recipient)).manifest;assert.equal(manifest53.schemaVersion,53);assert.deepEqual(manifest53.rows,prior53);assert.equal(manifest53.completeBackup,false);
},{timeout:180000});
test('a forced late field-body failure rolls back all DDL and preserves original rows',async()=>{
 await client.query('BEGIN');try{await client.query(candidate.sql);await assert.rejects(client.query("DO $failure$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FIELD54_LATE_FAILURE';END $failure$"),e=>e.message==='SYNTHETIC_FIELD54_LATE_FAILURE');}finally{await client.query('ROLLBACK');}
 assert.equal(await value(client,"SELECT to_regclass('crest.work_intervals')::text value"),null);assert.deepEqual(await inventory(client),prior53);
});
test('actual coordinator upgrade preserves every prior business-source table and verifies all80 source inventories',async()=>{
 const upgraded=await sandbox.apply(target,candidate.directory);assert.equal(upgraded.history.length,54);assert.equal(upgraded.registrySha256,candidate.registrySha256);assert.deepEqual((await sandbox.apply(target,candidate.directory)).history,upgraded.history);
 const now=await inventory(client);for(const row of prior53.filter(r=>['crest','crest_private'].includes(r.schema)))assert.deepEqual(now.find(r=>r.schema===row.schema&&r.name===row.name),row);
 const columns=(await client.query("SELECT n.nspname||'.'||cl.relname AS \"table\",a.attname AS \"column\" FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace JOIN pg_attribute a ON a.attrelid=cl.oid WHERE n.nspname IN('crest','crest_private') AND cl.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
 const checked=verifyExportCoverage(coverage,columns,54);assert.equal(checked.tables,80);assert.equal(checked.requiredColumns,1234);assert.equal(checked.excludedColumns,10);
});
test('stable text-length constraints retain empty whitespace null Unicode and exact boundary behavior',async()=>{
 for(const [table,column,name,max,nullable]of [
  ['work_scope_outcomes','scope_description','work_scope_outcomes_scope_description_check',2000,false],
  ['mileage_evidence','reason','mileage_evidence_reason_check',1000,true],
  ['mileage_evidence','estimate_source','mileage_evidence_estimate_source_check',1000,true],
 ]){
  const expression=await value(client,'SELECT pg_get_expr(conbin,conrelid) value FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2',['crest.'+table,name]);assert.equal(typeof expression,'string');
  assert.equal(await value(client,'SELECT attnotnull value FROM pg_attribute WHERE attrelid=$1::regclass AND attname=$2',['crest.'+table,column]),!nullable);
  for(const text of [null,'',' ','\t\n\r','A','A'.repeat(max),'A'.repeat(max+1),'😀'.repeat(max),'A'+' '.repeat(max-1)]){
   const expected=text===null?nullable?true:null:[...text].length>=1&&[...text].length<=max&&text.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g,'')!=='';
   assert.equal(await value(client,'SELECT ('+expression+') value FROM (SELECT $1::text AS '+column+') sample',[text]),expected);
  }
 }
});
async function mileage(actual,version,reason){return value(web,'SELECT crest_commands.record_mileage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',[...p.auth(),p.epoch,randomUUID(),p.legId,p.legVersionId,version,{source:'manual_actual',movementKind:'business_rig',actualMiles:actual,estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:'=Retained encrypted mileage\nCafé \\N',reason,allocationState:'allocated',allocations:[{jobId:p.job,fraction:'1.00000000'}]}]);}
test('candidate supports real restricted field commands with all eleven source groups plus open paused and travel projections',async()=>{
 await fixture.field(p,'direct_arrive');await fixture.field(p,'pause');p.legId=randomUUID();
 const trip=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.legId,null,fixture.tripBody(p)]);assert.equal(trip.state,'committed');p.legVersionId=trip.receipt.legVersionId;
 assert.equal((await mileage('9999999999.9999','0',null)).state,'committed');assert.equal((await mileage('1.0000','1','Synthetic pre-backup correction')).state,'committed');await fixture.field(p,'resume');
 const body=await fixture.completion(p);body.review={...body.review,reviewUrl:'https://example.com/synthetic-review',expectedCustomerVersion:'2',contactReviewReason:'Synthetic current contact reviewed'};
 assert.equal((await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body])).state,'committed');
 paused=await fixture.fixture();await fixture.field(paused,'direct_arrive');await fixture.field(paused,'pause');enroute=await fixture.fixture();await fixture.field(enroute,'depart');
 source54=await captureFieldWorkspaceFixture(exporter,p.business);for(const [name,rows]of Object.entries(source54.field.rows))assert(rows.length>0,name);assert.equal(source54.field.rows.mileage_evidence.length,2);formatFieldWorkspaceSources(source54);
});
test('unknown finance columns cannot enter a54-labelled encrypted point',async()=>{
 const refused=join(folder,'refused-unknown');await mkdir(refused,{mode:0o700});await client.query('CREATE TABLE crest.synthetic_unreviewed_finance(id uuid)');
 try{await assert.rejects(backupField54CandidateDatabase(candidate,client,target,refused,keys.recipient),e=>e.message==='SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage');}
 finally{await client.query('DROP TABLE crest.synthetic_unreviewed_finance');}
});
test('encrypted54 dump and manifest use one snapshot excluding a genuinely concurrent later mileage correction',async()=>{
 const old=await inventory(client);
 manifest54=(await backupField54CandidateDatabase(candidate,client,target,point54,keys.recipient,async()=>assert.equal((await mileage('2.0000','2','Synthetic after-snapshot correction')).state,'committed'))).manifest;
 assert.equal(manifest54.schemaVersion,54);assert.equal(manifest54.registrySha256,candidate.registrySha256);assert.equal(manifest54.rows.length,108);assert.deepEqual(manifest54.rows,old);assert.equal(manifest54.completeBackup,false);
 const later=await captureFieldWorkspaceFixture(exporter,p.business);assert.equal(later.field.rows.mileage_evidence.length,3);assert.notDeepEqual((await inventory(client)).find(r=>r.name==='mileage_evidence'),manifest54.rows.find(r=>r.name==='mileage_evidence'));
},{timeout:180000});
test('wrong profile and candidate identities refuse before database restoration',async()=>{
 cluster54=await recoveryCluster();const destination=await cluster54.database();
 await assert.rejects(restoreLegacy53Database(point54,keys.path,destination),e=>e.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest');
 await assert.rejects(restoreField54CandidateDatabase({...candidate,registrySha256:'0'.repeat(64)},point54,keys.path,destination));
 const empty=await connect(destination);try{assert.equal((await inventory(empty)).length,0);}finally{await empty.end();}
});
test('changed ciphertext with a forged external checksum still cannot decrypt or create source tables',async()=>{
 const bad=join(folder,'tampered54');await cp(point54,bad,{recursive:true,errorOnExist:true,force:false});const path=join(bad,'database.age'),bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);
 const receipt=JSON.parse(await readFile(join(bad,'receipt.json'),'utf8'));receipt.dump.sha256=sha(bytes);await writeFile(join(bad,'receipt.json'),JSON.stringify(receipt));
 const destination=await cluster54.database();await assert.rejects(restoreField54CandidateDatabase(candidate,bad,keys.path,destination),e=>e.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:authenticated_dump');
 const empty=await connect(destination);try{assert.equal((await inventory(empty)).length,0);}finally{await empty.end();}
});
test('independent54 restoration preserves every row role grant function constraint and included source original',async()=>{
 const destination=restored54Target=await cluster54.database(),restored=await restoreField54CandidateDatabase(candidate,point54,keys.path,destination);assert.deepEqual(restored.rows,manifest54.rows);restored54=await connect(destination);assert.deepEqual(await inventory(restored54),manifest54.rows);
 assert.equal(await value(restored54,'SELECT count(*)::int value FROM supabase_migrations.schema_migrations'),54);
 restoredExport=await loginAs(restored54,destination,'crest_export');const actual=await captureFieldWorkspaceFixture(restoredExport,p.business);formatFieldWorkspaceSources(actual);assert.deepEqual(fieldWorkspaceContent(actual),fieldWorkspaceContent(source54));assert.equal(actual.field.rows.mileage_evidence.length,2);
 assert.equal(await value(restored54,'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) value',[logins.find(r=>r.connection===web).name]),false);
 assert.equal(await value(restored54,"SELECT has_function_privilege('crest_export','crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','EXECUTE') value"),false);
},{timeout:180000});
test('independent neutral occupancy rebuild retains open travel paused sessions and both physical exclusions',async()=>{
 const before=await inventory(restored54);rebuild=await verifyNeutralFieldOccupancyRebuild(restored54);assert(rebuild.total>0);assert.equal(rebuild.open_travel,1);assert.equal(rebuild.open_work,1);assert(rebuild.pauses>=1);assert.equal(rebuild.physicalAndWorkSessionExclusions,2);assert.deepEqual(await inventory(restored54),before);
});
test('registered End Job upgrade requires the original ledger and preserves existing rows',async()=>{
 const signature='crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)';
 await assert.rejects(sandbox.apply(restored54Target),error=>error.message==='EXPLICIT_EMPTY_BOOTSTRAP_REQUIRED');
 assert.deepEqual(await inventory(restored54),manifest54.rows);
 assert.equal(await value(restored54,'SELECT to_regprocedure($1)::text value',[signature]),null);
 const businessRows=async()=>(await inventory(client)).filter(row=>row.schema!=='supabase_migrations');
 const before=await businessRows();
 assert.equal(await value(client,'SELECT to_regprocedure($1)::text value',[signature]),null);
 await assert.rejects(requireSyntheticJobCompletion(target),error=>error.message==='SYNTHETIC_JOB_COMPLETION_MIGRATION_REQUIRED');
 const source55=await sandbox.prefix(55);
 const upgraded=await sandbox.apply(target,source55);
 assert.equal(upgraded.history.length,55);
 assert.equal(upgraded.history.at(-1).version,'20261109180000');
 assert.deepEqual((await sandbox.apply(target,source55)).history,upgraded.history);
 assert.deepEqual(await businessRows(),before);
 await requireSyntheticJobCompletion(target);
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') AND NOT has_function_privilege('anon',$1,'EXECUTE') AND NOT has_function_privilege('crest_export',$1,'EXECUTE') value",[signature]),true);
},{timeout:180000});
test('independently restore populated schema55 and register only the scoped mileage reader on upgrade',async()=>{
 const signature='crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer)';
 const point=join(folder,'registered55');await mkdir(point,{mode:0o700});
 const baseline=await inventory(client);
 const {manifest}=await backupLegacy55Database(client,target,point,keys.recipient);
 assert.equal(manifest.schemaVersion,55);
 assert.deepEqual(manifest.rows,baseline);
 await assert.rejects(requireSyntheticJobMileage(target),error=>error.message==='SYNTHETIC_JOB_MILEAGE_MIGRATION_REQUIRED');
 const cluster=await recoveryCluster();
 try{
  const destination=await cluster.database();
  await assert.rejects(restoreDatabase(point,keys.path,destination),error=>error.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest');
  assert.deepEqual((await restoreLegacy55Database(point,keys.path,destination)).rows,baseline);
  const restored=await connect(destination);
  try{
   assert.deepEqual(await inventory(restored),baseline);
   assert.equal(await value(restored,'SELECT to_regprocedure($1)::text value',[signature]),null);
  }finally{await restored.end();}
 }finally{await cluster.close();}
 const upgraded=await sandbox.apply(target);
 assert.equal(upgraded.history.length,56);
 assert.equal(upgraded.history.at(-1).version,'20261110180000');
 assert.deepEqual((await sandbox.apply(target)).history,upgraded.history);
 assert.deepEqual((await inventory(client)).filter(row=>row.schema!=='supabase_migrations'),
  baseline.filter(row=>row.schema!=='supabase_migrations'));
 await requireSyntheticJobMileage(target);
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') AND NOT has_function_privilege('anon',$1,'EXECUTE') AND NOT has_function_privilege('crest_export',$1,'EXECUTE') AND NOT has_function_privilege('crest_worker',$1,'EXECUTE') value",[signature]),true);
},{timeout:180000});
test('frozen53 recovery still independently restores the original point without any field source or new functions',async()=>{
 cluster53=await recoveryCluster();const destination=await cluster53.database();await assert.rejects(restoreDatabase(point53,keys.path,destination),e=>e.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest');const restored=await restoreLegacy53Database(point53,keys.path,destination);restored53=await connect(destination);assert.deepEqual(restored.rows,manifest53.rows);assert.deepEqual(await inventory(restored53),prior53);
 assert.equal(await value(restored53,'SELECT count(*)::int value FROM supabase_migrations.schema_migrations'),53);assert.equal(await value(restored53,"SELECT to_regclass('crest.work_intervals')::text value"),null);
 await writeFile('.local/field54-registered-summary.json',JSON.stringify({frozenTables:manifest53.rows.length,currentTables:manifest54.rows.length,sourceTables:80,requiredColumns:1234,excludedColumns:10,fieldColumns:164,sourceOriginalsExact:true,concurrentCorrectionExcluded:true,rolesAndSchemaExact:true,neutralOccupancyRebuild:rebuild,candidateSha256:candidate.sha256,candidateRegistrySha256:candidate.registrySha256,previousRegistrySha256:candidate.previousRegistrySha256,repositoryRegistered:true,ownerRuntimeChanged:false,completeBackup:false})+'\n');
},{timeout:180000});
