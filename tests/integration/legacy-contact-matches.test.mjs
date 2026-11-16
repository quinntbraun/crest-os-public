import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {strFromU8,unzipSync} from 'fflate';
import {createLegacyContactDownloadArchive} from '../../src/customer/legacy-contact-download-archive.ts';
import {test} from 'node:test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {captureLegacyContactDraftSource} from '../../src/customer/legacy-contact-batch-source.ts';
import {captureLegacyContactApplicationSource} from '../../src/customer/legacy-contact-application-source.ts';
import {captureLegacyContactRequestSource} from '../../src/customer/legacy-contact-request-source.ts';
import {captureLegacyContactApprovalSource} from '../../src/customer/legacy-contact-approval-source.ts';
import {captureLegacyContactDecisionSource} from '../../src/customer/legacy-contact-decision-source.ts';
import {syntheticLegacyContactBatchesAvailable,syntheticLegacyContactEffectsAvailable,syntheticLegacyContactTargetsAvailable,syntheticLegacyContactDecisionsAvailable,syntheticLegacyContactApprovalsAvailable} from '../../scripts/synthetic-migrations.mjs';
import {prepareLegacyContactBatch} from '../../src/customer/legacy-contact-batch-stage.ts';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {backupDatabase,backupContactApplicationCandidateDatabase,backupContactQueueCandidateDatabase,backupLegacyContactApplicationDatabase,backupLegacyContactApprovalDatabase,backupLegacyContactReviewDatabase,backupLegacyContactDecisionDatabase,connect,keyPair,recoveryCluster,restoreDatabase,restoreContactApplicationCandidateDatabase,restoreContactQueueCandidateDatabase,restoreLegacyContactApplicationDatabase,restoreLegacyContactApprovalDatabase,restoreLegacyContactReviewDatabase,normalizedSchema,postgresTool,restoreLegacyContactDecisionDatabase} from '../support/recovery-drill.mjs';

const issuer='https://auth.example.com/auth/v1';
const credential=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const contactSql='SELECT crest_commands.find_legacy_contact_matches($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
const vinSql='SELECT crest_commands.find_legacy_vehicle_matches($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result';
async function value(client,sql,parameters=[]){
 return (await client.query(sql,parameters)).rows[0]?.result;
}
async function principal(client,bootstrap){
 const subject=randomUUID(),provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 const actor=await value(client,"INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Fictional import owner',$1,$2,$3,$3,'manual') RETURNING id AS result",[issuer,subject,bootstrap]);
 await client.query('BEGIN');
 let business,epoch;
 try{
  business=await value(client,"INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Fictional import business','UTC',$1,$1,'manual') RETURNING id AS result",[actor]);
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  epoch=await value(client,"INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS result",[business,actor]);
  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK');
  throw error;
 }
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'fictional-'+subject+'@example.test']);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,actor,provider,hash,randomBytes(32)]);
 return {actor,business,epoch,subject,provider,session,hash};
}
async function saveFixtureRecord(web,principal,kind,draft){
 const statement=kind==='customer'
  ?'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result'
  :'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result';
 const id=randomUUID(),result=await value(web,statement,[...credential(principal),principal.epoch,randomUUID(),id,draft]);
 assert.equal(result.state,'committed');
 return id;
}
const activeCustomer={displayName:'Fictional Detailing Customer',phone:'(317) 555-0100',email:'shared@example.test',contactPreference:null,
 outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null};
const activeVehicle={label:'Fictional wagon',year:null,make:null,model:null,color:null,vin:'AB-1298',plate:null,kind:'customer_vehicle',notes:null,
 archived:false,archiveReason:null};
const empty={count:0,firstIds:[]};
async function evidence(client){
 return value(client,"SELECT jsonb_build_object('customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM crest.customers c),'vehicles',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.vehicles v),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM crest_private.operations o),'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM crest_private.audit_events a)) AS result");
}

test('registered legacy matches normalize indexed hints, include archived evidence and enforce fresh tenant authority',{timeout:process.env.CREST_TEST_LEGACY_APPLY_CAPACITY==='1'?600000:300000},async t=>{
 const cluster=process.env.CREST_TEST_DATABASE_URL?null:await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster?.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  const installed=await sandbox.apply(target,await sandbox.prefix(109));
  assert.equal(installed.history.length,109);
  const bootstrap=await value(admin,"SELECT id AS result FROM crest_private.actors WHERE system_key='security_bootstrap'");
  const owner=await principal(admin,bootstrap),other=await principal(admin,bootstrap);
  const web=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  const ownerCustomerIds=[];
  for(let i=0;i<7;i++)ownerCustomerIds.push(await saveFixtureRecord(web,owner,'customer',{
   ...activeCustomer,...(i===1?{archived:true,archiveReason:'Fictional archived record'}:{}),
  }));
  const exactVehicle=await saveFixtureRecord(web,owner,'vehicle',activeVehicle);
  await saveFixtureRecord(web,owner,'vehicle',{...activeVehicle,vin:'AB-12980'});
  await saveFixtureRecord(web,other,'customer',activeCustomer);
  await saveFixtureRecord(web,other,'vehicle',activeVehicle);
  const before=await evidence(admin);
  const adopted=await sandbox.apply(target,await sandbox.prefix(110));
  assert.equal(adopted.history.length,110);
  assert.deepEqual(adopted.history.slice(0,109),installed.history);
  assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(110))).history,adopted.history);
  assert.deepEqual(await evidence(admin),before);
  const match={count:7,firstIds:ownerCustomerIds.sort().slice(0,5)};
  const findContact=(phone,email,p=owner)=>value(web,contactSql,[...credential(p),phone,email]);
  const findVehicle=(vin,p=owner)=>value(web,vinSql,[...credential(p),vin]);

  await t.test('only exact normalized matches are returned, preserving input order and bounded IDs',async()=>{
   assert.deepEqual(await findContact(['317.555.0100','unknown','3175550100','5550100'],[' SHARED@EXAMPLE.TEST ','shared@']),
    {schemaVersion:1,businessId:owner.business,phone:[match,empty,match,empty],email:[match,empty]});
   assert.deepEqual(await findVehicle(['ab 1298','AB 12','12980']),
    {schemaVersion:1,businessId:owner.business,vin:[{count:1,firstIds:[exactVehicle]},empty,empty]});
   assert.deepEqual(await findVehicle([]),{schemaVersion:1,businessId:owner.business,vin:[]});
  });
  await t.test('matches remain tenant-bound and require the current owner session',async()=>{
   assert.equal((await findContact(['3175550100'],[],other)).phone[0].count,1);
   for(const wrong of [{...owner,business:other.business},{...owner,hash:randomBytes(32)}]){
    await assert.rejects(findContact(['3175550100'],[],wrong),{code:'42501'});
    await assert.rejects(findVehicle(['AB-1298'],wrong),{code:'42501'});
   }
   await web.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   try{
    await assert.rejects(findContact(['3175550100'],[]),{code:'25001'});
   }finally{await web.query('ROLLBACK');}
  });
  await t.test('the native boundary rejects malformed inputs and applies no business writes',async()=>{
   for(const hints of [null,[null],[''],[['one'],['two']],['x'.repeat(513)],['x\n'],Array(10001).fill('x')]){
    await assert.rejects(findContact(hints,[]),{code:'22023'});
   }
   await assert.rejects(findVehicle(['A'.repeat(129)]),{code:'22023'});
   const limit=await findContact(Array(10000).fill('3175550100'),[]);
   assert.equal(limit.phone.length,10000);
   assert.deepEqual(limit.phone.at(-1),match);
   assert.deepEqual(await evidence(admin),before);
  });
  await t.test('public, supplier-worker and export roles have no matching execution grant',async()=>{
   const grants=await admin.query("SELECT r.rolname AS role, p.proname AS operation, has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='crest_commands' AND p.proname IN ('find_legacy_contact_matches','find_legacy_vehicle_matches') AND r.rolname IN ('crest_web','crest_export','crest_supplier_bill_document_worker','anon','authenticated') ORDER BY r.rolname,p.proname");
   assert.equal(grants.rows.length,10);
   for(const entry of grants.rows)assert.equal(entry.allowed,entry.role==='crest_web',entry.role+' '+entry.operation);
   await assert.rejects(web.query('SELECT phone_normalized FROM crest.customers'),{code:'42501'});
  });

  await t.test('staging preserves a complete resumable batch and protected audit receipt',async staging=>{
   assert.equal(await syntheticLegacyContactBatchesAvailable(target),false);
   const registered=await sandbox.apply(target,await sandbox.prefix(111));
   assert.equal(registered.history.length,111);
   assert.deepEqual(registered.history.slice(0,110),adopted.history);
   assert.equal(await syntheticLegacyContactBatchesAvailable(target),true);
   assert.equal(await syntheticLegacyContactEffectsAvailable(target),false);
   const raw=new TextEncoder().encode('Id,Name,VId,Vehicle,Balance,Phone,VIN\n001,Fictional Riley,V-1,Fictional wagon,ignore-this-amount,317.555.0100,AB 1298\n,Missing identity,,,99,,\n003,Fictional Morgan,,,47,,');
   const mapping={customerSourceId:'Id',displayName:'Name',vehicleSourceId:'VId',vehicleLabel:'Vehicle',phone:'Phone',vehicleVin:'VIN'};
   const prepared=await prepareLegacyContactBatch(raw,mapping,owner.business,'Fictional previous CRM');
   assert.equal(prepared.candidates.length,3);
   assert.equal(prepared.candidates[0].customer.sourceId,'001');
   assert.equal(prepared.candidates[0].customer.outreachOptOut,null);
   assert.equal(prepared.candidates[0].vehicle.sourceId,'V-1');
   assert(!JSON.stringify(prepared).includes('ignore-this-amount'));
   const stageSql='SELECT crest_commands.stage_legacy_contact_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result';
   const resumeSql='SELECT crest_commands.read_legacy_contact_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result';
   const batch=randomUUID(),op=randomUUID();
   const args=(data=prepared,principal=owner,operation=op,id=batch)=>[...credential(principal),principal.epoch,operation,id,
    data.sourceLabel,data.originalSha256,data.mapping,JSON.stringify(data.candidates)];
   const resume=(connection,principal,after,size,id=batch)=>value(connection,resumeSql,[...credential(principal),id,after,size]);
   const beforeRows=(await evidence(admin));
   const first=await value(web,stageSql,args());
   assert.equal(first.state,'committed');
   assert.equal(first.receipt.state,'staged');
   assert.equal(first.receipt.originalSha256,prepared.originalSha256);
   assert.equal(first.receipt.rejectedCount,1);
   assert.deepEqual(await value(web,stageSql,args()),first);
   assert.deepEqual(await value(web,stageSql,args(prepared,owner,randomUUID(),randomUUID())),
    {state:'already_staged',receipt:first.receipt});
   const conflict={...prepared,candidates:prepared.candidates.map((row,index)=>index===0
    ?{...row,customer:{...row.customer,displayName:'Changed mapped value'}}:row)};
   assert.deepEqual(await value(web,stageSql,args(conflict)),{state:'conflict',reason:'operation'});
   assert.deepEqual(await value(web,stageSql,args(conflict,owner,randomUUID(),randomUUID())),{state:'conflict',reason:'source'});
   await assert.rejects(value(web,stageSql,args({...prepared,candidates:[{customer:{balance:'100.00'},vehicle:null,issues:[]}]},owner,randomUUID(),randomUUID())),{code:'22023'});
   await assert.rejects(value(web,stageSql,args(prepared,{...owner,business:other.business})),{code:'42501'});
   const later=await sandbox.connect(target);
   await later.query('SET ROLE crest_web');
   const one=await resume(later,owner,1,2),two=await resume(later,owner,3,2);
   assert.equal(one.state,'present');
   assert.deepEqual(one.mapping,mapping);
   assert.deepEqual(one.receipt,first.receipt);
   assert.equal(one.hasMore,true);
   assert.equal(two.hasMore,false);
   assert.deepEqual([...one.rows,...two.rows].map(row=>row.sourceRow),[2,3,4]);
   assert.deepEqual([...one.rows,...two.rows].map(row=>row.candidate),prepared.candidates);
   assert([...one.rows,...two.rows].every(record=>/^[a-f0-9]{64}$/.test(record.fingerprint)));
   assert.deepEqual(await resume(later,other,1,2),{state:'absent'});
   await assert.rejects(later.query('SELECT * FROM crest.legacy_contact_batch_rows'),{code:'42501'});
   await assert.rejects(value(later,stageSql,args(prepared,{...owner,epoch:randomUUID()},randomUUID(),randomUUID())),{code:'P0001'});

   const race={...prepared,sourceLabel:'Second fictional import source'};
   const raced=await Promise.all([web,later].map(connection=>value(connection,stageSql,args(race,owner,randomUUID(),randomUUID()))));
   assert.deepEqual(raced.map(result=>result.state).sort(),['already_staged','committed']);
   assert.equal(raced[0].receipt.batchId,raced[1].receipt.batchId);
   const listSql='SELECT crest_commands.list_legacy_contact_batches($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
   const latest=await value(later,listSql,[...credential(owner),null,1]);
   assert.equal(latest.hasMore,true);
   assert.deepEqual(latest.batches,[raced[0].receipt]);
   const earliest=await value(later,listSql,[...credential(owner),raced[0].receipt.batchId,1]);
   assert.equal(earliest.hasMore,false);
   assert.deepEqual(earliest.batches,[first.receipt]);
   assert.deepEqual(await value(later,listSql,[...credential(other),batch,1]),{state:'absent'});

   const abandoned={...prepared,sourceLabel:'Fictional rolled-back batch'},abortedId=randomUUID(),abortedOp=randomUUID();
   await later.query('BEGIN');
   try{
    assert.equal((await value(later,stageSql,args(abandoned,owner,abortedOp,abortedId))).state,'committed');
   }finally{await later.query('ROLLBACK');}
   assert.deepEqual(await resume(web,owner,1,2,abortedId),{state:'absent'});
   assert.equal(await value(admin,'SELECT count(*)::int AS result FROM crest_private.operations WHERE operation_id=$1',[abortedOp]),0);
   const inconsistent={...prepared,sourceLabel:'Fictional incomplete source'},inconsistentBatch=randomUUID();
   await admin.query('BEGIN');
   try{
    await admin.query('SET LOCAL ROLE crest_web');
    await value(admin,stageSql,args(inconsistent,owner,randomUUID(),inconsistentBatch));
    await admin.query('RESET ROLE');
    await admin.query("INSERT INTO crest.legacy_contact_batch_rows(business_id,batch_id,source_row,candidate,fingerprint) SELECT $1,$2,5,$3::jsonb,encode(sha256(convert_to(($3::jsonb)::text,'UTF8')),'hex')",
     [owner.business,inconsistentBatch,prepared.candidates[0]]);
    await assert.rejects(admin.query('COMMIT'),{code:'23514',message:'CREST_LEGACY_BATCH_ROW_PROOF_REQUIRED'});
   }finally{await admin.query('ROLLBACK');}
   assert.deepEqual(await resume(web,owner,1,2,inconsistentBatch),{state:'absent'});
   const afterRows=await evidence(admin);
   assert.deepEqual(afterRows.customers,beforeRows.customers);
   assert.deepEqual(afterRows.vehicles,beforeRows.vehicles);
   assert.equal(afterRows.operations.length-beforeRows.operations.length,2);
   assert.equal(afterRows.audits.length-beforeRows.audits.length,2);
   assert.equal(await value(admin,"SELECT count(*)::int AS result FROM crest_private.audit_events WHERE entity_kind='legacy_contact_batches' AND action='stage'"),2);
   const withEffects=await sandbox.apply(target,await sandbox.prefix(112));
   assert.equal(withEffects.history.length,112);
   assert.deepEqual(withEffects.history.slice(0,111),registered.history);
   assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(112))).history,withEffects.history);
   assert.equal(await syntheticLegacyContactEffectsAvailable(target),true);
   assert.equal(await syntheticLegacyContactTargetsAvailable(target),false);
   assert.deepEqual(await resume(web,owner,1,2),one);
   assert.deepEqual(await evidence(admin),afterRows);
   const effectSql='SELECT crest_commands.review_legacy_contact_effects($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
   const persistedEffects=await value(web,effectSql,[...credential(owner),batch,1]);
   assert.deepEqual(persistedEffects.findings.map(finding=>finding.row),[2,3]);
   const withTargets=await sandbox.apply(target,await sandbox.prefix(113));
   assert.equal(withTargets.history.length,113);
   assert.deepEqual(withTargets.history.slice(0,112),withEffects.history);
   assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(113))).history,withTargets.history);
   assert.equal(await syntheticLegacyContactTargetsAvailable(target),true);
   assert.deepEqual(await value(web,effectSql,[...credential(owner),batch,1]),persistedEffects);
   assert.deepEqual(await evidence(admin),afterRows);
   const targetSql='SELECT crest_commands.find_legacy_import_targets($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
   const retainedTargets=await value(web,targetSql,[...credential(owner),batch,2,'customer',null]);
   assert.deepEqual(retainedTargets.items.map(candidate=>candidate.id),ownerCustomerIds);
   const maximum=new TextEncoder().encode('Id,Name\n'+Array.from({length:100000},(_,i)=>i+',Fictional capacity record').join('\n'));
   const full=await prepareLegacyContactBatch(maximum,{customerSourceId:'Id',displayName:'Name'},owner.business,'Fictional capacity check');
   const fullBatch=randomUUID();
   await later.query('BEGIN');
   try{
    const permissions=await later.query(`SELECT role,has_function_privilege(role,
     'crest_commands.review_legacy_contact_effects(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer)','EXECUTE') AS can_read
     FROM unnest(ARRAY['crest_web','crest_export','crest_supplier_bill_document_worker','anon','authenticated']) role`);
    for(const {role,can_read} of permissions.rows)assert.equal(can_read,role==='crest_web');
    const targetPermissions=await later.query(`SELECT role,has_function_privilege(role,
     'crest_commands.find_legacy_import_targets(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,uuid)','EXECUTE') AS can_read
     FROM unnest(ARRAY['crest_web','crest_export','crest_supplier_bill_document_worker','anon','authenticated']) role`);
    for(const {role,can_read} of targetPermissions.rows)assert.equal(can_read,role==='crest_web');
    const review=(id=fullBatch,p=owner,after=1)=>value(later,effectSql,[...credential(p),id,after]);
    await later.query("SET LOCAL statement_timeout='10s'");
    const retained=await value(later,stageSql,args(full,owner,randomUUID(),fullBatch));
    assert.equal(retained.receipt.rowCount,100000);
    await later.query('SET CONSTRAINTS ALL IMMEDIATE');
    const last=await resume(later,owner,100000,1,fullBatch);
    assert.equal(last.rows[0].sourceRow,100001);
    assert.equal(last.rows[0].candidate.customer.sourceId,'99999');
    assert.equal(last.hasMore,false);
    const large=await review();
    assert.equal(large.totalRows,100000);
    assert.equal(large.candidateCustomers,100000);
    assert.equal(large.reviewRows,0);
    assert.equal(large.candidateVehicles,0);
    assert.deepEqual(large.findings,[]);
    assert.equal(large.hasMoreFindings,false);
    assert.equal(large.rowsSha256,retained.receipt.rowsSha256);
    assert.deepEqual(await review(fullBatch,other),{state:'absent'});

    const mixedCsv=new TextEncoder().encode([
     'Id,Name,Phone,Email,VId,Vehicle,VIN',
     '1,Riley,317.555.0100,SHARED@example.test,car-1,Wagon,ab 1298',
     '1,Riley updated,317.555.0100,,,,',
     '2,Morgan,3175550100,,car-1,Wagon,ab 1298',
     '3,Avery,,,car-2,Truck,XY-331',
     '3,Avery,,,car-2,Truck,XY-331',
     ',Missing identity,,,,,',
    ].join('\n'));
    const mixedMapping={...mapping,phone:'Phone',email:'Email',vehicleVin:'VIN'};
    const mixed=await prepareLegacyContactBatch(mixedCsv,mixedMapping,owner.business,'Fictional effect review');
    const mixedBatch=randomUUID();
    await later.query('SET CONSTRAINTS ALL DEFERRED');
    const saved=await value(later,stageSql,args(mixed,owner,randomUUID(),mixedBatch));
    const effects=await review(mixedBatch);
    const {findings,hasMoreFindings,...totals}=effects;
    assert.deepEqual(totals,{state:'present',schemaVersion:1,businessId:owner.business,batchId:mixedBatch,
     rowsSha256:saved.receipt.rowsSha256,totalRows:6,rejectedRows:1,reviewRows:3,
     candidateCustomers:3,candidateVehicles:2,candidateLinks:3,sourceConflictRows:3,sharedHintRows:3,
     savedContactRows:3,savedVehicleRows:2});
    assert.equal(hasMoreFindings,false);
    assert.deepEqual(findings.map(({row,reasons})=>[row,reasons]),[
     [2,['customer_source_conflict','vehicle_source_conflict','shared_phone','saved_phone','saved_email','saved_vin']],
     [3,['customer_source_conflict','shared_phone','saved_phone']],
     [4,['vehicle_source_conflict','shared_phone','saved_phone','saved_vin']],
     [7,[]],
    ]);
    assert.deepEqual(findings[3].issues,mixed.candidates[5].issues);
    assert.deepEqual((await review(mixedBatch,owner,3)).findings,findings.slice(2));
    const targets=(row,kind,after=null,p=owner)=>value(later,targetSql,[...credential(p),mixedBatch,row,kind,after]);
    const allCustomerIds=[...ownerCustomerIds];
    for(let i=0;i<6;i++)allCustomerIds.push(await saveFixtureRecord(later,owner,'customer',activeCustomer));
    allCustomerIds.sort();
    const firstTargets=await targets(2,'customer');
    const secondTargets=await targets(2,'customer',firstTargets.items.at(-1).id);
    assert.equal(firstTargets.rowsSha256,saved.receipt.rowsSha256);
    assert.equal(firstTargets.hasMore,true);
    assert.equal(secondTargets.hasMore,false);
    const candidates=[...firstTargets.items,...secondTargets.items];
    assert.deepEqual(candidates.map(candidate=>candidate.id),allCustomerIds);
    assert.equal(candidates.filter(candidate=>candidate.archived).length,1);
    for(const candidate of candidates){
     assert.deepEqual([candidate.version,candidate.matched,candidate.suffix,candidate.descriptor],['1',['phone','email'],'0100','example.test']);
    }
    assert.deepEqual((await targets(2,'vehicle')).items.map(({id,matched})=>[id,matched]),[[exactVehicle,['vin']]]);
    assert.deepEqual((await targets(7,'customer')).items,[]);
    assert.deepEqual(await targets(2,'customer',null,other),{state:'absent'});
    await later.query('SAVEPOINT target_session');
    await assert.rejects(targets(2,'customer',null,{...owner,hash:randomBytes(32)}),{code:'42501'});
    await later.query('ROLLBACK TO SAVEPOINT target_session');
    await later.query('SAVEPOINT target_shape');
    await assert.rejects(targets(2,'job'),{code:'22023'});
    await later.query('ROLLBACK TO SAVEPOINT target_shape');
    await later.query('SAVEPOINT stale_review');
    await assert.rejects(review(mixedBatch,{...owner,hash:randomBytes(32)}),{code:'42501'});
    await later.query('ROLLBACK TO SAVEPOINT stale_review');
    assert.deepEqual(await review(mixedBatch),effects);
    await assert.rejects(review(mixedBatch,owner,0),{code:'22023'});
    await later.query('ROLLBACK TO SAVEPOINT stale_review');
   }finally{await later.query('ROLLBACK');}
   assert.deepEqual(await resume(later,owner,1,2,fullBatch),{state:'absent'});

   const exporter=await sandbox.connect(target);
   await exporter.query('SET ROLE crest_export');
   const exportSql='SELECT crest_commands.legacy_contact_batch_source_page($1,$2,$3) AS result';
   await assert.rejects(value(web,exportSql,[owner.business,null,20]),{code:'42501'});
   await assert.rejects(value(exporter,exportSql,[owner.business,null,20]),{code:'25001'});
   await assert.rejects(exporter.query('SELECT * FROM crest.legacy_contact_batch_rows'),{code:'42501'});
   async function exported(connection,business){
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
     const rendered=[];
     for await(const line of captureLegacyContactDraftSource(connection.query.bind(connection),business,AbortSignal.timeout(20000)))rendered.push(line);
     return rendered;
    }finally{await connection.query('ROLLBACK');}
   }
   const originalSource=await exported(exporter,owner.business);
   assert.equal(originalSource.length,9);
   assert(!originalSource.join('').includes('ignore-this-amount'));
   assert.equal((await exported(exporter,other.business)).length,1);
   const point=join(sandbox.workspace,'registered113-import-backup');
   await mkdir(point,{mode:0o700});
   const keys=await keyPair(point),checkpoint=await backupLegacyContactReviewDatabase(admin,target,point,keys.recipient);
   assert.equal(checkpoint.manifest.schemaVersion,113);
   const independent=await recoveryCluster();
   let restored;
   try{
    const destination=await independent.database();
    assert.deepEqual(await restoreLegacyContactReviewDatabase(point,keys.path,destination),checkpoint.manifest);
    restored=await connect(destination);
    await restored.query('SET ROLE crest_web');
    assert.deepEqual(await resume(restored,owner,1,2),one);
    assert.deepEqual(await resume(restored,other,1,2),{state:'absent'});
    assert.deepEqual(await value(restored,effectSql,[...credential(owner),batch,1]),persistedEffects);
    assert.deepEqual(await value(restored,targetSql,[...credential(owner),batch,2,'customer',null]),retainedTargets);
    await restored.query('RESET ROLE; SET ROLE crest_export');
    assert.deepEqual(await exported(restored,owner.business),originalSource);
    await restored.query('RESET ROLE');
    await restored.query('CREATE TEMP TABLE portable_batches (LIKE crest.legacy_contact_batches); CREATE TEMP TABLE portable_rows (LIKE crest.legacy_contact_batch_rows)');
    const records=originalSource.slice(1).map(line=>JSON.parse(line));
    for(const [kind,table] of [['batch','portable_batches'],['row','portable_rows']]){
     const rows=records.filter(item=>item.kind===kind).map(item=>item.record);
     const inserted=await restored.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+',$1::jsonb)',[JSON.stringify(rows)]);
     assert.equal(inserted.rowCount,rows.length);
     const reconstructed=(await restored.query('SELECT to_jsonb(record) AS value FROM '+table+' record ORDER BY '+(kind==='batch'?'id':'batch_id,source_row'))).rows.map(row=>row.value);
     assert.deepEqual(reconstructed,rows);
    }
   }finally{try{await restored?.end();}finally{await independent.close();}}
   await staging.test('owner decisions retain exact row and target versions without applying the import',async decisionTests=>{
    for(const connection of [admin,web,later])await connection.query("SET statement_timeout='12s'");
    assert.equal(await syntheticLegacyContactDecisionsAvailable(target),false);
    const withDecisions=await sandbox.apply(target,await sandbox.prefix(114));
    assert.deepEqual(withDecisions.history.slice(0,113),withTargets.history);
    assert.equal(withDecisions.history.length,114);
    assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(114))).history,withDecisions.history);
    assert.equal(await syntheticLegacyContactDecisionsAvailable(target),true);
    assert.deepEqual(await resume(web,owner,1,2),one);
    assert.deepEqual(await value(web,targetSql,[...credential(owner),batch,2,'customer',null]),retainedTargets);
    const readSql='SELECT crest_commands.read_legacy_contact_decision($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
    const saveSql='SELECT crest_commands.save_legacy_contact_decision('+Array.from({length:21},(_,i)=>'$'+(i+1)).join(',')+') AS result';
    const draft=(row=2,p=owner)=>value(web,readSql,[...credential(p),batch,row]);
    const pin=(await draft()).fingerprint;
    const baseline=await evidence(admin);
    const active=retainedTargets.items.find(candidate=>!candidate.archived);
    const archived=retainedTargets.items.find(candidate=>candidate.archived);
    const namespace='previous-crm';
    const plan={customer:'link',customerId:active.id,customerVersion:active.version,vehicle:'link',vehicleId:exactVehicle,vehicleVersion:'1'};
    const params=({operation=randomUUID(),revision=0,source=namespace,fingerprint=pin,id=batch,row=2,choice=plan,actor=owner}={})=>
     [...credential(actor),actor.epoch,operation,id,row,fingerprint,revision,source,choice.customer,choice.customerId,choice.customerVersion,
      choice.vehicle,choice.vehicleId,choice.vehicleVersion];
    const decide=(options,connection=web)=>value(connection,saveSql,params(options));
    assert.deepEqual(await draft(),{state:'present',businessId:owner.business,batchId:batch,row:2,sourceNamespace:null,fingerprint:pin,decision:null});
    assert.deepEqual(await draft(2,other),{state:'absent'});
    for(const choice of [{...plan,customerId:archived.id},{...plan,customerVersion:'2'},{...plan,customerId:randomUUID()},
     {...plan,vehicleVersion:'2'},{...plan,vehicleId:randomUUID()}]){
     assert.deepEqual(await decide({choice}),{state:'conflict',reason:'target'});
    }
    assert.deepEqual(await decide({fingerprint:'0'.repeat(64)}),{state:'conflict',reason:'row'});
    assert.deepEqual(await decide({actor:other}),{state:'conflict',reason:'row'});
    await assert.rejects(decide({actor:{...owner,hash:randomBytes(32)}}),{code:'42501'});
    await assert.rejects(decide({actor:{...owner,epoch:randomUUID()}}),{code:'P0001'});
    const rejected=await draft(3);
    await assert.rejects(decide({row:3,fingerprint:rejected.fingerprint}),{code:'22023'});
    assert.deepEqual(await evidence(admin),baseline);
    const operation=randomUUID(),saved=await decide({operation});
    assert.equal(saved.state,'committed');
    assert.deepEqual([saved.receipt.sourceNamespace,saved.receipt.fingerprint,saved.receipt.customerAction,
     saved.receipt.customerId,saved.receipt.customerVersion,saved.receipt.vehicleAction,saved.receipt.vehicleId,
     saved.receipt.vehicleVersion,saved.receipt.revision],[namespace,pin,'link',active.id,'1','link',exactVehicle,'1',1]);
    assert.deepEqual(await decide({operation}),saved);
    assert.deepEqual((await draft()).decision,saved.receipt);
    assert.deepEqual(await decide({revision:1,source:'different-crm'}),{state:'conflict',reason:'source'});
    assert.deepEqual(await decide({revision:0}),{state:'conflict',reason:'revision',currentRevision:1});
    const skipPlan={customer:'skip',customerId:null,customerVersion:null,vehicle:'none',vehicleId:null,vehicleVersion:null};
    assert.deepEqual(await decide({operation,choice:skipPlan}),{state:'conflict',reason:'operation'});
    const [changeA,changeB]=await Promise.all([decide({revision:1,choice:skipPlan}),decide({revision:1},later)]);
    assert.deepEqual([changeA.state,changeB.state].sort(),['committed','conflict']);
    const latest=await draft();
    assert.equal(latest.decision.revision,2);
    const excluded=await decide({row:3,fingerprint:rejected.fingerprint,choice:skipPlan});
    assert.equal(excluded.receipt.customerAction,'skip');
    assert.deepEqual((await draft(3)).decision,excluded.receipt);
    const plain=await draft(4);
    const createPlan={...skipPlan,customer:'create'};
    const created=await decide({row:4,fingerprint:plain.fingerprint,choice:createPlan});
    assert.equal(created.receipt.customerAction,'create');
    assert.deepEqual((await draft(4)).decision,created.receipt);
    assert.equal(await value(admin,'SELECT count(*)::int AS result FROM crest.legacy_contact_decisions'),4);
    assert.equal(await value(admin,'SELECT count(*)::int AS result FROM crest.legacy_contact_decision_sources'),1);
    const audit=await value(admin,"SELECT delta AS result FROM crest_private.audit_events WHERE entity_kind='legacy_contact_decisions' AND operation_id=$1",[latest.decision.operationId]);
    assert.deepEqual([audit.before,audit.after],[saved.receipt,latest.decision]);
    await assert.rejects(web.query('SELECT * FROM crest.legacy_contact_decisions'),{code:'42501'});
    await assert.rejects(admin.query('DELETE FROM crest.legacy_contact_decisions'),{code:'55000'});
    const after=await evidence(admin);
    assert.deepEqual(after.customers,baseline.customers);
    assert.deepEqual(after.vehicles,baseline.vehicles);
    assert.equal(after.operations.length-baseline.operations.length,4);
    assert.equal(after.audits.length-baseline.audits.length,4);

    const exportDecisions='SELECT crest_commands.legacy_contact_decision_source_page($1,$2,$3,$4,$5,$6) AS result';
    await assert.rejects(value(web,exportDecisions,[owner.business,'binding',null,null,null,1]),{code:'42501'});
    await assert.rejects(value(exporter,exportDecisions,[owner.business,'binding',null,null,null,1]),{code:'25001'});
    await assert.rejects(exporter.query('SELECT * FROM crest.legacy_contact_decisions'),{code:'42501'});
    async function captureSource(connection,business,capture=captureLegacyContactDecisionSource){
     const lines=[];
     await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
     try{
      for await(const line of capture(connection.query.bind(connection),business,AbortSignal.timeout(20000)))lines.push(line);
      return lines;
     }finally{await connection.query('ROLLBACK');}
    }
    const portable=await captureSource(exporter,owner.business);
    assert.equal(portable.length,6);
    assert.equal((await captureSource(exporter,other.business)).length,1);
    const records=portable.slice(1).map(line=>JSON.parse(line));
    assert.deepEqual(records.filter(item=>item.kind==='decision').map(({record})=>[record.source_row,record.revision]),[[2,1],[2,2],[3,1],[4,1]]);
    assert.deepEqual([records[1].record.customer_version,records[1].record.vehicle_version],['1','1']);
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
     const firstPage=await value(exporter,exportDecisions,[owner.business,'decision',null,null,null,1]);
     const secondPage=await value(exporter,exportDecisions,[owner.business,'decision',batch,2,1,1]);
     assert.equal(firstPage.hasMore,true);
     assert.deepEqual(firstPage.rows,[records[1].record]);
     assert.deepEqual(secondPage.rows,[records[2].record]);
    }finally{await exporter.query('ROLLBACK');}

    const currentPoint=join(sandbox.workspace,'registered114-decision-backup');
    await mkdir(currentPoint,{mode:0o700});
    const currentKeys=await keyPair(currentPoint);
    const restoredPoint=await backupLegacyContactDecisionDatabase(admin,target,currentPoint,currentKeys.recipient);
    assert.equal(restoredPoint.manifest.schemaVersion,114);
    const currentIndependent=await recoveryCluster();
    let copy;
    try{
     const destination=await currentIndependent.database();
     assert.deepEqual(await restoreLegacyContactDecisionDatabase(currentPoint,currentKeys.path,destination),restoredPoint.manifest);
     copy=await connect(destination);
     await copy.query('SET ROLE crest_web');
     assert.deepEqual(await value(copy,readSql,[...credential(owner),batch,2]),latest);
     assert.deepEqual((await value(copy,readSql,[...credential(owner),batch,3])).decision,excluded.receipt);
     assert.deepEqual((await value(copy,readSql,[...credential(owner),batch,4])).decision,created.receipt);
     await copy.query('RESET ROLE; SET ROLE crest_export');
     assert.deepEqual(await captureSource(copy,owner.business),portable);
     await copy.query("RESET ROLE; SET timezone='UTC'; CREATE TEMP TABLE portable_bindings (LIKE crest.legacy_contact_decision_sources); CREATE TEMP TABLE portable_decisions (LIKE crest.legacy_contact_decisions)");
     for(const [kind,table] of [['binding','portable_bindings'],['decision','portable_decisions']]){
      const rows=records.filter(item=>item.kind===kind).map(item=>item.record);
      const imported=await copy.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+',$1::jsonb)',[JSON.stringify(rows)]);
      assert.equal(imported.rowCount,rows.length);
      const versions=kind==='decision'?"||jsonb_build_object('customer_version',customer_version::text,'vehicle_version',vehicle_version::text)":'';
      const reconstructed=(await copy.query('SELECT to_jsonb(record)'+versions+' AS value FROM '+table+' record ORDER BY batch_id'+
       (kind==='decision'?',source_row,revision':''))).rows.map(row=>row.value);
      assert.deepEqual(reconstructed,rows);
     }
     // Verify the neutral target can import bigint versions beyond JavaScript's exact integer range.
     await copy.query('TRUNCATE portable_decisions');
     await copy.query('INSERT INTO portable_decisions SELECT * FROM jsonb_populate_recordset(NULL::portable_decisions,$1::jsonb)',
      [JSON.stringify([{...records[1].record,customer_version:'9007199254740993'}])]);
     assert.equal(await value(copy,'SELECT customer_version::text AS result FROM portable_decisions WHERE revision=1 AND source_row=2'),'9007199254740993');
    }finally{try{await copy?.end();}finally{await currentIndependent.close();}}

    assert.equal(await syntheticLegacyContactApprovalsAvailable(target),false);
    const approvalMigration=await sandbox.prefix(115);
    const registered=await sandbox.apply(target,approvalMigration);
    assert.equal(registered.history.length,115);
    assert.equal(await syntheticLegacyContactApprovalsAvailable(target),true);
    assert.deepEqual((await sandbox.apply(target,approvalMigration)).history,registered.history);
    assert.deepEqual(await captureSource(exporter,owner.business),portable);
    const reviewApprovalSql='SELECT crest_commands.review_legacy_contact_approval($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result';
    const approveSql='SELECT crest_commands.approve_legacy_contact_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
    const reviewApproval=(id=batch,p=owner)=>value(web,reviewApprovalSql,[...credential(p),id]);
    const approve=(evidence,operation=randomUUID(),connection=web,p=owner,id=batch)=>
     value(connection,approveSql,[...credential(p),p.epoch,operation,id,evidence]);
    const incomplete=await reviewApproval(raced[0].receipt.batchId);
    assert.deepEqual([incomplete.state,incomplete.undecidedRows,incomplete.approval],['blocked',3,null]);
    assert.deepEqual(await approve(incomplete.evidenceSha256,randomUUID(),web,owner,raced[0].receipt.batchId),{state:'conflict',reason:'not_ready'});
    assert.deepEqual(await reviewApproval(batch,other),{state:'absent'});
    const earlier=await reviewApproval();
    assert.equal((await decide({revision:2})).state,'committed');
    const ready=await reviewApproval();
    assert.notEqual(ready.evidenceSha256,earlier.evidenceSha256);
    assert.deepEqual([ready.state,ready.customerCreates,ready.customerLinks,ready.vehicleCreates,ready.vehicleLinks,ready.skippedRows,
     ready.staleRows,ready.conflictingGroups,ready.approval],['ready',1,1,0,1,1,0,0,null]);
    assert.deepEqual(await approve(earlier.evidenceSha256),{state:'conflict',reason:'evidence'});
    await assert.rejects(approve(ready.evidenceSha256,randomUUID(),web,{...owner,hash:randomBytes(32)}),{code:'42501'});
    await assert.rejects(approve(ready.evidenceSha256,randomUUID(),web,{...owner,epoch:randomUUID()}),{code:'P0001'});
    const approvalRoles=await admin.query(`SELECT role,has_function_privilege(role,
     'crest_commands.approve_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)','EXECUTE') AS allowed
     FROM unnest(ARRAY['crest_web','crest_export','crest_supplier_bill_document_worker','anon','authenticated']) role`);
    for(const {role,allowed} of approvalRoles.rows)assert.equal(allowed,role==='crest_web');
    const approvalBaseline=await evidence(admin);
    const approvalOperation=randomUUID(),competingOperation=randomUUID();
    const race=await Promise.all([approve(ready.evidenceSha256,approvalOperation),approve(ready.evidenceSha256,competingOperation,later)]);
    const approved=race.find(result=>result.state==='committed');
    assert.deepEqual(race.map(result=>result.state).sort(),['already_approved','committed']);
    assert.deepEqual(race[0].receipt,race[1].receipt);
    assert.deepEqual(await approve(ready.evidenceSha256,approved.receipt.operationId),approved);
    assert.deepEqual((await reviewApproval()).approval,approved.receipt);
    for(const key of ['originalSha256','mappingSha256','rowsSha256','decisionsSha256','evidenceSha256']){
     assert.equal(approved.receipt[key],ready[key]);
    }
    assert.equal(approved.receipt.approvedBy,owner.actor);
    await assert.rejects(web.query('SELECT * FROM crest.legacy_contact_approvals'),{code:'42501'});
    await assert.rejects(admin.query('DELETE FROM crest.legacy_contact_approvals'),{code:'55000'});
    const approvalAfter=await evidence(admin);
    assert.deepEqual(approvalAfter.customers,approvalBaseline.customers);
    assert.deepEqual(approvalAfter.vehicles,approvalBaseline.vehicles);
    assert.equal(approvalAfter.operations.length-approvalBaseline.operations.length,1);
    assert.equal(approvalAfter.audits.length-approvalBaseline.audits.length,1);

    const customerChange='SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS result';
    assert.equal((await value(web,customerChange,[...credential(owner),owner.epoch,randomUUID(),active.id,
     {...activeCustomer,notes:'Fictional reviewed change'}])).state,'committed');
    const stale=await reviewApproval();
    assert.deepEqual([stale.state,stale.staleRows,stale.approval],['blocked',1,null]);
    assert.deepEqual(await approve(ready.evidenceSha256),{state:'conflict',reason:'not_ready'});
    assert.deepEqual(await approve(ready.evidenceSha256,approved.receipt.operationId),approved);

    assert.equal((await decide({revision:3,choice:{...plan,customerVersion:'2'}})).state,'committed');
    const refreshed=await reviewApproval();
    assert.equal(refreshed.state,'ready');
    const newer=await approve(refreshed.evidenceSha256);
    assert.equal(newer.state,'committed');
    assert.notEqual(newer.receipt.approvalId,approved.receipt.approvalId);
    assert.deepEqual((await reviewApproval()).approval,newer.receipt);

    const conflictFile=await prepareLegacyContactBatch(new TextEncoder().encode('Id,Name\nA,First version\nA,Second version'),
     {customerSourceId:'Id',displayName:'Name'},owner.business,'Conflicting exact source');
    const conflictBatch=randomUUID();
    await value(web,stageSql,args(conflictFile,owner,randomUUID(),conflictBatch));
    for(const row of [2,3]){
     const input=await value(web,readSql,[...credential(owner),conflictBatch,row]);
     const parameters=params({id:conflictBatch,row,fingerprint:input.fingerprint,choice:createPlan});
     assert.equal((await value(web,saveSql,parameters)).state,'committed');
    }
    const conflicting=await reviewApproval(conflictBatch);
    assert.deepEqual([conflicting.state,conflicting.conflictingGroups,conflicting.undecidedRows],['blocked',1,0]);
    assert.deepEqual(await approve(conflicting.evidenceSha256,randomUUID(),web,owner,conflictBatch),{state:'conflict',reason:'not_ready'});

    const exportApprovals='SELECT crest_commands.legacy_contact_approval_source_page($1,$2,$3,$4) AS result';
    await assert.rejects(value(web,exportApprovals,[owner.business,null,null,1]),{code:'42501'});
    await assert.rejects(value(exporter,exportApprovals,[owner.business,null,null,1]),{code:'25001'});
    await assert.rejects(exporter.query('SELECT * FROM crest.legacy_contact_approvals'),{code:'42501'});
    const approvals=await captureSource(exporter,owner.business,captureLegacyContactApprovalSource);
    const receipts=approvals.slice(1).map(line=>JSON.parse(line).record);
    assert.deepEqual(receipts.map(row=>row.id).sort(),[approved.receipt.approvalId,newer.receipt.approvalId].sort());
    assert.equal((await captureSource(exporter,other.business,captureLegacyContactApprovalSource)).length,1);
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
     const first=await value(exporter,exportApprovals,[owner.business,null,null,1]);
     assert.deepEqual([first.rows,first.hasMore],[[receipts[0]],true]);
     const second=await value(exporter,exportApprovals,[owner.business,batch,receipts[0].evidence_sha256,1]);
     assert.deepEqual([second.rows,second.hasMore],[[receipts[1]],false]);
    }finally{await exporter.query('ROLLBACK');}

    const approvalPoint=join(sandbox.workspace,'registered115-approval-backup');
    await mkdir(approvalPoint,{mode:0o700});
    const approvalKeys=await keyPair(approvalPoint);
    const checkpoint=await backupLegacyContactApprovalDatabase(admin,target,approvalPoint,approvalKeys.recipient);
    assert.equal(checkpoint.manifest.schemaVersion,115);
    const independent=await recoveryCluster();
    let restored;
    try{
     const destination=await independent.database();
     assert.deepEqual(await restoreLegacyContactApprovalDatabase(approvalPoint,approvalKeys.path,destination),checkpoint.manifest);
     restored=await connect(destination);
     await restored.query('SET ROLE crest_web');
     assert.deepEqual((await value(restored,reviewApprovalSql,[...credential(owner),batch])).approval,newer.receipt);
     assert.deepEqual(await approve(ready.evidenceSha256,approved.receipt.operationId,restored),approved);
     await restored.query('RESET ROLE; SET ROLE crest_export');
     assert.deepEqual(await captureSource(restored,owner.business,captureLegacyContactApprovalSource),approvals);
     await restored.query("RESET ROLE; SET timezone='UTC'; CREATE TEMP TABLE portable_approvals (LIKE crest.legacy_contact_approvals)");
     const inserted=await restored.query('INSERT INTO portable_approvals SELECT * FROM jsonb_populate_recordset(NULL::portable_approvals,$1::jsonb)',[JSON.stringify(receipts)]);
     assert.equal(inserted.rowCount,2);
     const rebuilt=(await restored.query('SELECT to_jsonb(record) AS value FROM portable_approvals record ORDER BY batch_id,evidence_sha256')).rows.map(row=>row.value);
     assert.deepEqual(rebuilt,receipts);

    }finally{try{await restored?.end();}finally{await independent.close();}}

    if(process.env.CREST_TEST_LEGACY_REGISTERED_APPLY==='1'){
     const upgradedSession=await sandbox.connect(target);
     const applicationPrefix=await sandbox.prefix(116);
     const upgraded=await sandbox.apply(target,applicationPrefix);
     assert.equal(upgraded.history.length,116);
     assert.deepEqual(upgraded.history.slice(0,115),registered.history);
     assert.equal(upgraded.history.at(-1).version,'20270109180000');
     assert.deepEqual((await sandbox.apply(target,applicationPrefix)).history,upgraded.history);
     const request='SELECT crest_commands.request_legacy_contact_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
     const direct='SELECT crest_commands.apply_legacy_contact_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
     const result='SELECT crest_commands.read_legacy_contact_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
     const operation=randomUUID();
     const parameters=[...credential(owner),owner.epoch,operation,batch,refreshed.evidenceSha256];
     await upgradedSession.query('SET ROLE crest_web');
     await assert.rejects(value(upgradedSession,direct,parameters),{code:'42501'});
     assert.deepEqual(await value(upgradedSession,request,parameters),{state:'queued',operationId:operation});
     const lease=randomUUID();
     await upgradedSession.query('RESET ROLE; SET ROLE crest_legacy_contact_dispatch');
     assert.equal(await value(upgradedSession,'SELECT crest_commands.claim_legacy_contact_application($1) AS result',[lease]),'claimed');
     assert.equal(await value(upgradedSession,'SELECT crest_commands.run_claimed_legacy_contact_application($1) AS result',[lease]),true);
     await upgradedSession.query('RESET ROLE; SET ROLE crest_web');
     const registeredResult=await value(upgradedSession,result,[...credential(owner),batch,1]);
     assert.equal(registeredResult.receipt.operationId,operation);
     assert.equal(registeredResult.receipt.rowCount,3);
     assert.deepEqual(await value(upgradedSession,request,parameters),{state:'committed',operationId:operation});
     await upgradedSession.query('RESET ROLE');

     const point=join(sandbox.workspace,'registered116-import-backup');
     await mkdir(point,{mode:0o700});
     const keys=await keyPair(point);
     const checkpoint116=await backupLegacyContactApplicationDatabase(upgradedSession,target,point,keys.recipient);
     assert.equal(checkpoint116.manifest.schemaVersion,116);
     const recovery116=await recoveryCluster();
     let copy116;
     try{
      const target116=await recovery116.database();
      assert.deepEqual(await restoreLegacyContactApplicationDatabase(point,keys.path,target116),checkpoint116.manifest);
      copy116=await connect(target116);
      await copy116.query('SET ROLE crest_web');
      assert.deepEqual(await value(copy116,result,[...credential(owner),batch,1]),registeredResult);
      assert.deepEqual(await value(copy116,request,parameters),{state:'committed',operationId:operation});
     }finally{try{await copy116?.end();}finally{await recovery116.close();}}
     const downloadUpgrade=await sandbox.apply(target);
     assert.equal(downloadUpgrade.history.length,117);
     assert.deepEqual(downloadUpgrade.history.slice(0,116),upgraded.history);
     assert.equal(downloadUpgrade.history.at(-1).version,'20270110180000');
     assert.deepEqual((await sandbox.apply(target)).history,downloadUpgrade.history);
     const source='SELECT crest_commands.read_legacy_contact_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result';
     const handoff='SELECT crest_commands.record_legacy_contact_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result';
     const downloadParameters=[...credential(owner),owner.epoch,batch,operation];
     await upgradedSession.query('SET ROLE crest_legacy_contact_dispatch');
     await assert.rejects(value(upgradedSession,source,downloadParameters),{code:'42501'});
     await upgradedSession.query('RESET ROLE; SET ROLE crest_web');
     const invalidOperation=[...downloadParameters.slice(0,-1),randomUUID()];
     assert.deepEqual(await value(upgradedSession,source,invalidOperation),{state:'absent'});
     await assert.rejects(value(upgradedSession,source,[...downloadParameters.slice(0,8),randomUUID(),batch,operation]),{code:'P0001'});
     const foreignParameters=[...credential(other),other.epoch,batch,operation];
     assert.deepEqual(await value(upgradedSession,source,foreignParameters),{state:'absent'});
     const input={batchId:batch,applicationOperationId:operation,recoveryEpoch:owner.epoch};
     const exportData=await value(upgradedSession,source,downloadParameters);
     assert.deepEqual(exportData.receipt,registeredResult.receipt);
     const archive=createLegacyContactDownloadArchive(exportData,owner.business,input,AbortSignal.timeout(5000));
     const repeated=createLegacyContactDownloadArchive(exportData,owner.business,input,AbortSignal.timeout(5000));
     assert.deepEqual(archive,repeated);
     const files=unzipSync(archive.bytes);
     assert.deepEqual(Object.keys(files).sort(),['import-receipt.json','import-requests.csv','row-results.csv']);
     assert.deepEqual(JSON.parse(strFromU8(files['import-receipt.json'])),registeredResult.receipt);
     assert.equal(strFromU8(files['row-results.csv']).trimEnd().split('\r\n').length,4);
     assert(strFromU8(files['import-requests.csv']).includes(operation+','));
     const ack=await value(upgradedSession,handoff,[...downloadParameters,archive.digest,archive.bytes.byteLength]);
     assert.equal(ack.state,'authorized_handoff');
     const auditQuery=`SELECT delta->'after' AS result FROM crest_private.audit_events
      WHERE entity_kind='legacy_contact_downloads' AND operation_id=$1 AND business_id=$2`;
     const auditParameters=[ack.operationId,owner.business];
     const audit=await value(admin,auditQuery,auditParameters);
     assert.deepEqual(audit,{
      schemaVersion:1,businessId:owner.business,batchId:batch,applicationOperationId:operation,
      archiveSha256:archive.digest,archiveBytes:archive.bytes.byteLength,
     });
     await upgradedSession.query('RESET ROLE');
     const historyPoint=join(sandbox.workspace,'registered117-import-history-backup');
     await mkdir(historyPoint,{mode:0o700});
     const historyKeys=await keyPair(historyPoint);
     const checkpoint117=await backupDatabase(upgradedSession,target,historyPoint,historyKeys.recipient);
     assert.equal(checkpoint117.manifest.schemaVersion,117);
     const recovery117=await recoveryCluster();
     let copy117;
     try{
      const target117=await recovery117.database();
      assert.deepEqual(await restoreDatabase(historyPoint,historyKeys.path,target117),checkpoint117.manifest);
      copy117=await connect(target117);
      assert.deepEqual(await value(copy117,auditQuery,auditParameters),audit);
      await copy117.query('SET ROLE crest_web');
      const restoredData=await value(copy117,source,downloadParameters);
      const restoredArchive=createLegacyContactDownloadArchive(restoredData,owner.business,input,AbortSignal.timeout(5000));
      assert.deepEqual(restoredArchive,archive);
      restoredArchive.bytes.fill(0);
     }finally{try{await copy117?.end();}finally{await recovery117.close();}}
     archive.bytes.fill(0);repeated.bytes.fill(0);
     return;
    }

    const identitySql=await readFile(new URL('../../planning/proposals/legacy-contact-external-identities.sql',import.meta.url),'utf8');
    await admin.query('BEGIN');
    try{await admin.query(identitySql);await admin.query('COMMIT');}
    catch(error){await admin.query('ROLLBACK');throw error;}

    const identityQuery='SELECT crest_commands.find_legacy_contact_identity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
    const identity=(id,kind,row=2,source=namespace,principal=owner)=>
     value(web,identityQuery,[...credential(principal),id,row,source,kind]);
    const changedFile=await prepareLegacyContactBatch(new TextEncoder().encode([
     'Id,Name,VId,Vehicle,Phone,VIN',
     '001,Fictional new name,V-1,Updated wagon,3175550177,ZZ9999',
     '1,Distinct unpadded ID,v-1,Lowercase vehicle,3175550178,ZZ9998',
     'V-1,Customer ID equal to an external vehicle ID,,,3175550166,',
    ].join('\n')),mapping,owner.business,'Fictional subsequent CSV');
    const repeatedBatch=randomUUID();
    assert.equal((await value(web,stageSql,args(changedFile,owner,randomUUID(),repeatedBatch))).state,'committed');
    assert.equal((await identity(repeatedBatch,'customer')).target,null);
    const changedPin=(await value(web,readSql,[...credential(owner),repeatedBatch,2])).fingerprint;
    const bothNew={...createPlan,vehicle:'create'};
    for(const row of [2,3,4]){
     const input=await value(web,readSql,[...credential(owner),repeatedBatch,row]);
     assert.equal((await decide({id:repeatedBatch,row,fingerprint:input.fingerprint,choice:row===2?bothNew:skipPlan})).state,'committed');
    }
    const previouslyReady=await reviewApproval(repeatedBatch);
    assert.equal(previouslyReady.state,'ready');
    const approvedBeforeBinding=await approve(previouslyReady.evidenceSha256,randomUUID(),web,owner,repeatedBatch);
    assert.equal(approvedBeforeBinding.state,'committed');

    const applicationSql=await readFile(new URL('../../planning/proposals/legacy-contact-application.sql',import.meta.url),'utf8');
    await admin.query('BEGIN');
    try{await admin.query(applicationSql);await admin.query('COMMIT');}
    catch(error){await admin.query('ROLLBACK');throw error;}
    assert.equal((await sandbox.apply(target,approvalMigration)).history.length,115);

    for(const connection of [web,exporter]){
     assert.equal(await value(connection,`SELECT has_function_privilege(current_user,
      (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='crest_private' AND p.proname='refresh_legacy_contact_target_statistics'),'EXECUTE') AS result`),false);
    }
    const applySql='SELECT crest_commands.apply_legacy_contact_batch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
    const apply=(id,evidence,operation=randomUUID(),principal=owner,connection=web)=>
     value(connection,applySql,[...credential(principal),principal.epoch,operation,id,evidence]);
    const applicationPage='SELECT crest_commands.read_legacy_contact_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
    const resultPage=(id,after=1,principal=owner)=>value(web,applicationPage,[...credential(principal),id,after]);
    assert.deepEqual(await apply(batch,ready.evidenceSha256),{state:'conflict',reason:'approval'});
    assert.deepEqual(await apply(batch,refreshed.evidenceSha256,randomUUID(),other),{state:'conflict',reason:'approval'});
    await assert.rejects(apply(batch,refreshed.evidenceSha256,randomUUID(),{...owner,hash:randomBytes(32)}),{code:'42501'});
    await assert.rejects(value(exporter,applySql,[...credential(owner),owner.epoch,randomUUID(),batch,refreshed.evidenceSha256]),{code:'42501'});
    assert.deepEqual(await resultPage(batch),{state:'absent'});
    const beforeApply=await evidence(admin);
    const applyId=randomUUID();
    const applied=await apply(batch,refreshed.evidenceSha256,applyId);
    assert.equal(applied.state,'committed');
    assert.deepEqual(await apply(batch,refreshed.evidenceSha256,applyId),applied);
    assert.deepEqual(await apply(batch,refreshed.evidenceSha256),{state:'already_applied',receipt:applied.receipt});
    assert.deepEqual(await apply(batch,ready.evidenceSha256,applyId),{state:'conflict',reason:'operation'});
    assert.deepEqual(await apply(batch,ready.evidenceSha256),{state:'conflict',reason:'applied'});
    await assert.rejects(decide({revision:4,choice:skipPlan}),{code:'55000',message:'CREST_LEGACY_APPLIED_DECISIONS_RETAINED'});
    const afterApply=await evidence(admin);
    assert.equal(afterApply.customers.length-beforeApply.customers.length,1);
    assert.deepEqual(afterApply.vehicles,beforeApply.vehicles);
    assert.equal(afterApply.operations.length-beforeApply.operations.length,1);
    assert.equal(afterApply.audits.length-beforeApply.audits.length,2);
    const page=await resultPage(batch);
    assert.equal(page.state,'present');
    assert.deepEqual(page.receipt,applied.receipt);
    assert.deepEqual(page.rows.map(row=>[row.row,row.customerAction,row.vehicleAction]),[[2,'link','link'],[3,'skip','none'],[4,'create','none']]);
    assert.deepEqual([page.rows[0].customerId,page.rows[0].customerVersion,page.rows[0].vehicleId],[active.id,'2',exactVehicle]);
    assert.deepEqual((await resultPage(batch,3)).rows,[page.rows[2]]);
    assert.deepEqual(await resultPage(batch,1,other),{state:'absent'});
    const createdCustomer=await value(admin,'SELECT to_jsonb(c) AS result FROM crest.customers c WHERE id=$1',[page.rows[2].customerId]);
    assert.equal(createdCustomer.origin,'import');
    assert.equal(createdCustomer.outreach_opt_out,true);
    assert.equal(createdCustomer.operation_id,applyId);
    const insertIdentity=`INSERT INTO crest.legacy_contact_external_identities
     (business_id,source_namespace,entity_kind,external_id,customer_id,first_batch_id,
      first_evidence_sha256,first_source_row,first_decision_revision,first_apply_operation_id,created_by)
     VALUES($1,$2,'customer',$3,$4,$5,$6,2,4,$7,$8)`;
    const billingUnchanged=await value(admin,'SELECT count(*)::integer AS result FROM crest.customer_vehicles WHERE business_id=$1',[owner.business]);
    const customerBinding=[owner.business,namespace,'001',active.id,batch,newer.receipt.evidenceSha256,applyId,owner.actor];
    await assert.rejects(admin.query(insertIdentity,customerBinding.map((value,index)=>index===2?'Forged source ID':value)),
     {code:'23514',message:'CREST_LEGACY_EXTERNAL_IDENTITY_PROOF_REQUIRED'});
    await assert.rejects(admin.query(insertIdentity,customerBinding),{code:'23505'});
    await assert.rejects(admin.query('UPDATE crest.legacy_contact_external_identities SET customer_id=customer_id'),{code:'55000'});
    await assert.rejects(web.query('SELECT * FROM crest.legacy_contact_external_identities'),{code:'42501'});
    await assert.rejects(value(exporter,identityQuery,[...credential(owner),repeatedBatch,2,namespace,'customer']),{code:'42501'});
    assert.deepEqual(await identity(repeatedBatch,'customer',2,namespace,other),{state:'absent'});
    assert.deepEqual(await identity(repeatedBatch,'customer',2,'a-different-source'),{state:'absent'});
    const separateSource=await prepareLegacyContactBatch(new TextEncoder().encode('Id,Name\n001,Independent fictional record'),
     {customerSourceId:'Id',displayName:'Name'},owner.business,'Independent previous CRM');
    const separateBatch=randomUUID();
    assert.equal((await value(web,stageSql,args(separateSource,owner,randomUUID(),separateBatch))).state,'committed');
    assert.equal((await identity(separateBatch,'customer',2,'a-different-source')).target,null);
    assert.equal((await identity(separateBatch,'customer')).target.id,active.id);

    const customerMatch=await identity(repeatedBatch,'customer'),vehicleMatch=await identity(repeatedBatch,'vehicle');
    assert.deepEqual([customerMatch.fingerprint,customerMatch.target.id,customerMatch.target.version,customerMatch.target.archived],
     [changedPin,active.id,'2',false]);
    assert.deepEqual([vehicleMatch.target.id,vehicleMatch.target.version,vehicleMatch.target.recordType],[exactVehicle,'1','customer_vehicle']);
    assert.equal((await identity(repeatedBatch,'customer',3)).target,null);
    assert.equal((await identity(repeatedBatch,'vehicle',3)).target,null);
    assert.equal((await identity(repeatedBatch,'customer',4)).target,null);

    const blockedByBinding=await reviewApproval(repeatedBatch);
    assert.deepEqual([blockedByBinding.state,blockedByBinding.conflictingGroups,blockedByBinding.approval],['blocked',2,null]);
    assert.deepEqual(await approve(previouslyReady.evidenceSha256,randomUUID(),web,owner,repeatedBatch),{state:'conflict',reason:'not_ready'});
    assert.deepEqual(await approve(previouslyReady.evidenceSha256,approvedBeforeBinding.receipt.operationId,web,owner,repeatedBatch),approvedBeforeBinding);
    assert.deepEqual(await decide({id:repeatedBatch,revision:1,fingerprint:changedPin,choice:bothNew}),{state:'conflict',reason:'target'});
    assert.deepEqual(await decide({id:repeatedBatch,revision:1,fingerprint:changedPin,choice:{...plan,customerVersion:'1'}}),
     {state:'conflict',reason:'target'});
    assert.equal((await decide({id:repeatedBatch,revision:1,fingerprint:changedPin,choice:{...plan,customerVersion:'2'}})).state,'committed');
    const resolved=await reviewApproval(repeatedBatch);
    assert.deepEqual([resolved.state,resolved.customerCreates,resolved.customerLinks,resolved.vehicleCreates,resolved.vehicleLinks],['ready',0,1,0,1]);
    assert.notEqual(resolved.evidenceSha256,previouslyReady.evidenceSha256);
    assert.deepEqual(await apply(repeatedBatch,previouslyReady.evidenceSha256),{state:'conflict',reason:'approval'});
    assert.equal((await approve(resolved.evidenceSha256,randomUUID(),web,owner,repeatedBatch)).state,'committed');
    const reused=await apply(repeatedBatch,resolved.evidenceSha256);
    assert.deepEqual([reused.state,reused.receipt.customersCreated,reused.receipt.vehiclesCreated],['committed',0,0]);
    assert.deepEqual((await resultPage(repeatedBatch)).rows[0].vehicleId,exactVehicle);

    const rollbackFile=await prepareLegacyContactBatch(new TextEncoder().encode([
     'Id,Name,VId,Vehicle',
     ...Array(26).fill('fresh-contact,Fixture rollback contact,fresh-car,Fixture rollback vehicle'),
    ].join('\n')),{customerSourceId:'Id',displayName:'Name',vehicleSourceId:'VId',vehicleLabel:'Vehicle'},owner.business,'Fictional rollback check');
    const rollbackBatch=randomUUID();
    assert.equal((await value(web,stageSql,args(rollbackFile,owner,randomUUID(),rollbackBatch))).state,'committed');
    for(let row=2;row<=27;row++){
     const input=await value(web,readSql,[...credential(owner),rollbackBatch,row]);
     assert.equal((await decide({id:rollbackBatch,row,fingerprint:input.fingerprint,choice:bothNew})).state,'committed');
    }
    const toApply=await reviewApproval(rollbackBatch);
    assert.equal((await approve(toApply.evidenceSha256,randomUUID(),web,owner,rollbackBatch)).state,'committed');
    const failedOperation=randomUUID(),beforeFailure=await evidence(admin);
    await admin.query("ALTER TABLE crest.vehicles ADD CONSTRAINT test_refuse_import CHECK(label<>'Fixture rollback vehicle')");
    try{await assert.rejects(apply(rollbackBatch,toApply.evidenceSha256,failedOperation),{code:'23514',constraint:'test_refuse_import'});}
    finally{await admin.query('ALTER TABLE crest.vehicles DROP CONSTRAINT test_refuse_import');}
    assert.deepEqual(await resultPage(rollbackBatch),{state:'absent'});
    assert.deepEqual(await evidence(admin),beforeFailure);
    const raceApply=await Promise.all([apply(rollbackBatch,toApply.evidenceSha256,failedOperation),
      apply(rollbackBatch,toApply.evidenceSha256,randomUUID(),owner,later)]);
    assert.deepEqual(raceApply.map(value=>value.state).sort(),['already_applied','committed']);
    assert.deepEqual(raceApply[0].receipt,raceApply[1].receipt);
    assert.deepEqual([raceApply[0].receipt.customersCreated,raceApply[0].receipt.vehiclesCreated,raceApply[0].receipt.rowsWithVehiclePair],[1,1,26]);
    const duplicateFirstPage=await resultPage(rollbackBatch),duplicateSecondPage=await resultPage(rollbackBatch,26);
    assert.deepEqual([duplicateFirstPage.hasMore,duplicateFirstPage.rows.length,duplicateSecondPage.hasMore,duplicateSecondPage.rows.length],
     [true,25,false,1]);
    const duplicates=[...duplicateFirstPage.rows,...duplicateSecondPage.rows];
    assert.equal(new Set(duplicates.map(row=>row.customerId)).size,1);
    assert.equal(new Set(duplicates.map(row=>row.vehicleId)).size,1);
    assert.equal(await value(admin,'SELECT count(*)::integer AS result FROM crest.customer_vehicles WHERE business_id=$1',[owner.business]),billingUnchanged);

    const applicationSourceSql=await readFile(new URL('../../planning/proposals/legacy-contact-application-source.sql',import.meta.url),'utf8');
    await admin.query('BEGIN');
    try{await admin.query(applicationSourceSql);await admin.query('COMMIT');}
    catch(error){await admin.query('ROLLBACK');throw error;}
    const applicationSource='SELECT crest_commands.legacy_contact_application_source_page($1,$2,$3,$4,$5,$6,$7,$8) AS result';
    const initialCursor=[null,null,null,null,null];
    await assert.rejects(value(web,applicationSource,[owner.business,'outcome',...initialCursor,1]),{code:'42501'});
    await assert.rejects(value(exporter,applicationSource,[owner.business,'outcome',...initialCursor,1]),{code:'25001'});
    await assert.rejects(exporter.query('SELECT * FROM crest.legacy_contact_application_rows'),{code:'42501'});
    const applicationExport=await captureSource(exporter,owner.business,captureLegacyContactApplicationSource);
    const appliedRecords=applicationExport.slice(1).map(line=>JSON.parse(line));
    assert.equal((await captureSource(exporter,other.business,captureLegacyContactApplicationSource)).length,1);
    const identityRows=appliedRecords.filter(record=>record.kind==='identity').map(entry=>entry.record);
    assert.equal(identityRows.length,5);
    assert(identityRows.some(row=>row.external_id==='001'&&row.customer_id===active.id));
    const outcomeRows=appliedRecords.filter(record=>record.kind==='outcome').map(entry=>entry.record);
    assert.equal(outcomeRows.length,32);
    assert.equal(outcomeRows.find(row=>row.batch_id===batch&&row.source_row===2).customer_version,'2');
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
     const head=await value(exporter,applicationSource,[owner.business,'identity',...initialCursor,1]);
     const {source_namespace,entity_kind,external_id}=identityRows[0];
     const next=await value(exporter,applicationSource,[owner.business,'identity',null,null,source_namespace,entity_kind,external_id,1]);
     assert.deepEqual([head.rows,next.rows,head.hasMore],[[identityRows[0]],[identityRows[1]],true]);
    }finally{await exporter.query('ROLLBACK');}
    const neutral=await sandbox.database(),portableTarget=await sandbox.connect(neutral);
    await portableTarget.query("SET timezone='UTC'");
    for(const [kind,table,columns,order] of [
     ['identity','portable_identities','business_id uuid,source_namespace text COLLATE "C",entity_kind text,external_id text COLLATE "C",customer_id uuid,vehicle_id uuid,first_batch_id uuid,first_evidence_sha256 text,first_source_row integer,first_decision_revision integer,first_apply_operation_id uuid,created_by uuid,created_at timestamptz','source_namespace,entity_kind,external_id'],
     ['application','portable_applications','business_id uuid,batch_id uuid,evidence_sha256 text,operation_id uuid,applied_by uuid','batch_id'],
     ['outcome','portable_outcomes','business_id uuid,batch_id uuid,source_row integer,decision_revision integer,customer_action text,customer_id uuid,customer_version bigint,vehicle_action text,vehicle_id uuid,vehicle_version bigint','batch_id,source_row'],
    ]){
     const rows=appliedRecords.filter(entry=>entry.kind===kind).map(entry=>entry.record);
     await portableTarget.query('CREATE TEMP TABLE '+table+' ('+columns+')');
     const loaded=await portableTarget.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+',$1::jsonb)',[JSON.stringify(rows)]);
     assert.equal(loaded.rowCount,rows.length);
     const cast=kind==='outcome'?"||jsonb_build_object('customer_version',customer_version::text,'vehicle_version',vehicle_version::text)":"";
     const reconstructed=(await portableTarget.query('SELECT to_jsonb(record)'+cast+' AS value FROM '+table+' record ORDER BY '+order)).rows.map(row=>row.value);
     assert.deepEqual(reconstructed,rows);
    }

    if(process.env.CREST_TEST_LEGACY_APPLY_CAPACITY!=='1'){
     const applicationPoint=join(sandbox.workspace,'held-contact-application-backup');
     await mkdir(applicationPoint,{mode:0o700});
     const applicationKeys=await keyPair(applicationPoint);
     const applicationCheckpoint=await backupContactApplicationCandidateDatabase(admin,target,applicationPoint,applicationKeys.recipient);
     assert.equal(applicationCheckpoint.manifest.heldContactApplicationSources.length,3);
     const applicationIndependent=await recoveryCluster();
     let applicationCopy;
     try{
      const destination=await applicationIndependent.database();
      const restoredManifest=await restoreContactApplicationCandidateDatabase(applicationPoint,applicationKeys.path,destination).catch(async error=>{
       if(error.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:schema')await Promise.all([[target,'before'],[destination,'after']]
        .map(async([database,label])=>writeFile('.local/contact-application-'+label+'-schema.sql',
         normalizedSchema(await postgresTool('pg_dump',database,['--schema-only']),applicationCheckpoint.manifest.schemaPolicyRoles))));
       throw error;
      });
      assert.deepEqual(restoredManifest,applicationCheckpoint.manifest);
      applicationCopy=await connect(destination);
      await applicationCopy.query('SET ROLE crest_web');
      assert.deepEqual(await value(applicationCopy,applicationPage,[...credential(owner),batch,1]),page);
      assert.deepEqual(await apply(batch,refreshed.evidenceSha256,applyId,owner,applicationCopy),applied);
      assert.deepEqual(await value(applicationCopy,identityQuery,[...credential(owner),repeatedBatch,2,namespace,'vehicle']),vehicleMatch);
      await applicationCopy.query('RESET ROLE; SET ROLE crest_export');
      assert.deepEqual(await captureSource(applicationCopy,owner.business,captureLegacyContactApplicationSource),applicationExport);
     }finally{try{await applicationCopy?.end();}finally{await applicationIndependent.close();}}
    }


    if(process.env.CREST_TEST_LEGACY_APPLY_CAPACITY!=='1'){
     await decisionTests.test('background import survives a rollback and runs only once',async()=>{
      const queueSql=await readFile(new URL('../../planning/proposals/legacy-contact-application-queue.sql',import.meta.url),'utf8');
      await sandbox.applyHeldSql(admin,queueSql);
      const runSql='SELECT crest_commands.run_next_legacy_contact_application() AS result';
      const queue='SELECT crest_commands.request_legacy_contact_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
      const status='SELECT crest_commands.read_legacy_contact_apply_request($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result';
      const worker=await sandbox.connect(target),secondWorker=await sandbox.connect(target);
      for(const connection of [worker,secondWorker])await connection.query('SET ROLE crest_legacy_contact_dispatch');
      assert.equal(await value(worker,runSql),false);
      await assert.rejects(value(web,runSql),{code:'42501'});
      await assert.rejects(worker.query('SELECT * FROM crest_private.legacy_contact_apply_requests'),{code:'42501'});
      await assert.rejects(web.query('SELECT * FROM crest_private.legacy_contact_apply_requests'),{code:'42501'});

      async function approvedQueueFixture(externalId,label){
       const source=await prepareLegacyContactBatch(new TextEncoder().encode('Id,Name\n'+externalId+','+label),
        {customerSourceId:'Id',displayName:'Name'},owner.business,label);
       const queueBatch=randomUUID();
       assert.equal((await value(web,stageSql,args(source,owner,randomUUID(),queueBatch))).state,'committed');
       const input=await value(web,readSql,[...credential(owner),queueBatch,2]);
       assert.equal((await decide({id:queueBatch,row:2,fingerprint:input.fingerprint,choice:createPlan})).state,'committed');
       const digest=(await reviewApproval(queueBatch)).evidenceSha256;
       assert.equal((await approve(digest,randomUUID(),web,owner,queueBatch)).state,'committed');
       return {queueBatch,digest};
      }
      const {queueBatch,digest}=await approvedQueueFixture('fresh-queue-contact','Fictional queued contact');
      const operation=randomUUID();
      const enqueue=(id=operation,d=digest,p=owner,connection=web)=>
       value(connection,queue,[...credential(p),p.epoch,id,queueBatch,d]);
      const checkStatus=(p=owner,id=queueBatch)=>value(web,status,[...credential(p),id]);
      assert.deepEqual(await checkStatus(),{state:'absent'});
      await assert.rejects(enqueue(operation,digest,{...owner,hash:randomBytes(32)}),{code:'42501'});
      await assert.rejects(enqueue(operation,digest,owner,worker),{code:'42501'});
      assert.deepEqual(await enqueue(operation,'0'.repeat(64)),{state:'conflict',reason:'approval'});
      const expected={state:'queued',operationId:operation};
      assert.deepEqual(await enqueue(),expected);
      assert.deepEqual(await enqueue(),expected);
      assert.deepEqual(await enqueue(randomUUID()),expected);
      assert.deepEqual(await enqueue(operation,'0'.repeat(64)),{state:'conflict',reason:'operation'});
      assert.deepEqual(await checkStatus(),expected);
      assert.deepEqual(await checkStatus(other),{state:'absent'});
      assert.deepEqual(await resultPage(queueBatch),{state:'absent'});

      await worker.query('BEGIN');
      try{
       assert.equal(await value(worker,runSql),true);
       assert.equal(await value(secondWorker,runSql),false);
       assert.deepEqual(await checkStatus(),expected);
       assert.deepEqual(await resultPage(queueBatch),{state:'absent'});
      }finally{await worker.query('ROLLBACK');}
      assert.deepEqual(await checkStatus(),expected);
      assert.equal(await value(secondWorker,runSql),true);
      assert.equal(await value(worker,runSql),false);
      assert.deepEqual(await enqueue(),{state:'committed',operationId:operation});
      const persisted=await resultPage(queueBatch);
      assert.equal(persisted.receipt.operationId,operation);
      assert.equal(persisted.receipt.customersCreated,1);
      assert.equal(await value(admin,'SELECT count(*)::int AS result FROM crest.customers WHERE operation_id=$1',[operation]),1);

      const stale=await approvedQueueFixture('stale-queue-contact','Fictional queue approval change');
      const staleOperation=randomUUID();
      assert.equal((await value(web,queue,[...credential(owner),owner.epoch,staleOperation,stale.queueBatch,stale.digest])).state,'queued');
      const staleInput=await value(web,readSql,[...credential(owner),stale.queueBatch,2]);
      assert.equal((await decide({id:stale.queueBatch,row:2,revision:1,fingerprint:staleInput.fingerprint,choice:skipPlan})).state,'committed');
      assert.equal(await value(worker,runSql),true);
      assert.deepEqual(await checkStatus(owner,stale.queueBatch),{state:'approval',operationId:staleOperation});

      assert.deepEqual(await resultPage(stale.queueBatch),{state:'absent'});

      const fenced=await approvedQueueFixture('fenced-queue-contact','Fictional queue recovery fence');
      const fencedOperation=randomUUID();
      assert.equal((await value(web,queue,[...credential(owner),owner.epoch,fencedOperation,fenced.queueBatch,fenced.digest])).state,'queued');
      await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',
       [randomUUID(),owner.business]);
      assert.equal(await value(worker,runSql),true);
      assert.deepEqual(await checkStatus(owner,fenced.queueBatch),{state:'authority',operationId:fencedOperation});
      assert.deepEqual(await resultPage(fenced.queueBatch),{state:'absent'});
      assert.equal(await value(admin,'SELECT EXISTS(SELECT FROM crest_private.operations WHERE operation_id=$1) AS result',[fencedOperation]),false);

      const retrySql=await readFile(new URL('../../planning/proposals/legacy-contact-application-retries.sql',import.meta.url),'utf8');
      await admin.query('BEGIN');
      try{await admin.query(retrySql);await admin.query('COMMIT');}
      catch(error){await admin.query('ROLLBACK');throw error;}
      owner.epoch=await value(admin,'SELECT active_epoch AS result FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business]);
      const claim=(lease,db=worker)=>value(db,'SELECT crest_commands.claim_legacy_contact_application($1) AS result',[lease]);
      const execute=(lease,db=worker)=>value(db,'SELECT crest_commands.run_claimed_legacy_contact_application($1) AS result',[lease]);
      const release=(lease,db=worker)=>value(db,'SELECT crest_commands.release_legacy_contact_application($1) AS result',[lease]);
      await assert.rejects(value(worker,runSql),{code:'42501'});
      await assert.rejects(claim(randomUUID(),web),{code:'42501'});
      assert.equal(await claim(randomUUID()),'idle');

      const failing=await approvedQueueFixture('failed-queue-contact','Fictional failing queue contact');
      const independent=await approvedQueueFixture('independent-queue-contact','Fictional independent queue contact');
      const firstOperation=randomUUID(),nextOperation=randomUUID();
      const reserve=(fixture,operationId)=>value(web,queue,[...credential(owner),owner.epoch,operationId,fixture.queueBatch,fixture.digest]);
      assert.equal((await reserve(failing,firstOperation)).state,'queued');
      assert.equal((await reserve(independent,nextOperation)).state,'queued');
      const firstLease=randomUUID(),nextLease=randomUUID(),interruptedLease=randomUUID(),lastLease=randomUUID();
      assert.equal(await claim(firstLease),'claimed');
      assert.equal(await claim(nextLease,secondWorker),'claimed');
      const checkAttempt=()=>value(admin,`SELECT jsonb_build_object('attempts',attempt_count,'leaseId',lease_id,
       'delayed',next_attempt_at>clock_timestamp()) AS result FROM crest_private.legacy_contact_apply_requests WHERE operation_id=$1`,[firstOperation]);
      assert.equal((await checkAttempt()).leaseId,firstLease);
      await admin.query("ALTER TABLE crest.customers ADD CONSTRAINT test_refuse_queued_contact CHECK(display_name<>'Fictional failing queue contact')");
      try{
       await assert.rejects(execute(firstLease),{code:'23514',constraint:'test_refuse_queued_contact'});
       assert.equal(await execute(nextLease,secondWorker),true);
       assert.equal((await resultPage(independent.queueBatch)).receipt.operationId,nextOperation);
       assert.equal(await release(firstLease),true);
       assert.deepEqual(await checkAttempt(),{attempts:1,leaseId:null,delayed:true});
       assert.equal(await claim(randomUUID()),'idle');

       await admin.query("UPDATE crest_private.legacy_contact_apply_requests SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1",[firstOperation]);
       assert.equal(await claim(interruptedLease),'claimed');
       // Advance the persisted expiry as if the first process were gone.
       await admin.query("UPDATE crest_private.legacy_contact_apply_requests SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1",[firstOperation]);
       assert.equal(await claim(lastLease,secondWorker),'claimed');
       assert.equal(await execute(interruptedLease),false);
       assert.equal(await release(interruptedLease),false);
       await assert.rejects(execute(lastLease,secondWorker),{code:'23514',constraint:'test_refuse_queued_contact'});
       assert.equal(await release(lastLease,secondWorker),true);
       assert.deepEqual(await checkStatus(owner,failing.queueBatch),{state:'review',operationId:firstOperation});
       assert.deepEqual(await resultPage(failing.queueBatch),{state:'absent'});
       assert.equal(await value(admin,'SELECT EXISTS(SELECT FROM crest_private.operations WHERE operation_id=$1) AS result',[firstOperation]),false);
       assert.equal(await claim(randomUUID()),'idle');
      }finally{await admin.query('ALTER TABLE crest.customers DROP CONSTRAINT test_refuse_queued_contact');}
      const retryOperation=randomUUID(),retryLease=randomUUID();
      assert.equal((await reserve(failing,retryOperation)).state,'queued');
      assert.equal(await claim(retryLease),'claimed');
      assert.equal(await execute(retryLease),true);
      assert.equal(await execute(retryLease),false);
      assert.equal(await release(retryLease),false);
      assert.equal((await resultPage(failing.queueBatch)).receipt.operationId,retryOperation);

      const held=await approvedQueueFixture('restore-queue-contact','Fictional pending recovery contact');
      const heldOperation=randomUUID(),heldLease=randomUUID();
      assert.equal((await reserve(held,heldOperation)).state,'queued');
      assert.equal(await claim(heldLease),'claimed');
      const queueSourceSql=await readFile(new URL('../../planning/proposals/legacy-contact-application-queue-source.sql',import.meta.url),'utf8');
      await admin.query('BEGIN');
      try{await admin.query(queueSourceSql);await admin.query('COMMIT');}
      catch(error){await admin.query('ROLLBACK');throw error;}
      const sourcePage='SELECT crest_commands.legacy_contact_request_source_page($1,$2,$3) AS result';
      await assert.rejects(value(exporter,sourcePage,[owner.business,null,1]),{code:'25001'});
      await assert.rejects(value(web,sourcePage,[owner.business,null,1]),{code:'42501'});
      await assert.rejects(value(worker,sourcePage,[owner.business,null,1]),{code:'42501'});
      assert.equal((await captureSource(exporter,other.business,captureLegacyContactRequestSource)).length,1);
      const sourceLines=await captureSource(exporter,owner.business,captureLegacyContactRequestSource);
      const sourceRows=sourceLines.map(line=>JSON.parse(line));
      assert.deepEqual(sourceRows[0],{schemaVersion:1,scope:'legacy_contact_apply_requests',businessId:owner.business});
      const evidenceRows=sourceRows.slice(1);
      assert.equal(evidenceRows.find(row=>row.operation_id===heldOperation).status,'queued');
      assert.equal(evidenceRows.find(row=>row.operation_id===firstOperation).status,'review');
      assert.equal(evidenceRows.find(row=>row.operation_id===retryOperation).status,'committed');
      assert(evidenceRows.every(row=>!Object.hasOwn(row,'lease_id')&&!Object.hasOwn(row,'next_attempt_at')));
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
       const firstPage=await value(exporter,sourcePage,[owner.business,null,1]);
       const secondPage=await value(exporter,sourcePage,[owner.business,firstPage.rows[0].operation_id,1]);
       assert.deepEqual(firstPage.rows,[evidenceRows[0]]);
       assert.equal(firstPage.hasMore,true);
       assert.deepEqual(secondPage.rows,[evidenceRows[1]]);
      }finally{await exporter.query('ROLLBACK');}
      await portableTarget.query(`CREATE TEMP TABLE request_evidence(business_id uuid,operation_id uuid PRIMARY KEY,
       batch_id uuid,evidence_sha256 text,requested_by uuid,requested_at timestamptz,status text,completed_at timestamptz,attempt_count integer)`);
      const loadedRequests=await portableTarget.query('INSERT INTO request_evidence SELECT * FROM jsonb_populate_recordset(NULL::request_evidence,$1::jsonb)',
       [JSON.stringify(evidenceRows)]);
      assert.equal(loadedRequests.rowCount,evidenceRows.length);
      assert.deepEqual((await portableTarget.query('SELECT to_jsonb(r) AS value FROM request_evidence r ORDER BY operation_id')).rows.map(row=>row.value),evidenceRows);
      const point=join(sandbox.workspace,'held-contact-queue-backup');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(point);
      const checkpoint=await backupContactQueueCandidateDatabase(admin,target,point,keys.recipient);
      assert.equal(checkpoint.manifest.heldContactApplicationSources.length,6);
      const independentCluster=await recoveryCluster();
      let copy;
      try{
       const destination=await independentCluster.database();
       assert.deepEqual(await restoreContactQueueCandidateDatabase(point,keys.path,destination),checkpoint.manifest);
       copy=await connect(destination);
       const restoredDetails=await value(copy,`SELECT jsonb_build_object('attempts',attempt_count,'lease',lease_id,'outcome',outcome) AS result
        FROM crest_private.legacy_contact_apply_requests WHERE operation_id=$1`,[heldOperation]);
       assert.deepEqual(restoredDetails,{attempts:1,lease:heldLease,outcome:null});
       await copy.query('SET ROLE crest_export');
       assert.deepEqual(await captureSource(copy,owner.business,captureLegacyContactRequestSource),sourceLines);
       await copy.query('RESET ROLE; SET ROLE crest_web');
       assert.deepEqual(await value(copy,status,[...credential(owner),held.queueBatch]),{state:'queued',operationId:heldOperation});
       assert.deepEqual(await value(copy,status,[...credential(owner),failing.queueBatch]),{state:'committed',operationId:retryOperation});
       assert.equal((await value(copy,applicationPage,[...credential(owner),failing.queueBatch,1])).receipt.operationId,retryOperation);
       await copy.query('RESET ROLE');
       await copy.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',
        [randomUUID(),owner.business]);
       await copy.query('SET ROLE crest_legacy_contact_dispatch');
       assert.equal(await execute(heldLease,copy),true);
       assert.equal(await execute(heldLease,copy),false);
       await copy.query('RESET ROLE; SET ROLE crest_web');
       assert.deepEqual(await value(copy,status,[...credential(owner),held.queueBatch]),{state:'authority',operationId:heldOperation});
       assert.deepEqual(await value(copy,applicationPage,[...credential(owner),held.queueBatch,1]),{state:'absent'});
      }finally{try{await copy?.end();}finally{await independentCluster.close();}}
     });
    }

    if(process.env.CREST_TEST_LEGACY_APPLY_CAPACITY==='1'){
     const capacity=100000,capacityBatch=randomUUID(),sourceKey='capacity-fixture';
     const capacityCsv=new TextEncoder().encode('Id,Name,VId,Vehicle\n'+Array.from({length:capacity},(_,index)=>
      'c'+index+',Fictional scale contact,v'+index+',Fictional scale vehicle').join('\n'));
     const large=await prepareLegacyContactBatch(capacityCsv,{customerSourceId:'Id',displayName:'Name',vehicleSourceId:'VId',vehicleLabel:'Vehicle'},
      owner.business,'Fictional maximum apply capacity');
     await later.query("SET statement_timeout='90s'");
     await admin.query("SET statement_timeout='90s'");
     assert.equal((await value(later,stageSql,args(large,owner,randomUUID(),capacityBatch))).state,'committed');
     // Bulk seed only the owner decisions for the benchmark. The registered
     // decision, audit, operation and source-binding constraints all run.
     await admin.query('BEGIN');
     try{
      await admin.query(`CREATE TEMP TABLE capacity_decisions ON COMMIT DROP AS
       SELECT source_row,fingerprint,gen_random_uuid() AS decision_id,gen_random_uuid() AS operation_id
       FROM crest.legacy_contact_batch_rows WHERE (business_id,batch_id)=($1,$2)`,[owner.business,capacityBatch]);
      await admin.query(`INSERT INTO crest_private.operations
       (business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
       SELECT $1,operation_id,$2,'crm.legacy_contact.decide',1,$3,fingerprint,$2,'manual' FROM capacity_decisions`,[owner.business,owner.actor,owner.epoch]);
      await admin.query(`INSERT INTO crest.legacy_contact_decision_sources(business_id,batch_id,source_namespace,first_operation_id,created_by)
       SELECT $1,$2,$3,operation_id,$4 FROM capacity_decisions WHERE source_row=2`,[owner.business,capacityBatch,sourceKey,owner.actor]);
      await admin.query(`INSERT INTO crest.legacy_contact_decisions
       (id,business_id,batch_id,source_row,source_namespace,row_fingerprint,revision,customer_action,vehicle_action,operation_id,created_by)
       SELECT decision_id,$1,$2,source_row,$3,fingerprint,1,'create','create',operation_id,$4 FROM capacity_decisions`,
       [owner.business,capacityBatch,sourceKey,owner.actor]);
      // The fixture itself inserts 100,000 decisions in one admin transaction.
      // Refresh the parent statistics before seeding their audit records.
      await admin.query('ANALYZE crest_private.operations (business_id,operation_id,actor_id)');
      await admin.query(`INSERT INTO crest_private.audit_events
       (business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
       SELECT business_id,operation_id,created_by,created_by,'legacy_contact_decisions',id,1,'decide',
        jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.legacy_contact_decision_receipt(d)),'manual'
       FROM crest.legacy_contact_decisions d WHERE (business_id,batch_id)=($1,$2)`,[owner.business,capacityBatch]);
      await admin.query(`UPDATE crest_private.operations o SET state='committed',result_schema_version=1,
       result=crest_private.legacy_contact_decision_receipt(d) FROM crest.legacy_contact_decisions d
       WHERE (d.business_id,d.batch_id)=($1,$2) AND (o.business_id,o.operation_id)=(d.business_id,d.operation_id)`,[owner.business,capacityBatch]);
      await admin.query('COMMIT');
     }catch(error){await admin.query('ROLLBACK');throw error;}
     const reviewStart=performance.now(),reviewed=await reviewApproval(capacityBatch);
     const reviewMs=Math.round(performance.now()-reviewStart);
     assert.deepEqual([reviewed.state,reviewed.customerCreates,reviewed.vehicleCreates],['ready',capacity,capacity]);
     assert.equal((await approve(reviewed.evidenceSha256,randomUUID(),web,owner,capacityBatch)).state,'committed');
     const capacityOperation=randomUUID();
     async function measuredApply(statementLimit,transactionLimit){
      await later.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      try{
       await later.query(`SET LOCAL statement_timeout='${statementLimit}ms'; SET LOCAL transaction_timeout='${transactionLimit}ms'; SET LOCAL lock_timeout='3000ms'`);
       const started=performance.now();
       const result=await apply(capacityBatch,reviewed.evidenceSha256,capacityOperation,owner,later);
       const queryMs=Math.round(performance.now()-started);
       await later.query('COMMIT');
       return {result,queryMs,totalMs:Math.round(performance.now()-started)};
      }catch(error){await later.query('ROLLBACK').catch(()=>{});throw error;}
     }
     let measured;
     try{
      measured=await measuredApply(10000,15000);
      staging.diagnostic('Capacity '+JSON.stringify({rows:capacity,reviewMs,normalBudget:true,queryMs:measured.queryMs,totalMs:measured.totalMs}));
     }catch(error){
      if(error.code!=='57014'&&error.code!=='25P04')throw error;
      assert.deepEqual(await resultPage(capacityBatch),{state:'absent'});
      assert.equal(await value(admin,'SELECT EXISTS(SELECT FROM crest_private.operations WHERE operation_id=$1) AS result',[capacityOperation]),false);
      staging.diagnostic('Capacity '+JSON.stringify({rows:capacity,reviewMs,normalBudget:false,timeout:error.code}));
      // Instrument only the disposable database after the exact backup proof.
      const traces=[
       [' evidence:=crest_private.legacy_contact_approval_evidence','before approval'],
       [' INSERT INTO crest_private.operations(business_id','after locks and approval'],
       [' WITH source AS (','after outcome rows'],
       [' GET DIAGNOSTICS created_vehicles','after vehicle and customer writes'],
       [" previous_scan_setting:=current_setting('enable_seqscan');",'target statistics ready'],
       [" SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,",'after identity writes'],
       [" RETURN jsonb_build_object('state','committed','receipt',receipt,",'before return'],
      ];
      const definition=applicationSql.slice(applicationSql.indexOf('CREATE FUNCTION crest_private.commit_legacy_contact_application('),
       applicationSql.indexOf('REVOKE ALL ON FUNCTION crest_private.commit_legacy_contact_application('));
      let instrumented=definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
      for(const [anchor,label] of traces){
       assert(instrumented.includes(anchor),label);
       instrumented=instrumented.replace(anchor," RAISE NOTICE 'CREST_CAPACITY_PHASE %', '"+label+"';\n"+anchor);
      }
      // Explain the exact INSERT with the real writer, tenant policy and bound values.
      const identityStart=definition.indexOf(' WITH targets AS (');
      const identityEnd=definition.indexOf(';',identityStart);
      assert(identityStart>0&&identityEnd>identityStart);
      const identityArguments=['requested_business','requested_batch','source_key','expected_evidence','requested_operation','expected_actor'];
      const bindIdentityArguments=sql=>sql.replace(new RegExp('\\b('+identityArguments.join('|')+')\\b','gu'),
       name=>'$'+(identityArguments.indexOf(name)+1));
      const insert=definition.indexOf(' INSERT INTO crest.legacy_contact_external_identities',identityStart);
      assert(insert>identityStart&&insert<identityEnd);
      const explain='EXPLAIN '+bindIdentityArguments(definition.slice(identityStart,identityEnd).trim());
      const candidatePlan='EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) '+
       bindIdentityArguments(definition.slice(identityStart,insert).trim())+' SELECT count(*) FROM first_rows';
      instrumented=instrumented.replace(' applied_count integer;', ' applied_count integer; identity_plan text;');
      assert(instrumented.includes('identity_plan text;'));
      instrumented=instrumented.replace(' WITH targets AS (',()=>
       ' FOR identity_plan IN EXECUTE $plan$'+candidatePlan+'$plan$ USING '+identityArguments.slice(0,2).join(',')+
       " LOOP RAISE NOTICE 'CREST_CAPACITY_PLAN %', identity_plan; END LOOP;\n"+
       ' FOR identity_plan IN EXECUTE $plan$'+explain+'$plan$ USING '+identityArguments.join(',')+
       " LOOP RAISE NOTICE 'CREST_CAPACITY_PLAN %', identity_plan; END LOOP;\n WITH targets AS (");
      await admin.query(instrumented);
      async function traceProof(proposal,name,markers){
       const signature='FUNCTION crest_private.'+name+'()';
       const start=proposal.indexOf('CREATE '+signature),end=proposal.indexOf('REVOKE ALL ON '+signature,start);
       assert(start>=0&&end>start,name);
       let sql=proposal.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
       for(const [anchor,notice] of markers){
        assert(sql.includes(anchor),anchor);
        sql=sql.replace(anchor,()=>notice+'\n'+anchor);
       }
       await admin.query(sql);
      }
      await traceProof(applicationSql,'verify_legacy_contact_application',[
       [' SELECT * INTO STRICT approval'," RAISE NOTICE 'CREST_CAPACITY_PHASE application proof started';"],
       [' expected:=jsonb_build_object'," RAISE NOTICE 'CREST_CAPACITY_PHASE application rows verified';"],
      ]);
      await traceProof(identitySql,'verify_legacy_contact_external_identity',[
       [' RETURN NULL;', " IF NEW.external_id IN ('c0','v99999') THEN RAISE NOTICE 'CREST_CAPACITY_PHASE source mapping % verified',NEW.external_id; END IF;"],
      ]);
      await admin.query('BEGIN');
      try{
       for(const file of ['legacy-contact-application-queue.sql','legacy-contact-application-retries.sql'])
        await admin.query(await readFile(new URL('../../planning/proposals/'+file,import.meta.url),'utf8'));
       await admin.query('COMMIT');
      }catch(queueError){await admin.query('ROLLBACK');throw queueError;}
      const queued=await value(later,'SELECT crest_commands.request_legacy_contact_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
       [...credential(owner),owner.epoch,capacityOperation,capacityBatch,reviewed.evidenceSha256]);
      assert.deepEqual(queued,{state:'queued',operationId:capacityOperation});
      assert.deepEqual(await resultPage(capacityBatch),{state:'absent'});
      const probe=await sandbox.connect(target);
      if(process.env.CREST_PROFILE_LEGACY_APPLY_FOREIGN_KEYS==='1')await probe.query(`LOAD 'auto_explain';
       SET auto_explain.log_min_duration='20ms'; SET auto_explain.log_level='notice';
       SET auto_explain.log_analyze=on; SET auto_explain.log_timing=off;
       SET auto_explain.log_buffers=on; SET auto_explain.log_nested_statements=on`);
      await probe.query("SET ROLE crest_legacy_contact_dispatch; SET statement_timeout='240s'; SET transaction_timeout='270s'; SET lock_timeout='3s'");
      const lease=randomUUID();
      assert.equal(await value(probe,'SELECT crest_commands.claim_legacy_contact_application($1) AS result',[lease]),'claimed');
      const started=performance.now();
      let sampledForeignKeys=0;
      probe.on('notice',notice=>{
       if(sampledForeignKeys<6&&/Query Text: SELECT 1 FROM ONLY "crest"\."(?:customers|vehicles)"/.test(notice.message??'')){
        sampledForeignKeys+=1;
        console.log('CREST_CAPACITY_FOREIGN_KEY',notice.message);
       }
       if(notice.message?.startsWith('CREST_CAPACITY_PHASE '))console.log(notice.message,Math.round(performance.now()-started)+' ms');
       if(notice.message?.startsWith('CREST_CAPACITY_PLAN '))console.log(notice.message);
      });
      await probe.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      try{
       assert.equal(await value(probe,'SELECT crest_commands.run_claimed_legacy_contact_application($1) AS result',[lease]),true);
       const queryMs=Math.round(performance.now()-started);
       console.log('CREST_CAPACITY_PHASE query returned',queryMs+' ms');
       await probe.query('COMMIT');
       const totalMs=Math.round(performance.now()-started);
       assert.equal(await value(admin,`SELECT min(reltuples)>$1 AS result FROM pg_class
        WHERE oid IN ('crest.customers'::regclass,'crest.vehicles'::regclass)`,[capacity/2]),true);
       const completed=await resultPage(capacityBatch);
       assert.equal(completed.state,'present');
       assert.equal(completed.receipt.operationId,capacityOperation);
       measured={result:{state:'committed',receipt:completed.receipt}};
       staging.diagnostic('Capacity background transaction '+JSON.stringify({rows:capacity,queryMs,totalMs}));
      }catch(workerError){
       await probe.query('ROLLBACK').catch(()=>{});
       if(workerError.code==='57014'||workerError.code==='25P04'){
        assert.deepEqual(await resultPage(capacityBatch),{state:'absent'});
        assert.deepEqual(await value(later,'SELECT crest_commands.read_legacy_contact_apply_request($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
         [...credential(owner),capacityBatch]),queued);
       }
       throw workerError;
      }
     }
     assert.deepEqual([measured.result.state,measured.result.receipt.customersCreated,measured.result.receipt.vehiclesCreated],
      ['committed',capacity,capacity]);
     assert.deepEqual(await apply(capacityBatch,reviewed.evidenceSha256,capacityOperation),measured.result);
     const last=await resultPage(capacityBatch,capacity);
     assert.equal(last.hasMore,false);
     assert.deepEqual(last.rows.map(row=>row.row),[capacity+1]);
     const exportSql=await readFile(new URL('../../planning/proposals/legacy-contact-application-download.sql',import.meta.url),'utf8');
     await admin.query('BEGIN');
     try{await admin.query(exportSql);await admin.query('COMMIT');}
     catch(error){await admin.query('ROLLBACK');throw error;}
     const exportStart=performance.now();
     const args116=[...credential(owner),owner.epoch,capacityBatch,capacityOperation];
     await later.query('BEGIN ISOLATION LEVEL READ COMMITTED');
     try{
      await later.query("SET LOCAL statement_timeout='10s'; SET LOCAL transaction_timeout='15s'; SET LOCAL lock_timeout='3s'");
      const state=await value(later,'SELECT crest_commands.read_legacy_contact_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',args116);
      const archive=createLegacyContactDownloadArchive(state,owner.business,{recoveryEpoch:owner.epoch,batchId:capacityBatch,
       applicationOperationId:capacityOperation},AbortSignal.timeout(15000));
      assert(archive);
      const archivedBytes=archive.bytes.byteLength;
      try{
       const recorded=await value(later,'SELECT crest_commands.record_legacy_contact_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
        [...args116,archive.digest,archivedBytes]);
       assert.equal(recorded.archiveBytes,archivedBytes);
       await later.query('COMMIT');
      }finally{archive.bytes.fill(0);}
      staging.diagnostic('Full import download '+JSON.stringify({rows:capacity,archiveBytes:archivedBytes,elapsedMs:Math.round(performance.now()-exportStart)}));
     }catch(error){await later.query('ROLLBACK').catch(()=>{});throw error;}
    }

   });
  });
 }finally{
  try{await sandbox?.close();}finally{await cluster?.close();}
 }
});
