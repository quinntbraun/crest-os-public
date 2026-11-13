import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { financeInvoiceCredit84Candidate } from '../support/finance-invoice-credit84-candidate.mjs';
import { backupInvoiceCredit84CandidateDatabase, backupHeldTip83ForCreditBaseline, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreInvoiceCredit84CandidateDatabase, restoreHeldTip83ForCreditBaseline } from '../support/recovery-drill.mjs';
import { creditRangeComponents } from '../../src/bookkeeping/credit-ranges.ts';
import { calculateInvoiceCreditReview, invoiceCreditMatchesInput, invoiceCreditRefusal, parseInvoiceCreditInput, parseInvoiceCreditOptions, parseInvoiceCreditReference,
  parseInvoiceCreditResult } from '../../src/bookkeeping/invoice-credit-contract.ts';
import { captureFinanceSourceExport } from '../../src/bookkeeping/finance-source-export.ts';
import { captureInvoiceCreditSource } from '../../src/bookkeeping/invoice-credit-source.ts';
import { parseFictionalJournalV5, parseFictionalTrialBalanceV5 } from '../../src/bookkeeping/posted-report-v5-contract.ts';
import { verifyFinanceSourceExport } from '../../src/tooling/verify-finance-source-export.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';
import { exerciseNeutralFinanceImport } from '../support/neutral-finance-import.mjs';
import { createPostedFinanceSourceCollector } from '../../src/security/business-foundation-collector.ts';

async function command(connection, name, values) {
  const args=values.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values) {
  const result=await command(connection,name,values);
  assert.equal(result.state,'committed',JSON.stringify(result));
  return result.receipt;
}

async function issueInvoice({admin,web,finance,owner,service,today,setup=true,appointmentDay='2026-11-03'}) {
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
  const booking=confirmedBookingRequest(owner);
  const mode=await admin.query('SELECT max(sequence)::text AS sequence FROM crest.fulfillment_mode_versions WHERE business_id=$1',
    [owner.business]);
  booking.expectedModeSequence=mode.rows[0].sequence??'0';
  const appointment=booking.payload.appointment;
  for(const key of ['start_at','end_at','local_start','local_end']){
    appointment[key]=appointmentDay+appointment[key].slice(10);
  }
  await committed(web,'book_job',[...owner.auth(),owner.epoch,booking.operationId,1,booking.jobId,booking.expectedModeSequence,booking.payload]);
  const arrived=await committed(web,'change_field_session',[...mutate(),1,booking.jobId,'1',{action:'direct_arrive',reason:'Fictional arrival'}]);
  const {assignments}=await command(web,'read_job_completion_context',[...owner.auth(),booking.jobId]);
  const scope=assignments.map(row=>({assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,
    pieces:[{partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,grossInclusiveCents:row.grossInclusiveCents,
      discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null}]}));
  await committed(web,'complete_job',[...mutate(),1,booking.jobId,arrived.jobVersion,{scope,reason:'Fictional completed work',
    walkthrough:{state:'done',reason:null},review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],
      expectedCustomerVersion:'1',contactReviewReason:null}}]);
  const draft=randomUUID();
  const {lines}=await command(finance,'read_invoice_preparation',[...owner.auth(),booking.jobId]);
  await committed(finance,'save_invoice_draft',[...mutate(),draft,'0',booking.jobId,null,lines.map(line=>line.outcomeId),null]);
  const district='Fictional credit district';
  if(setup){
    await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'service',service,'0','2026-01-01',
      'inclusive_single','0.1','Fictional source evidence','Fictional review']);
    for(const identity of [
      {code:'1100',accountType:'asset',normalSide:'debit',controlKind:'ar',reportRole:'ar'},
      {code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'service_revenue'},
      {code:'4900',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'contra_revenue'},
    ]){
      const id=randomUUID();
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
      await committed(finance,'approve_fixed_finance_mapping',[...mutate(),identity.code==='4900'?'discount':identity.reportRole,'0',id,'2026-01-01','Fictional mapping review']);
    }
    const tax=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,tax,'0',{
      identity:{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'},
      name:'Fictional original tax',active:true,reason:null,
    }]);
    await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tax,'2026-01-01','Fictional original tax mapping']);
    await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'invoice_series',label:'TEST-REPORT',reason:'Fictional numbering'}]);
  }
  const selection=Object.fromEntries(lines.map(line=>[line.outcomeId,district]));
  const {reviewDigest}=await command(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'1',selection]);
  const invoice=await committed(finance,'issue_reviewed_invoice',[...mutate(),draft,'1',selection,reviewDigest]);
  assert.equal(invoice.issuedOn,today);
  const {rows:[{account_id:ar}]}=await admin.query('SELECT account_id FROM crest.receivable_items WHERE business_id=$1 AND id=$2',
    [owner.business,invoice.receivableId]);
  return {invoice,ar};
}

async function captureExport(connection,businessId) {
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const query=async(sql,args)=>(await connection.query(sql,args)).rows;
    const credit=await captureInvoiceCreditSource(businessId,query);
    const combined=(await captureFinanceSourceExport(businessId,query,{
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
    })).forServer();
    return {credit,combined};
  } finally {await connection.query('ROLLBACK');}
}

async function verifyRecovery({candidate,admin,target,owner,captured,saved,retired}) {
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination, restored, exporter, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupHeldTip83ForCreditBaseline(candidate,admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupInvoiceCredit84CandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,84);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.heldInvoiceCreditMigrationSha256,candidate.sha256);
    assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='invoice_credits').rows,
      Number(captured.credit.counts.invoice_credits));
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreHeldTip83ForCreditBaseline(candidate,point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    assert.deepEqual(await restoreInvoiceCredit84CandidateDatabase(candidate,point,keys.path,url),manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    exporter=await connect(url);
    await exporter.query('SET ROLE crest_export');
    const after=await captureExport(exporter,owner.business);
    assert.notEqual(after.credit.snapshotToken,captured.credit.snapshotToken);
    assert.notEqual(after.credit.historySnapshotToken,captured.credit.historySnapshotToken);
    assert.deepEqual(after.credit.rows,captured.credit.rows);
    assert.deepEqual(after.combined.files,captured.combined.files);
    assert.equal(verifyFinanceSourceExport(after.combined.manifest,after.combined.files,owner.business).profile,'crest.posted-finance-source.v5');

    const epoch=randomUUID(), provider=randomUUID(), session=randomUUID(), credential=randomBytes(32);
    await restored.query('BEGIN');
    try {
      await restored.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[owner.business]);
      await restored.query(`UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,incident_id=$3,
        writes_enabled=false,version=version+1 WHERE business_id=$1`,[owner.business,epoch,randomUUID()]);
      await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
      await restored.query('DELETE FROM auth.sessions');
      await restored.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
        [provider,owner.subject]);
      await restored.query(`WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second' AS stamp)
        INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,
          authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
        SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id
        FROM crest_private.actors CROSS JOIN observed WHERE id=$2`,[session,owner.actor,provider,credential,randomBytes(32)]);
      await restored.query('COMMIT');
    } catch(error) {
      await restored.query('ROLLBACK');
      throw error;
    }
    finance=await connect(url);
    await finance.query('SET ROLE crest_finance_preview');
    const old=owner.auth(), fresh=[...old];
    fresh[0]=credential;
    fresh[1]=session;
    fresh[5]=provider;
    const {receipt}=saved;
    const lookup=(auth,result)=>command(finance,'lookup_fictional_invoice_credit',[
      ...auth,owner.epoch,result.receipt.operationId,result.receipt.invoiceCreditId,
    ]);
    await assert.rejects(lookup(old,saved),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await lookup(fresh,saved),saved);
    assert.deepEqual(await lookup(fresh,retired),retired);
    const balance=await command(finance,'read_fictional_trial_balance_v5',[...fresh,receipt.effectiveOn]);
    assert.equal(balance.controls.customerFundsTie,true);
    assert.equal(balance.controls.taxPayableTie,true);
    const journal=await command(finance,'read_fictional_journal_v5',[...fresh,receipt.effectiveOn,receipt.arAccountId,null,20]);
    assert.equal(journal.rows.find(row=>row.invoiceCreditId===receipt.invoiceCreditId).creditCents,receipt.inclusiveCents);
    const retry=reviewEpoch=>command(finance,'credit_fictional_open_invoice_line',[
      ...fresh,reviewEpoch,receipt.operationId,receipt.invoiceCreditId,receipt.invoiceItemId,receipt.customerId,
      receipt.effectiveOn,receipt.firstCent,receipt.lastCent,receipt.returnsMappingId,receipt.reason,
    ]);
    await assert.rejects(retry(owner.epoch),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retry(epoch),{message:'RECOVERY_REVIEW_REQUIRED'});
  } finally {
    try {await finance?.end();} finally {
      try {await exporter?.end();} finally {
        try {await restored?.end();} finally {
          try {await destination?.close();} finally {
            const actual=await realpath(directory);
            assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
            assert.match(basename(actual),/^case-[a-z0-9]+$/i);
            await rm(actual,{recursive:true,force:true});
          }
        }
      }
    }
  }
}

test('held P07 restores exact original-offset credits, tax and discounts on an independent database', {timeout:180000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox,exportLogin;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(82));
    const web=await sandbox.connect(target), finance=await sandbox.connect(target), peer=await sandbox.connect(target);
    const exporter=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    await exporter.query('SET ROLE crest_export');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const service=randomUUID();
    const owner=await makeOwner(undefined,{paidLineDiscount:{kind:'fixed',cents:'3000'},serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-credit-source',active:true,
        definition:{name:'Fictional service',inclusions:'Interior',exclusions:'',internalGuidance:null,
          rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
      return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
    }});
    const foreign=await makeOwner();
    const {rows:[{today,yesterday}]}=await admin.query(
      "SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today,((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday");
    await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
      SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
    const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
    const bank=randomUUID(), channel=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,bank,'0',{
      identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
      name:'Fictional bank',active:true,reason:null}]);
    await committed(finance,'save_money_channel',[...mutate(),channel,'0',{
      identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'9182'},
      label:'Fictional bank',effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional verified ownership',openingState:'verified_zero',
      openingOn:'2026-01-01',openingCents:'0',openingEvidence:'Fictional opening',active:true,reason:'Fictional review',
    }]);
    await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'accounting_period',startsOn:today,reason:'Fictional opening'}]);
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today});
    const pay=(cents,externalId)=>committed(finance,'record_direct_fictional_receipt',[...mutate(),randomUUID(),owner.customer,channel,
      '1',today,cents,'Fictional settled receipt',null,{namespace:'ledger',id:externalId,rawReference:'Fictional original inflow'},
      {[invoice.receivableId]:cents}]);

    const {rows:items}=await admin.query('SELECT id,total_cents::text,net_cents::text,tax_cents::text,discount_net_cents::text FROM crest.invoice_items WHERE invoice_id=$1 ORDER BY total_cents DESC',[invoice.invoiceId]);
    const [item,free]=items;
    assert.equal(item.total_cents,'22000');
    assert.equal(item.net_cents,'20000');
    assert.equal(item.tax_cents,'2000');
    assert.equal(item.discount_net_cents,'2727');
    assert.equal(free.total_cents,'0');
    const originalTax=(await admin.query('SELECT id,account_id FROM crest.invoice_tax_payable_movements WHERE invoice_item_id=$1',[item.id])).rows[0];
    const originalDiscount=(await admin.query("SELECT account_id,fixed_mapping_id FROM crest.journal_lines WHERE invoice_item_id=$1 AND purpose='discount'",[item.id])).rows[0];
    const returns=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,returns,'0',{
      identity:{code:'4910',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'contra_revenue'},
      name:'Fictional returns',active:true,reason:null,
    }]);
    const returnsArgs=mutate();
    const returnsMapping=await committed(finance,'approve_fixed_finance_mapping',[
      ...returnsArgs,'returns','0',returns,'2026-01-01','Fictional returns mapping',
    ]);
    const beforeSource=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
        return (await captureFinanceSourceExport(owner.business,query,{
          includeCorrections:true,includeFundApplications:true,
        })).forServer().files;
      } finally {await exporter.query('ROLLBACK');}
    };
    const frozen=await beforeSource();
    const candidate=await financeInvoiceCredit84Candidate(sandbox);
    const adopted=await sandbox.apply(target,candidate.directory);
    assert.equal(adopted.history.length,84);
    assert.equal(adopted.registrySha256,candidate.registrySha256);
    assert.deepEqual(await beforeSource(),frozen);

    const credit=({operation=randomUUID(),id=randomUUID(),itemId=item.id,customer=owner.customer,date=today,
      first='1',last='1100',returnsId=returnsMapping.id,reason='Fictional owner approved concession',epoch=owner.epoch,
      principal=owner,connection=finance}={})=>command(connection,'credit_fictional_open_invoice_line',[
      ...principal.auth(),epoch,operation,id,itemId,customer,date,first,last,returnsId,reason,
    ]);
    const report=(principal=owner,date=today)=>command(finance,'read_fictional_trial_balance_v5',[...principal.auth(),date]);
    const options=({principal=owner,customer=owner.customer,invoiceId=invoice.invoiceId,date=today,connection=finance}={})=>
      command(connection,'read_fictional_invoice_credit_options',[...principal.auth(),customer,invoiceId,date]);
    const lookup=({operation,id,epoch=owner.epoch},principal=owner,connection=finance)=>
      command(connection,'lookup_fictional_invoice_credit',[...principal.auth(),epoch,operation,id]);
    const retire=({operation,id,epoch=owner.epoch},reviewEpoch=owner.epoch,connection=finance,reason='Fictional confirmed absent original credit')=>
      command(connection,'retire_fictional_invoice_credit',[...owner.auth(),reviewEpoch,operation,epoch,id,reason]);
    const balance=(snapshot,id)=>snapshot.rows.find(row=>row.accountId===id).balanceCents;
    const raw=await options({date:null});
    const reviewed=parseInvoiceCreditOptions(raw,owner.business,owner.customer,invoice.invoiceId,today);
    assert.equal(reviewed.effectiveOn,today);
    assert.equal(reviewed.issuedOn,today);
    assert.equal(reviewed.receivableId,invoice.receivableId);
    assert.equal(reviewed.openPeriod,true);
    assert.equal(reviewed.availableBalanceCents,'22000');
    const positiveLine=reviewed.lines.find(line=>line.invoiceItemId===item.id);
    assert.deepEqual(positiveLine.availableRange,{firstCent:'1',lastCent:'22000'});
    assert.equal(positiveLine.maximumStandaloneCents,'22000');
    assert.equal(positiveLine.returnsMappingId,returnsMapping.id);
    assert.equal(reviewed.lines.find(line=>line.invoiceItemId===free.id).availableRange,null);
    assert.deepEqual(await options({customer:foreign.customer}),{state:'absent'});
    assert.deepEqual(await options({principal:foreign,customer:foreign.customer}),{state:'absent'});
    await assert.rejects(options({connection:web}),{code:'42501'});
    await assert.rejects(options({date:yesterday}),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    await assert.rejects(options({date:'9999-01-01'}),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    assert.throws(()=>parseInvoiceCreditOptions({...raw,availableBalanceCents:'21999'},owner.business,owner.customer,invoice.invoiceId,today));
    assert.equal(invoiceCreditRefusal('INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED'),'paired_unapplication_required');
    assert.equal(invoiceCreditRefusal('INVOICE_CREDIT_SOURCE_REQUIRED'),null);
    assert.equal(invoiceCreditRefusal('toString'),null);
    assert.equal(invoiceCreditRefusal(new Error('INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED')),null);
    await assert.rejects(credit({connection:web}),{code:'42501'});
    await assert.rejects(credit({epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(credit({principal:foreign,epoch:foreign.epoch}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(credit({customer:foreign.customer}),{message:'INVOICE_CREDIT_ITEM_REQUIRED'});
    await assert.rejects(credit({itemId:randomUUID()}),{message:'INVOICE_CREDIT_ITEM_REQUIRED'});
    await assert.rejects(credit({itemId:free.id}),{message:'INVOICE_CREDIT_ZERO_COMPONENT_REVIEW_REQUIRED'});
    await assert.rejects(credit({date:yesterday}),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    await assert.rejects(credit({first:'0'}),{message:'INVOICE_CREDIT_INPUT_REQUIRED'});
    await assert.rejects(credit({first:'2'}),{message:'INVOICE_CREDIT_RANGE_UNAVAILABLE'});
    await assert.rejects(credit({last:'22001'}),{message:'INVOICE_CREDIT_RANGE_UNAVAILABLE'});
    await assert.rejects(credit({returnsId:randomUUID()}),{message:'INVOICE_CREDIT_BASIS_REQUIRED'});
    const period=(await admin.query('SELECT id,operation_id FROM crest.accounting_periods WHERE business_id=$1',[owner.business])).rows[0];
    const lock=(generation,state,operation)=>admin.query(
      'INSERT INTO crest.accounting_period_locks(business_id,period_id,generation,state,evidence_ref,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [owner.business,period.id,generation,state,'Fictional period evidence',owner.actor,operation]);
    await lock(1,'locked',period.operation_id);
    assert.equal((await options()).openPeriod,false);
    await assert.rejects(credit(),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    await lock(2,'reopened',returnsArgs.at(-1));

    await pay('3000','fictional-partial-receipt');
    const baseline=await report();
    const beforePosting=await beforeSource();
    assert.equal(balance(baseline,ar),'19000');
    assert.equal((await options()).lines.find(line=>line.invoiceItemId===item.id).maximumStandaloneCents,'19000');
    await assert.rejects(credit({last:'19001'}),{message:'INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED'});
    const charge={inclusiveCents:BigInt(item.total_cents),netCents:BigInt(item.net_cents),
      taxCents:BigInt(item.tax_cents),discountCents:BigInt(item.discount_net_cents)};
    const expected=(first,last)=>creditRangeComponents(charge,[{first:BigInt(first),last:BigInt(last)}]);
    const key={operation:randomUUID(),id:randomUUID()};
    assert.deepEqual(await lookup(key),{state:'absent'});
    await assert.rejects(lookup(key,owner,web),{code:'42501'});
    const saved=await credit(key);
    const first=expected('1','1100');
    assert.equal(saved.state,'committed');
    assert.deepEqual(saved.receipt,{schemaVersion:1,businessId:owner.business,invoiceCreditId:key.id,operationId:key.operation,
      eventId:saved.receipt.eventId,invoiceId:invoice.invoiceId,invoiceItemId:item.id,receivableId:invoice.receivableId,
      customerId:owner.customer,arAccountId:ar,returnsAccountId:returns,returnsMappingId:returnsMapping.id,
      taxAccountId:originalTax.account_id,originalTaxMovementId:originalTax.id,discountAccountId:originalDiscount.account_id,
      discountMappingId:originalDiscount.fixed_mapping_id,effectiveOn:today,firstCent:'1',lastCent:'1100',
      inclusiveCents:String(first.inclusiveCents),netCents:String(first.netCents),taxCents:String(first.taxCents),
      discountCents:String(first.discountCents),returnsCents:String(first.netCents+first.discountCents),reason:'Fictional owner approved concession'});
    assert.deepEqual(await credit(key),saved);
    assert.deepEqual(await lookup(key),saved);
    assert.deepEqual(await retire(key),saved);
    assert.deepEqual(await lookup({...key,id:randomUUID()}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup({...key,epoch:randomUUID()}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(key,foreign),{state:'absent'});
    assert.deepEqual(await credit({...key,last:'1101'}),{state:'conflict',reason:'operation'});
    const reference=parseInvoiceCreditReference({operationId:key.operation,recoveryEpoch:owner.epoch,invoiceCreditId:key.id});
    const input=parseInvoiceCreditInput({reference,invoiceItemId:item.id,customerId:owner.customer,effectiveOn:today,
      firstCent:'1',lastCent:'1100',returnsMappingId:returnsMapping.id,reason:saved.receipt.reason});
    const parsed=parseInvoiceCreditResult(saved,owner.business,reference);
    assert(invoiceCreditMatchesInput(parsed,input));
    assert(!invoiceCreditMatchesInput(parsed,{...input,lastCent:'1101'}));
    assert.throws(()=>parseInvoiceCreditResult({...saved,receipt:{...saved.receipt,taxCents:'101'}},owner.business,reference));
    assert.deepEqual(calculateInvoiceCreditReview({inclusiveCents:item.total_cents,netCents:item.net_cents,taxCents:item.tax_cents,
      discountCents:item.discount_net_cents},'1','1100'),{inclusiveCents:saved.receipt.inclusiveCents,netCents:saved.receipt.netCents,
      taxCents:saved.receipt.taxCents,discountCents:saved.receipt.discountCents,returnsCents:saved.receipt.returnsCents});
    const after=await report();
    assert.equal(parseFictionalTrialBalanceV5(after,owner.business,today).schemaVersion,5);
    assert.deepEqual(after.coverage.templates,['P01','P02','P03','P04','P05','P06','P07','P12']);
    assert.equal(after.coverage.complete,false);
    assert.deepEqual(after.controls,{ledgerBalanced:true,receivablesTie:true,moneyMovementsTie:true,customerFundsTie:true,taxPayableTie:true});
    assert.equal(balance(after,ar),'17900');
    assert.equal(balance(after,bank),'3000');
    assert.equal(balance(after,originalTax.account_id),'-1900');
    assert.equal(balance(after,returns),saved.receipt.returnsCents);
    assert.equal(balance(after,originalDiscount.account_id),String(BigInt(balance(baseline,originalDiscount.account_id))-first.discountCents));
    assert.equal((await report(foreign)).postedEventCount,'0');
    await assert.rejects(command(finance,'read_fictional_trial_balance_v4',[...owner.auth(),today]),
      {message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});
    const journal=await command(finance,'read_fictional_journal_v5',[...owner.auth(),today,null,null,100]);
    assert.equal(parseFictionalJournalV5(journal,owner.business,today,null,null,100).rows.filter(row=>row.template==='P07').length,4);
    const malformedJournal=structuredClone(journal);
    malformedJournal.rows.find(row=>row.purpose==='credit_tax').code='4910';
    assert.throws(()=>parseFictionalJournalV5(malformedJournal,owner.business,today,null,null,100));
    assert.deepEqual(journal.rows.filter(row=>row.invoiceCreditId===key.id).map(row=>[
      row.purpose,row.accountId,row.debitCents,row.creditCents,
    ]).sort((a,b)=>a[0].localeCompare(b[0])),[
      ['credit_ar',ar,'0','1100'],['credit_discount',originalDiscount.account_id,'0',String(first.discountCents)],
      ['credit_returns',returns,String(first.netCents+first.discountCents),'0'],['credit_tax',originalTax.account_id,'100','0'],
    ]);
    const dataFiles=files=>files.filter(part=>part.name.endsWith('.csv'));
    assert.deepEqual(dataFiles(await beforeSource()),dataFiles(beforePosting));
    const moneyBefore=(await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE business_id=$1',[owner.business])).rows[0].n;
    const consumptionBefore=(await admin.query('SELECT row_to_json(c)::text AS row FROM crest.billing_consumptions c WHERE business_id=$1 ORDER BY id',[owner.business])).rows;
    const race=await Promise.allSettled([
      credit({first:'1101',last:'1150'}),credit({first:'1101',last:'1150',connection:peer}),
    ]);
    assert.equal(race.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(race.find(row=>row.status==='rejected').reason.message,'INVOICE_CREDIT_RANGE_UNAVAILABLE');
    const small=race.find(row=>row.status==='fulfilled').value.receipt;
    assert.equal(small.netCents,String(expected('1101','1150').netCents));
    assert.equal(small.taxCents,String(expected('1101','1150').taxCents));
    const tombstone={operation:randomUUID(),id:randomUUID()};
    await assert.rejects(retire(tombstone,owner.epoch,web),{code:'42501'});
    await assert.rejects(retire(tombstone,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retire(tombstone,owner.epoch,finance,''),{message:'INVOICE_CREDIT_INPUT_REQUIRED'});
    assert.deepEqual(await lookup(tombstone),{state:'absent'});
    const retired=await retire(tombstone);
    assert.deepEqual(retired,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,operationId:tombstone.operation,
      invoiceCreditId:tombstone.id,originalEpoch:owner.epoch,reviewEpoch:owner.epoch,reason:'Fictional confirmed absent original credit'}});
    assert.deepEqual(await lookup(tombstone),retired);
    assert.deepEqual(await retire(tombstone),retired);
    assert.deepEqual(await credit({...tombstone,first:'1151',last:'1151'}),{state:'conflict',reason:'operation'});
    assert.equal(parseInvoiceCreditResult(retired,owner.business,{operationId:tombstone.operation,recoveryEpoch:owner.epoch,
      invoiceCreditId:tombstone.id}).state,'retired');
    const uncertain={operation:randomUUID(),id:randomUUID()};
    const [submitRace,retireRace]=await Promise.all([credit({...uncertain,first:'1151',last:'1151'}),retire(uncertain,owner.epoch,peer)]);
    assert(['committed','retired'].includes(retireRace.state));
    if(retireRace.state==='committed')assert.deepEqual(submitRace,retireRace);
    else assert.deepEqual(submitRace,{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(uncertain),retireRace);
    const settle=await credit({first:submitRace.state==='committed'?'1152':'1151',last:'19000'});
    assert.equal(settle.state,'committed');
    assert.equal(balance(await report(),ar),'0');
    const closedLine=(await options()).lines.find(line=>line.invoiceItemId===item.id);
    assert.deepEqual(closedLine.availableRange,{firstCent:'19001',lastCent:'22000'});
    assert.equal(closedLine.maximumStandaloneCents,'0');
    await assert.rejects(credit({first:'19001',last:'22000'}),{message:'INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED'});
    await assert.rejects(pay('1','fictional-now-closed-receivable'),{message:'DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE'});
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE business_id=$1',[owner.business])).rows[0].n,moneyBefore);
    assert.deepEqual((await admin.query('SELECT row_to_json(c)::text AS row FROM crest.billing_consumptions c WHERE business_id=$1 ORDER BY id',[owner.business])).rows,consumptionBefore);
    const audit=(await admin.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='invoice_credits' AND entity_id=$2",
      [owner.business,key.id])).rows[0].delta;
    assert.deepEqual(audit,{schemaVersion:1,before:null,after:saved.receipt});
    const closure=await committed(finance,'approve_fixed_finance_mapping',[
      ...mutate(),'returns','1',null,today,'Fictional closure after original credit',
    ]);
    assert.equal(closure.accountId,null);
    assert.deepEqual(await lookup(key),saved);
    await assert.rejects(command(finance,'invoice_credit_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(exporter,'invoice_credit_source_snapshot_context',[owner.business]),{code:'25001'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let captured,sourceFiles;
    try {
      const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
      captured=await captureInvoiceCreditSource(owner.business,query);
      assert.equal(captured.rows.invoice_credits.length,3+Number(submitRace.state==='committed'));
      assert(Object.values((await captureInvoiceCreditSource(foreign.business,query)).counts).every(count=>count==='0'));
      const combined=(await captureFinanceSourceExport(owner.business,query,{
        includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
      })).forServer();
      sourceFiles=combined.files;
      const manifest=JSON.parse(combined.manifest);
      assert.equal(manifest.sourceTokens.credit,captured.snapshotToken);
      assert.equal(verifyFinanceSourceExport(combined.manifest,combined.files,owner.business).profile,'crest.posted-finance-source.v5');
      const file=name=>combined.files.find(part=>part.name===name).content;
      const dictionary=JSON.parse(file('dictionary.json'));
      const decode=name=>readSourceExportCsv(file(name+'.csv'),JSON.parse(file(name+'_escape_map.json')).escapes,
        {columns:dictionary.tables.find(table=>table.name===name).columns,maxRows:100});
      assert.deepEqual(decode('invoice_credits'),captured.rows.invoice_credits);
      assert(file('operation_history.ndjson').includes(tombstone.operation));
      const name='invoice_credits.csv', csv=file(name), tampered=csv.replace('"1100","1000","100"','"1100","999","101"');
      assert.notEqual(tampered,csv);
      const tamperedFiles=combined.files.map(part=>part.name===name?{...part,content:tampered}:part);
      const changed={...manifest,files:manifest.files.map(part=>part.name===name?{...part,
        bytes:Buffer.byteLength(tampered),sha256:createHash('sha256').update(tampered).digest('hex')}:part)};
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(changed),tamperedFiles,owner.business),
        {message:'INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}
    exportLogin='crest_finance_export_test_'+randomBytes(8).toString('hex');
    const password=randomBytes(24).toString('hex');
    await sandbox.admin.query('CREATE ROLE '+exportLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
    await sandbox.admin.query('GRANT crest_export TO '+exportLogin+' WITH INHERIT FALSE, SET TRUE');
    const restricted=new URL(target);
    restricted.username=exportLogin;restricted.password=password;
    const signal=new AbortController().signal;
    const collector=createPostedFinanceSourceCollector({connectionString:restricted.href,environment:'test',businessId:owner.business});
    const exported=await collector(signal);
    assert.throws(()=>JSON.stringify(exported),{message:'BUSINESS_FOUNDATION_CAPTURE_PRIVATE'});
    assert.deepEqual(exported.forFinanceServer().files,sourceFiles);
    assert.equal(verifyFinanceSourceExport(exported.forFinanceServer().manifest,sourceFiles,owner.business).verified,true);
    await assert.rejects(createPostedFinanceSourceCollector({connectionString:target,environment:'test',businessId:owner.business})(signal),
      {message:'BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED'});
    await assert.rejects(collector(AbortSignal.abort()),{message:'BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED'});
    const neutral=await sandbox.connect(await sandbox.database());
    try{
      const rebuilt=await exerciseNeutralFinanceImport(neutral,sourceFiles,owner.business,{includeCredits:true});
      assert.equal(rebuilt.tables,28);
      assert(rebuilt.entries>0&&rebuilt.sourceRows>rebuilt.entries);
      assert.equal(rebuilt.debit,rebuilt.credit);
    }finally{await neutral.end();}
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(command(exporter,'invoice_credit_source_snapshot_page',[
        owner.business,captured.snapshotToken,'invoice_credits',null,20,
      ]),{message:'CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}
    await verifyRecovery({candidate,admin,target,owner,captured:await captureExport(exporter,owner.business),saved,retired});
    await assert.rejects(admin.query('DELETE FROM crest.invoice_credits WHERE id=$1',[key.id]),{code:'55000'});
    await assert.rejects(web.query('SELECT * FROM crest.invoice_credits'),{code:'42501'});
  } finally {
    try {
      try {if(exportLogin)await sandbox.admin.query('DROP ROLE IF EXISTS '+exportLogin);}
      finally {await sandbox?.close();}
    }finally {await cluster.close();}
  }
});
