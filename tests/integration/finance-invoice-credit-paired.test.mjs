import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdir,readFile,realpath,rm,writeFile } from 'node:fs/promises';
import { basename,dirname,join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { financeInvoiceCredit84Candidate } from '../support/finance-invoice-credit84-candidate.mjs';
import { financePairedInvoiceCredit85Candidate } from '../support/finance-paired-invoice-credit85-candidate.mjs';
import { financeServiceRefundCandidate } from '../support/finance-service-refund-candidate.mjs';
import { requireSyntheticFinanceAccountConfiguration } from '../../scripts/synthetic-migrations.mjs';
import {prepareSyntheticPostedFinancePreview,readSyntheticPostedFinancePreview} from '../../scripts/synthetic-posted-finance-preview.mjs';
import { backupPairedInvoiceCredit85CandidateDatabase,backupInvoiceCredit84ForPairedBaseline,backupServiceRefundCandidateDatabase,
  backupDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,restorePairedInvoiceCredit85CandidateDatabase,
  restoreInvoiceCredit84ForPairedBaseline,restoreServiceRefundCandidateDatabase } from '../support/recovery-drill.mjs';
import { exerciseNeutralFinanceImport } from '../support/neutral-finance-import.mjs';
import { pairedInvoiceCreditRefusal,parsePairedInvoiceCreditInput,parsePairedInvoiceCreditOptions,parsePairedInvoiceCreditReference,
  parsePairedInvoiceCreditResolution,parsePairedInvoiceCreditResult } from '../../src/bookkeeping/paired-invoice-credit-contract.ts';
import { parseFictionalJournalV5,parseFictionalTrialBalanceV5 } from '../../src/bookkeeping/posted-report-v5-contract.ts';
import {capturePairedInvoiceCreditSource,formatPairedInvoiceCreditLinkCsv} from '../../src/bookkeeping/paired-invoice-credit-source.ts';
import {captureFinanceSourceExport} from '../../src/bookkeeping/finance-source-export.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {readSourceExportCsv} from '../../src/security/source-export-csv-reader.ts';

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
  const district='Fictional credit district';
  if(setup){
    await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'service',service,'0','2026-01-01',
      'inclusive_single','0.1','Fictional source evidence','Fictional review']);
    for(const identity of [
      {code:'1100',accountType:'asset',normalSide:'debit',controlKind:'ar',reportRole:'ar'},
      {code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'service_revenue'},
      {code:'2000',accountType:'liability',normalSide:'credit',controlKind:'customer_funds',reportRole:'customer_funds'},
      {code:'4910',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'returns'},
      {code:'4900',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'contra_revenue'},
    ]){
      const id=randomUUID();
      await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
      await committed(finance,'approve_fixed_finance_mapping',[...mutate(),identity.code==='4900'?'discount':identity.reportRole,'0',id,'2026-01-01','Fictional mapping review']);
    }
    const tax=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,tax,'0',{
      identity:{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'},
      name:'Fictional original tax',active:true,reason:null,
    }]);
    await committed(finance,'approve_invoice_tax_payable_mapping',[...mutate(),district,'0',tax,'2026-01-01','Fictional original tax mapping']);
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
    const source=await capturePairedInvoiceCreditSource(businessId,query);
    const combined=(await captureFinanceSourceExport(businessId,query,{
      includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,includePairedCredits:true,
    })).forServer();
    return {source,combined};
  } finally {await connection.query('ROLLBACK');}
}

async function verifyRecovery({candidate,admin,target,owner,captured,saved,retired}) {
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination, restored, exporter, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    await assert.rejects(backupInvoiceCredit84ForPairedBaseline(candidate,admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupPairedInvoiceCredit85CandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,85);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.heldPairedInvoiceCreditMigrationSha256,candidate.sha256);
    assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='paired_invoice_credit_releases').rows,
      captured.source.paired.rows.paired_invoice_credit_releases.length);
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreInvoiceCredit84ForPairedBaseline(candidate,point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    assert.deepEqual(await restorePairedInvoiceCredit85CandidateDatabase(candidate,point,keys.path,url),manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    exporter=await connect(url);
    await exporter.query('SET ROLE crest_export');
    const after=await captureExport(exporter,owner.business);
    assert.notEqual(after.source.paired.snapshotToken,captured.source.paired.snapshotToken);
    assert.notEqual(after.source.paired.historySnapshotToken,captured.source.paired.historySnapshotToken);
    assert.deepEqual(after.source.paired.rows,captured.source.paired.rows);
    assert.deepEqual(after.source.unapplication.rows,captured.source.unapplication.rows);
    assert.deepEqual(after.source.credit.rows,captured.source.credit.rows);
    assert.deepEqual(after.source.history,captured.source.history);
    assert.deepEqual(after.combined.files,captured.combined.files);
    assert.equal(verifyFinanceSourceExport(after.combined.manifest,after.combined.files,owner.business).profile,'crest.posted-finance-source.v6');

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
    const {credit:receipt,release}=saved.receipt;
    const lookup=(auth,result)=>command(finance,'lookup_fictional_paired_invoice_credit',[
      ...auth,owner.epoch,result.state==='committed'?result.receipt.credit.operationId:result.receipt.operationId,
      result.state==='committed'?result.receipt.credit.invoiceCreditId:result.receipt.invoiceCreditId,
      result.state==='committed'?result.receipt.release.unapplicationId:result.receipt.unapplicationId,
    ]);
    await assert.rejects(lookup(old,saved),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await lookup(fresh,saved),saved);
    assert.deepEqual(await lookup(fresh,retired),retired);
    const balance=await command(finance,'read_fictional_trial_balance_v5',[...fresh,receipt.effectiveOn]);
    assert.equal(balance.controls.customerFundsTie,true);
    assert.equal(balance.controls.taxPayableTie,true);
    const journal=await command(finance,'read_fictional_journal_v5',[...fresh,receipt.effectiveOn,receipt.arAccountId,null,20]);
    assert.equal(journal.rows.find(row=>row.invoiceCreditId===receipt.invoiceCreditId).creditCents,receipt.inclusiveCents);
    const retry=reviewEpoch=>command(finance,'credit_fictional_paid_invoice_line',[
      ...fresh,reviewEpoch,receipt.operationId,receipt.invoiceCreditId,receipt.invoiceItemId,receipt.customerId,
      receipt.effectiveOn,receipt.firstCent,receipt.lastCent,receipt.returnsMappingId,release.unapplicationId,release.allocationId,
      release.firstCent,release.lastCent,release.mappingId,'0',receipt.reason,
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

const refundExportOptions={includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
  includePairedCredits:true,includeServiceRefunds:true};

async function verifyReceivableAging({admin,finance,web,owner,foreign,saved,today,sandbox,target,makeOwner,service}){
  assert.equal((await sandbox.apply(target,await sandbox.prefix(87))).history.length,87);
  const inventoryBefore=(await inventory(admin)).filter(row=>row.schema!=='supabase_migrations');
  const requireAgingPreview=()=>requireSyntheticFinanceAccountConfiguration(target,owner.business,
    true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true);
  await assert.rejects(requireAgingPreview(),{message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
  assert.equal((await sandbox.apply(target,await sandbox.prefix(88))).history.length,88);
  await requireAgingPreview();
  assert.deepEqual((await inventory(admin)).filter(row=>row.schema!=='supabase_migrations'),inventoryBefore);
  const {parseReceivableAging}=await import('../../src/bookkeeping/receivable-aging-contract.ts');
  const route='read_fictional_receivable_aging';
  const aging=(principal=owner,date=today)=>command(finance,route,[...principal.auth(),date]);
  assert.equal(parseReceivableAging(await aging(),owner.business,today).itemCount,'0');
  const customer=await makeOwner(owner,{paidLineDiscount:{kind:'fixed',cents:'3000'},serviceVersionFor:async()=>
    (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[owner.business,service])).rows[0].id});
  const {invoice}=await issueInvoice({admin,web,finance,owner:customer,service,today,setup:false,appointmentDay:'2026-11-05'});
  const raw=await aging();
  const report=parseReceivableAging(raw,owner.business,today);
  assert.equal(report.totalCents,invoice.totalCents);
  assert.equal(report.buckets.current,invoice.totalCents);
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].invoiceId,invoice.invoiceId);
  assert.equal(report.rows[0].customerId,customer.customer);
  assert.notEqual(report.rows[0].invoiceId,saved.receipt.credit.invoiceId);
  assert.equal(parseReceivableAging(await aging(owner,null),owner.business,null).throughOn,today);
  assert.equal(parseReceivableAging(await aging(owner,'2026-01-01'),owner.business,'2026-01-01').itemCount,'0');
  assert.equal(parseReceivableAging(await aging(foreign),foreign.business,today).itemCount,'0');
  await assert.rejects(command(web,route,[...owner.auth(),today]),{code:'42501'});
  await assert.rejects(aging(owner,'9999-12-31'),{message:'FINANCE_REPORT_DATE_REQUIRED'});
  assert.throws(()=>parseReceivableAging({...raw,totalCents:'1'},owner.business,today));
  assert.throws(()=>parseReceivableAging({...raw,rows:[{...raw.rows[0],daysOverdue:1}]},owner.business,today));
}

async function verifyPostedFinanceLauncher({admin,owner,sandbox,target}){
  const databaseName=new URL(target).pathname.slice(1),id=databaseName.slice('crest_migrate_'.length);
  assert.match(id,/^[a-f0-9]{16}$/);
  const root=await sandbox.prefix(90),directory=sandbox.workspace,login='crest_export_local_'+id;
  const issuer='http://127.0.0.1:54328/auth/v1';
  const state={schemaVersion:1,id,databaseName,businessId:owner.business,issuer,owner:{subject:owner.subject}};
  const config={root,directory,state,administrator:target,db:admin};
  const failure={message:'SYNTHETIC_POSTED_FINANCE_EXPORT_REVIEW_REQUIRED'};
  await assert.rejects(prepareSyntheticPostedFinancePreview(config),failure);
  assert.equal((await sandbox.admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[login])).rowCount,0);
  const before=(await inventory(admin)).filter(row=>row.schema!=='supabase_migrations');
  const requireFundsPreview=()=>requireSyntheticFinanceAccountConfiguration(target,owner.business,
    true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true);
  await assert.rejects(requireFundsPreview(),{message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
  assert.equal((await sandbox.apply(target,await sandbox.prefix(90))).history.length,90);
  await requireFundsPreview();
  assert.deepEqual((await inventory(admin)).filter(row=>row.schema!=='supabase_migrations'),before);
  const exportAuthority='crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)';
  const settingsAuthority='crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)';
  assert.deepEqual((await admin.query(`SELECT pg_get_userbyid(proowner) AS owner,
    has_function_privilege('crest_command_owner',$2,'EXECUTE') AS command_can_read_settings
    FROM pg_proc WHERE oid=to_regprocedure($1)`,[exportAuthority,settingsAuthority])).rows,
   [{owner:'crest_session_owner',command_can_read_settings:false}]);
  await assert.rejects(prepareSyntheticPostedFinancePreview(config),failure);
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const subject=randomUUID();
  await admin.query('BEGIN');
  try{
   const actor=(await admin.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Fictional preview export owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
   const business=(await admin.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Fictional preview export','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
   await admin.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
   await admin.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual')",[business,actor]);
   await admin.query('COMMIT');
   state.businessId=business;
  }catch(error){await admin.query('ROLLBACK');throw error;}
  state.owner.subject=subject;
  try{
   await prepareSyntheticPostedFinancePreview(config);
   await prepareSyntheticPostedFinancePreview(config);
   const stored=JSON.parse(await readFile(join(directory,'posted-finance-preview.json'),'utf8'));
   const exporterUrl=new URL(target);exporterUrl.username=login;exporterUrl.password=stored.password;
   const restricted=await connect(exporterUrl.href);
   try{
    await assert.rejects(restricted.query('SELECT 1 FROM crest_private.audit_events'),{code:'42501'});
    await assert.rejects(restricted.query('SET ROLE crest_web'),{code:'42501'});
    await restricted.query('SET ROLE crest_export');
    await assert.rejects(restricted.query('SELECT 1 FROM crest_private.audit_events'),{code:'42501'});
   }finally{await restricted.end();}
   await sandbox.admin.query('GRANT crest_web TO '+login);
   try{await assert.rejects(prepareSyntheticPostedFinancePreview(config),failure);}
   finally{await sandbox.admin.query('REVOKE crest_web FROM '+login);}
   await writeFile(join(directory,'posted-finance-preview.json'),JSON.stringify({...stored,businessId:randomUUID()}),{mode:0o600});
   await assert.rejects(prepareSyntheticPostedFinancePreview(config),failure);
   await assert.rejects(readSyntheticPostedFinancePreview(directory,directory,state,target),failure);
  }finally{
   await sandbox.admin.query('DROP ROLE IF EXISTS '+login);
  }
}

async function verifyRefundRecovery({candidate,admin,target,owner,archive,post,retained}){
  const directory=await privateWorkspace();
  const point=join(directory,'point');
  let destination,restored;
  try{
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    const {manifest}=await backupServiceRefundCandidateDatabase(candidate,admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,86);
    assert.equal(manifest.heldServiceRefundMigrationSha256,candidate.sha256);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='service_credit_refunds').rows,1);
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    assert.deepEqual(await restoreServiceRefundCandidateDatabase(candidate,point,keys.path,url),manifest);
    restored=await connect(url);
    assert.deepEqual(await inventory(restored),manifest.rows);
    await restored.query('SET ROLE crest_export');
    await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const after=(await captureFinanceSourceExport(owner.business,async(sql,args)=>(await restored.query(sql,args)).rows,
        refundExportOptions)).forServer();
      assert.deepEqual(after.files,archive.files);
      assert.equal(verifyFinanceSourceExport(after.manifest,after.files,owner.business).profile,'crest.posted-finance-source.v7');
    }finally{await restored.query('ROLLBACK');}
    await restored.query('RESET ROLE; SET ROLE crest_finance_preview');
    const lookup=receipt=>command(restored,'lookup_fictional_service_refund',[
      ...owner.auth(),owner.epoch,receipt.operationId,receipt.serviceRefundId,
    ]);
    assert.deepEqual(await lookup(post.receipt),post);
    assert.deepEqual(await lookup(retained.receipt),retained);
  }finally{
    try{await restored?.end();}finally{
      try{await destination?.close();}finally{
        const actual=await realpath(directory);
        assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
        assert.match(basename(actual),/^case-[a-z0-9]+$/i);
        await rm(actual,{recursive:true,force:true});
      }
    }
  }
}

async function verifyServiceRefund({candidate:paired,sandbox,target,admin,exporter,finance,web,owner,foreign,invoice,saved,channel,bank,today}){
  const candidate=await financeServiceRefundCandidate(sandbox,paired);
  const changed=['financial_events','journal_lines','fund_lot_range_consumptions'];
  const comparable=async adopted=>{
    const byTable=[];
    for(const table of changed){
      const record=adopted?"to_jsonb(t)-'service_refund_id'":'to_jsonb(t)';
      const {rows}=await admin.query(`SELECT (${record})::text AS value FROM crest.${table} t ORDER BY id`);
      if(adopted)assert.equal((await admin.query(`SELECT count(*)::int AS n FROM crest.${table} WHERE service_refund_id IS NOT NULL`)).rows[0].n,0);
      byTable.push(rows);
    }
    return byTable;
  };
  const unaffected=rows=>rows.filter(row=>row.schema!=='supabase_migrations'
    &&!(row.schema==='crest'&&[...changed,'service_credit_refunds'].includes(row.name)));
  const before=unaffected(await inventory(admin)),previousRows=await comparable(false);
  assert.deepEqual(await readFile(join(candidate.directory,'supabase/migration-checksums.json')),
    await readFile(join(sandbox.root,'tests/support/registered86-migration-checksums.json')));
  assert.deepEqual(await readFile(join(candidate.directory,'supabase/migrations',candidate.file)),
    await readFile(join(sandbox.root,'supabase/migrations',candidate.file)));
  const requireRefundPreview=()=>requireSyntheticFinanceAccountConfiguration(target,owner.business,
    true,true,true,true,true,true,true,true,true,true,true,true,true,true,true);
  await assert.rejects(requireRefundPreview(),{message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
  const registered=await sandbox.apply(target,await sandbox.prefix(86));
  assert.equal(registered.history.length,86);
  assert.equal(registered.registrySha256,candidate.registrySha256);
  await requireRefundPreview();
  assert.deepEqual(unaffected(await inventory(admin)),before);
  assert.deepEqual(await comparable(true),previousRows);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.service_credit_refunds')).rows[0].n,0);
  const credit=saved.receipt.credit, release=saved.receipt.release;
  const operation=randomUUID(),refundId=randomUUID(), external={namespace:'ledger',id:'fictional-refund-unique',rawReference:'Fictional bank outflow'};
  const input=[...owner.auth(),owner.epoch,operation,refundId,credit.invoiceCreditId,release.fundLotId,owner.customer,channel,'1',today,'1','500','Fictional bank debit settled','Customer confirmed fictional service refund',external];
  const options=(principal=owner)=>command(finance,'read_fictional_service_refund_options',[...principal.auth(),principal.customer,credit.invoiceCreditId,today]);
  const list=(principal=owner)=>command(finance,'list_fictional_service_refund_credits',[...principal.auth(),principal.customer,invoice.invoiceId]);
  const {parseServiceRefundCredits,parseServiceRefundOptions,parseServiceRefundResult}=await import('../../src/bookkeeping/service-refund-contract.ts');
  const candidates=parseServiceRefundCredits(await list(),owner.business,owner.customer,invoice.invoiceId);
  assert.deepEqual(candidates.find(item=>item.pairedCreditId===credit.invoiceCreditId),{pairedCreditId:credit.invoiceCreditId,creditedOn:today,releasedCents:'1100',availableCents:'1100'});
  assert.deepEqual(parseServiceRefundCredits(await list(foreign),foreign.business,foreign.customer,invoice.invoiceId),[]);
  const reviewed=await options();
  const parsedReview=parseServiceRefundOptions(reviewed,owner.business,owner.customer,credit.invoiceCreditId,today);
  assert.deepEqual(parsedReview.availableRanges,[{firstCent:'1',lastCent:'1100'}]);
  assert.equal(reviewed.fundLotId,release.fundLotId);
  assert.deepEqual(reviewed.availableRanges,[{firstCent:'1',lastCent:'1100'}]);
  assert.deepEqual(reviewed.channels,[{channelId:channel,version:'1',label:'Fictional bank',kind:'bank'}]);
  assert.deepEqual(await options(foreign),{state:'absent'});
  await assert.rejects(command(web,'read_fictional_service_refund_options',[...owner.auth(),owner.customer,credit.invoiceCreditId,today]),{code:'42501'});
  const post=await command(finance,'record_fictional_service_refund',input);
  assert.deepEqual((await options()).availableRanges,[{firstCent:'501',lastCent:'1100'}]);
  assert.equal(post.state,'committed');
  assert.equal(post.receipt.cents,'500');
  assert.equal(parseServiceRefundResult(post,owner.business,{operationId:operation,recoveryEpoch:owner.epoch,serviceRefundId:refundId}).state,'committed');
  assert.equal(parseServiceRefundCredits(await list(),owner.business,owner.customer,invoice.invoiceId).find(item=>item.pairedCreditId===credit.invoiceCreditId).availableCents,'600');
  assert.deepEqual(await command(finance,'record_fictional_service_refund',input),post);
  const changes=await admin.query('SELECT purpose,debit_cents::text,credit_cents::text FROM crest.journal_lines WHERE service_refund_id=$1 ORDER BY purpose',[refundId]);
  assert.deepEqual(changes.rows,[{purpose:'refund_funds',debit_cents:'500',credit_cents:'0'},{purpose:'refund_money',debit_cents:'0',credit_cents:'500'}]);
  assert.equal((await admin.query('SELECT signed_cents::text FROM crest.money_movements WHERE id=$1',[post.receipt.moneyMovementId])).rows[0].signed_cents,'-500');
  await assert.rejects(command(web,'record_fictional_service_refund',input),{code:'42501'});
  await assert.rejects(admin.query('DELETE FROM crest.service_credit_refunds WHERE id=$1',[refundId]),{code:'55000'});
  const balance=await command(finance,'read_fictional_trial_balance_v6',[...owner.auth(),today]);
  const {parseFictionalTrialBalanceV6,parseFictionalJournalV6}=await import('../../src/bookkeeping/posted-report-v6-contract.ts');
  assert.equal(parseFictionalTrialBalanceV6(balance,owner.business,today).schemaVersion,6);
  const journal=await command(finance,'read_fictional_journal_v6',[...owner.auth(),today,null,null,100]);
  const report=parseFictionalJournalV6(journal,owner.business,today,null,null,100);
  const reported=report.rows.filter(row=>row.template==='P08');
  assert.deepEqual(reported.map(row=>[row.purpose,row.serviceRefundId,row.debitCents,row.creditCents]).sort(),
    [['refund_funds',refundId,'500','0'],['refund_money',refundId,'0','500']]);
  const bankJournal=await command(finance,'read_fictional_journal_v6',[...owner.auth(),today,bank,null,100]);
  assert.equal(parseFictionalJournalV6(bankJournal,owner.business,today,bank,null,100).rows.at(-1).serviceRefundId,refundId);
  assert.throws(()=>parseFictionalJournalV6({...journal,rows:journal.rows.map(row=>row.purpose==='refund_funds'?{...row,serviceRefundId:randomUUID()}:row)},owner.business,today,null,null,100));
  const lookup=(id=operation,record=refundId,principal=owner)=>command(finance,'lookup_fictional_service_refund',[...principal.auth(),owner.epoch,id,record]);
  const retire=(id,record)=>command(finance,'retire_fictional_service_refund',[...owner.auth(),owner.epoch,id,owner.epoch,record,'Fictional operation absent after review']);
  assert.deepEqual(await lookup(),post);
  assert.deepEqual(await retire(operation,refundId),post);
  assert.deepEqual(await lookup(operation,randomUUID()),{state:'conflict',reason:'operation'});
  assert.deepEqual(await lookup(operation,refundId,foreign),{state:'absent'});
  const retiredOperation=randomUUID(),retiredRefund=randomUUID();
  const original=[...input]; original[9]=retiredOperation;original[10]=retiredRefund;
  assert.deepEqual(await lookup(retiredOperation,retiredRefund),{state:'absent'});
  const retained=await retire(retiredOperation,retiredRefund);
  assert.equal(retained.state,'retired');
  assert.deepEqual(await lookup(retiredOperation,retiredRefund),retained);
  assert.deepEqual(await retire(retiredOperation,retiredRefund),retained);
  assert.deepEqual(await command(finance,'record_fictional_service_refund',original),{state:'conflict',reason:'operation'});
  const dup=[...input];dup[9]=randomUUID();dup[10]=randomUUID();dup[17]='501';dup[18]='1000';
  await assert.rejects(command(finance,'record_fictional_service_refund',dup),{message:'SERVICE_REFUND_EXTERNAL_ID_ALREADY_RECORDED'});
  const source=()=>command(exporter,'service_refund_source_snapshot',[owner.business]);
  await assert.rejects(source(),{code:'25001'});
  await assert.rejects(command(finance,'service_refund_source_snapshot',[owner.business]),{code:'42501'});
  await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let archive;
  try {
   const captured=await source();
   assert.equal(captured.rows.service_credit_refunds[0].id,refundId);
   assert.deepEqual(captured.rows.journal_lines.map(row=>row.purpose).sort(),['refund_funds','refund_money']);
   assert.deepEqual((await command(exporter,'service_refund_source_snapshot',[foreign.business])).rows.service_credit_refunds,[]);
   const financeSource=await captureFinanceSourceExport(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows,refundExportOptions);
   archive=financeSource.forServer();
   const verified=verifyFinanceSourceExport(archive.manifest,archive.files,owner.business);
   assert.equal(verified.profile,'crest.posted-finance-source.v7');
   assert.equal(verified.debitCents,verified.creditCents);
   const csv=archive.files.find(file=>file.name==='service_credit_refunds.csv').content;
   assert(csv.includes(refundId));
   assert(csv.includes('Fictional bank debit settled'));
  }finally{await exporter.query('ROLLBACK');}
  const neutral=await sandbox.connect(await sandbox.database());
  try{
    const rebuilt=await exerciseNeutralFinanceImport(neutral,archive.files,owner.business,refundExportOptions);
    assert.equal(rebuilt.tables,30);
    assert.equal(rebuilt.sourceRows,Object.values(JSON.parse(archive.manifest).rowCounts).reduce((total,rows)=>total+rows,0));
    assert.equal(rebuilt.debit,rebuilt.credit);
  }finally{await neutral.end();}
  await verifyRefundRecovery({candidate,admin,target,owner,archive,post,retained});
}

async function verifyCustomerFundsReport({finance,web,owner,foreign,saved,today}){
  const {parseCustomerFundsReport}=await import('../../src/bookkeeping/customer-funds-report-contract.ts');
  const route='read_fictional_customer_funds';
  const report=async(principal,date)=>parseCustomerFundsReport(
    await command(finance,route,[...principal.auth(),date]),principal.business,date);
  const funds=await report(owner,today);
  const released=funds.rows.find(row=>row.lotId===saved.receipt.release.fundLotId);
  assert.equal(released?.heldCents,'600');
  assert.equal(released?.customerId,owner.customer);
  assert.equal((await report(owner,null)).totalCents,funds.totalCents);
  assert.equal((await report(owner,'1900-01-01')).totalCents,'0');
  assert.equal((await report(foreign,today)).totalCents,'0');
  const foreignTarget=foreign.auth();foreignTarget[7]=owner.business;
  await assert.rejects(command(finance,route,[...foreignTarget,today]),{code:'42501'});
  await assert.rejects(command(web,route,[...owner.auth(),today]),{code:'42501'});
  await assert.rejects(report(owner,'9999-12-31'),{message:'FINANCE_REPORT_DATE_REQUIRED'});
}

async function verifyExcessReceipt({admin,finance,web,exporter,owner,foreign,channel,fundsMapping,today,makeOwner,service,sandbox,target}){
  const unaffected=rows=>rows.filter(row=>row.schema!=='supabase_migrations'&&!(row.schema==='crest'&&row.name==='customer_fund_lots'));
  const priorLots=async()=> (await admin.query("SELECT to_jsonb(l)-'receipt_event_id' AS row FROM crest.customer_fund_lots l ORDER BY l.id")).rows;
  const existing=unaffected(await inventory(admin)),retainedLots=await priorLots();
  const preview=()=>requireSyntheticFinanceAccountConfiguration(target,owner.business,
    true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true);
  await assert.rejects(preview(),{message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
  assert.equal((await sandbox.apply(target,await sandbox.prefix(91))).history.length,91);
  await preview();
  assert.deepEqual(unaffected(await inventory(admin)),existing);
  assert.deepEqual(await priorLots(),retainedLots);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.customer_fund_lots WHERE receipt_event_id IS NOT NULL')).rows[0].n,0);
  const options='read_direct_fictional_receipt_funds_options';
  const route='record_direct_fictional_receipt_with_funds';
  assert.equal((await command(finance,options,[...owner.auth(),owner.customer,today])).fundsMappingId,fundsMapping);
  assert.deepEqual(await command(finance,options,[...foreign.auth(),owner.customer,today]),{state:'absent'});
  await assert.rejects(command(web,options,[...owner.auth(),owner.customer,today]),{code:'42501'});
  const makeArgs=(amount,applications={})=>[...owner.auth(),owner.epoch,randomUUID(),randomUUID(),owner.customer,channel,
    '1',today,amount,'Fictional actual bank receipt verified',null,null,applications,fundsMapping];
  const noInvoice=makeArgs('4100');
  const saved=await command(finance,route,noInvoice);
  assert.equal(saved.state,'committed');
  assert.equal(saved.receipt.schemaVersion,2);
  assert.deepEqual(saved.receipt.applications,[]);
  assert.equal(saved.receipt.heldFunds.cents,'4100');
  assert.deepEqual(await command(finance,route,noInvoice),saved);
  const duplicate=[...noInvoice];duplicate[9]=randomUUID();duplicate[10]=randomUUID();
  await assert.rejects(command(finance,route,duplicate),{message:'DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED'});
  const wrongMapping=makeArgs('4600');wrongMapping[20]=randomUUID();
  await assert.rejects(command(finance,route,wrongMapping),{message:'DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED'});
  const old=[...noInvoice];old[9]=randomUUID();old[10]=randomUUID();
  await assert.rejects(command(finance,'record_direct_fictional_receipt',old.slice(0,20)),{message:'DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED'});
  await assert.rejects(command(web,route,makeArgs('4700')),{code:'42501'});
  const original=await command(finance,'lookup_direct_fictional_receipt',[...owner.auth(),owner.epoch,noInvoice[9],noInvoice[10]]);
  assert.deepEqual(original,saved);
  const lines=(await admin.query("SELECT purpose,debit_cents::text,credit_cents::text FROM crest.journal_lines l JOIN crest.journal_entries e ON (e.business_id,e.id)=(l.business_id,l.entry_id) WHERE e.event_id=$1 ORDER BY l.purpose",[saved.receipt.eventId])).rows;
  assert.deepEqual(lines,[{purpose:'receipt_funds',debit_cents:'0',credit_cents:'4100'},{purpose:'receipt_money',debit_cents:'4100',credit_cents:'0'}]);
  const held=await command(finance,'read_fictional_customer_funds',[...owner.auth(),today]);
  assert.equal(held.rows.find(row=>row.lotId===saved.receipt.heldFunds.lotId)?.heldCents,'4100');
  const next=await makeOwner(owner,{customerId:owner.customer,paidLineDiscount:{kind:'fixed',cents:'3000'},serviceVersionFor:async()=>
    (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[owner.business,service])).rows[0].id});
  const {invoice}=await issueInvoice({admin,web,finance,owner:next,service,today,setup:false,appointmentDay:'2026-11-06'});
  const partial=makeArgs('1450',{[invoice.receivableId]:'1200'});
  const split=await command(finance,route,partial);
  assert.equal(split.state,'committed');
  assert.equal(split.receipt.applications[0].cents,'1200');
  assert.equal(split.receipt.heldFunds.cents,'250');
  assert.notEqual(split.receipt.applications[0].fundingPartitionId,split.receipt.heldFunds.fundingPartitionId);
  const roots=(await admin.query('SELECT first_cent::text,last_cent::text FROM crest.funding_partitions WHERE origin_id=$1 ORDER BY position',
    [split.receipt.fundingOriginId])).rows;
  assert.deepEqual(roots,[{first_cent:'1',last_cent:'1200'},{first_cent:'1201',last_cent:'1450'}]);
  const journal=await command(finance,'read_fictional_journal_v6',[...owner.auth(),today,null,null,100]);
  const {parseFictionalJournalV6}=await import('../../src/bookkeeping/posted-report-v6-contract.ts');
  const posted=parseFictionalJournalV6(journal,owner.business,today,null,null,100).rows.filter(row=>row.eventId===split.receipt.eventId);
  assert.deepEqual(posted.map(row=>[row.purpose,row.debitCents,row.creditCents]).sort(),
    [['receipt_ar','0','1200'],['receipt_funds','0','250'],['receipt_money','1450','0']]);
  const changed=[...partial];changed[15]='1451';
  assert.deepEqual(await command(finance,route,changed),{state:'conflict',reason:'operation'});
  const applicationOptions='read_fictional_customer_funds_application_options';
  const applyFunds='apply_fictional_customer_funds';
  const view=()=>command(finance,applicationOptions,[...owner.auth(),owner.customer,invoice.invoiceId,today]);
  assert(!(await view()).lots.some(lot=>lot.fundLotId===split.receipt.heldFunds.lotId));
  const beforeApplicationUpgrade=(await inventory(admin)).filter(row=>row.schema!=='supabase_migrations');
  assert.equal((await sandbox.apply(target)).history.length,92);
  assert.deepEqual((await inventory(admin)).filter(row=>row.schema!=='supabase_migrations'),beforeApplicationUpgrade);
  const before=await view();
  const lot=before.lots.find(item=>item.fundLotId===split.receipt.heldFunds.lotId);
  assert.deepEqual(lot.availableRanges,[{firstCent:'1201',lastCent:'1450'}]);
  const request=[...owner.auth(),owner.epoch,randomUUID(),randomUUID(),lot.fundLotId,invoice.receivableId,owner.customer,today,
    '1201','1300','Fictional customer approved applying part of held receipt'];
  const applied=await command(finance,applyFunds,request);
  assert.equal(applied.state,'committed');
  assert.equal(applied.receipt.schemaVersion,2);
  assert.equal(applied.receipt.receiptEventId,split.receipt.eventId);
  assert.equal(applied.receipt.unapplicationId,null);
  assert.equal(applied.receipt.cents,'100');
  assert.deepEqual(await command(finance,applyFunds,request),applied);
  const {parseFundApplicationResult}=await import('../../src/bookkeeping/fund-application-contract.ts');
  assert.equal(parseFundApplicationResult(applied,owner.business,{operationId:request[9],fundApplicationId:request[10],
    recoveryEpoch:owner.epoch}).receipt.receiptEventId,split.receipt.eventId);
  const after=await view();
  assert.equal(BigInt(before.availableBalanceCents)-BigInt(after.availableBalanceCents),100n);
  assert.deepEqual(after.lots.find(item=>item.fundLotId===lot.fundLotId).availableRanges,[{firstCent:'1301',lastCent:'1450'}]);
  const overlap=[...request];overlap[9]=randomUUID();overlap[10]=randomUUID();
  await assert.rejects(command(finance,applyFunds,overlap),{message:'FUND_APPLICATION_RANGE_UNAVAILABLE'});
  await assert.rejects(command(web,applyFunds,request),{code:'42501'});
  const applicationOriginal=await command(finance,'lookup_fictional_customer_fund_application',[...owner.auth(),owner.epoch,request[9],request[10]]);
  assert.deepEqual(applicationOriginal,applied);
  const heldAfter=await command(finance,'read_fictional_customer_funds',[...owner.auth(),today]);
  assert.equal(heldAfter.rows.find(row=>row.lotId===lot.fundLotId)?.heldCents,'150');
  await assert.rejects(command(finance,'receipt_funds_source_snapshot',[owner.business,'a'.repeat(64)]),{code:'42501'});
  let originalArchive;
  await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const query=async(sql,args)=>(await exporter.query(sql,args)).rows;
    const v8=(await captureFinanceSourceExport(owner.business,query,{...refundExportOptions,includeExcessReceipts:true})).forServer();
    assert.equal(verifyFinanceSourceExport(v8.manifest,v8.files,owner.business).profile,'crest.posted-finance-source.v8');
    const lotCsv=v8.files.find(file=>file.name==='customer_fund_lots.csv').content;
    assert(lotCsv.includes(saved.receipt.heldFunds.lotId)&&lotCsv.includes(split.receipt.eventId));
    const lineCsv=v8.files.find(file=>file.name==='journal_lines.csv').content;
    assert(lineCsv.includes('receipt_funds')&&lineCsv.includes(split.receipt.heldFunds.lotId));
    originalArchive=v8;
  }finally{await exporter.query('ROLLBACK');}
  const neutral=await sandbox.connect(await sandbox.database());
  try{
    const recovered=await exerciseNeutralFinanceImport(neutral,originalArchive.files,owner.business,{...refundExportOptions,includeExcessReceipts:true});
    assert.equal(recovered.tables,30);
    assert.equal(recovered.debit,recovered.credit);
  }finally{await neutral.end();}
  const directory=await privateWorkspace();
  let destination,restored;
  try{
    const point=join(directory,'point');
    await mkdir(point,{mode:0o700});
    const keys=await keyPair(directory);
    const {manifest}=await backupDatabase(admin,target,point,keys.recipient);
    assert.equal(manifest.schemaVersion,92);
    destination=await recoveryCluster();
    const restoredUrl=await destination.database();
    assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
    assert.deepEqual(await restoreDatabase(point,keys.path,restoredUrl),manifest);
    restored=await connect(restoredUrl);
    assert.deepEqual(await inventory(restored),manifest.rows);
    await restored.query('SET ROLE crest_export');
    await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const replay=(await captureFinanceSourceExport(owner.business,async(sql,args)=>(await restored.query(sql,args)).rows,
        {...refundExportOptions,includeExcessReceipts:true})).forServer();
      assert.deepEqual(replay.files,originalArchive.files);
      assert.equal(verifyFinanceSourceExport(replay.manifest,replay.files,owner.business).profile,'crest.posted-finance-source.v8');
    }finally{await restored.query('ROLLBACK');}
    await restored.query('RESET ROLE; SET ROLE crest_finance_preview');
    assert.deepEqual(await command(restored,'lookup_direct_fictional_receipt',[...owner.auth(),owner.epoch,partial[9],partial[10]]),split);
  }finally{
    try{await restored?.end();}finally{
      try{await destination?.close();}finally{
        const actual=await realpath(directory);
        assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
        assert.match(basename(actual),/^case-[a-z0-9]+$/i);
        await rm(actual,{recursive:true,force:true});
      }
    }
  }
}

test('held E08 restores the ordered paired credit and original payment release with exact audit and portable evidence', {timeout:240000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(82));
    const previous=await financeInvoiceCredit84Candidate(sandbox);
    assert.equal((await sandbox.apply(target,previous.directory)).history.length,84);
    const web=await sandbox.connect(target), finance=await sandbox.connect(target), peer=await sandbox.connect(target);
    const exporter=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    await exporter.query('SET ROLE crest_export');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const service=randomUUID();
    const owner=await makeOwner(undefined,{paidLineDiscount:{kind:'fixed',cents:'3000'},serviceVersionFor:async(principal,auth)=>{
      await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-paired-credit-source',active:true,
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
    const bank=randomUUID(), channel=randomUUID();
    await committed(finance,'save_finance_account',[...mutate(),1,bank,'0',{
      identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
      name:'Fictional bank',active:true,reason:null}]);
    await committed(finance,'save_money_channel',[...mutate(),channel,'0',{
      identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'9182'},
      label:'Fictional bank',effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional verified ownership',openingState:'verified_zero',
      openingOn:'2026-01-01',openingCents:'0',openingEvidence:'Fictional opening',active:true,reason:'Fictional review',
    }]);
    await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'accounting_period',startsOn:today,reason:'Fictional opening'}]);
    const {invoice,ar}=await issueInvoice({admin,web,finance,owner,service,today});
    const pay=(cents,externalId,receivableId=invoice.receivableId)=>committed(finance,'record_direct_fictional_receipt',[...mutate(),randomUUID(),owner.customer,channel,
      '1',today,cents,'Fictional settled receipt',null,{namespace:'ledger',id:externalId,rawReference:'Fictional original inflow'},
      {[receivableId]:cents}]);


    const {rows:[item]}=await admin.query('SELECT id FROM crest.invoice_items WHERE invoice_id=$1 AND total_cents>0',[invoice.invoiceId]);
    const {rows:[{id:returnsMapping,account_id:returns}]}=await admin.query(
      "SELECT id,account_id FROM crest.account_mapping_versions WHERE business_id=$1 AND purpose='returns'",[owner.business]);
    const {rows:[{id:fundsMapping,account_id:funds}]}=await admin.query(
      "SELECT id,account_id FROM crest.account_mapping_versions WHERE business_id=$1 AND purpose='customer_funds'",[owner.business]);
    const firstPay=await pay('19000','fictional-paired-first');
    const secondPay=await pay('3000','fictional-paired-second');
    const [firstAllocation]=firstPay.applications, [secondAllocation]=secondPay.applications;
    const captureV5=async()=>{
      await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        return (await captureFinanceSourceExport(owner.business,async(sql,args)=>(await exporter.query(sql,args)).rows,{
          includeCorrections:true,includeFundApplications:true,includeTips:true,includeCredits:true,
        })).forServer();
      } finally {await exporter.query('ROLLBACK');}
    };
    const originalV5=await captureV5();
    const candidate=await financePairedInvoiceCredit85Candidate(sandbox,previous);
    const applied=await sandbox.apply(target,candidate.directory);
    assert.equal(applied.history.length,85);
    assert.equal(applied.registrySha256,candidate.registrySha256);
    assert.deepEqual((await captureV5()).files,originalV5.files);
    const input=({operation=randomUUID(),creditId=randomUUID(),releaseId=randomUUID(),customerId=owner.customer,
      invoiceItemId=item.id,date=today,firstCent='1',lastCent='1100',allocationId=firstAllocation.id,
      releaseFirst='18001',releaseLast='19100',arCents='0',returnsId=returnsMapping,fundsId=fundsMapping,epoch=owner.epoch}={})=>({
        reviewedArCents:arCents,
        credit:{reference:{operationId:operation,recoveryEpoch:epoch,invoiceCreditId:creditId},invoiceItemId,customerId,
          effectiveOn:date,firstCent,lastCent,returnsMappingId:returnsId,reason:'Fictional owner selected exact paid credit'},
        release:{reference:{operationId:operation,recoveryEpoch:epoch,unapplicationId:releaseId},allocationId,customerId,
          effectiveOn:date,firstCent:releaseFirst,lastCent:releaseLast,fundsMappingId:fundsId,reason:'Fictional owner selected exact paid credit'},
      });
    const post=(review,{principal=owner,connection=finance}={})=>{
      const {credit,release,reviewedArCents}=review;
      return command(connection,'credit_fictional_paid_invoice_line',[
        ...principal.auth(),credit.reference.recoveryEpoch,credit.reference.operationId,credit.reference.invoiceCreditId,
        credit.invoiceItemId,credit.customerId,credit.effectiveOn,credit.firstCent,credit.lastCent,credit.returnsMappingId,
        release.reference.unapplicationId,release.allocationId,release.firstCent,release.lastCent,release.fundsMappingId,reviewedArCents,credit.reason,
      ]);
    };
    const state=async()=>{
      const raw=await command(finance,'read_fictional_trial_balance_v5',[...owner.auth(),today]);
      return new Map(parseFictionalTrialBalanceV5(raw,owner.business,today).rows.map(row=>[row.accountId,row.balanceCents]));
    };
    const lookup=(review,principal=owner,connection=finance)=>command(connection,'lookup_fictional_paired_invoice_credit',[
      ...principal.auth(),review.credit.reference.recoveryEpoch,review.credit.reference.operationId,
      review.credit.reference.invoiceCreditId,review.release.reference.unapplicationId,
    ]);
    const options=({principal=owner,customerId=owner.customer,invoiceId=invoice.invoiceId,allocationId=firstAllocation.id,
      date=today,connection=finance}={})=>command(connection,'read_fictional_paired_invoice_credit_options',[
        ...principal.auth(),customerId,invoiceId,allocationId,date,
      ]);
    const referenceOf=review=>parsePairedInvoiceCreditReference({...review.credit.reference,unapplicationId:review.release.reference.unapplicationId});
    const retire=(review,{epoch=owner.epoch,connection=finance,reason='Fictional reviewed absent pair'}={})=>{
      const reference=referenceOf(review);
      return command(connection,'retire_fictional_paired_invoice_credit',[
        ...owner.auth(),epoch,reference.operationId,reference.recoveryEpoch,reference.invoiceCreditId,reference.unapplicationId,reason,
      ]);
    };
    const original=await state();
    assert.equal(original.get(ar),'0');
    assert.equal(original.get(bank),'22000');
    const review=await options({date:null});
    const parsedOptions=parsePairedInvoiceCreditOptions(review,owner.business,owner.customer,invoice.invoiceId,firstAllocation.id,today);
    assert.equal(parsedOptions.reviewedArCents,'0');
    assert.equal(parsedOptions.returnsMappingId,returnsMapping);
    assert.equal(parsedOptions.chronologySupported,true);
    assert.equal(parsedOptions.release.paymentId,firstPay.paymentId);
    assert.equal(parsedOptions.release.fundsMappingId,fundsMapping);
    assert.equal(parsedOptions.release.openPeriod,true);
    assert.deepEqual(parsedOptions.release.availableRanges,[{firstCent:'1',lastCent:'19000'}]);
    assert.equal(parsedOptions.credit.lines.find(line=>line.invoiceItemId===item.id).maximumStandaloneCents,'0');
    assert.throws(()=>parsePairedInvoiceCreditOptions({...review,reviewedArCents:'1'},owner.business,owner.customer,invoice.invoiceId,firstAllocation.id,today));
    assert.equal(pairedInvoiceCreditRefusal('PAIRED_INVOICE_CREDIT_CHRONOLOGY_REQUIRED'),'chronology_review_required');
    assert.equal(pairedInvoiceCreditRefusal('PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED'),null);
    assert.deepEqual(await options({customerId:foreign.customer}),{state:'absent'});
    assert.deepEqual(await options({principal:foreign,customerId:foreign.customer}),{state:'absent'});
    assert.deepEqual(await options({allocationId:randomUUID()}),{state:'absent'});
    await assert.rejects(options({connection:web}),{code:'42501'});
    await assert.rejects(options({date:yesterday}),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    await assert.rejects(options({date:'9999-01-01'}),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    await assert.rejects(post(input(),{connection:web}),{code:'42501'});
    await assert.rejects(post(input({epoch:randomUUID()})),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(post(input({epoch:foreign.epoch}),{principal:foreign}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(post(input({customerId:foreign.customer})),{message:'INVOICE_CREDIT_ITEM_REQUIRED'});
    await assert.rejects(post(input({date:yesterday})),{message:'INVOICE_CREDIT_DATE_REQUIRED'});
    await assert.rejects(post(input({arCents:'1'})),{message:'PAIRED_INVOICE_CREDIT_BALANCE_CHANGED'});
    await assert.rejects(post(input({releaseLast:'19099'})),{message:'PAIRED_INVOICE_CREDIT_EXACT_RELEASE_REQUIRED'});
    await assert.rejects(post(input({releaseFirst:'18001'})),{message:'PAIRED_INVOICE_CREDIT_RELEASE_UNAVAILABLE'});
    await assert.rejects(post(input({allocationId:randomUUID(),releaseFirst:'1',releaseLast:'1100'})),
      {message:'PAIRED_INVOICE_CREDIT_ALLOCATION_REQUIRED'});
    await assert.rejects(post(input({fundsId:randomUUID(),releaseFirst:'1',releaseLast:'1100'})),{message:'UNAPPLICATION_FUNDS_MAPPING_REQUIRED'});
    await assert.rejects(post(input({returnsId:randomUUID(),releaseFirst:'1',releaseLast:'1100'})),{message:'INVOICE_CREDIT_BASIS_REQUIRED'});
    assert.deepEqual(await state(),original);
    const selected=parsePairedInvoiceCreditInput(input({releaseFirst:'1',releaseLast:'1100'}));
    const rejectedSelection=input({releaseFirst:'1',releaseLast:'1101'});
    assert.throws(()=>parsePairedInvoiceCreditInput(rejectedSelection));
    assert.deepEqual(await lookup(selected),{state:'absent'});
    await assert.rejects(lookup(selected,owner,web),{code:'42501'});
    const saved=await post(selected);
    assert.equal(saved.state,'committed');
    assert.deepEqual(await post(selected),saved);
    assert.deepEqual(await lookup(selected),saved);
    assert.deepEqual(await retire(selected),saved);
    assert.deepEqual(await lookup(selected,foreign),{state:'absent'});
    assert.deepEqual(await lookup({...selected,release:{...selected.release,reference:{...selected.release.reference,unapplicationId:randomUUID()}}}),
      {state:'conflict',reason:'operation'});
    assert.deepEqual(await post({...selected,credit:{...selected.credit,returnsMappingId:randomUUID()}}),{state:'conflict',reason:'operation'});
    const parsed=parsePairedInvoiceCreditResult(saved,owner.business,selected);
    assert.deepEqual(parsePairedInvoiceCreditResolution(saved,owner.business,referenceOf(selected)),parsed);
    assert.equal(parsed.state,'committed');
    assert.equal(parsed.receipt.release.fundingOriginId,firstPay.fundingOriginId);
    assert.equal(parsed.receipt.release.parentPartitionId,firstAllocation.fundingPartitionId);
    assert.equal(parsed.receipt.release.cents,'1100');
    assert.equal(parsed.receipt.credit.taxCents,'100');
    assert.throws(()=>parsePairedInvoiceCreditResult({...saved,receipt:{...saved.receipt,release:{...saved.receipt.release,
      receivableId:randomUUID()}}},owner.business,selected));
    const after=await state();
    assert.equal(after.get(ar),'0');
    assert.equal(after.get(bank),'22000');
    assert.equal(after.get(funds),'-1100');
    assert.equal(after.get(returns),saved.receipt.credit.returnsCents);
    assert.deepEqual((await options()).release.availableRanges,[{firstCent:'1101',lastCent:'19000'}]);
    const posted=await admin.query(`SELECT e.template,e.event_sequence,e.group_id,e.effective_on::text,
      g.operation_id FROM crest.financial_events e JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
      WHERE e.business_id=$1 AND g.operation_id=$2 ORDER BY e.event_sequence`,[owner.business,selected.credit.reference.operationId]);
    assert.deepEqual(posted.rows.map(row=>[row.template,row.event_sequence,row.effective_on]),[['P05',1,today],['P07',2,today]]);
    assert.equal(new Set(posted.rows.map(row=>row.group_id)).size,1);
    const journal=parseFictionalJournalV5(await command(finance,'read_fictional_journal_v5',[...owner.auth(),today,ar,null,20]),
      owner.business,today,ar,null,20);
    assert.deepEqual(journal.rows.slice(-2).map(row=>[row.template,row.debitCents,row.creditCents]),[['P05','1100','0'],['P07','0','1100']]);
    const moves=(await admin.query('SELECT count(*)::int AS n FROM crest.money_movements WHERE business_id=$1',[owner.business])).rows[0].n;
    assert.equal(moves,2);
    const audit=(await admin.query(`SELECT entity_kind,delta FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2
      ORDER BY entity_kind`,[owner.business,selected.credit.reference.operationId])).rows;
    assert.deepEqual(audit.map(row=>[row.entity_kind,row.delta.after]),[['allocation_unapplications',saved.receipt.release],['invoice_credits',saved.receipt.credit]]);
    await assert.rejects(admin.query('DELETE FROM crest.paired_invoice_credit_releases WHERE business_id=$1',[owner.business]),{code:'55000'});
    const tombstone=input({firstCent:'1101',lastCent:'1200',releaseFirst:'1101',releaseLast:'1200'});
    await assert.rejects(retire(tombstone,{connection:web}),{code:'42501'});
    await assert.rejects(retire(tombstone,{epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retire(tombstone,{reason:''}),{message:'INVOICE_CREDIT_INPUT_REQUIRED'});
    assert.deepEqual(await lookup(tombstone),{state:'absent'});
    const retired=await retire(tombstone);
    assert.equal(retired.state,'retired');
    assert.equal(parsePairedInvoiceCreditResolution(retired,owner.business,referenceOf(tombstone)).state,'retired');
    assert.deepEqual(await lookup(tombstone),retired);
    assert.deepEqual(await retire(tombstone),retired);
    assert.deepEqual(await post(tombstone),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup({...tombstone,release:{...tombstone.release,
      reference:{...tombstone.release.reference,unapplicationId:randomUUID()}}}),{state:'conflict',reason:'operation'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(command(exporter,'invoice_credit_source_snapshot_context',[owner.business]),
        {message:'CREST_PAIRED_INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}

    const raceReview=()=>input({firstCent:'1101',lastCent:'1200',releaseFirst:'1101',releaseLast:'1200'});
    const race=await Promise.allSettled([post(raceReview()),post(raceReview(),{connection:peer})]);
    assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(race.find(result=>result.status==='rejected').reason.message,'INVOICE_CREDIT_RANGE_UNAVAILABLE');
    await assert.rejects(post(input({firstCent:'1201',lastCent:'1300',allocationId:secondAllocation.id,releaseFirst:'1',releaseLast:'100',
      fundsId:randomUUID()})),{message:'UNAPPLICATION_FUNDS_MAPPING_REQUIRED'});
    const final=await state();
    assert.equal(final.get(ar),'0');
    assert.equal(final.get(bank),'22000');
    assert.equal(final.get(funds),'-1200');
    const counts=async()=>(await admin.query(`SELECT (SELECT count(*)::int FROM crest.invoice_credits WHERE business_id=$1) AS credits,
      (SELECT count(*)::int FROM crest.allocation_unapplications WHERE business_id=$1) AS releases,
      (SELECT count(*)::int FROM crest.paired_invoice_credit_releases WHERE business_id=$1) AS pairs`,[owner.business])).rows[0];
    assert.deepEqual(await counts(),{credits:2,releases:2,pairs:2});

    const failure=input({firstCent:'1201',lastCent:'1300',releaseFirst:'1201',releaseLast:'1300'});
    await admin.query(`CREATE FUNCTION public.test_reject_paired_credit_second_event() RETURNS trigger LANGUAGE plpgsql
      AS $fixture$ BEGIN RAISE EXCEPTION 'TEST_PAIRED_CREDIT_SECOND_EVENT_FAILED'; END $fixture$;
      CREATE TRIGGER test_reject_paired_credit_second_event BEFORE INSERT ON crest.financial_events
      FOR EACH ROW WHEN (NEW.template='P07' AND NEW.event_sequence=2) EXECUTE FUNCTION public.test_reject_paired_credit_second_event()`);
    try {
      await assert.rejects(post(failure),{message:'TEST_PAIRED_CREDIT_SECOND_EVENT_FAILED'});
      assert.deepEqual(await counts(),{credits:2,releases:2,pairs:2});
      assert.deepEqual(await state(),final);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',
        [owner.business,failure.credit.reference.operationId])).rows[0].n,0);
    } finally {
      await admin.query(`DROP TRIGGER test_reject_paired_credit_second_event ON crest.financial_events;
        DROP FUNCTION public.test_reject_paired_credit_second_event()`);
    }
    assert.equal((await post(failure)).state,'committed');
    assert.deepEqual(await counts(),{credits:3,releases:3,pairs:3});

    const partlyPaid=await makeOwner(owner,{customerId:owner.customer,paidLineDiscount:{kind:'fixed',cents:'3000'},serviceVersionFor:async()=>
      (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[owner.business,service])).rows[0].id});
    const {invoice:partlyPaidInvoice}=await issueInvoice({admin,web,finance,owner:partlyPaid,service,today,setup:false,
      appointmentDay:'2026-11-04'});
    const {rows:[partlyPaidItem]}=await admin.query('SELECT id FROM crest.invoice_items WHERE invoice_id=$1 AND total_cents>0',
      [partlyPaidInvoice.invoiceId]);
    const partlyPaidReceipt=await pay('21500','fictional-paired-partly-paid',partlyPaidInvoice.receivableId);
    const [partialAllocation]=partlyPaidReceipt.applications;
    assert.equal((await state()).get(ar),'500');
    assert.deepEqual(await options({invoiceId:partlyPaidInvoice.invoiceId}),{state:'absent'});
    const partlyPaidReview=await options({invoiceId:partlyPaidInvoice.invoiceId,allocationId:partialAllocation.id});
    assert.equal(partlyPaidReview.reviewedArCents,'500');
    assert.equal(partlyPaidReview.credit.availableBalanceCents,'500');
    await assert.rejects(post(input({invoiceItemId:partlyPaidItem.id,arCents:'500',releaseFirst:'1',releaseLast:'600'})),
      {message:'PAIRED_INVOICE_CREDIT_ALLOCATION_REQUIRED'});
    const partial=parsePairedInvoiceCreditInput(input({invoiceItemId:partlyPaidItem.id,arCents:'500',
      allocationId:partialAllocation.id,releaseFirst:'1',releaseLast:'600'}));
    const partialSaved=await post(partial);
    assert.equal(partialSaved.receipt.credit.inclusiveCents,'1100');
    assert.equal(partialSaved.receipt.release.cents,'600');
    assert.equal(partialSaved.receipt.release.fundingOriginId,partlyPaidReceipt.fundingOriginId);
    const partialAfter=await state();
    assert.equal(partialAfter.get(ar),'0');
    assert.equal(partialAfter.get(bank),'43500');
    assert.equal(partialAfter.get(funds),'-1900');
    assert.deepEqual(await counts(),{credits:4,releases:4,pairs:4});

    const uncertain=input({firstCent:'1301',lastCent:'1400',releaseFirst:'1301',releaseLast:'1400'});
    const [postRace,retireRace]=await Promise.all([post(uncertain),retire(uncertain,{connection:peer})]);
    assert(['retired','committed'].includes(retireRace.state));
    if(retireRace.state==='committed')assert.deepEqual(postRace,retireRace);
    else assert.deepEqual(postRace,{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(uncertain),retireRace);
    await assert.rejects(command(finance,'paired_invoice_credit_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(exporter,'paired_invoice_credit_source_snapshot_context',[owner.business]),{code:'25001'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let linkToken;
    try {
      const capture=businessId=>capturePairedInvoiceCreditSource(businessId,async(sql,args)=>(await exporter.query(sql,args)).rows);
      const captured=await capture(owner.business);
      linkToken=captured.paired.snapshotToken;
      assert.equal(captured.paired.rows.paired_invoice_credit_releases.length,4+Number(postRace.state==='committed'));
      assert.equal(captured.credit.rows.invoice_credits.length,captured.paired.rows.paired_invoice_credit_releases.length);
      assert.equal(captured.unapplication.rows.allocation_unapplications.length,captured.paired.rows.paired_invoice_credit_releases.length);
      assert.deepEqual((await capture(foreign.business)).paired.rows.paired_invoice_credit_releases,[]);
      const link=formatPairedInvoiceCreditLinkCsv(captured);
      assert.deepEqual(readSourceExportCsv(link.csv,[],{columns:link.columns,maxRows:10}),captured.paired.rows.paired_invoice_credit_releases);
    } finally {await exporter.query('ROLLBACK');}
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assert.rejects(command(exporter,'paired_invoice_credit_source_snapshot_page',[
        owner.business,linkToken,'paired_invoice_credit_releases',null,20,
      ]),{message:'CREST_PAIRED_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED'});
    } finally {await exporter.query('ROLLBACK');}
    await assert.rejects(captureV5(),{message:'CREST_PAIRED_INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED'});
    const portable=await captureExport(exporter,owner.business);
    const {manifest:manifestText,files}=portable.combined;
    const manifest=JSON.parse(manifestText);
    assert.equal(verifyFinanceSourceExport(manifestText,files,owner.business).profile,'crest.posted-finance-source.v6');
    assert.equal(manifest.sourceTokens.paired,portable.source.paired.snapshotToken);
    assert.equal(manifest.rowCounts.paired_invoice_credit_releases,4+Number(postRace.state==='committed'));
    const linkName='paired_invoice_credit_releases.csv';
    const originalLink=files.find(file=>file.name===linkName).content;
    const tampered=originalLink.replace(/,"500"\r\n/,',"499"\r\n');
    assert.notEqual(tampered,originalLink);
    const tamperedFiles=files.map(file=>file.name===linkName?{...file,content:tampered}:file);
    const repairedManifest={...manifest,files:manifest.files.map(part=>part.name===linkName?{...part,
      bytes:Buffer.byteLength(tampered),sha256:createHash('sha256').update(tampered).digest('hex')}:part)};
    assert.throws(()=>verifyFinanceSourceExport(JSON.stringify(repairedManifest),tamperedFiles,owner.business),
      {message:'PAIRED_INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED'});
    const neutral=await sandbox.connect(await sandbox.database());
    try {
      const reconstructed=await exerciseNeutralFinanceImport(neutral,files,owner.business,{includeCredits:true,includePairedCredits:true});
      assert.equal(reconstructed.tables,29);
      assert.equal(reconstructed.sourceRows,Object.values(manifest.rowCounts).reduce((total,rows)=>total+rows,0));
      assert.equal(reconstructed.debit,reconstructed.credit);
    } finally {await neutral.end();}
    await verifyRecovery({candidate,admin,target,owner,captured:portable,saved,retired});
    await verifyServiceRefund({candidate,sandbox,target,admin,exporter,finance,web,owner,foreign,invoice,saved,channel,bank,today});
    await verifyReceivableAging({admin,finance,web,owner,foreign,saved,today,sandbox,target,makeOwner,service});
    await verifyPostedFinanceLauncher({admin,owner,sandbox,target});
    await verifyCustomerFundsReport({finance,web,owner,foreign,saved,today});
    await verifyExcessReceipt({admin,finance,web,exporter,owner,foreign,channel,fundsMapping,today,makeOwner,service,sandbox,target});
  } finally {
    try {await sandbox?.close();} finally {await cluster.close();}
  }
});
