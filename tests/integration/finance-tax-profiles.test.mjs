import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {test} from 'node:test';
import {requireSyntheticFinanceAccountConfiguration} from '../../scripts/synthetic-migrations.mjs';
import {formatFinanceAccountSource} from '../../src/bookkeeping/finance-account-source.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {
 backupLegacy72Database,backupLegacy71Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
 restoreLegacy72Database,restoreLegacy71Database,
} from '../support/recovery-drill.mjs';

async function value(db,name,args){
 const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
 return (await db.query('SELECT crest_commands.'+name+'('+placeholders+') AS value',args)).rows[0].value;
}

test('fictional tax profiles resolve and calculate only their exact authorized dated scope', {timeout:180000}, async t=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  const schema71=await sandbox.prefix(71);
  const previous=await sandbox.apply(target,schema71);
  assert.equal(previous.history.length,71);

  const web=await sandbox.connect(target),finance=await sandbox.connect(target),peer=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  await finance.query('SET ROLE crest_finance_preview');
  await peer.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const ownerFixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await ownerFixture(),foreign=await ownerFixture();
  await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[foreign.business,foreign.actor]);
  const existingAccount=randomUUID();
  const accountDraft={identity:{code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'revenue'},
   name:'Fictional pre-existing revenue account',active:true,reason:null};
  const account=await value(finance,'save_finance_account',[...foreign.auth(),foreign.epoch,randomUUID(),1,existingAccount,'0',accountDraft]);
  assert.equal(account.state,'committed');
  await requireSyntheticFinanceAccountConfiguration(target,foreign.business);
  await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,foreign.business,true),
   {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
  const beforeTax=await inventory(admin);
  const schema72=await sandbox.prefix(72);
  const adopted=await sandbox.apply(target,schema72);

  await t.test('tax upgrade preserves a populated schema71 and creates an empty tax history',async()=>{
   assert.equal(adopted.history.length,72);
   assert.deepEqual(adopted.history.slice(0,71),previous.history);
   await requireSyntheticFinanceAccountConfiguration(target,foreign.business,true);
   assert.deepEqual((await sandbox.apply(target,schema72)).history,adopted.history);
   const afterTax=await inventory(admin),added=afterTax.filter(row=>row.schema==='crest'&&row.name==='tax_profiles');
   assert.equal(added.length,1);
   assert.equal(added[0].rows,0);
   assert.deepEqual(afterTax.filter(row=>!added.includes(row)&&row.schema!=='supabase_migrations'),
    beforeTax.filter(row=>row.schema!=='supabase_migrations'));
  });
  const jurisdiction='Fictional district',tip=[jurisdiction,'tip',null];
  const approve=(scope,version,date,treatment,rate,evidence,operation=randomUUID(),principal=owner,client=finance)=>
   value(client,'approve_finance_tax_profile',[...principal.auth(),principal.epoch,operation,...scope,version,date,treatment,rate,evidence,
    'Fictional reviewer approved the recorded evidence']);
  const lookup=(version,operation,principal=owner,client=finance)=>value(client,'lookup_finance_tax_profile_approval',
   [...principal.auth(),operation,principal.epoch,version]);
  const retire=(version,operation,reason,principal=owner)=>value(finance,'retire_finance_tax_profile_approval',
   [...principal.auth(),principal.epoch,operation,principal.epoch,version,reason]);
  const preview=(scope,date,gross='11000',discount='0',principal=owner,client=finance)=>
   value(client,'preview_finance_tax_charge',[...principal.auth(),...scope,date,gross,discount]);
  const saveService=async principal=>{
   const service=randomUUID(),definition={name:'Fictional taxable detail',inclusions:'Interior cleaning',exclusions:'',internalGuidance:null,
    rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null};
   const saved=await value(web,'save_service',[...principal.auth(),principal.epoch,randomUUID(),1,service,'0',
    {code:'fictional-'+service,active:true,definition}]);
   assert.equal(saved.state,'committed');return service;
  };
  const service=await saveService(owner),foreignService=await saveService(foreign),scope=[jurisdiction,'service',service];
  let first,original;
  await t.test('separate finance grant, recent authority, and explicit verification',async()=>{
   assert.deepEqual(await preview(tip,'2026-02-01'),{state:'unresolved',profile:null});
   await assert.rejects(preview(tip,'2026-02-01','11000','0',owner,web),{code:'42501'});
   await assert.rejects(finance.query('SELECT 1 FROM crest.tax_profiles'),{code:'42501'});
   await assert.rejects(approve(tip,'0','2026-02-01','inclusive_single','0.1','Fictional evidence'),
    {message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
   await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
    SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
   for(const input of [['inclusive_single','0.1',null],['inclusive_single','NaN','Evidence'],['non_taxable','0','Evidence'],
    ['unresolved',null,'Evidence']]){
    await assert.rejects(approve(tip,'0','2026-02-01',...input),{message:'FINANCE_TAX_PROFILE_INPUT_REQUIRED'});
   }
   await assert.rejects(approve([jurisdiction,'service',foreignService],'0','2026-02-01','non_taxable',null,'Fictional evidence'),{code:'23503'});
   original=randomUUID();
   first=await approve(scope,'0','2026-02-01','inclusive_single','0.100','Fictional rule sample',original);
   assert.equal(first.state,'committed');
   assert.equal(first.receipt.rate,'0.1');
   assert.equal(first.receipt.synthetic,true);
  });
  await t.test('the date, jurisdiction and service are exact and inclusive cents reconcile',async()=>{
   assert.deepEqual(await preview(scope,'2026-01-31'),{state:'unresolved',profile:null});
   assert.deepEqual(await preview([jurisdiction,'service',foreignService],'2026-02-01'),{state:'unresolved',profile:null});
   assert.deepEqual(await preview(scope,'2026-02-01','11000','0',foreign),{state:'unresolved',profile:null});
   assert.deepEqual(await preview(['Other fictional district','service',service],'2026-02-01'),{state:'unresolved',profile:null});
   assert.deepEqual(await preview(tip,'2026-02-01'),{state:'unresolved',profile:null});
   assert.deepEqual(await preview(scope,'2026-02-01'),{state:'ready',profile:first.receipt,components:{
    grossInclusiveCents:'11000',discountInclusiveCents:'0',inclusiveCents:'11000',grossNetCents:'10000',netCents:'10000',
    taxCents:'1000',discountNetCents:'0'}});
   assert.deepEqual((await preview(scope,'2026-02-01','11000','1100')).components,{
    grossInclusiveCents:'11000',discountInclusiveCents:'1100',inclusiveCents:'9900',grossNetCents:'10000',netCents:'9000',
    taxCents:'900',discountNetCents:'1000'});
   const one=await approve(tip,'0','2026-02-01','inclusive_single','1','Fictional tie rounding');
   assert.equal(one.state,'committed');
   const max=(await preview(tip,'2026-02-01','9223372036854775807','0')).components;
   assert.equal(max.netCents,'4611686018427387904');
   assert.equal(max.taxCents,'4611686018427387903');
   const nearTie=(await admin.query(`SELECT
    crest_private.finance_tax_charge(1,0,1.00000000000000000001)->>'netCents' below_half,
    crest_private.finance_tax_charge(1,0,0.99999999999999999999)->>'netCents' above_half`)).rows[0];
   assert.deepEqual(nearTie,{below_half:'0',above_half:'1'});
   assert.equal((await preview(tip,'2026-02-01','0','0')).components.netCents,'0');
   await assert.rejects(preview(scope,'2026-02-01','5','6'),{message:'FINANCE_TAX_COMPONENT_INPUT_REQUIRED'});
  });
  await t.test('the original approval, non-taxable, exemption and unresolved histories stay distinct',async()=>{
   await assert.rejects(approve(scope,'1','2026-02-01','non_taxable',null,'Fictional checked treatment'),
    {message:'FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED'});
   const second=await approve(scope,'1','2026-03-01','non_taxable',null,'Fictional checked treatment');
   assert.equal((await preview(scope,'2026-03-01')).components.taxCents,'0');
   assert.equal((await preview(scope,'2026-02-28')).profile.id,first.receipt.id);
   const third=await approve(scope,'2','2026-04-01','exempt',null,'Fictional exemption policy');
   assert.deepEqual(await preview(scope,'2026-04-01'),{state:'exemption_review_required',profile:third.receipt});
   const fourth=await approve(scope,'3','2026-05-01','unresolved',null,null);
   assert.deepEqual(await preview(scope,'2026-05-01'),{state:'unresolved',profile:fourth.receipt});
   assert.equal(second.receipt.treatment,'non_taxable');
   assert.deepEqual(await lookup('0',original),first);
   assert.deepEqual(await approve(scope,'0','2026-02-01','inclusive_single','0.1','Fictional rule sample',original),first);
   assert.deepEqual(await approve(scope,'0','2026-02-01','inclusive_single','0.12','Fictional rule sample',original),
    {state:'conflict',reason:'operation'});
   assert.deepEqual(await lookup('1',original),{state:'conflict',reason:'operation'});
   await assert.rejects(admin.query('UPDATE crest.tax_profiles SET treatment=\'unresolved\' WHERE id=$1',[first.receipt.id]),{code:'55000'});
  });
  await t.test('one competing approval wins, and a stale owner cannot post configuration',async()=>{
   const results=await Promise.allSettled([
    approve(scope,'4','2026-06-01','non_taxable',null,'Fictional verified first'),
    approve(scope,'4','2026-07-01','non_taxable',null,'Fictional verified second',randomUUID(),owner,peer)
   ]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const loser=results.find(r=>r.status==='rejected');
   assert.equal(loser.reason.message,'FINANCE_TAX_VERSION_CONFLICT');
   const audit=(await admin.query(`SELECT count(*)::int n FROM crest_private.audit_events a
    JOIN crest.tax_profiles p ON (p.business_id,p.audit_event_id)=(a.business_id,a.id)
    WHERE a.entity_kind='tax_profiles' AND a.action='approve'`)).rows[0].n;
   assert.equal(audit,6);
   const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
   await admin.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,owner.subject]);
   await admin.query(`WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '16 minutes' AS stamp)
    INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,
     authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
    SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id
    FROM crest_private.actors CROSS JOIN observed WHERE id=$2`,[session,owner.actor,provider,hash,randomBytes(32)]);
   const stale={...owner,auth:()=>[hash,session,owner.actor,owner.auth()[3],owner.subject,provider,owner.auth()[6],owner.business]};
   await assert.rejects(approve(scope,'5','2026-08-01','non_taxable',null,'Fictional stale approval',randomUUID(),stale),{code:'42501'});
  });
  const history=(requested,before=null,limit=2,principal=owner,client=finance)=>value(client,'read_finance_tax_profile_history',
   [...principal.auth(),...requested,before,limit]);
  await t.test('authorized history paginates exact scope and keeps review evidence',async()=>{
   const newest=await history(scope);
   assert.equal(newest.hasMore,true);
   assert.deepEqual(newest.rows.map(row=>row.version),['5','4']);
   const middle=await history(scope,'4'),oldest=await history(scope,'2');
   assert.deepEqual(middle.rows.map(row=>row.version),['3','2']);
   assert.equal(middle.hasMore,true);
   assert.deepEqual(oldest.rows,[first.receipt]);
   assert.equal(oldest.rows[0].reviewedBy,owner.actor);
   assert.equal(oldest.hasMore,false);
   assert.deepEqual((await history(scope,null,25,foreign)).rows,[]);
   assert.deepEqual((await history([jurisdiction,'service',foreignService])).rows,[]);
   await assert.rejects(history(scope,null,25,owner,web),{code:'42501'});
   await assert.rejects(history(scope,'0'),{message:'FINANCE_TAX_HISTORY_INPUT_REQUIRED'});
  });
  const pending=randomUUID(), reason='Fictional owner reviewed an interrupted approval';
  let retired;
  await t.test('retiring an uncertain approval preserves committed results and fences a late save',async()=>{
   assert.deepEqual(await retire('0',original,reason),first);
   assert.deepEqual(await lookup('5',pending),{state:'absent'});
   retired=await retire('5',pending,reason);
   assert.equal(retired.state,'retired');
   assert.equal(retired.operationId,pending);
   assert.equal(retired.receipt.expectedVersion,'5');
   assert.deepEqual(await lookup('5',pending),retired);
   assert.deepEqual(await retire('5',pending,reason),retired);
   assert.deepEqual(await retire('5',pending,'Different fictional reason'),{state:'conflict',reason:'operation'});
   assert.deepEqual(await lookup('3',pending),{state:'conflict',reason:'operation'});
   assert.deepEqual(await lookup('5',pending,foreign),{state:'absent'});
   assert.deepEqual(await approve(scope,'5','2026-12-01','non_taxable',null,'Fictional evidence',pending),
    {state:'conflict',reason:'operation'});
   assert.equal((await history(scope,null,25)).rows.length,5);
  });
  async function portableTaxSource(db){
   const rows=(await db.query(`
    SELECT to_jsonb(p)||jsonb_build_object('version',version::text,'previous_version',previous_version::text,
     'rate',rate::text,'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS value
    FROM crest.tax_profiles p WHERE p.business_id=$1`,[owner.business])).rows.map(row=>row.value);
   const input={businessId:owner.business,snapshotToken:'a'.repeat(64),rows:{accounts:[],account_versions:[]},
    expectedCounts:{accounts:0,account_versions:0},taxSnapshot:{rows,expectedCount:6}};
   return {rows,input};
  }
  await t.test('complete tax source rows retain exact text, versions and portable checksums',async()=>{
   const {rows,input}=await portableTaxSource(admin);
   const artifact=formatFinanceAccountSource(input),manifest=JSON.parse(artifact.manifest);
   const csv=artifact.files.find(file=>file.name==='tax_profiles.csv');
   assert.equal(manifest.schemaVersion,3);
   assert.equal(manifest.recordCounts.tax_profiles,6);
   assert.equal(manifest.completePortableExport,false);
   assert.equal(manifest.parts.find(part=>part.name===csv.name).sha256,createHash('sha256').update(csv.content).digest('hex'));
   assert.match(csv.content,/"scope_key","version","previous_version","effective_from","treatment","rate"/);
   assert.match(csv.content,/"inclusive_single","0\.1","Fictional rule sample"/);
   const dictionary=JSON.parse(artifact.files.find(file=>file.name==='tax_profiles_dictionary.json').content);
   assert(dictionary.exactText.includes('rate'));
   assert.deepEqual(dictionary.booleans,['synthetic']);
   assert.throws(()=>formatFinanceAccountSource({...input,taxSnapshot:{rows:rows.slice(1),expectedCount:6}}));
   const withFormula=rows.map(row=>row.id===first.receipt.id?{...row,verification_evidence:'=Fictional worksheet formula'}:row);
   const escaped=formatFinanceAccountSource({...input,taxSnapshot:{rows:withFormula,expectedCount:6}});
   assert.match(escaped.files.find(file=>file.name==='tax_profiles.csv').content,/"'=Fictional worksheet formula"/);
   assert.deepEqual(JSON.parse(escaped.files.find(file=>file.name==='tax_profiles_escape_map.json').content).escapes,
    [{row_id:first.receipt.id,column:'verification_evidence',apostrophe_prefix:true}]);
   const wrongScope=rows.map(row=>row.id===first.receipt.id?{...row,scope_key:'tip'}:row);
   assert.throws(()=>formatFinanceAccountSource({...input,taxSnapshot:{rows:wrongScope,expectedCount:6}}),
    {message:'FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED'});
  });
  await t.test('independent encrypted restore keeps exact tax versions, audits and decimal amounts',async()=>{
   const workspace=await privateWorkspace(),point=join(workspace,'point');
   let destination,restored;
   try{
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(workspace);
    await assert.rejects(backupLegacy71Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupLegacy72Database(admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,72);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='tax_profiles').rows,6);
    destination=await recoveryCluster();
    const restoredUrl=await destination.database();
    assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
    await assert.rejects(restoreLegacy71Database(point,keys.path,restoredUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    await restoreLegacy72Database(point,keys.path,restoredUrl);
    restored=await connect(restoredUrl);
    assert.deepEqual(await inventory(restored),manifest.rows);
    assert.deepEqual(formatFinanceAccountSource((await portableTaxSource(restored)).input),
     formatFinanceAccountSource((await portableTaxSource(admin)).input));
    await restored.query('SET ROLE crest_finance_preview');
    assert.deepEqual(await lookup('0',original,owner,restored),first);
    assert.deepEqual(await lookup('5',pending,owner,restored),retired);
    const saved=await preview(scope,'2026-02-01','11000','1100',owner,restored);
    assert.equal(saved.profile.id,first.receipt.id);
    assert.equal(saved.components.netCents,'9000');
    assert.equal(saved.components.taxCents,'900');
   }finally{
    try{await restored?.end();}finally{
     try{await destination?.close();}finally{
      const actual=await realpath(workspace);
      assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
      assert.match(basename(actual),/^case-[a-z0-9]+$/i);
      await rm(actual,{recursive:true,force:true});
     }
    }
   }
  });
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
