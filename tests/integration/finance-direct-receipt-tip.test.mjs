import assert from 'node:assert/strict';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDirectReceiptTipDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDirectReceiptTipDatabase} from '../support/recovery-drill.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {directReceiptTipRecoveryProfile} from '../support/finance-direct-receipt-tip-candidate.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';
import {parseFictionalJournalV11} from '../../src/bookkeeping/posted-report-v11-contract.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';

async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('P03 explicit tip posts with one receipt root and exact existing refund and failure lineage',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    assert.equal((await sandbox.apply(target,await sandbox.prefix(96))).history.length,96);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const service=randomUUID();
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-direct-tip',active:true,
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
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today,appointmentDay:yesterday});
    const foreign=await makeOwner();
    const revenue=randomUUID(),tax=randomUUID(),district='Fictional reviewed tip district';
    for(const [id,identity] of [[revenue,{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'}],
      [tax,{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'}]]){
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
    }
    const revenueMapping=await committed(finance,'approve_fixed_finance_mapping',[...mutate(),'tips_revenue','0',revenue,'2026-01-01','Fictional review']);
    const profile=await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'tip',null,'0','2026-01-01',
      'inclusive_single','0.1','Fictional tax evidence','Fictional review']);
    const taxMapping=await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tax,'2026-01-01','Fictional tax mapping']);
    const candidate=await sandbox.prefix(97);
    const checked=await directReceiptTipRecoveryProfile(candidate,sandbox.root);
    const adoption=await sandbox.apply(target,candidate);
    assert.equal(adoption.history.length,97);
    assert.equal(adoption.registrySha256,checked.profile.registrySha256);
    const evidence=(id=randomUUID())=>({namespace:'ledger',id,rawReference:'Fictional settled movement'});
    const tipInput=({id=randomUUID(),cents='6',confirmation='Customer explicitly confirmed a six-cent tip',taxProfileId=profile.id,
      revenueMappingId=revenueMapping.id,taxMappingId=taxMapping.id,jurisdiction=district}={})=>({
      tipRealizationId:id,cents,jurisdiction,taxProfileId,revenueMappingId,taxMappingId,confirmation,
    });
    const args=({gross='6',tip=tipInput(),applied={},fundsMapping=mapping,external=evidence(),paymentId=randomUUID(),
      operation=randomUUID(),customer=owner.customer}={})=>[
      ...owner.auth(),owner.epoch,operation,paymentId,customer,depositChannel,'1',today,gross,
      'Fictional owner verified the gross settled receipt',null,external,applied,fundsMapping,tip,
    ];
    const name='record_direct_fictional_receipt_with_tip';
    const readOptions=(jurisdiction=null,customer=owner.customer)=>command(finance,'read_direct_fictional_receipt_tip_options',[
      ...owner.auth(),customer,today,jurisdiction,
    ]);
    assert.deepEqual(await readOptions(),{state:'ready',schemaVersion:1,businessId:owner.business,customerId:owner.customer,
      actualOn:today,openPeriod:true,fundsMappingId:mapping,jurisdictions:[district],selected:null});
    const reviewed=await readOptions(district);
    assert.equal(reviewed.selected.jurisdiction,district);
    assert.equal(reviewed.selected.treatment,'inclusive_single');
    assert.equal(Number(reviewed.selected.rate),0.1);
    assert.deepEqual([reviewed.selected.taxProfileId,reviewed.selected.revenueMappingId,reviewed.selected.taxMappingId],
      [profile.id,revenueMapping.id,taxMapping.id]);
    assert.deepEqual(await readOptions(null,randomUUID()),{state:'absent'});
    assert.equal((await readOptions('Fictional unreviewed place')).selected,null);
    await assert.rejects(command(web,name,args()),{code:'42501'});
    await assert.rejects(command(finance,name,args({tip:tipInput({confirmation:''})})),{message:'DIRECT_RECEIPT_TIP_INPUT_REQUIRED'});
    await assert.rejects(command(finance,name,args({tip:tipInput({taxProfileId:randomUUID()})})),{message:'DIRECT_RECEIPT_TIP_BASIS_REQUIRED'});
    await assert.rejects(command(finance,name,args({tip:tipInput({cents:'7'})})),{message:'DIRECT_RECEIPT_TIP_AMOUNT_REQUIRED'});
    await assert.rejects(command(finance,name,args({applied:{[invoice.receivableId]:'1'}})),{message:'DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED'});
    const before=(await admin.query('SELECT count(*)::int AS n FROM crest.payments')).rows[0].n;
    assert.equal(before,0);

    const pureInput=args(), pure=await committed(finance,name,pureInput);
    assert.equal(pure.schemaVersion,3);
    assert.deepEqual(pure.applications,[]);
    assert.equal(pure.heldFunds,null);
    assert.deepEqual([pure.tip.firstCent,pure.tip.lastCent,pure.tip.inclusiveCents,pure.tip.netCents,pure.tip.taxCents],
      ['1','6','6','5','1']);
    assert.deepEqual(await committed(finance,name,pureInput),pure);
    const changed=[...pureInput];changed[21]={...pureInput[21],confirmation:'Changed tip intent'};
    assert.deepEqual(await command(finance,name,changed),{state:'conflict',reason:'operation'});
    const lookup=input=>command(finance,'lookup_direct_fictional_receipt',[...owner.auth(),owner.epoch,input[9],input[10]]);
    assert.deepEqual(await lookup(pureInput),{state:'committed',receipt:pure});
    const delayed=args();
    const retired=await command(finance,'retire_direct_fictional_receipt',[
      ...owner.auth(),owner.epoch,delayed[9],owner.epoch,delayed[10],'Fictional confirmed absent attempt',
    ]);
    assert.equal(retired.state,'retired');
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await command(finance,name,delayed),{state:'conflict',reason:'operation'});

    const split=await committed(finance,name,args({gross:'108',applied:{[invoice.receivableId]:'100'}}));
    assert.deepEqual([split.schemaVersion,split.applications[0].cents,split.tip.firstCent,split.tip.lastCent,split.heldFunds.cents],
      [3,'100','101','106','2']);
    const original=(await admin.query('SELECT count(*)::int AS roots FROM crest.funding_origins WHERE business_id=$1',[owner.business])).rows[0].roots;
    assert.equal(original,2);
    const journal=async event=>(await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id) WHERE j.event_id=$1 ORDER BY l.purpose',
      [event])).rows;
    assert.deepEqual(await journal(pure.eventId),[
      {purpose:'receipt_money',account_id:depositBank,debit_cents:'6',credit_cents:'0'},
      {purpose:'tip_revenue',account_id:revenue,debit_cents:'0',credit_cents:'5'},
      {purpose:'tip_tax',account_id:tax,debit_cents:'0',credit_cents:'1'},
    ]);
    assert.deepEqual(await journal(split.eventId),[
      {purpose:'receipt_ar',account_id:ar,debit_cents:'0',credit_cents:'100'},
      {purpose:'receipt_funds',account_id:funds,debit_cents:'0',credit_cents:'2'},
      {purpose:'receipt_money',account_id:depositBank,debit_cents:'108',credit_cents:'0'},
      {purpose:'tip_revenue',account_id:revenue,debit_cents:'0',credit_cents:'5'},
      {purpose:'tip_tax',account_id:tax,debit_cents:'0',credit_cents:'1'},
    ]);
    const anchor=(await admin.query('SELECT id FROM crest.customer_fund_lots WHERE receipt_tip_event_id=$1',[pure.eventId])).rows[0].id;
    const apply=()=>command(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),anchor,invoice.receivableId,owner.customer,today,'1','1','Fictional review',
    ]);
    await assert.rejects(apply(),{message:'FUND_APPLICATION_LOT_REQUIRED'});
    const fundsReport=()=>command(finance,'read_fictional_customer_funds',[...owner.auth(),today]);
    assert.deepEqual((await fundsReport()).rows.map(row=>[row.lotId,row.heldCents]),[[split.heldFunds.lotId,'2']]);

    const tipOptions=await command(finance,'read_fictional_tip_return_options',[...owner.auth(),owner.customer,today]);
    assert.deepEqual(tipOptions.tips.map(row=>row.tipRealizationId).sort(),[pure.tip.tipRealizationId,split.tip.tipRealizationId].sort());
    const returnTip=await committed(finance,'record_fictional_tip_return',[
      ...mutate(),randomUUID(),split.tip.tipRealizationId,owner.customer,returnChannel,'1',today,
      'Fictional settled return','Fictional owner reviewed return',evidence(),'3',
    ]);
    assert.deepEqual([returnTip.originalTipEventId,returnTip.netCents,returnTip.taxCents,returnTip.ranges],
      [split.eventId,'3','0',[{firstCent:'1',lastCent:'3'}]]);
    const collectionOptions=await command(finance,'read_fictional_collection_failure_options',[...owner.auth(),owner.customer,split.paymentId,today]);
    assert.deepEqual(collectionOptions.components.find(row=>row.kind==='tip').availableRanges,[{firstCent:'4',lastCent:'6'}]);
    assert.deepEqual(collectionOptions.components.filter(row=>row.kind==='funds').map(row=>row.sourceId),[split.heldFunds.lotId]);
    const fail=first=>command(finance,'record_fictional_collection_failure',[
      ...mutate(),randomUUID(),split.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'1',
      'Fictional verified debit','Fictional owner review',evidence(),
      JSON.stringify([{kind:'tip',sourceId:split.tip.tipRealizationId,firstCent:first,lastCent:first}]),
    ]);
    await assert.rejects(fail('3'),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    const failed=await fail('4');
    assert.equal(failed.state,'committed');
    assert.deepEqual([failed.receipt.components[0].rootFirstCent,failed.receipt.components[0].netCents,failed.receipt.components[0].taxCents],
      ['104','0','1']);
    const recredit=await committed(finance,'record_fictional_refund_transfer_adjustment',[
      ...mutate(),randomUUID(),returnTip.eventId,owner.customer,'recredit',depositChannel,'1',today,'1',
      'Fictional verified recredit','Fictional reviewed recredit',evidence(),JSON.stringify([{firstCent:'101',lastCent:'101'}]),
    ]);
    assert.deepEqual([recredit.originalEventId,recredit.fundingOriginId,recredit.obligationType],
      [returnTip.eventId,split.fundingOriginId,'tip_return_due']);
    const report=await command(finance,'read_fictional_trial_balance_v10',[...owner.auth(),today]);
    assert.equal(report.totals.debitCents,report.totals.creditCents);
    assert.equal(report.refundDue.totalCents,'1');
    assert.equal(report.rows.find(row=>row.accountId===funds).balanceCents,'-3');
    assert.deepEqual((await fundsReport()).rows.map(row=>[row.lotId,row.heldCents]),[[split.heldFunds.lotId,'2']]);
    const journalPage=await command(finance,'read_fictional_journal_v11',[...owner.auth(),today,null,null,100]);
    const typed=parseFictionalJournalV11(journalPage,owner.business,today,null,null,100);
    assert.equal(typed.rows.filter(row=>row.template==='P03'&&row.tipRealizationId!==null).length,4);
    assert.equal(typed.refundDue.totalCents,'1');
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'direct_receipt_tip_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'direct_receipt_tip_source_snapshot',[owner.business]),{code:'42501'});
    await assert.rejects(exporter.query('SELECT receipt_tip_event_id FROM crest.customer_fund_lots'),{code:'42501'});
    const options={includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true};
    const capture=(connection,includeDirectReceiptTips=true)=>captureFinanceSourceExport(owner.business,
      async(sql,parameters)=>(await connection.query(sql,parameters)).rows,{...options,includeDirectReceiptTips});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let archive;
    try {
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v13');
      assert.equal(verified.balancedJournalEntries,6);
      assert.ok(archive.files.find(file=>file.name==='customer_fund_lots.csv').content.includes(pure.eventId));
      const manifest=JSON.parse(archive.manifest);
      const changedFiles=archive.files.map(file=>{
        if(file.name!=='customer_fund_lots.csv')return file;
        const content=file.content.replace(pure.eventId,randomUUID());
        assert.notEqual(content,file.content);
        const entry=manifest.files.find(row=>row.name===file.name);
        entry.bytes=Buffer.byteLength(content);
        entry.sha256=createHash('sha256').update(content).digest('hex');
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),changedFiles,owner.business),
        {message:'DIRECT_RECEIPT_TIP_SOURCE_REVIEW_REQUIRED'});
    } finally {
      await exporter.query('ROLLBACK');
    }
    const neutral=await sandbox.connect(await sandbox.database());
    const imported=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,options);
    assert.equal(imported.tables,37);
    assert.equal(imported.entries,6);
    assert.equal(imported.debit,imported.credit);

    const workspace=await privateWorkspace();
    let destination,restored;
    try {
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupDirectReceiptTipDatabase(candidate,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,97);
      assert.equal(manifest.heldDirectReceiptTipMigrationSha256,checked.profile.heldDirectReceiptTipMigrationSha256);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreDirectReceiptTipDatabase(candidate,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const replay=(await capture(restored)).forServer();
        assert.deepEqual(replay.files,archive.files);
        assert.equal(verifyFinanceSourceExport(replay.manifest,replay.files,owner.business).profile,'crest.posted-finance-source.v13');
      } finally {
        await restored.query('ROLLBACK');
      }
      await restored.query('RESET ROLE');
      await restored.query('SET ROLE crest_finance_preview');
      const lookupRestored=input=>command(restored,'lookup_direct_fictional_receipt',[...owner.auth(),owner.epoch,input[9],input[10]]);
      assert.deepEqual(await lookupRestored(pureInput),{state:'committed',receipt:pure});
      assert.deepEqual(await lookupRestored(delayed),retired);
    } finally {
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
