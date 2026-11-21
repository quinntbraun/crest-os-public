// Scoped current-assignment/field context over real immutable agreement data.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {backupDatabase,backupLegacy121Database,backupLegacy122Database,connect,keyPair,recoveryCluster,restoreDatabase,restoreLegacy121Database,restoreLegacy122Database} from '../support/recovery-drill.mjs';
import {syntheticCustomerProfileAvailable,syntheticInvoiceOutstandingAvailable,syntheticLeadFollowUpsAvailable,syntheticLeadMatchReviewAvailable,syntheticRecordJobHistoryAvailable} from '../../scripts/synthetic-migrations.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseBookingWorkspace,parseBookingAgreement,parseJobResources,parsePendingChangesPage} from '../../src/operations/booking-context-contract.ts';
import {parseRecordJobHistoryPage} from '../../src/operations/record-job-history-contract.ts';
import {parseCustomerProfile} from '../../src/customer/customer-profile-contract.ts';
import {quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract.ts';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content.ts';
const source=await readFile(new URL('../../planning/proposals/confirmed-bookings-context.sql',import.meta.url),'utf8');
let sandbox,target,client,web,webUrl,login,fixture,f,foreign,q,q2,booked,second,firstProposal,secondProposal,originalPacket,revision;
const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.value;
async function transaction(c,run){await c.query('BEGIN');try{const result=await run();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}}
const book=request=>transaction(web,()=>value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth(),f.epoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]));
const workspace=(parent=f,c=web)=>value(c,'SELECT crest_commands.read_booking_workspace($1,$2,$3,$4,$5,$6,$7,$8) AS value',parent.auth());
const agreement=(parent=f,family=f.familyId,c=web)=>value(c,'SELECT crest_commands.read_booking_agreement($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...parent.auth(),family]);
const resources=(job,parent=f,c=web)=>value(c,'SELECT crest_commands.read_confirmed_job_resources($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...parent.auth(),job]);
const pending=(afterCreated=null,afterId=null,size=20,parent=f,c=web)=>value(c,'SELECT crest_commands.read_pending_job_changes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...parent.auth(),afterCreated,afterId,size]);
const packet=()=>value(web,'SELECT crest_commands.read_quote_commercial_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...f.auth(),f.familyId,revision.id]);
function change(request,latest,expectedVersion='1',action='propose',day='2027-02-12'){
 const appointment=Object.fromEntries(Object.entries(request.payload.appointment).filter(([key])=>!['customer_confirmation','unknown_travel_reviewed'].includes(key)));Object.assign(appointment,{start_at:day+'T14:00:00.654321Z',end_at:day+'T15:00:00.654321Z',local_start:day+'T14:00:00.654321',local_end:day+'T15:00:00.654321'});
 return {operation:randomUUID(),job:request.jobId,version:expectedVersion,body:{action,reason:'Customer requested this fictional schedule change',latestAppointmentId:latest,expectedModeSequence:action==='withdraw'?null:'1',appointment:action==='propose'?appointment:null,customerConfirmation:null,conflictReview:null}};
}
const schedule=request=>transaction(web,()=>value(web,'SELECT crest_commands.change_job_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth(),f.epoch,request.operation,request.job,request.version,request.body]));
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));
 await transaction(client,async()=>{for(const name of ['fulfillment-mode-storage','fulfillment-mode-commands','confirmed-bookings-storage','confirmed-bookings-history','confirmed-bookings-invariants','confirmed-bookings-job-invariants','confirmed-bookings-commands','confirmed-bookings-reads','confirmed-bookings-enable','confirmed-bookings-cancel','confirmed-bookings-reschedule','confirmed-bookings-reschedule-commands','confirmed-bookings-resolution','confirmed-bookings-original'])await client.query(await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'));});await sandbox.apply(target,await sandbox.prefix(49));
 await client.query('BEGIN');await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_booking_owner GRANT EXECUTE ON FUNCTIONS TO crest_export');await assert.rejects(client.query(source),e=>e.code==='42501'&&e.message==='CREST_BOOKING_CONTEXT_SOURCE_REQUIRED');await client.query('ROLLBACK');await transaction(client,()=>client.query(source));
 login='crest_booking_context_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;webUrl=url.toString();web=await sandbox.connect(webUrl);await web.query('SET ROLE crest_web');fixture=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});f=await fixture();foreign=await fixture();q=confirmedBookingRequest(f);
 revision=(await client.query('SELECT r.id,r.customer_safe_snapshot,r.internal_snapshot FROM crest.quote_revisions r JOIN crest.quote_acceptances a ON a.business_id=r.business_id AND a.revision_id=r.id JOIN crest.agreements g ON g.business_id=a.business_id AND g.acceptance_id=a.id WHERE g.business_id=$1 AND g.id=$2',[f.business,f.agreementId])).rows[0];assert(revision);originalPacket=await packet();
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('workspace/context reads are tenant scoped, read-only and distinguish initial modes from persisted settings',async()=>{
 const before=await value(client,'SELECT count(*)::int AS value FROM crest_private.operations WHERE business_id=$1',[f.business]),context=parseBookingWorkspace(await workspace(),f.business);assert.equal(context.operatorId,f.actor);assert.equal(context.timezone,'UTC');assert.equal(context.modeVersion,null);const current=parseBookingAgreement(await agreement(),f.business,f.familyId);assert.equal(current.customer.id,f.customer);assert.equal(current.vehicles[0].id,f.vehicle);for(const source of current.sources){assert.equal(source.planSequence,'0');assert.equal(source.planId,null);assert.equal(source.parts[0].state,'unassigned');assert.equal(source.parts[0].partitionId,source.sourcePartitionId);}assert.equal(await value(client,'SELECT count(*)::int AS value FROM crest_private.operations WHERE business_id=$1',[f.business]),before);
 assert.deepEqual(await agreement(foreign,f.familyId),{state:'absent'});assert.deepEqual(await agreement(f,randomUUID()),{state:'absent'});await assert.rejects(workspace({...foreign,auth:()=>[...foreign.auth().slice(0,-1),f.business]}),e=>e.code==='42501');await assert.rejects(web.query('SELECT timezone FROM crest.businesses'),e=>e.code==='42501');
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web','crest_private.booking_job_display_snapshot(crest.jobs)','EXECUTE') AS value"),false);assert.equal(await value(client,"SELECT NOT prosecdef AND provolatile='s' AS value FROM pg_proc WHERE oid='crest_private.booking_job_display_snapshot(crest.jobs)'::regprocedure"),true);
});
test('a split visit returns current assignments and its saved vehicle/scope packet without rewriting the accepted agreement',async()=>{
 const paid=q.payload.allocationPlans.find(p=>p.parts[0].amountCents!=='0'),part=paid.parts[0];paid.parts=[{...part,grossInclusiveCents:'12500',amountCents:'12500'}, {...part,partitionId:randomUUID(),jobId:null,state:'unassigned',grossInclusiveCents:'12500',amountCents:'12500',scopeDescription:'Remaining explicit half of accepted synthetic work'}];booked=await book(q);assert.equal(booked.state,'committed');const current=parseBookingAgreement(await agreement(),f.business,f.familyId),source=current.sources.find(s=>s.sourceAllocationId===paid.sourceAllocationId);assert.equal(source.amountCents,'25000');assert.equal(source.planSequence,'1');assert.equal(source.parts.length,2);assert.equal(source.parts.filter(p=>p.state==='unassigned')[0].amountCents,'12500');assert.deepEqual(await packet(),originalPacket);
 const saved=parseJobResources(await resources(q.jobId),f.business,q.jobId);assert.equal(saved.vehicles[0].vehicle_id,f.vehicle);assert.equal(saved.vehicles[0].customer_snapshot.id,f.customer);assert.equal(saved.encounters[0].agreement_id,f.agreementId);assert.equal(saved.scopeParts.length,2);assert.equal(saved.scopeParts.reduce((sum,p)=>sum+BigInt(p.amountCents),0n),12500n);assert.equal(saved.head.job.version,'1');assert.equal((await workspace()).modeVersion.sequence,'1');
});
test('accepted booked quotes still refuse replacement drafts while their original commercial packet stays intact',async()=>{
 const body=prepareQuoteReviewContent(quoteInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot)),before=await packet(),result=await transaction(web,()=>value(web,'SELECT crest_commands.create_quote_replacement_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,$11,$12,$13,$14) AS value',[...f.auth(),f.epoch,randomUUID(),f.familyId,randomUUID(),before.familyVersion,body]));assert.equal(result.state,'conflict');assert.equal(result.reason,'state');assert.deepEqual(await packet(),before);
});
test('global pending changes include proposals outside a confirmed calendar window and retain the confirmed time',async()=>{
 firstProposal=await schedule(change(q,booked.receipt.appointmentId));assert.equal(firstProposal.state,'committed');const page=parsePendingChangesPage(await pending(),{businessId:f.business,afterCreatedAt:null,afterAppointmentId:null,pageSize:20});assert.equal(page.items.length,1);assert.equal(page.items[0].head.appointment.start_at,q.payload.appointment.start_at);assert.equal(page.items[0].head.latestAppointment.start_at,'2027-02-12T14:00:00.654321Z');assert.equal(page.items[0].head.confirmationDraft.state,'prepared');
 const calendar=await value(web,'SELECT crest_commands.read_confirmed_jobs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,20) AS value',[...f.auth(),'2027-02-01T00:00:00.000000Z','2027-03-01T00:00:00.000000Z']);assert.deepEqual(calendar.jobs,[]);assert.equal(parseJobResources(await resources(q.jobId),f.business,q.jobId).head.job.version,'2');
});
test('booking the remaining split scope preserves the first visit while advancing the shared plan sequence',async()=>{
 q2=confirmedBookingRequest(f);q2.expectedModeSequence='1';Object.assign(q2.payload.appointment,{start_at:'2026-11-04T10:00:00.123456Z',end_at:'2026-11-04T11:00:00.123456Z',local_start:'2026-11-04T10:00:00.123456',local_end:'2026-11-04T11:00:00.123456'});const current=parseBookingAgreement(await agreement(),f.business,f.familyId),paid=current.sources.find(s=>s.amountCents!=='0');q2.payload.allocationPlans=[{sourceAllocationId:paid.sourceAllocationId,expectedSequence:paid.planSequence,reason:'Assign the remaining explicit accepted scope',parts:paid.parts.map(p=>p.state==='unassigned'?{...p,jobId:q2.jobId,state:'assigned'}:p)}];second=await book(q2);assert.equal(second.state,'committed');const original=parseJobResources(await resources(q.jobId),f.business,q.jobId);assert.equal(original.head.job.version,'2');assert.equal(original.scopeParts.find(p=>p.amountCents!=='0').planSequence,'2');assert.equal(original.scopeParts.reduce((sum,p)=>sum+BigInt(p.amountCents),0n),12500n);assert.deepEqual(await packet(),originalPacket);
});
test('pending cursors page actual immutable proposal creation times without duplicates or resurrecting withdrawn proposals',async()=>{
 secondProposal=await schedule(change(q2,second.receipt.appointmentId,'1','propose','2027-03-12'));assert.equal(secondProposal.state,'committed');const first=parsePendingChangesPage(await pending(null,null,1),{businessId:f.business,afterCreatedAt:null,afterAppointmentId:null,pageSize:1});assert.equal(first.hasMore,true);const cursor=first.items[0],last=parsePendingChangesPage(await pending(cursor.proposedAt,cursor.head.latestAppointment.id,1),{businessId:f.business,afterCreatedAt:cursor.proposedAt,afterAppointmentId:cursor.head.latestAppointment.id,pageSize:1});assert.equal(last.hasMore,false);assert.equal(new Set([...first.items,...last.items].map(i=>i.head.job.id)).size,2);
 for(const args of [[null,randomUUID(),1],[null,null,21]])await assert.rejects(pending(...args),e=>e.code==='22023');
});
test('cancellation/withdrawal retain saved resources and accepted money while clearing only their actual pending changes',async()=>{
 const cancelled=await transaction(web,()=>value(web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,2,$12) AS value',[...f.auth(),f.epoch,randomUUID(),q.jobId,{reason:'Owner records fictional first-visit cancellation',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]));assert.equal(cancelled.state,'committed');const original=parseJobResources(await resources(q.jobId),f.business,q.jobId);assert.equal(original.head.job.state,'cancelled');assert(original.scopeParts.every(p=>p.state==='cancelled'));assert.equal((await pending()).items.length,1);
 const withdrawn=await schedule(change(q2,secondProposal.receipt.latestAppointmentId,'2','withdraw'));assert.equal(withdrawn.state,'committed');assert.deepEqual((await pending()).items,[]);const current=parseBookingAgreement(await agreement(),f.business,f.familyId);assert.equal(current.sources.reduce((sum,s)=>sum+BigInt(s.amountCents),0n),25000n);assert.equal(current.sources.flatMap(s=>s.parts).filter(p=>p.state==='cancelled').reduce((sum,p)=>sum+BigInt(p.amountCents),0n),12500n);assert.deepEqual(await packet(),originalPacket);
});
test('interactive reads reject stale isolation and a fresh read consistently observes a retained schedule change',async()=>{
 const reader=await sandbox.connect(webUrl);await reader.query('SET ROLE crest_web');await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(resources(q2.jobId,f,reader),e=>e.code==='25001'&&e.message==='CREST_TENANT_FRESH_READ_REQUIRED');await reader.query('ROLLBACK');const before=parseJobResources(await resources(q2.jobId,f,reader),f.business,q2.jobId);assert.equal(before.head.job.version,'3');const changed=await schedule(change(q2,before.head.latestAppointment.id,'3','propose','2027-04-12'));assert.equal(changed.state,'committed');const after=parseJobResources(await resources(q2.jobId,f,reader),f.business,q2.jobId);assert.equal(after.head.job.version,'4');assert.equal(after.head.latestAppointment.id,changed.receipt.latestAppointmentId);assert.deepEqual(after.scopeParts,before.scopeParts);assert.equal((await pending()).items[0].head.job.version,'4');}finally{await reader.query('ROLLBACK').catch(()=>{});await reader.end();}
});

test('saved-job history reads bounded customer and vehicle pages from retained scope',async()=>{
 const proposal=await readFile(new URL('../../planning/proposals/record-job-history.sql',import.meta.url),'utf8');
 await client.query('BEGIN');
 try{
  await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO crest_export');
  await assert.rejects(client.query(proposal),{code:'42501',message:'CREST_RECORD_JOBS_SOURCE_REQUIRED'});
 }finally{await client.query('ROLLBACK');}
 await transaction(client,()=>client.query(proposal));

 await transaction(web,async()=>{
  const change=await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',
   [...f.auth(),f.epoch,randomUUID(),f.vehicle,{label:'Synthetic revised directory label',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:'Synthetic internal notes',archived:false,archiveReason:null}]);
  assert.equal(change.state,'committed');
 });
 const evidence=()=>value(client,`SELECT jsonb_build_object('operations',(SELECT count(*) FROM crest_private.operations WHERE business_id=$1),
  'audit',(SELECT count(*) FROM crest_private.audit_events WHERE business_id=$1),
  'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM crest.jobs j WHERE j.business_id=$1),
  'visits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=$1)) AS value`,[f.business]);
 const beforeRead=await evidence();
 const query='SELECT crest_commands.read_record_jobs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS value';
 const read=(kind,record,{owner=f,connection=web,after=null,cursor=null,size=50}={})=>value(connection,query,[...owner.auth(),kind,record,after,cursor,size]);
 for(const [kind,id] of [['customer',f.customer],['vehicle',f.vehicle]]){
  const first=parseRecordJobHistoryPage(await read(kind,id,{size:1}),f.business,{kind,recordId:id,afterRecordedAt:null,afterEntryId:null,pageSize:1});
  assert.deepEqual([first.schemaVersion,first.businessId,first.kind,first.recordId,first.hasMore],[1,f.business,kind,id,true]);
  assert.equal(first.jobs.length,1);
  const row=first.jobs[0];
  const cursor=row.jobVehicleId??row.jobId;
  const next=parseRecordJobHistoryPage(await read(kind,id,{size:1,after:row.recordedAt,cursor}),f.business,{kind,recordId:id,afterRecordedAt:row.recordedAt,afterEntryId:cursor,pageSize:1});
  assert.equal(next.hasMore,false);
  assert.equal(next.jobs.length,1);
  const jobs=[row,next.jobs[0]];
  assert.deepEqual(jobs.map(item=>item.jobId),[q2.jobId,q.jobId]);
  assert.deepEqual(jobs.map(item=>item.state),['scheduled','cancelled']);
  assert.deepEqual(jobs.map(item=>item.startAt),[q2.payload.appointment.start_at,q.payload.appointment.start_at]);
  assert(jobs.every(item=>item.fulfillmentMode==='mobile'&&item.timezone==='UTC'));
  for(const item of jobs){
   assert.deepEqual(Object.keys(item).sort(),['customerName','endAt','fulfillmentMode','jobId','jobVehicleId','recordedAt','startAt','state','timezone','vehicleLabels']);
   assert.deepEqual(item.vehicleLabels,['Synthetic lifecycle sedan']);
   assert.equal(item.customerName,kind==='vehicle'?'Synthetic lifecycle customer':null);
   const bound=await value(client,'SELECT id AS value FROM crest.job_vehicles WHERE business_id=$1 AND job_id=$2 AND vehicle_id=$3',[f.business,item.jobId,f.vehicle]);
   assert.equal(item.jobVehicleId,kind==='vehicle'?bound:null);
  }
  assert.deepEqual((await read(kind,id,{owner:foreign})).jobs,[]);
 }
 assert.deepEqual((await read('customer',randomUUID())).jobs,[]);
 await assert.rejects(read('vendor',f.customer),{code:'22023'});
 await assert.rejects(read('customer',f.customer,{after:'2026-11-01T00:00:00Z'}),{code:'22023'});
 await assert.rejects(read('customer',f.customer,{after:'infinity',cursor:randomUUID()}),{code:'22023'});
 await assert.rejects(read('vehicle',f.vehicle,{size:51}),{code:'22023'});
 await assert.rejects(read('vehicle',f.vehicle,{owner:{...f,auth:()=>[...f.auth().slice(0,-1),foreign.business]}}),{code:'42501'});
 const excluded=await sandbox.connect(target);
 try{
  await excluded.query('SET ROLE crest_export');
  await assert.rejects(read('vehicle',f.vehicle,{connection:excluded}),{code:'42501'});
 }finally{await excluded.end();}
 await assert.rejects(web.query('SELECT id FROM crest.jobs'),{code:'42501'});
 assert.deepEqual(await evidence(),beforeRead);
});

for(const schemaVersion of [121,122,124])test('upgrade from schema 117 to '+schemaVersion+' preserves an existing booking and restores its customer profile',{timeout:240000},async()=>{
 const originalCluster=await recoveryCluster();
 let source,snapshotReader,restoredCluster;
 try{
  source=await migrationSandbox(originalCluster.testDatabaseUrl);
  const database=await source.database(),admin=await source.connect(database),reader=await source.connect(database);
  await source.apply(database,await source.prefix(0),true);
  await installProviderSchema(admin,database);
  const before=await source.apply(database,await source.prefix(117));
  assert.equal(before.history.length,117);
  assert.equal(before.history.at(-1).version,'20270110180000');
  assert.equal(await syntheticLeadFollowUpsAvailable(database),false);
  assert.equal(await syntheticLeadMatchReviewAvailable(database),false);
  assert.equal(await syntheticRecordJobHistoryAvailable(database),false);
  await reader.query('SET ROLE crest_web');
  const seed=createConfirmedBookingFixture({client:admin,web:reader,bootstrap:await value(admin,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
  const owner=await seed(),request=confirmedBookingRequest(owner);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  Object.assign(request.payload.appointment,{start_at:tomorrow+'T14:00:00.000000Z',end_at:tomorrow+'T15:00:00.000000Z',local_start:tomorrow+'T14:00:00.000000',local_end:tomorrow+'T15:00:00.000000'});
  assert.equal((await transaction(reader,()=>value(reader,
   'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
   [...owner.auth(),owner.epoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]))).state,'committed');
  const addLink=(relationship,isBilling,effectiveAt)=>value(reader,
   'SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,0,$11) AS value',
   [...owner.auth(),owner.epoch,randomUUID(),{action:'open',associationId:randomUUID(),customerId:owner.customer,vehicleId:owner.vehicle,effectiveAt,relationship,isBilling,evidence:null,reason:null,nextAssociationId:null}]);
  const currentLink=await addLink('owner',true,'2026-10-01T00:00:00.000000Z');
  assert.equal(currentLink.state,'committed');
  assert.equal((await addLink('keeper',false,'2026-10-01T00:00:00.000000Z')).state,'committed');
  const anotherOwner=await seed();
  const earlier=confirmedBookingRequest(await seed(owner,{customerId:owner.customer}));
  earlier.expectedModeSequence='1';
  assert.equal((await transaction(reader,()=>value(reader,
   'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
   [...owner.auth(),owner.epoch,earlier.operationId,earlier.jobId,earlier.expectedModeSequence,earlier.payload]))).state,'committed');
  const arrived=await transaction(reader,()=>value(reader,
   'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
   [...owner.auth(),owner.epoch,randomUUID(),earlier.jobId,'1',{action:'direct_arrive',reason:'Synthetic work started without travel'}]));
  assert.equal(arrived.state,'committed');
  const plans=await transaction(admin,async()=>{
   await admin.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[owner.business,owner.actor]);
   return value(admin,'SELECT crest_private.load_completion_plans($1,$2) AS value',[owner.business,earlier.jobId]);
  });
  const scope=plans.flatMap(plan=>plan.parts.filter(part=>part.jobId===earlier.jobId&&part.state==='assigned').map(part=>({
   assignedPartId:part.id,expectedPlanId:plan.planId,expectedPlanSequence:plan.planSequence,
   pieces:[{partitionId:part.partitionId,outcome:'completed',scopeDescription:part.scopeDescription,grossInclusiveCents:part.grossInclusiveCents,
    discountInclusiveCents:part.discountInclusiveCents,amountCents:part.amountCents,reason:null}],
  })));
  const completed=await transaction(reader,()=>value(reader,
   'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
   [...owner.auth(),owner.epoch,randomUUID(),earlier.jobId,arrived.receipt.jobVersion,{scope,reason:null,walkthrough:{state:'done',reason:null},
    review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],expectedCustomerVersion:'1',contactReviewReason:null}}]));
  assert.equal(completed.state,'committed');
  const completionTime=await value(admin,`SELECT to_char(completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value
   FROM crest.jobs WHERE (business_id,id)=($1,$2)`,[owner.business,earlier.jobId]);

  const evidence=async()=>value(admin,`SELECT jsonb_build_object(
   'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM crest.jobs j WHERE j.business_id=$1),
   'vehicles',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=$1),
   'appointments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest.appointments a WHERE a.business_id=$1),
   'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM crest_private.operations o WHERE o.business_id=$1),
   'audit',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest_private.audit_events e WHERE e.business_id=$1)
  ) AS value`,[owner.business]);
  const retained=await evidence();
  assert.equal(retained.jobs.length,2);
  const upgradeSource=await source.prefix(schemaVersion);
  const adopted=await source.apply(database,upgradeSource);
  assert.equal(adopted.history.length,schemaVersion);
  assert.deepEqual(adopted.history.slice(0,117),before.history);
  assert.deepEqual(adopted.history.slice(117).map(row=>row.version),['20270111180000','20270112180000','20270113180000','20270114180000',...schemaVersion>=122?['20270115180000']:[],...schemaVersion===124?['20270116180000','20270117180000']:[]]);
  assert.deepEqual((await source.apply(database,upgradeSource)).history,adopted.history);
  assert(await syntheticLeadFollowUpsAvailable(database));
  assert(await syntheticLeadMatchReviewAvailable(database));
  assert(await syntheticRecordJobHistoryAvailable(database));
  assert(await syntheticCustomerProfileAvailable(database));
  assert.equal(await syntheticInvoiceOutstandingAvailable(database),schemaVersion>=122);
  assert.deepEqual(await evidence(),retained);

  const read=async(kind,recordId,connection=reader)=>{
   const input={kind,recordId,afterRecordedAt:null,afterEntryId:null,pageSize:10};
   const result=await value(connection,'SELECT crest_commands.read_record_jobs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,10) AS value',
    [...owner.auth(),kind,recordId]);
   return parseRecordJobHistoryPage(result,owner.business,input);
  };
  const customerPage=await read('customer',owner.customer),vehiclePage=await read('vehicle',owner.vehicle);
  assert.deepEqual(customerPage.jobs.map(row=>row.jobId),[earlier.jobId,request.jobId]);
  assert.deepEqual(vehiclePage.jobs.map(row=>row.jobVehicleId),[retained.vehicles.find(vehicle=>vehicle.job_id===request.jobId).id]);

  const profile=async(customerId,afterAssociationId=null,connection=reader)=>{
   const pageSize=1;
   const result=await value(connection,'SELECT crest_commands.read_customer_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',
    [...owner.auth(),customerId,afterAssociationId,pageSize]);
   return parseCustomerProfile(result,owner.business,{customerId,afterAssociationId,pageSize});
  };
  const first=await profile(owner.customer);
  assert.deepEqual(first.lastVisit,{jobId:earlier.jobId,at:completionTime,timezone:'UTC'});
  assert.deepEqual(first.nextVisit,{jobId:request.jobId,at:request.payload.appointment.start_at,timezone:'UTC'});
  assert.equal(first.hasMore,true);
  const second=await profile(owner.customer,first.vehicles[0].associationId);
  assert.equal(second.hasMore,false);
  assert.deepEqual([first.vehicles[0],second.vehicles[0]].map(vehicle=>[vehicle.vehicleId,vehicle.relationship,vehicle.billing]).sort(),
   [[owner.vehicle,'keeper',false],[owner.vehicle,'owner',true]]);
  await assert.rejects(profile(anotherOwner.customer),{code:'42501'});

  const folder=join(source.workspace,'customer-profile-'+schemaVersion+'-recovery');
  await mkdir(folder,{mode:0o700});
  const backup=schemaVersion===121?backupLegacy121Database:schemaVersion===122?backupLegacy122Database:backupDatabase,
   restore=schemaVersion===121?restoreLegacy121Database:schemaVersion===122?restoreLegacy122Database:restoreDatabase;
  const keys=await keyPair(folder),checkpoint=await backup(admin,database,folder,keys.recipient);
  assert.equal(checkpoint.manifest.schemaVersion,schemaVersion);
  assert.equal(checkpoint.manifest.completeBackup,false);
  restoredCluster=await recoveryCluster();
  const destination=await restoredCluster.database();
  assert.deepEqual(await restore(folder,keys.path,destination),checkpoint.manifest);
  assert(await syntheticLeadFollowUpsAvailable(destination));
  assert(await syntheticLeadMatchReviewAvailable(destination));
  assert(await syntheticRecordJobHistoryAvailable(destination));
  assert(await syntheticCustomerProfileAvailable(destination));
  assert.equal(await syntheticInvoiceOutstandingAvailable(destination),schemaVersion>=122);
  snapshotReader=await connect(destination);
  await snapshotReader.query('SET ROLE crest_web');
  assert.deepEqual(await read('customer',owner.customer,snapshotReader),customerPage);
  assert.deepEqual(await read('vehicle',owner.vehicle,snapshotReader),vehiclePage);
  const {asOf:restoredObserved,...restoredProfile}=await profile(owner.customer,null,snapshotReader);
  const {asOf:initialObserved,...initialProfile}=first;
  assert(restoredObserved>=initialObserved);
  assert.deepEqual(restoredProfile,initialProfile);
  await assert.rejects(snapshotReader.query('SELECT id FROM crest.jobs'),{code:'42501'});
  await snapshotReader.query('RESET ROLE');
  await snapshotReader.query('REVOKE EXECUTE ON FUNCTION crest_commands.read_record_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,uuid,integer) FROM crest_web');
  assert.equal(await syntheticRecordJobHistoryAvailable(destination),false);
 }finally{
  try{await snapshotReader?.end();}finally{
   try{await restoredCluster?.close();}finally{
    try{await source?.close();}finally{await originalCluster.close();}
   }
  }
 }
});
