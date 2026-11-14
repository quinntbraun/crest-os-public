import assert from 'node:assert/strict';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupRefundTransferDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreRefundTransferDatabase} from '../support/recovery-drill.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {refundTransferRecoveryProfile} from '../support/finance-refund-transfer-candidate.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {parseFictionalJournalV10,parseFictionalTrialBalanceV10} from '../../src/bookkeeping/posted-report-v10-contract.ts';
import {parseRefundTransferOptions} from '../../src/bookkeeping/refund-transfer-adjustment-contract.ts';
import {createServiceRefundSourceCollector} from '../../src/security/business-foundation-collector.ts';
import {postedFinanceProfileForSchema} from '../../src/security/posted-finance-owner-export-contract.ts';
async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('returned refunds restore the same customer obligation and verified retries do not reduce revenue or tax again',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    assert.equal((await sandbox.apply(target,await sandbox.prefix(95))).history.length,95);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const service=randomUUID();
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-refund-recredit',active:true,
        definition:{name:'Fictional service',inclusions:'Interior',exclusions:'',internalGuidance:null,
          rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
      return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
    }});
    const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
    const { today, yesterday } = (await admin.query(
      "SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today, ((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday",
    )).rows[0];
    await admin.query(
      "INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",
      [owner.business, owner.actor],
    );
    const depositBank = randomUUID(), depositChannel = randomUUID();
    const returnBank = randomUUID(), returnChannel = randomUUID(), funds = randomUUID();
    for (const [account, channel, code, suffix] of [[depositBank, depositChannel, '1000', '9182'], [returnBank, returnChannel, '1001', '4726']]) {
      await committed(finance, 'save_finance_account', [...mutate(), 1, account, '0', {
        identity: { code, accountType: 'asset', normalSide: 'debit', controlKind: 'bank', reportRole: 'money' },
        name: 'Fictional bank ' + suffix, active: true, reason: null,
      }]);
      await committed(finance, 'save_money_channel', [...mutate(), channel, '0', {
        identity: { accountId: account, kind: 'bank', ownershipScope: 'dedicated_business', providerNamespace: 'fictional-bank', maskedSuffix: suffix },
        label: 'Fictional bank ' + suffix, effectiveFrom: '2026-01-01', ownershipEvidence: 'Fictional verified ownership',
        openingState: 'verified_zero', openingOn: '2026-01-01', openingCents: '0', openingEvidence: 'Fictional opening',
        active: true, reason: 'Fictional review',
      }]);
    }
    await committed(finance, 'save_finance_account', [...mutate(), 1, funds, '0', {
      identity: { code: '2000', accountType: 'liability', normalSide: 'credit', controlKind: 'customer_funds', reportRole: 'customer_funds' },
      name: 'Fictional customer funds', active: true, reason: null,
    }]);
    await committed(finance, 'approve_fixed_finance_mapping', [...mutate(), 'customer_funds', '0', funds, '2026-01-01', 'Fictional review']);
    await committed(finance, 'configure_fictional_invoice_setup', [...mutate(), { kind: 'accounting_period', startsOn: yesterday, reason: 'Fictional opening' }]);
    const mapping = (await admin.query("SELECT id FROM crest.account_mapping_versions WHERE business_id=$1 AND purpose='customer_funds'", [owner.business])).rows[0].id;
    const {invoice}=await issueInvoice({admin,web,finance,owner,service,today,appointmentDay:yesterday});
    const foreign=await makeOwner();
    const received=await committed(finance,'record_direct_fictional_receipt_with_funds',[...mutate(),randomUUID(),owner.customer,depositChannel,
      '1',today,'1200','Fictional settled receipt',null,{namespace:'ledger',id:randomUUID(),rawReference:'Fictional inflow'},
      {[invoice.receivableId]:'1000'},mapping]);
    const held=await committed(finance,'unapply_fictional_payment_allocation',[...mutate(),randomUUID(),received.applications[0].id,
      owner.customer,mapping,today,'101','106','Fictional owner reviewed unapplication']);

    const revenue=randomUUID(),tax=randomUUID(),district='Fictional tip return tax district';
    for(const [id,identity] of [[revenue,{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'}],
      [tax,{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'}]]){
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
    }
    const revenueMapping=await committed(finance,'approve_fixed_finance_mapping',[...mutate(),'tips_revenue','0',revenue,'2026-01-01','Fictional review']);
    const profile=await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'tip',null,'0','2026-01-01',
      'inclusive_single','0.1','Fictional tax evidence','Fictional review']);
    const taxMapping=await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tax,'2026-01-01','Fictional tax mapping']);
    const tipName='realize_fictional_held_tip',tipId=randomUUID();
    const tip=await committed(finance,tipName,[...mutate(),tipId,held.fundLotId,owner.customer,today,
      '101','106',district,profile.id,revenueMapping.id,taxMapping.id,'Fictional customer explicitly confirmed a six-cent tip','Fictional review']);
    assert.equal(tip.inclusiveCents,'6');assert.equal(tip.netCents,'5');assert.equal(tip.taxCents,'1');
    const evidence = (id = randomUUID()) => ({namespace:'ledger',id,rawReference:'Fictional settled debit'});
    const lot = received.heldFunds.lotId;
    const originalExcess=await committed(finance,'record_fictional_excess_return',[
      ...mutate(),randomUUID(),received.paymentId,lot,owner.customer,returnChannel,'1',today,'1001','1010',
      'Fictional settled return','Fictional owner reviewed return',evidence(),'10',
    ]);
    const returnTip = (amount) => committed(finance,'record_fictional_tip_return',[
      ...mutate(),randomUUID(),tipId,owner.customer,returnChannel,'1',today,
      'Fictional settled tip return','Fictional owner reviewed return',evidence(),amount,
    ]);
    const firstTipReturn = await returnTip('3');
    assert.deepEqual(firstTipReturn.ranges,[{firstCent:'1',lastCent:'3'}]);

    const servicePaid=await committed(finance,'record_direct_fictional_receipt',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'24006','Fictional original settlement',null,
      {namespace:'ledger',id:randomUUID(),rawReference:'Fictional original receipt'},{[invoice.receivableId]:'24006'},
    ]);
    const returns=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,returns,'0',{
      identity:{code:'4910',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'returns'},
      name:'Fictional service concessions',active:true,reason:null,
    }]);
    const returnsMapping=await committed(finance,'approve_fixed_finance_mapping',[
      ...mutate(),'returns','0',returns,'2026-01-01','Fictional review',
    ]);
    const invoiceItem=(await admin.query('SELECT id FROM crest.invoice_items WHERE invoice_id=$1 AND total_cents>0',[invoice.invoiceId])).rows[0].id;
    const paired=await committed(finance,'credit_fictional_paid_invoice_line',[
      ...mutate(),randomUUID(),invoiceItem,owner.customer,today,'1','20',returnsMapping.id,
      randomUUID(),servicePaid.applications[0].id,'1','20',mapping,'0','Fictional owner selected a paid concession',
    ]);
    const originalService=await committed(finance,'record_fictional_service_refund',[
      ...mutate(),randomUUID(),paired.credit.invoiceCreditId,paired.release.fundLotId,owner.customer,
      returnChannel,'1',today,'1','20','Fictional settled service transfer','Fictional approved refund',evidence(),
    ]);

    const candidate=await sandbox.prefix(96);
    const checked=await refundTransferRecoveryProfile(candidate,sandbox.root);
    const adopted=await sandbox.apply(target,candidate);
    assert.equal(adopted.history.length,96);
    assert.equal(adopted.registrySha256,checked.profile.registrySha256);
    const name='record_fictional_refund_transfer_adjustment';
    const range=(firstCent,lastCent=firstCent)=>({firstCent,lastCent});
    const args=({prior=firstTipReturn.eventId,kind='recredit',channel=depositChannel,version='1',date=today,cents='1',
      customer=owner.customer,external=evidence(),parts=[range('101')],id=randomUUID(),operation=randomUUID(),principal=owner}={})=>[
      ...principal.auth(),principal.epoch,operation,id,prior,customer,kind,channel,version,date,cents,
      'Fictional provider statement confirmed the transfer','Fictional owner verified the prior refund',external,JSON.stringify(parts),
    ];
    const journal=async(eventId)=>(await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id) WHERE j.event_id=$1 ORDER BY l.purpose',
      [eventId])).rows;
    const originalEvents=[firstTipReturn,originalExcess,originalService].map(row=>row.eventId);
    const readOptions='read_fictional_refund_transfer_options';
    const options=async(kind,customer=owner.customer)=>parseRefundTransferOptions(await command(finance,readOptions,
      [...owner.auth(),customer,kind,today]),owner.business,customer,kind,today);
    const available=await options('recredit');
    assert(available.openPeriod);
    assert.equal(available.channels.length,2);
    assert.deepEqual(new Set(available.refunds.map(row=>row.priorEventId)),new Set(originalEvents));
    assert.deepEqual(available.refunds.find(row=>row.priorEventId===firstTipReturn.eventId).availableRanges,[range('101','103')]);
    assert.deepEqual((await options('retry')).refunds,[]);
    assert.deepEqual((await options('recredit',foreign.customer)).refunds,[]);
    await assert.rejects(command(web,readOptions,[...owner.auth(),owner.customer,'recredit',today]),{code:'42501'});
    const retained=[];
    for(const eventId of originalEvents)retained.push(await journal(eventId));
    await assert.rejects(command(web,name,args()),{code:'42501'});
    await assert.rejects(command(finance,name,args({customer:randomUUID()})),{message:'REFUND_TRANSFER_PRIOR_REQUIRED'});
    await assert.rejects(command(finance,name,args({principal:foreign,customer:foreign.customer})),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(command(finance,name,args({date:yesterday})),{message:'REFUND_TRANSFER_DATE_REQUIRED'});
    await assert.rejects(command(finance,name,args({kind:'retry'})),{message:'REFUND_TRANSFER_PRIOR_REQUIRED'});
    await assert.rejects(command(finance,name,args({version:'2'})),{message:'REFUND_TRANSFER_VERIFIED_CHANNEL_REQUIRED'});
    await assert.rejects(command(finance,name,args({external:null})),{message:'REFUND_TRANSFER_EVIDENCE_REQUIRED'});
    await assert.rejects(command(finance,name,args({parts:[range('100')]})),{message:'REFUND_TRANSFER_RANGE_UNAVAILABLE'});
    await assert.rejects(command(finance,name,args({cents:'2'})),{message:'REFUND_TRANSFER_AMOUNT_REQUIRED'});
    const before=(await admin.query('SELECT count(*)::int AS roots FROM crest.funding_origins WHERE business_id=$1',[owner.business])).rows[0].roots;

    const tipInput=args({cents:'2',parts:[range('103'),range('101')]});
    const tipCredit=await committed(finance,name,tipInput);
    assert.deepEqual((await options('recredit')).refunds.find(row=>row.priorEventId===firstTipReturn.eventId).availableRanges,[range('102')]);
    assert.deepEqual((await options('retry')).refunds.find(row=>row.priorEventId===tipCredit.eventId).availableRanges,[range('101'),range('103')]);
    assert.deepEqual(tipCredit.ranges,[range('101'),range('103')]);
    assert.deepEqual([tipCredit.kind,tipCredit.obligationType,tipCredit.originalTemplate,tipCredit.fundLotId,tipCredit.fundingOriginId,
      tipCredit.priorEventId,tipCredit.originalEventId,tipCredit.customerId,tipCredit.moneyAccountId],
      ['recredit','tip_return_due','P10',held.fundLotId,received.fundingOriginId,firstTipReturn.eventId,firstTipReturn.eventId,owner.customer,depositBank]);
    assert.deepEqual(await committed(finance,name,[...tipInput.slice(0,-1),JSON.stringify([range('101'),range('103')])]),tipCredit);
    const lookup=(input,principal=owner)=>command(finance,'lookup_fictional_refund_transfer_adjustment',[
      ...principal.auth(),owner.epoch,input[9],input[10],
    ]);
    const retire=(input)=>command(finance,'retire_fictional_refund_transfer_adjustment',[
      ...owner.auth(),owner.epoch,input[9],owner.epoch,input[10],'Fictional confirmed absent attempt',
    ]);
    assert.deepEqual(await lookup(tipInput),{state:'committed',receipt:tipCredit});
    assert.deepEqual(await lookup(tipInput,foreign),{state:'absent'});
    assert.deepEqual(await retire(tipInput),{state:'committed',receipt:tipCredit});
    const delayed=args({parts:[range('102')]});
    assert.deepEqual(await lookup(delayed),{state:'absent'});
    const retired=await retire(delayed);
    assert.deepEqual(retired,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,operationId:delayed[9],
      refundTransferAdjustmentId:delayed[10],originalEpoch:owner.epoch,reviewEpoch:owner.epoch,reason:'Fictional confirmed absent attempt'}});
    assert.deepEqual(await retire(delayed),retired);
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await command(finance,name,delayed),{state:'conflict',reason:'operation'});
    assert.deepEqual(await command(finance,name,[...tipInput.slice(0,-3),'Changed review',tipInput.at(-2),tipInput.at(-1)]),
      {state:'conflict',reason:'operation'});
    assert.deepEqual(await journal(tipCredit.eventId),[
      {purpose:'refund_transfer_funds',account_id:funds,debit_cents:'0',credit_cents:'2'},
      {purpose:'refund_transfer_money',account_id:depositBank,debit_cents:'2',credit_cents:'0'},
    ]);
    await assert.rejects(command(finance,name,args()),{message:'REFUND_TRANSFER_RANGE_UNAVAILABLE'});
    await assert.rejects(command(finance,name,args({parts:[range('102')],external:tipInput.at(-2)})),
      {message:'REFUND_TRANSFER_EXTERNAL_ID_ALREADY_RECORDED'});
    const retry=await committed(finance,name,args({prior:tipCredit.eventId,kind:'retry',channel:returnChannel}));
    assert.equal(retry.originalEventId,firstTipReturn.eventId);
    assert.equal(retry.priorEventId,tipCredit.eventId);
    assert.deepEqual(await journal(retry.eventId),[
      {purpose:'refund_transfer_funds',account_id:funds,debit_cents:'1',credit_cents:'0'},
      {purpose:'refund_transfer_money',account_id:returnBank,debit_cents:'0',credit_cents:'1'},
    ]);
    await assert.rejects(command(finance,name,args({prior:tipCredit.eventId,kind:'retry'})),{message:'REFUND_TRANSFER_RANGE_UNAVAILABLE'});
    const secondRecredit=await committed(finance,name,args({prior:retry.eventId}));
    assert.equal(secondRecredit.originalEventId,firstTipReturn.eventId);
    assert.equal(secondRecredit.fundingOriginId,tipCredit.fundingOriginId);
    await assert.rejects(command(finance,name,args({prior:retry.eventId,parts:[range('103')]})),{message:'REFUND_TRANSFER_RANGE_UNAVAILABLE'});

    const excessCredit=await committed(finance,name,args({prior:originalExcess.eventId,cents:'10',parts:[range('1001','1010')]}));
    const serviceCredit=await committed(finance,name,args({prior:originalService.eventId,cents:'20',parts:[range('1','20')]}));
    assert.deepEqual([excessCredit.originalTemplate,excessCredit.obligationType,excessCredit.fundingOriginId,excessCredit.fundLotId],
      ['P09','excess',received.fundingOriginId,received.heldFunds.lotId]);
    assert.deepEqual([serviceCredit.originalTemplate,serviceCredit.obligationType,serviceCredit.fundingOriginId,serviceCredit.fundLotId],
      ['P08','service',servicePaid.fundingOriginId,paired.release.fundLotId]);
    await assert.rejects(command(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),excessCredit.fundLotId,invoice.receivableId,owner.customer,today,'1001','1001','Fictional review',
    ]),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    assert.equal((await returnTip('3')).cents,'3');

    const another=await sandbox.connect(target);
    await another.query('SET ROLE crest_finance_preview');
    const results=await Promise.allSettled([finance,another].map(conn=>command(conn,name,args({prior:serviceCredit.eventId,kind:'retry',parts:[range('1')]}))));
    assert.equal(results.filter(result=>result.status==='fulfilled'&&result.value.state==='committed').length,1);
    assert.equal(results.find(result=>result.status==='rejected')?.reason.message,'REFUND_TRANSFER_RANGE_UNAVAILABLE');
    assert.equal((await admin.query('SELECT count(*)::int AS roots FROM crest.funding_origins WHERE business_id=$1',[owner.business])).rows[0].roots,before);
    for(const [index,eventId] of originalEvents.entries())assert.deepEqual(await journal(eventId),retained[index]);
    const liability=(await admin.query("SELECT sum(credit_cents-debit_cents)::text AS cents FROM crest.journal_lines WHERE business_id=$1 AND purpose='refund_transfer_funds'",[owner.business])).rows[0].cents;
    assert.equal(liability,'31');
    const unchanged=(await admin.query(
      "SELECT a.code,sum(l.credit_cents-l.debit_cents)::text AS cents FROM crest.journal_lines l JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id) WHERE l.business_id=$1 AND a.code IN('4000','4100','2100','4910') GROUP BY a.code ORDER BY a.code",
      [owner.business])).rows;
    assert.deepEqual(unchanged,[{code:'2100',cents:'0'},{code:'4000',cents:'25000'},{code:'4100',cents:'0'},{code:'4910',cents:'-20'}]);
    await assert.rejects(command(finance,'read_fictional_trial_balance_v9',[...owner.auth(),today]),
      {message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});
    const reportArgs=[...owner.auth(),today];
    const rawBalance=await command(finance,'read_fictional_trial_balance_v10',reportArgs);
    const balance=parseFictionalTrialBalanceV10(rawBalance,owner.business,today);
    assert.equal(balance.totals.debitCents,balance.totals.creditCents);
    assert.equal(balance.rows.find(row=>row.accountId===funds).balanceCents,'-221');
    assert.equal(balance.refundDue.totalCents,'31');
    assert.equal(balance.refundDue.count,'4');
    assert.deepEqual(Object.fromEntries(balance.refundDue.rows.map(row=>[row.recreditEventId,row.remainingCents])),{
      [tipCredit.eventId]:'1',[secondRecredit.eventId]:'1',[excessCredit.eventId]:'10',[serviceCredit.eventId]:'19',
    });
    assert.equal((await command(finance,'read_fictional_customer_funds',reportArgs)).totalCents,'190');
    assert.equal((await command(finance,'read_fictional_receivable_aging',reportArgs)).totalCents,'0');
    const rawJournal=await command(finance,'read_fictional_journal_v10',[...reportArgs,null,null,100]);
    const journalReport=parseFictionalJournalV10(rawJournal,owner.business,today,null,null,100);
    assert.equal(journalReport.refundDue.totalCents,'31');
    assert.deepEqual(journalReport.rows.filter(row=>row.refundTransferAdjustmentId===retry.refundTransferAdjustmentId)
      .map(row=>[row.refundTransferKind,row.priorRefundEventId,row.originalRefundEventId,row.purpose]).sort(),[
        ['retry',tipCredit.eventId,firstTipReturn.eventId,'refund_transfer_funds'],
        ['retry',tipCredit.eventId,firstTipReturn.eventId,'refund_transfer_money'],
      ]);
    const tampered=structuredClone(rawJournal);
    tampered.rows.find(row=>row.refundTransferAdjustmentId===retry.refundTransferAdjustmentId).originalRefundEventId=randomUUID();
    assert.throws(()=>parseFictionalJournalV10(tampered,owner.business,today,null,null,100));
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'refund_transfer_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'refund_transfer_source_snapshot',[owner.business]),{code:'42501'});
    await assert.rejects(exporter.query('SELECT id FROM crest.refund_transfer_adjustments'),{code:'42501'});
    const coverage={
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,
    };
    const capture=(connection,includeRefundTransferAdjustments=true)=>captureFinanceSourceExport(owner.business,
      async(sql,parameters)=>(await connection.query(sql,parameters)).rows,{...coverage,includeRefundTransferAdjustments});
    let archive;
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v12');
      assert.equal(verified.balancedJournalEntries,17);
      assert.ok(archive.files.find(file=>file.name==='refund_transfer_adjustments.csv').content.includes(tipCredit.refundTransferAdjustmentId));
      assert.ok(archive.files.find(file=>file.name==='refund_transfer_adjustment_ranges.csv').content.includes(retry.refundTransferAdjustmentId));
      const manifest=JSON.parse(archive.manifest);
      const changedFiles=archive.files.map(file=>{
        if(file.name!=='refund_transfer_adjustment_ranges.csv')return file;
        const lines=file.content.split('\r\n');
        const index=lines.findIndex(line=>line.includes(secondRecredit.refundTransferAdjustmentId));
        assert.ok(index>0);
        // Change an exact restored root range, preserving the checksum and row shape.
        lines[index]=lines[index].replace(/"101","101"$/,'"103","103"');
        const content=lines.join('\r\n');
        assert.notEqual(content,file.content);
        const entry=manifest.files.find(row=>row.name===file.name);
        entry.bytes=Buffer.byteLength(content);
        entry.sha256=createHash('sha256').update(content).digest('hex');
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),changedFiles,owner.business),
        {message:'REFUND_TRANSFER_SOURCE_REVIEW_REQUIRED'});
    } finally {
      await exporter.query('ROLLBACK');
    }
    const neutral=await sandbox.connect(await sandbox.database());
    const imported=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,coverage);
    assert.equal(imported.tables,37);
    assert.equal(imported.entries,17);
    assert.equal(imported.debit,imported.credit);

    const readerRole='crest_test_refund_export_'+randomBytes(8).toString('hex');
    const readerPassword=randomBytes(32).toString('hex');
    await admin.query('CREATE ROLE '+readerRole+" LOGIN NOINHERIT PASSWORD '"+readerPassword+"'");
    try {
      await admin.query('GRANT crest_export TO '+readerRole+' WITH INHERIT FALSE, SET TRUE');
      const readerUrl=new URL(target);
      readerUrl.username=readerRole;
      readerUrl.password=readerPassword;
      const collect=createServiceRefundSourceCollector({
        businessId:owner.business,environment:'test',connectionString:readerUrl.href,
      },true,true,true,true,true);
      const collected=(await collect(AbortSignal.timeout(15000))).forFinanceServer();
      const selectedProfile=postedFinanceProfileForSchema(96);
      assert.equal(selectedProfile,'crest.posted-finance-source.v12');
      assert.equal(postedFinanceProfileForSchema(95),'crest.posted-finance-source.v11');
      assert.equal(collected.profile,selectedProfile);
      assert.equal(verifyFinanceSourceExport(collected.manifest,collected.files,owner.business).balancedJournalEntries,17);
      assert.deepEqual(collected.files.filter(file=>file.name.endsWith('.csv')),
        archive.files.filter(file=>file.name.endsWith('.csv')));
      assert.deepEqual(await command(web,'authorize_posted_finance_export',owner.auth()),{
        schemaVersion:1,businessId:owner.business,actorId:owner.actor,recoveryEpoch:owner.epoch,
      });
      const manifestHash=createHash('sha256').update(collected.manifest).digest('hex');
      const handoff=await command(web,'record_posted_finance_export_access',[
        ...owner.auth(),owner.epoch,96,'a'.repeat(40),JSON.parse(collected.manifest).observedAt,manifestHash,'b'.repeat(64),1000,
      ]);
      assert.equal(handoff.state,'authorized_handoff');
      assert.equal(handoff.scope.profile,selectedProfile);
      assert.equal(handoff.scope.sourceSchemaVersion,96);
      assert.equal(handoff.scope.manifestSha256,manifestHash);
      assert.deepEqual((await admin.query('SELECT delta FROM crest_private.audit_events WHERE id=$1',[
        handoff.auditEventId,
      ])).rows[0].delta.after,handoff.scope);
    } finally {
      await admin.query('DROP ROLE '+readerRole);
    }

    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      archive=(await capture(exporter)).forServer();
    } finally {
      await exporter.query('ROLLBACK');
    }

    const workspace=await privateWorkspace();
    let destination,restored;
    try {
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupRefundTransferDatabase(candidate,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,96);
      assert.equal(manifest.heldRefundTransferMigrationSha256,checked.profile.heldRefundTransferMigrationSha256);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreRefundTransferDatabase(candidate,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const recovered=(await capture(restored)).forServer();
        assert.deepEqual(recovered.files,archive.files);
        assert.equal(verifyFinanceSourceExport(recovered.manifest,recovered.files,owner.business).profile,'crest.posted-finance-source.v12');
      } finally {
        await restored.query('ROLLBACK');
      }
      await restored.query('RESET ROLE');
      await restored.query('SET ROLE crest_finance_preview');
      const restoredLookup=input=>command(restored,'lookup_fictional_refund_transfer_adjustment',[
        ...owner.auth(),owner.epoch,input[9],input[10],
      ]);
      assert.deepEqual(await restoredLookup(tipInput),{state:'committed',receipt:tipCredit});
      assert.deepEqual(await restoredLookup(delayed),retired);
      const restoredReport=parseFictionalTrialBalanceV10(
        await command(restored,'read_fictional_trial_balance_v10',reportArgs),owner.business,today);
      assert.deepEqual(restoredReport.refundDue,balance.refundDue);
    } finally {
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
    await assert.rejects(admin.query('UPDATE crest.refund_transfer_adjustments SET reason=reason WHERE id=$1',[tipCredit.refundTransferAdjustmentId]),
      {code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
