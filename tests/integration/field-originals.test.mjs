// Actual shared operation-key races and restricted-session field recovery.
// This fixture installs the held schema 54 source. Later commands have their own registered-prefix suites.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {originalOperationKinds,parseOriginalOperationOutcome} from '../../src/security/original-operation-reference.ts';
import {originalOperationFixture} from '../support/original-operation-fixture.ts';
import {fieldOriginalKinds,parseFieldOriginal,parseFieldOriginalResult} from '../../src/operations/field-original-contract.ts';
import {parseSchedulingOriginalResult} from '../../src/operations/scheduling-original-contract.ts';
const names=['field-time-storage','field-session-commands','work-completion-plan','work-completion-commands','field-scope-floor','mileage-evidence','mileage-field-profile','mobile-trip-interruption','unfulfilled-work-cancellation','support-trip-commands','field-originals','field-source'];
const proposals=await Promise.all(names.map(n=>readFile(new URL('../../planning/proposals/'+n+'.sql',import.meta.url),'utf8')));
const laterFieldKinds=new Set([
 'operations.job.work_boundary.correct',
 'operations.job.work_start.correct',
 'operations.job.work_end.correct',
 'operations.mobile_departure.correct',
 'operations.message.record_outcome',
 'operations.follow_up.save','operations.custody.save','operations.custody.policy.save'
]);
let sandbox,client,web,login,target,accepted;
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0].value;
const scalar=(q,args=[])=>value(client,q,args);
const location=text=>({schemaVersion:1,kind:'manual',locationText:text,instructions:null});
async function tx(c,work){await c.query('BEGIN');try{const r=await work();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 login='synthetic_field_original_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;target=url.toString();web=await sandbox.connect(target);await web.query('SET ROLE crest_web');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await scalar("SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});for(const s of proposals.slice(0,10))await tx(client,()=>client.query(s));
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function fixture(){
 const p=await accepted(null);p.rig=randomUUID();assert.equal((await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',[...p.auth(),p.epoch,randomUUID(),p.rig,{label:'Synthetic field-original rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null}])).state,'committed');
 const q=confirmedBookingRequest(p);p.booked=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]);assert.equal(p.booked.state,'committed');p.job=q.jobId;p.version='1';p.booking=q;return p;
}
async function field(p,action){const body={action,reason:action==='direct_arrive'?'Synthetic omitted outbound travel':action==='pause'?'Synthetic pause':null,...(action==='depart'?{trip:{drivenVehicleId:p.rig,origin:location('Synthetic base'),etaAt:null,notes:null}}:{})};const r=await value(web,'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]);assert.equal(r.state,'committed');p.version=r.receipt.jobVersion;return r;}
async function scope(p){return (await client.query('SELECT DISTINCT source_allocation_id,plan_id,plan_sequence::text,entitlement_version_id FROM crest.current_scope_allocation_parts WHERE business_id=$1 AND job_id=$2 ORDER BY source_allocation_id',[p.business,p.job])).rows.map(r=>({sourceAllocationId:r.source_allocation_id,expectedPlanId:r.plan_id,expectedSequence:r.plan_sequence,entitlementVersionId:r.entitlement_version_id}));}
async function completion(p){return {scope:(await client.query("SELECT a.id,v.id plan_id,v.sequence::text,a.stable_partition_id,a.gross_inclusive_cents::text,a.discount_inclusive_cents::text,a.amount_cents::text,a.scope_description FROM crest.current_scope_allocation_parts current JOIN crest.allocation_plan_parts a ON a.business_id=current.business_id AND a.plan_id=current.plan_id AND a.stable_partition_id=current.stable_partition_id JOIN crest.allocation_plan_versions v ON v.business_id=a.business_id AND v.id=a.plan_id WHERE current.business_id=$1 AND current.job_id=$2 AND current.allocation_state='assigned' ORDER BY a.id",[p.business,p.job])).rows.map(a=>({assignedPartId:a.id,expectedPlanId:a.plan_id,expectedPlanSequence:a.sequence,pieces:[{partitionId:a.stable_partition_id,outcome:'completed',scopeDescription:a.scope_description,grossInclusiveCents:a.gross_inclusive_cents,discountInclusiveCents:a.discount_inclusive_cents,amountCents:a.amount_cents,reason:null}]})),reason:null,walkthrough:{state:'done',reason:null},review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],expectedCustomerVersion:'1',contactReviewReason:null}};}
const tripBody=p=>({action:'record',reason:'Synthetic omitted support trip',trip:{drivenVehicleId:p.rig,jobId:p.job,purpose:'return_to_base',origin:location('Synthetic work site'),destination:location('Synthetic base'),notes:null,departedAt:'2026-01-02T03:04:05.123456Z',arrivedAt:'2026-01-02T03:24:05.654321Z',state:'closed'}});
async function plan(kind){
 const p=await fixture(),operation=randomUUID();let name,tail,ref={operationId:operation,recoveryEpoch:p.epoch};
 if(kind==='operations.job.field'){
  name='change_field_session';tail=[p.job,p.version,{action:'direct_arrive',reason:'Synthetic recovery omission'}];ref={...ref,jobId:p.job,expectedJobVersion:p.version,action:'direct_arrive'};
 }else if(kind==='operations.job.complete'){
  await field(p,'direct_arrive');name='complete_job';tail=[p.job,p.version,await completion(p)];ref={...ref,jobId:p.job,expectedJobVersion:p.version};
 }else if(kind==='operations.job.interrupt'){
  const departed=await field(p,'depart');name='interrupt_mobile_job';tail=[p.job,p.version,{action:'cancel',reason:'Synthetic interrupted original trip',trip:{legId:departed.receipt.travelLegId,expectedLegVersionId:departed.receipt.travelLegId,actualStop:location('Synthetic actual stop')},expectedAppointmentId:await scalar('SELECT current_appointment_id value FROM crest.jobs WHERE id=$1',[p.job]),expectedModeSequence:null,appointment:null,conflictReview:null,customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},scope:await scope(p)}];ref={...ref,jobId:p.job,expectedJobVersion:p.version,action:'cancel'};
 }else if(kind==='operations.job.cancel_unfulfilled'){
  await field(p,'direct_arrive');name='cancel_unfulfilled_job';tail=[p.job,p.version,{reason:'Synthetic no fulfilled scope',noFulfilledScopeConfirmed:true,expectedWorkIntervalId:await scalar('SELECT id value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[p.business,p.job]),expectedOpenTravelLegVersionIds:[],customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},scope:await scope(p)}];ref={...ref,jobId:p.job,expectedJobVersion:p.version};
 }else{
  const leg=randomUUID();let first;
  if(kind!=='operations.support_trip.record'){first=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),leg,null,tripBody(p)]);assert.equal(first.state,'committed');}
  if(kind==='operations.mileage.record'){
   name='record_mileage';tail=[leg,first.receipt.legVersionId,'0',{source:'manual_actual',movementKind:'business_rig',actualMiles:'10.5000',estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:null,reason:null,allocationState:'unallocated',allocations:[]}];ref={...ref,legId:leg,expectedLegVersionId:first.receipt.legVersionId,expectedEvidenceVersion:'0'};
  }else{
   name='record_support_trip';const body=kind==='operations.support_trip.record'?{action:'depart',reason:null,trip:{...tripBody(p).trip}}:{...tripBody(p),action:'correct',reason:'Synthetic corrected original trip'};
   if(kind==='operations.support_trip.record')for(const k of ['departedAt','arrivedAt','state'])delete body.trip[k];
   tail=[leg,first?.receipt.legVersionId??null,body];ref={...ref,legId:leg,expectedLegVersionId:first?.receipt.legVersionId??null,action:body.action};
  }
 }
 const args=[...p.auth(),p.epoch,operation,...tail];const placeholders=args.map((_,i)=>'$'+(i+1));placeholders.splice(10,0,'1');
 return {p,original:parseFieldOriginal({schemaVersion:1,businessId:p.business,commandType:kind,reference:ref}),sql:'SELECT crest_commands.'+name+'('+placeholders.join(',')+') value',args};
}
const execute=(q,c=web)=>value(c,q.sql,q.args);
// p.auth already contains its business; never trust a caller-supplied actor.
const typedLookup=(q,original=q.original,c=web)=>value(c,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...q.p.auth(),original]);
const retire=(q,c=web)=>value(c,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',[...q.p.auth(),q.p.epoch,q.original,'Owner explicitly retires this fictional lost original']);
const resolution=q=>value(web,'SELECT crest_commands.lookup_original_operation_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...q.p.auth(),q.original]);
test('field-original installation refuses changed validators routing and unsafe grants',async()=>{
 for(const mutation of ["ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) SET statement_timeout='1s'","ALTER FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) SET statement_timeout='1s'",'ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC']){
  await client.query('BEGIN');try{await client.query(mutation);await assert.rejects(client.query(proposals[10]),e=>e.code==='42501'&&e.message==='CREST_FIELD_ORIGINAL_SOURCE_REQUIRED');}finally{await client.query('ROLLBACK');}
 }
});
test('installs typed field originals with unchanged retirement source and closed ordinary roles',async()=>{
 const before=await scalar("SELECT pg_get_functiondef('crest_private.operation_retirement_result(uuid,uuid,jsonb)'::regprocedure) value");
 try{await tx(client,()=>client.query(proposals[10]));}catch(e){throw Error('FIELD_ORIGINAL_INSTALL '+JSON.stringify({code:e.code,message:e.message,position:e.position,where:e.where}),{cause:e});}
 await tx(client,()=>client.query(proposals[11]));
 assert.equal(await scalar("SELECT pg_get_functiondef('crest_private.operation_retirement_result(uuid,uuid,jsonb)'::regprocedure) value"),before);
 for(const role of ['anon','authenticated','crest_web','crest_worker','crest_recovery'])assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) value',[role,'crest_private.original_operation_reference_valid(jsonb)','EXECUTE']),false);
});
test('held SQL accepts its typed originals, rejects later commands, and rejects retained draft content',async()=>{
 for(const kind of originalOperationKinds){const r=originalOperationFixture(kind);assert.equal(await scalar('SELECT crest_private.original_operation_reference_valid($1) value',[r]),!laterFieldKinds.has(kind),kind);assert.equal(await scalar('SELECT crest_private.original_operation_reference_valid($1) value',[{...r,reference:{...r.reference,location:'Private draft content'}}]),false,kind);}
});
test('the existing booked-job original still uses its unchanged full typed receipt',async()=>{
 const p=await fixture(),original={schemaVersion:1,businessId:p.business,commandType:'operations.job.book',reference:{operationId:p.booking.operationId,recoveryEpoch:p.epoch,jobId:p.job,expectedModeSequence:'0'}};
 const found=await value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),original]);assert.deepEqual(parseSchedulingOriginalResult(found,original).receipt,p.booked.receipt);
});
test('a different support command kind at the same operation ID cannot impersonate the original',async()=>{
 const q=await plan('operations.support_trip.record');assert.equal((await execute(q)).state,'committed');
 const changed=parseFieldOriginal({...q.original,commandType:'operations.support_trip.correct',reference:{...q.original.reference,action:'record'}});
 assert.deepEqual(await typedLookup(q,changed),{state:'conflict',reason:'operation'});assert.equal(parseFieldOriginalResult(await typedLookup(q),q.original).state,'committed');
});
for(const kind of fieldOriginalKinds.filter(kind=>!laterFieldKinds.has(kind))){
 test(kind+' verifies the actual original source and rejects mismatched typed identities',async()=>{
  const q=await plan(kind),saved=await execute(q);assert.equal(saved.state,'committed');const found=await typedLookup(q),parsed=parseFieldOriginalResult(found,q.original);assert.equal(parsed.state,'committed');assert.deepEqual(parseSchedulingOriginalResult(found,q.original),parsed);assert.equal(parsed.receipt.operationId,q.original.reference.operationId);
  const observed=await retire(q);assert.equal(observed.state,'original_recorded');parseOriginalOperationOutcome(observed,q.original);assert.throws(()=>parseFieldOriginalResult(observed,q.original));
  for(const key of Object.keys(q.original.reference).filter(k=>k!=='operationId'&&k!=='action')){const raw={...q.original,reference:{...q.original.reference,[key]:key.startsWith('expected')&&key.endsWith('Version')?(BigInt(q.original.reference[key])+1n).toString():randomUUID()}};let changed;try{changed=parseFieldOriginal(raw);}catch{continue;}assert.deepEqual(await typedLookup(q,changed),{state:'conflict',reason:'operation'},key);}
  const before=found.result;assert.deepEqual((await typedLookup(q)).result,before);
 });
 test(kind+' explicitly retires an absent original and permanently refuses its late execution',async()=>{
  const q=await plan(kind);assert.deepEqual(await typedLookup(q),{state:'absent'});assert.deepEqual(await resolution(q),{state:'absent'});const retired=await retire(q);assert.equal(parseOriginalOperationOutcome(retired,q.original).state,'retired');assert.deepEqual(await resolution(q),retired);assert.deepEqual(await retire(q),retired);assert.deepEqual(await execute(q),{state:'conflict',reason:'operation'});assert.deepEqual(await typedLookup(q),{state:'absent'});
  assert.equal(await scalar('SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[q.p.business,q.original.reference.operationId]),1);assert.equal(await scalar('SELECT count(*)::int value FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[q.p.business,q.original.reference.operationId]),1);
 });
 for(const first of ['original','retirement'])test(kind+' races '+first+' first at the actual shared unique operation key',{timeout:30000},async()=>{
  const q=await plan(kind),a=await sandbox.connect(target),b=await sandbox.connect(target);await a.query('SET ROLE crest_web');await b.query('SET ROLE crest_web');let pending;
  try{const blocker=await value(a,'SELECT pg_backend_pid() value'),waiter=await value(b,'SELECT pg_backend_pid() value');await a.query('BEGIN');assert.equal((await(first==='original'?execute(q,a):retire(q,a))).state,first==='original'?'committed':'retired');pending=Promise.allSettled([first==='original'?retire(q,b):execute(q,b)]);let waiting=false;
   for(let i=0;i<120;i++){await client.query('SELECT pg_stat_clear_snapshot()');waiting=await scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND wait_event='transactionid' AND $2=ANY(pg_blocking_pids(pid))) value",[waiter,blocker]);if(waiting)break;await delay(25);}assert(waiting,'actual unique-key transaction wait observed');await a.query('COMMIT');const [r]=await pending;if(r.status==='rejected')throw r.reason;assert.equal(r.value.state,first==='original'?'original_recorded':'conflict');if(first==='retirement')assert.equal(r.value.reason,'operation');
   assert.equal(await scalar('SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[q.p.business,q.original.reference.operationId]),1);
  }finally{await a.query('ROLLBACK').catch(()=>{});await pending;await a.end();await b.end();}
 });
}
