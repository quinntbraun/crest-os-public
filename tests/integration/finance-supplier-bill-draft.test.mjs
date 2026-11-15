import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,connect,keyPair,normalizedSchema,postgresTool,recoveryCluster,restoreDatabase} from '../support/recovery-drill.mjs';

const save='save_fictional_supplier_bill_draft',lookup='lookup_fictional_supplier_bill_draft';
async function call(connection,name,values){
 const parameters=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+parameters+') AS result',values)).rows[0].result;
}

test('supplier bill drafts retain reviewed cost and due-date evidence with zero liability or cash postings',{timeout:180000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const url=await sandbox.database(),admin=await sandbox.connect(url);
  await sandbox.apply(url,await sandbox.prefix(0),true);
  await installProviderSchema(admin,url);
  assert.equal((await sandbox.apply(url,await sandbox.prefix(107))).history.length,107);
  assert.equal((await sandbox.apply(url)).history.length,108);
  const finance=await sandbox.connect(url),web=await sandbox.connect(url);
  await finance.query('SET ROLE crest_finance_preview');
  await web.query('SET ROLE crest_web');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),other=await makeOwner();
  const {rows:[{today,tomorrow}]}=await admin.query("SELECT current_date::text AS today,(current_date+1)::text AS tomorrow");
  const bill=randomUUID(),operation=randomUUID();
  const body={incurredOn:today,dueOn:tomorrow,unknownDueReason:null,vendor:'Fictional supplies vendor',unknownVendorReason:null,
   documentReference:'Fictional document 17',grossCents:'15025',purchaseTaxCents:'525',purpose:'Fictional workshop supplies',
   missingReceiptReason:'Fictional invoice image still pending',splits:[{category:'supplies',grossCents:'10025'},{category:'other',grossCents:'5000'}],
   changeReason:null};
  const args=(payload=body,{principal=owner,key=randomUUID(),revision='0',epoch=principal.epoch,record=bill}={})=>
   [...principal.auth(),epoch,key,record,revision,payload];
  const find=(principal=owner,epoch=owner.epoch,key=operation,record=bill,version='0')=>
   call(finance,lookup,[...principal.auth(),epoch,key,record,version]);
  const read=async()=> (await admin.query('SELECT revision::text,payload FROM crest.supplier_bill_draft_revisions WHERE business_id=$1 AND bill_id=$2 ORDER BY revision',
   [owner.business,bill])).rows;
  await assert.rejects(call(web,save,args()),{code:'42501'});
  await assert.rejects(finance.query('SELECT * FROM crest.supplier_bill_draft_revisions'),{code:'42501'});
  await assert.rejects(call(finance,save,args(body,{epoch:randomUUID()})),{message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(call(finance,save,args({...body,incurredOn:tomorrow})),{message:'SUPPLIER_BILL_DRAFT_INCURRED_DATE_REQUIRED'});
  for(const changed of [
   {paymentMethod:'bank'},{incurredOn:'2026-02-29'},{dueOn:'2026-11-31'},{dueOn:null},{unknownDueReason:'Contradictory'},
   {vendor:null},{unknownVendorReason:'Contradictory'},{missingReceiptReason:''},{purpose:' '},{changeReason:'Unexpected'},
   {grossCents:'0'},{purchaseTaxCents:'15026'},{purchaseTaxCents:'-1'},{grossCents:'9223372036854775808'},{splits:[]},
   {splits:[{category:'equipment',grossCents:'15025'}]},{splits:[{category:'supplies',grossCents:'15024'}]},
   {splits:[{category:'supplies',grossCents:'10025'},{category:'supplies',grossCents:'5000'}]},
  ])await assert.rejects(call(finance,save,args({...body,...changed})),{message:'SUPPLIER_BILL_DRAFT_INPUT_REQUIRED'});
  const original=args(body,{key:operation});
  const first=await call(finance,save,original);
  assert.equal(first.state,'committed');
  assert.deepEqual(first.receipt.draft.payload,body);
  assert.equal(first.receipt.draft.revision,'1');
  assert.deepEqual(await call(finance,save,original),first);
  assert.deepEqual(await call(finance,save,args({...body,purpose:'Different'},{key:operation})),{state:'conflict',reason:'operation'});
  assert.deepEqual(await find(),first);
  assert.deepEqual(await find(other),{state:'absent'});
  assert.deepEqual(await find(owner,randomUUID()),{state:'conflict',reason:'operation'});
  assert.deepEqual(await find(owner,owner.epoch,operation,randomUUID()),{state:'conflict',reason:'operation'});
  assert.deepEqual(await find(owner,owner.epoch,operation,bill,'1'),{state:'conflict',reason:'operation'});
  const revised={...body,vendor:null,unknownVendorReason:'Fictional vendor name unreadable',dueOn:null,
   unknownDueReason:'Fictional document does not state payment terms',changeReason:'Fictional source was reviewed again',purchaseTaxCents:null};
  const results=await Promise.all([finance,await sandbox.connect(url)].map(async(connection,index)=>{
   if(index)await connection.query('SET ROLE crest_finance_preview');
   return call(connection,save,args(revised,{revision:'1'}));
  }));
  const second=results.find(result=>result.state==='committed');
  assert(second);
  assert.deepEqual(results.filter(result=>result.state==='conflict'),[{state:'conflict',reason:'revision',currentRevision:'2'}]);
  assert.deepEqual(await read(),[{revision:'1',payload:body},{revision:'2',payload:revised}]);
  assert.deepEqual(await find(),first);
  assert.deepEqual(await find(owner,owner.epoch,second.receipt.draft.operationId,bill,'1'),second);
  const review=(record=bill,version='1',principal=owner,connection=finance)=>
   call(connection,'review_fictional_supplier_bill_draft',[...principal.auth(),record,version]);
  await assert.rejects(review(bill,'2',owner,web),{code:'42501'});
  assert.deepEqual(await review(bill,'2',other),{state:'absent'});
  assert.deepEqual(await review(),{state:'conflict',reason:'revision',currentRevision:'2'});
  assert.deepEqual(await review(bill,'2'),{schemaVersion:1,state:'review_required',billId:bill,revision:'2',
   vendorUnknown:true,dueTermsUnknown:true,purchaseTaxAmountUnknown:true,missingDocument:true,sameSupplierDrafts:[],moreSameSupplierDrafts:false});
  const candidateIds=Array.from({length:4},()=>randomUUID());
  for(const [record,payload,principal] of [
   [candidateIds[0],body,owner],
   [candidateIds[1],{...body,grossCents:'15026',splits:[{category:'supplies',grossCents:'15026'}]},owner],
   [candidateIds[2],{...body,documentReference:null},owner],
   [candidateIds[3],body,other],
  ])assert.equal((await call(finance,save,args(payload,{record,principal}))).state,'committed');
  const hints=await review(candidateIds[0]);
  assert.deepEqual(hints,{schemaVersion:1,state:'review_required',billId:candidateIds[0],revision:'1',
   vendorUnknown:false,dueTermsUnknown:false,purchaseTaxAmountUnknown:false,missingDocument:true,moreSameSupplierDrafts:false,
   sameSupplierDrafts:[
    {billId:candidateIds[1],revision:'1',sameDocumentReference:true,sameIncurredDateAndGross:false},
    {billId:candidateIds[2],revision:'1',sameDocumentReference:false,sameIncurredDateAndGross:true},
   ].sort((a,b)=>a.billId.localeCompare(b.billId)),
  });
  assert.equal((await call(finance,save,args({...body,vendor:'Fictional separate supplier',changeReason:'Verified payee changed'},
   {record:candidateIds[2],revision:'1'}))).state,'committed');
  assert.deepEqual((await review(candidateIds[0])).sameSupplierDrafts,[hints.sameSupplierDrafts.find(row=>row.billId===candidateIds[1])]);
  const direct=await sandbox.connect(url);
  await direct.query('BEGIN');
  try{
   const key=randomUUID();
   await direct.query(`INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,
    payload_hash,created_by,origin) VALUES($1,$2,$3,'bookkeeping.supplier_bill.save',1,$4,$5,$3,'manual')`,
    [owner.business,key,owner.actor,owner.epoch,'a'.repeat(64)]);
   await direct.query('INSERT INTO crest.supplier_bill_draft_revisions(business_id,bill_id,revision,operation_id,actor_id,payload) VALUES($1,$2,1,$3,$4,$5)',
    [owner.business,randomUUID(),key,owner.actor,body]);
   await assert.rejects(direct.query('SET CONSTRAINTS crest.supplier_bill_draft_verify IMMEDIATE'),
    {message:'SUPPLIER_BILL_DRAFT_AUDIT_REQUIRED'});
  }finally{await direct.query('ROLLBACK');}
  const audit=await admin.query("SELECT action,delta FROM crest_private.audit_events WHERE entity_kind='supplier_bill_draft_revisions' AND entity_id=$1 ORDER BY entity_version",[bill]);
  assert.deepEqual(audit.rows,[{action:'create',delta:{schemaVersion:1,before:null,after:first.receipt.draft}},
   {action:'revise',delta:{schemaVersion:1,before:first.receipt.draft,after:second.receipt.draft}}]);
  for(const sql of ['UPDATE crest.supplier_bill_draft_revisions SET payload=payload','DELETE FROM crest.supplier_bill_draft_revisions',
   'TRUNCATE crest.supplier_bill_draft_revisions'])await assert.rejects(admin.query(sql),{code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
  for(const table of ['financial_events','journal_lines','money_movements','posted_expenses','expense_revisions']){
   assert.equal((await admin.query('SELECT count(*)::int n FROM crest.'+table)).rows[0].n,0,table);
  }
  await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[owner.business]);
  await assert.rejects(call(finance,save,original),{message:'RECOVERY_REVIEW_REQUIRED'});
  assert.deepEqual(await find(),first);
  assert.equal((await review(candidateIds[0])).state,'review_required');
  const list=(principal=owner,connection=finance,after=null)=>call(connection,'list_fictional_supplier_bill_drafts',[...principal.auth(),after]);
  const retained=await list();
  assert.equal(retained.businessId,owner.business);
  assert.equal(retained.hasMore,false);
  assert.equal(retained.drafts.length,4);
  assert.deepEqual(retained.drafts.find(row=>row.billId===bill),second.receipt.draft);
  assert.deepEqual((await list(owner,finance,retained.drafts[0].billId)).drafts,retained.drafts.slice(1));
  assert.equal((await list(other)).drafts.length,1);
  await assert.rejects(list(owner,web),{code:'42501'});
  const exporter=await sandbox.connect(url);
  await exporter.query('SET ROLE crest_export');
  await assert.rejects(call(exporter,'supplier_bill_draft_source_snapshot',[owner.business]),
   {message:'SUPPLIER_BILL_DRAFT_SNAPSHOT_REQUIRED'});
  await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const exported=await call(exporter,'supplier_bill_draft_source_snapshot',[owner.business]);
   assert.equal(exported.scope,'supplier_bill_draft_source');
   assert.deepEqual(exported.revisions.filter(row=>row.billId===bill),[first.receipt.draft,second.receipt.draft]);
   assert.equal(exported.revisions.length,6);
   assert(exported.revisions.every(row=>row.businessId===owner.business));
  }finally{await exporter.query('ROLLBACK');}
  const point=join(sandbox.workspace,'supplier-draft-recovery');
  await mkdir(point,{mode:0o700});
  const keys=await keyPair(sandbox.workspace),backup=await backupDatabase(admin,url,point,keys.recipient);
  assert.equal(backup.manifest.schemaVersion,108);
  const restoredCluster=await recoveryCluster();
  let restored;
  try{
   const restoredUrl=await restoredCluster.database();
   try{assert.deepEqual(await restoreDatabase(point,keys.path,restoredUrl),backup.manifest);}
   catch(error){
    if(error.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:schema')await Promise.all([[url,'original'],[restoredUrl,'restored']].map(async([target,kind])=>
     writeFile('.local/supplier-draft-'+kind+'-schema.sql',normalizedSchema(await postgresTool('pg_dump',target,['--schema-only'])))));
    throw error;
   }
   restored=await connect(restoredUrl);
   await restored.query('SET ROLE crest_finance_preview');
   assert.deepEqual(await list(owner,restored),retained);
  }finally{try{await restored?.end();}finally{await restoredCluster.close();}}
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
