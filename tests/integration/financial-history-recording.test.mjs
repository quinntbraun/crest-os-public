// PostgreSQL authority/upgrade/recovery fixtures; genuine MFA is checked separately.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {backupDatabase,backupLegacy123Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,restoreLegacy123Database} from '../support/recovery-drill.mjs';
const authority='bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid';
const readers=[
 {kind:'account',name:'read_finance_account_history',tail:'uuid,bigint,integer'},
 {kind:'tax',name:'read_finance_tax_profile_history',tail:'text,text,uuid,bigint,integer'},
 {kind:'channel',name:'read_money_channel_history',tail:'uuid,bigint,integer'},
];
const signature=reader=>'crest_commands.'+reader.name+'_evidence('+authority+','+reader.tail+')';
const helper='crest_private.finance_history_recording_evidence(jsonb,uuid,text)';
async function call(db,name,args){return (await db.query('SELECT crest_commands.'+name+'('+args.map((_,index)=>'$'+(index+1)).join(',')+') AS result',args)).rows[0].result;}
const factsSql=`SELECT jsonb_build_object(
 'accounts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest.accounts r),
 'versions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest.account_versions r),
 'tax',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest.tax_profiles r),
 'channels',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest.money_channel_versions r),
 'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest_private.audit_events r),
 'operations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM crest_private.operations r)) AS result`;

test('registered124 financial recording evidence preserves123 and independently recovers all three histories',{timeout:240000},async t=>{
 const cluster=process.env.CREST_TEST_DATABASE_URL?null:await recoveryCluster();let sandbox,destination,directory;const restored=[];
 try{
  sandbox=await migrationSandbox(cluster?.testDatabaseUrl??process.env.CREST_TEST_DATABASE_URL);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(123));assert.equal(previous.history.length,123);
  const web=await sandbox.connect(target),finance=await sandbox.connect(target);await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const create=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await create(),foreign=await create();
  const selections=new Map();
  for(const principal of [owner,foreign]){
   await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
    SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);
   const accountId=randomUUID(),channelId=randomUUID();
   const saveAccount=(version,body)=>call(finance,'save_finance_account',[...principal.auth(),principal.epoch,randomUUID(),1,accountId,version,body]);
   assert.equal((await saveAccount('0',{identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},name:'Fictional original bank',active:true,reason:null})).state,'committed');
   assert.equal((await saveAccount('1',{identity:null,name:'Fictional reviewed bank',active:true,reason:'Fictional retained rename'})).state,'committed');
   const channel={identity:{accountId,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'1234'},label:'Fictional checking',effectiveFrom:'2026-01-01',ownershipEvidence:null,openingState:'unknown',openingOn:null,openingCents:null,openingEvidence:null,active:true,reason:'Fictional channel review'};
   assert.equal((await call(finance,'save_money_channel',[...principal.auth(),principal.epoch,randomUUID(),channelId,'0',channel])).state,'committed');
   assert.equal((await call(finance,'save_money_channel',[...principal.auth(),principal.epoch,randomUUID(),channelId,'1',{...channel,identity:null,effectiveFrom:'2026-04-01',active:false,reason:'Fictional retained channel closure'}])).state,'committed');
   const scope=['Fictional history district','tip',null];
   for(const [version,date,treatment,evidence]of [['0','2026-01-01','non_taxable','Fictional retained tax verification'],['1','2026-04-01','unresolved',null]])assert.equal((await call(finance,'approve_finance_tax_profile',[...principal.auth(),principal.epoch,randomUUID(),...scope,version,date,treatment,null,evidence,'Fictional retained tax review'])).state,'committed');
   selections.set(principal,{account:[accountId,'0',25],tax:[...scope,null,25],channel:[channelId,null,25]});
  }
  const read=(reader,principal=owner,enriched=false,args=selections.get(principal)[reader.kind])=>call(finance,reader.name+(enriched?'_evidence':''),[...principal.auth(),...args]);
  const legacy=await Promise.all(readers.map(reader=>read(reader)));
  const facts=async db=>JSON.stringify((await db.query(factsSql)).rows[0].result),before=await facts(admin);
  directory=await privateWorkspace();const keys=await keyPair(directory),oldPoint=join(directory,'frozen123'),currentPoint=join(directory,'current124');
  await mkdir(oldPoint,{mode:0o700});await mkdir(currentPoint,{mode:0o700});
  const frozen=await backupLegacy123Database(admin,target,oldPoint,keys.recipient);assert.equal(frozen.manifest.schemaVersion,123);assert.equal(frozen.manifest.completeBackup,false);
  await t.test('append-only upgrade retains every123 input, old response and financial source fact',async()=>{
   for(const reader of readers)assert.equal((await admin.query('SELECT to_regprocedure($1)::text AS result',[signature(reader)])).rows[0].result,null);
   const upgraded=await sandbox.apply(target,await sandbox.prefix(124));assert.equal(upgraded.history.length,124);assert.deepEqual(upgraded.history.slice(0,123),previous.history);
   for(let index=0;index<readers.length;index++)assert.deepEqual(await read(readers[index]),legacy[index]);
   assert.equal(await facts(admin)===before,true);
  });
  await t.test('all recorded times and actor references match exact retained audit events without changing snapshots',async()=>{
   for(let index=0;index<readers.length;index++){
    const result=await read(readers[index],owner,true);assert.equal(result.schemaVersion,2);assert.equal(result.rows.length,2);
    for(const row of result.rows){const audit=(await admin.query(`SELECT actor_id::text AS actor,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp FROM crest_private.audit_events WHERE business_id=$1 AND id=$2`,[owner.business,row.auditEventId])).rows[0];assert(audit);
     assert.deepEqual(Object.keys(row.recording).sort(),['actorId','recordedAt']);assert.equal(row.recording.actorId===audit.actor,true);assert.equal(row.recording.recordedAt===audit.stamp,true);
     const original=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='recording'));assert.deepEqual(original,legacy[index].rows.find(saved=>saved.auditEventId===row.auditEventId));
    }
   }assert.equal(await facts(admin)===before,true);
  });
  await t.test('each original pagination direction and cross-business authorization remain enforced',async()=>{
   for(const reader of readers){const selected=[...selections.get(owner)[reader.kind]],wrong=owner.auth();wrong[7]=foreign.business;
    await assert.rejects(call(finance,reader.name+'_evidence',[...wrong,...selected]),error=>error.code==='42501');
    const other=await read(reader,foreign,true);assert.equal(other.businessId===foreign.business,true);
    assert.equal(other.rows.some(row=>legacy.flatMap(result=>result.rows).some(saved=>saved.auditEventId===row.auditEventId)),false);
    selected[selected.length-1]=1;const first=await read(reader,owner,true,selected);assert.equal(first.rows.length,1);assert.equal(first.hasMore,true);
    selected[selected.length-2]=reader.kind==='account'?'1':'2';const last=await read(reader,owner,true,selected);assert.equal(last.rows.length,1);assert.equal(last.hasMore,false);
   }assert.equal(await facts(admin)===before,true);
  });
  async function permissions(db){for(const reader of readers){const result=(await db.query(`SELECT has_function_privilege('crest_finance_preview',$1,'EXECUTE') AS finance,has_function_privilege('crest_web',$1,'EXECUTE') AS web`,[signature(reader)])).rows[0];assert.deepEqual(result,{finance:true,web:false});}
   assert.equal((await db.query("SELECT has_function_privilege('crest_finance_preview',$1,'EXECUTE') AS helper,has_any_column_privilege('crest_finance_preview','crest_private.audit_events','SELECT') AS raw",[helper])).rows[0].helper,false);
   assert.equal((await db.query("SELECT has_any_column_privilege('crest_finance_preview','crest_private.audit_events','SELECT') AS raw")).rows[0].raw,false);
  }
  await t.test('only the protected wrappers are callable; the helper, raw audit and invalid sessions stay denied',async()=>{
   await permissions(admin);await assert.rejects(finance.query('SELECT recorded_at,actor_id FROM crest_private.audit_events'),error=>error.code==='42501');
   await assert.rejects(finance.query('SELECT crest_private.finance_history_recording_evidence($1::jsonb,$2::uuid,$3::text)',['{}',owner.business,'accounts']),error=>error.code==='42501');
   for(const reader of readers){const args=owner.auth();args[1]=randomUUID();await assert.rejects(call(finance,reader.name+'_evidence',[...args,...selections.get(owner)[reader.kind]]),error=>error.code==='42501');}
  });
  await t.test('independent encrypted123 and124 restores retain exact source, reader definitions and restricted permissions',async()=>{
   const current=await backupDatabase(admin,target,currentPoint,keys.recipient);assert.equal(current.manifest.schemaVersion,124);assert.equal(current.manifest.completeBackup,false);
   const definitions=await Promise.all(readers.map(async reader=>(await admin.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS result',[signature(reader)])).rows[0].result));
   destination=await recoveryCluster();
   for(const [version,point,restore,manifest]of [[123,oldPoint,restoreLegacy123Database,frozen.manifest],[124,currentPoint,restoreDatabase,current.manifest]]){
    const url=await destination.database();assert.notEqual(new URL(url).port,new URL(target).port);assert.deepEqual(await restore(point,keys.path,url),manifest);
    const client=await connect(url);restored.push(client);assert.deepEqual(await inventory(client),manifest.rows);assert.equal(await facts(client)===before,true);
    for(let index=0;index<readers.length;index++){const actual=(await client.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS result',[signature(readers[index])])).rows[0].result;assert.equal(version===124?actual===definitions[index]:actual===null,true);}
    if(version===124)await permissions(client);
   }
  });
 }finally{
  for(const client of restored)await client.end();try{await destination?.close();}finally{try{await sandbox?.close();}finally{await cluster?.close();}}
  if(directory){const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(resolve('.local/recovery-drill')));assert.match(basename(actual),/^case-[A-Za-z0-9]+$/);await rm(actual,{recursive:true});}
 }
});
