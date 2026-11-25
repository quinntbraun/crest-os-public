// Server verification of retained source material; never posting authority.
import {isDeepStrictEqual} from 'node:util';
import {customerDate,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {normalizeOpeningPayablesEvidence,OpeningPayablesEvidenceError} from './opening-payables-contract.ts';
function require(value:unknown):asserts value{if(!value)throw new OpeningPayablesEvidenceError();}
export function verifyPreparedOpeningPayablesEvidence(value:unknown){
 try{
  require(exact(value,['schemaVersion','cutoverOn','currency','state','reason','bills','totals','posted','paymentAuthorized','newExpenseCents','newPaymentCents','verifiedZero','historicalAllocationClosureVerified','fullSourceClosureVerified'])&&value.schemaVersion===1&&customerDate(value.cutoverOn)&&Array.isArray(value.bills));
  const bills=value.bills.map((bill:unknown)=>{require(exact(bill,['billId','sourceNamespace','externalId','vendor','purpose','incurredOn','originalDueOn','unknownDueReason','originalCents','remainingCents','billEvidence','reductions','taxEvidence','openingLiabilityCents','dueState','taxState']));const {openingLiabilityCents:_amount,dueState:_due,taxState:_tax,...raw}=bill;void _amount;void _due;void _tax;return raw;});
  const expected=normalizeOpeningPayablesEvidence({schemaVersion:1,bills,reason:value.reason},value.cutoverOn);require(isDeepStrictEqual(expected,value));return expected;
 }catch{throw new OpeningPayablesEvidenceError();}
}
