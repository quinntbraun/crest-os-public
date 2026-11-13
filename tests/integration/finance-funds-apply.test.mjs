import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { financeFundApplication82Candidate } from '../support/finance-fund-application82-candidate.mjs';
import { backupFundApplication82CandidateDatabase, backupLegacy81Database, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreFundApplication82CandidateDatabase, restoreLegacy81Database } from '../support/recovery-drill.mjs';
import { captureInvoiceSource } from '../../src/bookkeeping/invoice-source.ts';
import { captureReceiptSource } from '../../src/bookkeeping/receipt-source.ts';
import { capturePostedExpenseSource } from '../../src/bookkeeping/posted-expense-source.ts';
import { captureUnapplicationSource } from '../../src/bookkeeping/unapplication-source.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {parseFictionalJournalV3,parseFictionalTrialBalanceV3} from '../../src/bookkeeping/posted-report-v3-contract.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import { captureFundApplicationSource, formatFundApplicationSource } from '../../src/bookkeeping/fund-application-source.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';

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
  const district='Fictional report district';
  if(setup){
    await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'service',service,'0','2026-01-01',
      'non_taxable',null,'Fictional source evidence','Fictional review']);
    for(const identity of [
      {code:'1100',accountType:'asset',normalSide:'debit',controlKind:'ar',reportRole:'ar'},
      {code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'service_revenue'},
    ]){
      const id=randomUUID();
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
      await committed(finance,'approve_fixed_finance_mapping',[...mutate(),identity.reportRole,'0',id,'2026-01-01','Fictional mapping review']);
    }
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

async function captureApplication(connection,business) {
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await captureFundApplicationSource(business,async(sql,args)=>(await connection.query(sql,args)).rows);
  } finally {await connection.query('ROLLBACK');}
}

async function verifyRecovery({candidate,admin,target,owner,captured,saved,retired}) {
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination, restored, exporter, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupLegacy81Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupFundApplication82CandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,82);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.heldFundApplicationMigrationSha256,candidate.sha256);
    assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='customer_fund_applications').rows,4);
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreLegacy81Database(point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    assert.deepEqual(await restoreFundApplication82CandidateDatabase(candidate,point,keys.path,url),manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    exporter=await connect(url);
    await exporter.query('SET ROLE crest_export');
    const after=await captureApplication(exporter,owner.business);
    assert.notEqual(after.snapshotToken,captured.snapshotToken);
    assert.notEqual(after.historySnapshotToken,captured.historySnapshotToken);
    assert.deepEqual(after.rows,captured.rows);
    assert.deepEqual(after.references.invoice.rows,captured.references.invoice.rows);
    assert.deepEqual(after.references.unapplication.rows,captured.references.unapplication.rows);
    assert.deepEqual(after.references.unapplication.history,captured.references.unapplication.history);
    const portable=source=>formatFundApplicationSource(source).files.filter(file=>file.name.endsWith('.csv')||file.name.endsWith('.ndjson'));
    assert.deepEqual(portable(after),portable(captured));

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
    const lookup=(auth,result)=>command(finance,'lookup_fictional_customer_fund_application',[
      ...auth,owner.epoch,result.receipt.operationId,result.receipt.fundApplicationId,
    ]);
    await assert.rejects(lookup(old,saved),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await lookup(fresh,saved),saved);
    assert.deepEqual(await lookup(fresh,retired),retired);
    const balance=await command(finance,'read_fictional_trial_balance_v3',[...fresh,receipt.effectiveOn]);
    assert.equal(balance.controls.customerFundsTie,true);
    const journal=await command(finance,'read_fictional_journal_v3',[...fresh,receipt.effectiveOn,receipt.fundsAccountId,null,20]);
    assert.equal(journal.rows.find(row=>row.fundApplicationId===receipt.fundApplicationId).debitCents,receipt.cents);
    const retry=reviewEpoch=>command(finance,'apply_fictional_customer_funds',[
      ...fresh,reviewEpoch,receipt.operationId,receipt.fundApplicationId,receipt.fundLotId,receipt.receivableId,receipt.customerId,
      receipt.effectiveOn,receipt.firstCent,receipt.lastCent,receipt.reason,
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

test('held P04 applies exact funds to issued AR and restores encrypted postings and history on an independent cluster', {timeout:180000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(81));
    const web=await sandbox.connect(target), finance=await sandbox.connect(target), peer=await sandbox.connect(target);
    const exporter=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    await exporter.query('SET ROLE crest_export');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const service=randomUUID();
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-funds-application',active:true,
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
    const bank=randomUUID(), funds=randomUUID(), channel=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,bank,'0',{
      identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
      name:'Fictional bank',active:true,reason:null}]);
    await committed(finance,'save_finance_account',[...mutate(),1,funds,'0',{
      identity:{code:'2000',accountType:'liability',normalSide:'credit',controlKind:'customer_funds',reportRole:'customer_funds'},
      name:'Fictional customer funds',active:true,reason:null}]);
    const mappingArgs=mutate();
    const mapping=await committed(finance,'approve_fixed_finance_mapping',
      [...mappingArgs,'customer_funds','0',funds,'2026-01-01','Fictional funds mapping review']);
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
    const originalPayment=await pay('25000','paid-original');
    const [allocation]=originalPayment.applications;

    const held=await committed(finance,'unapply_fictional_payment_allocation',[
      ...mutate(),randomUUID(),allocation.id,owner.customer,mapping.id,today,'1001','11000','Fictional owner reviewed unapplication',
    ]);
    await pay('5000','paid-part-of-reopened-ar');
    const capture=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
        return {
          invoices:(await captureInvoiceSource(owner.business,async(sql,args)=>(await query(sql,args))[0].result)).rows,
          payments:(await captureReceiptSource(owner.business,query)).rows,
          expenses:(await capturePostedExpenseSource(owner.business,query)).rows,
          unapplication:(await captureUnapplicationSource(owner.business,query)).rows,
        };
      } finally {await exporter.query('ROLLBACK');}
    };
    const reportV2=()=>command(finance,'read_fictional_trial_balance_v2',[...owner.auth(),today]);
    const baseline=await reportV2();
    const candidate=await financeFundApplication82Candidate(sandbox);
    assert((await readFile(join(candidate.directory,'supabase/migrations',candidate.file))).equals(
      await readFile(join(sandbox.root,'supabase/migrations',candidate.file))));
    const migration=await sandbox.apply(target,sandbox.root);
    assert.equal(migration.history.length,82);
    assert.equal(migration.registrySha256,candidate.registrySha256);
    const report=(principal=owner,date=today,connection=finance)=>
      command(connection,'read_fictional_trial_balance_v3',[...principal.auth(),date]);
    const apply=({operation=randomUUID(),id=randomUUID(),lot=held.fundLotId,receivable=invoice.receivableId,customer=owner.customer,
      date=today,first='1001',last='3000',epoch=owner.epoch,connection=finance,principal=owner}={})=>
      command(connection,'apply_fictional_customer_funds',[...principal.auth(),epoch,operation,id,lot,receivable,customer,date,first,last,
        'Fictional owner reviewed application']);
    const period=(await admin.query('SELECT id FROM crest.accounting_periods WHERE business_id=$1 AND $2 BETWEEN starts_on AND through_on',
      [owner.business,today])).rows[0].id;
    const periodRevision=(generation,state,operation)=>admin.query(
      'INSERT INTO crest.accounting_period_locks(business_id,period_id,generation,state,evidence_ref,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [owner.business,period,generation,state,'Fictional '+state+' period',owner.actor,operation]);
    await periodRevision(1,'locked',held.operationId);
    await assert.rejects(apply(),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    await periodRevision(2,'reopened',mappingArgs.at(-1));
    const originalSources=await capture();
    const value=(balance,account)=>balance.rows.find(row=>row.accountId===account).balanceCents;
    assert.equal(baseline.schemaVersion,2);
    assert.equal(value(baseline,ar),'5000');
    assert.equal(value(baseline,funds),'-10000');
    assert.equal(value(baseline,bank),'30000');
    const empty=await report(foreign);
    assert.equal(empty.schemaVersion,3);
    assert.equal(empty.postedEventCount,'0');
    assert.deepEqual(empty.rows,[]);
    assert.equal((await report(owner,yesterday)).postedEventCount,'0');
    await assert.rejects(report(owner,today,web),{code:'42501'});
    await assert.rejects(apply({connection:web}),{code:'42501'});
    await assert.rejects(apply({epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(apply({principal:foreign,epoch:foreign.epoch}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(apply({customer:foreign.customer}),{message:'FUND_APPLICATION_LOT_REQUIRED'});
    await assert.rejects(apply({receivable:randomUUID()}),{message:'FUND_APPLICATION_RECEIVABLE_REQUIRED'});
    await assert.rejects(apply({first:'0'}),{message:'FUND_APPLICATION_INPUT_REQUIRED'});
    await assert.rejects(apply({first:'1000'}),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    await assert.rejects(apply({last:'11001'}),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    await assert.rejects(apply({date:yesterday}),{message:'FUND_APPLICATION_DATE_REQUIRED'});
    await assert.rejects(apply({date:'9999-01-01'}),{message:'FUND_APPLICATION_DATE_REQUIRED'});
    await assert.rejects(apply({last:'6001'}),{message:'FUND_APPLICATION_EXCEEDS_BALANCE'});
    const key={operation:randomUUID(),id:randomUUID()};
    const result=await apply(key);
    assert.equal(result.state,'committed');
    assert.deepEqual(await apply(key),result);
    assert.deepEqual(await apply({...key,last:'2999'}),{state:'conflict',reason:'operation'});
    assert.deepEqual(result.receipt,{
      schemaVersion:1,businessId:owner.business,fundApplicationId:key.id,operationId:key.operation,eventId:result.receipt.eventId,
      fundLotId:held.fundLotId,unapplicationId:held.unapplicationId,fundingOriginId:held.fundingOriginId,parentPartitionId:held.parentPartitionId,
      customerId:owner.customer,receivableId:invoice.receivableId,invoiceId:invoice.invoiceId,arAccountId:ar,fundsAccountId:funds,
      mappingId:mapping.id,effectiveOn:today,firstCent:'1001',lastCent:'3000',cents:'2000',reason:'Fictional owner reviewed application',
    });
    assert.equal((await admin.query('SELECT period_generation::text AS generation FROM crest.financial_events WHERE id=$1',
      [result.receipt.eventId])).rows[0].generation,'2');
    await assert.rejects(apply({first:'3000',last:'4000'}),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    await assert.rejects(apply({id:key.id,first:'3001',last:'4000'}),{message:'FUND_APPLICATION_ALREADY_RECORDED'});
    await assert.rejects(apply({first:'3001',last:'6001'}),{message:'FUND_APPLICATION_EXCEEDS_BALANCE'});
    await assert.rejects(reportV2(),{message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});

    const competition=await Promise.allSettled([
      apply({first:'3001',last:'4000'}),apply({first:'3001',last:'4000',connection:peer}),
    ]);
    assert.equal(competition.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(competition.find(row=>row.status==='rejected').reason.message,'FUND_APPLICATION_RANGE_UNAVAILABLE');
    const balanceCompetition=await Promise.allSettled([
      apply({first:'4001',last:'5500'}),apply({first:'5501',last:'7000',connection:peer}),
    ]);
    assert.equal(balanceCompetition.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(balanceCompetition.find(row=>row.status==='rejected').reason.message,'FUND_APPLICATION_EXCEEDS_BALANCE');
    const options=()=>command(finance,'read_direct_fictional_receipt_options',[...owner.auth(),owner.customer,today]);
    assert.equal((await options()).receivables[0].remainingCents,'500');

    const journal=await command(finance,'read_fictional_journal_v3',[...owner.auth(),today,null,null,100]);
    assert.deepEqual(parseFictionalJournalV3(journal,owner.business,today,null,null,100),journal);
    assert.deepEqual(journal.rows.filter(row=>row.fundApplicationId===key.id).map(row=>[
      row.template,row.purpose,row.accountId,row.debitCents,row.creditCents,row.fundLotId,
    ]).sort((a,b)=>a[1].localeCompare(b[1])),[
      ['P04','apply_ar',ar,'0','2000',null],['P04','apply_funds',funds,'2000','0',held.fundLotId],
    ]);
    const balance=await report();
    assert.deepEqual(parseFictionalTrialBalanceV3(balance,owner.business,today),balance);
    assert.deepEqual(balance.coverage.templates,['P01','P02','P03','P04','P05','P12']);
    assert.equal(balance.coverage.complete,false);
    assert.deepEqual(balance.controls,{ledgerBalanced:true,receivablesTie:true,moneyMovementsTie:true,customerFundsTie:true});
    assert.equal(value(balance,ar),'500');
    assert.equal(value(balance,funds),'-5500');
    assert.equal(value(balance,bank),'30000');
    assert.equal(balance.rows.find(row=>row.code==='4000').balanceCents,baseline.rows.find(row=>row.code==='4000').balanceCents);
    assert.deepEqual(await capture(),originalSources);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE business_id=$1',[owner.business])).rows[0].n,2);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.invoice_tax_payable_movements WHERE business_id=$1',[owner.business])).rows[0].n,0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.customer_fund_applications WHERE business_id=$1',[owner.business])).rows[0].n,3);
    assert.equal((await admin.query('SELECT original_cents::text AS cents FROM crest.customer_fund_lots WHERE id=$1',[held.fundLotId])).rows[0].cents,'10000');
    const history=(await admin.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customer_fund_applications' AND entity_id=$2",
      [owner.business,key.id])).rows[0].delta;
    assert.deepEqual(history,{schemaVersion:1,before:null,after:result.receipt});
    await assert.rejects(web.query('SELECT * FROM crest.customer_fund_applications'),{code:'42501'});
    await assert.rejects(admin.query('DELETE FROM crest.customer_fund_applications WHERE id=$1',[key.id]),{code:'55000'});
    await assert.rejects(admin.query("UPDATE crest.customer_fund_applications SET reason='changed' WHERE id=$1",[key.id]),{code:'55000'});

    const extraService=async()=> (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',
      [owner.business,service])).rows[0].id;
    const anotherCustomer=await makeOwner(owner,{serviceVersionFor:extraService});
    const {invoice:otherInvoice}=await issueInvoice({admin,web,finance,owner:anotherCustomer,service,today,setup:false,
      appointmentDay:'2026-11-04'});
    await assert.rejects(apply({receivable:otherInvoice.receivableId,first:'7001',last:'8000'}),
      {message:'FUND_APPLICATION_RECEIVABLE_REQUIRED'});
    const sameCustomer=await makeOwner(owner,{customerId:owner.customer,serviceVersionFor:extraService});
    const {invoice:nextInvoice}=await issueInvoice({admin,web,finance,owner:sameCustomer,service,today,setup:false,
      appointmentDay:'2026-11-05'});
    const crossInvoice=await apply({receivable:nextInvoice.receivableId,first:'7001',last:'8000'});
    assert.equal(crossInvoice.state,'committed');
    assert.equal(crossInvoice.receipt.invoiceId,nextInvoice.invoiceId);
    assert.equal(crossInvoice.receipt.fundingOriginId,held.fundingOriginId);
    const openById=new Map((await options()).receivables.map(row=>[row.receivableId,row.remainingCents]));
    assert.equal(openById.get(invoice.receivableId),'500');
    assert.equal(openById.get(nextInvoice.receivableId),'24000');

    const retiredOperation=randomUUID(), retiredApplication=randomUUID();
    const retired=await command(finance,'retire_fictional_customer_fund_application',[
      ...owner.auth(),owner.epoch,retiredOperation,owner.epoch,retiredApplication,'Fictional review confirmed absence',
    ]);
    assert.equal(retired.state,'retired');
    assert.deepEqual(await apply({operation:retiredOperation,id:retiredApplication,first:'8001',last:'8100'}),
      {state:'conflict',reason:'operation'});
    assert.deepEqual(await command(finance,'lookup_fictional_customer_fund_application',[
      ...owner.auth(),owner.epoch,retiredOperation,retiredApplication,
    ]),retired);
    await assert.rejects(command(finance,'fund_application_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(exporter,'fund_application_source_snapshot_context',[owner.business]),{code:'25001'});
    const captured=await captureApplication(exporter,owner.business);
    assert.deepEqual(captured.counts,{customer_fund_applications:'4',atomic_finance_groups:'4',financial_events:'4',
      journal_entries:'4',journal_lines:'8'});
    assert(Object.values((await captureApplication(exporter,foreign.business)).counts).every(count=>count==='0'));
    const formatted=formatFundApplicationSource(captured);
    assert.equal(JSON.parse(formatted.manifest).exactFundApplicationEffectsVerified,true);
    assert.equal(JSON.parse(formatted.manifest).completePortableExport,false);
    const file=name=>formatted.files.find(part=>part.name===name).content;
    for(const group of Object.keys(captured.rows)){
      const {columns}=JSON.parse(file(group+'_dictionary.json'));
      const {escapes}=JSON.parse(file(group+'_escape_map.json'));
      assert.deepEqual(readSourceExportCsv(file(group+'.csv'),escapes,{columns,maxRows:100}),captured.rows[group]);
    }
    assert(file('operation_history.ndjson').includes(key.operation));
    assert(file('operation_history.ndjson').includes(retiredOperation));
    const damaged=structuredClone(captured);
    damaged.references.unapplication.rows.customer_fund_lots[0].origin_id=randomUUID();
    assert.throws(()=>formatFundApplicationSource(damaged),{message:'FUND_APPLICATION_SOURCE_REVIEW_REQUIRED'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const combined=(await captureFinanceSourceExport(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows,
        {includeCorrections:true,includeFundApplications:true})).forServer();
      const verified=verifyFinanceSourceExport(combined.manifest,combined.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v3');
      assert.equal(JSON.parse(combined.manifest).rowCounts.customer_fund_applications,4);
      await assert.rejects(command(exporter,'fund_application_source_snapshot_page',[
        owner.business,captured.snapshotToken,'customer_fund_applications',null,20,
      ]),{message:'CREST_FUND_APPLICATION_SOURCE_PAGE_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}
    await verifyRecovery({candidate,admin,target,owner,captured,saved:result,retired});
  } finally {
    try {await sandbox?.close();} finally {await cluster.close();}
  }
});
