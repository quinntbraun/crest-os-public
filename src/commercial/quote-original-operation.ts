import {parseOriginalOperationReference} from '../security/original-operation-reference.ts';
import type {OriginalOperationReference} from '../security/original-operation-reference.ts';
import {parseQuoteCommitted,requireQuoteStorage} from './quote-storage-contract.ts';
export type QuoteOriginalOperation=Extract<OriginalOperationReference,{commandType:'quote.draft.save'}>;
export function parseQuoteOriginalOperation(value:unknown):QuoteOriginalOperation{
 const original=parseOriginalOperationReference(value);requireQuoteStorage(original.commandType==='quote.draft.save');return original;
}
// A generic original_recorded observation is never a saved quote receipt.
export function bindQuoteOriginalReceipt(value:unknown,reference:unknown){
 const original=parseQuoteOriginalOperation(reference),ref=original.reference,result=parseQuoteCommitted(value,original.businessId,ref.operationId),r=result.receipt;
 requireQuoteStorage(result.recoveryEpoch===ref.recoveryEpoch&&r.familyId===ref.familyId&&r.revisionId===ref.revisionId&&r.familyVersion===(BigInt(ref.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(ref.expectedRevisionVersion)+1n).toString());
 return result;
}
