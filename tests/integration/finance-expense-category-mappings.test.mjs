import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {requireSyntheticFinanceAccountConfiguration} from '../../scripts/synthetic-migrations.mjs';
import {backupLegacy73Database,backupLegacy72Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
 restoreLegacy73Database,restoreLegacy72Database} from '../support/recovery-drill.mjs';

async function call(db, command, values){
 const argumentsSql=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await db.query('SELECT crest_commands.'+command+'('+argumentsSql+') AS value',values)).rows[0].value;
}

test('fictional expense categories select a reviewed eligible account without a default classification',{timeout:180000},async t=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(72));
  assert.equal(previous.history.length,72);

  const web=await sandbox.connect(target),finance=await sandbox.connect(target),peer=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  await finance.query('SET ROLE crest_finance_preview');
  await peer.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const ownerFixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await ownerFixture(),foreign=await ownerFixture();
  for(const principal of [owner,foreign])await admin.query(`
   INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);

  async function saveAccount({code,name,type='expense',control=null,active=true,principal=owner}){
   const accountId=randomUUID(),identity={code,accountType:type,normalSide:type==='revenue'?'credit':'debit',
    controlKind:control,reportRole:control??type};
   const saved=await call(finance,'save_finance_account',[...principal.auth(),principal.epoch,randomUUID(),1,accountId,'0',
    {identity,name,active,reason:null}]);
   assert.equal(saved.state,'committed');
   return {id:accountId,code,name};
  }
  const supplies=await saveAccount({code:'5000',name:'Fictional chemicals and supplies'});
  const fuel=await saveAccount({code:'5100',name:'Fictional fuel'});
  const prepaid=await saveAccount({code:'1150',name:'Fictional prepaid expense',type:'asset',control:'prepaid'});
  const asset=await saveAccount({code:'1500',name:'Fictional equipment asset',type:'asset',control:'fixed_asset'});
  const bank=await saveAccount({code:'1000',name:'Fictional bank',type:'asset',control:'money'});
  const revenue=await saveAccount({code:'4000',name:'Fictional detailing revenue',type:'revenue'});
  const inactive=await saveAccount({code:'5300',name:'Fictional archived fees',active:false});
  const foreignAccount=await saveAccount({code:'5100',name:'Fictional different owner fuel',principal:foreign});
  const category='category_fuel';
  const list=(purpose=category,after=null,limit=2,principal=owner,client=finance)=>
   call(client,'list_expense_category_mapping_accounts',[...principal.auth(),purpose,after,limit]);
  const resolve=(purpose,date,principal=owner)=>call(finance,'resolve_fixed_finance_mapping',[...principal.auth(),purpose,date]);
  const approve=(purpose,version,account,date,operation=randomUUID(),principal=owner,client=finance)=>
   call(client,'approve_fixed_finance_mapping',[...principal.auth(),principal.epoch,operation,purpose,version,
    account,date,'Fictional owner reviewed this account classification']);
  const lookup=(purpose,version,operation)=>call(finance,'lookup_fixed_finance_mapping_operation',
   [...owner.auth(),operation,owner.epoch,purpose,version]);

  const taxScope=['Fictional category migration district','tip',null];
  const tax=await call(finance,'approve_finance_tax_profile',[...owner.auth(),owner.epoch,randomUUID(),...taxScope,'0',
   '2026-01-01','non_taxable',null,'Fictional review evidence','Fictional owner retained tip treatment']);
  assert.equal(tax.state,'committed');
  const oldMapping=await approve('service_revenue','0',revenue.id,'2026-02-01');
  assert.equal(oldMapping.state,'committed');
  let history;
  await t.test('registered upgrade adds only scoped functions and preserves all existing rows',async()=>{
   await requireSyntheticFinanceAccountConfiguration(target,owner.business,true);
   await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true),
    {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
   const before=await inventory(admin);
   const adopted=await sandbox.apply(target,await sandbox.prefix(73));
   assert.equal(adopted.history.length,73);
   assert.deepEqual(adopted.history.slice(0,72),previous.history);
   assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(73))).history,adopted.history);
   const businessTables=rows=>rows.filter(row=>row.schema!=='supabase_migrations');
   assert.deepEqual(businessTables(await inventory(admin)),businessTables(before));
   await requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true);
  });

  await t.test('eligible account choices are bounded, sorted, active and business-scoped',async()=>{
   const first=await list();
   assert.deepEqual(first,{schemaVersion:1,businessId:owner.business,purpose:category,latest:null,rows:[prepaid,asset],hasMore:true});
   assert.deepEqual((await list(category,asset.code)).rows,[supplies,fuel]);
   assert.equal((await list(category,asset.code)).hasMore,false);
   assert.deepEqual((await list(category,null,25,foreign)).rows,[foreignAccount]);
   await assert.rejects(list(category,null,25,owner,web),{code:'42501'});
   await assert.rejects(list('category_other'),{message:'FINANCE_MAPPING_INPUT_REQUIRED'});
  });
  await t.test('a chosen category has no fallback and rejects unrelated, foreign and inactive accounts',async()=>{
   await assert.rejects(resolve(category,'2026-02-01'),{message:'MAPPING_NOT_READY'});
   for(const {id} of [bank,revenue,inactive,foreignAccount]){
    await assert.rejects(approve(category,'0',id,'2026-02-01'),{message:'FINANCE_MAPPING_ACCOUNT_REQUIRED'});
   }
   await assert.rejects(approve('category_other','0',supplies.id,'2026-02-01'),{message:'FINANCE_MAPPING_ACCOUNT_REQUIRED'});
   assert.equal((await resolve('service_revenue','2026-02-01')).accountId,revenue.id);
  });
  await t.test('approval, exact replay, dated lookup, conflict and closure retain one history',async()=>{
   const operation=randomUUID();
   const saved=await approve(category,'0',fuel.id,'2026-02-01',operation);
   assert.equal(saved.state,'committed');
   assert.deepEqual(await lookup(category,'0',operation),saved);
   assert.deepEqual(await approve(category,'0',fuel.id,'2026-02-01',operation),saved);
   await assert.rejects(resolve(category,'2026-01-31'),{message:'MAPPING_NOT_READY'});
   assert.equal((await resolve(category,'2026-02-01')).accountId,fuel.id);
   assert.deepEqual((await list()).latest,{version:'1',accountId:fuel.id,effectiveFrom:'2026-02-01',accountCode:fuel.code});
   const results=await Promise.allSettled([
    approve(category,'1',prepaid.id,'2026-03-01'),
    approve(category,'1',asset.id,'2026-03-01',randomUUID(),owner,peer),
   ]);
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   assert.equal(results.find(result=>result.status==='rejected').reason.message,'FINANCE_MAPPING_VERSION_CONFLICT');
   const selected=(await resolve(category,'2026-03-01')).accountId;
   assert([prepaid.id,asset.id].includes(selected));
   assert.equal((await approve(category,'2',null,'2026-04-01')).state,'committed');
   await assert.rejects(resolve(category,'2026-04-01'),{message:'MAPPING_NOT_READY'});
   assert.equal((await resolve(category,'2026-02-15')).accountId,fuel.id);
   history=await call(finance,'read_fixed_finance_mapping_history',[...owner.auth(),category,null,25]);
   assert.deepEqual(history.rows.map(row=>[row.version,row.accountId]),[['3',null],['2',selected],['1',fuel.id]]);
   const audit=(await admin.query("SELECT count(*)::integer n FROM crest_private.audit_events WHERE entity_kind='account_mapping_versions'")).rows[0];
   assert.equal(audit.n,4);
  });
  await t.test('independent encrypted restore preserves category history and earlier tax treatment',async()=>{
   const directory=await privateWorkspace(),point=join(directory,'point');
   let destination,restored;
   try{
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupLegacy72Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupLegacy73Database(admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,73);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='account_mapping_versions').rows,4);
    destination=await recoveryCluster();
    const restoredUrl=await destination.database();
    assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
    await assert.rejects(restoreLegacy72Database(point,keys.path,restoredUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    await restoreLegacy73Database(point,keys.path,restoredUrl);
    restored=await connect(restoredUrl);
    assert.deepEqual(await inventory(restored),manifest.rows);
    await requireSyntheticFinanceAccountConfiguration(restoredUrl,owner.business,true,true);
    await restored.query('SET ROLE crest_finance_preview');
    const retained=await call(restored,'read_fixed_finance_mapping_history',[...owner.auth(),category,null,25]);
    assert.deepEqual(retained,history);
    const selected=await call(restored,'resolve_fixed_finance_mapping',[...owner.auth(),category,'2026-02-15']);
    assert.equal(selected.accountId,fuel.id);
    const restoredTax=await call(restored,'preview_finance_tax_charge',[...owner.auth(),...taxScope,'2026-01-01','1000','0']);
    assert.deepEqual(restoredTax.profile,tax.receipt);
    assert.equal(restoredTax.components.taxCents,'0');
   }finally{
    try{await restored?.end();}finally{
     try{await destination?.close();}finally{
      const actual=await realpath(directory);
      assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
      assert.match(basename(actual),/^case-[a-z0-9]+$/i);
      await rm(actual,{recursive:true,force:true});
     }
    }
   }
  });
 }finally{
  try{await sandbox?.close();}finally{await cluster.close();}
 }
});
