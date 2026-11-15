import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {readSourceExportCsv} from '../../src/security/source-export-csv-reader.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

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

test('registered posted trial balance and journal tie exact amounts and refuse inconsistent native source', {timeout:120000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const previous=await sandbox.apply(target,await sandbox.prefix(79));
    const registered=await sandbox.apply(target,await sandbox.prefix(80));
    assert.equal(registered.history.length,80);
    assert.deepEqual(registered.history.slice(0,79),previous.history);
    const web=await sandbox.connect(target);
    const finance=await sandbox.connect(target);
    const exportReader=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await exportReader.query('SET ROLE crest_export');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const service=randomUUID();
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-report-service',active:true,
        definition:{name:'Fictional report service',inclusions:'Interior',exclusions:'',internalGuidance:null,
          rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
      return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
    }});
    const foreign=await makeOwner();
    const trial=(through=null,principal=owner,connection=finance)=>command(connection,'read_fictional_trial_balance',[...principal.auth(),through]);
    const journal=(through=null,account=null,after=null,limit=20,principal=owner)=>
      command(finance,'read_fictional_journal',[...principal.auth(),through,account,after,limit]);
    const {rows:[{today,yesterday}]}=await admin.query(
      "SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today,((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday");
    const empty=await trial();
    assert.deepEqual(empty,{schemaVersion:1,businessId:owner.business,currency:'USD',timeZone:'UTC',throughOn:today,observedAt:empty.observedAt,
      postedEventCount:'0',coverageStart:null,coverage:{complete:false,openingBalancesIncluded:false,reconciliationVerified:false,
        templates:['P01','P02','P03','P12']},controls:{ledgerBalanced:true,receivablesTie:true,moneyMovementsTie:true},
      rows:[],totals:{debitCents:'0',creditCents:'0',debitBalanceCents:'0',creditBalanceCents:'0'}});
    assert.match(empty.observedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    assert.deepEqual((await journal()).rows,[]);
    await assert.rejects(trial(null,owner,web),{code:'42501'});
    await assert.rejects(trial(null,owner,exportReader),{code:'42501'});
    await assert.rejects(trial('9999-01-01'),{message:'FINANCE_REPORT_DATE_REQUIRED'});
    await assert.rejects(trial('1899-01-01'),{message:'FINANCE_REPORT_DATE_REQUIRED'});
    await assert.rejects(journal(null,null,null,101),{message:'FINANCE_REPORT_PAGE_REQUIRED'});
    await assert.rejects(journal(null,randomUUID()),{message:'FINANCE_REPORT_ACCOUNT_REQUIRED'});
    await assert.rejects(journal(null,null,randomUUID()),{message:'FINANCE_REPORT_PAGE_REQUIRED'});

    await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
      SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
    const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
    const accounts=[];
    for(const [identity,name] of [
      [{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},'Fictional bank'],
      [{code:'5000',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'expense'},'Fictional supplies'],
    ]){
      const id=randomUUID();
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name,active:true,reason:null}]);
      accounts.push(id);
    }
    const [bank,cost]=accounts;
    const mapping=await committed(finance,'approve_fixed_finance_mapping',
      [...mutate(),'category_supplies','0',cost,'2026-01-01','Fictional reviewed mapping']);
    const channel=randomUUID();
    await committed(finance,'save_money_channel',[...mutate(),channel,'0',{
      identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'9182'},
      label:'Fictional bank',effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional verified ownership',openingState:'verified_zero',
      openingOn:'2026-01-01',openingCents:'0',openingEvidence:'Fictional verified zero opening',active:true,reason:'Fictional review',
    }]);
    await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'accounting_period',startsOn:today,reason:'Fictional period'}]);
    async function savedExpense(cents) {
      const expense=randomUUID();
      await committed(web,'save_expense',[...mutate(),expense,'0',{paidOn:today,amountCents:cents,currency:'USD',category:'supplies',
        description:'Fictional wash supplies',vendor:'Fictional supply store',paymentMethod:'bank',reference:null,notes:null,voided:false,changeReason:null}]);
      return expense;
    }
    async function post(cents) {
      const expense=await savedExpense(cents);
      return committed(finance,'post_fictional_same_day_expense',[...mutate(),randomUUID(),expense,'1',channel,'1',mapping.id,today,today,
        'none','0',null,'Fictional source receipt missing',null,'Fictional reviewed same-date debit',
        {namespace:'ledger',id:randomUUID(),rawReference:'Fictional exact bank debit'}]);
    }
    await savedExpense('99999');
    const first=await post('10000'), second=await post('1201');
    const result=await trial(today);
    assert.equal(result.postedEventCount,'2');
    assert.equal(result.coverageStart,today);
    assert.deepEqual(result.totals,{debitCents:'11201',creditCents:'11201',debitBalanceCents:'11201',creditBalanceCents:'11201'});
    assert.deepEqual(result.rows.map(row=>[row.accountId,row.code,row.debitCents,row.creditCents,row.balanceCents]),
      [[bank,'1000','0','11201','-11201'],[cost,'5000','11201','0','11201']]);
    assert.equal((await trial(yesterday)).postedEventCount,'0');
    assert.equal((await trial(today,foreign)).postedEventCount,'0');
    await assert.rejects(journal(today,bank,null,20,foreign),{message:'FINANCE_REPORT_ACCOUNT_REQUIRED'});
    const full=await journal(today);
    assert.equal(full.rows.length,4);
    assert(full.rows.every(row=>row.template==='P12'&&row.effectiveOn===today&&row.invoiceId===null&&row.paymentId===null));
    assert.equal(full.hasMore,false);
    assert.equal(full.nextAfterLineId,null);
    const firstPage=await journal(today,bank,null,1);
    assert.equal(firstPage.hasMore,true);
    assert.deepEqual(firstPage.rows.map(row=>[row.postedExpenseId,row.runningBalanceCents]),[[first.postedExpenseId,'-10000']]);
    const secondPage=await journal(today,bank,firstPage.nextAfterLineId,1);
    assert.equal(secondPage.hasMore,false);
    assert.deepEqual(secondPage.rows.map(row=>[row.postedExpenseId,row.runningBalanceCents]),[[second.postedExpenseId,'-11201']]);
    await assert.rejects(journal(today,cost,firstPage.nextAfterLineId),{message:'FINANCE_REPORT_PAGE_REQUIRED'});
    assert.equal((await journal(yesterday)).rows.length,0);
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today});
    const payment=await committed(finance,'record_direct_fictional_receipt',[...mutate(),randomUUID(),owner.customer,channel,'1',today,'10000',
      'Fictional settled receipt',null,{namespace:'ledger',id:'fixture-inflow',rawReference:'Fictional original inflow'},
      {[invoice.receivableId]:'10000'}]);
    const complete=await trial(today);
    assert.equal(complete.postedEventCount,'4');
    assert.deepEqual(complete.totals,{debitCents:'46201',creditCents:'46201',debitBalanceCents:'26201',creditBalanceCents:'26201'});
    const arJournal=await journal(today,ar);
    assert.deepEqual(arJournal.rows.map(row=>[row.template,row.invoiceId,row.paymentId,row.runningBalanceCents]),[
      ['P01',invoice.invoiceId,null,'25000'],['P03',null,payment.paymentId,'15000'],
    ]);
    const exportQuery=async(sql,args)=>(await exportReader.query(sql,args)).rows;
    await assert.rejects(captureFinanceSourceExport(owner.business,exportQuery),{message:'CREST_INVOICE_SOURCE_SNAPSHOT_REQUIRED'});
    await exportReader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const capture=await captureFinanceSourceExport(owner.business,exportQuery);
      assert.throws(()=>JSON.stringify(capture),{message:'FINANCE_SOURCE_EXPORT_PRIVATE'});
      const {files,manifest}=capture.forServer(),inventory=JSON.parse(manifest);
      assert.equal(inventory.businessId,owner.business);
      assert.equal(inventory.completePortableExport,false);
      assert.equal(inventory.completeBackup,false);
      assert.equal(inventory.rowCounts.financial_events,4);
      assert.equal(inventory.rowCounts.posted_expenses,2);
      assert.equal(inventory.rowCounts.payments,1);
      assert.equal(inventory.rowCounts.invoices,1);
      assert.equal(new Set(files.map(file=>file.name)).size,files.length);
      for(const file of files){
        const expected=inventory.files.find(part=>part.name===file.name);
        assert.equal(expected.bytes,Buffer.byteLength(file.content));
        assert.equal(expected.sha256,createHash('sha256').update(file.content).digest('hex'));
      }
      const read=name=>files.find(file=>file.name===name).content;
      const dictionary=JSON.parse(read('dictionary.json'));
      const decode=name=>readSourceExportCsv(read(name+'.csv'),JSON.parse(read(name+'_escape_map.json')).escapes,
        {columns:dictionary.tables.find(table=>table.name===name).columns,maxRows:10000});
      const events=decode('financial_events');
      assert.equal(new Set(events.map(row=>row.id)).size,4);
      assert(events.some(row=>row.template==='P01'&&row.invoice_id===invoice.invoiceId&&row.payment_id===null&&row.posted_expense_id===null));
      assert(events.some(row=>row.template==='P03'&&row.payment_id===payment.paymentId&&row.invoice_id===null&&row.posted_expense_id===null));
      assert(events.some(row=>row.template==='P12'&&row.posted_expense_id===first.postedExpenseId&&row.payment_id===null&&row.invoice_id===null));
      const movements=decode('money_movements');
      assert.deepEqual(movements.map(row=>Number(row.signed_cents)).sort((a,b)=>a-b),[-10000,-1201,10000]);
      const lines=decode('journal_lines');
      assert.equal(lines.reduce((total,line)=>total+BigInt(line.debit_cents),0n),46201n);
      assert.equal(lines.reduce((total,line)=>total+BigInt(line.credit_cents),0n),46201n);
      assert(read('operation_history.ndjson').includes(payment.paymentId));
      const verified=verifyFinanceSourceExport(manifest,files,owner.business);
      assert.equal(verified.debitCents,'46201');
      assert.equal(verified.balancedJournalEntries,4);
      const folder=join(sandbox.workspace,'finance-export');
      await mkdir(folder);
      try{
        await writeFile(join(folder,'manifest.json'),manifest);
        for(const file of files)await writeFile(join(folder,file.name),file.content);
        const stdout=execFileSync(process.execPath,['--conditions=react-server','scripts/verify-source-export.mjs',folder,owner.business],
          {encoding:'utf8',timeout:10000});
        assert.deepEqual(JSON.parse(stdout),verified);
      }finally{
        const resolved=await realpath(folder);
        assert.equal(resolved,join(await realpath(sandbox.workspace),'finance-export'));
        await rm(resolved,{recursive:true});
      }
      const broken=files.map(file=>file.name==='journal_lines.csv'?{...file,content:file.content+'\r\n'}:file);
      assert.throws(()=>verifyFinanceSourceExport(manifest,broken,owner.business));
      const wrongCounts={...inventory,rowCounts:{...inventory.rowCounts,payments:2}};
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(wrongCounts),files,owner.business));

      const duplicateExpense=async(sql,args)=>{
        const rows=await exportQuery(sql,args);
        if(sql.includes('posted_expense_source_snapshot_page')&&args[2]==='financial_events'&&rows[0].result.rows.length){
          rows[0].result.rows[0].id=payment.eventId;
        }
        return rows;
      };
      await assert.rejects(captureFinanceSourceExport(owner.business,duplicateExpense));
    }finally{await exportReader.query('ROLLBACK');}

    // Fault injection stays uncommitted and is visible only in this test connection.
    for(const [table,mutation,message] of [
      ['journal_lines',`UPDATE crest.journal_lines SET debit_cents=debit_cents+1 WHERE purpose='expense_cost'`,'FINANCE_REPORT_LEDGER_CONTROL_FAILED'],
      ['money_movements',`UPDATE crest.money_movements SET signed_cents=signed_cents-1`,'FINANCE_REPORT_MONEY_CONTROL_FAILED'],
      ['allocation_events',`UPDATE crest.allocation_events SET cents=cents-1`,'FINANCE_REPORT_RECEIVABLE_CONTROL_FAILED'],
    ]){
      await admin.query('BEGIN');
      try {
        await admin.query('ALTER TABLE crest.'+table+' DISABLE TRIGGER USER');
        await admin.query(mutation);
        await admin.query('SET LOCAL ROLE crest_finance_preview');
        await assert.rejects(trial(today,owner,admin),{message});
      } finally {await admin.query('ROLLBACK');}
    }
    assert.deepEqual((await trial()).totals,complete.totals);
  } finally {
    try {await sandbox?.close();} finally {await cluster.close();}
  }
});
