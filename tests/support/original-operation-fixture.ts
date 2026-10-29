import {randomUUID} from 'node:crypto';
import {parseOriginalOperationReference,parseOriginalOperationRetirement} from '../../src/security/original-operation-reference.ts';
import type {OriginalOperationKind,OriginalOperationReference,OriginalOperationRetirement} from '../../src/security/original-operation-reference.ts';
export function originalOperationFixture(kind:OriginalOperationKind='crm.customer.save'){
 const common={operationId:randomUUID(),recoveryEpoch:randomUUID()},id=randomUUID();
 const targets={
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
