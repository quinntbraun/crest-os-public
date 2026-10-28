// Typed original evidence only. No retry, pending-store release or authority.
import {parseOriginalOperationReference} from '../security/original-operation-reference.ts';
import type {OriginalOperationReference} from '../security/original-operation-reference.ts';
import {parseServiceCommitted,requireService} from './service-storage-contract.ts';
export type ServiceOriginalOperation=Extract<OriginalOperationReference,{commandType:'catalog.service.save'}>;
export function parseServiceOriginalOperation(value:unknown):ServiceOriginalOperation{
 const original=parseOriginalOperationReference(value);requireService(original.commandType==='catalog.service.save');return original;
}
// Generic original_recorded is an observation, never a typed domain receipt.
// Preserve the old epoch even when retirement uses a fresh recovery authority.
export function bindServiceOriginalReceipt(value:unknown,reference:unknown){
 const original=parseServiceOriginalOperation(reference),ref=original.reference;
 const receipt=parseServiceCommitted(value,original.businessId,ref.operationId);
 requireService(receipt.recoveryEpoch===ref.recoveryEpoch&&receipt.receipt.serviceId===ref.serviceId
  &&BigInt(receipt.receipt.serviceRevision)===BigInt(ref.expectedRevision)+1n);
 return receipt;
}
