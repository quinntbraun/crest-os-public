import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseBookJobSave,parseBookingContact,parseBookedJobCommitted,parseCancelScheduledJobSave,parseCancelledJobCommitted} from '../../src/operations/confirmed-booking-contract.ts';
import {syntheticBookingRequest} from '../fixtures/confirmed-booking.ts';
describe('confirmed booking data and original receipt boundary',()=>{
 it('requires explicit cancellation reason and factual communication, sealing the request before dispatch',()=>{
  const q=syntheticBookingRequest(),input={schemaVersion:1,businessId:q.businessId,operationId:randomUUID(),recoveryEpoch:q.recoveryEpoch,jobId:q.jobId,expectedJobVersion:'9007199254740993',payload:{reason:'Customer cancelled the fictional visit',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}},sealed=parseCancelScheduledJobSave(input);input.payload.reason='Changed after dispatch';expect(sealed.payload.reason).not.toBe(input.payload.reason);expect(sealed.expectedJobVersion).toBe('9007199254740993');expect(Object.isFrozen(sealed.payload.customerCommunication)).toBe(true);
  for(const communication of [{state:'sent',channel:null,effectiveAt:null,evidenceNote:null},{state:'no_contact',channel:null,effectiveAt:null,evidenceNote:' '},{state:'not_sent',channel:'email',effectiveAt:null,evidenceNote:null}])expect(()=>parseCancelScheduledJobSave({...input,payload:{...input.payload,customerCommunication:communication}})).toThrow();
  expect(parseCancelScheduledJobSave({...input,payload:{...input.payload,customerCommunication:{state:'sent',channel:'phone',effectiveAt:q.payload.appointment.customer_confirmation.effectiveAt,evidenceNote:'Owner recorded actual fictional phone conversation'}}})).toHaveProperty('payload.customerCommunication.state','sent');
  expect(()=>parseCancelScheduledJobSave({...input,expectedJobVersion:'9223372036854775807'})).toThrow();expect(()=>parseCancelScheduledJobSave({...input,payload:{...input.payload,reason:' '}})).toThrow();
 });
 it('accepts only a retained cancellation revision, without weakening original booking receipt checks',()=>{
  const q=syntheticBookingRequest(),audit=randomUUID(),receipt={schemaVersion:1,businessId:q.businessId,jobId:q.jobId,version:'2',appointmentId:randomUUID(),appointmentSequence:'2',jobAuditEventId:audit,sourceAuditIds:[audit]},result={state:'committed',operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,receipt};expect(parseCancelledJobCommitted(result,q.businessId,q.operationId).receipt.version).toBe('2');expect(()=>parseBookedJobCommitted(result,q.businessId,q.operationId)).toThrow();expect(()=>parseCancelledJobCommitted({...result,receipt:{...receipt,version:'1'}},q.businessId,q.operationId)).toThrow();
 });
 it('seals nested form data before any asynchronous submission and preserves microseconds',()=>{
  const input=syntheticBookingRequest(),saved=parseBookJobSave(input);Object.assign(input.payload.workLocation,{locationText:'Changed after dispatch'});Object.assign(input.payload.appointment.customer_confirmation,{evidenceNote:'Changed confirmation'});Object.assign(input.payload.allocationPlans[0]!.parts[0]!,{scopeDescription:'Changed scope'});
  expect(saved.payload.workLocation).toHaveProperty('locationText','Synthetic workshop, 123 Example Lane, Indianapolis');expect(saved.payload.appointment.customer_confirmation.evidenceNote).not.toBe('Changed confirmation');expect(saved.payload.allocationPlans[0]!.parts[0]!.scopeDescription).not.toBe('Changed scope');expect(saved.payload.appointment.start_at).toBe('2026-11-03T10:00:00.123456Z');expect(Object.isFrozen(saved.payload.conflictReview.expectedAppointmentIds)).toBe(true);
 });
 it('accepts readable phone formats/extensions and explicit no-contact evidence without coercion',()=>{
  expect(parseBookingContact({kind:'phone',value:'+1 (202) 555-0105 ext. 12'})).toHaveProperty('value','+1 (202) 555-0105 ext. 12');expect(parseBookingContact({kind:'no_contact',reason:'Arranged in person'})).toHaveProperty('kind','no_contact');
  for(const v of [{kind:'phone',value:'123'},{kind:'email',value:'missing-at-sign'},{kind:'no_contact',reason:'\u00a0'},{kind:'phone',value:'2025550105\n123'},{kind:'email',value:'a@b@c'},{}])expect(()=>parseBookingContact(v)).toThrow('BOOKING_DATA_INVALID');
 });
 it('requires matching actual UTC/local time, exact input keys and reviewed pickup addresses',()=>{
  const input=syntheticBookingRequest();for(const change of [{schemaVersion:2},{expectedModeSequence:0},{extra:true},{jobId:null}])expect(()=>parseBookJobSave({...input,...change})).toThrow();
  expect(()=>parseBookJobSave({...input,payload:{...input.payload,appointment:{...input.payload.appointment,local_start:'2026-11-04T10:00:00.123456'}}})).toThrow();expect(()=>parseBookJobSave({...input,payload:{...input.payload,fulfillmentMode:'pickup_return'}})).toThrow();
 });
 it('retains exact int64 cents and rejects rounded, overflowing or internally unbalanced scope',()=>{
  const input=syntheticBookingRequest(),part=input.payload.allocationPlans[0]!.parts[0]!;Object.assign(part,{amountCents:'9007199254740993',grossInclusiveCents:'9007199254740993'});expect(parseBookJobSave(input).payload.allocationPlans[0]!.parts[0]!.amountCents).toBe('9007199254740993');
  for(const patch of [{amountCents:9007199254740992},{amountCents:'1'},{amountCents:'9223372036854775808',grossInclusiveCents:'9223372036854775808'}]){const copy=structuredClone(input);Object.assign(copy.payload.allocationPlans[0]!.parts[0]!,patch);expect(()=>parseBookJobSave(copy)).toThrow();}
 });
 it('rejects conflicting duplicate identities and malformed review state',()=>{
  const input=syntheticBookingRequest();expect(()=>parseBookJobSave({...input,payload:{...input.payload,vehicles:[...input.payload.vehicles,...input.payload.vehicles]}})).toThrow();expect(()=>parseBookJobSave({...input,payload:{...input.payload,allocationPlans:[...input.payload.allocationPlans,...input.payload.allocationPlans]}})).toThrow();const id=randomUUID();expect(()=>parseBookJobSave({...input,payload:{...input.payload,conflictReview:{...input.payload.conflictReview,expectedAppointmentIds:[id,id]}}})).toThrow();
 });
 it('binds the immutable receipt to the requested business/operation and seals retained audit IDs',()=>{
  const q=syntheticBookingRequest(),audit=randomUUID(),receipt={schemaVersion:1,businessId:q.businessId,jobId:q.jobId,version:'1',appointmentId:randomUUID(),appointmentSequence:'1',jobAuditEventId:audit,sourceAuditIds:[audit]},result={state:'committed',operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,receipt};
  const saved=parseBookedJobCommitted(result,q.businessId,q.operationId);receipt.sourceAuditIds.push(randomUUID());expect(saved.receipt.sourceAuditIds).toHaveLength(1);for(const patch of [{businessId:randomUUID()},{version:'2'},{sourceAuditIds:[]},{sourceAuditIds:[audit,audit]},{jobAuditEventId:randomUUID()}])expect(()=>parseBookedJobCommitted({...result,receipt:{...receipt,...patch}},q.businessId,q.operationId)).toThrow();expect(()=>parseBookedJobCommitted(result,q.businessId,randomUUID())).toThrow();
 });
});
