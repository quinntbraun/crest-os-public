import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, args) {
  const parameters=args.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+command+'('+parameters+') AS result',args)).rows[0].result;
}

test('calendar workers serialize leases, preserve dispatched uncertainty and obey authority and request fences', {timeout:120000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const database=await sandbox.database(),admin=await sandbox.connect(database);
    await sandbox.apply(database,await sandbox.prefix(0),true);
    await installProviderSchema(admin,database);
    await sandbox.apply(database,await sandbox.prefix(76));
    await admin.query('BEGIN');
    try{
      for(const migration of ['outbox','dispatch']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+migration+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(),foreign=await makeOwner();
    const operation=(principal,index)=>admin.query(`SELECT operation_id FROM crest_private.operations WHERE business_id=$1 AND actor_id=$2
      AND state='committed' ORDER BY created_at,id OFFSET $3 LIMIT 1`,[principal.business,principal.actor,index])
      .then(result=>result.rows[0].operation_id);
    async function connect(principal,label){
      const destination=randomUUID();
      await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
        VALUES($1,$2,$3,$4,$5)`,[destination,principal.business,label+'@group.calendar.google.com',principal.actor,await operation(principal,0)]);
      await consent(principal,destination,1,'active',principal.epoch);
      return destination;
    }
    async function consent(principal,destination,generation,state,epoch){
      await admin.query('BEGIN');
      try{
        await admin.query('SELECT id FROM crest.google_calendar_destinations WHERE business_id=$1 AND id=$2 FOR UPDATE',[principal.business,destination]);
        await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
          client_name,service_label,work_address,created_by,operation_id)
          VALUES($1,$2,$3,$4,$5,false,false,false,$6,$7)`,[principal.business,destination,generation,epoch,state,principal.actor,await operation(principal,generation)]);
        await admin.query('COMMIT');
      }catch(error){await admin.query('ROLLBACK');throw error;}
    }
    const book=(principal,request)=>call(web,'book_job',[
      ...principal.auth(),principal.epoch,request.operationId,1,request.jobId,request.expectedModeSequence,request.payload]);
    const cancel=(principal,job,version)=>call(web,'cancel_scheduled_job',[...principal.auth(),principal.epoch,randomUUID(),1,job,version,{
      reason:'Fictional cancellation',
      customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},
    }]);
    const destination=await connect(owner,'fixture-owned'),otherDestination=await connect(foreign,'fixture-other');
    const first=confirmedBookingRequest(owner),other=confirmedBookingRequest(foreign);
    assert.equal((await book(owner,first)).state,'committed');
    assert.equal((await book(foreign,other)).state,'committed');

    async function worker(name,business){
      await admin.query('CREATE ROLE '+name+' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
      await admin.query('GRANT crest_calendar_dispatch TO '+name);
      await admin.query('INSERT INTO crest_private.google_calendar_worker_principals(business_id,principal) VALUES($1,$2)',[business,name]);
      return workerConnection(name);
    }
    async function workerConnection(name){
      const client=await sandbox.connect(database);
      await client.query('SET SESSION AUTHORIZATION '+name);
      await client.query('SET ROLE crest_calendar_dispatch');
      return client;
    }
    const agent=await worker('synthetic_calendar_worker',owner.business);
    const rival=await workerConnection('synthetic_calendar_worker');
    const otherAgent=await worker('synthetic_other_calendar_worker',foreign.business);
    const boundary=[owner.business,destination,first.jobId,'1',owner.epoch];
    const otherBoundary=[foreign.business,otherDestination,other.jobId,'1',foreign.epoch];
    const claim=(client=agent,scope=boundary)=>call(client,'claim_google_calendar_dispatch',scope);
    const record=(lease,action,body,etag=null,scope=boundary)=>call(agent,'record_google_calendar_send',[...scope,lease,action,body,etag]);
    const admit=(lease,kind,client=agent,scope=boundary)=>call(client,'admit_google_calendar_request',[...scope,lease,kind]);
    const finish=(lease,outcome,etag=null,scope=boundary)=>call(agent,'finish_google_calendar_dispatch',[...scope,lease,outcome,etag]);
    await assert.rejects(claim(web),{code:'42501'});
    await assert.rejects(claim(agent,otherBoundary),{message:'GOOGLE_CALENDAR_WORKER_DENIED'});
    await assert.rejects(agent.query('SELECT * FROM crest.google_calendar_dispatch_leases'),{code:'42501'});
    await agent.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await assert.rejects(claim(),{message:'GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED'});
    await agent.query('ROLLBACK');

    await agent.query('BEGIN');
    let firstLease;
    try{
      firstLease=await claim();
      assert.equal(firstLease.state,'leased');
      assert.equal((await claim(rival)).state,'unavailable');
      await agent.query('COMMIT');
    }catch(error){await agent.query('ROLLBACK');throw error;}
    assert.equal(firstLease.mode,'dispatch');
    assert.equal(firstLease.attempt,1);
    assert.deepEqual(await claim(rival),{state:'busy'});
    const payload=JSON.stringify({
      id:firstLease.eventId,summary:'Crest job',description:'View the saved appointment in Crest OS: https://crest.example.com/schedule?job='+first.jobId,
      location:'',start:{dateTime:first.payload.appointment.start_at,timeZone:'UTC'},end:{dateTime:first.payload.appointment.end_at,timeZone:'UTC'},
      status:'confirmed',visibility:'private',transparency:'opaque',reminders:{useDefault:false,overrides:[]},
      extendedProperties:{private:{crestMapping:firstLease.marker}},
    });
    assert.deepEqual(await record(firstLease.leaseId,'insert','[]'),{state:'review'});
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload.replace('Crest job','Fictional client')),{state:'review'});
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload.replace('"location":""','"location":"Fictional address"')),{state:'review'});
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload.replace(first.payload.appointment.start_at,first.payload.appointment.end_at)),{state:'review'});
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload.replace(/^{/,'{"summary":"Extra",')),{state:'review'});
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload.replace(first.jobId,other.jobId)),{state:'review'});
    assert.deepEqual(await admit(firstLease.leaseId,'insert'),{state:'unavailable'});
    assert.deepEqual(await finish(firstLease.leaseId,'published','"fabricated"'),{state:'review'});
    const sent=await record(firstLease.leaseId,'insert',payload);
    assert.equal(sent.state,'recorded');
    assert.deepEqual(JSON.parse(sent.requestBody),JSON.parse(payload));
    assert.equal(sent.requestSha256,createHash('sha256').update(sent.requestBody).digest('hex'));
    assert.deepEqual(await record(firstLease.leaseId,'insert',payload),{state:'already_recorded'});
    assert.deepEqual(await admit(firstLease.leaseId,'update'),{state:'unavailable'});
    assert.equal((await admit(firstLease.leaseId,'insert')).state,'admitted');
    assert.deepEqual(await admit(firstLease.leaseId,'insert'),{state:'already_admitted'});

    // Simulate a worker that died after dispatch. Advance only the owned fixture
    // lease using admin access; the production roles cannot edit retained rows.
    async function expire(lease){
      await admin.query('BEGIN');
      try{
        await admin.query('ALTER TABLE crest.google_calendar_dispatch_leases DISABLE TRIGGER calendar_dispatch_retained');
        await admin.query(`WITH past AS MATERIALIZED (SELECT clock_timestamp()-interval '61 seconds' AS stamp)
          UPDATE crest.google_calendar_dispatch_leases SET leased_at=past.stamp,lease_until=past.stamp+interval '60 seconds'
          FROM past WHERE id=$1`,[lease]);
        await admin.query('ALTER TABLE crest.google_calendar_dispatch_leases ENABLE TRIGGER calendar_dispatch_retained');
        await admin.query('COMMIT');
      }catch(error){await admin.query('ROLLBACK');throw error;}
    }
    assert.equal((await cancel(owner,first.jobId,'1')).state,'committed');
    assert.deepEqual(await claim(),{state:'busy'});
    await expire(firstLease.leaseId);
    assert.deepEqual(await finish(firstLease.leaseId,'published','"late"'),{state:'unavailable'});
    const recovery=await claim();
    assert.equal(recovery.mode,'reconcile');
    assert.equal(recovery.outboxId,firstLease.outboxId);
    assert.equal(recovery.sourceCurrent,false);
    assert.deepEqual(recovery.previousSend,{action:'insert',requestSha256:sent.requestSha256,requestBody:sent.requestBody,priorEtag:null});
    assert.deepEqual(await record(recovery.leaseId,'insert',payload),{state:'unavailable'});
    assert.equal((await admit(recovery.leaseId,'read_event')).state,'admitted');
    assert.deepEqual(await finish(recovery.leaseId,'published','"old-event"'),{state:'recorded',outcome:'published',sourceCurrent:false});
    const removal=await claim();
    assert.equal(removal.mode,'dispatch');
    assert.equal(removal.action,'remove');
    assert.equal(removal.sourceCurrent,true);
    assert.equal(removal.eventId,firstLease.eventId);
    assert.equal((await record(removal.leaseId,'delete','','"old-event"')).state,'recorded');
    assert.equal((await admit(removal.leaseId,'delete')).state,'admitted');
    assert.deepEqual(await finish(removal.leaseId,'removed'),{state:'recorded',outcome:'removed',sourceCurrent:true});
    assert.deepEqual(await finish(removal.leaseId,'removed'),{state:'recorded',outcome:'removed',sourceCurrent:true});
    assert.deepEqual(await claim(),{state:'unavailable'});

    const foreignLease=await claim(otherAgent,otherBoundary);
    assert.equal(foreignLease.state,'leased');
    await admin.query(`INSERT INTO crest.google_calendar_request_admissions(business_id,lease_id,kind,admitted_at)
      SELECT $1,$2,'read_event',clock_timestamp()-interval '2 minutes' FROM generate_series(1,4996)`,[owner.business,recovery.leaseId]);
    assert.equal((await admit(foreignLease.leaseId,'read_event',otherAgent,otherBoundary)).state,'admitted');
    assert.deepEqual(await admit(foreignLease.leaseId,'read_event',otherAgent,otherBoundary),{state:'delayed'});
    await admin.query('BEGIN');
    try{
      await admin.query('ALTER TABLE crest.google_calendar_request_admissions DISABLE TRIGGER calendar_dispatch_retained');
      await admin.query(`UPDATE crest.google_calendar_request_admissions SET admitted_at=clock_timestamp()-interval '25 hours'
        WHERE business_id=$1 AND admitted_at<clock_timestamp()-interval '1 minute'`,[owner.business]);
      await admin.query('ALTER TABLE crest.google_calendar_request_admissions ENABLE TRIGGER calendar_dispatch_retained');
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    await admin.query(`INSERT INTO crest.google_calendar_request_admissions(business_id,lease_id,kind,admitted_at)
      SELECT $1,$2,'read_event',clock_timestamp() FROM generate_series(1,56)`,[owner.business,recovery.leaseId]);
    assert.deepEqual(await admit(foreignLease.leaseId,'read_event',otherAgent,otherBoundary),{state:'delayed'});
    await consent(foreign,otherDestination,2,'paused',foreign.epoch);
    await assert.rejects(admit(foreignLease.leaseId,'read_event',otherAgent,otherBoundary),{message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
    await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',
      [owner.business,randomUUID()]);
    await assert.rejects(claim(),{message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
    await assert.rejects(finish(removal.leaseId,'removed'),{message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
    await assert.rejects(admin.query('DELETE FROM crest.google_calendar_dispatch_results'),{code:'55000'});
  }finally{
    try{await sandbox?.close();}finally{await cluster.close();}
  }
});
