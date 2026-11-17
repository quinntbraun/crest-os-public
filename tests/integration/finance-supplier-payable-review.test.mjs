import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {validateImage} from '../../src/files/image-validation.ts';
import {createValidatedFileIntake} from '../../src/files/validated-file-intake.ts';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {createSupplierBillOriginalWorkflow} from '../../src/bookkeeping/expenses/supplier-bill-original-workflow.ts';
import {parseFictionalJournalV16,parseFictionalTrialBalanceV11} from '../../src/bookkeeping/supplier-payable-report-contract.ts';
import {parseRecordedIncomeStatementV2} from '../../src/bookkeeping/recorded-income-statement.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {supplierPayableFile} from '../../src/bookkeeping/expenses/supplier-payable-source.ts';
import {formatSupplierPayableRegister} from '../../src/bookkeeping/expenses/supplier-payable-register.ts';
import {parseSupplierPayableReview,parseSupplierPayableReviewRequest} from '../../src/bookkeeping/expenses/supplier-payable-review-contract.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,connect,keyPair,normalizedSchema,postgresTool,recoveryCluster,restoreDatabase} from '../support/recovery-drill.mjs';
import {decryptor,encryptor,objectDirectory} from '../support/object-recovery-drill.mjs';

async function call(connection,name,values){
 const input=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+input+') AS result',values)).rows[0].result;
}
async function committed(connection,name,values){
 const result=await call(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('held supplier accounting verifies originals, accrues once, and settles exact outstanding cents',{timeout:180000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const url=await sandbox.database(),admin=await sandbox.connect(url);
  await sandbox.apply(url,await sandbox.prefix(0),true);
  await installProviderSchema(admin,url);
  const beforeContactMigration=await sandbox.apply(url,await sandbox.prefix(109));
  assert.equal(beforeContactMigration.history.length,109);
  const finance=await sandbox.connect(url),parallelFinance=await sandbox.connect(url),web=await sandbox.connect(url),worker=await sandbox.connect(url);
  await finance.query('SET ROLE crest_finance_preview');
  await parallelFinance.query('SET ROLE crest_finance_preview');
  await web.query('SET ROLE crest_web');
  await worker.query('SET ROLE crest_supplier_bill_document_worker');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),other=await makeOwner();
  for(const principal of [owner,other])await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);
  const {rows:[{today,yesterday,tomorrow,beforeOpen}]}=await admin.query(`SELECT current_date::text AS today,
   (current_date-1)::text AS yesterday,(current_date+1)::text AS tomorrow,(current_date-2)::text AS "beforeOpen"`);
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
  const bill=randomUUID(),reference='Fictional original invoice 17',reason='Fictional document and cost review';
  const originalBytes=await sharp({create:{width:80,height:60,channels:3,background:'#6b5340'}}).png().toBuffer();
  const hash=createHash('sha256').update(originalBytes).digest('hex');
  const payload={incurredOn:yesterday,dueOn:tomorrow,unknownDueReason:null,vendor:'Fictional supplier',unknownVendorReason:null,
   documentReference:reference,grossCents:'15025',purchaseTaxCents:'525',purpose:'Fictional supplies and fuel',
   missingReceiptReason:'Original file held for the fictional custody fixture',
   splits:[{category:'supplies',grossCents:'10025'},{category:'fuel',grossCents:'5000'}],changeReason:null};
  const save=(record,revision,data)=>committed(finance,'save_fictional_supplier_bill_draft',[...mutate(),record,revision,data]);
  const makeReview=({record=bill,revision='1',treatment='verified_nonrecoverable',document=reference,digest=hash,
   principal=owner,connection=finance}={})=>call(connection,'review_fictional_supplier_payable',
    [...principal.auth(),record,revision,document,digest,treatment,reason]);
  const appReview=({record=bill,revision='1',originalId=null,principal=owner,connection=finance}={})=>
   call(connection,'review_fictional_supplier_payable_from_original',[
    ...principal.auth(),record,revision,originalId,'verified_nonrecoverable',reason]);
  await save(bill,'0',payload);
  assert.deepEqual(await appReview(),{state:'original_required'});
  assert.deepEqual(await appReview({principal:other}),{state:'stale'});
  assert.deepEqual(await appReview({revision:'2'}),{state:'stale'});
  await assert.rejects(appReview({connection:web}),{code:'42501'});
  await assert.rejects(makeReview({connection:web}),{code:'42501'});
  await assert.rejects(makeReview({principal:other}),{message:'SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED'});
  await assert.rejects(makeReview({document:'Different reference'}),{message:'SUPPLIER_PAYABLE_DOCUMENT_REVIEW_REQUIRED'});
  await assert.rejects(makeReview({digest:'invalid'}),{message:'SUPPLIER_PAYABLE_REVIEW_INPUT_REQUIRED'});
  await assert.rejects(makeReview({treatment:'none'}),{message:'SUPPLIER_PAYABLE_PURCHASE_TAX_REVIEW_REQUIRED'});
  await assert.rejects(makeReview(),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
  await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'accounting_period',startsOn:yesterday,reason:'Fictional current period'}]);
  await assert.rejects(makeReview(),{message:'SUPPLIER_PAYABLE_CONTROL_MAPPING_REQUIRED'});

  const mapping=async(code,type,control,purpose)=>{
   const accountId=randomUUID();
   await committed(finance,'save_finance_account',[...mutate(),1,accountId,'0',
    {identity:{code,accountType:type,normalSide:type==='liability'?'credit':'debit',controlKind:control,
     reportRole:control??'expense'},name:'Fictional '+purpose,active:true,reason:null}]);
   const receipt=await committed(finance,'approve_fixed_finance_mapping',
    [...mutate(),purpose,'0',accountId,yesterday,'Fictional reviewed mapping']);
   return {accountId,mappingId:receipt.id};
  };
  const payable=await mapping('2200','liability','payable','payable');
  const supplies=await mapping('5000','expense',null,'category_supplies');
  await assert.rejects(makeReview(),{message:'SUPPLIER_PAYABLE_ORDINARY_COST_MAPPING_REQUIRED'});
  const fuel=await mapping('5210','expense',null,'category_fuel');
  const preview=await makeReview();
  assert.deepEqual([preview.state,preview.template,preview.totalDebitCents,preview.totalCreditCents,preview.approvalRequiresOriginal],
   ['entry_preview','P14','15025','15025',true]);
  assert.deepEqual(preview.lines,[
   {category:'fuel',...fuel,debitCents:'5000',creditCents:'0'},
   {category:'supplies',...supplies,debitCents:'10025',creditCents:'0'},
   {category:null,...payable,debitCents:'0',creditCents:'15025'},
  ]);
  assert.deepEqual(preview,await makeReview());
  assert.match(preview.planSha256,/^[a-f0-9]{64}$/);
  const accrual=randomUUID(),original=randomUUID(),operation=randomUUID(),reserveOperation=randomUUID(),publishOperation=randomUUID();
  const reserveArgs=[...owner.auth(),owner.epoch,reserveOperation,original,bill,'1','image/png',originalBytes.length];
  const reserve=connection=>call(connection,'reserve_fictional_supplier_original',reserveArgs);
  await assert.rejects(reserve(web),{code:'42501'});
  await assert.rejects(reserve(worker),{code:'42501'});
  const reserved=await reserve(finance);
  assert.equal(reserved.state,'committed');
  assert.deepEqual(await reserve(finance),reserved);
  await assert.rejects(admin.query(`INSERT INTO crest.supplier_bill_original_intents(id,business_id,bill_id,bill_revision,
   document_reference,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,created_by)
   VALUES($1,$2,$3,1,$4,$5,'image/png',$6,$7,$8,$9)`,
   [randomUUID(),owner.business,bill,reference,owner.epoch,originalBytes.length,randomUUID(),reserveOperation,owner.actor]),
   {message:'SUPPLIER_ORIGINAL_HISTORY_REQUIRED'});
  const {reservation}=reserved.receipt;
  const readOriginal=(connection=finance,principal=owner)=>call(connection,'read_fictional_supplier_original',[...principal.auth(),original]);
  const authorizeWrite=(connection=finance,principal=owner)=>call(connection,'authorize_fictional_supplier_original_write',[
   ...principal.auth(),principal.epoch,original]);
  assert.deepEqual(await readOriginal(worker),{state:'ready',schemaVersion:1,reservation,candidate:null});
  assert.deepEqual(await readOriginal(finance,other),{state:'absent'});
  assert.deepEqual(await authorizeWrite(worker),{state:'ready',schemaVersion:1,reservation});
  await assert.rejects(authorizeWrite(finance,other),{message:'SUPPLIER_ORIGINAL_RESERVATION_REQUIRED'});
  await assert.rejects(readOriginal(web),{code:'42501'});
  const files=new Map([[reservation.stagingKey,originalBytes]]);
  const write=async({key,bytes,sha256})=>{
   assert(!files.has(key));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);
   files.set(key,Buffer.from(bytes));
   return {key,byteSize:bytes.length,sha256};
  };
  const intakeStore={async readStaging(key,length){
   const bytes=files.get(key);
   assert.equal(bytes?.length,length);
   return {bytes,byteSize:length,sha256:hash};
  },writeOriginalCandidate:write,writePreviewCandidate:write};
  const validator={validate:validateImage};
  const intake=createValidatedFileIntake(intakeStore,validator);
  const ownerCredential='fictional supplier workflow session';
  const authorize=(credential,businessId)=>{
   assert.equal(credential,ownerCredential);
   assert.equal(businessId,owner.business);
  };
  const originals=createSupplierBillOriginalWorkflow({
   async read(credential,businessId,originalId){
    authorize(credential,businessId);
    return call(worker,'read_fictional_supplier_original',[...owner.auth(),originalId]);
   },
   async authorizeWrite(credential,businessId,epoch,originalId){
    authorize(credential,businessId);
    return call(worker,'authorize_fictional_supplier_original_write',[...owner.auth(),epoch,originalId]);
   },
   async publish(credential,reference,metadata){
    authorize(credential,reference.businessId);
    return call(worker,'publish_fictional_supplier_original',[
     ...owner.auth(),reference.recoveryEpoch,reference.operationId,reference.originalId,reference.billId,reference.billRevision,metadata]);
   },
  },{
   intakeStore,
   async issueReservedUpload(input){return {forUpload:()=>({key:input.stagingKey})};},
   async readAvailable(_binding,metadata,variant){
    const object=metadata[variant],bytes=files.get(object.key);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),object.sha256);
    return {forResponse:()=>Buffer.from(bytes)};
   },
  },validator);
  const candidate=await intake.prepare({...reservation,attemptId:original,contentType:'image/png'});
  assert.deepEqual(files.get(reservation.originalKey),originalBytes);
  const publish=(connection,verified=candidate)=>call(connection,'publish_fictional_supplier_original',[
   ...owner.auth(),owner.epoch,publishOperation,original,bill,'1',verified]);
  await assert.rejects(publish(finance),{code:'42501'});
  await assert.rejects(publish(worker,{...candidate,original:{...candidate.original,key:reservation.previewKey}}),
   {message:'SUPPLIER_ORIGINAL_VERIFIED_BYTES_REQUIRED'});
  const published=await publish(worker);
  assert.deepEqual(published,{state:'committed',receipt:{schemaVersion:1,originalId:original,billId:bill,billRevision:'1',sha256:hash}});
  assert.deepEqual(await publish(worker),published);
  const appRequest=parseSupplierPayableReviewRequest({billId:bill,revision:'1',originalId:null,taxTreatment:'verified_nonrecoverable',reason});
  const boundReview=parseSupplierPayableReview(await appReview(),owner.business,appRequest);
  assert.equal(boundReview.originalId,original);
  assert.equal(boundReview.plan.sha256,preview.planSha256);
  assert.deepEqual(boundReview.plan.lines,preview.lines);
  assert.deepEqual(await appReview({originalId:randomUUID()}),{state:'original_required'});
  assert.deepEqual(await readOriginal(),{state:'ready',schemaVersion:1,reservation,candidate});
  await assert.rejects(authorizeWrite(worker),{message:'SUPPLIER_ORIGINAL_CURRENT_DOCUMENT_REQUIRED'});
  await assert.rejects(worker.query('SELECT * FROM crest.supplier_bill_originals'),{code:'42501'});
  const stored=await admin.query(`SELECT file_sha256,media_type,candidate FROM crest.supplier_bill_originals
   WHERE business_id=$1 AND id=$2`,[owner.business,original]);
  assert.deepEqual(stored.rows,[{file_sha256:hash,media_type:'image/png',candidate}]);
  const download=await originals.download(ownerCredential,owner.business,original,'original',AbortSignal.timeout(5000));
  assert.equal(download.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),originalBytes);
  const archiveDirectory=join(sandbox.workspace,'supplier-document-recovery');
  const vault=await objectDirectory(join(archiveDirectory,'encrypted'));
  try{
   const restored=await objectDirectory(join(archiveDirectory,'restored'));
   const keys=await keyPair(archiveDirectory);
   const documents=[{...stored.rows[0].candidate.original,retention:'original'},
    {key:candidate.preview.key,byteSize:candidate.preview.byteSize,sha256:candidate.preview.sha256,retention:'derivative'}];
   const sealed=await captureObjectArchive(randomUUID(),documents,{
    async readSource(key,bytes,signal){signal.throwIfAborted();assert.equal(files.get(key)?.length,bytes);return files.get(key);},
    seal:encryptor(keys.recipient),putVault:vault.put,readVault:vault.read,
   });
   const initialPreview=files.get(reservation.previewKey);
   files.clear();
   await restoreObjectArchive(sealed,documents,{
    readVault:vault.read,unseal:decryptor(keys.path),putDestination:restored.put,readDestination:restored.read,
   });
   assert.deepEqual(await restored.read(reservation.originalKey,originalBytes.length,AbortSignal.timeout(5000)),originalBytes);
   assert.deepEqual(await restored.read(reservation.previewKey,initialPreview.length,AbortSignal.timeout(5000)),initialPreview);
   files.set(reservation.originalKey,originalBytes);
   files.set(reservation.previewKey,initialPreview);
  }finally{
   const resolved=await realpath(archiveDirectory);
   assert.equal(dirname(resolved),await realpath(sandbox.workspace));
   await rm(resolved,{recursive:true});
  }
  const priorPeriod=randomUUID();
  await save(priorPeriod,'0',{...payload,incurredOn:beforeOpen});
  await assert.rejects(makeReview({record:priorPeriod}),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
  const noDueDate=randomUUID();
  await save(noDueDate,'0',{...payload,dueOn:null,unknownDueReason:'Fictional supplier has not stated when this is due'});
  await assert.rejects(makeReview({record:noDueDate}),{message:'SUPPLIER_PAYABLE_DUE_DATE_REQUIRED'});
  await save(bill,'1',{...payload,purchaseTaxCents:null,changeReason:'Fictional source tax needs review'});
  await assert.rejects(makeReview(),{message:'SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED'});
  await assert.rejects(makeReview({revision:'2'}),{message:'SUPPLIER_PAYABLE_PURCHASE_TAX_REVIEW_REQUIRED'});
  for(const table of ['atomic_finance_groups','financial_events','journal_entries','journal_lines','money_movements']){
   const {rows:[{count}]}=await admin.query('SELECT count(*)::int AS count FROM crest.'+table+' WHERE business_id=$1',[owner.business]);
   assert.equal(count,0,table);
  }

  await save(bill,'2',{...payload,changeReason:'Fictional verification confirms the included tax'});
  const fresh=await makeReview({revision:'3'});
  const post=({connection=finance,principal=owner,operationId=operation,plan=fresh.planSha256,id=accrual,originalId=original}={})=>
   call(connection,'post_fictional_supplier_payable',[...principal.auth(),principal.epoch,operationId,id,bill,'3',originalId,
    'verified_nonrecoverable',reason,plan,[],null]);
  await assert.rejects(post({connection:web}),{code:'42501'});
  await assert.rejects(post({originalId:randomUUID()}),{message:'SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED'});
  await assert.rejects(finance.query('SELECT * FROM crest.supplier_bill_originals'),{code:'42501'});
  await assert.rejects(post({principal:other}),{message:'SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED'});
  await assert.rejects(post({plan:preview.planSha256}),{message:'SUPPLIER_PAYABLE_REVIEW_CHANGED'});
  const duplicateOperation=randomUUID();
  await finance.query('BEGIN');
  const result=await post();
  const competitorPost=assert.rejects(post({connection:parallelFinance,operationId:duplicateOperation,id:randomUUID()}),
   {message:'SUPPLIER_PAYABLE_ALREADY_POSTED'});
  await finance.query('COMMIT');
  await competitorPost;
  assert.deepEqual(await appReview({revision:'3'}),{state:'posted',payableId:accrual});
  assert.equal(result.state,'committed');
  assert.deepEqual(result.receipt,{schemaVersion:1,businessId:owner.business,payableId:accrual,billId:bill,billRevision:'3',
   originalId:original,operationId:operation,eventId:result.receipt.eventId,grossCents:'15025',reviewSha256:fresh.planSha256,
   duplicatePayableIds:[],distinctReason:null});
  assert.deepEqual(await post(),result);
  assert.deepEqual(await post({plan:preview.planSha256}),{state:'conflict',reason:'operation'});
  const rejected=await admin.query('SELECT 1 FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',
   [owner.business,duplicateOperation]);
  assert.equal(rejected.rowCount,0);
  const journal=await admin.query(`SELECT f.template,f.effective_on::text,l.purpose,l.debit_cents::text,l.credit_cents::text,a.code
   FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
   JOIN crest.financial_events f ON (f.business_id,f.id)=(j.business_id,j.event_id)
   JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
   WHERE f.business_id=$1 ORDER BY a.code`,[owner.business]);
  assert.deepEqual(journal.rows,[
   {template:'P14',effective_on:yesterday,purpose:'supplier_bill_payable',debit_cents:'0',credit_cents:'15025',code:'2200'},
   {template:'P14',effective_on:yesterday,purpose:'supplier_bill_cost',debit_cents:'10025',credit_cents:'0',code:'5000'},
   {template:'P14',effective_on:yesterday,purpose:'supplier_bill_cost',debit_cents:'5000',credit_cents:'0',code:'5210'},
  ]);
  const movement=await admin.query('SELECT 1 FROM crest.money_movements WHERE business_id=$1',[owner.business]);
  assert.equal(movement.rowCount,0);
  await assert.rejects(save(bill,'3',{...payload,changeReason:'Fictional edit attempted after posting'}),
   {message:'SUPPLIER_PAYABLE_DRAFT_IS_POSTED'});
  await assert.rejects(admin.query('INSERT INTO crest.money_movements(business_id,event_id,signed_cents) VALUES($1,$2,-1)',
   [owner.business,result.receipt.eventId]),{message:'SUPPLIER_PAYABLE_CASH_NOT_ALLOWED'});
  await assert.rejects(admin.query('UPDATE crest.supplier_payables SET gross_cents=1 WHERE id=$1',[accrual]),
   {message:'CREST_RETAINED_COMMAND_HISTORY'});

  const secondBill=randomUUID(),secondOriginal=randomUUID(),secondPayable=randomUUID(),secondOperation=randomUUID();
  await save(secondBill,'0',{...payload,vendor:'Fictional Supplier'});
  const secondReservation=(await committed(finance,'reserve_fictional_supplier_original',
   [...mutate(),secondOriginal,secondBill,'1','image/png',originalBytes.length])).reservation;
  const upload=await originals.upload(ownerCredential,owner.business,secondOriginal,AbortSignal.timeout(5000));
  assert.deepEqual(upload.forUpload(),{key:secondReservation.stagingKey});
  files.set(upload.forUpload().key,originalBytes);
  const secondPublication=randomUUID();
  const processOriginal=()=>originals.prepareAndPublish(ownerCredential,owner.business,secondOriginal,secondPublication,AbortSignal.timeout(5000));
  const secondPublished=await processOriginal();
  assert.equal(secondPublished.candidate.original.sha256,hash);
  assert.deepEqual(await processOriginal(),secondPublished);
  const duplicateArgs=[...owner.auth(),secondBill,'1',secondOriginal];
  await assert.rejects(call(web,'read_fictional_supplier_payable_duplicates',duplicateArgs),{code:'42501'});
  const duplicates=await call(finance,'read_fictional_supplier_payable_duplicates',duplicateArgs);
  assert.deepEqual(duplicates,{state:'ready',schemaVersion:1,candidates:[{payableId:accrual,billId:bill,
   incurredOn:yesterday,grossCents:'15025',sameDocumentReference:true,sameOriginalSha256:true}]});
  const secondPlan=await makeReview({record:secondBill});
  const accrueDistinct=(reviewed,distinct)=>call(finance,'post_fictional_supplier_payable',[
   ...owner.auth(),owner.epoch,secondOperation,secondPayable,secondBill,'1',secondOriginal,
   'verified_nonrecoverable',reason,secondPlan.planSha256,reviewed,distinct]);
  await assert.rejects(accrueDistinct([],null),{message:'SUPPLIER_PAYABLE_DUPLICATE_REVIEW_REQUIRED'});
  await assert.rejects(accrueDistinct([accrual],null),{message:'SUPPLIER_PAYABLE_POST_INPUT_REQUIRED'});
  const distinctReason='Reviewed separately billable items on the shared fictional supplier statement.';
  const secondResult=await accrueDistinct([accrual],distinctReason);
  assert.equal(secondResult.state,'committed');
  assert.deepEqual(secondResult.receipt.duplicatePayableIds,[accrual]);
  assert.equal(secondResult.receipt.distinctReason,distinctReason);

  const bank=randomUUID(),channel=randomUUID();
  await committed(finance,'save_finance_account',[...mutate(),1,bank,'0',{
   identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
   name:'Fictional dedicated bank',active:true,reason:null,
  }]);
  await committed(finance,'save_money_channel',[...mutate(),channel,'0',{
   identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-supplier-bank',maskedSuffix:'9218'},
   label:'Fictional business bank',effectiveFrom:today,ownershipEvidence:'Fictional verified business ownership',openingState:'verified_zero',
   openingOn:today,openingCents:'0',openingEvidence:'Fictional verified zero',active:true,reason:'Fictional review',
  }]);
  const settlement=randomUUID(),settlementOperation=randomUUID();
  const settle=({connection=finance,principal=owner,operationId=settlementOperation,id=settlement,account=channel,
   actualOn=today,paid='10025',remaining='15025',referenceId='fictional-debit-1',payableId=accrual}={})=>
   call(connection,'settle_fictional_supplier_payable',[...principal.auth(),principal.epoch,operationId,id,payableId,account,'1',
    actualOn,paid,remaining,'statement',referenceId,'Fictional outgoing disbursement evidence','Fictional checked supplier settlement']);
  await assert.rejects(settle({connection:web}),{code:'42501'});
  await assert.rejects(settle({principal:other}),{message:'SUPPLIER_SETTLEMENT_PAYABLE_REQUIRED'});
  await assert.rejects(settle({actualOn:beforeOpen}),{message:'SUPPLIER_SETTLEMENT_ACTUAL_DATE_REQUIRED'});
  await assert.rejects(settle({account:randomUUID()}),{message:'SUPPLIER_SETTLEMENT_VERIFIED_CHANNEL_REQUIRED'});
  const firstPayment=await settle();
  assert.equal(firstPayment.state,'committed');
  assert.deepEqual([firstPayment.receipt.paidCents,firstPayment.receipt.remainingCents,firstPayment.receipt.actualOn],['10025','5000',today]);
  assert.deepEqual(await settle(),firstPayment);
  assert.deepEqual(await call(finance,'lookup_fictional_supplier_payable_operation',
   [...owner.auth(),owner.epoch,settlementOperation,settlement,'settlement']),firstPayment);
  await assert.rejects(settle({operationId:randomUUID(),id:randomUUID(),paid:'5001',remaining:'15025',referenceId:'fictional-too-much'}),
   {message:'SUPPLIER_SETTLEMENT_REMAINING_CHANGED'});
  await assert.rejects(settle({operationId:randomUUID(),id:randomUUID(),paid:'5000',remaining:'5000'}),
   {message:'SUPPLIER_SETTLEMENT_EXTERNAL_ID_ALREADY_RECORDED'});
  await finance.query('BEGIN');
  const secondPayment=await settle({operationId:randomUUID(),id:randomUUID(),paid:'5000',remaining:'5000',referenceId:'fictional-debit-2'});
  const competitorPayment=assert.rejects(settle({connection:parallelFinance,operationId:randomUUID(),id:randomUUID(),
   paid:'1',remaining:'5000',referenceId:'fictional-outdated-partial'}),{message:'SUPPLIER_SETTLEMENT_REMAINING_CHANGED'});
  await finance.query('COMMIT');
  await competitorPayment;
  assert.equal(secondPayment.state,'committed');
  assert.equal(secondPayment.receipt.remainingCents,'0');
  await assert.rejects(settle({operationId:randomUUID(),id:randomUUID(),paid:'1',remaining:'1',referenceId:'fictional-too-late'}),
   {message:'SUPPLIER_SETTLEMENT_REMAINING_CHANGED'});
  const finalLines=(await admin.query(`SELECT f.template,a.code,sum(l.debit_cents)::text AS debit,sum(l.credit_cents)::text AS credit
   FROM crest.financial_events f JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(f.business_id,f.id)
   JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
   JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id) WHERE f.business_id=$1
   GROUP BY f.template,a.code ORDER BY f.template,a.code`,[owner.business])).rows;
  assert.deepEqual(finalLines,[
   {template:'P14',code:'2200',debit:'0',credit:'30050'},
   {template:'P14',code:'5000',debit:'20050',credit:'0'},
   {template:'P14',code:'5210',debit:'10000',credit:'0'},
   {template:'P15',code:'1000',debit:'0',credit:'15025'},
   {template:'P15',code:'2200',debit:'15025',credit:'0'},
  ]);
  const register=(throughOn,cursor=null,principal=owner,connection=finance)=>
   call(connection,'read_fictional_supplier_payables',[...principal.auth(),throughOn,cursor]);
  const beforePayment=await register(yesterday),afterPayment=await register(today);
  assert.deepEqual([beforePayment.outstandingCents,beforePayment.ledgerPayableCents,beforePayment.ledgerAgrees,beforePayment.openCount],
   ['30050','30050',true,2]);
  assert.deepEqual([afterPayment.outstandingCents,afterPayment.ledgerPayableCents,afterPayment.ledgerAgrees,afterPayment.openCount],
   ['15025','15025',true,1]);
  assert.deepEqual(afterPayment.rows.find(row=>row.payableId===accrual),{
   payableId:accrual,billId:bill,vendor:'Fictional supplier',incurredOn:yesterday,dueOn:tomorrow,overdueDays:0,
   grossCents:'15025',paidCents:'15025',remainingCents:'0',
  });
  assert.deepEqual((await register(today,afterPayment.rows[0].payableId)).rows,afterPayment.rows.slice(1));
  assert.deepEqual((await register(today,null,other)).rows,[]);
  await assert.rejects(register(today,null,owner,web),{code:'42501'});
  const registerFiles=formatSupplierPayableRegister([afterPayment],owner.business,today);
  assert.match(registerFiles.csv,/"Fictional supplier"/);
  assert.deepEqual(JSON.parse(registerFiles.metadata).outstandingCents,'15025');
  assert.equal(JSON.parse(registerFiles.metadata).csvSha256,createHash('sha256').update(registerFiles.csv).digest('hex'));
  const literal={...afterPayment,rows:afterPayment.rows.map((row,index)=>index===0?{...row,vendor:'=Fictional supplier'}:row)};
  const escaped=formatSupplierPayableRegister([literal],owner.business,today);
  assert.match(escaped.csv,/"'=Fictional supplier"/);
  assert.deepEqual(JSON.parse(escaped.metadata).vendorEscapes,[afterPayment.rows[0].payableId]);
  assert.throws(()=>formatSupplierPayableRegister([{...afterPayment,rows:afterPayment.rows.slice(1)}],owner.business,today));
  assert.throws(()=>formatSupplierPayableRegister([afterPayment],other.business,today));

  const reportArgs=owner.auth();
  const readTrial=(day,principal=owner,connection=finance)=>call(connection,'read_fictional_trial_balance_v11',[...principal.auth(),day]);
  const postedYesterday=parseFictionalTrialBalanceV11(await readTrial(yesterday),owner.business,yesterday);
  const postedToday=parseFictionalTrialBalanceV11(await readTrial(today),owner.business,today);
  assert.equal(postedToday.controls.supplierPayablesTie,true);
  assert.deepEqual(postedYesterday.rows.filter(row=>row.balanceCents!=='0').map(row=>[row.code,row.balanceCents]),
   [['2200','-30050'],['5000','20050'],['5210','10000']]);
  assert.deepEqual(postedToday.rows.filter(row=>row.balanceCents!=='0').map(row=>[row.code,row.balanceCents]),
   [['1000','-15025'],['2200','-15025'],['5000','20050'],['5210','10000']]);
  assert.equal((await readTrial(today,other)).postedEventCount,'0');
  await assert.rejects(readTrial(today,owner,web),{code:'42501'});
  await assert.rejects(call(finance,'read_fictional_trial_balance_v10',[...reportArgs,today]),
   {message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});

  const readJournal=(day,account=null,cursor=null,limit=40)=>call(finance,'read_fictional_journal_v16',
   [...reportArgs,day,account,cursor,limit]);
  const fullJournal=await readJournal(today);
  const postedJournal=parseFictionalJournalV16(fullJournal,owner.business,today,null,null);
  assert.equal(postedJournal.rows.filter(row=>row.template==='P14').length,6);
  assert.equal(postedJournal.rows.filter(row=>row.template==='P15').length,4);
  assert.deepEqual(postedJournal.rows.filter(row=>row.purpose==='supplier_settlement_money').map(row=>row.supplierMoneyMovementId),
   [firstPayment.receipt.movementId,secondPayment.receipt.movementId]);
  assert(postedJournal.rows.filter(row=>row.template==='P15').every(row=>row.supplierPayableId===accrual&&row.supplierBillId===bill));
  const firstPage=parseFictionalJournalV16(await readJournal(today,null,null,3),owner.business,today,null,null,3);
  assert.equal(firstPage.hasMore,true);
  const secondPage=parseFictionalJournalV16(await readJournal(today,null,firstPage.nextAfterLineId,3),
   owner.business,today,null,firstPage.nextAfterLineId,3);
  assert.deepEqual([...firstPage.rows,...secondPage.rows],postedJournal.rows.slice(0,6));
  const apPage=parseFictionalJournalV16(await readJournal(today,payable.accountId),owner.business,today,payable.accountId,null);
  assert.equal(apPage.rows.at(-1).runningBalanceCents,'-15025');
  const badJournal=structuredClone(fullJournal);
  badJournal.rows.find(row=>row.purpose==='supplier_settlement_money').supplierMoneyMovementId=null;
  assert.throws(()=>parseFictionalJournalV16(badJournal,owner.business,today,null,null));

  const readIncome=async(day)=>parseRecordedIncomeStatementV2(
   await call(finance,'read_fictional_recorded_income_statement_v2',[...reportArgs,day,day]),owner.business,day,day);
  assert.equal((await readIncome(yesterday)).netIncomeCents,'-30050');
  assert.deepEqual(await readIncome(today).then(report=>[report.netIncomeCents,report.rows]),['0',[]]);

  const exporter=await sandbox.connect(url);
  try{
   await exporter.query('SET ROLE crest_export');
   await assert.rejects(call(exporter,'supplier_payable_source_snapshot',[owner.business]),{code:'25001'});
   await assert.rejects(call(web,'supplier_payable_source_snapshot',[owner.business]),{code:'42501'});
   await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   assert((await call(exporter,'supplier_payable_source_snapshot',[other.business])).tables.financial_events.length===0);
   const captureOptions={includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
    includePairedCredits:true,includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,
    includeTipReturns:true,includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,
    includeRefundTransferFees:true,includeCollectionFailureRecredits:true,includeCollectionFailureGroupedRecredits:true,
    includeRestoredTips:true,includeOpeningWorksheets:true,includeStatementStaging:true,includeOpeningReceivables:true,
    includeStatementMatchDrafts:true,includeSupplierBillDrafts:true};
   const query=async(sql,values)=>(await exporter.query(sql,values)).rows;
   await assert.rejects(captureFinanceSourceExport(owner.business,query,captureOptions),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
   const {manifest,files}=(await captureFinanceSourceExport(owner.business,query,{...captureOptions,includeSupplierPayables:true})).forServer();
   const verified=verifyFinanceSourceExport(manifest,files,owner.business);
   assert.equal(verified.profile,'crest.posted-finance-source.v23');
   assert.equal(verified.balancedJournalEntries,4);
   assert.equal(verified.debitCents,'45075');
   const supplierPart=files.find(part=>part.name===supplierPayableFile);
   const source=JSON.parse(supplierPart.content);
   assert.equal(source.tables.supplier_bill_originals.length,2);
   assert.equal(source.tables.supplier_payables.length,2);
   assert.equal(source.tables.supplier_payable_settlements.length,2);
   assert.equal(source.tables.journal_lines.length,10);
   assert.equal(source.tables.money_movements.find(row=>row.id===firstPayment.receipt.movementId).signed_cents,'-10025');
   assert.equal(source.tables.supplier_bill_originals.find(row=>row.id===original).file_sha256,preview.documentSha256);
   const altered=(change)=>{
    const modified=structuredClone(source);
    change(modified.tables);
    const content=JSON.stringify(modified)+'\n',header=JSON.parse(manifest);
    const entry=header.files.find(item=>item.name===supplierPayableFile);
    entry.bytes=Buffer.byteLength(content);
    entry.sha256=createHash('sha256').update(content).digest('hex');
    assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(header),
     files.map(part=>part.name===supplierPayableFile?{...part,content}:part),owner.business));
   };
   altered(tables=>{tables.supplier_payable_settlements[0].remaining_before_cents='15026';});
   altered(tables=>{tables.supplier_bill_originals[0].candidate.original.sha256='0'.repeat(64);});
   altered(tables=>{tables.financial_events.pop();});
   altered(tables=>{tables.money_movements[0].business_id=other.business;});
   const destination=await sandbox.connect(url);
   try{
    for(const [table,rows] of Object.entries(source.tables)){
     // Names have already passed the exact offline verifier.
     await destination.query('CREATE TEMP TABLE imported_'+table+' (LIKE crest.'+table+')');
     const restored=await destination.query('INSERT INTO imported_'+table+
      ' SELECT * FROM jsonb_populate_recordset(NULL::imported_'+table+',$1::jsonb)',[JSON.stringify(rows)]);
     assert.equal(restored.rowCount,rows.length);
    }
    const {rows:[restored]}=await destination.query(`
     SELECT
      (SELECT sum(p.gross_cents)::text FROM imported_supplier_payables p) AS gross,
      (SELECT sum(s.paid_cents)::text FROM imported_supplier_payable_settlements s) AS paid,
      (SELECT sum(l.credit_cents::numeric-l.debit_cents::numeric)::text FROM imported_journal_lines l
       WHERE l.purpose IN('supplier_bill_payable','supplier_settlement_payable')) AS payable,
      (SELECT sum(m.signed_cents)::text FROM imported_money_movements m
       JOIN imported_external_money_evidence e ON (e.business_id,e.id,e.signed_cents)=(m.business_id,m.evidence_id,m.signed_cents)) AS money,
      (SELECT count(*)::int FROM imported_supplier_payables p
       JOIN imported_supplier_bill_originals o ON (o.business_id,o.id,o.bill_id)=(p.business_id,p.original_id,p.bill_id)
       WHERE o.candidate#>>'{original,sha256}'=o.file_sha256) AS verified_originals
    `);
    assert.deepEqual(restored,{gross:'30050',paid:'15025',payable:'15025',money:'-15025',verified_originals:2});
   }finally{await destination.end();}
   await exporter.query('COMMIT');
  }finally{await exporter.end();}


  const financeBeforeQuery=`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crest.supplier_payables p) AS payables,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest.supplier_payable_settlements s) AS settlements,
    (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM crest.journal_lines j) AS journal
  `;
  const financeBefore=await admin.query(financeBeforeQuery);
  const registered=await sandbox.apply(url,await sandbox.prefix(120));
  assert.equal(registered.history.length,120);
  assert.deepEqual(registered.history.slice(0,109),beforeContactMigration.history);
  assert.deepEqual((await admin.query(financeBeforeQuery)).rows,financeBefore.rows);

  const combinedDirectory=join(sandbox.workspace,'registered120-recovery');
  await mkdir(combinedDirectory,{mode:0o700});
  const backupKey=await keyPair(combinedDirectory);
  const archiveVault=await objectDirectory(join(combinedDirectory,'vault'));
  const restoredObjects=await objectDirectory(join(combinedDirectory,'restored-objects'));
  const backupId=randomUUID();
  const expectedObjects=async(snapshot)=>{
   const {rows}=await snapshot.query('SELECT candidate FROM crest.supplier_bill_originals WHERE business_id=$1 ORDER BY id',[owner.business]);
   return rows.flatMap(({candidate:{original,preview}})=>[
    {...original,retention:'original'},
    {key:preview.key,byteSize:preview.byteSize,sha256:preview.sha256,retention:'derivative'},
   ]);
  };
  let originalSnapshot;
  const objectCapture={
   async inventory(snapshot){
    const objects=await expectedObjects(snapshot);
    assert.equal(objects.length,4);
    originalSnapshot=(await snapshot.query('SELECT id,gross_cents::text FROM crest.supplier_payables WHERE business_id=$1 ORDER BY id',
     [owner.business])).rows;
    return objects;
   },
   capture(objects){return captureObjectArchive(backupId,objects,{
    async readSource(key,size,signal){signal.throwIfAborted();const bytes=files.get(key);assert.equal(bytes?.length,size);return bytes;},
    seal:encryptor(backupKey.recipient),putVault:archiveVault.put,readVault:archiveVault.read,
   });},
  };
  const combined=await backupDatabase(admin,url,combinedDirectory,backupKey.recipient,async()=>{},objectCapture);
  assert.equal(combined.manifest.schemaVersion,120);
  const independent=await recoveryCluster();
  let recoveredConnection;
  try{
   const copiedUrl=await independent.database();
   const copied=await restoreDatabase(combinedDirectory,backupKey.path,copiedUrl,async archive=>{
    assert.equal(archive.inventory.length,4);
    await restoreObjectArchive(archive.receipt,archive.inventory,{
     readVault:archiveVault.read,unseal:decryptor(backupKey.path),putDestination:restoredObjects.put,readDestination:restoredObjects.read,
    });
   }).catch(async error=>{
    if(error.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:schema')await Promise.all([[url,'before'],[copiedUrl,'after']]
     .map(async([target,kind])=>writeFile('.local/supplier-120-'+kind+'-schema.sql',normalizedSchema(await postgresTool('pg_dump',target,['--schema-only'])))));
    throw error;
   });
   assert.deepEqual(copied,combined.manifest);
   recoveredConnection=await connect(copiedUrl);
   assert.deepEqual((await recoveredConnection.query('SELECT id,gross_cents::text FROM crest.supplier_payables WHERE business_id=$1 ORDER BY id',
    [owner.business])).rows,originalSnapshot);
   assert.deepEqual(await expectedObjects(recoveredConnection),combined.manifest.objectArchive.inventory);
   for(const object of copied.objectArchive.inventory){
    const actual=await restoredObjects.read(object.key,object.byteSize,AbortSignal.timeout(5000));
    assert.equal(createHash('sha256').update(actual).digest('hex'),object.sha256);
   }
   await recoveredConnection.query('SET ROLE crest_export');
   await recoveredConnection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const copiedSource=await call(recoveredConnection,'supplier_payable_source_snapshot',[owner.business]);
   assert.equal(copiedSource.tables.supplier_payable_settlements.length,2);
   assert.equal(copiedSource.tables.money_movements.length,2);
   await recoveredConnection.query('COMMIT');
  }finally{try{await recoveredConnection?.end();}finally{await independent.close();}}

  await admin.query('BEGIN');
  await admin.query(await readFile('planning/proposals/finance-initial-statement-reconciliation-preview.sql','utf8'));
  await admin.query(await readFile('planning/proposals/finance-initial-statement-reconciliation-approval.sql','utf8'));
  await admin.query('COMMIT');
  const statement=randomUUID(),statementRow=randomUUID();
  await committed(finance,'stage_fictional_statement_import',[...mutate(),statement,channel,'1',today,today,'0','-10025',
   createHash('sha256').update('Fictional one-row statement').digest('hex'),'Bank local settlement date',
   'Fictional complete first statement reviewed',JSON.stringify([{id:statementRow,statementOn:today,signedCents:'-10025'}])]);
  const matchReview=await call(finance,'read_fictional_statement_match_review_v2',[...owner.auth(),statement,today]);
  assert.equal(matchReview.accountId,bank);
  assert.deepEqual(matchReview.movements.map(row=>[row.id,row.signedCents]).sort(),[
   [firstPayment.receipt.movementId,'-10025'],[secondPayment.receipt.movementId,'-5000'],
  ].sort());
  await committed(finance,'save_fictional_statement_match_draft',[...mutate(),statement,'0',JSON.stringify([
   {statementRowId:statementRow,movementId:firstPayment.receipt.movementId,signedCents:'-10025'},
  ]),'Fictional cleared bank debit reviewed',today]);
  const reconciliation=(notes=[],connection=finance,principal=owner,revision='1')=>
   call(connection,'review_fictional_initial_statement_reconciliation',[...principal.auth(),statement,revision,JSON.stringify(notes)]);
  await assert.rejects(reconciliation([],web),{code:'42501'});
  await assert.rejects(reconciliation([],finance,other),{message:'STATEMENT_RECONCILIATION_CURRENT_DRAFT_REQUIRED'});
  await assert.rejects(reconciliation([],finance,owner,'2'),{message:'STATEMENT_RECONCILIATION_CURRENT_DRAFT_REQUIRED'});
  const withoutEvidence=await reconciliation();
  assert.equal(withoutEvidence.readyForApprovalReview,false);
  assert.equal(withoutEvidence.checks.timing_supported,false);
  assert.equal(withoutEvidence.unmatchedRows,0);
  assert.equal(withoutEvidence.bookDifferenceCents,'-5000');
  const note={movementId:secondPayment.receipt.movementId,expectedClearOn:tomorrow,reason:'Fictional withdrawal issued but pending bank clearance.'};
  await assert.rejects(reconciliation([{...note,expectedClearOn:today}]),{message:'STATEMENT_RECONCILIATION_TIMING_DATE_REQUIRED'});
  await assert.rejects(reconciliation([note,note]),{message:'STATEMENT_RECONCILIATION_TIMING_EVIDENCE_REQUIRED'});
  assert.equal((await reconciliation([{...note,movementId:firstPayment.receipt.movementId}])).checks.notes_valid,false);
  const reconciles=await reconciliation([note]);
  assert.equal(reconciles.readyForApprovalReview,true);
  assert(Object.values(reconciles.checks).every(Boolean));
  assert.deepEqual([reconciles.openingCents,reconciles.bookCents,reconciles.closingCents,
   reconciles.supportedOutstandingCents,reconciles.bookDifferenceCents],['0','-15025','-10025','-5000','0']);
  assert.deepEqual(reconciles,await reconciliation([note]));
  assert.notEqual(reconciles.planSha256,withoutEvidence.planSha256);
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.financial_events WHERE business_id=$1',[owner.business])).rows[0].n,4);
  const approvalId=randomUUID(),approvalOperation=randomUUID();
  const approve=({connection=finance,id=approvalId,operationId=approvalOperation,plan=reconciles.planSha256,
   generation='0',notes=[note]}={})=>call(connection,'approve_fictional_initial_statement_reconciliation',[
   ...owner.auth(),owner.epoch,operationId,id,statement,'1',generation,plan,JSON.stringify(notes),'Fictional complete statement approved']);
  const status=(principal=owner,connection=finance)=>call(connection,'read_fictional_initial_statement_reconciliation',[
   ...principal.auth(),statement]);
  assert.deepEqual(await status(),{state:'absent'});
  await assert.rejects(approve({connection:web}),{code:'42501'});
  await assert.rejects(approve({notes:[]}),{message:'STATEMENT_RECONCILIATION_NEEDS_REVIEW'});
  await assert.rejects(approve({plan:'f'.repeat(64)}),{message:'STATEMENT_RECONCILIATION_PLAN_CHANGED'});
  const approval=await approve();
  assert.equal(approval.state,'committed');
  assert.equal(approval.receipt.generation,'1');
  assert.deepEqual(await approve(),approval);
  await assert.rejects(approve({id:randomUUID(),operationId:randomUUID(),generation:'1'}),{message:'STATEMENT_RECONCILIATION_ALREADY_CURRENT'});
  assert.deepEqual(await status(),{state:'current',receipt:approval.receipt,currentPlanSha256:reconciles.planSha256});
  assert.deepEqual(await status(other),{state:'absent'});
  const late=await settle({operationId:randomUUID(),id:randomUUID(),payableId:secondPayable,paid:'100',remaining:'15025',referenceId:'fictional-debit-late'});
  assert.equal(late.state,'committed');
  assert.equal((await status()).state,'needs_review');
  const lateNote={movementId:late.receipt.movementId,expectedClearOn:tomorrow,reason:'Fictional outgoing disbursement awaiting statement clearance.'};
  const revised=await reconciliation([note,lateNote]);
  assert.equal(revised.readyForApprovalReview,true);
  const generationTwo=await approve({id:randomUUID(),operationId:randomUUID(),generation:'1',plan:revised.planSha256,notes:[note,lateNote]});
  assert.equal(generationTwo.receipt.generation,'2');
  assert.deepEqual(await status(),{state:'current',receipt:generationTwo.receipt,currentPlanSha256:revised.planSha256});
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.statement_reconciliation_allocations WHERE business_id=$1',[owner.business])).rows[0].n,2);
  assert.equal((await admin.query('SELECT count(*)::int n FROM crest.financial_events WHERE business_id=$1',[owner.business])).rows[0].n,5);
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
