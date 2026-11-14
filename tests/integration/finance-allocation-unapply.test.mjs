import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { financeUnapplication81Candidate } from '../support/finance-unapplication81-candidate.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupLegacy80Database, backupUnapplication81CandidateDatabase, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreLegacy80Database, restoreUnapplication81CandidateDatabase } from '../support/recovery-drill.mjs';
import { captureInvoiceSource } from '../../src/bookkeeping/invoice-source.ts';
import { captureReceiptSource } from '../../src/bookkeeping/receipt-source.ts';
import { capturePostedExpenseSource } from '../../src/bookkeeping/posted-expense-source.ts';
import { captureUnapplicationSource, formatUnapplicationSource } from '../../src/bookkeeping/unapplication-source.ts';
import { captureFinanceSourceExport } from '../../src/bookkeeping/finance-source-export.ts';
import { verifyFinanceSourceExport } from '../../src/tooling/verify-finance-source-export.ts';
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

async function issueInvoice({admin,web,finance,owner,service,today}) {
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
  const booking=confirmedBookingRequest(owner);
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
  const selection=Object.fromEntries(lines.map(line=>[line.outcomeId,district]));
  const {reviewDigest}=await command(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'1',selection]);
  const invoice=await committed(finance,'issue_reviewed_invoice',[...mutate(),draft,'1',selection,reviewDigest]);
  assert.equal(invoice.issuedOn,today);
  const {rows:[{account_id:ar}]}=await admin.query('SELECT account_id FROM crest.receivable_items WHERE business_id=$1 AND id=$2',
    [owner.business,invoice.receivableId]);
  return {invoice,ar};
}

async function verifyRecovery({candidate,admin,target,owner,captured,frozen,result,retirement}) {
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination, restored, reader, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupLegacy80Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupUnapplication81CandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,81);
    assert.equal(manifest.heldUnapplicationMigrationSha256,candidate.sha256);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.completeBackup,false);
    for(const name of ['allocation_unapplications','customer_fund_lots'])assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name===name).rows,2);
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreLegacy80Database(point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    assert.deepEqual(await restoreUnapplication81CandidateDatabase(candidate,point,keys.path,url),manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    reader=await connect(url);
    await reader.query('SET ROLE crest_export');
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const query=async(sql,args)=>(await reader.query(sql,args)).rows;
      const after=await captureUnapplicationSource(owner.business,query);
      assert.notEqual(after.snapshotToken,captured.snapshotToken);
      assert.deepEqual(after.rows,captured.rows);
      assert.deepEqual(after.history,captured.history);
      const files=source=>formatUnapplicationSource(source).files.filter(file=>file.name.endsWith('.csv')||file.name.endsWith('.ndjson'));
      assert.deepEqual(files(after),files(captured));
      assert.deepEqual((await captureInvoiceSource(owner.business,async(sql,args)=>(await query(sql,args))[0].result)).rows,frozen.invoices);
      assert.deepEqual((await captureReceiptSource(owner.business,query)).rows,frozen.payments);
      assert.deepEqual((await capturePostedExpenseSource(owner.business,query)).rows,frozen.expenses);
    } finally {await reader.query('ROLLBACK');}
    const epoch=randomUUID(), provider=randomUUID(), session=randomUUID(), credential=randomBytes(32);
    await restored.query('BEGIN');
    try{
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
    await assert.rejects(command(finance,'read_fictional_trial_balance_v2',[...old,result.receipt.effectiveOn]),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await command(finance,'lookup_fictional_allocation_unapplication',[
      ...fresh,owner.epoch,result.receipt.operationId,result.receipt.unapplicationId,
    ]),result);
    assert.deepEqual(await command(finance,'lookup_fictional_allocation_unapplication',[
      ...fresh,owner.epoch,retirement.receipt.operationId,retirement.receipt.unapplicationId,
    ]),retirement);
    const journal=await command(finance,'read_fictional_journal_v2',[...fresh,result.receipt.effectiveOn,result.receipt.fundsAccountId,null,20]);
    const original=journal.rows.find(row=>row.unapplicationId===result.receipt.unapplicationId);
    assert.equal(original.fundLotId,result.receipt.fundLotId);
    assert.equal(original.creditCents,result.receipt.cents);
    await assert.rejects(command(finance,'unapply_fictional_payment_allocation',[
      ...fresh,owner.epoch,result.receipt.operationId,result.receipt.unapplicationId,result.receipt.allocationId,result.receipt.customerId,
      result.receipt.mappingId,result.receipt.effectiveOn,result.receipt.firstCent,result.receipt.lastCent,result.receipt.reason,
    ]),{message:'RECOVERY_REVIEW_REQUIRED'});
  } finally {
    try {await finance?.end();} finally {
      try {await reader?.end();} finally {
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

test('held P05 moves exact live P03 ranges with no cash, reopens AR, and restores independent encrypted records', {timeout:180000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(80));
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
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-unapplication-service',active:true,
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
    const mapping=await committed(finance,'approve_fixed_finance_mapping',
      [...mutate(),'customer_funds','0',funds,'2026-01-01','Fictional funds mapping review']);
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
    const capture=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const invoices=await captureInvoiceSource(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows[0].result);
        const payments=await captureReceiptSource(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows);
        const expenses=await capturePostedExpenseSource(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows);
        return {invoices:invoices.rows,payments:payments.rows,expenses:expenses.rows};
      } finally {await exporter.query('ROLLBACK');}
    };
    const originalSources=await capture();
    const candidate=await financeUnapplication81Candidate(sandbox);
    assert((await readFile(join(candidate.directory,'supabase/migrations',candidate.file))).equals(
      await readFile(join(sandbox.root,'supabase/migrations',candidate.file))));
    const registered=await sandbox.apply(target,await sandbox.prefix(81));
    assert.equal(registered.history.length,81);
    assert.equal(registered.registrySha256,candidate.registrySha256);
    const reportV1=()=>command(finance,'read_fictional_trial_balance',[...owner.auth(),today]);
    assert.equal((await reportV1()).schemaVersion,1);
    const unapply=({operation=randomUUID(),id=randomUUID(),allocationId=allocation.id,customer=owner.customer,mappingId=mapping.id,
      date=today,first='1',last='10000',epoch=owner.epoch,connection=finance,principal=owner}={})=>
      command(connection,'unapply_fictional_payment_allocation',[...principal.auth(),epoch,operation,id,allocationId,customer,mappingId,date,
        first,last,'Fictional owner reviewed reclassification']);
    const readRanges=(customer=owner.customer,date=today,connection=finance)=>
      command(connection,'read_fictional_allocation_unapplication_options',[...owner.auth(),customer,allocation.id,date]);
    const listAllocations=(customer=owner.customer,connection=finance)=>
      command(connection,'list_fictional_invoice_payment_allocations',[...owner.auth(),customer,invoice.invoiceId]);
    assert.deepEqual((await listAllocations()).allocations,[{allocationId:allocation.id,paymentId:originalPayment.paymentId,
      paidOn:today,appliedCents:'25000',availableCents:'25000'}]);
    assert.deepEqual(await listAllocations(foreign.customer),{state:'absent'});
    await assert.rejects(listAllocations(owner.customer,web),{code:'42501'});
    const review=await readRanges(owner.customer,null);
    assert.equal(review.invoiceNumber,invoice.invoiceNumber);
    assert.equal(review.fundsMappingId,mapping.id);
    assert.equal(review.openPeriod,true);
    assert.deepEqual(review.availableRanges,[{firstCent:'1',lastCent:'25000'}]);
    assert.deepEqual(await readRanges(foreign.customer),{state:'absent'});
    await assert.rejects(readRanges(owner.customer,yesterday),{message:'UNAPPLICATION_DATE_REQUIRED'});
    await assert.rejects(readRanges(owner.customer,today,web),{code:'42501'});
    const lookup=({operation,id,epoch=owner.epoch},principal=owner)=>
      command(finance,'lookup_fictional_allocation_unapplication',[...principal.auth(),epoch,operation,id]);
    const retire=({operation,id,epoch=owner.epoch},connection=finance,reviewEpoch=owner.epoch)=>
      command(connection,'retire_fictional_allocation_unapplication',[...owner.auth(),reviewEpoch,operation,epoch,id,
        'Fictional owner reviewed absent original']);
    const retiredKey={operation:randomUUID(),id:randomUUID()};
    assert.deepEqual(await lookup(retiredKey),{state:'absent'});
    await assert.rejects(retire(retiredKey,web),{code:'42501'});
    await assert.rejects(retire(retiredKey,finance,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
    const retirement=await retire(retiredKey);
    assert.equal(retirement.state,'retired');
    assert.deepEqual(await retire(retiredKey),retirement);
    assert.deepEqual(await lookup(retiredKey),retirement);
    assert.deepEqual(await lookup(retiredKey,foreign),{state:'absent'});
    assert.deepEqual(await lookup({...retiredKey,id:randomUUID()}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await unapply(retiredKey),{state:'conflict',reason:'operation'});
    await assert.rejects(unapply({connection:web}),{code:'42501'});
    await assert.rejects(unapply({epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(unapply({principal:foreign,epoch:foreign.epoch}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(unapply({customer:randomUUID()}),{message:'UNAPPLICATION_ALLOCATION_REQUIRED'});
    await assert.rejects(unapply({mappingId:randomUUID()}),{message:'UNAPPLICATION_FUNDS_MAPPING_REQUIRED'});
    await assert.rejects(unapply({date:yesterday}),{message:'UNAPPLICATION_DATE_REQUIRED'});
    await assert.rejects(unapply({date:'9999-01-01'}),{message:'UNAPPLICATION_DATE_REQUIRED'});
    await assert.rejects(unapply({first:'0'}),{message:'UNAPPLICATION_INPUT_REQUIRED'});
    await assert.rejects(unapply({last:'25001'}),{message:'UNAPPLICATION_RANGE_UNAVAILABLE'});

    const key={operation:randomUUID(),id:randomUUID()};
    const result=await unapply(key);
    assert.equal(result.state,'committed');
    assert.deepEqual(await lookup(key),result);
    assert.deepEqual(await retire(key),result);
    assert.deepEqual((await readRanges()).availableRanges,[{firstCent:'10001',lastCent:'25000'}]);
    assert.equal((await listAllocations()).allocations[0].availableCents,'15000');
    assert.deepEqual(await unapply(key),result);
    assert.deepEqual(await unapply({...key,last:'9999'}),{state:'conflict',reason:'operation'});
    assert.equal(result.receipt.fundingOriginId,originalPayment.fundingOriginId);
    assert.equal(result.receipt.parentPartitionId,allocation.fundingPartitionId);
    assert.equal(result.receipt.arAccountId,ar);
    assert.equal(result.receipt.fundsAccountId,funds);
    assert.equal(result.receipt.cents,'10000');
    await assert.rejects(unapply({first:'10000',last:'10001'}),{message:'UNAPPLICATION_RANGE_UNAVAILABLE'});
    assert.deepEqual(await capture(),originalSources);
    const options=()=>command(finance,'read_direct_fictional_receipt_options',[...owner.auth(),owner.customer,today]);
    assert.equal((await options()).receivables[0].remainingCents,'10000');
    await assert.rejects(reportV1(),{message:'FINANCE_REPORT_V2_REQUIRED'});
    const balance=()=>command(finance,'read_fictional_trial_balance_v2',[...owner.auth(),today]);
    const after=await balance();
    assert.equal(after.controls.customerFundsTie,true);
    assert.equal(after.schemaVersion,2);
    assert.equal(after.rows.find(row=>row.accountId===ar).balanceCents,'10000');
    assert.equal(after.rows.find(row=>row.accountId===funds).balanceCents,'-10000');
    assert.equal(after.rows.find(row=>row.accountId===bank).balanceCents,'25000');
    const journal=await command(finance,'read_fictional_journal_v2',[...owner.auth(),today,ar,null,20]);
    assert.deepEqual(journal.rows.map(row=>[row.template,row.runningBalanceCents]),
      [['P01','25000'],['P03','0'],['P05','10000']]);
    assert.equal(journal.rows.at(-1).unapplicationId,result.receipt.unapplicationId);
    const fundsJournal=await command(finance,'read_fictional_journal_v2',[...owner.auth(),today,funds,null,20]);
    assert.equal(fundsJournal.rows[0].fundLotId,result.receipt.fundLotId);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE business_id=$1',[owner.business])).rows[0].n,1);
    await pay('10000','paid-reopened');
    assert.equal((await options()).receivables.length,0);
    assert.equal((await balance()).rows.find(row=>row.accountId===ar).balanceCents,'0');

    const concurrent=await Promise.allSettled([
      unapply({first:'10001',last:'11000'}),unapply({first:'10001',last:'11000',connection:peer}),
    ]);
    assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(concurrent.find(x=>x.status==='rejected').reason.message,'UNAPPLICATION_RANGE_UNAVAILABLE');
    assert.equal((await balance()).rows.find(row=>row.accountId===funds).balanceCents,'-11000');
    await assert.rejects(command(finance,'unapplication_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(exporter,'unapplication_source_snapshot_context',[owner.business]),{code:'25001'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let captured;
    try {
      const collect=business=>captureUnapplicationSource(business,async(sql,args)=>(await exporter.query(sql,args)).rows);
      captured=await collect(owner.business);
      assert.deepEqual(captured.counts,{allocation_unapplications:'2',customer_fund_lots:'2',atomic_finance_groups:'2',
        financial_events:'2',journal_entries:'2',journal_lines:'4'});
      assert(Object.values((await collect(foreign.business)).counts).every(count=>count==='0'));
      const files=formatUnapplicationSource(captured);
      assert.equal(JSON.parse(files.manifest).exactUnapplicationEffectsVerified,true);
      const file=name=>files.files.find(part=>part.name===name).content;
      for(const group of Object.keys(captured.rows)){
        const {columns}=JSON.parse(file(group+'_dictionary.json'));
        const {escapes}=JSON.parse(file(group+'_escape_map.json'));
        assert.deepEqual(readSourceExportCsv(file(group+'.csv'),escapes,{columns,maxRows:100}),captured.rows[group]);
      }
      assert(file('operation_history.ndjson').includes(key.operation));
      const damaged=structuredClone(captured);
      damaged.rows.customer_fund_lots[0].origin_id=randomUUID();
      assert.throws(()=>formatUnapplicationSource(damaged),{message:'UNAPPLICATION_SOURCE_REVIEW_REQUIRED'});
      const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
      const combined=(await captureFinanceSourceExport(owner.business,query,{includeCorrections:true})).forServer();
      const manifest=JSON.parse(combined.manifest);
      assert.equal(manifest.schemaVersion,2);
      assert.equal(manifest.rowCounts.allocation_unapplications,2);
      assert.equal(manifest.rowCounts.customer_fund_lots,2);
      assert.equal(manifest.rowCounts.allocation_events,2);
      assert.equal(manifest.sourceTokens.correction,captured.snapshotToken);
      const verified=verifyFinanceSourceExport(combined.manifest,combined.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v2');
      assert.equal(verified.balancedJournalEntries,5);
      const fileFor=name=>combined.files.find(file=>file.name===name).content;
      const dictionary=JSON.parse(fileFor('dictionary.json')).tables.find(table=>table.name==='customer_fund_lots');
      assert.deepEqual(readSourceExportCsv(fileFor('customer_fund_lots.csv'),
        JSON.parse(fileFor('customer_fund_lots_escape_map.json')).escapes,{columns:dictionary.columns,maxRows:100}),
      captured.rows.customer_fund_lots);
    } finally {await exporter.query('ROLLBACK');}
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assert.rejects(command(exporter,'unapplication_source_snapshot_page',
      [owner.business,captured.snapshotToken,'allocation_unapplications',null,20]),{message:'CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED'});
    await exporter.query('ROLLBACK');
    await assert.rejects(admin.query('DELETE FROM crest.customer_fund_lots WHERE id=$1',[result.receipt.fundLotId]),{code:'55000'});
    await admin.query('BEGIN');
    try {
      await admin.query('ALTER TABLE crest.customer_fund_lots DISABLE TRIGGER USER');
      await admin.query('UPDATE crest.customer_fund_lots SET original_cents=original_cents+1 WHERE id=$1',[result.receipt.fundLotId]);
      await admin.query('SET LOCAL ROLE crest_finance_preview');
      await assert.rejects(command(admin,'read_fictional_trial_balance_v2',[...owner.auth(),today]),{message:'FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED'});
    } finally {await admin.query('ROLLBACK');}
    const frozen=await capture();
    await verifyRecovery({candidate,admin,target,owner,captured,frozen,result,retirement});
  } finally {
    try {await sandbox?.close();} finally {await cluster.close();}
  }
});
