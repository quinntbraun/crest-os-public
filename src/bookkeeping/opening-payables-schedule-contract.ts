// Shared private-screen boundary. Saving source evidence never posts money.
import {historyJsonEqual,parseHistoryJson} from '../security/history-evidence-json.ts';
import {customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {normalizeOpeningPayablesEvidence,OpeningPayablesEvidenceError} from './opening-payables-contract.ts';
import type {OpeningPayablesInput} from './opening-payables-contract.ts';

function check(value:unknown):asserts value{if(!value)throw new OpeningPayablesEvidenceError();}
export type OpeningPayablesEvidence=ReturnType<typeof normalizeOpeningPayablesEvidence>;

export function parseOpeningPayablesEvidence(value:unknown):OpeningPayablesEvidence{
 check(exact(value,['schemaVersion','cutoverOn','currency','state','reason','bills','totals','posted','paymentAuthorized','newExpenseCents','newPaymentCents','verifiedZero','historicalAllocationClosureVerified','fullSourceClosureVerified'])&&value.schemaVersion===1&&typeof value.cutoverOn==='string'&&Array.isArray(value.bills)&&value.bills.length<=200);
 const bills=value.bills.map((bill:unknown)=>{
  check(exact(bill,['billId','sourceNamespace','externalId','vendor','purpose','incurredOn','originalDueOn','unknownDueReason','originalCents','remainingCents','billEvidence','reductions','taxEvidence','openingLiabilityCents','dueState','taxState']));
  const {openingLiabilityCents:_amount,dueState:_due,taxState:_tax,...raw}=bill;void _amount;void _due;void _tax;return raw;
 });
 const expected=normalizeOpeningPayablesEvidence({schemaVersion:1,bills,reason:value.reason},value.cutoverOn);
 check(historyJsonEqual(parseHistoryJson(JSON.stringify(value)),parseHistoryJson(JSON.stringify(expected))));return expected;
}

export function parseOpeningPayablesSave(value:unknown,cutoverOn:string){
 check(exact(value,['worksheetRevision','expectedRevision','input'])&&customerVersion(value.worksheetRevision)
  &&customerVersion(value.expectedRevision,true)&&BigInt(value.expectedRevision)<9223372036854775807n);
 normalizeOpeningPayablesEvidence(value.input,cutoverOn);
 // Copy only after full validation; caller changes cannot alter the save payload.
 return {worksheetRevision:value.worksheetRevision,expectedRevision:value.expectedRevision,input:structuredClone(value.input) as OpeningPayablesInput};
}

function receipt(value:unknown,businessId:string,worksheetRevisionId?:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','scheduleRevisionId','worksheetRevisionId','revision','operationId','auditEventId','recordedBy','recordedAt','evidenceSha256','evidence'])
  &&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.scheduleRevisionId)&&customerUuid(value.worksheetRevisionId)
  &&(worksheetRevisionId===undefined||value.worksheetRevisionId===worksheetRevisionId)&&customerVersion(value.revision)
  &&customerUuid(value.operationId)&&customerUuid(value.auditEventId)&&customerUuid(value.recordedBy)&&customerInstant(value.recordedAt)
  &&typeof value.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceSha256));
 const evidence=parseOpeningPayablesEvidence(value.evidence);
 return {schemaVersion:1 as const,businessId,scheduleRevisionId:value.scheduleRevisionId,worksheetRevisionId:value.worksheetRevisionId,
  revision:value.revision,operationId:value.operationId,auditEventId:value.auditEventId,recordedBy:value.recordedBy,
  recordedAt:value.recordedAt,evidenceSha256:value.evidenceSha256,evidence};
}
export type OpeningPayablesReceipt=ReturnType<typeof receipt>;
export {receipt as parseOpeningPayablesReceipt};

export function openingPayablesDraftFromEvidence(value:unknown):OpeningPayablesInput{
 const evidence=parseOpeningPayablesEvidence(value);
 return {schemaVersion:1,reason:evidence.reason,bills:evidence.bills.map(bill=>{
  const {openingLiabilityCents:_amount,dueState:_due,taxState:_tax,...raw}=structuredClone(bill);void _amount;void _due;void _tax;return raw;
 })};
}

export function parseOpeningPayablesStored(value:unknown,businessId:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','worksheetRevisionId','schedule'])
  &&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.worksheetRevisionId));
 return {worksheetRevisionId:value.worksheetRevisionId,schedule:value.schedule===null?null:receipt(value.schedule,businessId,value.worksheetRevisionId)};
}

export function parseOpeningPayablesOperation(value:unknown,businessId:string,operationId:string){
 check(customerUuid(businessId)&&customerUuid(operationId));
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review_required'||value.state==='retired'))return {state:value.state} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const stored=receipt(value.receipt,businessId);check(stored.operationId===operationId);
 return {state:'committed',receipt:stored} as const;
}
