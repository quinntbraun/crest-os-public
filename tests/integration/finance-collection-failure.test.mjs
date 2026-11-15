import assert from 'node:assert/strict';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupCollectionFailureDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreCollectionFailureDatabase} from '../support/recovery-drill.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';
import {parseCollectionFailureOptions,parseCollectionFailurePayments,parseCollectionFailureResult,
  collectionFailureMatchesInput,parseCollectionFailureInput} from '../../src/bookkeeping/collection-failure-contract.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {parseCustomerFundsReport} from '../../src/bookkeeping/customer-funds-report-contract.ts';
import {parseReceivableAging} from '../../src/bookkeeping/receivable-aging-contract.ts';
import {parseFictionalJournalV9,parseFictionalTrialBalanceV9} from '../../src/bookkeeping/posted-report-v9-contract.ts';
async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('fictional collection failure retains only selected surviving components and separates corrections from settled debits',{timeout:180000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    assert.equal((await sandbox.apply(target,await sandbox.prefix(94))).history.length,94);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const service=randomUUID();
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-collection-failure',active:true,
        definition:{name:'Fictional service',inclusions:'Interior',exclusions:'',internalGuidance:null,
          rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
      return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
    }});
    const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
    const { today, yesterday, earlier } = (await admin.query(
      "SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today, ((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday, ((statement_timestamp() AT TIME ZONE 'UTC')::date-2)::text AS earlier",
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
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today,appointmentDay:yesterday});
    const secondJob=await makeOwner(owner,{customerId:owner.customer,serviceVersionFor:async()=>
      (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[owner.business,service])).rows[0].id,
    });
    const {invoice:secondInvoice}=await issueInvoice({admin,web,finance,owner:secondJob,service,today,setup:false,appointmentDay:earlier});
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
    const allocation = received.applications[0].id;
    const applyFunds = (lo,hi) => committed(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),lot,secondInvoice.receivableId,owner.customer,today,lo,hi,'Fictional verified application',
    ]);
    const applied = await applyFunds('1031','1040');
    await committed(finance,'record_fictional_excess_return',[
      ...mutate(),randomUUID(),received.paymentId,lot,owner.customer,returnChannel,'1',today,'1001','1010',
      'Fictional settled return','Fictional owner reviewed return',evidence(),'10',
    ]);
    const returnTip = (amount) => committed(finance,'record_fictional_tip_return',[
      ...mutate(),randomUUID(),tipId,owner.customer,returnChannel,'1',today,
      'Fictional settled tip return','Fictional owner reviewed return',evidence(),amount,
    ]);
    const firstTipReturn = await returnTip('3');
    assert.deepEqual(firstTipReturn.ranges,[{firstCent:'1',lastCent:'3'}]);

    const candidate=await sandbox.prefix(95);
    const registered=await sandbox.apply(target,candidate);
    assert.equal(registered.history.length,95);
    assert.deepEqual((await sandbox.apply(target,candidate)).history,registered.history);
    const paymentId=received.paymentId;
    const readPayments='list_fictional_collection_failure_payments';
    const readOptions='read_fictional_collection_failure_options';
    const optionsArgs=[...owner.auth(),owner.customer,paymentId,today];
    const options=async()=>parseCollectionFailureOptions(await command(finance,readOptions,optionsArgs),owner.business,owner.customer,paymentId,today);
    const listed=parseCollectionFailurePayments(await command(finance,readPayments,[...owner.auth(),owner.customer]),owner.business,owner.customer);
    assert.deepEqual(listed.payments,[{paymentId,receivedOn:today,cents:'1200',channelLabel:'Fictional bank 9182'}]);
    await assert.rejects(command(web,readPayments,[...owner.auth(),owner.customer]),{code:'42501'});
    await assert.rejects(command(finance,readOptions,[...foreign.auth(),owner.customer,paymentId,today]),{message:'COLLECTION_FAILURE_ORIGINAL_REQUIRED'});
    await assert.rejects(command(finance,readOptions,[...owner.auth(),owner.customer,paymentId,yesterday]),{message:'COLLECTION_FAILURE_DATE_REQUIRED'});
    const spans=(options,source)=>options.components.find(item=>item.sourceId===source)?.availableRanges;
    const before=await options();
    assert.equal(before.originalAccountLabel,'Fictional bank 9182');
    assert(before.openPeriod);
    assert.equal(before.channels.length,2);
    assert.deepEqual(spans(before,allocation),[{firstCent:'1',lastCent:'100'},{firstCent:'107',lastCent:'1000'}]);
    assert.deepEqual(spans(before,lot),[{firstCent:'1011',lastCent:'1030'},{firstCent:'1041',lastCent:'1200'}]);
    assert.deepEqual(spans(before,tipId),[{firstCent:'4',lastCent:'6'}]);
    const name='record_fictional_collection_failure';
    const component=(kind,sourceId,firstCent,lastCent=firstCent)=>({kind,sourceId,firstCent,lastCent});
    const args=({kind='settled_failure',cents='1',components=[component('allocation',allocation,'1')],
      customer=owner.customer,operation=randomUUID(),id=randomUUID(),date=today,
      channel=kind==='settled_failure'?returnChannel:null,version=kind==='settled_failure'?'1':null,
      external=kind==='settled_failure'?evidence():null,reason='Fictional owner reviewed collection failure'}={})=>[
      ...owner.auth(),owner.epoch,operation,id,paymentId,customer,kind,channel,version,date,cents,
      'Fictional owner confirmed the selected components',reason,external,JSON.stringify(components),
    ];
    const lookup=(attempt)=>command(finance,'lookup_fictional_collection_failure',[
      ...owner.auth(),owner.epoch,attempt[9],attempt[10],
    ]);
    const retire=(attempt)=>command(finance,'retire_fictional_collection_failure',[
      ...owner.auth(),owner.epoch,attempt[9],owner.epoch,attempt[10],'Fictional confirmed absent attempt',
    ]);
    const journal=async(eventId)=> (await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id) WHERE j.event_id=$1 ORDER BY l.purpose,l.debit_cents',
      [eventId],
    )).rows;
    const receivables=async()=>{
      const options=await command(finance,'read_direct_fictional_receipt_options',[...owner.auth(),owner.customer,today]);
      return Object.fromEntries(options.receivables.map(row=>[row.receivableId,row.remainingCents]));
    };
    const priorBalances=await receivables();
    assert.deepEqual(priorBalances,{[invoice.receivableId]:'24006',[secondInvoice.receivableId]:'24990'});
    const originalJournal=await journal(received.eventId);
    const tipJournal=await journal(tip.eventId);
    await assert.rejects(command(web,name,args()),{code:'42501'});
    await assert.rejects(command(finance,name,args({customer:randomUUID()})),{message:'COLLECTION_FAILURE_ORIGINAL_REQUIRED'});
    await assert.rejects(command(finance,name,args({date:yesterday})),{message:'COLLECTION_FAILURE_DATE_REQUIRED'});
    await assert.rejects(command(finance,name,args({version:'2'})),{message:'COLLECTION_FAILURE_VERIFIED_CHANNEL_REQUIRED'});
    await assert.rejects(command(finance,name,args({external:3})),{message:'COLLECTION_FAILURE_EVIDENCE_REQUIRED'});
    await assert.rejects(command(finance,name,args({components:[3]})),{message:'COLLECTION_FAILURE_INPUT_REQUIRED'});
    await assert.rejects(command(finance,name,args({cents:'2'})),{message:'COLLECTION_FAILURE_AMOUNT_UNAVAILABLE'});
    await assert.rejects(command(finance,name,args({kind:'recording_error',channel:returnChannel})),{message:'COLLECTION_FAILURE_ORIGINAL_ACCOUNT_REQUIRED'});
    for(const gone of [component('allocation',allocation,'101'),component('funds',lot,'1001'),component('tip',tipId,'1')]) {
      await assert.rejects(command(finance,name,args({components:[gone]})),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    }
    const components=[
      component('funds',lot,'1011','1020'),component('tip',tipId,'4'),
      component('application',applied.fundApplicationId,'1031','1035'),component('allocation',allocation,'1','50'),
    ];
    const actual=args({cents:'66',components});
    const saved=await committed(finance,name,actual);
    const reference={operationId:actual[9],recoveryEpoch:owner.epoch,collectionFailureId:actual[10]};
    const parsed=parseCollectionFailureResult({state:'committed',receipt:saved},owner.business,reference);
    assert.equal(parsed.state,'committed');
    assert(collectionFailureMatchesInput(parsed.receipt,parseCollectionFailureInput({reference,originalPaymentId:paymentId,
      customerId:owner.customer,kind:actual[13],channelId:actual[14],channelVersion:actual[15],effectiveOn:actual[16],
      verifiedCents:actual[17],confirmation:actual[18],reason:actual[19],externalIdentity:actual[20],components})));
    const after=await options();
    assert.deepEqual(spans(after,allocation),[{firstCent:'51',lastCent:'100'},{firstCent:'107',lastCent:'1000'}]);
    assert.deepEqual(spans(after,lot),[{firstCent:'1021',lastCent:'1030'},{firstCent:'1041',lastCent:'1200'}]);
    assert.deepEqual(spans(after,tipId),[{firstCent:'5',lastCent:'6'}]);
    assert.deepEqual(spans(after,applied.fundApplicationId),[{firstCent:'1036',lastCent:'1040'}]);
    assert.deepEqual(
      [saved.originalPaymentId,saved.customerId,saved.moneyAccountId,saved.moneyChannelId,saved.cents,saved.kind],
      [paymentId,owner.customer,returnBank,returnChannel,'66','settled_failure'],
    );
    assert.ok(saved.moneyMovementId);
    assert.ok(saved.evidenceId);
    assert.deepEqual(saved.components.map(({kind,sourceId,rootFirstCent,rootLastCent,netCents,taxCents})=>
      [kind,sourceId,rootFirstCent,rootLastCent,netCents,taxCents]),[
      ['allocation',allocation,'1','50','50','0'],
      ['tip',tipId,'104','104','0','1'],
      ['funds',lot,'1011','1020','10','0'],
      ['application',applied.fundApplicationId,'1031','1035','5','0'],
    ]);
    assert.deepEqual(await committed(finance,name,[...actual.slice(0,-1),JSON.stringify(components.toReversed())]),saved);
    assert.deepEqual(await command(finance,name,[...actual.slice(0,-1),JSON.stringify([components[0]])]),
      {state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(actual),{state:'committed',receipt:saved});
    assert.deepEqual(await retire(actual),{state:'committed',receipt:saved});
    assert.deepEqual(await command(finance,'lookup_fictional_collection_failure',[...foreign.auth(),owner.epoch,actual[9],actual[10]]),{state:'absent'});
    assert.deepEqual(await command(finance,'lookup_fictional_collection_failure',[...owner.auth(),owner.epoch,actual[9],randomUUID()]),
      {state:'conflict',reason:'operation'});
    assert.deepEqual(await receivables(),{[invoice.receivableId]:'24056',[secondInvoice.receivableId]:'24995'});
    assert.deepEqual((await admin.query('SELECT original_event_id FROM crest.collection_failures WHERE id=$1',[saved.collectionFailureId])).rows,
      [{original_event_id:received.eventId}]);
    await assert.rejects(command(finance,'read_fictional_trial_balance_v8',[...owner.auth(),today]),
      {message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});
    assert.deepEqual(await journal(saved.eventId),[
      {purpose:'collection_failure_ar',account_id:ar,debit_cents:'5',credit_cents:'0'},
      {purpose:'collection_failure_ar',account_id:ar,debit_cents:'50',credit_cents:'0'},
      {purpose:'collection_failure_funds',account_id:funds,debit_cents:'10',credit_cents:'0'},
      {purpose:'collection_failure_money',account_id:returnBank,debit_cents:'0',credit_cents:'66'},
      {purpose:'collection_failure_tip_tax',account_id:tax,debit_cents:'1',credit_cents:'0'},
    ]);
    assert.deepEqual((await admin.query(
      'SELECT m.signed_cents::text,e.signed_cents::text AS evidence_cents FROM crest.money_movements m JOIN crest.external_money_evidence e ON (e.business_id,e.id)=(m.business_id,m.evidence_id) WHERE m.id=$1',
      [saved.moneyMovementId],
    )).rows,[{signed_cents:'-66',evidence_cents:'-66'}]);

    const error=args({kind:'recording_error',cents:'10',components:[component('allocation',allocation,'51','60')]});
    const corrected=await committed(finance,name,error);
    assert.equal(corrected.kind,'recording_error');
    assert.equal(corrected.moneyMovementId,null);
    assert.equal(corrected.evidenceId,null);
    assert.equal(corrected.moneyAccountId,depositBank);
    assert.deepEqual(await lookup(error),{state:'committed',receipt:corrected});
    assert.deepEqual(await journal(corrected.eventId),[
      {purpose:'collection_failure_ar',account_id:ar,debit_cents:'10',credit_cents:'0'},
      {purpose:'collection_failure_money',account_id:depositBank,debit_cents:'0',credit_cents:'10'},
    ]);
    assert.deepEqual((await admin.query('SELECT id FROM crest.money_movements WHERE event_id=$1',[corrected.eventId])).rows,[]);
    assert.deepEqual(await journal(received.eventId),originalJournal);
    assert.deepEqual(await journal(tip.eventId),tipJournal);
    assert.deepEqual(await receivables(),{[invoice.receivableId]:'24066',[secondInvoice.receivableId]:'24995'});
    const serviceRevenue=(await admin.query(`SELECT sum(l.credit_cents-l.debit_cents)::text AS balance
      FROM crest.journal_lines l JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
      WHERE l.business_id=$1 AND a.report_role='service_revenue'`,[owner.business])).rows[0].balance;
    assert.equal(serviceRevenue,'50000');

    for(const already of [component('allocation',allocation,'60'),component('application',applied.fundApplicationId,'1031'),
      component('funds',lot,'1011'),component('tip',tipId,'4')]) {
      await assert.rejects(command(finance,name,args({components:[already]})),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    }
    await assert.rejects(command(finance,name,args({components:[component('allocation',allocation,'61')],external:actual.at(-2)})),
      {message:'COLLECTION_FAILURE_EXTERNAL_ID_ALREADY_RECORDED'});
    await assert.rejects(command(finance,'unapply_fictional_payment_allocation',[
      ...mutate(),randomUUID(),allocation,owner.customer,mapping,today,'1','1','Fictional owner review',
    ]),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    await assert.rejects(command(finance,'record_fictional_excess_return',[
      ...mutate(),randomUUID(),paymentId,lot,owner.customer,returnChannel,'1',today,'1011','1011',
      'Fictional settlement','Fictional owner review',evidence(),'1',
    ]),{message:'EXCESS_RETURN_RANGE_UNAVAILABLE'});
    assert.deepEqual((await returnTip('2')).ranges,[{firstCent:'5',lastCent:'6'}]);

    const delayed=args({components:[component('allocation',allocation,'61')]});
    assert.deepEqual(await lookup(delayed),{state:'absent'});
    const retired=await retire(delayed);
    assert.deepEqual(retired,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,
      operationId:delayed[9],collectionFailureId:delayed[10],originalEpoch:owner.epoch,reviewEpoch:owner.epoch,
      reason:'Fictional confirmed absent attempt'}});
    assert.deepEqual(await retire(delayed),retired);
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await command(finance,name,delayed),{state:'conflict',reason:'operation'});

    const another=await sandbox.connect(target);
    await another.query('SET ROLE crest_finance_preview');
    const race=[finance,another].map(connection=>command(connection,name,args({components:[component('allocation',allocation,'62')]})));
    const outcomes=await Promise.allSettled(race);
    assert.equal(outcomes.filter(result=>result.status==='fulfilled'&&result.value.state==='committed').length,1);
    const refusal=outcomes.find(result=>result.status==='rejected');
    assert.equal(refusal?.reason.message,'COLLECTION_FAILURE_RANGE_UNAVAILABLE');
    assert.deepEqual((await admin.query('SELECT count(*)::int AS count FROM crest.collection_failures WHERE business_id=$1',[owner.business])).rows,[{count:3}]);
    const balances=async(principal=owner,through=today)=>parseFictionalTrialBalanceV9(
      await command(finance,'read_fictional_trial_balance_v9',[...principal.auth(),through]),principal.business,through,
    );
    const report=await balances();
    const book=Object.fromEntries(report.rows.map(row=>[row.code,row.balanceCents]));
    assert.deepEqual(book,{'1000':'1190','1001':'-82','1100':'49062','2000':'-170','2100':'0','4000':'-50000','4100':'0'});
    assert.equal(report.totals.debitCents,report.totals.creditCents);
    assert.deepEqual((await balances(foreign)).rows,[]);
    assert.deepEqual((await balances(owner,yesterday)).rows,[]);
    const fundReport=parseCustomerFundsReport(
      await command(finance,'read_fictional_customer_funds',[...owner.auth(),today]),owner.business,today,
    );
    assert.equal(fundReport.totalCents,'170');
    assert.deepEqual(fundReport.rows.map(row=>[row.lotId,row.heldCents]),[[lot,'170']]);
    const aging=parseReceivableAging(
      await command(finance,'read_fictional_receivable_aging',[...owner.auth(),today]),owner.business,today,
    );
    assert.equal(aging.totalCents,'49062');
    assert.deepEqual(Object.fromEntries(aging.rows.map(row=>[row.receivableId,row.outstandingCents])),
      {[invoice.receivableId]:'24067',[secondInvoice.receivableId]:'24995'});
    const loadJournal=(account=null,after=null,pageSize=100)=>command(finance,'read_fictional_journal_v9',[
      ...owner.auth(),today,account,after,pageSize,
    ]);
    const rawJournal=await loadJournal();
    const lines=parseFictionalJournalV9(rawJournal,owner.business,today,null,null,100).rows;
    assert.equal(lines.filter(line=>line.collectionFailureId===saved.collectionFailureId).length,5);
    assert.equal(lines.filter(line=>line.collectionFailureId===corrected.collectionFailureId).length,2);
    assert.deepEqual(lines.filter(line=>line.template==='P11'&&line.purpose==='collection_failure_money')
      .map(line=>[line.collectionFailureKind,line.originalPaymentId,line.accountId,line.creditCents]),[
      ['settled_failure',paymentId,returnBank,'66'],['recording_error',paymentId,depositBank,'10'],['settled_failure',paymentId,returnBank,'1'],
    ]);
    const invalid=structuredClone(rawJournal);
    invalid.rows.find(line=>line.collectionFailureId===saved.collectionFailureId).originalPaymentId=randomUUID();
    assert.throws(()=>parseFictionalJournalV9(invalid,owner.business,today,null,null,100));
    const firstPage=parseFictionalJournalV9(await loadJournal(returnBank,null,2),owner.business,today,returnBank,null,2);
    assert.equal(firstPage.hasMore,true);
    const secondPage=parseFictionalJournalV9(await loadJournal(returnBank,firstPage.nextAfterLineId,2),
      owner.business,today,returnBank,firstPage.nextAfterLineId,2);
    assert.ok(secondPage.rows.every(line=>line.accountId===returnBank));
    await assert.rejects(command(web,'read_fictional_trial_balance_v9',[...owner.auth(),today]),{code:'42501'});
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'collection_failure_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'collection_failure_source_snapshot',[owner.business]),{code:'42501'});
    await assert.rejects(exporter.query('SELECT id FROM crest.collection_failures'),{code:'42501'});
    const coverage={includeCredits:true,includePairedCredits:true,includeServiceRefunds:true,includeExcessReceipts:true,
      includeExcessReturns:true,includeTipReturns:true,includeCollectionFailures:true};
    const capture=(connection,includeCollectionFailures)=>captureFinanceSourceExport(owner.business,
      async(sql,parameters)=>(await connection.query(sql,parameters)).rows,{
        includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
        includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,includeCollectionFailures,
      });
    let archive;
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter,true)).forServer();
      const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v11');
      assert.equal(verified.balancedJournalEntries,12);
      assert.ok(archive.files.find(file=>file.name==='collection_failures.csv').content.includes(saved.collectionFailureId));
      assert.ok(archive.files.find(file=>file.name==='collection_failure_components.csv').content.includes(saved.components[1].componentId));
      assert.ok(archive.files.find(file=>file.name==='tip_realization_range_consumptions.csv').content.includes(saved.components[1].componentId));
      assert.ok(archive.files.find(file=>file.name==='fund_lot_range_consumptions.csv').content.includes(saved.components[2].componentId));
      const manifest=JSON.parse(archive.manifest);
      const changedFiles=archive.files.map(file=>{
        if(file.name!=='collection_failure_components.csv')return file;
        // Preserve the CSV structure and archive digest but sever the P03 lineage.
        const content=file.content.replace(`"${allocation}"`,`"${randomUUID()}"`);
        assert.notEqual(content,file.content);
        const entry=manifest.files.find(row=>row.name===file.name);
        entry.bytes=Buffer.byteLength(content);
        entry.sha256=createHash('sha256').update(content).digest('hex');
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),changedFiles,owner.business),
        {message:'COLLECTION_FAILURE_SOURCE_REVIEW_REQUIRED'});
    } finally {
      await exporter.query('ROLLBACK');
    }
    const neutral=await sandbox.connect(await sandbox.database());
    const imported=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,coverage);
    assert.equal(imported.tables,35);
    assert.equal(imported.entries,12);
    assert.equal(imported.debit,imported.credit);
    const workspace=await privateWorkspace();
    let destination,restored;
    try {
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupCollectionFailureDatabase(candidate,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,95);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreCollectionFailureDatabase(candidate,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const restoredArchive=(await capture(restored,true)).forServer();
        assert.deepEqual(restoredArchive.files,archive.files);
        assert.equal(verifyFinanceSourceExport(restoredArchive.manifest,restoredArchive.files,owner.business).profile,'crest.posted-finance-source.v11');
      }finally{await restored.query('ROLLBACK');}
      await restored.query('RESET ROLE; SET ROLE crest_finance_preview');
      const restoredLookup=attempt=>command(restored,'lookup_fictional_collection_failure',[...owner.auth(),owner.epoch,attempt[9],attempt[10]]);
      assert.deepEqual(await restoredLookup(actual),{state:'committed',receipt:saved});
      assert.deepEqual(await restoredLookup(delayed),retired);
    }finally{
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
    await assert.rejects(admin.query('UPDATE crest.collection_failures SET reason=reason WHERE id=$1',[saved.collectionFailureId]),
      {code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
