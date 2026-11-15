import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupTipReturnCandidateDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreTipReturnCandidateDatabase}
  from '../support/recovery-drill.mjs';
import {issueInvoice} from '../support/finance-tip-invoice-fixture.mjs';
import {prepareTipReturnCandidate} from '../support/finance-tip-return-candidate.mjs';
import {exerciseNeutralFinanceImport} from '../support/neutral-finance-import.mjs';
import {parseFictionalJournalV8,parseFictionalTrialBalanceV8} from '../../src/bookkeeping/posted-report-v8-contract.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
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

test('registered P10 reports, exports, and restores the original six-cent tax slices and settled outflows',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database(),admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    assert.equal((await sandbox.apply(target,await sandbox.prefix(93))).history.length,93);
    const web=await sandbox.connect(target),finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const service=randomUUID();
    const owner=await createConfirmedBookingFixture({client:admin,web,bootstrap})(undefined,{serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-tip-return',active:true,
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
    const received=await committed(finance,'record_direct_fictional_receipt',[...mutate(),randomUUID(),owner.customer,depositChannel,
      '1',today,'6','Fictional settled receipt',null,{namespace:'ledger',id:randomUUID(),rawReference:'Fictional inflow'},
      {[invoice.receivableId]:'6'}]);
    const held=await committed(finance,'unapply_fictional_payment_allocation',[...mutate(),randomUUID(),received.applications[0].id,
      owner.customer,mapping,today,'1','6','Fictional owner reviewed unapplication']);

    const revenue=randomUUID(),tax=randomUUID(),district='Fictional tip return tax district';
    for(const [id,identity] of [[revenue,{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'}],
      [tax,{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'}]]){
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
    }
    const revenueMapping=await committed(finance,'approve_fixed_finance_mapping',[...mutate(),'tips_revenue','0',revenue,'2026-01-01','Fictional review']);
    const profile=await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'tip',null,'0','2026-01-01',
      'inclusive_single','0.1','Fictional tax evidence','Fictional review']);
    const taxMapping=await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tax,'2026-01-01','Fictional tax mapping']);
    const candidate=await prepareTipReturnCandidate(sandbox);
    assert.equal((await sandbox.apply(target,candidate)).history.length,94);
    const tipName='realize_fictional_held_tip',tipId=randomUUID();
    const tip=await committed(finance,tipName,[...mutate(),tipId,held.fundLotId,owner.customer,today,
      '1','6',district,profile.id,revenueMapping.id,taxMapping.id,'Fictional customer explicitly confirmed a six-cent tip','Fictional review']);
    assert.equal(tip.inclusiveCents,'6');assert.equal(tip.netCents,'5');assert.equal(tip.taxCents,'1');
    const postName='record_fictional_tip_return';
    const input=(amount,date=today,customer=owner.customer)=>[...mutate(),randomUUID(),tipId,customer,returnChannel,'1',date,
      'Fictional cleared return','Fictional owner reviewed return',{namespace:'ledger',id:randomUUID(),rawReference:'Fictional settled debit'},amount];
    const lookup=attempt=>command(finance,'lookup_fictional_tip_return',[...owner.auth(),owner.epoch,attempt[9],attempt[10]]);
    const retire=attempt=>command(finance,'retire_fictional_tip_return',[...owner.auth(),owner.epoch,attempt[9],owner.epoch,attempt[10],
      'Fictional confirmed absent return attempt']);
    await assert.rejects(command(web,postName,input('1')),{code:'42501'});
    await assert.rejects(command(finance,postName,input('1',yesterday)),{code:'23514',message:'TIP_RETURN_DATE_REQUIRED'});
    await assert.rejects(command(finance,postName,input('1',today,randomUUID())),{code:'23514',message:'TIP_RETURN_ORIGINAL_REQUIRED'});
    const first=input('3'),second=input('1'),last=input('2');
    const firstSaved=await committed(finance,postName,first);
    assert.deepEqual([firstSaved.cents,firstSaved.netCents,firstSaved.taxCents,firstSaved.ranges],
      ['3','3','0',[{firstCent:'1',lastCent:'3'}]]);
    assert.deepEqual(await committed(finance,postName,first),firstSaved);
    assert.deepEqual(await lookup(first),{state:'committed',receipt:firstSaved});
    assert.deepEqual(await retire(first),{state:'committed',receipt:firstSaved});
    assert.deepEqual(await command(finance,postName,[...first.slice(0,-1),'4']),{state:'conflict',reason:'operation'});
    const delayed=input('1');
    assert.deepEqual(await lookup(delayed),{state:'absent'});
    const retired=await retire(delayed);
    assert.equal(retired.state,'retired');
    assert.deepEqual(await lookup(delayed),retired);
    assert.deepEqual(await retire(delayed),retired);
    assert.deepEqual(await command(finance,postName,delayed),{state:'conflict',reason:'operation'});
    await assert.rejects(command(finance,postName,[...input('1').slice(0,-2),first.at(-2),'1']),{code:'23505',message:'TIP_RETURN_EXTERNAL_ID_ALREADY_RECORDED'});
    const secondSaved=await committed(finance,postName,second);
    assert.deepEqual([secondSaved.cents,secondSaved.netCents,secondSaved.taxCents,secondSaved.ranges],
      ['1','0','1',[{firstCent:'4',lastCent:'4'}]]);
    const lastSaved=await committed(finance,postName,last);
    assert.deepEqual([lastSaved.cents,lastSaved.netCents,lastSaved.taxCents,lastSaved.ranges],
      ['2','2','0',[{firstCent:'5',lastCent:'6'}]]);
    await assert.rejects(command(finance,postName,input('1')),{code:'23514',message:'TIP_RETURN_AMOUNT_UNAVAILABLE'});
    const {rows}=await admin.query(`SELECT l.purpose,l.account_id,l.debit_cents::text,l.credit_cents::text
      FROM crest.journal_lines l JOIN crest.journal_entries j ON j.id=l.entry_id AND j.business_id=l.business_id
      WHERE j.event_id=$1 ORDER BY l.purpose`,[secondSaved.eventId]);
    assert.deepEqual(rows,[{purpose:'tip_return_money',account_id:returnBank,debit_cents:'0',credit_cents:'1'},
      {purpose:'tip_return_tax',account_id:tax,debit_cents:'1',credit_cents:'0'}]);
    const tally=(await admin.query(`SELECT count(*)::int AS returns,sum(cents)::text AS cents,sum(net_cents)::text AS net,sum(tax_cents)::text AS tax
      FROM crest.tip_returns WHERE business_id=$1`,[owner.business])).rows[0];
    assert.deepEqual(tally,{returns:3,cents:'6',net:'5',tax:'1'});
    const {rows:[lotClaims]}=await admin.query('SELECT count(*)::int AS n FROM crest.fund_lot_range_consumptions WHERE business_id=$1 AND fund_lot_id=$2',
      [owner.business,held.fundLotId]);
    assert.equal(lotClaims.n,1);
    await assert.rejects(admin.query('UPDATE crest.tip_returns SET reason=reason WHERE id=$1',[firstSaved.tipReturnId]),{code:'55000'});
    const args=[...owner.auth(),today];
    const trial=parseFictionalTrialBalanceV8(await command(finance,'read_fictional_trial_balance_v8',args),owner.business,today);
    assert.equal(trial.postedEventCount,'7');
    assert.equal(trial.controls.taxPayableTie,true);
    assert.equal(trial.rows.find(row=>row.accountId===tax).balanceCents,'0');
    assert.equal(trial.rows.find(row=>row.accountId===revenue).balanceCents,'0');
    await assert.rejects(command(finance,'read_fictional_trial_balance_v7',args),{message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});
    const journalName='read_fictional_journal_v8';
    const raw=await command(finance,journalName,[...args,null,null,100]);
    const journal=parseFictionalJournalV8(raw,owner.business,today,null,null,100);
    assert.deepEqual(journal.rows.filter(line=>line.tipReturnId===secondSaved.tipReturnId).map(line=>
      [line.purpose,line.debitCents,line.creditCents,line.accountId]).sort(),[
      ['tip_return_money','0','1',returnBank],['tip_return_tax','1','0',tax],
    ]);
    assert(journal.rows.some(line=>line.template==='P06'&&line.tipReturnId===null&&line.tipRealizationId===tipId));
    assert.throws(()=>parseFictionalJournalV8({...raw,rows:raw.rows.map(line=>line.purpose==='tip_return_tax'
      ?{...line,tipReturnId:randomUUID()}:line)},owner.business,today,null,null,100));
    const filtered=parseFictionalJournalV8(await command(finance,journalName,[...args,tax,null,100]),owner.business,today,tax,null,100);
    assert.deepEqual(filtered.rows.map(line=>[line.template,line.runningBalanceCents]),[['P06','-1'],['P10','0']]);
    const prior=parseFictionalTrialBalanceV8(await command(finance,'read_fictional_trial_balance_v8',[...owner.auth(),yesterday]),owner.business,yesterday);
    assert.equal(prior.postedEventCount,'0');
    assert.equal((await command(finance,'read_fictional_customer_funds',args)).totalCents,'0');
    assert.equal((await command(finance,'read_fictional_receivable_aging',args)).totalCents,'25000');
    await assert.rejects(command(web,journalName,[...args,null,null,100]),{code:'42501'});

    const exporter=await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter,'tip_return_source_snapshot',[owner.business]),{code:'25001'});
    await assert.rejects(command(finance,'tip_return_source_snapshot',[owner.business]),{code:'42501'});
    const options={includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
      includePairedCredits:true,includeServiceRefunds:true,includeExcessReceipts:true,includeExcessReturns:true,includeTipReturns:true};
    const capture=(connection,includeTipReturns=true)=>captureFinanceSourceExport(owner.business,
      async(sql,parameters)=>(await connection.query(sql,parameters)).rows,{...options,includeTipReturns});
    let archive;
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      await assert.rejects(capture(exporter,false),{message:'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED'});
      archive=(await capture(exporter)).forServer();
      const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
      assert.equal(verified.profile,'crest.posted-finance-source.v10');
      assert.equal(verified.balancedJournalEntries,7);
      assert(archive.files.find(file=>file.name==='tip_realization_range_consumptions.csv').content.includes(secondSaved.tipReturnId));
    }finally{await exporter.query('ROLLBACK');}
    const neutral=await sandbox.connect(await sandbox.database());
    const independent=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,options);
    assert.equal(independent.tables,33);
    assert.equal(independent.entries,7);
    assert.equal(independent.debit,independent.credit);

    const role='crest_test_p10_export_'+randomBytes(8).toString('hex');
    assert.match(role,/^crest_test_p10_export_[a-f0-9]{16}$/);
    const password=randomBytes(32).toString('hex');
    await admin.query('CREATE ROLE '+role+" LOGIN NOINHERIT PASSWORD '"+password+"'");
    try{
      await admin.query('GRANT crest_export TO '+role+' WITH INHERIT FALSE, SET TRUE');
      const url=new URL(target);url.username=role;url.password=password;
      const collect=createServiceRefundSourceCollector({businessId:owner.business,environment:'test',connectionString:url.href},true,true,true);
      const collected=(await collect(AbortSignal.timeout(15000))).forFinanceServer();
      const selectedProfile=postedFinanceProfileForSchema(94);
      assert.equal(selectedProfile,'crest.posted-finance-source.v10');
      assert.equal(postedFinanceProfileForSchema(93),'crest.posted-finance-source.v9');
      assert.equal(collected.profile,selectedProfile);
      assert.deepEqual(collected.files,archive.files);
      const authorized=await command(web,'authorize_posted_finance_export',owner.auth());
      assert.deepEqual(authorized,{schemaVersion:1,businessId:owner.business,actorId:owner.actor,recoveryEpoch:owner.epoch});
      const digest=createHash('sha256').update(collected.manifest).digest('hex');
      const handoff=await command(web,'record_posted_finance_export_access',[
        ...owner.auth(),owner.epoch,94,'a'.repeat(40),JSON.parse(collected.manifest).observedAt,digest,'b'.repeat(64),1000,
      ]);
      assert.equal(handoff.state,'authorized_handoff');
      assert.equal(handoff.scope.profile,selectedProfile);
      assert.equal(handoff.scope.sourceSchemaVersion,94);
      assert.equal(handoff.scope.manifestSha256,digest);
      assert.deepEqual((await admin.query('SELECT delta FROM crest_private.audit_events WHERE id=$1',[handoff.auditEventId])).rows[0].delta.after,handoff.scope);
    }finally{await admin.query('DROP ROLE '+role);}
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{archive=(await capture(exporter)).forServer();}
    finally{await exporter.query('ROLLBACK');}

    const directory=await privateWorkspace();
    let destination,restored;
    try{
      const point=join(directory,'point');
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(directory);
      const {manifest}=await backupTipReturnCandidateDatabase(candidate,admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,94);
      assert.match(manifest.heldTipReturnMigrationSha256,/^[a-f0-9]{64}$/);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      assert.deepEqual(await restoreTipReturnCandidateDatabase(candidate,point,keys.path,restoredUrl),manifest);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        const replay=(await capture(restored)).forServer();
        assert.deepEqual(replay.files,archive.files);
        assert.equal(verifyFinanceSourceExport(replay.manifest,replay.files,owner.business).profile,'crest.posted-finance-source.v10');
      }finally{await restored.query('ROLLBACK');}
      await restored.query('RESET ROLE; SET ROLE crest_finance_preview');
      const restoredLookup=attempt=>command(restored,'lookup_fictional_tip_return',[...owner.auth(),owner.epoch,attempt[9],attempt[10]]);
      assert.deepEqual(await restoredLookup(second),{state:'committed',receipt:secondSaved});
      assert.deepEqual(await restoredLookup(delayed),retired);
    }finally{
      try{await restored?.end();}finally{
        try{await destination?.close();}finally{
          const actual=await realpath(directory);
          assert.equal(actual,directory);
          await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
      }
    }
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
