// Server verification of retained evidence; the shared input contract is browser-safe.
import {isDeepStrictEqual} from 'node:util';
import {customerDate,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {normalizeOpeningFundsEvidence,OpeningFundsEvidenceError} from './opening-funds-contract.ts';
export {normalizeOpeningFundsEvidence,OpeningFundsEvidenceError} from './opening-funds-contract.ts';
export type {OpeningFundsInput} from './opening-funds-contract.ts';
function require(value:unknown):asserts value{if(!value)throw new OpeningFundsEvidenceError();}
export function verifyOpeningFundsEvidence(value:unknown){
 try{
  require(exact(value,['schemaVersion','cutoverOn','state','posted','currency','reason','totals','roots','refundAuthorized','fullSourceClosureVerified'])&&value.schemaVersion===1&&customerDate(value.cutoverOn)&&Array.isArray(value.roots));
  const roots=value.roots.map((root:unknown)=>{require(exact(root,['rootId','sourceNamespace','externalId','receivedOn','receivedCents','receiptEvidence','reductions','items','heldCents','openingRootCents','refundableCeilingCents'])&&Array.isArray(root.items));const {heldCents:_held,openingRootCents:_opening,refundableCeilingCents:_ceiling,...raw}=root;void _held;void _opening;void _ceiling;return{...raw,items:root.items.map((item:unknown)=>{require(exact(item,['itemId','customerId','heldCents','obligationEvidence','refundableCeilingCents','refundEvidence','refundCeilingState']));const {refundCeilingState:_state,...raw}=item;void _state;return raw;})};});
  const result=normalizeOpeningFundsEvidence({schemaVersion:1,roots,reason:value.reason},value.cutoverOn);require(isDeepStrictEqual(result,value));return result;
 }catch{throw new OpeningFundsEvidenceError();}
}
