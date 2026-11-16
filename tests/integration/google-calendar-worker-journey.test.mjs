import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { strFromU8, unzipSync } from 'fflate';
import { createGoogleCalendarConnection } from '../../src/operations/google-calendar-connection.ts';
import { googleCalendarWorkerStatements, syntheticGoogleCalendarSetupDatabase,
  syntheticGoogleCalendarWorkerDatabase } from '../../src/operations/google-calendar-database.ts';
import { googleCalendarOAuthIssuer, googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { parseGoogleCalendarJobStatus } from '../../src/operations/google-calendar-job-status.ts';
import { captureGoogleCalendarPortableSource } from '../../src/operations/google-calendar-portable-source.ts';
import { syntheticGoogleCalendarIdentity as identity } from '../../src/operations/google-calendar-runtime.ts';
import { createSyntheticGoogleCalendarEvents, createSyntheticGoogleCalendarWorker } from '../../src/operations/google-calendar-worker.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupGoogleCalendarCandidateDatabase, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreGoogleCalendarCandidateDatabase } from '../support/recovery-drill.mjs';
import { googleCalendarCandidate } from '../support/google-calendar-candidate.mjs';
import { migrationTestTarget } from '../../src/tooling/migration-coordinator.ts';
import pg from 'pg';

const origin = 'https://127.0.0.1:4319';
const callbackUri = origin + '/api/google-calendar/callback';
const calendarId = 'crest-fictional-appointments@group.calendar.google.com';
const disclosure = { clientName: false, serviceLabel: false, workAddress: false };

async function command(connection, name, args) {
  const parameters = args.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + name + '(' + parameters + ') AS result', args)).rows[0].result;
}

async function restrictedLogin(admin, database, role, purpose) {
  const login = 'crest_calendar_' + purpose + '_' + randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  await admin.query('CREATE ROLE ' + login + " LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + secret + "'");
  await admin.query('GRANT ' + role + ' TO ' + login + ' WITH INHERIT FALSE, SET TRUE');
  const url = new URL(database);
  url.username = login;
  url.password = secret;
  return { login, connectionString: url.href };
}

async function restrictedClient(connectionString) {
  migrationTestTarget(process.env.CREST_ENV, connectionString);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  return client;
}

async function configureCalendar(admin, database, owner, key, signal, selection = disclosure) {
  const setup = await restrictedLogin(admin, database, 'crest_calendar_oauth', 'setup');
  await admin.query('INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,$1,$2,$3,$4)',
    [googleCalendarOAuthIssuer, identity.clientId, callbackUri, identity.verifierKeyId]);
  await admin.query('INSERT INTO crest_private.google_calendar_credential_key VALUES(true,$1)', [identity.credentialKeyId]);
  const connection = await createGoogleCalendarConnection({ ...identity, callbackUri, clientSecret: 'fictional-calendar-only',
    calendarKeyMaterial: key, committedQuery: syntheticGoogleCalendarSetupDatabase({ ...setup, environment: 'test' }),
    async request(url, options) {
      if (url === 'https://oauth2.googleapis.com/token' && options?.method === 'POST')
        return Response.json({ access_token: 'fictional-calendar-access', refresh_token: 'fictional-calendar-refresh',
          expires_in: 3600, token_type: 'Bearer', scope: googleCalendarOAuthScope });
      assert.equal(url, 'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner');
      assert.equal(options?.method, 'POST');
      const body = JSON.parse(options.body);
      return Response.json({ kind: 'calendar#calendar', id: calendarId, summary: body.summary, description: body.description,
        dataOwner: identity.googleOwner });
    } });
  const [credentialHash, appSessionId, actorId, authIssuer, authSubject, authProviderSessionId, deadline] = owner.auth();
  const authority = { businessId: owner.business, actorId, appSessionId, recoveryEpoch: owner.epoch, connectionGeneration: '0',
    authIssuer, authSubject, authProviderSessionId, providerValidUntil: deadline.getTime(), credentialHash };
  const initial = await connection.begin(authority, signal);
  const state = new URL(initial.headers.get('location')).searchParams.get('state');
  assert.equal(await connection.confirmCreation(authority, state.split('.')[0], identity.googleOwner, true, signal), true);
  const callback = new Request(callbackUri + '?' + new URLSearchParams({ state, code: 'fictional/calendar-code' }));
  const staged = await connection.initialCreationCallback(callback, authority, signal);
  assert.equal(staged.state, 'staged');
  const { destinationId, credentialId } = await connection.setupState(authority, signal);
  const preview = await connection.prepareConsent(authority, destinationId, credentialId, selection, signal);
  const consent = await connection.confirmConsent(authority, { destinationId, credentialId, reviewId: preview.reviewId, disclosure: selection,
    payloadReviewed: true, sharingReviewed: true, notificationsReviewed: true }, signal);
  assert.equal(consent.state, 'active');
  return { destinationId, generation: consent.generation, readStatus: (jobId, input = authority) => connection.jobStatus(input, jobId, signal),
    staleAuthority: { ...authority, recoveryEpoch: randomUUID() } };
}

async function restoreCalendar({ candidate, admin, database, owner, target, formerWorker, expectedExport, key }) {
  const folder = await privateWorkspace(), point = join(folder, 'calendar-point');
  let cluster;
  try {
    await mkdir(point, { mode: 0o700 });
    const keys = await keyPair(folder);
    const backup = await backupGoogleCalendarCandidateDatabase(candidate, admin, database, point, keys.recipient);
    assert.equal(backup.manifest.heldGoogleCalendarMigrationSha256, candidate.sha256);
    assert.equal(backup.manifest.rows.filter(row => row.name.startsWith('google_calendar_')).length, 24);
    cluster = await recoveryCluster();
    const restoredUrl = await cluster.database();
    assert.deepEqual(await restoreGoogleCalendarCandidateDatabase(candidate, point, keys.path, restoredUrl), backup.manifest);
    const restored = await connect(restoredUrl);
    try {
      const workerExists = (await restored.query('SELECT EXISTS(SELECT FROM pg_roles WHERE rolname=$1) AS present', [formerWorker.login])).rows[0];
      assert.equal(workerExists.present, false);
      // Keep the old sealed grant and queued event evidence, but fence them.
      // These are test-only recovery actions on the independent restored copy.
      const freshEpoch = randomUUID();
      await restored.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',
        [owner.business, freshEpoch]);
      const workerLogin = await restrictedLogin(restored, restoredUrl, 'crest_calendar_dispatch', 'restored');
      await restored.query('UPDATE crest_private.google_calendar_worker_principals SET principal=$2 WHERE business_id=$1', [owner.business, workerLogin.login]);
      const provider = createSyntheticGoogleCalendarEvents();
      const worker = await createSyntheticGoogleCalendarWorker({ environment: 'test', origin,
        connectionString: workerLogin.connectionString, calendarKeyMaterial: key }, provider);
      const signal = AbortSignal.timeout(10000);
      const discovery = syntheticGoogleCalendarWorkerDatabase({ environment: 'test', connectionString: workerLogin.connectionString });
      assert.equal(await discovery(googleCalendarWorkerStatements.next, [owner.business], signal), null);
      assert.deepEqual(await worker(target, signal), { state: 'unavailable' });
      assert.deepEqual(await worker({ ...target, recoveryEpoch: freshEpoch }, signal), { state: 'unavailable' });
      assert.deepEqual(provider.snapshot(), []);
      const { connectionString: exportUrl } = await restrictedLogin(restored, restoredUrl, 'crest_export', 'restored_source');
      const reader = await restrictedClient(exportUrl);
      try {
        await reader.query('SET ROLE crest_export');
        await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const exported = await captureGoogleCalendarPortableSource(owner.business, async (sql, values) => (await reader.query(sql, values)).rows);
        // A new snapshot token is expected. The portable source bytes should be exact.
        assert.deepEqual(exported.files, expectedExport.files);
        await reader.query('COMMIT');
      } finally { await reader.end(); }
    } finally { await restored.end(); }
    return backup.manifest.rows.length;
  } finally {
    try { await cluster?.close(); } finally {
      assert.match(basename(folder), /^case-[a-z0-9]+$/i);
      assert.equal(basename(dirname(folder)), 'recovery-drill');
      await rm(folder, { recursive: true });
    }
  }
}

async function verifyUnsafeCalendarLocation({ admin, web, owner, destinationId, generation, worker, provider, signal }) {
  const request = confirmedBookingRequest(owner), { jobId } = request;
  request.expectedModeSequence = '1';
  Object.assign(request.payload.appointment, { start_at: '2026-11-08T10:00:00.123456Z', end_at: '2026-11-08T11:00:00.123456Z',
    local_start: '2026-11-08T10:00:00.123456', local_end: '2026-11-08T11:00:00.123456' });
  request.payload.workLocation.locationText = 'Fictional workshop, ask address@example.test';
  const booked = await command(web, 'book_job', [...owner.auth(), owner.epoch, request.operationId, 1, jobId,
    request.expectedModeSequence, request.payload]);
  assert.equal(booked.state, 'committed');
  const target = { businessId: owner.business, destinationId, generation, recoveryEpoch: owner.epoch, jobId };
  assert.deepEqual(await worker(target, signal), { state: 'review', sourceCurrent: true });
  assert.deepEqual(provider.snapshot(), []);
  const { count } = (await admin.query(
    'SELECT count(*)::int FROM crest.google_calendar_request_admissions a JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.id)=(a.business_id,a.lease_id) JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id) WHERE (o.business_id,o.job_id)=($1,$2)',
    [owner.business, jobId])).rows[0];
  assert.equal(count, 0, 'unsafe source must stop before a provider request');
}

for (const selectedFields of ['minimal','service','1']) test('Calendar dispatch and independent restore (' + selectedFields + ')', { timeout: 180000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const database = await sandbox.database(), admin = await sandbox.connect(database), web = await sandbox.connect(database);
    await sandbox.apply(database, await sandbox.prefix(0), true);
    await installProviderSchema(admin, database);
    const candidate = await googleCalendarCandidate(sandbox);
    const registered86 = await sandbox.apply(database, candidate.schema86);
    assert.equal(registered86.registrySha256, candidate.parentRegistrySha256);
    const before = await inventory(admin);
    const applied = await sandbox.apply(database, candidate.directory);
    assert.equal(applied.history.length, 87);
    assert.equal(applied.registrySha256, candidate.registrySha256);
    const after = await inventory(admin);
    const prior = new Set(before.map(row => row.schema + '.' + row.name));
    assert.equal(after.filter(row => !prior.has(row.schema + '.' + row.name)).length, 24);
    assert.deepEqual(after.filter(row => prior.has(row.schema + '.' + row.name) && row.schema !== 'supabase_migrations'),
      before.filter(row => row.schema !== 'supabase_migrations'));
    await web.query('SET ROLE crest_web');
    const { id: bootstrap } = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0];
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const optional = selectedFields === '1' || selectedFields === 'service';
    const serviceId = randomUUID();
    const owner = await makeOwner(undefined, optional ? { async serviceVersionFor(principal, auth) {
      const saved = await command(web, 'save_service', [...auth(), principal.epoch, randomUUID(), 1, serviceId, '0',
        { code: 'fictional-calendar-source', active: true, definition: { name: 'Fictional Interior',
          inclusions: 'Private service inclusions', exclusions: '', internalGuidance: 'Private catalog instructions',
          rangeLowCents: null, rangeHighCents: null, estimatedSeconds: null } }]);
      assert.equal(saved.state, 'committed');
      return (await admin.query('SELECT id FROM crest.service_versions WHERE (business_id,service_id)=($1,$2)',
        [principal.business, serviceId])).rows[0].id;
    } } : {});
    const foreign = await makeOwner();
    const key = randomBytes(32), signal = AbortSignal.timeout(120000);
    const selected = { clientName: selectedFields === '1', serviceLabel: optional, workAddress: selectedFields === '1' };
    const { destinationId, generation, readStatus, staleAuthority } = await configureCalendar(admin, database, owner, key, signal, selected);
    const fixtureWorker = await restrictedLogin(admin, database, 'crest_calendar_dispatch', 'worker');
    await admin.query('INSERT INTO crest_private.google_calendar_worker_principals(business_id,principal) VALUES($1,$2)',
      [owner.business, fixtureWorker.login]);
    const fictionalProvider = createSyntheticGoogleCalendarEvents();
    const worker = await createSyntheticGoogleCalendarWorker({ environment: 'test', origin,
      connectionString: fixtureWorker.connectionString, calendarKeyMaterial: key }, fictionalProvider);
    const dispatchDatabase = syntheticGoogleCalendarWorkerDatabase({ environment: 'test', connectionString: fixtureWorker.connectionString });
    const discover = () => dispatchDatabase(googleCalendarWorkerStatements.next, [owner.business], signal);
    assert.equal(await discover(), null);
    await assert.rejects(dispatchDatabase(googleCalendarWorkerStatements.next, [foreign.business], signal),
      { message: 'GOOGLE_CALENDAR_DATABASE_FAILED' });
    await assert.rejects(command(web, 'next_fictional_google_calendar_job', [owner.business]), { code: '42501' });

    const request = confirmedBookingRequest(owner), { jobId } = request;
    request.payload.workLocation.instructions = 'Private access instructions for this job.';
    const target = { businessId: owner.business, destinationId, jobId, recoveryEpoch: owner.epoch, generation };
    const status = async () => parseGoogleCalendarJobStatus(await readStatus(jobId), jobId);
    assert.equal(await readStatus(jobId), null);
    await assert.rejects(readStatus(jobId, staleAuthority), { message: 'GOOGLE_CALENDAR_DATABASE_FAILED' });
    await assert.rejects(command(web, 'read_google_calendar_job_status', [...owner.auth(), owner.epoch, jobId]), { code: '42501' });
    const booked = await command(web, 'book_job', [...owner.auth(), owner.epoch, request.operationId, 1, jobId,
      request.expectedModeSequence, request.payload]);
    assert.equal(booked.state, 'committed');
    assert.deepEqual(await discover(), target);
    assert.deepEqual(await status(), { schemaVersion: 1, jobId, appointmentVersion: '1', state: 'pending',
      lastConfirmedVersion: null, lastConfirmedAt: null });
    assert.deepEqual(fictionalProvider.snapshot(), []);
    assert.deepEqual(await worker({ ...target, recoveryEpoch: randomUUID() }, signal), { state: 'unavailable' });
    const published = await Promise.all([worker(target, signal), worker(target, signal)]);
    assert.equal(published.filter(result => result.state === 'published' && result.sourceCurrent).length, 1, JSON.stringify(published));
    assert.equal(published.filter(result => result.state === 'busy' || result.state === 'unavailable').length, 1);
    const [initial] = fictionalProvider.snapshot();
    const initialStatus = await status();
    assert.equal(await discover(), null);
    assert.equal(initialStatus.state, 'synced');
    assert.equal(initialStatus.lastConfirmedVersion, '1');
    assert(initialStatus.lastConfirmedAt);
    assert.equal(fictionalProvider.snapshot().length, 1);
    assert.deepEqual(initial.start, { dateTime: request.payload.appointment.start_at, timeZone: 'UTC' });
    assert.equal(initial.summary, ['Crest job', selected.serviceLabel && 'Fictional Interior',
      selected.clientName && 'Synthetic lifecycle customer'].filter(Boolean).join(' · '));
    assert.equal(initial.location, selected.workAddress ? 'Synthetic workshop, 123 Example Lane, Indianapolis' : '');
    assert.equal(initial.description, 'View the saved appointment in Crest OS: ' + origin + '/schedule?job=' + jobId);
    assert.deepEqual(initial.reminders, { useDefault: false, overrides: [] });
    for (const field of ['attendees', 'conferenceData', 'attachments']) assert(!Object.hasOwn(initial, field));
    for (const forbidden of ['Private catalog instructions', 'Private service inclusions', 'Private access instructions',
      'Synthetic lifecycle sedan', 'Synthetic interior', '25000']) assert(!JSON.stringify(initial).includes(forbidden), forbidden);

    const proposedStart = '2026-11-05T14:00:00.123456Z';
    const proposedEnd = '2026-11-05T15:00:00.123456Z';
    const appointment = { ...request.payload.appointment, start_at: proposedStart, end_at: proposedEnd,
      local_start: proposedStart.slice(0, -1), local_end: proposedEnd.slice(0, -1) };
    delete appointment.customer_confirmation;
    delete appointment.unknown_travel_reviewed;
    const move = { action: 'propose', reason: 'Synthetic client requested a new time', latestAppointmentId: booked.receipt.appointmentId,
      expectedModeSequence: '1', appointment, customerConfirmation: null, conflictReview: null };
    const schedule = (version, body) => command(web, 'change_job_schedule', [...owner.auth(), owner.epoch, randomUUID(), 1, jobId, version, body]);
    const proposed = await schedule('1', move);
    assert.equal(proposed.state, 'committed', JSON.stringify(proposed));
    assert.equal(await discover(), null);
    assert.deepEqual(await status(), initialStatus);
    assert.deepEqual(await worker(target, signal), { state: 'unavailable' });
    assert.deepEqual(fictionalProvider.snapshot(), [initial]);

    const confirmation = await schedule('2', { ...move, action: 'confirm', latestAppointmentId: proposed.receipt.latestAppointmentId,
      appointment: null, customerConfirmation: { channel: 'in_person',
        effectiveAt: new Date(Date.now() - 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z'),
        evidenceNote: 'Fictional client confirmed the exact new time.' },
      conflictReview: { expectedAppointmentIds: [], expectedUnknownTravel: false, unknownTravelReviewed: false, overrideReason: null } });
    assert.equal(confirmation.state, 'committed', JSON.stringify(confirmation));
    assert.deepEqual(await discover(), target);
    assert.deepEqual(await status(), { ...initialStatus, appointmentVersion: '3', state: 'pending' });
    assert.deepEqual(fictionalProvider.snapshot(), [initial]);
    assert.deepEqual(await worker(target, signal), { state: 'published', sourceCurrent: true });
    const [moved] = fictionalProvider.snapshot();
    const movedStatus = await status();
    assert.equal(movedStatus.state, 'synced');
    assert.equal(movedStatus.lastConfirmedVersion, '3');
    assert.equal(fictionalProvider.snapshot().length, 1);
    assert.equal(moved.id, initial.id);
    assert.deepEqual(moved.extendedProperties, initial.extendedProperties);
    assert.notEqual(moved.etag, initial.etag);
    assert.deepEqual(moved.start, { dateTime: proposedStart, timeZone: 'UTC' });

    const cancellation = await command(web, 'cancel_scheduled_job', [...owner.auth(), owner.epoch, randomUUID(), 1, jobId, '3', {
      reason: 'Fictional customer cancelled', customerCommunication: { state: 'not_sent', channel: null, effectiveAt: null, evidenceNote: null },
    }]);
    assert.equal(cancellation.state, 'committed', JSON.stringify(cancellation));
    assert.deepEqual(await discover(), target);
    assert.deepEqual(await status(), { ...movedStatus, appointmentVersion: '4', state: 'pending' });
    assert.deepEqual(fictionalProvider.snapshot(), [moved]);
    fictionalProvider.loseNextWriteResponse();
    assert.deepEqual(await worker(target, signal), { state: 'uncertain', sourceCurrent: true });
    assert.equal(await discover(), null);
    assert.deepEqual(await status(), { ...movedStatus, appointmentVersion: '4', state: 'delayed' });
    assert.deepEqual(fictionalProvider.snapshot(), []);
    assert.deepEqual(await worker(target, signal), { state: 'busy' });

    // Let PostgreSQL enforce the real bounded retry window without changing a ledger row or trigger.
    const { waitMs } = (await admin.query(
      'SELECT GREATEST(0,ceil(extract(epoch FROM (retry_at-clock_timestamp()))*1000))::int AS "waitMs" FROM crest.google_calendar_dispatch_results WHERE business_id=$1 AND outcome=$2',
      [owner.business, 'uncertain'])).rows[0];
    assert(waitMs <= 20000);
    await delay(waitMs + 50, undefined, { signal });
    assert.deepEqual(await discover(), target);
    assert.deepEqual(await worker(target, signal), { state: 'removed', sourceCurrent: true });
    assert.equal(await discover(), null);
    const removedStatus = await status();
    assert.equal(removedStatus.state, 'removed');
    assert.equal(removedStatus.lastConfirmedVersion, '4');
    assert.deepEqual(await worker(target, signal), { state: 'unavailable' });
    assert.deepEqual(fictionalProvider.snapshot(), []);
    const evidence = (await admin.query(
      'SELECT l.mode,r.outcome,s.action FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id) JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id) LEFT JOIN crest.google_calendar_dispatch_sends s ON (s.business_id,s.lease_id)=(l.business_id,l.id) WHERE (o.business_id,o.job_id)=($1,$2) ORDER BY o.appointment_sequence,l.attempt_no',
      [owner.business, jobId])).rows;
    assert.deepEqual(evidence, [
      { mode: 'dispatch', outcome: 'published', action: 'insert' },
      { mode: 'dispatch', outcome: 'published', action: 'update' },
      { mode: 'dispatch', outcome: 'uncertain', action: 'delete' },
      { mode: 'reconcile', outcome: 'removed', action: null },
    ]);
    const job = (await admin.query('SELECT state,version::text FROM crest.jobs WHERE (business_id,id)=($1,$2)', [owner.business, jobId])).rows[0];
    assert.deepEqual(job, { state: 'cancelled', version: '4' });

    // Test the same restricted export role that an authenticated export worker
    // would use. It has no raw Calendar table or provider grant access.
    const { connectionString: exportUrl } = await restrictedLogin(admin, database, 'crest_export', 'source');
    const reader = await sandbox.connect(exportUrl);
    await reader.query('SET ROLE crest_export');
    const query = (sql, values) => reader.query(sql, values).then(result => result.rows);
    await assert.rejects(captureGoogleCalendarPortableSource(owner.business, query), { code: '25001' });
    await assert.rejects(command(web, 'google_calendar_source_snapshot', [owner.business]), { code: '42501' });
    await assert.rejects(reader.query('SELECT envelope FROM crest_private.google_calendar_credentials'), { code: '42501' });
    await assert.rejects(reader.query('SELECT request_body FROM crest.google_calendar_dispatch_sends'), { code: '42501' });
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let expectedExport;
    try {
      const captured = await captureGoogleCalendarPortableSource(owner.business, query);
      expectedExport = captured;
      const manifest = JSON.parse(captured.manifest);
      assert.equal(manifest.scope, 'crest.google-calendar-portable-source.v1');
      assert.equal(manifest.businessId, owner.business);
      assert.equal(manifest.completeBackup, false);
      assert.equal(manifest.completePortableExport, false);
      for (const part of manifest.parts) {
        const bytes = captured.files[part.name];
        assert.equal(bytes.byteLength, part.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
      }
      const csv = name => strFromU8(captured.files[name + '.csv']);
      assert(csv('mappings').includes(initial.id.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5')));
      assert.equal(csv('outbox').split('\r\n').length, 5);
      assert(csv('dispatch_results').includes('"uncertain"'));
      assert(csv('dispatch_results').includes('"removed"'));
      const workbook = unzipSync(captured.files['calendar.xlsx']);
      assert.equal(Object.keys(workbook).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length, 13);
      assert(strFromU8(workbook['xl/workbook.xml']).includes('name="dispatch results"'));
      assert(strFromU8(workbook['xl/worksheets/sheet8.xml']).includes('t="inlineStr"'));
      const readable = [...Object.entries(captured.files).filter(([name]) => !name.endsWith('.xlsx')).map(([, bytes]) => strFromU8(bytes)),
        ...Object.values(workbook).map(bytes => strFromU8(bytes))].join('\n');
      for (const privateValue of ['request_body', 'worker_principal', 'reviewed_google_owner', 'fictional-calendar-access',
        'fictional-calendar-refresh', 'verifier_envelope', 'state_digest', identity.googleOwner, 'Synthetic lifecycle customer',
        '123 Example Lane', '/schedule?job=']) assert(!readable.includes(privateValue), privateValue);
      const unrelated = await captureGoogleCalendarPortableSource(foreign.business, query);
      assert.equal(JSON.parse(unrelated.manifest).businessId, foreign.business);
      for (const [name, bytes] of Object.entries(unrelated.files)) {
        if (name.endsWith('.csv')) assert.equal(strFromU8(bytes).split('\r\n').length, 2, name);
      }
      await assert.rejects(captureGoogleCalendarPortableSource(randomUUID(), query), { code: '23514' });
    } finally { await reader.query('ROLLBACK'); }
    assert.equal(await restoreCalendar({ candidate, admin, database, owner, target, formerWorker: fixtureWorker, expectedExport, key }), after.length);
    if (selected.workAddress) await verifyUnsafeCalendarLocation({ admin, web, owner: await makeOwner(owner), destinationId, generation,
      worker, provider: fictionalProvider, signal });
  } finally {
    try { await sandbox?.close(); } finally { await cluster.close(); }
  }
});
