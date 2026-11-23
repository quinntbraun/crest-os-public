import {withRecoveryBackupLease} from '../../src/tooling/recovery-backup-lease.ts';
import {verifyRecoveryFundingRanges} from '../../src/tooling/recovery-funding-ranges.ts';
import {verifyRecoveryFundingRoots} from '../../src/tooling/recovery-funding-roots.ts';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupRestoredTipDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreRestoredTipDatabase} from '../support/recovery-drill.mjs';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {parseFictionalJournalV15} from '../../src/bookkeeping/posted-report-v15-contract.ts';

async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values){
 const result=await command(connection,name,values);
 assert.equal(result.state,'committed');
 return result.receipt;
}

test('reinstated original tips retain exact tax offsets through an actual return and repeated collection failure',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const prior=await sandbox.prefix(100);
    assert.equal((await sandbox.apply(target,prior)).history.length,100);
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
    const evidence=label=>({namespace:'ledger',id:randomUUID(),rawReference:label});
    const tipRevenue=randomUUID(),tipTax=randomUUID(),district='Fictional reviewed tip region';
    for(const [id,identity] of [[tipRevenue,{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'}],
      [tipTax,{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'}]]){
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
    }
    const revenueMapping=await committed(finance,'approve_fixed_finance_mapping',[...mutate(),'tips_revenue','0',tipRevenue,'2026-01-01','Fictional review']);
    const profile=await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'tip',null,'0','2026-01-01',
      'inclusive_single','0.1','Fictional tax evidence','Fictional review']);
    const taxMapping=await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tipTax,'2026-01-01','Fictional tax mapping']);
    const tipId=randomUUID();
    const tipped=await committed(finance,'record_direct_fictional_receipt_with_tip',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'6','Fictional settled tip',null,evidence('Prior tip deposit'),{},mapping,
      {tipRealizationId:tipId,cents:'6',jurisdiction:district,taxProfileId:profile.id,revenueMappingId:revenueMapping.id,
        taxMappingId:taxMapping.id,confirmation:'Fictional confirmation of originally received tip'},
    ]);
    const tipFailure=await committed(finance,'record_fictional_collection_failure',[
      ...mutate(),randomUUID(),tipped.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'6',
      'Fictional settled tip failure','Fictional matching prior tip debit',evidence('Prior tip failure debit'),
      JSON.stringify([{kind:'tip',sourceId:tipId,firstCent:'1',lastCent:'6'}]),
    ]);
    const componentFor=async failure=>(await admin.query('SELECT id FROM crest.collection_failure_components WHERE collection_failure_id=$1',
      [failure.collectionFailureId])).rows[0].id;
    const initialComponent=await componentFor(tipFailure);
    assert.equal((await sandbox.apply(target,await sandbox.prefix(101))).history.length,101);
    const record='record_fictional_collection_failure_recredit';
    const range=(component,firstCent,lastCent,confirmed=true)=>({failureComponentId:component,firstCent,lastCent,disposition:'tip',
      ...(confirmed?{intentEvidence:'Fictional customer reconfirmed the same tip'}:{})});
    const args=(failure,parts,cents)=>[
      ...mutate(),randomUUID(),failure.collectionFailureId,owner.customer,depositChannel,'1',today,cents,
      'Fictional actual linked receipt recovery','Fictional review of original tax and confirmed intent',
      evidence('Provider recredit'),JSON.stringify(parts),
    ];
    await assert.rejects(command(finance,record,args(tipFailure,[range(initialComponent,'4','6',false)],'3')),
      {message:'COLLECTION_RECREDIT_INPUT_REQUIRED'});
    const recoveryOptions=await command(finance,'read_fictional_collection_failure_recredit_options',[
      ...owner.auth(),owner.customer,tipFailure.collectionFailureId,today]);
    assert.deepEqual(recoveryOptions.components[0].tipReinstatement,{
      originalTipRealizationId:tipId,originalNetCents:'5',originalTaxCents:'1',taxProfileId:profile.id,
    });
    const start=args(tipFailure,[range(initialComponent,'4','6')],'3');
    const restored=await committed(finance,record,start);
    assert.equal(restored.schemaVersion,3);
    assert.equal(restored.originalPaymentId,tipped.paymentId);
    assert.deepEqual(restored.components[0].tip,{
      tipRealizationId:restored.components[0].tip.tipRealizationId,originalTipRealizationId:tipId,netCents:'2',taxCents:'1',
      intentEvidence:'Fictional customer reconfirmed the same tip',
    });
    const newTip=restored.components[0].tip.tipRealizationId;
    assert.equal(restored.components[0].fundLotId,null);
    const originalLookup=await command(finance,'lookup_fictional_collection_failure_recredit',[...owner.auth(),owner.epoch,start[9],start[10]]);
    assert.deepEqual(originalLookup,{state:'committed',receipt:restored});
    const book=()=>command(finance,'read_fictional_trial_balance_v10',[...owner.auth(),today]);
    const balance=(report,id)=>report.rows.find(row=>row.accountId===id)?.balanceCents;
    assert.equal(balance(await book(),tipTax),'-1');
    const tips=()=>command(finance,'read_fictional_tip_return_options',[...owner.auth(),owner.customer,today]);
    assert.deepEqual((await tips()).tips.map(option=>[option.tipRealizationId,option.availableCents]),[[newTip,'3']]);
    const returnName='record_fictional_tip_return';
    const outgoing=(cents)=>[
      ...mutate(),randomUUID(),newTip,owner.customer,returnChannel,'1',today,
      'Fictional actual provider refund','Fictional verified return of reinstated tip',evidence('Provider tip return'),cents,
    ];
    const request=outgoing('1');
    const returned=await committed(finance,returnName,request);
    assert.deepEqual([returned.cents,returned.netCents,returned.taxCents],['1','0','1']);
    assert.equal(returned.originalTipEventId,restored.eventId);
    assert.deepEqual(await command(finance,'lookup_fictional_tip_return',[...owner.auth(),owner.epoch,request[9],request[10]]),
      {state:'committed',receipt:returned});
    const refundOptions=kind=>command(finance,'read_fictional_refund_transfer_options',[...owner.auth(),owner.customer,kind,today]);
    assert.deepEqual((await refundOptions('recredit')).refunds.find(r=>r.priorEventId===returned.eventId).availableRanges,
      [{firstCent:'4',lastCent:'4'}]);
    const transfer=(prior,kind,channel)=>committed(finance,'record_fictional_refund_transfer_adjustment',[
      ...mutate(),randomUUID(),prior,owner.customer,kind,channel,'1',today,'1',
      'Fictional verified actual transfer','Fictional linked repayment or return',evidence('Verified outgoing-transfer movement'),
      JSON.stringify([{firstCent:'4',lastCent:'4'}]),
    ]);
    const transferFailed=await transfer(returned.eventId,'recredit',depositChannel);
    assert.equal(transferFailed.originalEventId,returned.eventId);
    assert.equal(transferFailed.obligationType,'tip_return_due');
    assert.equal(transferFailed.fundingOriginId,tipped.fundingOriginId);
    assert.equal((await book()).refundDue.totalCents,'1');
    assert.deepEqual((await refundOptions('retry')).refunds.find(r=>r.priorEventId===transferFailed.eventId).availableRanges,
      [{firstCent:'4',lastCent:'4'}]);
    const retried=await transfer(transferFailed.eventId,'retry',returnChannel);
    assert.equal(retried.originalEventId,returned.eventId);
    assert.equal((await book()).refundDue.totalCents,'0');
    assert.equal(balance(await book(),tipTax),'0');
    await assert.rejects(command(finance,returnName,outgoing('3')),{message:'TIP_RETURN_AMOUNT_UNAVAILABLE'});
    const candidate=await command(finance,'read_fictional_collection_failure_options',[...owner.auth(),owner.customer,tipped.paymentId,today]);
    assert.deepEqual(candidate.components.filter(c=>c.sourceId===newTip)[0].availableRanges,[{firstCent:'2',lastCent:'3'}]);
    const fail=(firstCent,lastCent,cents,kind='settled_failure')=>[
      ...mutate(),randomUUID(),tipped.paymentId,owner.customer,kind,...(kind==='settled_failure'
        ?[returnChannel,'1',today,cents,'Fictional actual new debit','Fictional reviewed failure',evidence('Provider repeated debit')]
        :[null,null,today,cents,'Fictional no movement','Fictional unsupported correction',null]),
      JSON.stringify([{kind:'tip',sourceId:newTip,firstCent,lastCent}]),
    ];
    const failureName='record_fictional_collection_failure';
    await assert.rejects(command(finance,failureName,fail('1','1','1')),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    await assert.rejects(command(finance,failureName,fail('2','2','1','recording_error')),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    const second=await committed(finance,failureName,fail('2','3','2'));
    const component=await componentFor(second);
    assert.deepEqual((await admin.query(`
      SELECT restored_tip_generation_id,root_first_cent::text,root_last_cent::text,net_cents::text,tax_cents::text
      FROM crest.collection_failure_components WHERE id=$1`,[component])).rows[0],
    {restored_tip_generation_id:newTip,root_first_cent:'5',root_last_cent:'6',net_cents:'2',tax_cents:'0'});
    assert.deepEqual((await tips()).tips,[]);
    assert.equal(balance(await book(),tipTax),'0');
    const again=await committed(finance,record,args(second,[range(component,'5','5')],'1'));
    assert.deepEqual([again.components[0].tip.originalTipRealizationId,again.components[0].tip.netCents,again.components[0].tip.taxCents],
      [newTip,'1','0']);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.funding_origins WHERE business_id=$1',[owner.business])).rows[0].n,1);
    assert.equal((await command(finance,'read_fictional_customer_funds',[...owner.auth(),today])).totalCents,'0');
    const raw=await command(finance,'read_fictional_journal_v15',[...owner.auth(),today,null,null,100]);
    const journal=parseFictionalJournalV15(raw,owner.business,today,null,null,100);
    assert.deepEqual(journal.rows.filter(row=>row.collectionFailureSettlementId===restored.settlementId)
      .map(row=>[row.purpose,row.debitCents,row.creditCents]).sort(),[
      ['collection_settlement_money','3','0'],['collection_settlement_tip_revenue','0','2'],['collection_settlement_tip_tax','0','1'],
    ]);
    const coverage={
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,
      includeRefundTransferFees:true,includeCollectionFailureRecredits:true,includeCollectionFailureGroupedRecredits:true,includeRestoredTips:true,
    };
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'collection_failure_restored_tip_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'collection_failure_restored_tip_source_snapshot',[owner.business]),{code:'42501'});
    async function capture(connection){
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const archive=(await captureFinanceSourceExport(owner.business,
          async(sql,params)=>(await connection.query(sql,params)).rows,coverage)).forServer();
        const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
        assert.equal(verified.profile,'crest.posted-finance-source.v17');
        assert.equal(verified.debitCents,verified.creditCents);
        assert.equal(verified.balancedJournalEntries,8);
        return archive;
      }finally{await connection.query('ROLLBACK');}
    }
    async function verifyRanges(client,refuseCycle=false){return withRecoveryBackupLease(client,owner.business,new AbortController().signal,lease=>lease.capture(async snapshot=>{await verifyRecoveryFundingRoots(snapshot,lease.signal);if(refuseCycle){await assert.rejects(verifyRecoveryFundingRanges(snapshot,lease.signal),{message:'RECOVERY_FUNDING_RANGE_REVIEW_REQUIRED'});return;}const result=await verifyRecoveryFundingRanges(snapshot,lease.signal);assert.equal(result.typedConsumptionClosureVerified,true);assert.equal(result.restoredTipAncestryVerified,true);assert.equal(result.fullBusinessReconciliationVerified,false);return result;}));}
    // Fixed current read-only checks over the populated historical101 branch;
    // this neither changes its frozen recovery format nor installs new grants.
    await verifyRanges(await sandbox.connect(target));
    const archive=await capture(exporter);
    const changedManifest=JSON.parse(archive.manifest);
    const changedFiles=archive.files.map(file=>{
      if(file.name!=='collection_failure_settlement_components.csv')return file;
      const changed=file.content.replace(tipId,randomUUID());
      assert.notEqual(changed,file.content);
      const listed=changedManifest.files.find(row=>row.name===file.name);
      listed.bytes=Buffer.byteLength(changed);
      listed.sha256=createHash('sha256').update(changed).digest('hex');
      return {...file,content:changed};
    });
    assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(changedManifest),changedFiles,owner.business));
    const neutral=await exerciseNeutralFinanceImport(await sandbox.connect(await sandbox.database()),archive.files,owner.business,coverage);
    assert.equal(neutral.tables,42);
    assert.equal(neutral.credit,neutral.debit);
    const workspace=await privateWorkspace();
    let destination,restoredClient;
    try{
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupRestoredTipDatabase(admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,101);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreRestoredTipDatabase(point,keys.path,restoredUrl),manifest);
      restoredClient=await connect(restoredUrl);
      assert.deepEqual(await inventory(restoredClient),manifest.rows);
      await restoredClient.query('SET ROLE crest_export');
      const after=await capture(restoredClient);
      assert.deepEqual(after.files,archive.files);
      await restoredClient.query('SET ROLE crest_finance_preview');
      assert.deepEqual(await command(restoredClient,'lookup_fictional_collection_failure_recredit',[...owner.auth(),owner.epoch,start[9],start[10]]),
        {state:'committed',receipt:restored});
      await verifyRanges(await connect(restoredUrl));
      const faultAdmin=await connect(restoredUrl);try{
       const link=(await faultAdmin.query('SELECT t.id,c.id AS component_id,c.original_tip_realization_id FROM crest.tip_realizations t JOIN crest.collection_failure_settlement_components c ON c.business_id=t.business_id AND c.id=t.restored_settlement_component_id WHERE t.business_id=$1 LIMIT 1',[owner.business])).rows[0];assert(link);
       async function changeParent(parent){await faultAdmin.query('BEGIN');try{await faultAdmin.query('SET LOCAL session_replication_role=replica');assert.equal((await faultAdmin.query('UPDATE crest.collection_failure_settlement_components SET original_tip_realization_id=$1 WHERE id=$2',[parent,link.component_id])).rowCount,1);await faultAdmin.query('COMMIT');}catch(error){await faultAdmin.query('ROLLBACK');throw error;}}
       // Corruption exists only in the separate disposable restored cluster.
       // A self-parented restored tip must never create an infinite traversal.
       await changeParent(link.id);try{await verifyRanges(await connect(restoredUrl),true);}finally{await changeParent(link.original_tip_realization_id);}
       await verifyRanges(await connect(restoredUrl));assert.deepEqual(await inventory(faultAdmin),manifest.rows);
      }finally{await faultAdmin.end();}

    }finally{
      try{await restoredClient?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
