import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupCollectionFailureGroupedRecreditDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
  restoreCollectionFailureGroupedRecreditDatabase} from '../support/recovery-drill.mjs';
import {collectionFailureGroupedRecreditRecoveryProfile} from '../support/finance-collection-failure-grouped-recredit-candidate.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';

import {parseFictionalJournalV14} from '../../src/bookkeeping/posted-report-v14-contract.ts';
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

test('one returned settlement restores direct and reapplied invoice amounts and explicitly holds the remainder',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const prior=await sandbox.prefix(99);
    assert.equal((await sandbox.apply(target,prior)).history.length,99);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;

    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const service=randomUUID();
    const owner=await makeOwner(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-incoming-recovery',active:true,
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
    const evidence=label=>({namespace:'ledger',id:randomUUID(),rawReference:label});
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today,appointmentDay:yesterday});
    const paid=await committed(finance,'record_direct_fictional_receipt_with_funds',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'25100',
      'Fictional original settlement',null,evidence('Original settlement'),{[invoice.receivableId]:'24900'},mapping,
    ]);
    const reapplied=await committed(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),paid.heldFunds.lotId,invoice.receivableId,owner.customer,today,'24901','25000','Fictional applied funds',
    ]);
    const name='record_fictional_collection_failure';
    const failure=await committed(finance,name,[
      ...mutate(),randomUUID(),paid.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'300',
      'Fictional verified failure','Fictional matching prior debit',evidence('Prior failure debit'),JSON.stringify([
        {kind:'allocation',sourceId:paid.applications[0].id,firstCent:'1',lastCent:'100'},
        {kind:'application',sourceId:reapplied.fundApplicationId,firstCent:'24901',lastCent:'25000'},
        {kind:'funds',sourceId:paid.heldFunds.lotId,firstCent:'25001',lastCent:'25100'},
      ]),
    ]);
    const c=(await admin.query('SELECT id,root_first_cent::text FROM crest.collection_failure_components WHERE collection_failure_id=$1',
      [failure.collectionFailureId])).rows;
    const ids=Object.fromEntries(c.map(row=>[row.root_first_cent,row.id]));
    const legacy=await committed(finance,'record_fictional_collection_failure_held_recredit',[
      ...mutate(),randomUUID(),failure.collectionFailureId,owner.customer,ids['25001'],depositChannel,'1',today,'25001','25010','10',
      'Fictional verified partial recovery','Fictional legacy recovery',evidence('Legacy recredit'),
    ]);
    await committed(finance,'record_direct_fictional_receipt',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'120',
      'Fictional separate customer payment',null,evidence('Separate payment'),{[invoice.receivableId]:'120'},
    ]);
    const priorReport=(await command(finance,'read_fictional_receivable_aging',[...owner.auth(),today])).totalCents;
    assert.equal(priorReport,'80');

    const candidate=await sandbox.prefix(100),fee=await sandbox.prefix(98),tipProfile=await sandbox.prefix(97);
    const verified=await collectionFailureGroupedRecreditRecoveryProfile(candidate,prior,fee,tipProfile,sandbox.root);
    const adopted=await sandbox.apply(target,candidate);
    assert.equal(adopted.history.length,100);
    assert.equal(adopted.registrySha256,verified.profile.registrySha256);
    const list=()=>command(finance,'list_fictional_collection_failure_recredits',[...owner.auth(),owner.customer]);
    const options=()=>command(finance,'read_fictional_collection_failure_recredit_options',[...owner.auth(),owner.customer,failure.collectionFailureId,today]);
    assert.equal((await list()).failures[0].availableCents,'290');
    const ready=await options();
    assert.deepEqual(ready.components.filter(c=>c.sourceKind!=='funds').map(c=>[c.originalReceivableId,c.receivableCapacityCents]),[
      [invoice.receivableId,'80'],[invoice.receivableId,'80'],
    ]);
    assert.equal(ready.openPeriod,true);
    assert.deepEqual(ready.components.find(c=>c.sourceKind==='funds').availableRanges,[{firstCent:'25011',lastCent:'25100'}]);
    const record='record_fictional_collection_failure_recredit';
    const range=(component,firstCent,lastCent,disposition)=>({failureComponentId:ids[component],firstCent,lastCent,disposition});
    const selections=[
      range('24901','24901','24940','receivable'),
      range('1','1','40','receivable'),
      range('1','41','50','funds'),
      range('25001','25011','25020','funds'),
    ];
    const args=(ranges=selections,cents='100',external=evidence('Grouped recovered settlement'),customer=owner.customer)=>[
      ...mutate(),randomUUID(),failure.collectionFailureId,customer,depositChannel,'1',today,cents,
      'Fictional source-identified actual recredit','Fictional review of original invoice and held portions',external,JSON.stringify(ranges),
    ];
    await assert.rejects(command(web,record,args()),{code:'42501'});
    await assert.rejects(command(finance,record,args(selections,'99')),{message:'COLLECTION_RECREDIT_AMOUNT_REQUIRED'});
    await assert.rejects(command(finance,record,args(selections,'100',evidence('Wrong customer'),randomUUID())),
      {message:'COLLECTION_RECREDIT_FAILURE_REQUIRED'});
    await assert.rejects(command(finance,record,args([range('1','1','20','funds')],'20')),
      {message:'COLLECTION_RECREDIT_RECEIVABLE_REQUIRED'});
    await assert.rejects(command(finance,record,args([range('1','1','81','receivable')],'81')),
      {message:'COLLECTION_RECREDIT_RECEIVABLE_REQUIRED'});
    await assert.rejects(command(finance,record,args([range('25001','25005','25015','funds')],'11')),
      {message:'COLLECTION_RECREDIT_RANGE_UNAVAILABLE'});
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.collection_failure_settlements')).rows[0].n,0);
    const original=args();
    const recovered=await committed(finance,record,original);
    assert.equal(recovered.schemaVersion,2);
    assert.equal(recovered.originalPaymentId,paid.paymentId);
    assert.equal(recovered.failureId,failure.collectionFailureId);
    assert.equal(recovered.cents,'100');
    assert.deepEqual(recovered.components.map(c=>[c.firstCent,c.lastCent,c.disposition,c.receivableId]),[
      ['1','40','receivable',invoice.receivableId],['41','50','funds',null],
      ['24901','24940','receivable',invoice.receivableId],['25011','25020','funds',null],
    ]);
    const reordered=[...original];reordered[20]=JSON.stringify([...selections].reverse());
    assert.deepEqual(await committed(finance,record,reordered),recovered);
    const differing=[...original];differing[18]='Fictional changed reason';
    assert.deepEqual(await command(finance,record,differing),{state:'conflict',reason:'operation'});
    await assert.rejects(command(finance,'record_fictional_collection_failure_held_recredit',[
      ...mutate(),randomUUID(),failure.collectionFailureId,owner.customer,ids['25001'],depositChannel,'1',today,'25015','25020','6',
      'Fictional verified partial recovery','Fictional rejected overlapping legacy request',evidence('Overlapping legacy request'),
    ]),{message:'COLLECTION_RECREDIT_RANGE_UNAVAILABLE'});
    const lookup=input=>command(finance,'lookup_fictional_collection_failure_recredit',[...owner.auth(),owner.epoch,input[9],input[10]]);
    const retire=input=>command(finance,'retire_fictional_collection_failure_recredit',
      [...owner.auth(),owner.epoch,owner.epoch,input[9],input[10],'Fictional review retired interrupted recovery']);
    assert.deepEqual(await lookup(original),{state:'committed',receipt:recovered});
    assert.deepEqual(await retire(original),{state:'committed',receipt:recovered});
    const delayed=args([range('25001','25021','25023','funds')],'3');
    assert.deepEqual(await lookup(delayed),{state:'absent'});
    const retired=await retire(delayed);
    assert.equal(retired.state,'retired');
    assert.equal(retired.receipt.settlementId,delayed[10]);
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await command(finance,record,delayed),{state:'conflict',reason:'operation'});
    assert.equal((await list()).failures[0].availableCents,'190');
    const stale=await command(finance,'list_fictional_collection_failure_held_recredits',[...owner.auth(),owner.customer]);
    assert.equal(stale.failures[0].availableCents,'80');
    assert.equal((await command(finance,'read_fictional_receivable_aging',[...owner.auth(),today])).totalCents,'0');
    const book=()=>command(finance,'read_fictional_customer_funds',[...owner.auth(),today]);
    assert.equal((await book()).totalCents,'30');
    const current=(await admin.query(
      'SELECT $3::bigint+sum(signed_cents) AS outstanding FROM crest_private.receivable_posted_deltas($1,$2)',
      [owner.business,invoice.receivableId,'25000'])).rows[0].outstanding;
    assert.equal(current,'0');
    const booked=(await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries e ON e.id=l.entry_id WHERE e.event_id=$1 ORDER BY l.purpose',
      [recovered.eventId])).rows;
    assert.deepEqual(booked,[
      ...Array.from({length:2},()=>({purpose:'collection_settlement_ar',account_id:ar,debit_cents:'0',credit_cents:'40'})),
      ...Array.from({length:2},()=>({purpose:'collection_settlement_funds',account_id:funds,debit_cents:'0',credit_cents:'10'})),
      {purpose:'collection_settlement_money',account_id:depositBank,debit_cents:'100',credit_cents:'0'},
    ]);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE event_id=$1',[recovered.eventId])).rows[0].n,1);
    const held=(await admin.query('SELECT origin_id,original_cents::text FROM crest.customer_fund_lots WHERE collection_failure_settlement_component_id IS NOT NULL')).rows;
    assert.deepEqual(held,[{origin_id:paid.fundingOriginId,original_cents:'10'},{origin_id:paid.fundingOriginId,original_cents:'10'}]);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.collection_failure_recredit_claims WHERE legacy_recredit_id=$1',[legacy.recreditId])).rows[0].n,1);

    const invoiceOwner=await makeOwner(owner,{customerId:owner.customer,serviceVersionFor:async()=>
      (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[owner.business,service])).rows[0].id,
    });
    const earlier=(await admin.query('SELECT ($1::date-2)::text AS day',[today])).rows[0].day;
    const {invoice:otherInvoice}=await issueInvoice({admin,web,finance,owner:invoiceOwner,service,today,setup:false,appointmentDay:earlier});
    const lotForPayment=recovered.components.find(c=>c.firstCent==='41');
    const offered=await command(finance,'read_fictional_customer_funds_application_options',[...owner.auth(),owner.customer,otherInvoice.invoiceId,today]);
    assert.deepEqual(offered.lots.find(l=>l.fundLotId===lotForPayment.fundLotId).availableRanges,[{firstCent:'41',lastCent:'50'}]);
    const application=await committed(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),lotForPayment.fundLotId,otherInvoice.receivableId,owner.customer,today,'41','45',
      'Fictional recovered funds applied to original customer invoice',
    ]);
    assert.equal(application.schemaVersion,4);
    assert.equal(application.collectionFailureSettlementEventId,recovered.eventId);
    assert.equal(application.collectionFailureSettlementComponentId,lotForPayment.settlementComponentId);
    assert.equal((await book()).totalCents,'25');
    assert.equal((await command(finance,'read_fictional_receivable_aging',[...owner.auth(),today])).totalCents,'24995');

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
    const tipFailure=await committed(finance,name,[
      ...mutate(),randomUUID(),tipped.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'6',
      'Fictional settled tip failure','Fictional matching prior tip debit',evidence('Prior tip failure debit'),
      JSON.stringify([{kind:'tip',sourceId:tipId,firstCent:'1',lastCent:'6'}]),
    ]);
    const optionsTip=await command(finance,'read_fictional_collection_failure_recredit_options',[
      ...owner.auth(),owner.customer,tipFailure.collectionFailureId,today]);
    const tipComponent=optionsTip.components[0];
    assert.equal(tipComponent.sourceKind,'tip');
    assert.equal(tipComponent.originalReceivableId,null);
    const tipSelection={failureComponentId:tipComponent.failureComponentId,firstCent:'3',lastCent:'4',disposition:'funds'};
    const tipRequest=args([tipSelection],'2');
    tipRequest[11]=tipFailure.collectionFailureId;
    const invalid=[...tipRequest];invalid[20]=JSON.stringify([{...tipSelection,disposition:'tip'}]);
    await assert.rejects(command(finance,record,invalid),{message:'COLLECTION_RECREDIT_INPUT_REQUIRED'});
    const heldFromTip=await committed(finance,record,tipRequest);
    assert.equal(heldFromTip.originalPaymentId,tipped.paymentId);
    assert.equal(heldFromTip.components[0].disposition,'funds');
    assert.equal((await book()).totalCents,'27');
    const tipBalances=(await admin.query(`
      SELECT l.account_id,sum(l.credit_cents-l.debit_cents)::text AS balance
      FROM crest.journal_lines l WHERE l.account_id=ANY($1::uuid[]) GROUP BY l.account_id`,[[tipRevenue,tipTax]])).rows;
    assert.deepEqual(tipBalances.map(row=>row.balance),['0','0']);
    const raw=await command(finance,'read_fictional_journal_v14',[...owner.auth(),today,null,null,100]);
    const report=parseFictionalJournalV14(raw,owner.business,today,null,null,100);
    assert.equal(report.rows.filter(row=>row.collectionFailureSettlementId===recovered.settlementId).length,5);
    const modified=structuredClone(raw);
    modified.rows.find(row=>row.collectionFailureSettlementId===recovered.settlementId&&row.purpose==='collection_settlement_ar').creditCents='39';
    assert.throws(()=>parseFictionalJournalV14(modified,owner.business,today,null,null,100));

    const coverage={
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,
      includeRefundTransferFees:true,includeCollectionFailureRecredits:true,includeCollectionFailureGroupedRecredits:true,
    };
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'collection_failure_grouped_recredit_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'collection_failure_grouped_recredit_source_snapshot',[owner.business]),{code:'42501'});
    const capture=(connection,grouped=true)=>captureFinanceSourceExport(owner.business,
      async(sql,params)=>(await connection.query(sql,params)).rows,{...coverage,includeCollectionFailureGroupedRecredits:grouped});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let archive;
    try{
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      assert.equal(verifyFinanceSourceExport(archive.manifest,archive.files,owner.business).profile,'crest.posted-finance-source.v16');
      const manifest=JSON.parse(archive.manifest);
      const tampered=archive.files.map(file=>{
        if(file.name!=='collection_failure_recredit_claims.csv')return file;
        const content=file.content.replace(/"25011","25020"/u,'"25010","25020"');
        assert.notEqual(content,file.content);
        const member=manifest.files.find(part=>part.name===file.name);
        member.sha256=createHash('sha256').update(content).digest('hex');
        member.bytes=Buffer.byteLength(content);
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),tampered,owner.business),
        {message:'COLLECTION_GROUPED_RECREDIT_SOURCE_REVIEW_REQUIRED'});
    }finally{await exporter.query('ROLLBACK');}
    const rebuilt=await exerciseNeutralFinanceImport(await sandbox.connect(await sandbox.database()),archive.files,owner.business,coverage);
    assert.equal(rebuilt.tables,42);
    assert.equal(rebuilt.debit,rebuilt.credit);

    const workspace=await privateWorkspace();
    let destination,restored;
    try{
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupCollectionFailureGroupedRecreditDatabase(candidate,prior,fee,tipProfile,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,100);
      assert.equal(manifest.heldCollectionFailureGroupedRecreditMigrationSha256,verified.profile.heldCollectionFailureGroupedRecreditMigrationSha256);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreCollectionFailureGroupedRecreditDatabase(candidate,prior,fee,tipProfile,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const after=(await capture(restored)).forServer();
        assert.deepEqual(after.files,archive.files);
        assert.equal(verifyFinanceSourceExport(after.manifest,after.files,owner.business).profile,'crest.posted-finance-source.v16');
      }finally{await restored.query('ROLLBACK');}
      await restored.query('SET ROLE crest_finance_preview');
      const restoredLookup=input=>command(restored,'lookup_fictional_collection_failure_recredit',
        [...owner.auth(),owner.epoch,input[9],input[10]]);
      assert.deepEqual(await restoredLookup(original),{state:'committed',receipt:recovered});
      assert.deepEqual(await restoredLookup(delayed),retired);
    }finally{
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          assert.equal(await realpath(workspace),workspace);
          await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
