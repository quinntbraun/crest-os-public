import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupCollectionFailureRecreditDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreCollectionFailureRecreditDatabase} from '../support/recovery-drill.mjs';
import {collectionFailureRecreditRecoveryProfile} from '../support/finance-collection-failure-recredit-candidate.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';
import {parseFictionalJournalV13} from '../../src/bookkeeping/posted-report-v13-contract.ts';
import {parseFictionalJournalV12} from '../../src/bookkeeping/posted-report-v12-contract.ts';
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

test('an actual returned incoming payment restores selected funds on the original root and can settle an invoice',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const prior=await sandbox.prefix(98);
    assert.equal((await sandbox.apply(target,prior)).history.length,98);
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
    const {invoice}=await issueInvoice({admin,web,finance,owner,service,today,appointmentDay:yesterday});
    const incoming=await committed(finance,'record_direct_fictional_receipt_with_funds',[
      ...mutate(),randomUUID(),owner.customer,depositChannel,'1',today,'100',
      'Fictional original settlement',null,evidence('Original settlement'),{},mapping,
    ]);
    const failureName='record_fictional_collection_failure';
    const original=await committed(finance,failureName,[
      ...mutate(),randomUUID(),incoming.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'100',
      'Fictional settled failure','Fictional processor debited the original collection',evidence('Original failure debit'),
      JSON.stringify([{kind:'funds',sourceId:incoming.heldFunds.lotId,firstCent:'1',lastCent:'100'}]),
    ]);
    const failureId=original.collectionFailureId;
    const component=(await admin.query('SELECT id FROM crest.collection_failure_components WHERE collection_failure_id=$1',[failureId])).rows[0].id;
    const before=(await admin.query('SELECT * FROM crest.collection_failures WHERE id=$1',[failureId])).rows[0];
    assert.equal((await command(finance,'read_fictional_customer_funds',[...owner.auth(),today])).totalCents,'0');
    const candidate=await sandbox.prefix(99), directTip=await sandbox.prefix(97);
    const checked=await collectionFailureRecreditRecoveryProfile(candidate,prior,directTip,sandbox.root);
    const adopted=await sandbox.apply(target,candidate);
    assert.equal(adopted.history.length,99);
    assert.equal(adopted.registrySha256,checked.profile.registrySha256);
    const listName='list_fictional_collection_failure_held_recredits';
    const readName='read_fictional_collection_failure_held_recredit_options';
    const saveName='record_fictional_collection_failure_held_recredit';
    const lookupName='lookup_fictional_collection_failure_held_recredit';
    const retireName='retire_fictional_collection_failure_held_recredit';
    const list=(customer=owner.customer)=>command(finance,listName,[...owner.auth(),customer]);
    const read=(customer=owner.customer,day=today)=>command(finance,readName,[...owner.auth(),customer,failureId,day]);
    assert.deepEqual(await list(),{state:'ready',schemaVersion:1,businessId:owner.business,customerId:owner.customer,hasMore:false,
      failures:[{failureId,originalPaymentId:incoming.paymentId,failedOn:today,cents:'100',availableCents:'100'}]});
    assert.deepEqual(await list(randomUUID()),{state:'absent'});
    assert.deepEqual(await read(randomUUID()),{state:'absent'});
    await assert.rejects(read(owner.customer,yesterday),{message:'COLLECTION_RECREDIT_DATE_REQUIRED'});
    const options=await read();
    assert.equal(options.state,'ready');
    assert.equal(options.openPeriod,true);
    assert.equal(options.fundsMapping.mappingId,mapping);
    assert.deepEqual(options.components,[{failureComponentId:component,previousFundLotId:incoming.heldFunds.lotId,
      availableRanges:[{firstCent:'1',lastCent:'100'}]}]);
    await assert.rejects(command(web,listName,[...owner.auth(),owner.customer]),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.collection_failure_recredits'),{code:'42501'});
    const settlement=evidence('Actual linked recovery');
    const args=({first='1',last='40',cents='40',customer=owner.customer,external=settlement,
      operation=randomUUID(),recredit=randomUUID(),principal=owner}={})=>[
       ...principal.auth(),principal.epoch,operation,recredit,failureId,customer,component,depositChannel,'1',today,
       first,last,cents,'Fictional provider confirmed the linked deposit','Fictional returned funds held for customer',external,
    ];
    const initial=args();
    await assert.rejects(command(web,saveName,initial),{code:'42501'});
    await assert.rejects(command(finance,saveName,args({cents:'39'})),{message:'COLLECTION_RECREDIT_AMOUNT_REQUIRED'});
    await assert.rejects(command(finance,saveName,args({customer:randomUUID()})),{message:'COLLECTION_RECREDIT_FAILURE_REQUIRED'});
    const lookup=input=>command(finance,lookupName,[...owner.auth(),owner.epoch,input[9],input[10]]);
    const retire=input=>command(finance,retireName,[...owner.auth(),owner.epoch,owner.epoch,input[9],input[10],'Fictional resolved interrupted save']);
    const posted=await committed(finance,saveName,initial);
    assert.equal(posted.schemaVersion,1);
    assert.equal(posted.originalPaymentId,incoming.paymentId);
    assert.equal(posted.failureComponentId,component);
    assert.equal(posted.fundingOriginId,incoming.fundingOriginId);
    assert.equal(posted.previousFundLotId,incoming.heldFunds.lotId);
    assert.notEqual(posted.fundLotId,posted.previousFundLotId);
    assert.equal(posted.cents,'40');
    assert.equal(posted.moneyAccountId,depositBank);
    assert.deepEqual(await lookup(initial),{state:'committed',receipt:posted});
    assert.deepEqual(await retire(initial),{state:'committed',receipt:posted});
    assert.deepEqual(await committed(finance,saveName,initial),posted);
    const modified=[...initial];modified[21]='Fictional changed reason';
    assert.deepEqual(await command(finance,saveName,modified),{state:'conflict',reason:'operation'});
    await assert.rejects(command(finance,saveName,args({first:'41',last:'80'})),{message:'COLLECTION_RECREDIT_EXTERNAL_ID_ALREADY_RECORDED'});
    await assert.rejects(command(finance,saveName,args({first:'31',last:'70',external:evidence('Overlap')})),{message:'COLLECTION_RECREDIT_RANGE_UNAVAILABLE'});
    const delayed=args({first:'41',last:'80',external:evidence('Delayed')}), retired=await retire(delayed);
    assert.equal(retired.state,'retired');
    assert.equal(retired.receipt.recreditId,delayed[10]);
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await command(finance,saveName,delayed),{state:'conflict',reason:'operation'});
    assert.deepEqual((await read()).components[0].availableRanges,[{firstCent:'41',lastCent:'100'}]);
    assert.equal((await list()).failures[0].availableCents,'60');
    const book=()=>command(finance,'read_fictional_customer_funds',[...owner.auth(),today]);
    assert.equal((await book()).totalCents,'40');
    const p04Options=await command(finance,'read_fictional_customer_funds_application_options',[...owner.auth(),owner.customer,invoice.invoiceId,today]);
    assert.deepEqual(p04Options.lots.find(lot=>lot.fundLotId===posted.fundLotId).availableRanges,[{firstCent:'1',lastCent:'40'}]);
    const apply=(first,last,lot=posted.fundLotId)=>command(finance,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),lot,invoice.receivableId,owner.customer,today,first,last,'Fictional applied to selected invoice',
    ]);
    await assert.rejects(apply('1','10',incoming.heldFunds.lotId),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    const application=await apply('1','10');
    assert.equal(application.state,'committed');
    assert.equal(application.receipt.schemaVersion,3);
    assert.equal(application.receipt.collectionFailureRecreditEventId,posted.eventId);
    assert.equal(application.receipt.cents,'10');
    assert.equal((await book()).totalCents,'30');
    assert.equal((await command(finance,'read_fictional_receivable_aging',[...owner.auth(),today])).totalCents,'24990');
    await assert.rejects(command(finance,'record_fictional_excess_return',[
      ...mutate(),randomUUID(),incoming.paymentId,posted.fundLotId,owner.customer,returnChannel,'1',today,'11','20',
      'Fictional attempted unsupported return','Fictional unsupported path',evidence('Unsupported P09'),'10',
    ]),{message:'EXCESS_RETURN_LOT_REQUIRED'});
    await assert.rejects(command(finance,'realize_fictional_held_tip',[
      ...mutate(),randomUUID(),posted.fundLotId,owner.customer,today,'11','20','Fictional jurisdiction',
      randomUUID(),randomUUID(),null,'Fictional no renewed tip intent','Fictional unsupported recovered source',
    ]),{message:'TIP_REALIZATION_LOT_REQUIRED'});
    await assert.rejects(command(finance,failureName,[
      ...mutate(),randomUUID(),incoming.paymentId,owner.customer,'settled_failure',returnChannel,'1',today,'10',
      'Fictional second failure','Fictional unsupported repeated failure',evidence('Repeated failure debit'),
      JSON.stringify([{kind:'funds',sourceId:posted.fundLotId,firstCent:'11',lastCent:'20'}]),
    ]),{message:'COLLECTION_FAILURE_RANGE_UNAVAILABLE'});
    assert.deepEqual((await admin.query('SELECT * FROM crest.collection_failures WHERE id=$1',[failureId])).rows[0],before);
    assert.equal((await admin.query('SELECT count(*)::integer AS n FROM crest.funding_origins WHERE business_id=$1',[owner.business])).rows[0].n,1);
    const journal=(await admin.query(
      'SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id) WHERE j.event_id=$1 ORDER BY l.purpose',
      [posted.eventId])).rows;
    assert.deepEqual(journal,[
      {purpose:'collection_recredit_funds',account_id:funds,debit_cents:'0',credit_cents:'40'},
      {purpose:'collection_recredit_money',account_id:depositBank,debit_cents:'40',credit_cents:'0'},
    ]);

    const readJournal=[...owner.auth(),today,null,null,100];
    const rawJournal=await command(finance,'read_fictional_journal_v13',readJournal);
    const v13=parseFictionalJournalV13(rawJournal,owner.business,today,null,null,100);
    assert.equal(v13.rows.filter(row=>row.collectionFailureRecreditId===posted.recreditId).length,2);
    const v12=await command(finance,'read_fictional_journal_v12',readJournal);
    assert.throws(()=>parseFictionalJournalV12(v12,owner.business,today,null,null,100));
    const changed=structuredClone(rawJournal);
    changed.rows.find(row=>row.purpose==='collection_recredit_funds').recreditedFailureId=randomUUID();
    assert.throws(()=>parseFictionalJournalV13(changed,owner.business,today,null,null,100));

    const coverage={
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
      includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true,
      includeCollectionFailures:true,includeRefundTransferAdjustments:true,includeDirectReceiptTips:true,
      includeRefundTransferFees:true,includeCollectionFailureRecredits:true,
    };
    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    const source='collection_failure_recredit_source_snapshot';
    await assert.rejects(command(exporter,source,[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,source,[owner.business]),{code:'42501'});
    await assert.rejects(exporter.query('SELECT id FROM crest.collection_failure_recredits'),{code:'42501'});
    const capture=(connection,includeCollectionFailureRecredits=true)=>captureFinanceSourceExport(owner.business,
      async(sql,params)=>(await connection.query(sql,params)).rows,{...coverage,includeCollectionFailureRecredits});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let archive;
    try{
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      assert.equal(verifyFinanceSourceExport(archive.manifest,archive.files,owner.business).profile,'crest.posted-finance-source.v15');
      assert.ok(archive.files.find(file=>file.name==='collection_failure_recredits.csv').content.includes(posted.recreditId));
      assert.ok(archive.files.find(file=>file.name==='customer_fund_applications.csv').content.includes(application.receipt.fundApplicationId));
      const manifest=JSON.parse(archive.manifest);
      const tampered=archive.files.map(file=>{
        if(file.name!=='collection_failure_recredits.csv')return file;
        const content=file.content.replace(/"1","40"/u,'"1","41"');
        assert.notEqual(content,file.content);
        const member=manifest.files.find(part=>part.name===file.name);
        member.sha256=createHash('sha256').update(content).digest('hex');
        member.bytes=Buffer.byteLength(content);
        return {...file,content};
      });
      assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(manifest),tampered,owner.business),{message:'COLLECTION_RECREDIT_SOURCE_REVIEW_REQUIRED'});
    }finally{await exporter.query('ROLLBACK');}
    const neutral=await sandbox.connect(await sandbox.database());
    const imported=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,coverage);
    assert.equal(imported.tables,39);
    assert.equal(imported.entries,5);
    assert.equal(imported.debit,imported.credit);

    const workspace=await privateWorkspace();
    let destination,restored;
    try{
      const point=join(workspace,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(workspace);
      const {manifest}=await backupCollectionFailureRecreditDatabase(candidate,prior,directTip,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,99);
      assert.equal(manifest.heldCollectionFailureRecreditMigrationSha256,checked.profile.heldCollectionFailureRecreditMigrationSha256);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreCollectionFailureRecreditDatabase(candidate,prior,directTip,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const after=(await capture(restored)).forServer();
        assert.deepEqual(after.files,archive.files);
        assert.equal(verifyFinanceSourceExport(after.manifest,after.files,owner.business).profile,'crest.posted-finance-source.v15');
      }finally{await restored.query('ROLLBACK');}
      await restored.query('SET ROLE crest_finance_preview');
      assert.deepEqual(await command(restored,lookupName,[...owner.auth(),owner.epoch,initial[9],initial[10]]),{state:'committed',receipt:posted});
      assert.deepEqual(await command(restored,lookupName,[...owner.auth(),owner.epoch,delayed[9],delayed[10]]),retired);
      assert.equal((await command(restored,'read_fictional_customer_funds',[...owner.auth(),today])).totalCents,'30');
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
