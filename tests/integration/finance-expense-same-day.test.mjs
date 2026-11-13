import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { captureInvoiceSource } from '../../src/bookkeeping/invoice-source.ts';
import { captureReceiptSource } from '../../src/bookkeeping/receipt-source.ts';
import { capturePostedExpenseSource, formatPostedExpenseSource, postedExpenseSourceAddedColumns,
  postedExpenseSourceCoverage } from '../../src/bookkeeping/posted-expense-source.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';
import { expenseReceiptRecoveryInventory } from '../../src/bookkeeping/expenses/receipt-export.ts';
import { captureObjectArchive, restoreObjectArchive } from '../../src/tooling/object-recovery.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { financeExpense79Candidate } from '../support/finance-expense79-candidate.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { objectDirectory, encryptor, decryptor } from '../support/object-recovery-drill.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupExpense79CandidateDatabase, backupLegacy78Database, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreExpense79CandidateDatabase, restoreLegacy78Database } from '../support/recovery-drill.mjs';

async function command(connection, name, values) {
  const args = values.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + name + '(' + args + ') AS value', values)).rows[0].value;
}

async function commit(connection, name, values) {
  const result = await command(connection, name, values);
  assert.equal(result.state, 'committed', JSON.stringify(result));
  return result.receipt;
}

async function verifyRecovery({ candidate, admin, target, owner, captured, request, retiredKey, posted, retired, original, preview, attachmentRef }) {
  const directory = await privateWorkspace();
  const point = join(directory,'point');
  const bounded = () => AbortSignal.timeout(60000);
  let destination, restored, reader, finance;
  try {
    await mkdir(point,{mode:0o700});
    const keys = await keyPair(directory);
    const sourceObjects = await objectDirectory(join(directory,'source-objects'));
    const vault = await objectDirectory(join(directory,'vault'));
    const restoredObjects = await objectDirectory(join(directory,'restored-objects'));
    await sourceObjects.put(attachmentRef.originalKey,original,bounded());
    await sourceObjects.put(attachmentRef.previewKey,preview,bounded());
    const objectCapture = {
      async inventory(snapshot) {
        const expenseHistory = (await snapshot.query(`SELECT crest_private.expense_projection(r) AS value
          FROM crest.expense_revisions r WHERE business_id=$1 ORDER BY expense_id,revision`,[owner.business])).rows.map(row=>row.value);
        const receiptHistory = (await snapshot.query(`SELECT crest_private.expense_receipt_projection(r) AS value
          FROM crest.expense_receipt_revisions r WHERE business_id=$1 ORDER BY receipt_id,revision`,[owner.business])).rows.map(row=>row.value);
        const objects = expenseReceiptRecoveryInventory({businessId:owner.business,expenseHistory,receiptHistory});
        assert.equal(objects.length,2);
        return objects;
      },
      capture: objects=>captureObjectArchive(randomUUID(),objects,{readSource:sourceObjects.read,seal:encryptor(keys.recipient),
        putVault:vault.put,readVault:vault.read},bounded()),
    };
    await assert.rejects(backupLegacy78Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
    const {manifest}=await backupExpense79CandidateDatabase(candidate,admin,target,point,keys.recipient,objectCapture);
    assert.equal(manifest.schemaVersion,79);
    assert.equal(manifest.heldExpenseMigrationSha256,candidate.sha256);
    assert.equal(manifest.registrySha256,candidate.registrySha256);
    assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.objectArchive.inventory.length,2);
    assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='posted_expenses').rows,3);
    destination=await recoveryCluster();
    const url=await destination.database();
    assert.notEqual(new URL(url).port,new URL(target).port);
    restored=await connect(url);
    await assert.rejects(restoreLegacy78Database(point,keys.path,url),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
    assert.deepEqual(await inventory(restored),[]);
    const rebuilt=await restoreExpense79CandidateDatabase(candidate,point,keys.path,url,async archive=>{
      const result=await restoreObjectArchive(archive.receipt,archive.inventory,{readVault:vault.read,unseal:decryptor(keys.path),
        putDestination:restoredObjects.put,readDestination:restoredObjects.read},bounded());
      assert.equal(result.objectCount,2);
    });
    assert.deepEqual(rebuilt,manifest);
    assert.deepEqual(await inventory(restored),manifest.rows);
    assert.deepEqual(await restoredObjects.read(attachmentRef.originalKey,original.length,bounded()),original);
    assert.deepEqual(await restoredObjects.read(attachmentRef.previewKey,preview.length,bounded()),preview);
    reader=await connect(url);
    await reader.query('SET ROLE crest_export');
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const after=await capturePostedExpenseSource(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows);
      assert.notEqual(after.snapshotToken,captured.snapshotToken);
      assert.deepEqual(after.rows,captured.rows);
      assert.deepEqual(after.history,captured.history);
      const files=source=>formatPostedExpenseSource(source).files.filter(file=>file.name.endsWith('.csv')||file.name.endsWith('.ndjson'));
      assert.deepEqual(files(after),files(captured));
      assert.equal((await captureInvoiceSource(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows[0].result)).counts.financial_events,'0');
      assert.equal((await captureReceiptSource(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows)).counts.financial_events,'0');
    } finally {await reader.query('ROLLBACK');}
    const epoch=randomUUID(), provider=randomUUID(), session=randomUUID(), credential=randomBytes(32);
    await restored.query('BEGIN');
    try{
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
    const lookup=(auth,tuple)=>command(finance,'lookup_fictional_same_day_expense',[...auth,owner.epoch,tuple.operation,tuple.postId]);
    await assert.rejects(lookup(old,request),{message:'CREST_TENANT_READ_DENIED'});
    assert.deepEqual(await lookup(fresh,request),posted);
    assert.deepEqual(await lookup(fresh,retiredKey),retired);
    assert.deepEqual(await command(finance,'read_fictional_same_day_expense_options',[...fresh,posted.receipt.expenseId]),
      {state:'posted',receipt:posted.receipt});
    await assert.rejects(command(finance,'post_fictional_same_day_expense',[
      ...fresh,owner.epoch,request.operation,request.postId,posted.receipt.expenseId,'1',randomUUID(),'1',posted.receipt.mappingId,
      posted.receipt.incurredOn,posted.receipt.paidOn,'none','0',null,'Fictional missing evidence',null,'Fictional replay',
      {namespace:'ledger',id:'old-epoch',rawReference:'Fictional old epoch replay'},
    ]),{message:'RECOVERY_REVIEW_REQUIRED'});
  } finally {
    try {await finance?.end();} finally {
      try {await reader?.end();} finally {
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

test('held P12 posts and restores exact same-day expense, outflow, receipt bytes, and immutable history', { timeout: 180000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database();
    const admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin, target);
    await sandbox.apply(target, await sandbox.prefix(78));
    const candidate=await financeExpense79Candidate(sandbox);
    await sandbox.apply(target,candidate.directory);
    const web = await sandbox.connect(target);
    const finance = await sandbox.connect(target);
    const peer = await sandbox.connect(target);
    const reader = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    await reader.query('SET ROLE crest_export');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const owner = await makeOwner();
    const foreign = await makeOwner();
    for (const principal of [owner, foreign]) {
      await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
        SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,
      [principal.business, principal.actor]);
    }
    const mutate = () => [...owner.auth(), owner.epoch, randomUUID()];
    async function account(identity, name) {
      const id = randomUUID();
      await commit(finance, 'save_finance_account', [...mutate(), 1, id, '0', { identity, name, active: true, reason: null }]);
      return id;
    }
    const bank = await account({ code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money' }, 'Fictional dedicated bank');
    const supplies = await account({ code:'5000',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'expense' }, 'Fictional supplies');
    const prepaid = await account({ code:'1150',accountType:'asset',normalSide:'debit',controlKind:'prepaid',reportRole:'prepaid' }, 'Fictional prepaid');
    const approve = (purpose, id) => commit(finance, 'approve_fixed_finance_mapping',
      [...mutate(), purpose, '0', id, '2026-01-01', 'Fictional classification review']);
    const mapping = await approve('category_supplies', supplies);
    const prepaidMapping = await approve('category_equipment', prepaid);
    const channel = randomUUID();
    await commit(finance, 'save_money_channel', [...mutate(), channel, '0', {
      identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'9182'},
      label:'Fictional bank',effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional verified business ownership',openingState:'verified_zero',
      openingOn:'2026-01-01',openingCents:'0',openingEvidence:'Fictional verified opening',active:true,reason:'Fictional review',
    }]);
    const { rows: [{ day, yesterday }] } = await admin.query(
      "SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day,((clock_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday");
    await commit(finance,'configure_fictional_invoice_setup',[...mutate(),{
      kind:'accounting_period',startsOn:day,reason:'Fictional period approval',
    }]);
    const source = { paidOn:day,amountCents:'10000',currency:'USD',category:'supplies',description:'Fictional wash soap',
      vendor:'Fictional supply house',paymentMethod:'bank',reference:null,notes:null,voided:false,changeReason:null };
    const save = (expense, payload = source, revision='0') =>
      command(web,'save_expense',[...mutate(),expense,revision,payload]);
    const expense = randomUUID();
    assert.equal((await save(expense)).state,'committed');
    const external = { namespace:'ledger',id:'AbC-100',rawReference:'Fictional original debit AbC-100' };
    const post = ({ id=expense,postId=randomUUID(),operation=randomUUID(),epoch=owner.epoch,revision='1',channelId=channel,channelVersion='1',
      mappingId=mapping.id,incurred=day,paid=day,tax='verified_nonrecoverable',taxCents='650',receiptId=null,
      missing='Paper receipt unavailable; verified bank debit retained',vendorReason=null,
      reason='Reviewed ordinary full-business purchase and confirmed actual debit',identity=external,connection=finance }={}) =>
      command(connection,'post_fictional_same_day_expense',[...owner.auth(),epoch,operation,postId,id,revision,
        channelId,channelVersion,mappingId,incurred,paid,tax,taxCents,receiptId,missing,vendorReason,reason,identity]);
    const lookup = (epoch, operation, id, connection=finance) =>
      command(connection,'lookup_fictional_same_day_expense',[...owner.auth(),epoch,operation,id]);
    const options = (id=expense,principal=owner,connection=finance) =>
      command(connection,'read_fictional_same_day_expense_options',[...principal.auth(),id]);
    const retire=(tuple,epoch=owner.epoch,connection=finance)=>command(connection,'retire_fictional_same_day_expense',
      [...owner.auth(),epoch,tuple.operation,owner.epoch,tuple.postId,'Verified the original attempt was absent']);
    assert.deepEqual(await options(randomUUID()),{state:'absent'});
    assert.deepEqual(await options(expense,foreign),{state:'absent'});
    await assert.rejects(options(expense,owner,web),{code:'42501'});
    const ready=await options();
    assert.deepEqual(ready,{state:'review',schemaVersion:1,businessId:owner.business,expenseId:expense,expenseRevision:'1',
      retainedPaidOn:day,grossCents:'10000',category:'supplies',description:source.description,vendor:source.vendor,
      mapping:{mappingId:mapping.id,accountId:supplies,accountCode:'5000',purpose:'category_supplies'},
      channels:[{channelId:channel,channelVersionId:ready.channels[0].channelVersionId,version:'1',
        accountId:bank,label:'Fictional bank',kind:'bank'}],validatedReceipts:[],openPeriod:true});

    await assert.rejects(post({connection:web}),{code:'42501'});
    await assert.rejects(post({epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(post({incurred:yesterday}),{message:'PAID_EXPENSE_SAME_DATE_REQUIRED'});
    await assert.rejects(post({paid:yesterday,incurred:yesterday}),{message:'PAID_EXPENSE_SAME_DATE_REQUIRED'});
    await assert.rejects(post({mappingId:randomUUID()}),{message:'PAID_EXPENSE_ORDINARY_MAPPING_REQUIRED'});
    await assert.rejects(post({channelVersion:'2'}),{message:'PAID_EXPENSE_VERIFIED_CHANNEL_REQUIRED'});
    await assert.rejects(post({identity:null}),{message:'PAID_EXPENSE_INPUT_REQUIRED'});
    await assert.rejects(post({missing:null}),{message:'PAID_EXPENSE_INPUT_REQUIRED'});
    await assert.rejects(post({receiptId:randomUUID(),missing:null}),{message:'PAID_EXPENSE_EVIDENCE_REQUIRED'});
    await assert.rejects(post({vendorReason:'Unnecessary'}),{message:'PAID_EXPENSE_EVIDENCE_REQUIRED'});
    await assert.rejects(post({tax:'unresolved'}),{message:'PAID_EXPENSE_INPUT_REQUIRED'});
    await assert.rejects(post({taxCents:'10001'}),{message:'PAID_EXPENSE_PURCHASE_TAX_REVIEW_REQUIRED'});
    await assert.rejects(post({revision:'2'}),{message:'PAID_EXPENSE_CURRENT_REVISION_REQUIRED'});
    const prepaidExpense=randomUUID();
    assert.equal((await save(prepaidExpense,{...source,category:'equipment'})).state,'committed');
    await assert.rejects(post({id:prepaidExpense,mappingId:prepaidMapping.id}),{message:'PAID_EXPENSE_ORDINARY_MAPPING_REQUIRED'});
    const foreignExpense=randomUUID();
    await commit(web,'save_expense',[...foreign.auth(),foreign.epoch,randomUUID(),foreignExpense,'0',source]);
    await assert.rejects(post({id:foreignExpense}),{message:'PAID_EXPENSE_CURRENT_REVISION_REQUIRED'});
    const oldExpense=randomUUID();
    assert.equal((await save(oldExpense,{...source,paidOn:yesterday})).state,'committed');
    await assert.rejects(post({id:oldExpense,incurred:yesterday,paid:yesterday}),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});

    const request={postId:randomUUID(),operation:randomUUID()};
    const retiredKey={postId:randomUUID(),operation:randomUUID()};
    await assert.rejects(retire(retiredKey,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retire(retiredKey,owner.epoch,web),{code:'42501'});
    const retired=await retire(retiredKey);
    assert.deepEqual(retired,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,
      operationId:retiredKey.operation,postedExpenseId:retiredKey.postId,originalEpoch:owner.epoch,reviewEpoch:owner.epoch,
      reason:'Verified the original attempt was absent'}});
    assert.deepEqual(await retire(retiredKey),retired);
    assert.deepEqual(await lookup(owner.epoch,retiredKey.operation,retiredKey.postId),retired);
    assert.deepEqual(await post(retiredKey),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(owner.epoch,request.operation,request.postId),{state:'absent'});
    const posted=await post(request);
    assert.equal(posted.state,'committed');
    assert.equal(posted.receipt.expenseId,expense);
    assert.equal(posted.receipt.incurredOn,day);
    assert.equal(posted.receipt.paidOn,day);
    assert.equal(posted.receipt.grossCents,'10000');
    assert.equal(posted.receipt.purchaseTaxCents,'650');
    assert.equal(posted.receipt.purchaseTaxTreatment,'verified_nonrecoverable');
    assert.equal(posted.receipt.moneyAccountId,bank);
    assert.equal(posted.receipt.expenseAccountId,supplies);
    assert.deepEqual(await post(request),posted);
    assert.deepEqual(await post({...request,reason:'Different review'}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(owner.epoch,request.operation,request.postId),posted);
    assert.deepEqual(await retire(request),posted);
    assert.deepEqual(await options(),{state:'posted',receipt:posted.receipt});
    assert.deepEqual(await lookup(randomUUID(),request.operation,request.postId),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(owner.epoch,request.operation,randomUUID()),{state:'conflict',reason:'operation'});
    await assert.rejects(lookup(owner.epoch,request.operation,request.postId,web),{code:'42501'});
    await assert.rejects(post(),{message:'PAID_EXPENSE_ALREADY_POSTED'});
    assert.equal((await save(expense,{...source,voided:true,changeReason:'Attempted silent void'},'1')).state,'conflict');
    await assert.rejects(admin.query('DELETE FROM crest.posted_expenses WHERE id=$1',[request.postId]),{code:'55000'});

    const duplicate=randomUUID();
    assert.equal((await save(duplicate)).state,'committed');
    await assert.rejects(post({id:duplicate}),{message:'PAID_EXPENSE_EXTERNAL_ID_ALREADY_RECORDED'});
    const valid2={namespace:'ledger',id:'abc-100',rawReference:'Case-sensitive fictional debit'};
    const valid3={namespace:'ledger',id:'new-100',rawReference:'Distinct fictional debit'};
    const parallel=await Promise.allSettled([
      post({id:duplicate,identity:valid2,tax:'none',taxCents:'0'}),
      post({id:duplicate,identity:valid3,tax:'none',taxCents:'0',connection:peer}),
    ]);
    assert.equal(parallel.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(parallel.find(result=>result.status==='rejected').reason.message,'PAID_EXPENSE_ALREADY_POSTED');

    const {rows:effects}=await admin.query(`SELECT e.template,e.effective_on::text,l.purpose,l.account_id,l.debit_cents::text,
      l.credit_cents::text,m.signed_cents::text AS movement,v.signed_cents::text AS evidence,v.external_id
      FROM crest.financial_events e JOIN crest.journal_entries j ON j.business_id=e.business_id AND j.event_id=e.id
      JOIN crest.journal_lines l ON l.business_id=j.business_id AND l.entry_id=j.id
      JOIN crest.money_movements m ON m.business_id=e.business_id AND m.event_id=e.id
      JOIN crest.external_money_evidence v ON v.business_id=m.business_id AND v.id=m.evidence_id
      WHERE e.business_id=$1 AND e.id=$2 ORDER BY l.purpose`,[owner.business,posted.receipt.eventId]);
    assert.deepEqual(effects,[
      {template:'P12',effective_on:day,purpose:'expense_cost',account_id:supplies,debit_cents:'10000',credit_cents:'0',
        movement:'-10000',evidence:'-10000',external_id:external.id},
      {template:'P12',effective_on:day,purpose:'expense_money',account_id:bank,debit_cents:'0',credit_cents:'10000',
        movement:'-10000',evidence:'-10000',external_id:external.id},
    ]);
    const attachedExpense=randomUUID();
    assert.equal((await save(attachedExpense,{...source,vendor:null})).state,'committed');
    const attachment=randomUUID();
    const original=await sharp({create:{width:8,height:4,channels:3,background:'#224466'}}).png().toBuffer();
    const preview=await sharp(original).jpeg().toBuffer();
    const hash=value=>createHash('sha256').update(value).digest('hex');
    const reserved=await commit(web,'reserve_expense_receipt',[...mutate(),attachment,attachedExpense,'1','image/png',original.length]);
    const attachmentRef=reserved.record.reservation;
    const attachmentIdentity={namespace:'ledger',id:'receipt-attached',rawReference:'Fictional debit with supporting image'};
    const attached={id:attachedExpense,receiptId:attachment,missing:null,vendorReason:'Vendor name missing from receipt',
      identity:attachmentIdentity,tax:'none',taxCents:'0'};
    await assert.rejects(post(attached),{message:'PAID_EXPENSE_EVIDENCE_REQUIRED'});
    await commit(web,'publish_expense_receipt',[...mutate(),attachment,{
      status:'PrivateValidatedCandidate',validationVersion:'crest-image-v1-sharp-0.35.5',
      source:{sha256:hash(original),byteSize:original.length,detectedType:'image/png',width:8,height:4},
      original:{key:attachmentRef.originalKey,byteSize:original.length,sha256:hash(original)},
      preview:{key:attachmentRef.previewKey,byteSize:preview.length,sha256:hash(preview),contentType:'image/jpeg',width:8,height:4},
    }]);
    assert.deepEqual((await options(attachedExpense)).validatedReceipts,[{receiptId:attachment,revision:'2'}]);
    const attachedPost=await post(attached);
    assert.equal(attachedPost.receipt.receiptId,attachment);
    assert.equal(attachedPost.receipt.receiptRevision,'2');
    assert.equal(attachedPost.receipt.missingReceiptReason,null);
    await admin.query('BEGIN');
    try {
      const forged=await admin.query(`INSERT INTO crest.external_money_evidence
        (business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
         normalization_rule,confirmed_on,signed_cents,currency)
        SELECT v.business_id,v.provider_namespace,v.external_account_id,v.id_namespace,'forged-orphan','Fictional orphan',
         v.normalization_rule,v.confirmed_on,v.signed_cents,v.currency FROM crest.external_money_evidence v
         WHERE v.id=$1 RETURNING id`,[posted.receipt.externalEvidenceId]);
      await admin.query(`INSERT INTO crest.posted_expenses
        (id,business_id,expense_id,expense_revision,incurred_on,paid_on,gross_cents,purchase_tax_cents,purchase_tax_treatment,
         mapping_id,expense_account_id,channel_version_id,money_account_id,evidence_id,missing_receipt_reason,
         review_reason,operation_id,created_by)
        SELECT $1,p.business_id,$2,p.expense_revision,p.incurred_on,p.paid_on,p.gross_cents,p.purchase_tax_cents,p.purchase_tax_treatment,
         p.mapping_id,p.expense_account_id,p.channel_version_id,p.money_account_id,$3,p.missing_receipt_reason,
         'Forged incomplete posting',$4,p.created_by FROM crest.posted_expenses p WHERE p.id=$5`,
        [randomUUID(),oldExpense,forged.rows[0].id,retiredKey.operation,request.postId]);
      await assert.rejects(admin.query('SET CONSTRAINTS crest.posted_expense_complete IMMEDIATE'),
        {message:'PAID_EXPENSE_SOURCE_REQUIRED'});
    } finally {await admin.query('ROLLBACK');}
    await assert.rejects(reader.query('SELECT id FROM crest.posted_expenses'),{code:'42501'});
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const invoices=await captureInvoiceSource(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows[0].result);
      const receipts=await captureReceiptSource(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows);
      assert.equal(invoices.counts.financial_events,'0');
      for(const count of Object.values(receipts.counts))assert.equal(count,'0');
    } finally {await reader.query('ROLLBACK');}
    await assert.rejects(command(finance,'posted_expense_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(web,'posted_expense_source_snapshot_context',[owner.business]),{code:'42501'});
    await assert.rejects(command(reader,'posted_expense_source_snapshot_context',[owner.business]),{code:'25001'});
    await assert.rejects(reader.query('SELECT token_hash FROM crest_private.app_sessions'),{code:'42501'});
    const groups=(await admin.query('SELECT * FROM crest_private.posted_expense_source_dictionary()')).rows;
    assert.deepEqual(groups.find(row=>row.group_name==='posted_expenses').fields.map(field=>field.split(':')[0]),postedExpenseSourceCoverage.required);
    assert.deepEqual(groups.find(row=>row.group_name==='financial_events').fields.slice(-1).map(field=>field.split(':')[0]),
      postedExpenseSourceAddedColumns['crest.financial_events']);
    const collect=business=>capturePostedExpenseSource(business,async(sql,args)=>(await reader.query(sql,args)).rows);
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let captured;
    try {
      captured=await collect(owner.business);
      assert.deepEqual(captured.counts,{posted_expenses:'3',external_money_evidence:'3',money_movements:'3',
        atomic_finance_groups:'3',financial_events:'3',journal_entries:'3',journal_lines:'6'});
      assert(Object.values((await collect(foreign.business)).counts).every(count=>count==='0'));
      const exported=formatPostedExpenseSource(captured);
      assert.equal(JSON.parse(exported.manifest).exactExpenseEffectsVerified,true);
      const file=name=>exported.files.find(part=>part.name===name).content;
      for(const group of Object.keys(captured.rows)){
        const {columns}=JSON.parse(file(group+'_dictionary.json'));
        const {escapes}=JSON.parse(file(group+'_escape_map.json'));
        assert.deepEqual(readSourceExportCsv(file(group+'.csv'),escapes,{columns,maxRows:100}),captured.rows[group]);
      }
      const originalEvidence=captured.rows.external_money_evidence.find(row=>row.id===posted.receipt.externalEvidenceId);
      assert.equal(originalEvidence.external_id,external.id);
      assert.equal(originalEvidence.signed_cents,'-10000');
      assert.equal(originalEvidence.raw_reference,external.rawReference);
      assert(file('operation_history.ndjson').includes(retiredKey.operation));
      const tampered=structuredClone(captured);
      tampered.rows.money_movements[0].signed_cents='-1';
      assert.throws(()=>formatPostedExpenseSource(tampered),{message:'POSTED_EXPENSE_SOURCE_REVIEW_REQUIRED'});
    } finally {await reader.query('ROLLBACK');}
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assert.rejects(command(reader,'posted_expense_source_snapshot_page',[owner.business,captured.snapshotToken,'posted_expenses',null,20]),
      {message:'CREST_POSTED_EXPENSE_SOURCE_PAGE_REQUIRED'});
    await reader.query('ROLLBACK');
    await verifyRecovery({candidate,admin,target,owner,captured,request,retiredKey,posted,retired,
      original,preview,attachmentRef});
  } finally {
    try { await sandbox?.close(); }
    finally { await cluster.close(); }
  }
});
