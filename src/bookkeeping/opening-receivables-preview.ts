import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {historyJsonEqual,parseHistoryJson} from '../security/history-evidence-json.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';

export type OpeningArDocument={reference:string;sha256:string};
export type OpeningArReduction={kind:'payment'|'credit';amountCents:string;appliedOn:string;evidence:OpeningArDocument};
export type OpeningArLine={
 customerId:string;legacyReference:string;scope:string;chargedOn:string;originalDueOn:string;
 originalCents:string;remainingCents:string;chargeEvidence:OpeningArDocument;
 reductions:OpeningArReduction[];taxEvidence:OpeningArDocument|null;
};
export type OpeningArInput={revision:string;lines:OpeningArLine[]};
const document=(value:unknown):value is OpeningArDocument=>exact(value,['reference','sha256'])&&
 financeAccountReviewReason(value.reference)&&[...value.reference].length<=200&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
const positiveCents=(value:unknown):value is string=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value);
const identity=(value:unknown):value is string=>financeAccountReviewReason(value)&&[...value].length<=200;
export function requireOpeningAr(value:unknown):asserts value{
 if(!value)throw Error('OPENING_RECEIVABLES_EVIDENCE_REQUIRED');
}
function reduction(value:unknown):value is OpeningArReduction{
 return exact(value,['kind','amountCents','appliedOn','evidence'])&&(value.kind==='payment'||value.kind==='credit')&&
  positiveCents(value.amountCents)&&customerDate(value.appliedOn)&&document(value.evidence);
}
export function parseOpeningArInput(value:unknown):OpeningArInput{
 requireOpeningAr(exact(value,['revision','lines'])&&customerVersion(value.revision)&&Array.isArray(value.lines)
  &&value.lines.length>=1&&value.lines.length<=20);
 const unique=new Set<string>();
 for(const row of value.lines as unknown[]){
  requireOpeningAr(exact(row,['customerId','legacyReference','scope','chargedOn','originalDueOn','originalCents','remainingCents','chargeEvidence','reductions','taxEvidence'])
   &&customerUuid(row.customerId)&&identity(row.legacyReference)&&financeAccountReviewReason(row.scope)
   &&customerDate(row.chargedOn)&&customerDate(row.originalDueOn)
   &&positiveCents(row.originalCents)&&positiveCents(row.remainingCents)&&document(row.chargeEvidence)
   &&(row.taxEvidence===null||document(row.taxEvidence))&&Array.isArray(row.reductions)&&row.reductions.length<=20&&row.reductions.every(reduction));
  // A reference is qualified by its prior source document. Different
  // customers cannot claim the same source's legacy item in this worksheet.
  const reference=JSON.stringify([row.chargeEvidence.sha256,row.legacyReference]);
  requireOpeningAr(!unique.has(reference));
  unique.add(reference);
  const allocated=new Set<string>();
  let reduced=0n;
  for(const item of row.reductions){
   const source=JSON.stringify([item.evidence.sha256,item.evidence.reference]);
   requireOpeningAr(item.appliedOn>=row.chargedOn&&!allocated.has(source));
   allocated.add(source);
   reduced+=BigInt(item.amountCents);
  }
  requireOpeningAr(BigInt(row.originalCents)-reduced===BigInt(row.remainingCents));
 }
 return value as OpeningArInput;
}
export function previewOpeningReceivables(input:OpeningArInput,cutoverOn:string){
 requireOpeningAr(customerDate(cutoverOn));
 requireOpeningAr(input.lines.every(row=>row.chargedOn<cutoverOn&&row.reductions.every(event=>event.appliedOn<cutoverOn)));
 return {
  schemaVersion:1,revision:input.revision,cutoverOn,state:'evidence_preview',posted:false,currency:'USD',
  totals:{remainingCents:input.lines.reduce((sum,row)=>sum+BigInt(row.remainingCents),0n).toString()},
  lines:input.lines.map(row=>({...row,taxReview:row.taxEvidence===null?'unknown':'source_recorded'})),
 } as const;
}

export function verifyOpeningArPreview(value:unknown,input:OpeningArInput){
 requireOpeningAr(value!==null&&typeof value==='object'&&'cutoverOn' in value&&customerDate(value.cutoverOn));
 const expected=previewOpeningReceivables(input,value.cutoverOn);
 requireOpeningAr(historyJsonEqual(parseHistoryJson(JSON.stringify(value)),parseHistoryJson(JSON.stringify(expected))));
 return expected;
}
