import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {inventory,recoveryCluster} from '../support/recovery-drill.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {dropoff67Candidate} from '../support/dropoff67-candidate.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {amendmentSourceHistory} from '../support/amendment-source-fixture.mjs';
import {collectDropoffCustodySourcesInSnapshot} from '../../src/operations/dropoff-custody-source-collector.ts';
import {requireSyntheticDropoffCustody} from '../../scripts/synthetic-migrations.mjs';

test('schema67 custody candidate upgrades the frozen schema66 and retains closed source access',async()=>{
 const cluster=await recoveryCluster();let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);const target=await sandbox.database(),client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);
  const before=await sandbox.apply(target,await sandbox.prefix(66));
  await assert.rejects(requireSyntheticDropoffCustody(target),{message:'SYNTHETIC_DROPOFF_CUSTODY_MIGRATION_REQUIRED'});
  const web=await sandbox.connect(target);await web.query('SET ROLE crest_web');
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const accepted=createConfirmedBookingFixture({client,web,bootstrap});await accepted();
  const businessBefore=(await inventory(client)).filter(row=>row.schema==='crest');
  const candidate=await dropoff67Candidate(sandbox);
  const adopted=await sandbox.apply(target,candidate.directory);
  assert.equal(adopted.history.length,67);assert.deepEqual(adopted.history.slice(0,66),before.history);
  assert.equal(adopted.registrySha256,candidate.registrySha256);
  const repeated=await sandbox.apply(target,candidate.directory);assert.deepEqual(repeated.history,adopted.history);
  await requireSyntheticDropoffCustody(target);
  const businessAfter=(await inventory(client)).filter(row=>row.schema==='crest');
  assert.deepEqual(businessAfter.filter(row=>businessBefore.some(prior=>prior.name===row.name)),businessBefore);
  const added=businessAfter.filter(row=>!businessBefore.some(prior=>prior.name===row.name));
  assert.equal(added.length,5);assert(added.every(row=>row.rows===0));
  const signatures=[
   'crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)',
   'crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)',
   'crest_commands.dropoff_custody_source_context(uuid)',
   'crest_commands.dropoff_custody_source_page(uuid,text,text,uuid,integer)'];
  for(const signature of signatures)assert((await client.query('SELECT to_regprocedure($1) id',[signature])).rows[0].id,signature);
  await assert.rejects(web.query('SELECT crest_commands.dropoff_custody_source_context($1)',[randomUUID()]),{code:'42501'});
  await assert.rejects(web.query('SELECT * FROM crest.custody_cases'),{code:'42501'});
  await assert.rejects(web.query('SELECT * FROM crest.custody_photo_originals'),{code:'42501'});
  const publicFunctions=await client.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest_commands','crest_private') AND (p.proname LIKE '%dropoff%' OR p.proname LIKE '%custody%') AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)");
  assert.deepEqual(publicFunctions.rows,[]);
  const path='.local/dropoff67-adoption';await mkdir(path,{recursive:true});
  const principal=await accepted();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');let dictionary;
  try{
   const history=await amendmentSourceHistory(client,principal.business);
   const archive=(await collectDropoffCustodySourcesInSnapshot(client,principal.business,history,new AbortController().signal)).forServer();
   dictionary=JSON.parse(archive.files['custody_source_dictionary.json']);
   assert.equal(Object.keys(dictionary.columns).length,5);
   for(const [table,columns] of Object.entries(dictionary.columns)){
    const physical=(await client.query("SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname",[table])).rows.map(row=>row.attname);
    assert.deepEqual([...columns].sort(),physical,table);
    assert.deepEqual(archive.files[table+'.csv'].trim().split(',').map(value=>JSON.parse(value)),columns);
   }
  }finally{await client.query('ROLLBACK');}
  const coverage=JSON.parse(await readFile('tests/support/registered66-export-coverage.json','utf8'));assert.equal(coverage.migrationCount,66);
  coverage.migrationCount=67;
  for(const [table,columns] of Object.entries(dictionary.columns)){
   assert(!coverage.tables.some(entry=>entry.table==='crest.'+table));
   coverage.tables.push({table:'crest.'+table,scope:'business',required:columns,excluded:[],partialEvidenceGroup:null});
  }
  assert.deepEqual(JSON.parse(await readFile('tests/support/registered67-export-coverage.json','utf8')),coverage);
  const frozenRegistry=JSON.parse(await readFile('tests/support/registered67-migration-checksums.json','utf8'));
  assert.equal(frozenRegistry.migrations.length,67);
  assert.equal(frozenRegistry.migrations.at(-1).sha256,candidate.sha256);
  await writeFile(path+'/candidate-export-coverage.json',JSON.stringify(coverage,null,2)+'\n');
  const {directory,...publicCandidate}=candidate;
  assert(directory.startsWith(sandbox.workspace));
  const owned=sandbox;sandbox=undefined;await owned.close();
  const probe=new pg.Client({connectionString:cluster.testDatabaseUrl,connectionTimeoutMillis:5000,statement_timeout:5000});
  await probe.connect();let foreignRole;
  try{
   assert.equal((await probe.query("SELECT count(*)::int count FROM pg_roles WHERE rolname='crest_custody_photo_dispatch'")).rows[0].count,0);
   await probe.query('CREATE ROLE crest_custody_photo_dispatch NOLOGIN NOINHERIT');
   foreignRole=(await probe.query("SELECT oid FROM pg_roles WHERE rolname='crest_custody_photo_dispatch'")).rows[0].oid;
   await assert.rejects(migrationSandbox(cluster.testDatabaseUrl),error=>error instanceof assert.AssertionError&&
    error.actual===1&&error.expected===0&&error.message.startsWith("refuse to adopt/drop other operators' roles"));
   assert.equal((await probe.query("SELECT oid FROM pg_roles WHERE rolname='crest_custody_photo_dispatch'")).rows[0].oid,foreignRole);
  }finally{
   if(foreignRole){
    assert.equal((await probe.query("SELECT oid FROM pg_roles WHERE rolname='crest_custody_photo_dispatch'")).rows[0].oid,foreignRole);
    await probe.query('DROP ROLE crest_custody_photo_dispatch');
   }
   await probe.end();
  }
  await writeFile(path+'/result.json',JSON.stringify({candidate:publicCandidate,migrationCount:67,
   prior66Retained:true,repeatedMigrationNoop:true,webSourceAndDirectTablesDenied:true,noPublicCustodyRoutines:true,
   allFivePhysicalCustodyTableFieldsExported:true,emptyCustodySnapshotVerified:true,
   populatedBusinessTablesRetained:businessBefore.length,existingBusinessRowHashesUnchanged:true,
   ownedPhotoRoleCleaned:true,foreignPhotoRoleNotAdoptedOrDropped:true,
   registered:true,ownerPreviewChanged:false},null,2)+'\n');
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
},{timeout:240000});
