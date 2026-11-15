import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupStatementStagingDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreStatementStagingDatabase} from '../support/recovery-drill.mjs';
import {assessDedicatedStatementValues} from '../../src/bookkeeping/statement-reconciliation.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {statementStagingFile} from '../../src/bookkeeping/statement-staging-source.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';

const stage='stage_fictional_statement_import';
async function call(connection,name,values){
 const params=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+params+') AS result',values)).rows[0].result;
}

test('registered statement staging retains private source, audit, and replay through independent recovery',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const url=await sandbox.database(),admin=await sandbox.connect(url);
  await sandbox.apply(url,await sandbox.prefix(0),true);
  await installProviderSchema(admin,url);
  const prior=await sandbox.apply(url,await sandbox.prefix(102));
  const adopted=await sandbox.apply(url,await sandbox.prefix(103));
  assert.equal(adopted.history.length,103);
  assert.deepEqual(adopted.history.slice(0,102),prior.history);
  const finance=await sandbox.connect(url),web=await sandbox.connect(url);
  await finance.query('SET ROLE crest_finance_preview');
  await web.query('SET ROLE crest_web');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),other=await makeOwner();
  await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT business_id,id,created_by,'system' FROM crest_private.business_recovery_authorities WHERE business_id=ANY($1::uuid[])",[[owner.business,other.business]]);
  const {rows:[{today,yesterday,tomorrow}]}=await admin.query("SELECT current_date::text AS today,(current_date-1)::text AS yesterday,(current_date+1)::text AS tomorrow");
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
  const account=randomUUID(),channel=randomUUID();
  assert.equal((await call(finance,'save_finance_account',[...mutate(),1,account,'0',{
   identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
   name:'Fictional checking',active:true,reason:null}])).state,'committed');
  assert.equal((await call(finance,'save_money_channel',[...mutate(),channel,'0',{
   identity:{accountId:account,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'1234'},
   label:'Fictional checking',effectiveFrom:yesterday,ownershipEvidence:'Fictional ownership review',openingState:'unknown',
   openingOn:null,openingCents:null,openingEvidence:null,active:true,reason:'Fictional review'}])).state,'committed');

  const rows=[{id:randomUUID(),statementOn:today,signedCents:'300'},{id:randomUUID(),statementOn:yesterday,signedCents:'-250'}];
  const body=({operation=randomUUID(),statement=randomUUID(),from=yesterday,through=today,open='100',close='150',channelId=channel,
   file='a'.repeat(64),convention='Bank local settlement date',evidence='Fictional complete statement and page inventory reviewed',
   records=rows,channelVersion='1',principal=owner,epoch=principal.epoch}={})=>[
   ...principal.auth(),epoch,operation,statement,channelId,channelVersion,from,through,open,close,file,convention,evidence,JSON.stringify(records),
  ];
  const original=body();
  await assert.rejects(call(web,stage,original),{code:'42501'});
  await assert.rejects(finance.query('SELECT id FROM crest.statement_imports'),{code:'42501'});
  await assert.rejects(call(finance,stage,body({epoch:randomUUID()})),{message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(call(finance,stage,body({channelVersion:'2'})),{message:'STATEMENT_IMPORT_DEDICATED_CHANNEL_REQUIRED'});
  await assert.rejects(call(finance,stage,body({principal:other})),{message:'STATEMENT_IMPORT_DEDICATED_CHANNEL_REQUIRED'});
  const wallet=randomUUID(),mixed=randomUUID();
  assert.equal((await call(finance,'save_finance_account',[...mutate(),1,wallet,'0',{
   identity:{code:'1070',accountType:'asset',normalSide:'debit',controlKind:'owner_custody',reportRole:'owner_custody'},
   name:'Fictional business custody',active:true,reason:null}])).state,'committed');
  assert.equal((await call(finance,'save_money_channel',[...mutate(),mixed,'0',{
   identity:{accountId:wallet,kind:'wallet',ownershipScope:'mixed_personal',providerNamespace:'fictional-wallet',maskedSuffix:'4173'},
   label:'Fictional custody',effectiveFrom:yesterday,ownershipEvidence:'Fictional ownership review',openingState:'unknown',
   openingOn:null,openingCents:null,openingEvidence:null,active:true,reason:'Fictional review'}])).state,'committed');
  await assert.rejects(call(finance,stage,body({channelId:mixed})),{message:'STATEMENT_IMPORT_DEDICATED_CHANNEL_REQUIRED'});
  for(const change of [
   {through:tomorrow},{through:'2020-01-01'},{file:'invalid'},{evidence:' '},{convention:''},
   {records:[rows[0],rows[0]]},{records:[{...rows[0],signedCents:'0'}]},
   {records:[{...rows[0],signedCents:'-9223372036854775809'}]},
   {records:[{...rows[0],statementOn:'2026-02-29'}]},
   {records:[{...rows[0],statementOn:tomorrow}]},
   {records:[{...rows[0],unreviewed:true}]},{records:[null]},{records:null},
  ])await assert.rejects(call(finance,stage,body(change)),{message:'STATEMENT_IMPORT_INPUT_REQUIRED'});
  assert.equal((await admin.query("SELECT count(*)::int n FROM crest_private.operations WHERE command_type='finance.statement.stage'")).rows[0].n,0);

  const value=await call(finance,stage,original);
  assert.equal(value.state,'committed');
  const {rowsSha256,...receipt}=value.receipt;
  assert.match(rowsSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(receipt,{
   schemaVersion:1,businessId:owner.business,statementId:original[10],accountId:account,
   channelVersionId:(await admin.query('SELECT id FROM crest.money_channel_versions WHERE channel_id=$1',[channel])).rows[0].id,
   operationId:original[9],startsOn:yesterday,endsOn:today,openingCents:'100',closingCents:'150',fileSha256:'a'.repeat(64),
   dateConvention:original[18],completenessEvidence:original[19],rowCount:2,signedRowsCents:'50',statementDifferenceCents:'0',
  });
  const lookup=(principal=owner,epoch=owner.epoch,statement=original[10])=>
   call(finance,'lookup_fictional_statement_import',[...principal.auth(),epoch,original[9],statement]);
  assert.deepEqual(await lookup(),value);
  assert.deepEqual(await lookup(owner,randomUUID()),{state:'conflict',reason:'operation'});
  assert.deepEqual(await lookup(owner,owner.epoch,randomUUID()),{state:'conflict',reason:'operation'});
  assert.deepEqual(await lookup(other),{state:'absent'});
  const evaluated=assessDedicatedStatementValues({accountId:account,kind:'bank',active:true,ownershipScope:'dedicated_business'},
   {accountId:account,throughOn:today,signedCents:'150'},{id:original[10],accountId:account,startsOn:yesterday,endsOn:today,
    openingCents:'100',closingCents:'150',fileSha256:value.receipt.fileSha256,providerDateConvention:original[18],
    completenessEvidence:original[19],rows},[],()=>undefined);
  assert.equal(value.receipt.statementDifferenceCents,evaluated.statementDifferenceCents);
  const reordered=[...original];reordered[20]=JSON.stringify([...rows].reverse());
  assert.deepEqual(await call(finance,stage,reordered),value);
  const different=[...original];different[16]='151';
  assert.deepEqual(await call(finance,stage,different),{state:'conflict',reason:'operation'});
  await assert.rejects(call(finance,stage,body()),{message:'STATEMENT_IMPORT_FILE_ALREADY_RETAINED'});
  const wide=await call(finance,stage,body({file:'b'.repeat(64),open:'-9223372036854775808',close:'9223372036854775807',records:[]}));
  assert.equal(wide.receipt.statementDifferenceCents,'18446744073709551615');
  const retained=await admin.query("SELECT delta,entity_id FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='statement_imports' AND operation_id=$2",
   [owner.business,original[9]]);
  assert.deepEqual(retained.rows,[{entity_id:original[10],delta:{schemaVersion:1,before:null,after:value.receipt}}]);
  assert.deepEqual((await admin.query('SELECT id,statement_on::text AS "statementOn",signed_cents::text AS "signedCents" FROM crest.statement_import_rows WHERE statement_id=$1 ORDER BY id',[original[10]])).rows,
   [...rows].sort((first,second)=>first.id.localeCompare(second.id)));
  for(const sql of ['UPDATE crest.statement_imports SET closing_cents=0','DELETE FROM crest.statement_import_rows','TRUNCATE crest.statement_import_rows']){
   await assert.rejects(admin.query(sql),{code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
  }
  const incomplete=await sandbox.connect(url);
  await incomplete.query('BEGIN');
  try{
   const incompleteOperation=randomUUID();
   await incomplete.query(`INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,
    payload_hash,created_by,origin) VALUES($1,$2,$3,'finance.statement.stage',1,$4,$5,$3,'manual')`,
    [owner.business,incompleteOperation,owner.actor,owner.epoch,'c'.repeat(64)]);
   const insertHeader=(file,rowCount,total)=>incomplete.query(`INSERT INTO crest.statement_imports(
    id,business_id,account_id,channel_version_id,starts_on,ends_on,opening_cents,closing_cents,file_sha256,date_convention,
    completeness_evidence,row_count,signed_rows_cents,rows_sha256,operation_id,created_by)
    SELECT gen_random_uuid(),business_id,account_id,channel_version_id,starts_on,ends_on,
     opening_cents,closing_cents,$1,date_convention,completeness_evidence,$2,$3,
     encode(sha256(convert_to('[]','UTF8')),'hex'),$4,created_by
    FROM crest.statement_imports WHERE id=$5`,[file,rowCount,total,incompleteOperation,original[10]]);
   await incomplete.query('SAVEPOINT invalid_rows');
   await insertHeader('c'.repeat(64),1,50);
   await assert.rejects(incomplete.query('SET CONSTRAINTS crest.statement_import_rows_verify IMMEDIATE'),{message:'STATEMENT_IMPORT_ROW_PROOF_REQUIRED'});
   await incomplete.query('ROLLBACK TO SAVEPOINT invalid_rows');
   await insertHeader('d'.repeat(64),0,0);
   await assert.rejects(incomplete.query('SET CONSTRAINTS crest.statement_import_rows_verify IMMEDIATE'),{message:'STATEMENT_IMPORT_HISTORY_PROOF_REQUIRED'});
  }finally{await incomplete.query('ROLLBACK');}
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.financial_events')).rows[0].n,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.money_movements')).rows[0].n,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.journal_lines')).rows[0].n,0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM crest_private.operations WHERE command_type='finance.statement.stage'")).rows[0].n,2);
  await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[owner.business]);
  await assert.rejects(call(finance,stage,original),{message:'RECOVERY_REVIEW_REQUIRED'});
  assert.deepEqual(await lookup(),value);

  const exporter=await sandbox.connect(url);
  await exporter.query('SET ROLE crest_export');
  await assert.rejects(call(exporter,'statement_staging_source_snapshot',[owner.business]),{code:'25001'});
  await assert.rejects(call(finance,'statement_staging_source_snapshot',[owner.business]),{code:'42501'});
  await assert.rejects(exporter.query('SELECT * FROM crest.statement_import_rows'),{code:'42501'});
  const coverage={
   includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
   includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
   includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,
   includeRefundTransferFees:true,includeCollectionFailureRecredits:true,includeCollectionFailureGroupedRecredits:true,
   includeRestoredTips:true,includeOpeningWorksheets:true,
  };
  async function capture(connection){
   await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const collect=statement=>captureFinanceSourceExport(owner.business,async(sql,parameters)=>
     (await connection.query(sql,parameters)).rows,{...coverage,includeStatementStaging:statement});
    await assert.rejects(collect(false),/REQUIRED/);
    assert.deepEqual((await call(connection,'statement_staging_source_snapshot',[other.business])).batches,[]);
    const archive=(await collect(true)).forServer();
    const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
    assert.equal(verified.profile,'crest.posted-finance-source.v19');
    assert.equal(verified.balancedJournalEntries,0);
    return archive;
   }finally{await connection.query('ROLLBACK');}
  }
  const archive=await capture(exporter);
  const statement=JSON.parse(archive.files.find(file=>file.name===statementStagingFile).content);
  assert.equal(statement.batches.length,2);
  const batch=statement.batches.find(entry=>entry.id===original[10]);
  assert.equal(batch.rowsSha256,rowsSha256);
  assert.deepEqual(JSON.parse(batch.rows),[...rows].sort((first,second)=>first.id.localeCompare(second.id)));
  const neutral=await sandbox.connect(await sandbox.database());
  await neutral.query(`CREATE TABLE statement_batches(id uuid PRIMARY KEY,bank_account uuid NOT NULL,starts_on date NOT NULL,ends_on date NOT NULL,
   opening bigint NOT NULL,closing bigint NOT NULL,declared_count integer NOT NULL,row_digest text NOT NULL);
   CREATE TABLE statement_rows(batch_id uuid NOT NULL REFERENCES statement_batches(id),id uuid NOT NULL,
   statement_on date NOT NULL,signed_cents bigint NOT NULL,PRIMARY KEY(batch_id,id))`);
  for(const entry of statement.batches){
   await neutral.query('INSERT INTO statement_batches VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [entry.id,entry.accountId,entry.startsOn,entry.endsOn,entry.openingCents,entry.closingCents,entry.rowCount,entry.rowsSha256]);
   for(const row of JSON.parse(entry.rows))await neutral.query('INSERT INTO statement_rows VALUES ($1,$2,$3,$4)',
    [entry.id,row.id,row.statementOn,row.signedCents]);
  }
  const {rows:imported}=await neutral.query(`SELECT b.id,count(r.id)::int AS rows,
   coalesce(sum(r.signed_cents),0)::text AS signed_rows,
   (b.closing::numeric-b.opening-coalesce(sum(r.signed_cents),0))::text AS difference,
   encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',to_char(r.statement_on,'YYYY-MM-DD'),
    'signedCents',r.signed_cents::text) ORDER BY r.id) FILTER(WHERE r.id IS NOT NULL),'[]'::jsonb)::text,'UTF8')),'hex') AS digest
   FROM statement_batches b LEFT JOIN statement_rows r ON r.batch_id=b.id GROUP BY b.id ORDER BY b.id`);
  assert.deepEqual(imported,statement.batches.map(entry=>({id:entry.id,rows:entry.rowCount,signed_rows:entry.signedRowsCents,
   difference:entry.statementDifferenceCents,digest:entry.rowsSha256})));
  assert.throws(()=>verifyFinanceSourceExport(archive.manifest,archive.files.filter(file=>file.name!==statementStagingFile),owner.business));
  const manifest=JSON.parse(archive.manifest);
  const tampered=archive.files.map(file=>{
   if(file.name!==statementStagingFile)return file;
   const changed=structuredClone(statement);
   changed.batches.find(entry=>entry.id===batch.id).completenessEvidence='Altered review evidence';
   const content=JSON.stringify(changed)+'\n',listed=manifest.files.find(entry=>entry.name===file.name);
   listed.bytes=Buffer.byteLength(content);
   listed.sha256=createHash('sha256').update(content).digest('hex');
   return {...file,content};
  });
  assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),tampered,owner.business),/STATEMENT_STAGING_SOURCE_REVIEW_REQUIRED/);

  const workspace=await privateWorkspace();
  let destination,restored;
  try{
   const point=join(workspace,'point'),keys=await keyPair(workspace);
   await mkdir(point,{mode:0o700});
   const {manifest:sealed}=await backupStatementStagingDatabase(admin,url,point,keys.recipient);
   assert.equal(sealed.schemaVersion,103);
   destination=await recoveryCluster();
   const restoredUrl=await destination.database();
   assert.notEqual(new URL(restoredUrl).port,new URL(url).port);
   assert.deepEqual(await restoreStatementStagingDatabase(point,keys.path,restoredUrl),sealed);
   restored=await connect(restoredUrl);
   assert.deepEqual(await inventory(restored),sealed.rows);
   await restored.query('SET ROLE crest_export');
   assert.deepEqual((await capture(restored)).files,archive.files);
   await restored.query('SET ROLE crest_finance_preview');
   assert.deepEqual(await call(restored,'lookup_fictional_statement_import',[...owner.auth(),owner.epoch,original[9],original[10]]),value);
  }finally{
   try{await restored?.end();}finally{
    try{await destination?.close();}finally{
     assert.equal(await realpath(workspace),workspace);
     await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
   }
  }
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
