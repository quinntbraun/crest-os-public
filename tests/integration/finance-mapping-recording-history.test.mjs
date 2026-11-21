// Real PostgreSQL authorization and upgrade checks; this authority fixture is not MFA.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {backupDatabase,backupLegacy122Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,restoreLegacy122Database} from '../support/recovery-drill.mjs';

const signature='crest_commands.read_finance_mapping_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer)';
async function call(db,name,args){return (await db.query('SELECT crest_commands.'+name+'('+args.map((_,index)=>'$'+(index+1)).join(',')+') AS result',args)).rows[0].result;}

test('mapping recording projection preserves122 history and enforces exact authorized retained evidence',{timeout:180000},async t=>{
 const cluster=process.env.CREST_TEST_DATABASE_URL?null:await recoveryCluster();let sandbox,destination,directory;const restored=[];
 try{
  sandbox=await migrationSandbox(cluster?.testDatabaseUrl??process.env.CREST_TEST_DATABASE_URL);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(122));assert.equal(previous.history.length,122);
  const web=await sandbox.connect(target),finance=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const create=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await create(),foreign=await create();
  for(const principal of [owner,foreign]){
   await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
    SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);
   const accountId=randomUUID();
   const result=await call(finance,'save_finance_account',[...principal.auth(),principal.epoch,randomUUID(),1,accountId,'0',{
    identity:{code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'revenue'},name:'Fictional retained service revenue',active:true,reason:null}]);
   assert.equal(result.state,'committed');
   assert.equal((await call(finance,'approve_fixed_finance_mapping',[...principal.auth(),principal.epoch,randomUUID(),'service_revenue','0',accountId,'2026-01-01','Fictional retained approval'])).state,'committed');
  }
  assert.equal((await call(finance,'approve_fixed_finance_mapping',[...owner.auth(),owner.epoch,randomUUID(),'service_revenue','1',null,'2026-04-01','Fictional retained closure'])).state,'committed');
  const legacy=()=>call(finance,'read_fixed_finance_mapping_history',[...owner.auth(),'service_revenue',null,25]);
  const beforeLegacy=await legacy();
  const facts=async()=>JSON.stringify((await admin.query(`SELECT jsonb_build_object(
   'mappings',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM crest.account_mapping_versions m),
   'events',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a),
   'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM crest_private.operations o)) AS result`)).rows[0].result);
  const before=await facts();
  directory=await privateWorkspace();const keys=await keyPair(directory),point122=join(directory,'frozen122'),point123=join(directory,'current123');
  await mkdir(point122,{mode:0o700});await mkdir(point123,{mode:0o700});
  const frozen=await backupLegacy122Database(admin,target,point122,keys.recipient);assert.equal(frozen.manifest.schemaVersion,122);assert.equal(frozen.manifest.completeBackup,false);

  await t.test('append-only upgrade preserves prior registry entries, command evidence and legacy response',async()=>{
   const upgraded=await sandbox.apply(target,await sandbox.prefix(123));assert.equal(upgraded.history.length,123);
   assert.deepEqual(upgraded.history.slice(0,122),previous.history);assert.deepEqual(await legacy(),beforeLegacy);
   assert.equal(await facts()===before,true,'The read projection migration must preserve every captured mapping/audit/operation fact.');
  });
  const read=(principal=owner,beforeVersion=null,limit=25,purpose='service_revenue')=>call(finance,'read_finance_mapping_history_evidence',[...principal.auth(),purpose,beforeVersion,limit]);
  await t.test('recording time and actor come from the exact retained audit event without identity expansion',async()=>{
   const result=await read();assert.equal(result.schemaVersion,2);assert.equal(result.rows.length,2);
   const actual=(await admin.query(`SELECT m.id::text,a.actor_id::text AS actor,
    to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp
    FROM crest.account_mapping_versions m JOIN crest_private.audit_events a
     ON (a.business_id,a.id)=(m.business_id,m.audit_event_id) WHERE m.business_id=$1`,[owner.business])).rows;
   for(const row of result.rows){const evidence=actual.find(value=>value.id===row.id);assert(evidence);
    assert.deepEqual(Object.keys(row.recording).sort(),['actorId','recordedAt']);
    assert.equal(row.recording.actorId===evidence.actor,true);assert.equal(row.recording.recordedAt===evidence.stamp,true);
    const original=Object.fromEntries(Object.entries(row).filter(([key])=>key!=="recording"));assert.deepEqual(original,beforeLegacy.rows.find(value=>value.id===row.id));
   }
   assert.deepEqual(Object.keys(result).sort(),Object.keys(beforeLegacy).sort());
   assert.equal(await facts()===before,true,'Reading must not append or rewrite financial source or audit events.');
  });
  await t.test('pagination, empty history and independent businesses retain their exact bounds',async()=>{
   const first=await read(owner,null,1),last=await read(owner,'2',1),empty=await read(owner,null,25,'category_fuel');
   assert.deepEqual(first.rows.map(row=>row.version),['2']);assert.equal(first.hasMore,true);
   assert.deepEqual(last.rows.map(row=>row.version),['1']);assert.equal(last.hasMore,false);
   assert.deepEqual(empty.rows,[]);assert.equal(empty.hasMore,false);
   const other=await read(foreign);assert.equal(other.businessId===foreign.business,true);assert.equal(other.rows.length,1);
   assert.equal(other.rows.some(row=>beforeLegacy.rows.some(saved=>saved.id===row.id)),false);
   const wrongBusiness=owner.auth();wrongBusiness[7]=foreign.business;
   await assert.rejects(call(finance,'read_finance_mapping_history_evidence',[...wrongBusiness,'service_revenue',null,25]),error=>error.code==='42501');
   await assert.rejects(read(owner,null,26),error=>error.code==='22023');
   assert.equal(await facts()===before,true);
  });
  await t.test('only the narrow finance command role can invoke the projection and raw audit rows stay private',async()=>{
   const permissions=(await admin.query(`SELECT has_function_privilege('crest_finance_preview',$1,'EXECUTE') AS finance,
    has_function_privilege('crest_web',$1,'EXECUTE') AS web,
    has_any_column_privilege('crest_finance_preview','crest_private.audit_events','SELECT') AS raw`,[signature])).rows[0];
   assert.deepEqual(permissions,{finance:true,web:false,raw:false});
   await assert.rejects(finance.query('SELECT recorded_at,actor_id FROM crest_private.audit_events LIMIT 1'),error=>error.code==='42501');
   const args=owner.auth();args[1]=randomUUID();
   await assert.rejects(call(finance,'read_finance_mapping_history_evidence',[...args,'service_revenue',null,25]),error=>error.code==='42501');
  });
  await t.test('independent encrypted122 and123 restores preserve recording facts and exact reader permissions',async()=>{
   const current=await backupDatabase(admin,target,point123,keys.recipient);assert.equal(current.manifest.schemaVersion,123);assert.equal(current.manifest.completeBackup,false);
   const definition=(await admin.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS value',[signature])).rows[0].value;
   destination=await recoveryCluster();
   for(const [version,point,restore,manifest]of [[122,point122,restoreLegacy122Database,frozen.manifest],[123,point123,restoreDatabase,current.manifest]]){
    const url=await destination.database();assert.notEqual(new URL(url).port,new URL(target).port);
    assert.deepEqual(await restore(point,keys.path,url),manifest);const client=await connect(url);restored.push(client);
    assert.deepEqual(await inventory(client),manifest.rows);
    const result=(await client.query(`SELECT jsonb_build_object(
     'mappings',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM crest.account_mapping_versions m),
     'events',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a),
     'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM crest_private.operations o)) AS result`)).rows[0].result;
    assert.equal(JSON.stringify(result)===before,true,'Independent recovery must preserve the exact captured financial and recording source.');
    const restoredDefinition=(await client.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS value',[signature])).rows[0].value;
    assert.equal(version===123?restoredDefinition===definition:restoredDefinition===null,true);
    if(version===123){const permissions=(await client.query(`SELECT has_function_privilege('crest_finance_preview',$1,'EXECUTE') AS finance,
     has_function_privilege('crest_web',$1,'EXECUTE') AS web,has_any_column_privilege('crest_finance_preview','crest_private.audit_events','SELECT') AS raw`,[signature])).rows[0];
     assert.deepEqual(permissions,{finance:true,web:false,raw:false});}
   }
  });
 }finally{
  for(const client of restored)await client.end();
  try{await destination?.close();}finally{try{await sandbox?.close();}finally{await cluster?.close();}}
  if(directory){const absolute=await realpath(directory),base=await realpath(resolve('.local/recovery-drill'));assert.equal(dirname(absolute),base);assert.match(basename(absolute),/^case-[A-Za-z0-9]+$/);await rm(absolute,{recursive:true});}
 }
});
