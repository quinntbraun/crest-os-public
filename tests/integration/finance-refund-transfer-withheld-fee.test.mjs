import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupRefundTransferFeeDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreRefundTransferFeeDatabase} from '../support/recovery-drill.mjs';
import {refundTransferFeeRecoveryProfile} from '../support/finance-refund-transfer-fee-candidate.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {parseFictionalJournalV12} from '../../src/bookkeeping/posted-report-v12-contract.ts';
import {parseFictionalJournalV11} from '../../src/bookkeeping/posted-report-v11-contract.ts';
import {parseFictionalTrialBalanceV10} from '../../src/bookkeeping/posted-report-v10-contract.ts';

async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('a provider-withheld fee records one net deposit, one expense and the full original refund obligation',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const prior=await sandbox.prefix(97);
    assert.equal((await sandbox.apply(target,prior)).history.length,97);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;

    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner();
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
    const evidence=(label)=>({namespace:'ledger',id:randomUUID(),rawReference:label});
    const incoming=await committed(finance,'record_direct_fictional_receipt_with_funds',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'200',
      'Fictional original settlement',null,evidence('Original settlement'),{},mapping,
    ]);
    const originalReturn=(first,last)=>committed(finance,'record_fictional_excess_return',[
      ...mutate(),randomUUID(),incoming.paymentId,incoming.heldFunds.lotId,owner.customer,returnChannel,'1',today,
      first,last,'Fictional settled refund','Fictional verified return',evidence('Original outward refund'),'100',
    ]);
    const original=await originalReturn('1','100');
    const other=await originalReturn('101','200');
    const candidate=await sandbox.prefix(98);
    const checked=await refundTransferFeeRecoveryProfile(candidate,prior,sandbox.root);
    const adopted=await sandbox.apply(target,candidate);
    assert.equal(adopted.history.length,98);
    assert.equal(adopted.registrySha256,checked.profile.registrySha256);
    const optName='read_fictional_refund_transfer_fee_option';
    const options=(prior=original.eventId,customer=owner.customer)=>command(finance,optName,[...owner.auth(),customer,prior,today]);
    assert.deepEqual(await options(),{
      state:'ready',schemaVersion:1,businessId:owner.business,customerId:owner.customer,priorEventId:original.eventId,
      actualOn:today,feeMapping:null,
    });
    assert.deepEqual(await options(original.eventId,randomUUID()),{state:'absent'});
    await assert.rejects(command(web,optName,[...owner.auth(),owner.customer,original.eventId,today]),{code:'42501'});
    await assert.rejects(finance.query('SELECT adjustment_id FROM crest.refund_transfer_embedded_fees'),{code:'42501'});

    const feeAccount=randomUUID();
    const label='Fictional payment provider fees';
    await committed(finance,'save_finance_account',[...mutate(),1,feeAccount,'0',{
      identity:{code:'5300',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'fee'},
      name:label,active:true,reason:null,
    }]);
    const feeMapping=(await committed(finance,'approve_fixed_finance_mapping',
      [...mutate(),'fee','0',feeAccount,'2026-01-01','Fictional processing fee account review'])).id;
    assert.deepEqual((await options()).feeMapping,{mappingId:feeMapping,accountId:feeAccount,label});

    const base='record_fictional_refund_transfer_adjustment';
    const withFee=base+'_with_fee';
    const scope=(first,last)=>JSON.stringify([{firstCent:first,lastCent:last}]);
    const args=({prior=original.eventId,kind='recredit',channel=depositChannel,cents='100',first='1',last='100',
      external=evidence('Net recredit observed in statement'),operation=randomUUID(),adjustment=randomUUID()}={})=>[
       ...owner.auth(),owner.epoch,operation,adjustment,prior,owner.customer,kind,channel,'1',today,cents,
       'Fictional statement reviewed against actual settlement','Fictional failed outgoing refund',external,scope(first,last),
    ];
    const fee=(patch={})=>({netCents:'95',cents:'5',mappingId:feeMapping,
      confirmation:'Fictional provider withheld this exact fee',externalIdentity:null,...patch});
    await assert.rejects(command(finance,withFee,[...args(),fee({netCents:'94'})]),{message:'REFUND_TRANSFER_FEE_AMOUNT_REQUIRED'});
    await assert.rejects(command(finance,withFee,[...args(),fee({mappingId:mapping})]),{message:'REFUND_TRANSFER_FEE_MAPPING_REQUIRED'});
    await assert.rejects(command(finance,withFee,[...args({kind:'retry'}),fee()]),{message:'REFUND_TRANSFER_FEE_INPUT_REQUIRED'});
    await assert.rejects(command(finance,withFee,[...args(),fee({externalIdentity:{}})]),{message:'REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED'});

    const shared=evidence('One provider envelope for the net settlement and retained fee');
    const request=args({external:shared});
    const held=await committed(finance,withFee,[...request,fee()]);
    assert.equal(held.schemaVersion,2);
    assert.equal(held.originalEventId,original.eventId);
    assert.equal(held.originalTemplate,'P09');
    assert.equal(held.fundLotId,incoming.heldFunds.lotId);
    assert.equal(held.cents,'100');
    assert.deepEqual(held.embeddedFee,{
      cents:'5',netCents:'95',mappingId:feeMapping,accountId:feeAccount,evidenceId:held.evidenceId,
      confirmation:fee().confirmation,
    });
    const lookup=[...owner.auth(),request[8],request[9],request[10]];
    assert.deepEqual(await command(finance,'lookup_fictional_refund_transfer_adjustment',lookup),{state:'committed',receipt:held});
    assert.deepEqual(await committed(finance,withFee,[...request,fee({externalIdentity:shared})]),held);
    assert.deepEqual(await command(finance,withFee,[...request,fee({netCents:'94',cents:'6'})]),{state:'conflict',reason:'operation'});
    assert.deepEqual(await command(finance,base,request),{state:'conflict',reason:'operation'});
    assert.deepEqual(await options(),{state:'absent'});

    const deduction=evidence('Provider supplied a distinct fee component key');
    const second=args({prior:other.eventId,first:'101',last:'150',cents:'50'});
    const part=fee({netCents:'47',cents:'3',externalIdentity:deduction});
    const separate=await committed(finance,withFee,[...second,part]);
    assert.notEqual(separate.embeddedFee.evidenceId,separate.evidenceId);
    assert.deepEqual(await committed(finance,withFee,[...second,part]),separate);
    await assert.rejects(command(finance,base,args({prior:other.eventId,external:deduction,first:'151',last:'200',cents:'50'})),
      {message:'REFUND_TRANSFER_EXTERNAL_ID_ALREADY_RECORDED'});
    await assert.rejects(command(finance,base,args({prior:other.eventId,external:shared,first:'151',last:'200',cents:'50'})),
      {message:'REFUND_TRANSFER_EXTERNAL_ID_ALREADY_RECORDED'});
    const supplies=randomUUID(), expense=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,supplies,'0',{
      identity:{code:'5000',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'expense'},
      name:'Fictional supplies',active:true,reason:null,
    }]);
    const suppliesMapping=(await committed(finance,'approve_fixed_finance_mapping',
      [...mutate(),'category_supplies','0',supplies,'2026-01-01','Fictional supplies mapping review'])).id;
    await committed(web,'save_expense',[...mutate(),expense,'0',{
      paidOn:today,amountCents:'3',currency:'USD',category:'supplies',description:'Duplicate fee attempt',
      vendor:'Fictional payment provider',paymentMethod:'bank',reference:null,notes:null,voided:false,changeReason:null,
    }]);
    for(const identity of [shared,deduction])await assert.rejects(command(finance,'post_fictional_same_day_expense',[
      ...mutate(),randomUUID(),expense,'1',depositChannel,'1',suppliesMapping,today,today,'none','0',
      null,'Fictional signed statement available',null,'Fictional duplicate fee attempt',identity,
    ]),{message:'PAID_EXPENSE_EXTERNAL_ID_ALREADY_RECORDED'});
    const plain=await committed(finance,base,args({prior:other.eventId,first:'151',last:'200',cents:'50'}));
    assert.equal(plain.schemaVersion,1);
    assert.equal('embeddedFee' in plain,false);
    const oldRequest=args({prior:held.eventId,kind:'retry',channel:returnChannel});
    const read=()=>command(finance,'read_fictional_trial_balance_v10',[...owner.auth(),today]);
    const total=parseFictionalTrialBalanceV10(await read(),owner.business,today);
    assert.equal(total.refundDue.totalCents,'200');
    assert.equal(total.rows.find(row=>row.accountId===feeAccount).balanceCents,'8');
    assert.equal(total.totals.debitCents,total.totals.creditCents);
    const retry=await committed(finance,base,oldRequest);
    assert.equal(retry.schemaVersion,1);
    assert.equal(retry.cents,'100');
    assert.equal(retry.originalEventId,original.eventId);
    assert.equal(retry.fundLotId,held.fundLotId);
    assert.deepEqual(await committed(finance,base,oldRequest),retry);
    assert.equal((await read()).refundDue.totalCents,'100');

    const accounting=(await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text AS debit,l.credit_cents::text AS credit FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id) WHERE j.event_id=$1 ORDER BY l.purpose',
      [held.eventId])).rows;
    assert.deepEqual(accounting,[
      {purpose:'refund_transfer_fee',account_id:feeAccount,debit:'5',credit:'0'},
      {purpose:'refund_transfer_funds',account_id:funds,debit:'0',credit:'100'},
      {purpose:'refund_transfer_money',account_id:depositBank,debit:'95',credit:'0'},
    ]);
    assert.deepEqual((await admin.query(
      'SELECT evidence_id,signed_cents::text AS cents FROM crest.money_movements WHERE event_id=$1',[separate.eventId])).rows,
    [{evidence_id:separate.evidenceId,cents:'47'}]);
    assert.equal((await admin.query('SELECT signed_cents::text AS cents FROM crest.external_money_evidence WHERE id=$1',
      [separate.embeddedFee.evidenceId])).rows[0].cents,'-3');
    assert.equal((await admin.query('SELECT count(*)::integer AS count FROM crest.funding_origins WHERE business_id=$1',
      [owner.business])).rows[0].count,1);
    await assert.rejects(admin.query('UPDATE crest.refund_transfer_embedded_fees SET cents=1 WHERE adjustment_id=$1',
      [held.refundTransferAdjustmentId]),{code:'55000'});

    const v12args=[...owner.auth(),today,null,null,100];
    const rawJournal=await command(finance,'read_fictional_journal_v12',v12args);
    const rendered=parseFictionalJournalV12(rawJournal,owner.business,today,null,null,100);
    const feeRows=rendered.rows.filter(row=>row.purpose==='refund_transfer_fee');
    assert.equal(feeRows.length,2);
    assert(feeRows.every(row=>row.code==='5300'&&row.refundTransferKind==='recredit'));
    const v11=await command(finance,'read_fictional_journal_v11',v12args);
    assert.throws(()=>parseFictionalJournalV11(v11,owner.business,today,null,null,100));
    const tampered=structuredClone(rawJournal);
    tampered.rows.find(row=>row.purpose==='refund_transfer_fee').debitCents='4';
    assert.throws(()=>parseFictionalJournalV12(tampered,owner.business,today,null,null,100));

    const coverage={
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,includeRefundTransferFees:true,
    };
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    const sourceCall='refund_transfer_fee_source_snapshot';
    await assert.rejects(command(exporter,sourceCall,[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,sourceCall,[owner.business]),{code:'42501'});
    await assert.rejects(exporter.query('SELECT id FROM crest.refund_transfer_embedded_fees'),{code:'42501'});
    const capture=(connection,includeRefundTransferFees=true)=>captureFinanceSourceExport(owner.business,
      async(sql,parameters)=>(await connection.query(sql,parameters)).rows,{...coverage,includeRefundTransferFees});
    let archive;
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      assert.equal(verifyFinanceSourceExport(archive.manifest,archive.files,owner.business).profile,'crest.posted-finance-source.v14');
      assert.ok(archive.files.find(file=>file.name==='refund_transfer_embedded_fees.csv').content.includes(held.refundTransferAdjustmentId));
      assert.ok(archive.files.find(file=>file.name==='external_money_evidence.csv').content.includes(separate.embeddedFee.evidenceId));
      const manifest=JSON.parse(archive.manifest);
      const changed=archive.files.map(file=>{
        if(file.name!=='refund_transfer_embedded_fees.csv')return file;
        const content=file.content.replace(/"95","5"/u,'"94","5"');
        assert.notEqual(content,file.content);
        const own=manifest.files.find(row=>row.name===file.name);
        own.sha256=createHash('sha256').update(content).digest('hex');
        own.bytes=Buffer.byteLength(content);
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),changed,owner.business),
        {message:'REFUND_TRANSFER_SOURCE_REVIEW_REQUIRED'});
    }finally{
      await exporter.query('ROLLBACK');
    }
    const neutral=await sandbox.connect(await sandbox.database());
    const imported=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,coverage);
    assert.equal(imported.tables,38);
    assert.equal(imported.entries,7);
    assert.equal(imported.debit,imported.credit);

    const workspace=await privateWorkspace();
    let destination,restored;
    try {
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupRefundTransferFeeDatabase(candidate,prior,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,98);
      assert.equal(manifest.heldRefundTransferFeeMigrationSha256,checked.profile.heldRefundTransferFeeMigrationSha256);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreRefundTransferFeeDatabase(candidate,prior,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const replay=(await capture(restored)).forServer();
        assert.deepEqual(replay.files,archive.files);
        assert.equal(verifyFinanceSourceExport(replay.manifest,replay.files,owner.business).profile,'crest.posted-finance-source.v14');
      }finally{
        await restored.query('ROLLBACK');
      }
      await restored.query('SET ROLE crest_finance_preview');
      assert.deepEqual(await command(restored,'lookup_fictional_refund_transfer_adjustment',lookup),{state:'committed',receipt:held});
    }finally{
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
 }finally{
    if(sandbox)await sandbox.close();
    await cluster.close();
 }
});
