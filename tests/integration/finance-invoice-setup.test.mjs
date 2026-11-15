import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, values) {
  const args=values.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+command+'('+args+') AS result',values)).rows[0].result;
}

test('fictional owner configures original invoice numbering and an open accounting period with retained receipts', {timeout:120000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try {
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const target=await sandbox.database();
    const admin=await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    await sandbox.apply(target,await sandbox.prefix(76));
    await admin.query('BEGIN');
    try {
      for (const path of ['finance-issuance-prerequisites','finance-issuance-period-fence','finance-invoice-setup']) {
        await admin.query(await readFile(new URL('../../planning/proposals/'+path+'.sql',import.meta.url),'utf8'));
      }
      await admin.query('COMMIT');
    } catch(error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    const web=await sandbox.connect(target);
    const finance=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner();
    const foreign=await makeOwner();
    for (const principal of [owner,foreign]) {
      await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
        SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[principal.business,principal.actor]);
    }
    const read=(date=null,principal=owner,connection=finance)=>call(connection,'read_fictional_invoice_setup',[...principal.auth(),date]);
    const setup=(request,{principal=owner,connection=finance,epoch=principal.epoch,op=randomUUID()}={})=>
      call(connection,'configure_fictional_invoice_setup',[...principal.auth(),epoch,op,request]);
    const initial=await read();
    assert.deepEqual(initial,{schemaVersion:1,businessId:owner.business,today:initial.today,requestedOn:initial.today,timeZone:'UTC',
      series:null,openingPeriod:null,period:null});
    await assert.rejects(read(null,owner,web),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.invoice_series'),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.accounting_periods'),{code:'42501'});
    const seriesRequest={kind:'invoice_series',label:'TEST-CREST',reason:'Fictional owner approved the original series'};
    await assert.rejects(setup(seriesRequest,{connection:web}),{code:'42501'});
    await assert.rejects(setup(seriesRequest,{epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(setup({...seriesRequest,label:'incorrect / series'}),{message:'INVOICE_SETUP_INPUT_REQUIRED'});
    await assert.rejects(setup({...seriesRequest,reason:' '}),{message:'INVOICE_SETUP_INPUT_REQUIRED'});
    await assert.rejects(setup({...seriesRequest,kind:'recovery'}),{message:'INVOICE_SETUP_INPUT_REQUIRED'});
    await assert.rejects(setup({kind:'accounting_period',startsOn:'2026-02-31',reason:'Fictional review'}),{message:'INVOICE_SETUP_INPUT_REQUIRED'});
    const unauthorized={...owner,auth:()=>[...owner.auth().slice(0,7),foreign.business]};
    await assert.rejects(setup(seriesRequest,{principal:unauthorized}),{message:'CREST_MUTATION_AUTHORIZATION_DENIED'});
    const stale={...owner,auth:()=>[...owner.auth().slice(0,6),new Date(Date.now()-1000),owner.business]};
    await assert.rejects(setup(seriesRequest,{principal:stale}),{message:'CREST_MUTATION_AUTHORIZATION_DENIED'});

    const seriesOperation=randomUUID();
    const approved=await setup(seriesRequest,{op:seriesOperation});
    const seriesId=approved.receipt.record.id;
    assert.equal(approved.state,'committed');
    assert.deepEqual(approved.receipt,{schemaVersion:1,businessId:owner.business,operationId:seriesOperation,kind:'invoice_series',
      record:{id:seriesId,label:seriesRequest.label,recoveryEpoch:owner.epoch,kind:'original'},
      auditEventId:approved.receipt.auditEventId,reason:seriesRequest.reason});
    assert.deepEqual(await setup(seriesRequest,{op:seriesOperation}),approved);
    assert.deepEqual(await setup({...seriesRequest,label:'OTHER'},{op:seriesOperation}),{state:'conflict',reason:'operation'});
    await assert.rejects(setup(seriesRequest),{message:'INVOICE_ORIGINAL_SERIES_ALREADY_CONFIGURED'});
    assert.deepEqual((await read()).series,{...approved.receipt.record,operationId:seriesOperation});
    assert.equal((await read(null,foreign)).series,null);

    const firstStart='2026-01-15', nextStart='2026-02-01';
    const periodRequest={kind:'accounting_period',startsOn:firstStart,reason:'Fictional opening date reviewed'};
    const periodOperation=randomUUID();
    const firstPeriod=await setup(periodRequest,{op:periodOperation});
    assert.equal(firstPeriod.state,'committed');
    assert.deepEqual(firstPeriod.receipt.record,{id:firstPeriod.receipt.record.id,startsOn:firstStart,throughOn:'2026-01-31',
      timeZone:'UTC',openingBoundary:true});
    assert.deepEqual(await setup(periodRequest,{op:periodOperation}),firstPeriod);
    assert.equal((await read('2026-01-14')).period,null);
    assert.deepEqual((await read(firstStart)).period,{...firstPeriod.receipt.record,operationId:periodOperation,state:'open',generation:'0'});
    assert.deepEqual((await read()).openingPeriod,{...firstPeriod.receipt.record,operationId:periodOperation});
    await assert.rejects(setup({...periodRequest,startsOn:'2026-01-01'}),{message:'ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED'});
    await assert.rejects(setup({...periodRequest,startsOn:'2026-02-02'}),{message:'ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED'});
    await assert.rejects(setup({...periodRequest,startsOn:'9999-01-01'}),{message:'ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED'});
    const nextPeriod=await setup({...periodRequest,startsOn:nextStart});
    assert.equal(nextPeriod.state,'committed');
    assert.deepEqual(nextPeriod.receipt.record,{id:nextPeriod.receipt.record.id,startsOn:nextStart,throughOn:'2026-02-28',
      timeZone:'UTC',openingBoundary:false});
    await assert.rejects(setup({...periodRequest,startsOn:nextStart}),{message:'ACCOUNTING_PERIOD_ALREADY_CONFIGURED'});
    assert.equal((await read('2026-02-28')).period.id,nextPeriod.receipt.record.id);
    assert.equal((await read('2026-03-01')).period,null);
    assert.equal((await read(nextStart,foreign)).period,null);

    const source=(await admin.query(`SELECT o.result, a.delta,a.reason
      FROM crest_private.operations o JOIN crest_private.audit_events a USING(business_id,operation_id,actor_id)
      WHERE (o.business_id,o.operation_id)=($1,$2)`,[owner.business,seriesOperation])).rows[0];
    assert.deepEqual(source,{result:approved.receipt,delta:{schemaVersion:1,before:null,after:approved.receipt},reason:seriesRequest.reason});
    await assert.rejects(admin.query('DELETE FROM crest.invoice_series WHERE id=$1',[seriesId]),{code:'55000'});
    await assert.rejects(admin.query('UPDATE crest.accounting_periods SET starts_on=starts_on WHERE id=$1',[firstPeriod.receipt.record.id]),{code:'55000'});
    const forgedOp=randomUUID();
    await admin.query('BEGIN');
    try {
      await admin.query(`INSERT INTO crest_private.operations
        (business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
        VALUES($1,$2,$3,'finance.invoice_setup.configure',1,$4,$5,$3,'manual')`,
      [owner.business,forgedOp,owner.actor,owner.epoch,'a'.repeat(64)]);
      await admin.query(`INSERT INTO crest.accounting_periods
        (business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id)
        VALUES($1,'2026-03-01','2026-03-31','UTC',false,$2,$3)`,[owner.business,owner.actor,forgedOp]);
      await admin.query(`UPDATE crest_private.operations SET state='committed',result_schema_version=1,result='{"schemaVersion":1}'::jsonb
        WHERE (business_id,operation_id)=($1,$2)`,[owner.business,forgedOp]);
      await assert.rejects(admin.query('SET CONSTRAINTS crest.accounting_period_setup_audited IMMEDIATE'),{message:'INVOICE_SETUP_APPROVAL_REQUIRED'});
    } finally { await admin.query('ROLLBACK'); }
    const secondFinance=await sandbox.connect(target);
    await secondFinance.query('SET ROLE crest_finance_preview');
    const laterRequest={...periodRequest,startsOn:'2026-03-01'};
    const concurrent=await Promise.allSettled([setup(laterRequest),setup(laterRequest,{connection:secondFinance})]);
    assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(concurrent.find(result=>result.status==='rejected').reason.message,'ACCOUNTING_PERIOD_ALREADY_CONFIGURED');
    assert.equal((await read('2026-03-01')).period.state,'open');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.invoice_number_reservations')).rows[0].n,0);
  } finally {
    await sandbox?.close();
    await cluster.close();
  }
});
