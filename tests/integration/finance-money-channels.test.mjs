import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {requireSyntheticFinanceAccountConfiguration} from '../../scripts/synthetic-migrations.mjs';
import {backupDatabase,backupLegacy73Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
 restoreDatabase,restoreLegacy73Database} from '../support/recovery-drill.mjs';
import {formatFinanceAccountSource} from '../../src/bookkeeping/finance-account-source.ts';

async function call(db, command, values){
 const argumentsSql=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await db.query('SELECT crest_commands.'+command+'('+argumentsSql+') AS value',values)).rows[0].value;
}

test('fictional money channels preserve masked identity, reviewed opening evidence and private history',{timeout:180000},async t=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(73));
  assert.equal(previous.history.length,73);

  const web=await sandbox.connect(target),finance=await sandbox.connect(target),peer=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  await finance.query('SET ROLE crest_finance_preview');
  await peer.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),foreign=await makeOwner();
  for(const principal of [owner,foreign])await admin.query(`
   INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);

  const saveAccount=(accountId,version,body,principal=owner)=>call(finance,'save_finance_account',
   [...principal.auth(),principal.epoch,randomUUID(),1,accountId,version,body]);
  async function newAccount(code,controlKind,reportRole,principal=owner){
   const id=randomUUID(),identity={code,accountType:'asset',normalSide:'debit',controlKind,reportRole};
   assert.equal((await saveAccount(id,'0',{identity,name:'Fictional control '+code,active:true,reason:null},principal)).state,'committed');
   return id;
  }
  const bank=await newAccount('1000','bank','money'),secondBank=await newAccount('1001','bank','money');
  const wallet=await newAccount('1030','wallet','money'),custody=await newAccount('1070','owner_custody','owner_custody');
  const cash=await newAccount('1010','cash','money'),checks=await newAccount('1020','checks','money');
  const foreignBank=await newAccount('1000','bank','money',foreign);
  const bankIdentity={accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'1234'};
  const custodyIdentity={...bankIdentity,accountId:custody,ownershipScope:'mixed_personal',maskedSuffix:'9876'};
  const draft={identity:bankIdentity,label:'Fictional checking',effectiveFrom:'2026-01-01',ownershipEvidence:null,
   openingState:'unknown',openingOn:null,openingCents:null,openingEvidence:null,active:true,reason:'Fictional channel review'};
  const verified={ownershipEvidence:'Fictional owner confirmation',openingState:'verified_zero',openingOn:'2026-01-01',
   openingCents:'0',openingEvidence:'Fictional zero-balance evidence'};
  const save=(channel,version,body,operation=randomUUID(),principal=owner,client=finance)=>
   call(client,'save_money_channel',[...principal.auth(),principal.epoch,operation,channel,version,body]);
  const lookup=(channel,version,operation,principal=owner)=>call(finance,'lookup_money_channel_operation',
   [...principal.auth(),operation,principal.epoch,channel,version]);
  const retire=(channel,version,operation,reason='Fictional owner closed the uncertain attempt')=>
   call(finance,'retire_money_channel_operation',[...owner.auth(),owner.epoch,operation,owner.epoch,channel,version,reason]);
  const accounts=(kind,scope,principal=owner)=>call(finance,'list_money_channel_accounts',[...principal.auth(),kind,scope,null,25]);
  const history=(channel,before=null,principal=owner)=>call(finance,'read_money_channel_history',[...principal.auth(),channel,before,25]);
  const list=(after=null,principal=owner)=>call(finance,'read_money_channels',[...principal.auth(),after,1]);
  const channel=randomUUID(),initialOperation=randomUUID();
  let initial,readSource,retirement;

  await t.test('registered channel migration preserves populated schema73 and is idempotent',async()=>{
   await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,owner.business,false,false,true),
    {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
   const before=await inventory(admin);
   const adopted=await sandbox.apply(target);
   assert.equal(adopted.history.length,74);
   assert.deepEqual(adopted.history.slice(0,73),previous.history);
   assert.deepEqual((await sandbox.apply(target)).history,adopted.history);
   const existing=rows=>rows.filter(row=>row.schema!=='supabase_migrations'&&row.name!=='money_channel_versions');
   const after=await inventory(admin);
   assert.deepEqual(existing(after),existing(before));
   assert.equal(after.find(row=>row.schema==='crest'&&row.name==='money_channel_versions').rows,0);
   await requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true,true);
  });
  await t.test('only active controls for the exact business and custody scope are offered',async()=>{
   assert.deepEqual((await accounts('bank','dedicated_business')).rows.map(row=>row.id),[bank,secondBank]);
   assert.deepEqual((await accounts('wallet','dedicated_business')).rows.map(row=>row.id),[wallet]);
   assert.deepEqual((await accounts('bank','mixed_personal')).rows.map(row=>row.id),[custody]);
   assert.deepEqual((await accounts('cash','physical_business_cash')).rows.map(row=>row.id),[cash]);
   assert.deepEqual((await accounts('checks','check_custody')).rows.map(row=>row.id),[checks]);
   assert.deepEqual((await accounts('bank','dedicated_business',foreign)).rows.map(row=>row.id),[foreignBank]);
   await assert.rejects(call(web,'read_money_channels',[...owner.auth(),null,25]),{code:'42501'});
   await assert.rejects(finance.query('SELECT id FROM crest.money_channel_versions'),{code:'42501'});
  });
  await t.test('masked identifiers, pinned control and exact retries survive missing evidence',async()=>{
   await assert.rejects(save(randomUUID(),'0',{...draft,identity:{...bankIdentity,maskedSuffix:'12345678'}}),{code:'23514'});
   await assert.rejects(save(randomUUID(),'0',{...draft,identity:{...bankIdentity,accountId:foreignBank}}),{message:'FINANCE_CHANNEL_ACCOUNT_REQUIRED'});
   await assert.rejects(save(randomUUID(),'0',{...draft,identity:{...bankIdentity,accountId:custody}}),{message:'FINANCE_CHANNEL_ACCOUNT_REQUIRED'});
   initial=await save(channel,'0',draft,initialOperation);
   assert.equal(initial.state,'committed');
   assert.equal(initial.receipt.openingCents,null);
   assert.equal(initial.receipt.ownerActorId,owner.actor);
   assert.deepEqual(await save(channel,'0',draft,initialOperation),initial);
   assert.deepEqual(await lookup(channel,'0',initialOperation),initial);
   assert.deepEqual(await lookup(channel,'0',initialOperation,foreign),{state:'absent'});
   assert.deepEqual((await history(channel,null,foreign)).rows,[]);
   assert.deepEqual((await accounts('bank','dedicated_business')).rows.map(row=>row.id),[secondBank]);
   await assert.rejects(save(randomUUID(),'0',draft),{message:'FINANCE_CHANNEL_ACCOUNT_PINNED'});
  });
  await t.test('opening evidence and cents retain scope, revisions, concurrency and archive protection',async()=>{
   const revise={...draft,...verified,identity:null,effectiveFrom:'2026-02-01'};
   await assert.rejects(save(channel,'1',{...revise,identity:bankIdentity}),{message:'FINANCE_CHANNEL_IDENTITY_RETAINED'});
   await assert.rejects(save(channel,'1',{...revise,ownershipEvidence:null}),{code:'23514'});
   await assert.rejects(save(channel,'1',{...revise,openingCents:'1000'}),{code:'23514'});
   await assert.rejects(save(randomUUID(),'0',{...draft,...verified,identity:custodyIdentity,
    openingState:'verified',openingCents:'-1'}),{code:'23514'});
   const mixed=await save(randomUUID(),'0',{...draft,...verified,identity:custodyIdentity,label:'Fictional owner custody'});
   assert.equal(mixed.receipt.ownershipScope,'mixed_personal');
   assert.equal((await save(randomUUID(),'0',{...draft,...verified,identity:{...bankIdentity,accountId:secondBank},
    openingState:'verified',openingCents:'-100',label:'Fictional dedicated overdraft'})).receipt.openingCents,'-100');
   const competing=await Promise.allSettled([
    save(channel,'1',revise),save(channel,'1',{...revise,label:'Fictional revised label'},randomUUID(),owner,peer)
   ]);
   assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
   assert.equal(competing.find(result=>result.status==='rejected').reason.message,'FINANCE_CHANNEL_VERSION_CONFLICT');
   assert.deepEqual((await history(channel)).rows.map(row=>[row.version,row.openingState,row.openingCents]),
    [['2','verified_zero','0'],['1','unknown',null]]);
   assert.deepEqual((await history(channel,'2')).rows,[initial.receipt]);
   const page=await list();
   assert.equal(page.hasMore,true);
   assert.notEqual((await list(page.rows[0].channelId)).rows[0].channelId,page.rows[0].channelId);
   const archive={identity:null,name:'Fictional closed bank',active:false,reason:'Fictional archive'};
   await assert.rejects(saveAccount(bank,'1',archive),{message:'FINANCE_CHANNEL_ACCOUNT_PINNED'});
   assert.equal((await save(channel,'2',{...revise,active:false,effectiveFrom:'2026-03-01'})).receipt.active,false);
   assert.equal((await saveAccount(bank,'1',archive)).state,'committed');
   await assert.rejects(save(randomUUID(),'0',draft),{message:'FINANCE_CHANNEL_ACCOUNT_PINNED'});
   const future=randomUUID();
   assert.equal((await save(future,'0',{...draft,identity:{...bankIdentity,accountId:wallet,kind:'wallet'}})).state,'committed');
   assert.equal((await save(future,'1',{...draft,identity:null,effectiveFrom:'9999-01-01',active:false})).state,'committed');
   await assert.rejects(saveAccount(wallet,'1',archive),{message:'FINANCE_CHANNEL_ACCOUNT_PINNED'});
   await assert.rejects(admin.query('DELETE FROM crest.money_channel_versions WHERE channel_id=$1',[channel]),{code:'55000'});
  });
  await t.test('retiring an uncommitted operation cannot overwrite an earlier saved result or admit a delayed save',async()=>{
   const operation=randomUUID(),targetChannel=randomUUID();
   assert.deepEqual(await retire(channel,'0',initialOperation),initial);
   assert.deepEqual(await lookup(targetChannel,'0',operation),{state:'absent'});
   const closed=await retire(targetChannel,'0',operation);
   retirement={targetChannel,operation,closed};
   assert.equal(closed.state,'retired');
   assert.deepEqual(await lookup(targetChannel,'0',operation),closed);
   assert.deepEqual(await retire(targetChannel,'0',operation),closed);
   assert.deepEqual(await save(targetChannel,'0',draft,operation),{state:'conflict',reason:'operation'});
  });
  await t.test('portable source retains private channel versions with exact cents and masks',async()=>{
   readSource=async db=>{
    const read=async(table,fields)=>{
     const properties=fields.flatMap(field=>[`'${field}'`,`${field}::text`]);
     properties.push("'created_at'",`to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
     const result=await db.query(`SELECT to_jsonb(t)||jsonb_build_object(${properties.join(',')}) AS value
      FROM crest.${table} t WHERE business_id=$1`,[owner.business]);
     return result.rows.map(row=>row.value);
    };
    const accounts=await read('accounts',['first_version']);
    const versions=await read('account_versions',['version','previous_version']);
    const channels=await read('money_channel_versions',['version','previous_version','opening_cents']);
    return {businessId:owner.business,snapshotToken:'a'.repeat(64),rows:{accounts,account_versions:versions},
     expectedCounts:{accounts:6,account_versions:7},moneyChannelSnapshot:{rows:channels,expectedCount:7}};
   };
   const input=await readSource(admin),channels=input.moneyChannelSnapshot.rows;
   const result=formatFinanceAccountSource(input),manifest=JSON.parse(result.manifest);
   assert.equal(manifest.schemaVersion,4);
   assert.equal(manifest.recordCounts.money_channel_versions,7);
   assert.equal(manifest.completePortableExport,false);
   const csv=result.files.find(file=>file.name==='money_channel_versions.csv');
   assert.match(csv.content,/"verified","2026-01-01","'-100"/);
   const dictionary=JSON.parse(result.files.find(file=>file.name==='money_channel_versions_dictionary.json').content);
   assert.deepEqual(dictionary.booleans,['active']);assert(dictionary.exactText.includes('opening_cents'));
   const wrongMask=channels.map(row=>row.channel_id===channel&&row.version==='2'?{...row,masked_suffix:'5678'}:row);
   assert.throws(()=>formatFinanceAccountSource({...input,moneyChannelSnapshot:{rows:wrongMask,expectedCount:7}}),
    {message:'FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED'});
   assert.throws(()=>formatFinanceAccountSource({...input,moneyChannelSnapshot:{rows:channels.slice(1),expectedCount:7}}),
    {message:'FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED'});
  });
  await t.test('encrypted independent restore retains source bytes, original receipts and reviews',async()=>{
   const directory=await privateWorkspace(),point=join(directory,'point');
   let destination,restored;
   try{
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupLegacy73Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupDatabase(admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,74);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='money_channel_versions').rows,7);
    destination=await recoveryCluster();
    const restoredUrl=await destination.database();
    assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
    await assert.rejects(restoreLegacy73Database(point,keys.path,restoredUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    await restoreDatabase(point,keys.path,restoredUrl);
    restored=await connect(restoredUrl);
    assert.deepEqual(await inventory(restored),manifest.rows);
    assert.deepEqual(formatFinanceAccountSource(await readSource(restored)),formatFinanceAccountSource(await readSource(admin)));
    await requireSyntheticFinanceAccountConfiguration(restoredUrl,owner.business,true,true,true);
    const savedHistory=await history(channel);
    await restored.query('SET ROLE crest_finance_preview');
    assert.deepEqual(await call(restored,'read_money_channel_history',[...owner.auth(),channel,null,25]),savedHistory);
    assert.deepEqual(await call(restored,'lookup_money_channel_operation',[...owner.auth(),initialOperation,owner.epoch,channel,'0']),initial);
    assert.deepEqual(await call(restored,'lookup_money_channel_operation',
     [...owner.auth(),retirement.operation,owner.epoch,retirement.targetChannel,'0']),retirement.closed);
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
