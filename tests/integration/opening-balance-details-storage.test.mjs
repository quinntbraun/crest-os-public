// Closed held storage only. No application writer or source adoption is claimed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
const tables=['opening_balance_details_origins','opening_balance_details_items','opening_balance_details_schedule_revisions','opening_balance_details_item_revisions'];
test('held balance-detail storage installs atomically with retained identities and no application write authority',{timeout:180000},async()=>{
 const sandbox=await migrationSandbox();let client;
 const registry=new URL('../../supabase/migration-checksums.json',import.meta.url),before=await readFile(registry);
 try{
  const target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);
  assert.equal((await sandbox.apply(target,await sandbox.prefix(142))).history.length,142);
  const sql=await readFile(new URL('../../planning/proposals/20270219180000_opening_balance_details_storage.sql',import.meta.url),'utf8');
  await client.query('BEGIN');try{await client.query(sql);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
  const rows=(await client.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[tables])).rows;
  assert.equal(rows.length,4);assert(rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  for(const table of tables){
   for(const role of ['crest_web','crest_finance_preview','crest_worker','crest_export','crest_finance_account_owner']){
    assert.equal((await client.query("SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role,'crest.'+table])).rows[0].allowed,false);
   }
   assert.equal((await client.query('SELECT count(*)::int AS count FROM crest.'+table)).rows[0].count,0);
   for(const statement of ['UPDATE crest.'+table+' SET id=id','DELETE FROM crest.'+table]){
    await client.query('BEGIN');try{await assert.rejects(client.query(statement),/CREST_RETAINED_COMMAND_HISTORY/);}finally{await client.query('ROLLBACK');}
   }
  }
  await client.query('BEGIN');try{
   await assert.rejects(client.query('TRUNCATE '+tables.map(table=>'crest.'+table).join(',')),/CREST_RETAINED_COMMAND_HISTORY/);
  }finally{await client.query('ROLLBACK');}
  await client.query('BEGIN');try{
   await client.query('SET LOCAL ROLE crest_schema_owner');
   await assert.rejects(client.query("INSERT INTO crest.opening_balance_details_origins(id,business_id,source_namespace,external_id,operation_id,recorded_by) VALUES($1,$2,'fixture','source',$3,$4)",[randomUUID(),randomUUID(),randomUUID(),randomUUID()]),error=>error.code==='42501');
  }finally{await client.query('ROLLBACK');}
  assert.equal((await client.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,142);
  assert((await readFile(registry)).equals(before));
  console.log('Held storage SHA256='+createHash('sha256').update(sql).digest('hex')+'; four closed tables, zero records, registered schema unchanged.');
 }finally{await sandbox.close();}
});
