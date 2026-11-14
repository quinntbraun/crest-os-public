import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, args) {
  const parameters = args.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + command + '(' + parameters + ') AS result', args)).rows[0].result;
}

function move(request, day) {
  return { ...request, payload: {
    ...request.payload,
    appointment: {
      ...request.payload.appointment, start_at: day+'T10:00:00.123456Z', end_at: day+'T11:00:00.123456Z',
      local_start: day+'T10:00:00.123456', local_end: day+'T11:00:00.123456',
    },
  } };
}

test('confirmed appointment and calendar intent share the PostgreSQL transaction and retained mapping', { timeout: 120000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const database = await sandbox.database(), admin = await sandbox.connect(database), observer = await sandbox.connect(database);
    await sandbox.apply(database, await sandbox.prefix(0), true);
    await installProviderSchema(admin, database);
    await sandbox.apply(database, await sandbox.prefix(76));
    const proposal = await readFile(new URL('../../planning/proposals/google-calendar-outbox.sql', import.meta.url), 'utf8');
    await admin.query('BEGIN');
    try { await admin.query(proposal); await admin.query('COMMIT'); }
    catch (error) { await admin.query('ROLLBACK'); throw error; }
    const web = await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const createOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const owner = await createOwner(), other = await createOwner();
    const retainedOperation = async (principal, index) => (await admin.query(
      "SELECT operation_id FROM crest_private.operations WHERE business_id=$1 AND actor_id=$2 AND state='committed' ORDER BY created_at,id OFFSET $3 LIMIT 1",
      [principal.business,principal.actor,index])).rows[0].operation_id;
    const destination = randomUUID();
    await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
      VALUES($1,$2,'fixture-group@group.calendar.google.com',$3,$4)`,
      [destination,owner.business,owner.actor,await retainedOperation(owner,0)]);
    const consent = (generation,state,epoch) => retainedOperation(owner,generation).then(operation =>
      admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
        client_name,service_label,work_address,created_by,operation_id)
        VALUES($1,$2,$3,$4,$5,false,false,false,$6,$7)`,[owner.business,destination,generation,epoch,state,owner.actor,operation]));
    await consent(1,'active',owner.epoch);

    const book = (principal,request) => call(web,'book_job',[
      ...principal.auth(),principal.epoch,request.operationId,1,request.jobId,request.expectedModeSequence,request.payload]);
    const changes = (action, job, latestAppointmentId, version, appointment=null) => call(web,'change_job_schedule',[
      ...owner.auth(),owner.epoch,randomUUID(),1,job,version,{
        action,latestAppointmentId,reason:'Owner reviewed fictional calendar test',expectedModeSequence:action==='withdraw'?null:'1',
        appointment,customerConfirmation:action==='confirm'?{
          channel:'in_person',effectiveAt:new Date(Date.now()-1000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),
          evidenceNote:'Customer confirmed this exact fictional replacement.',
        }:null,conflictReview:action==='confirm'?{
          expectedAppointmentIds:[],expectedUnknownTravel:false,unknownTravelReviewed:false,overrideReason:null,
        }:null,
      },
    ]);
    const cancel = (job,version) => call(web,'cancel_scheduled_job',[...owner.auth(),owner.epoch,randomUUID(),1,job,version,{
      reason:'Owner cancelled fictional appointment',
      customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},
    }]);
    const outbox = async () => (await observer.query(`SELECT o.business_id,o.destination_id,o.job_id,o.appointment_id,o.appointment_sequence,
      o.mapping_id,o.connection_generation,o.recovery_epoch,o.action,o.operation_id,m.event_uuid,m.correlation_marker
      FROM crest.google_calendar_outbox o JOIN crest.google_calendar_mappings m
      ON (m.business_id,m.id)=(o.business_id,o.mapping_id) ORDER BY o.created_at,o.id`)).rows;
    assert.deepEqual(await outbox(),[]);

    const first = confirmedBookingRequest(owner);
    await web.query('BEGIN');
    try {
      assert.equal((await book(owner,first)).state,'committed');
      assert.deepEqual(await outbox(),[]);
    } finally { await web.query('ROLLBACK'); }
    assert.deepEqual(await outbox(),[]);
    assert.equal((await observer.query('SELECT count(*)::int AS n FROM crest.google_calendar_mappings')).rows[0].n,0);

    const initial = await book(owner,first);
    assert.equal(initial.state,'committed');
    assert.deepEqual(await book(owner,first),initial);
    const [firstIntent] = await outbox();
    assert.equal(firstIntent.action,'publish');
    assert.equal(firstIntent.appointment_id,initial.receipt.appointmentId);
    assert.equal(firstIntent.appointment_sequence,'1');
    assert.equal(firstIntent.operation_id,first.operationId);
    assert.equal(firstIntent.recovery_epoch,owner.epoch);

    const disconnected = move(confirmedBookingRequest(other),'2026-11-04');
    assert.equal((await book(other,disconnected)).state,'committed');
    assert.equal((await outbox()).length,1);

    const proposedTime = Object.fromEntries(Object.entries(move(first,'2026-11-05').payload.appointment)
      .filter(([name]) => !['customer_confirmation','unknown_travel_reviewed'].includes(name)));
    const proposalResult = await changes('propose',first.jobId,initial.receipt.appointmentId,'1',proposedTime);
    assert.equal(proposalResult.state,'committed',JSON.stringify(proposalResult));
    const withdrawal = await changes('withdraw',first.jobId,proposalResult.receipt.latestAppointmentId,'2');
    assert.equal(withdrawal.state,'committed',JSON.stringify(withdrawal));
    const replacement = await changes('propose',first.jobId,withdrawal.receipt.latestAppointmentId,'3',proposedTime);
    assert.equal(replacement.state,'committed',JSON.stringify(replacement));
    assert.equal((await outbox()).length,1);
    const confirmed = await changes('confirm',first.jobId,replacement.receipt.latestAppointmentId,'4');
    assert.equal(confirmed.state,'committed',JSON.stringify(confirmed));
    const removed = await cancel(first.jobId,'5');
    assert.equal(removed.state,'committed',JSON.stringify(removed));
    const rows = await outbox();
    assert.deepEqual(rows.map(row=>[row.action,row.appointment_sequence]),[['publish','1'],['publish','5'],['remove','6']]);
    assert.equal(rows[1].appointment_id,confirmed.receipt.currentAppointmentId);
    assert(rows.every(row => row.destination_id===destination && row.mapping_id===firstIntent.mapping_id
      && row.event_uuid===firstIntent.event_uuid && row.correlation_marker===firstIntent.correlation_marker
      && row.business_id===owner.business && row.job_id===first.jobId && row.connection_generation==='1'));

    // A connected business with stale-epoch consent still schedules normally.
    await consent(2,'active',randomUUID());
    const extraOwner = await createOwner(owner,{customerId:owner.customer});
    const extra = { ...move(confirmedBookingRequest(extraOwner),'2026-11-09'), expectedModeSequence:'1' };
    assert.equal((await book(extraOwner,extra)).state,'committed');
    assert.equal((await outbox()).length,3);
    await consent(3,'paused',owner.epoch);
    const pausedOwner = await createOwner(owner,{customerId:owner.customer});
    const paused = { ...move(confirmedBookingRequest(pausedOwner),'2026-11-10'), expectedModeSequence:'1' };
    assert.equal((await book(pausedOwner,paused)).state,'committed');
    assert.equal((await outbox()).length,3);

    await consent(4,'active',owner.epoch);
    const completedOwner = await createOwner(owner,{customerId:owner.customer});
    const completed = { ...move(confirmedBookingRequest(completedOwner),'2026-11-12'), expectedModeSequence:'1' };
    assert.equal((await book(completedOwner,completed)).state,'committed');
    const completionIntent=(await outbox()).at(-1);
    assert.equal(completionIntent.connection_generation,'4');
    assert.notEqual(completionIntent.event_uuid,firstIntent.event_uuid);
    assert.notEqual(completionIntent.correlation_marker,firstIntent.correlation_marker);
    const arrived = await call(web,'change_field_session',[
      ...completedOwner.auth(),owner.epoch,randomUUID(),1,completed.jobId,'1',
      { action:'direct_arrive',reason:'Fictional arrival' },
    ]);
    assert.equal(arrived.state,'committed');
    const completion = await call(web,'read_job_completion_context',[...completedOwner.auth(),completed.jobId]);
    const finished = await call(web,'complete_job',[
      ...completedOwner.auth(),owner.epoch,randomUUID(),1,completed.jobId,arrived.receipt.jobVersion,{
        scope:completion.assignments.map(row=>({
          assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,
          pieces:[{
            partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,
            grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,
            amountCents:row.amountCents,reason:null,
          }],
        })),
        reason:'Fictional work completed',walkthrough:{state:'done',reason:null},
        review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],
          expectedCustomerVersion:'1',contactReviewReason:null},
      },
    ]);
    assert.equal(finished.state,'committed',JSON.stringify(finished));
    assert.deepEqual(await outbox(),[...rows,completionIntent]);
    const completedSource=(await observer.query('SELECT state,current_appointment_id FROM crest.jobs WHERE business_id=$1 AND id=$2',
      [owner.business,completed.jobId])).rows[0];
    assert.deepEqual(completedSource,{state:'completed',current_appointment_id:completionIntent.appointment_id});

    for (const table of ['google_calendar_destinations','google_calendar_consents','google_calendar_mappings','google_calendar_outbox']) {
      await assert.rejects(web.query('SELECT * FROM crest.'+table),{ code:'42501' });
      await assert.rejects(admin.query('DELETE FROM crest.'+table),{ code:'55000' });
    }
    await assert.rejects(web.query('SELECT crest_private.capture_google_calendar_intent()'),{ code:'42501' });
  } finally {
    try { await sandbox?.close(); } finally { await cluster.close(); }
  }
});
