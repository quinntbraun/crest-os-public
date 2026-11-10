import {randomUUID} from 'node:crypto';
import {parseOriginalOperationReference,parseOriginalOperationRetirement} from '../../src/security/original-operation-reference.ts';
import type {OriginalOperationKind,OriginalOperationReference,OriginalOperationRetirement} from '../../src/security/original-operation-reference.ts';
export function originalOperationFixture(kind:OriginalOperationKind='crm.customer.save'){
 const common={operationId:randomUUID(),recoveryEpoch:randomUUID()},id=randomUUID();
 const targets={
 'operations.job.field':{jobId:id,expectedJobVersion:'1',action:'direct_arrive'},
 'operations.job.complete':{jobId:id,expectedJobVersion:'2'},
 'operations.job.interrupt':{jobId:id,expectedJobVersion:'2',action:'cancel'},
 'operations.job.cancel_unfulfilled':{jobId:id,expectedJobVersion:'2'},
 'operations.job.work_start.correct':{jobId:id,expectedJobVersion:'3',workVersionId:randomUUID(),arrivalVersionId:null},
 'operations.job.work_boundary.correct':{jobId:id,expectedJobVersion:'3',leftVersionId:randomUUID(),rightVersionId:randomUUID()},
 'operations.mileage.record':{legId:id,expectedLegVersionId:randomUUID(),expectedEvidenceVersion:'0'},
 'operations.support_trip.record':{legId:id,expectedLegVersionId:null,action:'depart'},
 'operations.support_trip.correct':{legId:id,expectedLegVersionId:randomUUID(),action:'correct'},

 'operations.fulfillment_modes.initialize':{expectedSequence:'0'},
 'operations.fulfillment_modes.save':{expectedSequence:'1'},
 'operations.job.book':{jobId:id,expectedModeSequence:'0'},
 'operations.job.cancel':{jobId:id,expectedJobVersion:'1'},
 'operations.job.reschedule':{jobId:id,expectedJobVersion:'1',action:'propose',latestAppointmentId:randomUUID()},
 'bookkeeping.expense.save':{expenseId:id,expectedRevision:'0'},
 'bookkeeping.receipt.reserve':{receiptId:id,expenseId:randomUUID(),expenseRevision:'1',expectedRevision:'0'},
 'bookkeeping.receipt.publish':{receiptId:id,expenseId:randomUUID(),expenseRevision:'1',expectedRevision:'1'},
  'operations.appointment_hold.save':{holdId:id,expectedSequence:'0'},
  'business.rename':{expectedVersion:'1'},
  'crm.customer.save':{customerId:id,expectedVersion:'0'},
  'crm.address.save':{customerId:randomUUID(),addressId:id,expectedVersion:'0'},
  'crm.vehicle.save':{vehicleId:id,expectedVersion:'0'},
  'crm.vehicle.association':{action:'transfer',associationId:id,vehicleId:randomUUID(),expectedVersion:'1',nextAssociationId:randomUUID()},
  'crm.lead.source.save':{leadSourceId:id,expectedVersion:'0'},
  'crm.lead.save':{leadId:id,expectedVersion:'0'},
  'crm.lead.state':{leadId:id,expectedVersion:'1'},
  'crm.lead.vehicle.save':{leadId:randomUUID(),leadVehicleId:id,expectedVersion:'0'},
  'crm.lead.address.save':{leadId:randomUUID(),leadAddressId:id,expectedVersion:'0'},
  'crm.lead.convert':{conversionId:id,leadId:randomUUID(),expectedLeadVersion:'1',customerId:randomUUID()},
  'catalog.service.save':{serviceId:id,expectedRevision:'0'},
  'quote.draft.save':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'0',expectedRevisionVersion:'0'},
  'quote.amendment.create':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'7',expectedRevisionVersion:'0',expectedParentAgreementId:randomUUID(),expectedParentAgreementVersion:'1'},
 'quote.amendment.accept':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'11',expectedRevisionVersion:'4',expectedContentVersion:'1',acceptanceId:randomUUID(),agreementId:randomUUID(),sendId:randomUUID(),customerId:randomUUID(),expectedParentAgreementId:randomUUID(),expectedParentAgreementVersion:'1'},
 'quote.amendment.send':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'10',expectedRevisionVersion:'3',expectedContentVersion:'1',sendId:randomUUID(),approvalId:randomUUID(),expectedParentAgreementId:randomUUID(),expectedParentAgreementVersion:'1',replacesRevisionId:null},
 'quote.replacement.create':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'4',expectedRevisionVersion:'0'},
  'quote.manual.send':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'4',expectedRevisionVersion:'4',expectedContentVersion:'1',sendId:randomUUID(),approvalId:randomUUID()},
  'quote.confirmation.accept':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'5',expectedRevisionVersion:'5',expectedContentVersion:'1',acceptanceId:randomUUID(),agreementId:randomUUID()},
  'quote.review.submit':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'2',expectedRevisionVersion:'2',expectedContentVersion:'1'},
  'quote.review.approve':{familyId:id,revisionId:randomUUID(),expectedFamilyVersion:'3',expectedRevisionVersion:'3',expectedContentVersion:'1',approvalId:randomUUID()}
 };
 return parseOriginalOperationReference({schemaVersion:1,businessId:randomUUID(),commandType:kind,reference:{...common,...targets[kind]}});
}
export function retirementFixture(original:OriginalOperationReference=originalOperationFixture()){
 return parseOriginalOperationRetirement({schemaVersion:1,recoveryEpoch:randomUUID(),original,reason:' Owner reviewed lost draft é 😀\nRetire this original only. '});
}
export function retiredOutcomeFixture(input:OriginalOperationRetirement){
 return {schemaVersion:1 as const,state:'retired' as const,original:input.original,retirement:{operationRowId:randomUUID(),auditEventId:randomUUID(),recoveryEpoch:input.recoveryEpoch,reason:input.reason,recordedAt:'2026-10-25T01:02:03.123456Z'}};
}
