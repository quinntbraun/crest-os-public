import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupLegacy68Database,connect,keyPair,privateWorkspace,recoveryCluster,restoreLegacy68Database} from '../support/recovery-drill.mjs';
import {bookingFoundationEvidence} from '../support/booking-source-evidence.mjs';
import {collectAcceptedAmendmentSources} from '../support/accepted-amendment-source-fixture.mjs';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {parsePickupTripDatabasePage} from '../../src/operations/pickup-trip-contract.ts';

const value = async (connection, sql, args = []) => (await connection.query(sql, args)).rows[0]?.value;
const conflict = reason => ({state:'conflict', reason});
const location = locationText => ({schemaVersion:1, kind:'manual', locationText, instructions:null});
const command = 'SELECT crest_commands.record_pickup_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value';
const lookup = 'SELECT crest_commands.lookup_pickup_trip_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) value';

test('pickup travel and per-vehicle collection preserve separate work and exclusive custody', {timeout:240000}, async () => {
 const cluster = await recoveryCluster();
 let sandbox,pointWorkspace,destinationCluster,restored;
 try {
  sandbox = await migrationSandbox(cluster.testDatabaseUrl);
  const target = await sandbox.database();
  const client = await sandbox.connect(target);
  const web = await sandbox.connect(target);
  await sandbox.apply(target, await sandbox.prefix(0), true);
  await installProviderSchema(client, target);
  assert.equal((await sandbox.apply(target, await sandbox.prefix(68))).history.length, 68);
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../../planning/proposals/pickup-trip.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../../planning/proposals/pickup-trip-read.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  await web.query('SET ROLE crest_web');
  const bootstrap = await value(client, "SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
  const fixture = createConfirmedBookingFixture({client, web, bootstrap});
  const owner = await fixture();
  const other = await fixture();
  const modes = enabled => ({mobileEnabled:true, dropoffEnabled:true, pickupReturnEnabled:enabled,
   reason:enabled ? 'Explicit synthetic enablement' : 'Explicit synthetic disablement'});
  const changeModes = (version, enabled) => value(web,
   'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...owner.auth(), owner.epoch, randomUUID(), version, modes(enabled)]);
  const rig = randomUUID();
  const second = randomUUID();
  const third = randomUUID();
  for (const [id, kind] of [[rig, 'business_rig'], [second, 'customer_vehicle'], [third, 'customer_vehicle']]) {
   const saved = await value(web, 'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',
    [...owner.auth(), owner.epoch, randomUUID(), id, {label:'Synthetic transport vehicle', year:null, make:null, model:null,
     color:null, vin:null, plate:null, kind, notes:null, archived:false, archiveReason:null}]);
   assert.equal(saved.state, 'committed');
  }
  const pickup = location('Synthetic pickup point');
  const returnLocation = location('Synthetic return point');
  const booking = confirmedBookingRequest(owner);
  booking.payload.fulfillmentMode = 'pickup_return';
  booking.payload.vehicles[0].pickupLocation = pickup;
  booking.payload.vehicles[0].returnLocation = returnLocation;
  booking.payload.vehicles.push({...booking.payload.vehicles[0], vehicleId:second},
   {...booking.payload.vehicles[0], vehicleId:third, pickupLocation:location('A separate synthetic pickup point')});
  const book = version => value(web, 'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...owner.auth(), owner.epoch, booking.operationId, booking.jobId, version, booking.payload]);
  assert.deepEqual(await book('0'), conflict('mode_disabled'));
  const initialize = await value(web, 'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...owner.auth(), owner.epoch, randomUUID(), '0', {...modes(false), reason:null}]);
  assert.equal(initialize.state, 'committed');
  assert.equal((await changeModes('1', true)).state, 'committed');
  assert.equal((await book('2')).state, 'committed');
  assert.equal((await changeModes('2', false)).state, 'committed');
  const vehicles = (await client.query('SELECT id, vehicle_id FROM crest.job_vehicles WHERE business_id=$1 AND job_id=$2',
   [owner.business, booking.jobId])).rows;
  const bookedId = id => vehicles.find(vehicle => vehicle.vehicle_id === id).id;
  const targetIds = [bookedId(owner.vehicle), bookedId(second)];
  const eta = new Date(Date.now() + 20 * 60 * 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
  const depart = {action:'depart', reason:null,
   trip:{jobVehicleIds:targetIds, drivenVehicleId:rig, origin:location('Synthetic Crest garage'), etaAt:eta, notes:null}};
  const arrive = {action:'arrive', reason:null, trip:null};
  const cancel = {action:'cancel', reason:'Customer unavailable', trip:{actualStop:location('Synthetic safe stop')}};
  const run = (operation, leg, predecessor, body, options = {}) => value(options.connection ?? web, command,
   [...(options.principal ?? owner).auth(), (options.principal ?? owner).epoch, operation,
    options.job ?? booking.jobId, options.version ?? '1', leg, predecessor, body]);
  const original = (operation, principal = owner) => value(web, lookup, [...principal.auth(), operation]);
  const read = (principal = owner, job = booking.jobId, beforeDepartedAt = null, beforeLegId = null) => value(web,
   'SELECT crest_commands.read_pickup_trips($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...principal.auth(), job, beforeDepartedAt, beforeLegId]);
  const typedReference = (operationId, legId, expectedLegVersionId, action) => ({
   schemaVersion:1,businessId:owner.business,commandType:'operations.pickup_trip.record',
   reference:{operationId,recoveryEpoch:owner.epoch,jobId:booking.jobId,expectedJobVersion:'1',legId,expectedLegVersionId,action}
  });
  const typedOriginal = reference => value(web,
   'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...owner.auth(),reference]);
  const legId = randomUUID();
  const departureId = randomUUID();
  await assert.rejects(run(randomUUID(), legId, null, {...depart, trip:{...depart.trip, etaAt:'2026-02-30T10:00:00.000000Z'}}), {code:'22023'});
  await assert.rejects(run(randomUUID(), legId, null, {...depart, trip:{...depart.trip, jobVehicleIds:[targetIds[0], targetIds[0]]}}), {code:'22023'});
  assert.deepEqual(await run(randomUUID(), legId, null, depart, {principal:other}), conflict('job'));
  assert.deepEqual(await run(randomUUID(), legId, null, depart, {version:'2'}), conflict('job_version'));
  assert.deepEqual(await run(randomUUID(), legId, null, {...depart, trip:{...depart.trip, drivenVehicleId:other.vehicle}}), conflict('vehicle'));
  for (const jobVehicleIds of [[randomUUID()], [targetIds[0], bookedId(third)]]) {
   assert.deepEqual(await run(randomUUID(), legId, null, {...depart, trip:{...depart.trip, jobVehicleIds}}), conflict('pickup_location'));
  }
  assert.deepEqual(await original(departureId), {state:'absent'});
  assert.deepEqual(await typedOriginal(typedReference(departureId,legId,null,'depart')), {state:'absent'});
  assert.deepEqual(await read(other), {state:'absent'});
  assert.deepEqual((await read()).trips, []);
  const competing = await sandbox.connect(target);
  await competing.query('SET ROLE crest_web');
  const race = await Promise.all([run(departureId, legId, null, depart),
   run(departureId, legId, null, depart, {connection:competing})]);
  const [opened] = race;
  assert.equal(opened.state, 'committed');
  assert.deepEqual(race[1], opened);
  assert.deepEqual(opened.receipt.jobVehicleIds, targetIds);
  assert.equal(opened.receipt.leg.purpose, 'pickup');
  assert.equal(opened.receipt.leg.state, 'open');
  assert.equal(opened.receipt.leg.driven_vehicle_id, rig);
  assert.equal(opened.receipt.leg.eta_at, eta);
  assert.equal(opened.receipt.leg.eta_source, 'owner_entered');
  assert.equal(opened.receipt.leg.eta_calculated_at, opened.receipt.leg.departed_at);
  assert.deepEqual(opened.receipt.leg.destination_snapshot, pickup);
  const first=typedReference(departureId,legId,null,'depart');
  const verified=await typedOriginal(first);
  assert.equal(verified.result.receipt.sourceRecordId,legId);
  assert.equal(verified.result.receipt.sourceVersion,'1');
  await assert.rejects(typedOriginal({...first,reference:{...first.reference,expectedJobVersion:'2'}}),{code:'23514'});
  const scope={businessId:owner.business,jobId:booking.jobId},emptyCursor={beforeDepartedAt:null,beforeLegId:null};
  const current=parsePickupTripDatabasePage(await read(),scope,emptyCursor);
  assert.equal(current.activeLegId,legId);
  assert.equal(current.trips[0].drivenVehicleLabel,'Synthetic transport vehicle');
  assert.deepEqual(await run(departureId, legId, null, {...depart, reason:'Changed'}), conflict('operation'));
  assert.deepEqual(await run(randomUUID(), randomUUID(), null, depart), conflict('occupancy'));
  assert.deepEqual(await run(randomUUID(), legId, randomUUID(), arrive), conflict('leg_version'));
  assert.deepEqual(await original(departureId, other), {state:'absent'});
  const arrivalId = randomUUID();
  const arrived = await run(arrivalId, legId, legId, arrive);
  assert.equal(arrived.state, 'committed');
  assert.equal(arrived.receipt.leg.state, 'closed');
  assert.equal(arrived.receipt.leg.replaces_id, legId);
  assert.deepEqual(arrived.receipt.jobVehicleIds, targetIds);
  assert.deepEqual(arrived.receipt.leg.destination_snapshot, pickup);
  assert.deepEqual(await original(departureId), opened);
  assert.deepEqual(await original(arrivalId), arrived);
  assert.equal((await typedOriginal(typedReference(arrivalId,legId,legId,'arrive'))).result.receipt.sourceVersion,'2');
  assert.deepEqual(await run(randomUUID(), legId, arrived.receipt.leg.id, cancel), conflict('state'));

  const retryLegs = [randomUUID(), randomUUID()];
  const retryBody = {...depart, trip:{...depart.trip, etaAt:null}};
  const retried = await Promise.all([run(randomUUID(), retryLegs[0], null, retryBody),
   run(randomUUID(), retryLegs[1], null, retryBody, {connection:competing})]);
  assert.deepEqual(retried.map(result => result.state).sort(), ['committed', 'conflict']);
  assert.deepEqual(retried.find(result => result.state === 'conflict'), conflict('occupancy'));
  const retryLeg = retryLegs[retried.findIndex(result => result.state === 'committed')];
  await assert.rejects(run(randomUUID(), retryLeg, retryLeg, {...cancel, reason:null}), {code:'22023'});
  const cancellationId = randomUUID();
  const stopped = await run(cancellationId, retryLeg, retryLeg, cancel);
  assert.equal(stopped.state, 'committed');
  assert.equal(stopped.receipt.leg.state, 'cancelled');
  assert.deepEqual(stopped.receipt.leg.destination_snapshot, cancel.trip.actualStop);
  assert.equal(stopped.receipt.leg.reason, cancel.reason);
  assert.equal(stopped.receipt.leg.eta_at, null);
  assert.deepEqual(await original(cancellationId), stopped);
  const latest=parsePickupTripDatabasePage(await read(),scope,emptyCursor);
  assert.equal(latest.activeLegId,null);
  assert.deepEqual(latest.trips.map(trip=>trip.state),['cancelled','closed']);
  const cursor={beforeDepartedAt:latest.trips[0].departedAt,beforeLegId:latest.trips[0].legId};
  assert.deepEqual(parsePickupTripDatabasePage(await read(owner,booking.jobId,cursor.beforeDepartedAt,cursor.beforeLegId),
   scope,cursor).trips.map(trip=>trip.legId),[legId]);
  assert.equal(await value(client, "SELECT state value FROM crest.jobs WHERE id=$1", [booking.jobId]), 'scheduled');
  assert.equal(await value(client, 'SELECT count(*)::int value FROM crest.work_intervals WHERE job_id=$1', [booking.jobId]), 0);
  assert.equal(await value(client, 'SELECT count(*)::int value FROM crest.custody_cases WHERE job_id=$1', [booking.jobId]), 0);
  const mileage=await value(web,'SELECT crest_commands.read_job_mileage_trips($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,20) value',
   [...owner.auth(),booking.jobId]);
  assert.deepEqual(mileage.trips.map(trip=>[trip.purpose,trip.distanceStatus]),[['pickup','unresolved'],['pickup','unresolved']]);
  assert.equal(await value(client, 'SELECT count(*)::int value FROM crest.travel_legs WHERE job_context_id=$1', [booking.jobId]), 4);
  assert.equal(await value(client, "SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND command_type='operations.pickup_trip.record'", [owner.business]), 4);
  assert.equal(await value(client, "SELECT count(*)::int value FROM crest.operator_occupancy WHERE business_id=$1 AND source_kind='travel' AND ended_at IS NULL", [owner.business]), 0);
  await assert.rejects(web.query('SELECT * FROM crest.travel_legs'), {code:'42501'});
  await assert.rejects(value(web, 'SELECT crest_private.pickup_trip_original($1,$2,$3) value',
   [owner.business, owner.actor, departureId]), {code:'42501'});
  const unused=typedReference(randomUUID(),randomUUID(),null,'depart');
  const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),owner.epoch,unused,'Synthetic uncertain pickup trip']);
  assert.equal(retired.state,'retired');
  assert.deepEqual(await run(unused.reference.operationId,unused.reference.legId,null,depart),conflict('operation'));

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const foundation=await bookingFoundationEvidence(client,owner.business);
   const commercial=await collectAcceptedAmendmentSources(client,owner.business);
   const field=(await collectFieldSourcesInSnapshot(client,owner.business,new AbortController().signal)).forServer();
   const crm={};
   for(const [group,routine] of [['customers','customer'],['addresses','address'],['vehicles','vehicle'],['associations','association']]){
    const context=await value(client,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[owner.business]);
    const page=await value(client,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,NULL,20) value',[owner.business,context.snapshotToken]);
    assert.equal(String(page[group].length),context.rowCount);
    crm[group]={businessId:owner.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows:page[group]};
   }
   const workspace={...foundation,commercial:{...commercial,historyEvidence:foundation.history},field:{...field,historyEvidence:foundation.history},crm};
   const bundle=formatFieldWorkspaceSources(workspace);
   const csv=bundle.parts.find(part=>part.name==='travel_legs.csv').content;
   const json=JSON.parse(bundle.parts.find(part=>part.name==='field_source_snapshot.json').content);
   assert(csv.includes(legId)&&csv.includes(retryLeg)&&csv.includes('Synthetic safe stop'));
   assert.equal(json.rows.travel_legs.filter(leg=>leg.purpose==='pickup').length,4);
   const changed=structuredClone(workspace);
   changed.field.rows.travel_legs.find(leg=>leg.id===legId).purpose='return_to_customer';
   assert.throws(()=>formatFieldWorkspaceSources(changed),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
  }finally{await client.query('ROLLBACK');}

  pointWorkspace=await privateWorkspace();
  const point=join(pointWorkspace,'point'),keys=await keyPair(pointWorkspace);
  await mkdir(point,{mode:0o700});
  assert.equal((await client.query('SELECT 1 FROM crest.custody_photo_attempts LIMIT 1')).rowCount,0);
  const sealed=await backupLegacy68Database(client,target,point,keys.recipient);
  assert.equal(sealed.manifest.schemaVersion,68);
  assert.equal(sealed.manifest.completeBackup,false);
  destinationCluster=await recoveryCluster();
  const destination=await destinationCluster.database();
  assert.deepEqual(await restoreLegacy68Database(point,keys.path,destination),sealed.manifest);
  restored=await connect(destination);
  const saved=await value(restored,'SELECT crest_private.pickup_trip_original($1,$2,$3) value',
   [owner.business,owner.actor,arrivalId]);
  assert.deepEqual(saved.receipt,arrived.receipt);
  assert.equal(saved.request.body.action,'arrive');
  assert.equal(await value(restored,'SELECT count(*)::int value FROM crest.travel_legs WHERE job_context_id=$1',[booking.jobId]),4);

  const dropoffOwner=await fixture(owner,{customerId:owner.customer});
  const dropoff=confirmedBookingRequest(dropoffOwner);
  dropoff.payload.fulfillmentMode='dropoff';
  dropoff.payload.vehicles.push({...dropoff.payload.vehicles[0],vehicleId:owner.vehicle},
   {...dropoff.payload.vehicles[0],vehicleId:second});
  Object.assign(dropoff.payload.appointment,{start_at:'2026-11-03T13:00:00.123456Z',end_at:'2026-11-03T14:00:00.123456Z',
   local_start:'2026-11-03T13:00:00.123456',local_end:'2026-11-03T14:00:00.123456'});
  const dropoffSaved=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,3,$12) value',
   [...owner.auth(),owner.epoch,dropoff.operationId,dropoff.jobId,dropoff.payload]);
  assert.equal(dropoffSaved.state,'committed',JSON.stringify(dropoffSaved));
  const dropoffMode=await value(client,'SELECT mode_version_id value FROM crest.jobs WHERE id=$1',[dropoff.jobId]);
  const dropoffPolicy=randomUUID();
  assert.equal((await value(web,'SELECT crest_commands.save_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...owner.auth(),owner.epoch,dropoffPolicy,dropoffMode,{acknowledgementText:null,conditionPhotoRequired:false}])).state,'committed');
  const dropoffVehicle=id=>value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1 AND vehicle_id=$2',[dropoff.jobId,id]);
  const dropoffSecond=await dropoffVehicle(second),dropoffFirst=await dropoffVehicle(owner.vehicle);
  const collectionTime=arrived.receipt.leg.arrived_at,dropoffCase=randomUUID();
  const dropoffHandoff=(target,caseId,version)=>value(web,
   'SELECT crest_commands.save_dropoff_handoff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',
   [...owner.auth(),owner.epoch,randomUUID(),target,caseId,version,{authorizationConfigId:dropoffPolicy,effectiveAt:collectionTime,
    person:{schemaVersion:1,displayName:'Synthetic Drop-Off customer'},location:location('Synthetic shop'),
    notes:null,missingPhotoReason:'Camera unavailable',acknowledgementConfirmed:null}]);
  assert.equal((await dropoffHandoff(dropoffSecond,dropoffCase,0)).state,'committed');

  await client.query('BEGIN');
  await client.query(await readFile(new URL('../../planning/proposals/pickup-custody-collection.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('../../planning/proposals/pickup-custody-recovery.sql',import.meta.url),'utf8'));
  await client.query('COMMIT');
  const custodyClaim=vehicle=>value(client,'SELECT to_jsonb(c) value FROM crest_private.vehicle_custody_claims c WHERE business_id=$1 AND vehicle_id=$2',
   [owner.business,vehicle]);
  assert.equal((await custodyClaim(second)).dropoff_case_id,dropoffCase);
  const pickupMode=await value(client,'SELECT mode_version_id value FROM crest.jobs WHERE id=$1',[booking.jobId]);
  const policyId=randomUUID();
  const collectionContext=(target,principal=owner,jobId=booking.jobId)=>value(web,
   'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...principal.auth(),jobId,target]);
  assert.deepEqual(await collectionContext(targetIds[0],other),{state:'absent'});
  assert.equal((await collectionContext(targetIds[0])).state,'requires_policy');
  assert.equal((await collectionContext(bookedId(third))).state,'awaiting_arrival');
  await client.query('INSERT INTO crest_private.pickup_custody_policies(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required) VALUES($1,$2,$3,$4,false)',
   [policyId,owner.business,pickupMode,'Synthetic transport authorization']);
  const handoff={effectiveAt:collectionTime,person:{schemaVersion:1,displayName:'Synthetic handing-over person'},
   location:pickup,notes:null,missingPhotoReason:'Camera unavailable',acknowledgementConfirmed:true};
  const arrivalVersion=arrived.receipt.leg.id;
  const collect=(operation,target,options={})=>value(options.connection??web,
   'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
   [...(options.principal??owner).auth(),(options.principal??owner).epoch,operation,options.job??booking.jobId,options.version??'1',
    target,options.leg??arrivalVersion,options.policy??policyId,options.body??handoff]);
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{principal:other}),conflict('job'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{version:'2'}),conflict('job_version'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{policy:randomUUID()}),conflict('policy'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{leg:legId}),conflict('arrival'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{leg:stopped.receipt.leg.id}),conflict('arrival'));
  assert.deepEqual(await collect(randomUUID(),bookedId(third)),conflict('arrival'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{body:{...handoff,effectiveAt:'2026-01-01T00:00:00.000000Z'}}),conflict('arrival'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0],{body:{...handoff,acknowledgementConfirmed:null}}),conflict('acknowledgement'));
  await assert.rejects(collect(randomUUID(),targetIds[0],{body:{...handoff,missingPhotoReason:' '}}),{code:'22023'});
  assert.equal((await collectionContext(targetIds[0])).state,'ready');
  assert.equal((await collectionContext(targetIds[1])).state,'vehicle_held');
  assert.deepEqual(await collect(randomUUID(),targetIds[1]),conflict('vehicle_held'));
  const firstId=randomUUID();
  const [collected,duplicate]=await Promise.all([collect(firstId,targetIds[0]),collect(firstId,targetIds[0],{connection:competing})]);
  assert.equal(collected.state,'committed');
  assert.deepEqual(duplicate,collected);
  assert.equal(collected.receipt.collection.vehicle_id,owner.vehicle);
  assert.equal(collected.receipt.collection.pickup_leg_version_id,arrivalVersion);
  assert.deepEqual((await collectionContext(targetIds[0])).collection,collected.receipt.collection);
  const collectionReference={
   schemaVersion:1,businessId:owner.business,commandType:'operations.pickup_custody.collect',
   reference:{operationId:firstId,recoveryEpoch:owner.epoch,jobId:booking.jobId,expectedJobVersion:'1',
    jobVehicleId:targetIds[0],pickupLegVersionId:arrivalVersion,policyId}
  };
  const originalCollection=await typedOriginal(collectionReference);
  assert.equal(originalCollection.result.receipt.subjectId,targetIds[0]);
  assert.equal(originalCollection.result.receipt.sourceRecordId,firstId);
  assert.deepEqual(originalCollection.result.receipt.sourceAuditIds,[collected.receipt.auditId]);
  assert(!JSON.stringify(originalCollection).includes(handoff.person.displayName));
  await assert.rejects(typedOriginal({...collectionReference,reference:{...collectionReference.reference,policyId:randomUUID()}}),{code:'23514'});
  const retiredCollection={...collectionReference,reference:{...collectionReference.reference,operationId:randomUUID(),jobVehicleId:targetIds[1]}};
  assert.equal((await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),owner.epoch,retiredCollection,'Synthetic unconfirmed collection'])).state,'retired');
  assert.deepEqual(await collect(retiredCollection.reference.operationId,targetIds[1]),conflict('operation'));
  assert.deepEqual(await collect(firstId,targetIds[0],{body:{...handoff,notes:'Changed'}}),conflict('operation'));
  assert.deepEqual(await collect(randomUUID(),targetIds[0]),conflict('collected'));
  assert.equal((await custodyClaim(owner.vehicle)).pickup_collection_id,firstId);
  assert.deepEqual(await dropoffHandoff(dropoffFirst,randomUUID(),0),conflict('vehicle_held'));
  const cancelBooking=jobId=>value(web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
   [...owner.auth(),owner.epoch,randomUUID(),jobId,{reason:'Synthetic cancellation with retained custody',
    customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
  assert.equal((await cancelBooking(dropoff.jobId)).state,'committed');
  assert.equal((await custodyClaim(second)).dropoff_case_id,dropoffCase);
  assert.equal((await dropoffHandoff(dropoffSecond,dropoffCase,1)).state,'committed');
  assert.equal(await custodyClaim(second),undefined);
  const secondId=randomUUID();
  assert.equal((await collect(secondId,targetIds[1])).state,'committed');
  assert.equal((await custodyClaim(second)).pickup_collection_id,secondId);
  assert.equal((await collectionContext(targetIds[1])).state,'held');
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest.work_intervals WHERE job_id=$1',[booking.jobId]),0);
  assert.equal((await cancelBooking(booking.jobId)).state,'committed');
  assert.equal((await custodyClaim(owner.vehicle)).pickup_collection_id,firstId);
  assert.equal((await custodyClaim(second)).pickup_collection_id,secondId);
  assert.equal((await collectionContext(targetIds[0])).state,'return_required');
  assert.equal((await collectionContext(bookedId(third))).state,'closed');
  assert.deepEqual(await collect(firstId,targetIds[0]),collected);
  assert.deepEqual(await typedOriginal(collectionReference),originalCollection);
  assert.deepEqual(await collect(randomUUID(),bookedId(third),{version:'2'}),conflict('job'));
  assert.equal((await changeModes('3',true)).state,'committed');
  const requiredOwner=await fixture(owner,{customerId:owner.customer});
  const requiredBooking=confirmedBookingRequest(requiredOwner);
  requiredBooking.payload.fulfillmentMode='pickup_return';
  Object.assign(requiredBooking.payload.vehicles[0],{pickupLocation:pickup,returnLocation});
  const requiredBooked=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,4,$12) value',
   [...owner.auth(),owner.epoch,requiredBooking.operationId,requiredBooking.jobId,requiredBooking.payload]);
  assert.equal(requiredBooked.state,'committed',JSON.stringify(requiredBooked));
  const requiredMode=await value(client,'SELECT mode_version_id value FROM crest.jobs WHERE id=$1',[requiredBooking.jobId]);
  const requiredTarget=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[requiredBooking.jobId]);
  const requiredPolicy=randomUUID(),requiredLeg=randomUUID();
  await client.query('INSERT INTO crest_private.pickup_custody_policies(id,business_id,mode_version_id,condition_photo_required) VALUES($1,$2,$3,true)',
   [requiredPolicy,owner.business,requiredMode]);
  assert.equal((await run(randomUUID(),requiredLeg,null,{...depart,trip:{...depart.trip,jobVehicleIds:[requiredTarget]}},{job:requiredBooking.jobId})).state,'committed');
  const requiredArrival=await run(randomUUID(),requiredLeg,requiredLeg,arrive,{job:requiredBooking.jobId});
  assert.equal(requiredArrival.state,'committed');
  assert.equal((await collectionContext(requiredTarget,owner,requiredBooking.jobId)).state,'photo_required');
  assert.deepEqual(await collect(randomUUID(),requiredTarget,{job:requiredBooking.jobId,policy:requiredPolicy,
   leg:requiredArrival.receipt.leg.id,body:{...handoff,effectiveAt:requiredArrival.receipt.leg.arrived_at,acknowledgementConfirmed:null}}),conflict('photo'));
  assert.equal(await custodyClaim(requiredOwner.vehicle),undefined);
  await assert.rejects(web.query('SELECT * FROM crest_private.vehicle_custody_claims'),{code:'42501'});
  await assert.rejects(web.query('SELECT * FROM crest_private.pickup_custody_collections'),{code:'42501'});
 } finally {
  try { await restored?.end(); }
  finally { try { await destinationCluster?.close(); }
   finally { try {
    if(pointWorkspace){
     const actual=await realpath(pointWorkspace);
     const root=await realpath(fileURLToPath(new URL('../../.local/recovery-drill/',import.meta.url)));
     assert.equal(dirname(actual),root);
     assert.match(basename(actual),/^case-[a-z0-9]+$/i);
     await rm(actual,{recursive:true,force:true});
    }
   }finally{try{await sandbox?.close();}finally{await cluster.close();}} }
  }
 }
});
