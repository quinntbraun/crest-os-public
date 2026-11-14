import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function command(connection, name, args) {
  const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
  const {rows}=await connection.query('SELECT crest_commands.'+name+'('+placeholders+') AS result',args);
  return rows[0].result;
}

test('Calendar disconnect fences new dispatch and retains only admitted outcomes and one revocation attempt', {timeout:120000}, async()=>{
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
      for(const proposal of ['outbox','dispatch','oauth-attempt','disconnect']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+proposal+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}

    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(),foreign=await makeOwner();
    const oauth=await sandbox.connect(database),rival=await sandbox.connect(database);
    await oauth.query('SET ROLE crest_calendar_oauth');
    await rival.query('SET ROLE crest_calendar_oauth');
    async function connect(principal,label){
      const destination=randomUUID();
      const {rows:operations}=await admin.query(`SELECT operation_id FROM crest_private.operations WHERE (business_id,actor_id,state)=($1,$2,'committed')
        ORDER BY created_at,id LIMIT 2`,[principal.business,principal.actor]);
      await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
        VALUES($1,$2,$3,$4,$5)`,[destination,principal.business,label+'@group.calendar.google.com',principal.actor,operations[0].operation_id]);
      await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
        client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,1,$3,'active',false,false,false,$4,$5)`,
        [principal.business,destination,principal.epoch,principal.actor,operations[1].operation_id]);
      return destination;
    }
    const destination=await connect(owner,'fictional-owner');
    const foreignDestination=await connect(foreign,'fictional-foreign');
    const job=confirmedBookingRequest(owner);
    const book=(principal,booking)=>command(web,'book_job',[
      ...principal.auth(),principal.epoch,booking.operationId,1,booking.jobId,booking.expectedModeSequence,booking.payload]);
    assert.equal((await book(owner,job)).state,'committed');
    const worker=await sandbox.connect(database);
    await admin.query('CREATE ROLE synthetic_disconnect_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    await admin.query('GRANT crest_calendar_dispatch TO synthetic_disconnect_worker');
    await admin.query("INSERT INTO crest_private.google_calendar_worker_principals(business_id,principal) VALUES($1,'synthetic_disconnect_worker')",[owner.business]);
    await worker.query('SET SESSION AUTHORIZATION synthetic_disconnect_worker');
    await worker.query('SET ROLE crest_calendar_dispatch');
    const boundary=[owner.business,destination,job.jobId,'1',owner.epoch];
    const lease=await command(worker,'claim_google_calendar_dispatch',boundary);
    assert.equal(lease.state,'leased');
    const body=JSON.stringify({
      id:lease.eventId,summary:'Crest job',description:'View the saved appointment in Crest OS: https://crest.example.com/schedule?job='+job.jobId,
      location:'',start:{dateTime:job.payload.appointment.start_at,timeZone:'UTC'},end:{dateTime:job.payload.appointment.end_at,timeZone:'UTC'},
      status:'confirmed',visibility:'private',transparency:'opaque',reminders:{useDefault:false,overrides:[]},
      extendedProperties:{private:{crestMapping:lease.marker}},
    });
    assert.equal((await command(worker,'record_google_calendar_send',[...boundary,lease.leaseId,'insert',body,null])).state,'recorded');
    assert.equal((await command(worker,'admit_google_calendar_request',[...boundary,lease.leaseId,'insert'])).state,'admitted');

    const operation=randomUUID();
    const ownerScope=(principal,target)=>[...principal.auth(),principal.epoch,target];
    const begin=(connection,scope,generation,op)=>command(connection,'begin_google_calendar_disconnect',[...scope,generation,op]);
    const status=(connection,scope,id,action='read',attempt=null)=>command(connection,'google_calendar_disconnect_status',[...scope,id,action,attempt]);
    const scope=ownerScope(owner,destination),foreignScope=ownerScope(foreign,foreignDestination);
    await assert.rejects(begin(web,scope,'1',operation),{code:'42501'});
    await assert.rejects(oauth.query('SELECT * FROM crest.google_calendar_disconnects'),{code:'42501'});
    await assert.rejects(worker.query('SELECT * FROM crest.google_calendar_revocation_events'),{code:'42501'});
    assert.equal(await begin(oauth,ownerScope(foreign,destination),'1',operation),null);
    assert.equal(await begin(oauth,scope,'2',operation),null);
    await oauth.query('BEGIN');
    let fenced;
    try{
      fenced=await begin(oauth,scope,'1',operation);
      assert.equal(fenced.generation,'2');
      assert.equal(Date.parse(fenced.drainUntil),Date.parse(lease.leaseUntil));
      const racing=assert.rejects(command(worker,'admit_google_calendar_request',[...boundary,lease.leaseId,'read_event']),
        {message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
      await oauth.query('COMMIT');
      await racing;
    }catch(error){await oauth.query('ROLLBACK');throw error;}
    const id=fenced.disconnectId;
    assert.deepEqual(await begin(oauth,scope,'1',operation),fenced);
    assert.equal(await begin(oauth,scope,'2',operation),null);
    assert.equal(await status(oauth,foreignScope,id),null);
    await assert.rejects(command(worker,'claim_google_calendar_dispatch',boundary),{message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
    await assert.rejects(command(worker,'finish_google_calendar_dispatch',[...boundary,lease.leaseId,'published','"normal"']),
      {message:'GOOGLE_CALENDAR_FENCE_CLOSED'});
    const drained=(leaseId,outcome,etag=null)=>command(worker,'record_google_calendar_drained_send',
      [owner.business,destination,job.jobId,owner.epoch,leaseId,outcome,etag]);
    assert.equal((await status(oauth,scope,id)).state,'draining');
    assert.equal((await status(oauth,scope,id,'admit',randomUUID())).state,'draining');
    assert.equal(await drained(randomUUID(),'published','"missing"'),false);
    assert.equal(await drained(lease.leaseId,'removed'),false);
    assert.equal(await drained(lease.leaseId,'uncertain'),true);
    assert.equal(await drained(lease.leaseId,'uncertain'),true);
    assert.equal(await drained(lease.leaseId,'published','"overwritten"'),false);
    const retained=(await admin.query('SELECT outcome,source_current FROM crest.google_calendar_dispatch_results WHERE lease_id=$1',[lease.leaseId])).rows[0];
    assert.deepEqual(retained,{outcome:'uncertain',source_current:false});
    assert.equal((await status(oauth,scope,id)).unresolvedMutations,1);

    // Age only the disposable records to exercise the two bounded deadlines.
    async function ageDrain(){
      await admin.query('BEGIN');
      try{
        await admin.query('ALTER TABLE crest.google_calendar_disconnects DISABLE TRIGGER calendar_disconnect_retained');
        await admin.query(`UPDATE crest.google_calendar_disconnects SET fenced_at=fenced_at-interval '61 seconds',
          drain_until=drain_until-interval '61 seconds' WHERE id=$1`,[id]);
        await admin.query('ALTER TABLE crest.google_calendar_disconnects ENABLE TRIGGER calendar_disconnect_retained');
        await admin.query('COMMIT');
      }catch(error){await admin.query('ROLLBACK');throw error;}
    }
    await ageDrain();
    assert.equal(await drained(lease.leaseId,'uncertain'),false);
    const ready=await status(oauth,scope,id);
    assert.equal(ready.state,'ready_to_revoke');
    assert.equal(ready.reviewRequired,true);
    const admitted=await Promise.all([status(oauth,scope,id,'admit',randomUUID()),status(rival,scope,id,'admit',randomUUID())]);
    assert.deepEqual(admitted.map(x=>x.state).sort(),['revocation_admitted','revoking']);
    const attempt=admitted.find(x=>x.state==='revocation_admitted').attemptId;
    assert.equal(await status(oauth,scope,id,'revoked',randomUUID()),null);
    await admin.query('BEGIN');
    try{
      await admin.query('ALTER TABLE crest.google_calendar_revocation_events DISABLE TRIGGER calendar_revocation_retained');
      await admin.query(`UPDATE crest.google_calendar_revocation_events SET recorded_at=recorded_at-interval '31 seconds',
        deadline=deadline-interval '31 seconds' WHERE disconnect_id=$1 AND phase='admitted'`,[id]);
      await admin.query('ALTER TABLE crest.google_calendar_revocation_events ENABLE TRIGGER calendar_revocation_retained');
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    assert.equal((await status(oauth,scope,id)).state,'revocation_uncertain');
    assert.equal(await status(oauth,scope,id,'revoked',attempt),null);
    assert.equal((await status(oauth,scope,id,'uncertain',attempt)).state,'revocation_uncertain');
    assert.equal((await status(oauth,scope,id,'uncertain',attempt)).state,'revocation_uncertain');
    assert.equal(await status(oauth,scope,id,'revoked',attempt),null);
    assert.equal((await status(oauth,scope,id,'admit',randomUUID())).state,'revocation_uncertain');

    const otherFence=await begin(oauth,foreignScope,'1',randomUUID());
    const otherAttempt=randomUUID();
    assert.equal((await status(oauth,foreignScope,otherFence.disconnectId,'admit',otherAttempt)).state,'revocation_admitted');
    assert.equal((await status(oauth,foreignScope,otherFence.disconnectId,'revoked',otherAttempt)).state,'disconnected');
    assert.equal((await status(oauth,foreignScope,otherFence.disconnectId)).reviewRequired,false);
    const counts=(await admin.query(`SELECT
      (SELECT count(*) FROM crest.google_calendar_mappings WHERE business_id=$1) AS mappings,
      (SELECT count(*) FROM crest.google_calendar_outbox WHERE business_id=$1) AS outbox,
      (SELECT count(*) FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 AND action='disconnect') AS audit`,
      [owner.business,operation])).rows[0];
    assert.deepEqual(counts,{mappings:'1',outbox:'1',audit:'1'});
    await assert.rejects(admin.query('DELETE FROM crest.google_calendar_revocation_events'),{code:'55000'});
    await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',
      [owner.business,randomUUID()]);
    await assert.rejects(status(oauth,scope,id),{message:'RECOVERY_REVIEW_REQUIRED'});
  }finally{
    try{await sandbox?.close();}finally{await cluster.close();}
  }
});
