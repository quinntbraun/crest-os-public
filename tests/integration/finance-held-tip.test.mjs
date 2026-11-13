import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { financeHeldTip83Candidate } from '../support/finance-held-tip83-candidate.mjs';
import { backupHeldTip83CandidateDatabase, backupLegacy82Database, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreHeldTip83CandidateDatabase, restoreLegacy82Database } from '../support/recovery-drill.mjs';
import { captureFundApplicationSource } from '../../src/bookkeeping/fund-application-source.ts';
import { captureReceiptSource } from '../../src/bookkeeping/receipt-source.ts';
import { capturePostedExpenseSource } from '../../src/bookkeeping/posted-expense-source.ts';
import { calculateHeldTipReview, heldTipMatchesInput, parseHeldTipInput, parseHeldTipOptions,
  parseHeldTipReference, parseHeldTipResult } from '../../src/bookkeeping/held-tip-contract.ts';
import { captureHeldTipSource } from '../../src/bookkeeping/held-tip-source.ts';
import { captureFinanceSourceExport } from '../../src/bookkeeping/finance-source-export.ts';
import { verifyFinanceSourceExport } from '../../src/tooling/verify-finance-source-export.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';
import { parseFictionalJournalV4, parseFictionalTrialBalanceV4 } from '../../src/bookkeeping/posted-report-v4-contract.ts';

async function command(connection, name, values) {
  const args=values.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}

async function committed(connection,name,values) {
  const result=await command(connection,name,values);
  assert.equal(result.state,'committed',JSON.stringify(result));
  return result.receipt;
}

async function issueInvoice({admin,web,finance,owner,service,today,setup=true,appointmentDay='2026-11-03'}) {
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
  const booking=confirmedBookingRequest(owner);
  const mode=await admin.query('SELECT max(sequence)::text AS sequence FROM crest.fulfillment_mode_versions WHERE business_id=$1',
    [owner.business]);
  booking.expectedModeSequence=mode.rows[0].sequence??'0';
  const appointment=booking.payload.appointment;
  for(const key of ['start_at','end_at','local_start','local_end']){
    appointment[key]=appointmentDay+appointment[key].slice(10);
  }
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
  if(setup){
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
  }
  const selection=Object.fromEntries(lines.map(line=>[line.outcomeId,district]));
  const {reviewDigest}=await command(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'1',selection]);
  const invoice=await committed(finance,'issue_reviewed_invoice',[...mutate(),draft,'1',selection,reviewDigest]);
  assert.equal(invoice.issuedOn,today);
  const {rows:[{account_id:ar}]}=await admin.query('SELECT account_id FROM crest.receivable_items WHERE business_id=$1 AND id=$2',
    [owner.business,invoice.receivableId]);
  return {invoice,ar};
}

async function captureExport(connection,businessId) {
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const query=async(sql,args)=>(await connection.query(sql,args)).rows;
    const tip=await captureHeldTipSource(businessId,query);
    const combined=(await captureFinanceSourceExport(businessId,query,{
      includeCorrections:true,includeFundApplications:true,includeTips:true,
    })).forServer();
    return {tip,combined};
  } finally {await connection.query('ROLLBACK');}
}

async function verifyRecovery({candidate,admin,target,owner,captured,saved,retired,expectedTips}) {
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination, restored, exporter, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupLegacy82Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupHeldTip83CandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,83);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.heldTipMigrationSha256,candidate.sha256);
    assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='tip_realizations').rows,expectedTips);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='fund_lot_range_consumptions').rows,
      Number(captured.tip.counts.fund_lot_range_consumptions));
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreLegacy82Database(point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    assert.deepEqual(await restoreHeldTip83CandidateDatabase(candidate,point,keys.path,url),manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    exporter=await connect(url);
    await exporter.query('SET ROLE crest_export');
    const after=await captureExport(exporter,owner.business);
    assert.notEqual(after.tip.snapshotToken,captured.tip.snapshotToken);
    assert.notEqual(after.tip.historySnapshotToken,captured.tip.historySnapshotToken);
    assert.deepEqual(after.tip.rows,captured.tip.rows);
    assert.deepEqual(after.combined.files,captured.combined.files);
    assert.equal(verifyFinanceSourceExport(after.combined.manifest,after.combined.files,owner.business).profile,'crest.posted-finance-source.v4');

    const epoch=randomUUID(), provider=randomUUID(), session=randomUUID(), credential=randomBytes(32);
    await restored.query('BEGIN');
    try {
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
    const {receipt}=saved;
    const lookup=(auth,result)=>command(finance,'lookup_fictional_held_tip',[
      ...auth,owner.epoch,result.receipt.operationId,result.receipt.tipRealizationId,
    ]);
    await assert.rejects(lookup(old,saved),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await lookup(fresh,saved),saved);
    assert.deepEqual(await lookup(fresh,retired),retired);
    const balance=await command(finance,'read_fictional_trial_balance_v4',[...fresh,receipt.effectiveOn]);
    assert.equal(balance.controls.customerFundsTie,true);
    assert.equal(balance.controls.taxPayableTie,true);
    const journal=await command(finance,'read_fictional_journal_v4',[...fresh,receipt.effectiveOn,receipt.fundsAccountId,null,20]);
    assert.equal(journal.rows.find(row=>row.tipRealizationId===receipt.tipRealizationId).debitCents,receipt.inclusiveCents);
    const retry=reviewEpoch=>command(finance,'realize_fictional_held_tip',[
      ...fresh,reviewEpoch,receipt.operationId,receipt.tipRealizationId,receipt.fundLotId,receipt.customerId,
      receipt.effectiveOn,receipt.firstCent,receipt.lastCent,receipt.jurisdiction,receipt.taxProfileId,receipt.revenueMappingId,
      receipt.taxMappingId,receipt.customerIntentEvidence,receipt.reason,
    ]);
    await assert.rejects(retry(owner.epoch),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retry(epoch),{message:'RECOVERY_REVIEW_REQUIRED'});
  } finally {
    try {await finance?.end();} finally {
      try {await exporter?.end();} finally {
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

test('held P06 realizes exact funds and restores its audited tip and tax posting on an independent cluster', {timeout:180000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(82));
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
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-tip-source',active:true,
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
    const mappingArgs=mutate();
    const mapping=await committed(finance,'approve_fixed_finance_mapping',
      [...mappingArgs,'customer_funds','0',funds,'2026-01-01','Fictional funds mapping review']);
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

    const held=await committed(finance,'unapply_fictional_payment_allocation',[
      ...mutate(),randomUUID(),allocation.id,owner.customer,mapping.id,today,'1001','11000','Fictional owner reviewed unapplication',
    ]);

    const apply=(first,last,connection=finance)=>command(connection,'apply_fictional_customer_funds',[
      ...mutate(),randomUUID(),held.fundLotId,invoice.receivableId,owner.customer,today,first,last,'Fictional reviewed invoice application',
    ]);
    const oldApplication=await apply('1001','1500');
    assert.equal(oldApplication.state,'committed');
    const capture=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
        const result=await captureFundApplicationSource(owner.business,query);
        return {applications:result.rows,unapplications:result.references.unapplication.rows,invoices:result.references.invoice.rows,
          receipts:(await captureReceiptSource(owner.business,query)).rows,expenses:(await capturePostedExpenseSource(owner.business,query)).rows};
      } finally {await exporter.query('ROLLBACK');}
    };
    const originalSources=await capture();
    const versions=[{}, {includeCorrections:true}, {includeCorrections:true,includeFundApplications:true}];
    const priorFiles=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
        const result=[];
        for(const profile of versions)result.push((await captureFinanceSourceExport(owner.business,query,profile)).forServer().files);
        return result;
      } finally {await exporter.query('ROLLBACK');}
    };
    const frozenFiles=await priorFiles();
    const candidate=await financeHeldTip83Candidate(sandbox);
    const applied=await sandbox.apply(target,candidate.directory);
    assert.equal(applied.history.length,83);
    assert.equal(applied.registrySha256,candidate.registrySha256);
    assert.deepEqual(await capture(),originalSources);
    assert.deepEqual(await priorFiles(),frozenFiles);
    const backfill=await admin.query(`SELECT fund_application_id,tip_realization_id,first_cent::text,last_cent::text
      FROM crest.fund_lot_range_consumptions WHERE business_id=$1`,[owner.business]);
    assert.deepEqual(backfill.rows,[{fund_application_id:oldApplication.receipt.fundApplicationId,tip_realization_id:null,
      first_cent:'1001',last_cent:'1500'}]);

    const revenue=randomUUID(), tax=randomUUID(), district='Fictional tip district', nontax='Fictional nontaxable tip district';
    const saveAccount=(id,identity)=>committed(finance,'save_finance_account',[...mutate(),1,id,'0',{
      identity,name:'Fictional '+identity.reportRole,active:true,reason:null,
    }]);
    await saveAccount(revenue,{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'});
    await saveAccount(tax,{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'});
    const tipMapping=await committed(finance,'approve_fixed_finance_mapping',
      [...mutate(),'tips_revenue','0',revenue,'2026-01-01','Fictional tip revenue mapping']);
    const approveProfile=(jurisdiction,version,effectiveOn,treatment,rate,serviceId=null)=>committed(finance,'approve_finance_tax_profile',[
      ...mutate(),jurisdiction,serviceId?'service':'tip',serviceId,version,effectiveOn,treatment,rate,
      treatment==='unresolved'?null:'Fictional tax classification reviewed', 'Fictional review',
    ]);
    const oldProfile=await approveProfile(district,'0','2026-01-01','inclusive_single','0.2');
    const datedProfile=await approveProfile(district,'1',today,'inclusive_single','0.1');
    const verifiedNontax=await approveProfile(nontax,'0','2026-01-01','non_taxable',null);
    const unresolved=await approveProfile('Fictional unresolved tips','0','2026-01-01','unresolved',null);
    const exempt=await approveProfile('Fictional exempt tips','0','2026-01-01','exempt',null);
    const wrongScope=await approveProfile(district,'0','2026-01-01','non_taxable',null,service);
    const noMappingDistrict='Fictional missing tip mapping district';
    const noMappingProfile=await approveProfile(noMappingDistrict,'0','2026-01-01','inclusive_single','0.1');
    const taxMapping=await committed(finance,'approve_invoice_tax_payable_mapping',
      [...mutate(),district,'0',tax,'2026-01-01','Fictional tip tax control mapping']);
    const report=(principal=owner,date=today)=>command(finance,'read_fictional_trial_balance_v4',[...principal.auth(),date]);
    const realize=({operation=randomUUID(),id=randomUUID(),lot=held.fundLotId,customer=owner.customer,date=today,
      first='1501',last='2600',jurisdiction=district,profile=datedProfile.id,rev=tipMapping.id,tx=taxMapping.id,
      intent='Fictional customer confirmed this exact held amount as a tip',epoch=owner.epoch,connection=finance,principal=owner}={})=>
      command(connection,'realize_fictional_held_tip',[...principal.auth(),epoch,operation,id,lot,customer,date,first,last,
        jurisdiction,profile,rev,tx,intent,'Fictional owner reviewed confirmation']);
    const tipOptions=({principal=owner,customer=owner.customer,jurisdiction=district,date=today,connection=finance}={})=>
      command(connection,'read_fictional_held_tip_options',[...principal.auth(),customer,jurisdiction,date]);
    const lookup=({operation,id,epoch=owner.epoch},principal=owner,connection=finance)=>
      command(connection,'lookup_fictional_held_tip',[...principal.auth(),epoch,operation,id]);
    const retire=({operation,id,epoch=owner.epoch},reviewEpoch=owner.epoch,connection=finance,reason='Fictional confirmed absent original tip')=>
      command(connection,'retire_fictional_held_tip',[...owner.auth(),reviewEpoch,operation,epoch,id,reason]);
    const values=async()=>new Map((await report()).rows.map(row=>[row.accountId,row.balanceCents]));
    const baseline=await values();
    const rawOptions=await tipOptions();
    const optionsContract=parseHeldTipOptions(rawOptions,owner.business,owner.customer,district,today);
    assert.deepEqual(optionsContract,{
      state:'review',jurisdiction:district,effectiveOn:today,openPeriod:true,
      jurisdictions:[noMappingDistrict,nontax,district],
      lots:[{fundLotId:held.fundLotId,heldOn:today,availableRanges:[{firstCent:'1501',lastCent:'11000'}],
        basis:{taxProfileId:datedProfile.id,treatment:'inclusive_single',rate:'0.1',revenueMappingId:tipMapping.id,
          revenueAccountId:revenue,taxMappingId:taxMapping.id,taxAccountId:tax}}],
    });
    const {basis}=optionsContract.lots[0];
    assert.equal(calculateHeldTipReview('1501','2600',basis.rate).taxCents,'100');
    assert.equal((await tipOptions({jurisdiction:null,date:null})).lots[0].basis,null);
    assert.equal((await tipOptions({jurisdiction:noMappingDistrict})).lots[0].basis,null);
    const free=(await tipOptions({jurisdiction:nontax})).lots[0].basis;
    assert.equal(free.treatment,'non_taxable');
    assert.equal(free.rate,null);
    assert.equal(free.taxMappingId,null);
    assert.deepEqual(await tipOptions({customer:foreign.customer}),{state:'absent'});
    assert.deepEqual((await tipOptions({principal:foreign,customer:foreign.customer})).lots,[]);
    assert.deepEqual((await tipOptions({date:yesterday})).lots,[]);
    await assert.rejects(tipOptions({date:'9999-01-01'}),{message:'TIP_REALIZATION_DATE_REQUIRED'});
    await assert.rejects(tipOptions({jurisdiction:''}),{message:'TIP_REALIZATION_INPUT_REQUIRED'});
    await assert.rejects(tipOptions({connection:web}),{code:'42501'});
    assert.throws(()=>parseHeldTipOptions(rawOptions,owner.business,owner.customer,nontax,today));
    const invalidOptions=structuredClone(rawOptions);
    invalidOptions.lots[0].availableRanges.push({firstCent:'11000',lastCent:'12000'});
    assert.throws(()=>parseHeldTipOptions(invalidOptions,owner.business,owner.customer,district,today));
    await assert.rejects(realize({connection:web}),{code:'42501'});
    await assert.rejects(realize({epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(realize({principal:foreign,epoch:foreign.epoch}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(realize({customer:foreign.customer}),{message:'TIP_REALIZATION_LOT_REQUIRED'});
    await assert.rejects(realize({date:yesterday}),{message:'TIP_REALIZATION_DATE_REQUIRED'});
    await assert.rejects(realize({intent:''}),{message:'TIP_REALIZATION_INPUT_REQUIRED'});
    await assert.rejects(realize({intent:'\tFictional tab'}),{message:'TIP_REALIZATION_INPUT_REQUIRED'});
    await assert.rejects(realize({first:'1500'}),{message:'TIP_REALIZATION_RANGE_UNAVAILABLE'});
    await assert.rejects(realize({first:'1000'}),{message:'TIP_REALIZATION_RANGE_UNAVAILABLE'});
    await assert.rejects(realize({last:'11001'}),{message:'TIP_REALIZATION_RANGE_UNAVAILABLE'});
    await assert.rejects(realize({profile:oldProfile.id}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({profile:wrongScope.id}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({jurisdiction:'Fictional unresolved tips',profile:unresolved.id,tx:null}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({jurisdiction:'Fictional exempt tips',profile:exempt.id,tx:null}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({jurisdiction:noMappingDistrict,profile:noMappingProfile.id,tx:null}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({tx:null}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    await assert.rejects(realize({rev:randomUUID()}),{message:'TIP_REALIZATION_BASIS_REQUIRED'});
    const lock=async(generation,state,operation)=>admin.query(
      `INSERT INTO crest.accounting_period_locks(business_id,period_id,generation,state,evidence_ref,created_by,operation_id)
       SELECT $1,p.id,$2,$3,$4,$5,$6 FROM crest.accounting_periods p WHERE p.business_id=$1`,
      [owner.business,generation,state,'Fictional period review',owner.actor,operation]);
    await lock(1,'locked',held.operationId);
    assert.equal((await tipOptions()).openPeriod,false);
    await assert.rejects(realize(),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    await lock(2,'reopened',oldApplication.receipt.operationId);
    const reviewedSources=await capture();

    const key={operation:randomUUID(),id:randomUUID()};
    assert.deepEqual(await lookup(key),{state:'absent'});
    await assert.rejects(lookup(key,owner,web),{code:'42501'});
    const saved=await realize(key);
    assert.equal(saved.state,'committed');
    assert.deepEqual(await realize(key),saved);
    assert.deepEqual(await lookup(key),saved);
    assert.deepEqual(await lookup({...key,epoch:randomUUID()}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup({...key,id:randomUUID()}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(key,foreign),{state:'absent'});
    assert.deepEqual(await retire(key),saved);
    assert.deepEqual(await realize({...key,intent:'Fictional changed intent'}),{state:'conflict',reason:'operation'});
    assert.deepEqual(saved.receipt,{
      schemaVersion:1,businessId:owner.business,tipRealizationId:key.id,operationId:key.operation,eventId:saved.receipt.eventId,
      fundLotId:held.fundLotId,unapplicationId:held.unapplicationId,fundingOriginId:held.fundingOriginId,parentPartitionId:held.parentPartitionId,
      customerId:owner.customer,fundsAccountId:funds,fundsMappingId:mapping.id,revenueAccountId:revenue,revenueMappingId:tipMapping.id,
      taxAccountId:tax,taxMappingId:taxMapping.id,taxProfileId:datedProfile.id,jurisdiction:district,effectiveOn:today,
      firstCent:'1501',lastCent:'2600',inclusiveCents:'1100',netCents:'1000',taxCents:'100',
      customerIntentEvidence:'Fictional customer confirmed this exact held amount as a tip',reason:'Fictional owner reviewed confirmation',
    });
    const reference=parseHeldTipReference({operationId:key.operation,recoveryEpoch:owner.epoch,tipRealizationId:key.id});
    const input=parseHeldTipInput({reference,fundLotId:held.fundLotId,customerId:owner.customer,effectiveOn:today,
      firstCent:'1501',lastCent:'2600',jurisdiction:district,taxProfileId:datedProfile.id,revenueMappingId:tipMapping.id,
      taxMappingId:taxMapping.id,customerIntentEvidence:saved.receipt.customerIntentEvidence,reason:saved.receipt.reason});
    const parsed= parseHeldTipResult(saved,owner.business,reference);
    assert(heldTipMatchesInput(parsed,input));
    assert(!heldTipMatchesInput(parsed,{...input,lastCent:'2601'}));
    assert.throws(()=>parseHeldTipResult({...saved,receipt:{...saved.receipt,taxCents:'101'}},owner.business,reference));
    const non=await realize({first:'2601',last:'3100',jurisdiction:nontax,profile:verifiedNontax.id,tx:null});
    assert.equal(non.state,'committed');
    assert.equal(non.receipt.netCents,'500');
    assert.equal(non.receipt.taxCents,'0');
    assert.equal(non.receipt.taxMappingId,null);
    assert.deepEqual(await capture(),reviewedSources);
    const result=await report();
    assert.equal(parseFictionalTrialBalanceV4(result,owner.business,today).controls.taxPayableTie,true);
    assert.throws(()=>parseFictionalTrialBalanceV4({...result,controls:{...result.controls,taxPayableTie:false}},owner.business,today));
    assert.equal(result.schemaVersion,4);
    assert.deepEqual(result.coverage.templates,['P01','P02','P03','P04','P05','P06','P12']);
    assert.deepEqual(result.controls,{ledgerBalanced:true,receivablesTie:true,moneyMovementsTie:true,customerFundsTie:true,taxPayableTie:true});
    const after=await values();
    assert.equal(after.get(bank),baseline.get(bank));
    assert.equal(after.get(ar),baseline.get(ar));
    assert.equal(after.get(funds),'-7900');
    assert.equal(after.get(revenue),'-1500');
    assert.equal(after.get(tax),'-100');
    assert.equal((await report(foreign)).postedEventCount,'0');
    await assert.rejects(command(finance,'read_fictional_trial_balance_v3',[...owner.auth(),today]),
      {message:'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED'});
    const journal=await command(finance,'read_fictional_journal_v4',[...owner.auth(),today,null,null,100]);
    const parsedJournal=parseFictionalJournalV4(journal,owner.business,today,null,null,100);
    assert.equal(parsedJournal.rows.filter(row=>row.tipRealizationId===key.id).length,3);
    const wrongJournal=structuredClone(journal);
    wrongJournal.rows.find(row=>row.tipRealizationId===key.id&&row.purpose==='tip_tax').tipRealizationId=randomUUID();
    assert.throws(()=>parseFictionalJournalV4(wrongJournal,owner.business,today,null,null,100));
    assert.deepEqual(journal.rows.filter(row=>row.tipRealizationId===key.id).map(row=>[
      row.purpose,row.accountId,row.debitCents,row.creditCents,
    ]).sort((a,b)=>a[0].localeCompare(b[0])),[
      ['tip_funds',funds,'1100','0'],['tip_revenue',revenue,'0','1000'],['tip_tax',tax,'0','100'],
    ]);
    const options=()=>command(finance,'read_fictional_customer_funds_application_options',[...owner.auth(),owner.customer,invoice.invoiceId,today]);
    assert.deepEqual((await options()).lots[0].availableRanges,[{firstCent:'3101',lastCent:'11000'}]);
    assert.deepEqual((await tipOptions()).lots[0].availableRanges,[{firstCent:'3101',lastCent:'11000'}]);
    await assert.rejects(apply('1600','1700'),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
    const competition=await Promise.allSettled([realize({first:'3101',last:'3200'}),apply('3101','3200',peer)]);
    assert.equal(competition.filter(row=>row.status==='fulfilled').length,1);
    assert.match(competition.find(row=>row.status==='rejected').reason.message,/^(TIP_REALIZATION|FUND_APPLICATION)_RANGE_UNAVAILABLE$/);
    assert.deepEqual((await options()).lots[0].availableRanges,[{firstCent:'3201',lastCent:'11000'}]);
    assert.deepEqual((await tipOptions()).lots[0].availableRanges,[{firstCent:'3201',lastCent:'11000'}]);
    assert.equal((await report()).controls.customerFundsTie,true);
    const tombstone={operation:randomUUID(),id:randomUUID()};
    await assert.rejects(retire(tombstone,owner.epoch,web),{code:'42501'});
    await assert.rejects(retire(tombstone,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retire(tombstone,owner.epoch,finance,''),{message:'TIP_REALIZATION_INPUT_REQUIRED'});
    assert.deepEqual(await lookup(tombstone),{state:'absent'});
    const retirement=await retire(tombstone);
    assert.deepEqual(retirement,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,
      operationId:tombstone.operation,tipRealizationId:tombstone.id,originalEpoch:owner.epoch,reviewEpoch:owner.epoch,
      reason:'Fictional confirmed absent original tip'}});
    assert.equal(parseHeldTipResult(retirement,owner.business,
      {operationId:tombstone.operation,recoveryEpoch:owner.epoch,tipRealizationId:tombstone.id}).state,'retired');
    assert.deepEqual(await lookup(tombstone),retirement);
    assert.deepEqual(await retire(tombstone),retirement);
    assert.deepEqual(await realize({...tombstone,first:'3201',last:'3300'}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup({...tombstone,id:randomUUID()}),{state:'conflict',reason:'operation'});
    const uncertain={operation:randomUUID(),id:randomUUID()};
    const [submitted,retired]=await Promise.all([realize({...uncertain,first:'3301',last:'3400'}),retire(uncertain,owner.epoch,peer)]);
    assert(['committed','retired'].includes(retired.state));
    if(retired.state==='committed')assert.deepEqual(submitted,retired);
    else assert.deepEqual(submitted,{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(uncertain),retired);
    const laterProfile=await approveProfile(district,'2','9999-01-01','unresolved',null);
    assert.notEqual(laterProfile.id,datedProfile.id);
    assert.deepEqual(await lookup(key),saved);
    await assert.rejects(admin.query('DELETE FROM crest.tip_realizations WHERE id=$1',[key.id]),{code:'55000'});
    await assert.rejects(admin.query('DELETE FROM crest.fund_lot_range_consumptions WHERE tip_realization_id=$1',[key.id]),{code:'55000'});
    await assert.rejects(web.query('SELECT * FROM crest.tip_realizations'),{code:'42501'});

    await assert.rejects(command(finance,'held_tip_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(exporter,'held_tip_source_snapshot_context',[owner.business]),{code:'25001'});
    const captured=await captureExport(exporter,owner.business);
    const expectedTips=2+Number(competition[0].status==='fulfilled')+Number(submitted.state==='committed');
    const tipCounts=captured.tip.counts;
    assert.equal(tipCounts.tip_realizations,String(expectedTips));
    assert.equal(tipCounts.fund_lot_range_consumptions,String(expectedTips+1+Number(competition[1].status==='fulfilled')));
    assert(Object.values((await captureExport(exporter,foreign.business)).tip.counts).every(count=>count==='0'));
    const manifest=JSON.parse(captured.combined.manifest);
    const verified=verifyFinanceSourceExport(captured.combined.manifest,captured.combined.files,owner.business);
    assert.equal(verified.profile,'crest.posted-finance-source.v4');
    assert.equal(manifest.sourceTokens.tip,captured.tip.snapshotToken);
    assert.equal(manifest.rowCounts.tip_realizations,expectedTips);
    const find=name=>captured.combined.files.find(part=>part.name===name).content;
    const dictionary=JSON.parse(find('dictionary.json'));
    const decode=name=>readSourceExportCsv(find(name+'.csv'),JSON.parse(find(name+'_escape_map.json')).escapes,
      {columns:dictionary.tables.find(table=>table.name===name).columns,maxRows:100});
    assert.deepEqual(decode('tip_realizations'),captured.tip.rows.tip_realizations);
    assert.deepEqual(decode('fund_lot_range_consumptions'),captured.tip.rows.fund_lot_range_consumptions);
    assert(find('operation_history.ndjson').includes(tombstone.operation));
    const rangeFile=captured.combined.files.find(part=>part.name==='fund_lot_range_consumptions.csv');
    const tipRange=captured.tip.rows.fund_lot_range_consumptions.find(row=>row.tip_realization_id===key.id);
    const tampered=rangeFile.content.replace(/("[^"]*",){3}"1501","2600"/,match=>match.replace('"1501"','"1500"'));
    assert.notEqual(tampered,rangeFile.content);
    assert(tipRange);
    const tamperedFiles=captured.combined.files.map(part=>part.name===rangeFile.name?{...part,content:tampered}:part);
    const updated={...manifest,files:manifest.files.map(part=>part.name===rangeFile.name?{...part,
      bytes:Buffer.byteLength(tampered),sha256:createHash('sha256').update(tampered).digest('hex')}:part)};
    assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(updated),tamperedFiles,owner.business),
      {message:'HELD_TIP_SOURCE_REVIEW_REQUIRED'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(command(exporter,'held_tip_source_snapshot_page',[
        owner.business,captured.tip.snapshotToken,'tip_realizations',null,20,
      ]),{message:'CREST_HELD_TIP_SOURCE_PAGE_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}
    await verifyRecovery({candidate,admin,target,owner,captured,saved,retired:retirement,expectedTips});
  } finally {
    try {await sandbox?.close();} finally {await cluster.close();}
  }
});
