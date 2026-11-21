import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {command,committed,issue} from '../support/invoice-outstanding-fixture.mjs';
import {syntheticInvoiceOutstandingAvailable} from '../../scripts/synthetic-migrations.mjs';
import {backupLegacy122Database,backupLegacy121Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
 restoreLegacy122Database,restoreLegacy121Database} from '../support/recovery-drill.mjs';

test('registered122 preserves populated121 and independently restores both frozen and current encrypted source',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();let sandbox,destination,directory;const restored=[];
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);await sandbox.apply(target,await sandbox.prefix(121));
  const web=await sandbox.connect(target),finance=await sandbox.connect(target);await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const service=randomUUID(),makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
   await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-balance-recovery',active:true,
    definition:{name:'Fictional recovery service',inclusions:'Interior',exclusions:'',internalGuidance:null,rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
   return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
  }});
  const today=(await admin.query("SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS value")).rows[0].value;
  const invoice=await issue({admin,web,finance,owner,service,today});
  const signature='crest_commands.read_fictional_invoice_outstanding(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)';
  assert.equal((await admin.query('SELECT to_regprocedure($1)::text AS value',[signature])).rows[0].value,null);
  directory=await privateWorkspace();const keys=await keyPair(directory),point121=join(directory,'frozen121'),point122=join(directory,'current122');
  await mkdir(point121,{mode:0o700});await mkdir(point122,{mode:0o700});
  const frozen=await backupLegacy121Database(admin,target,point121,keys.recipient);assert.equal(frozen.manifest.schemaVersion,121);
  assert.equal(frozen.manifest.completeBackup,false,'Database-only proof must not claim external object/vault completeness.');
  const before=await inventory(admin),beforeHistory=(await admin.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  await sandbox.apply(target,await sandbox.prefix(122));const history=(await admin.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  assert.equal(history.length,122);assert.deepEqual(history.slice(0,121),beforeHistory);
  assert.deepEqual((await inventory(admin)).filter(row=>row.schema!=='supabase_migrations'),before.filter(row=>row.schema!=='supabase_migrations'));
  const balance=await command(finance,'read_fictional_invoice_outstanding',[...owner.auth(),owner.customer,invoice.invoiceId]);assert.equal(balance.outstandingCents,'25000');
  const current=await backupLegacy122Database(admin,target,point122,keys.recipient);assert.equal(current.manifest.schemaVersion,122);assert.equal(current.manifest.completeBackup,false);
  destination=await recoveryCluster();
  for(const [version,point,restore,manifest]of [[121,point121,restoreLegacy121Database,frozen.manifest],[122,point122,restoreLegacy122Database,current.manifest]]){
   const url=await destination.database();assert.notEqual(new URL(url).port,new URL(target).port);
   assert.deepEqual(await restore(point,keys.path,url),manifest);const client=await connect(url);restored.push(client);
   assert.deepEqual(await inventory(client),manifest.rows);assert.equal((await client.query('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations')).rows[0].value,version);
   const defined=(await client.query('SELECT to_regprocedure($1)::text AS value',[signature])).rows[0].value;assert.equal(defined!==null,version===122);
   assert.equal(await syntheticInvoiceOutstandingAvailable(url),version===122);
   assert.equal((await client.query('SELECT total_cents::text AS value FROM crest.invoices WHERE business_id=$1 AND id=$2',[owner.business,invoice.invoiceId])).rows[0].value,'25000');
   if(version===122){assert.equal((await client.query("SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[signature])).rows[0].value,false);assert.equal((await client.query("SELECT has_function_privilege('crest_finance_preview',$1,'EXECUTE') AS value",[signature])).rows[0].value,true);}
  }
 }finally{
  for(const client of restored)await client.end();
  try{await destination?.close();}finally{try{await sandbox?.close();}finally{await cluster.close();}}
  if(directory){const absolute=await realpath(directory),base=await realpath(fileURLToPath(new URL('../../.local/recovery-drill/',import.meta.url)));assert.equal(absolute,resolve(directory));assert.equal(dirname(absolute),base);assert.match(basename(absolute),/^case-[A-Za-z0-9]+$/);await rm(absolute,{recursive:true});}
 }
});
