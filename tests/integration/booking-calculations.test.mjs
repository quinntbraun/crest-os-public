// Real PostgreSQL parity for the next booking boundary, not a booking command.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseScheduleTime} from '../../src/operations/schedule-time.ts';
import {compareScheduleReservations} from '../../src/operations/schedule-conflicts.ts';
import {validateScopeAllocationPlan} from '../../src/operations/scope-allocation-plan.ts';
let sandbox,client;
const id='11111111-1111-4111-8111-111111111111',operator='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',appointment='44444444-4444-4444-8444-444444444444';
const time=()=>({start_at:'2026-10-29T14:00:00.123456Z',end_at:'2026-10-29T15:30:00.654321Z',timezone:'America/Indiana/Indianapolis',local_start:'2026-10-29T10:00:00.123456',local_end:'2026-10-29T11:30:00.654321',start_offset_minutes:-240,end_offset_minutes:-240});
const hold=t=>({...t,customer_id:id,lead_id:null,label:'Synthetic time comparison',state:'proposed',notes:null,reason:null});
before(async()=>{sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));},{timeout:240000});
after(async()=>{await sandbox?.close();});
for(const [name,patch,expected] of [
 ['Indianapolis microseconds',{},true],
 ['offset mismatch',{start_offset_minutes:-300},false],
 ['local microseconds mismatch',{local_start:'2026-10-29T10:00:00.123457'},false],
 ['invalid calendar date',{start_at:'2026-02-30T14:00:00.123456Z'},false],
 ['invalid zone',{timezone:'Unknown/Zone'},false],
 ['fractional offset',{start_offset_minutes:-240.5},false],
 ['zero duration',{end_at:'2026-10-29T14:00:00.123456Z',local_end:'2026-10-29T10:00:00.123456'},false],
 ['DST gap',{timezone:'America/New_York',start_at:'2026-03-08T07:30:00.000000Z',end_at:'2026-03-08T08:30:00.000000Z',local_start:'2026-03-08T02:30:00.000000',local_end:'2026-03-08T04:30:00.000000',start_offset_minutes:-300,end_offset_minutes:-240},false],
 ['DST fold',{timezone:'America/New_York',start_at:'2026-11-01T05:30:00.000000Z',end_at:'2026-11-01T06:30:00.000000Z',local_start:'2026-11-01T01:30:00.000000',local_end:'2026-11-01T01:30:00.000000',start_offset_minutes:-240,end_offset_minutes:-300},true],
 ['negative Unix timestamp',{timezone:'UTC',start_at:'1969-12-31T23:59:59.999999Z',end_at:'1970-01-01T00:00:00.000001Z',local_start:'1969-12-31T23:59:59.999999',local_end:'1970-01-01T00:00:00.000001',start_offset_minutes:0,end_offset_minutes:0},true]
])test('new booking time and registered SQL agree: '+name,async()=>{
 const value={...time(),...patch};let accepted=true;try{parseScheduleTime(value);}catch{accepted=false;}
 assert.equal(accepted,expected);const actual=(await client.query('SELECT crest_private.valid_appointment_hold_payload($1::jsonb) AS valid',[hold(value)])).rows[0].valid;assert.equal(actual,expected);
});
test('work and known-travel interval comparison matches PostgreSQL ranges at exact boundaries',async()=>{
 const context={businessId:id,operatorId:operator,rescheduledJobId:null},base={startAt:'2026-10-30T11:00:00.000000Z',endAt:'2026-10-30T12:00:00.000000Z',travelBeforeSeconds:0,travelAfterSeconds:0},prior={...base,startAt:'2026-10-30T10:00:00.000000Z',endAt:'2026-10-30T11:00:00.000000Z',businessId:id,operatorId:operator,jobId:job,appointmentId:appointment};
 for(const [next,current,expected] of [[base,prior,false],[{...base,travelBeforeSeconds:1},prior,true],[base,{...prior,travelAfterSeconds:1},true],[{...base,startAt:'2026-10-30T10:59:59.999999Z'},prior,true]]){
  const actual=(await client.query("SELECT tstzrange($1::timestamptz-$3::integer*interval '1 second',$2::timestamptz+$4::integer*interval '1 second','[)') && tstzrange($5::timestamptz-$7::integer*interval '1 second',$6::timestamptz+$8::integer*interval '1 second','[)') AS overlaps",[next.startAt,next.endAt,next.travelBeforeSeconds,next.travelAfterSeconds,current.startAt,current.endAt,current.travelBeforeSeconds,current.travelAfterSeconds])).rows[0].overlaps;
  assert.equal(actual,expected);assert.equal(compareScheduleReservations(context,next,[current]).conflictingAppointmentIds.length>0,expected);
 }
});
test('large explicit split amounts agree with exact PostgreSQL numeric sums and preserve unassigned remainder',async()=>{
 const source={id,grossInclusiveCents:'9007199254741994',discountInclusiveCents:'1001',amountCents:'9007199254740993'},parts=[{partitionId:id,jobId:job,state:'assigned',grossInclusiveCents:'6001',discountInclusiveCents:'601',amountCents:'5400',scopeDescription:'Explicit first visit'},{partitionId:appointment,jobId:null,state:'unassigned',grossInclusiveCents:'9007199254735993',discountInclusiveCents:'400',amountCents:'9007199254735593',scopeDescription:'Retained remaining work'}];
 const validated=validateScopeAllocationPlan(source,parts);const totals=(await client.query("SELECT sum((part->>'grossInclusiveCents')::numeric)::text AS gross,sum((part->>'discountInclusiveCents')::numeric)::text AS discount,sum((part->>'amountCents')::numeric)::text AS amount FROM jsonb_array_elements($1::jsonb) part",[JSON.stringify(validated.parts)])).rows[0];
 assert.deepEqual(totals,{gross:source.grossInclusiveCents,discount:source.discountInclusiveCents,amount:source.amountCents});assert.equal(validated.parts[1].jobId,null);
});
