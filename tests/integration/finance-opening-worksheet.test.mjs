import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase} from '../support/recovery-drill.mjs';
import {captureOpeningWorksheetSource,verifyOpeningWorksheetSource} from '../../src/bookkeeping/opening-worksheet-source.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';

const coverage={includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
 includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,includeCollectionFailures:true,
 includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,includeRefundTransferFees:true,includeCollectionFailureRecredits:true,
 includeCollectionFailureGroupedRecredits:true,includeRestoredTips:true,includeOpeningWorksheets:true};

const hash=value=>createHash('sha256').update(value).digest('hex');
const save='save_fictional_opening_worksheet';
const read='read_fictional_opening_worksheet';
const lookup='lookup_fictional_opening_worksheet_operation';
const retire='retire_fictional_opening_worksheet_operation';

async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query(`SELECT crest_commands.${name}(${args}) AS value`,values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('opening worksheet preserves verified evidence and unknown balances without posting',{timeout:240000},async testContext=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  const baseline=await sandbox.apply(target,await sandbox.prefix(101));
  assert.equal(baseline.history.length,101);
  const accepted=await sandbox.apply(target);
  assert.equal(accepted.history.length,102);
  assert.deepEqual(accepted.history.slice(0,101),baseline.history);
  testContext.diagnostic(`Baseline registry SHA-256 ${baseline.registrySha256}, worksheet registry SHA-256 ${accepted.registrySha256}`);

  const web=await sandbox.connect(target),finance=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),other=await makeOwner();
  await admin.query('UPDATE crest.businesses SET timezone=$2,version=version+1 WHERE id=$1',[owner.business,'America/Chicago']);
  await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
  const authority=()=>[...owner.auth(),owner.epoch];
  const mutate=()=>[...authority(),randomUUID()];
  const cutoverOn='2026-06-01';
  const cutoverAt='2026-06-01T05:00:00Z';
  const addBank=async(code,suffix)=>{
   const account=randomUUID(),channelId=randomUUID();
   await committed(finance,'save_finance_account',[...mutate(),1,account,'0',{
    identity:{code,accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
    name:`Fictional bank ${suffix}`,active:true,reason:null,
   }]);
   await committed(finance,'save_money_channel',[...mutate(),channelId,'0',{
    identity:{accountId:account,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:suffix},
    label:`Fictional bank ${suffix}`,effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional verified ownership',
    openingState:'unknown',openingOn:null,openingCents:null,openingEvidence:null,
    active:true,reason:'Fictional channel review',
   }]);
   return {channelId,channelVersion:'1'};
  };
  const bank=await addBank('1000','9082'),otherBank=await addBank('1001','2819');
  const document=reference=>({reference,sha256:hash(reference)});
  const unknown={state:'unknown',evidence:null,note:'Fictional evidence review pending'};
  const zero={state:'verified_zero',evidence:document('Fictional zero control schedule'),note:'Zero reviewed at the boundary'};
  const verifiedBank={...bank,state:'verified',statementCents:'10000',bookCents:'10100',
   evidence:document('Fictional bank statement'),timing:[{...document('Fictional deposit in transit'),cents:'100'}],note:'Fictional statement bridge'};
  const unknownBank={...otherBank,state:'unknown',statementCents:null,bookCents:null,evidence:null,timing:[],note:'Fictional statement outstanding'};
  const body={cutoverOn,cutoverAt,source:document('Fictional opening file'),equityBasis:'Provisional fictional net investment',
   banks:[verifiedBank,unknownBank],controls:{receivables:unknown,customerFunds:zero,supplierPayables:zero,taxLiabilities:zero,
    otherLiabilities:zero,cashAndChecks:zero,wallets:zero,otherAssets:zero}};
  const counts=async()=> (await admin.query(`SELECT
   (SELECT count(*)::int FROM crest.journal_entries) AS journal,
   (SELECT count(*)::int FROM crest.receivable_items) AS receivables,
   (SELECT count(*)::int FROM crest.accounting_periods) AS periods`)).rows[0];
  const before=await counts();
  const view=await command(finance,read,[...authority(),cutoverOn]);
  assert.equal(view.cutoverAt,cutoverAt);
  assert.equal(view.timeZone,'America/Chicago');
  assert.equal(view.worksheet,null);
  assert.deepEqual(view.banks.map(row=>row.channelId),[bank.channelId,otherBank.channelId]);
  await assert.rejects(command(web,read,[...authority(),cutoverOn]),{code:'42501'});
  await assert.rejects(command(finance,read,[...other.auth().slice(0,-1),owner.business,owner.epoch,cutoverOn]),{code:'42501'});
  await assert.rejects(command(finance,read,[...owner.auth(),randomUUID(),cutoverOn]),{message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(finance.query('SELECT * FROM crest.opening_worksheet_revisions'),{code:'42501'});

  const submit=(draft,revision='0')=>command(finance,save,[...mutate(),revision,draft]);
  for(const [patch,message] of [
   [{cutoverAt:'2026-06-01T00:00:00Z'},'OPENING_WORKSHEET_BOUNDARY_REQUIRED'],
   [{banks:[verifiedBank]},'OPENING_WORKSHEET_BANK_INVENTORY_REQUIRED'],
   [{banks:[verifiedBank,verifiedBank]},'OPENING_WORKSHEET_DUPLICATE_BANK'],
   [{banks:[{...verifiedBank,bookCents:'10001'},unknownBank]},'OPENING_WORKSHEET_BANK_BRIDGE_REQUIRED'],
   [{banks:[verifiedBank,{...unknownBank,bookCents:'0'}]},'OPENING_WORKSHEET_BANK_UNKNOWN_AMOUNTS'],
   [{banks:[{...verifiedBank,timing:[verifiedBank.timing[0],verifiedBank.timing[0]]},unknownBank]},'OPENING_WORKSHEET_DUPLICATE_TIMING'],
  ])await assert.rejects(submit({...body,...patch}),{message});

  const operation=randomUUID(),original=()=>[...authority(),operation,'0',body];
  const first=await committed(finance,save,original());
  assert.equal(first.revision,'1');
  assert.equal(first.state,'incomplete');
  assert.equal(first.posted,false);
  assert.equal(first.bankNetCents,'10100');
  assert.equal(first.provisionalEquityCents,'10100');
  assert.equal(first.profitAndLossCents,'0');
  assert.equal(first.debitCents,first.creditCents);
  assert.deepEqual(await committed(finance,save,original()),first);
  assert.deepEqual(await command(finance,save,[...authority(),operation,'0',{...body,equityBasis:'Different evidence'}]),
   {state:'conflict',reason:'operation'});
  assert.deepEqual(await committed(finance,lookup,[...authority(),operation,owner.epoch]),first);
  assert.deepEqual(await command(finance,lookup,[...authority(),randomUUID(),owner.epoch]),{state:'absent'});
  assert.deepEqual(await command(finance,lookup,[...other.auth(),other.epoch,operation,other.epoch]),{state:'absent'});
  assert.deepEqual(await command(finance,retire,[...authority(),operation,owner.epoch,'Fictional review']),{state:'committed',receipt:first});
  const interrupted=randomUUID(),close=[...authority(),interrupted,owner.epoch,'Original fictional draft unavailable'];
  assert.deepEqual(await command(finance,retire,close),{state:'retired'});
  assert.deepEqual(await command(finance,retire,close),{state:'retired'});
  assert.deepEqual(await command(finance,lookup,[...authority(),interrupted,owner.epoch]),{state:'retired'});
  assert.deepEqual(await command(finance,save,[...authority(),interrupted,'1',body]),{state:'retired'});
  const retirement=(await admin.query('SELECT reason FROM crest_private.audit_events WHERE operation_id=$1',[interrupted])).rows;
  assert.deepEqual(retirement,[{reason:'Original fictional draft unavailable'}]);
  await assert.rejects(submit(body),{message:'OPENING_WORKSHEET_REVISION_CONFLICT'});
  const complete={...body,cutoverOn:'2026-06-02',cutoverAt:'2026-06-02T05:00:00Z',banks:[verifiedBank,{...unknownBank,state:'verified_zero',statementCents:'0',bookCents:'0',
   evidence:document('Fictional zero bank statement')}],controls:{...body.controls,receivables:zero}};
  const revised=await submit(complete,'1');
  assert.equal(revised.state,'committed');
  assert.equal(revised.receipt.state,'balanced_evidence_only');
  const refreshed=await command(finance,read,[...authority(),null]);
  assert.equal(refreshed.cutoverOn,complete.cutoverOn);
  assert.deepEqual(refreshed.worksheet,revised.receipt);
  const audit=(await admin.query(`SELECT delta FROM crest_private.audit_events WHERE id=$1`,[revised.receipt.auditEventId])).rows[0].delta;
  assert.deepEqual(audit.before,first);
  assert.deepEqual(audit.after,revised.receipt);
  await assert.rejects(admin.query('UPDATE crest.opening_worksheet_revisions SET evidence=evidence'),/retain|immutable|history/i);
  assert.deepEqual(await counts(),before);
  const exporter=await sandbox.connect(target);
  await exporter.query('SET ROLE crest_export');
  const snapshot='opening_worksheet_source_snapshot';
  await assert.rejects(command(exporter,snapshot,[owner.business]),{code:'25001'});
  await assert.rejects(command(finance,snapshot,[owner.business]),{code:'42501'});
  await assert.rejects(exporter.query('SELECT * FROM crest.opening_worksheet_revisions'),{code:'42501'});
  async function capture(connection,businessId=owner.business){
   await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const source=await captureOpeningWorksheetSource(businessId,async(sql,args)=>(await connection.query(sql,args)).rows);
    return JSON.parse(source);
   }finally{await connection.query('ROLLBACK');}
  }
  const source=await capture(exporter);
  assert.deepEqual(verifyOpeningWorksheetSource(source,owner.business),{revisions:2,operations:3,audits:3});
  assert.deepEqual(verifyOpeningWorksheetSource(await capture(exporter,other.business),other.business),{revisions:0,operations:0,audits:0});
  const changed=structuredClone(source);
  changed.audits[0].delta='{}';
  assert.throws(()=>verifyOpeningWorksheetSource(changed,owner.business),/REVIEW_REQUIRED/);
  async function financeExport(connection){
   await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const artifact=(await captureFinanceSourceExport(owner.business,async(sql,args)=>(await connection.query(sql,args)).rows,coverage)).forServer();
    const result=verifyFinanceSourceExport(artifact.manifest,artifact.files,owner.business);
    assert.equal(result.profile,'crest.posted-finance-source.v18');
    assert.equal(result.balancedJournalEntries,0);
    const opening=artifact.files.find(row=>row.name==='opening_worksheet_source.json');
    assert.deepEqual(JSON.parse(opening.content),source);
    return artifact;
   }finally{await connection.query('ROLLBACK');}
  }
  const artifact=await financeExport(exporter);
  const omitted=artifact.files.filter(file=>file.name!=='opening_worksheet_source.json');
  assert.throws(()=>verifyFinanceSourceExport(artifact.manifest,omitted,owner.business),/REQUIRED/);
  const workspace=await privateWorkspace();
  let destination,restoredDatabase;
  try{
   const point=join(workspace,'point'),keys=await keyPair(workspace);
   await mkdir(point,{mode:0o700});
   const {manifest}=await backupDatabase(admin,target,point,keys.recipient);
   assert.equal(manifest.schemaVersion,102);
   destination=await recoveryCluster();
   const restoredUrl=await destination.database();
   assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
   assert.deepEqual(await restoreDatabase(point,keys.path,restoredUrl),manifest);
   restoredDatabase=await connect(restoredUrl);
   assert.deepEqual(await inventory(restoredDatabase),manifest.rows);
   await restoredDatabase.query('SET ROLE crest_export');
   assert.deepEqual(await capture(restoredDatabase),source);
   assert.deepEqual((await financeExport(restoredDatabase)).files,artifact.files);
   await restoredDatabase.query('SET ROLE crest_finance_preview');
   assert.deepEqual(await committed(restoredDatabase,lookup,[...authority(),operation,owner.epoch]),first);
   assert.deepEqual(await command(restoredDatabase,lookup,[...authority(),interrupted,owner.epoch]),{state:'retired'});
   assert.deepEqual(await command(restoredDatabase,save,[...authority(),interrupted,'2',body]),{state:'retired'});
   testContext.diagnostic(`Encrypted restore verified ${manifest.rows.length} tables, audit parity and original save replay`);
  }finally{
   try{await restoredDatabase?.end();}finally{
    try{await destination?.close();}finally{
     assert.equal(await realpath(workspace),workspace);
     await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
   }
  }
 }finally{
  try{await sandbox?.close();}finally{await cluster.close();}
 }
});
