import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {calculateInclusiveFinanceCharge,isFinanceCents,isFinanceDecimalRate} from './finance-inclusive-charge.ts';
export {isFinanceCents as financeTaxCents} from './finance-inclusive-charge.ts';

export type FinanceTaxScope=Readonly<{jurisdiction:string}&(
 {applicability:'service';serviceId:string}|{applicability:'tip';serviceId:null}
)>;

export const financeTaxTreatmentLabels={
 unresolved:'Unresolved',
 non_taxable:'Verified non-taxable',
 exempt:'Verified exemption policy',
 inclusive_single:'Verified inclusive rate'
} as const;
type Treatment=keyof typeof financeTaxTreatmentLabels;
type Profile=Readonly<FinanceTaxScope&{
 schemaVersion:1;id:string;businessId:string;version:string;effectiveFrom:string;treatment:Treatment;
 rate:string|null;verificationEvidence:string|null;reason:string;synthetic:true;reviewedBy:string;auditEventId:string;
}>;

const scopeFields=['jurisdiction','applicability','serviceId'] as const;
const profileFields=['schemaVersion','id','businessId',...scopeFields,'version','effectiveFrom','treatment','rate',
 'verificationEvidence','reason','synthetic','reviewedBy','auditEventId'] as const;
const componentFields=['grossInclusiveCents','discountInclusiveCents','inclusiveCents','grossNetCents','netCents',
 'taxCents','discountNetCents'] as const;
const maxCents=9223372036854775807n;

export function parseFinanceTaxScope(value:unknown):FinanceTaxScope {
 check(exact(value,scopeFields)&&financeAccountReviewReason(value.jurisdiction)&&[...value.jurisdiction].length<=200
  &&(value.applicability==='tip'&&value.serviceId===null||value.applicability==='service'&&customerUuid(value.serviceId)));
 return Object.freeze(value) as FinanceTaxScope;
}

function matchesScope(value:Record<string,unknown>,scope:FinanceTaxScope) {
 return value.jurisdiction===scope.jurisdiction&&value.applicability===scope.applicability&&value.serviceId===scope.serviceId;
}

function profile(value:unknown,businessId:string,scope:FinanceTaxScope):Profile {
 check(exact(value,profileFields)&&value.schemaVersion===1&&value.businessId===businessId&&matchesScope(value,scope)
  &&customerUuid(value.id)&&customerVersion(value.version)&&customerDate(value.effectiveFrom)
  &&financeAccountReviewReason(value.reason)&&value.synthetic===true&&customerUuid(value.reviewedBy)&&customerUuid(value.auditEventId)
  &&validTreatment(value));
 return Object.freeze(value) as Profile;
}

export type FinanceTaxReference=Readonly<{operationId:string;recoveryEpoch:string;expectedVersion:string}>;
export type FinanceTaxApproval=Readonly<FinanceTaxScope&{
 effectiveFrom:string;treatment:Treatment;rate:string|null;verificationEvidence:string|null;reason:string;
}>;

function validTreatment(value:Record<string,unknown>){
 return typeof value.treatment==='string'&&Object.hasOwn(financeTaxTreatmentLabels,value.treatment)
  &&(value.treatment==='unresolved'?value.verificationEvidence===null:financeAccountReviewReason(value.verificationEvidence))
  &&(value.treatment==='inclusive_single'?isFinanceDecimalRate(value.rate)&&value.rate!=='0':value.rate===null);
}

export function parseFinanceTaxReference(value:unknown):FinanceTaxReference {
 check(exact(value,['operationId','recoveryEpoch','expectedVersion'])&&customerUuid(value.operationId)
  &&customerUuid(value.recoveryEpoch)&&customerVersion(value.expectedVersion,true)&&BigInt(value.expectedVersion)<maxCents);
 return Object.freeze(value) as FinanceTaxReference;
}

export function parseFinanceTaxApproval(value:unknown):FinanceTaxApproval {
 check(exact(value,[...scopeFields,'effectiveFrom','treatment','rate','verificationEvidence','reason'])
  &&customerDate(value.effectiveFrom)&&financeAccountReviewReason(value.reason)&&validTreatment(value));
 parseFinanceTaxScope({jurisdiction:value.jurisdiction,applicability:value.applicability,serviceId:value.serviceId});
 return Object.freeze(value) as FinanceTaxApproval;
}

export function parseFinanceTaxOperation(value:unknown,businessId:string,reference:FinanceTaxReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
  return {state:'conflict',reason:'operation'} as const;
 if(exact(value,['state','receipt'])&&value.state==='committed'){
  const receipt=value.receipt;
  check(exact(receipt,profileFields));
  const scope=parseFinanceTaxScope({jurisdiction:receipt.jurisdiction,applicability:receipt.applicability,serviceId:receipt.serviceId});
  const saved=profile(receipt,businessId,scope);
  check(saved.version===String(BigInt(reference.expectedVersion)+1n));
  return {state:'committed',receipt:saved} as const;
 }
 check(exact(value,['schemaVersion','state','operationId','recoveryEpoch','receipt'])&&value.schemaVersion===1
  &&value.state==='retired'&&value.operationId===reference.operationId&&value.recoveryEpoch===reference.recoveryEpoch);
 const receipt=value.receipt;
 check(exact(receipt,['schemaVersion','businessId','expectedVersion','auditEventId','reviewEpoch'])&&receipt.schemaVersion===1
  &&receipt.businessId===businessId&&receipt.expectedVersion===reference.expectedVersion
  &&customerUuid(receipt.auditEventId)&&customerUuid(receipt.reviewEpoch));
 return {state:'retired',receipt:Object.freeze(receipt)} as const;
}

export function matchesFinanceTaxApproval(saved:Profile,approval:FinanceTaxApproval){
 return matchesScope(saved,approval)&&saved.effectiveFrom===approval.effectiveFrom&&saved.treatment===approval.treatment
  &&saved.rate===approval.rate&&saved.verificationEvidence===approval.verificationEvidence&&saved.reason===approval.reason;
}

export function parseFinanceTaxHistory(value:unknown,businessId:string,scope:FinanceTaxScope,before:string|null) {
 check(exact(value,['schemaVersion','businessId',...scopeFields,'hasMore','rows'])&&value.schemaVersion===1
  &&value.businessId===businessId&&matchesScope(value,scope)&&typeof value.hasMore==='boolean'
  &&Array.isArray(value.rows)&&value.rows.length<=25&&(!value.hasMore||value.rows.length===25));
 const rows=value.rows.map(row=>profile(row,businessId,scope));
 let priorVersion=before===null?null:BigInt(before),priorDate:string|null=null;
 for(const row of rows){
  const version=BigInt(row.version);
  check((priorVersion===null||version===priorVersion-1n)&&(priorDate===null||row.effectiveFrom<priorDate));
  priorVersion=version;priorDate=row.effectiveFrom;
 }
 check(new Set(rows.map(row=>row.id)).size===rows.length
  &&new Set(rows.map(row=>row.auditEventId)).size===rows.length
  &&(rows.length?((priorVersion===1n)===!value.hasMore):(!value.hasMore&&(before===null||before==='1'))));
 return {rows,hasMore:value.hasMore};
}

export function parseFinanceTaxPreview(value:unknown,businessId:string,scope:FinanceTaxScope,date:string,gross:string,discount:string) {
 if(exact(value,['state','profile'])){
  const found=value.profile===null?null:profile(value.profile,businessId,scope);
  check(found===null||found.effectiveFrom<=date);
  if(value.state==='unresolved'&&(found===null||found.treatment==='unresolved'))return {state:'unresolved',profile:found} as const;
  check(value.state==='exemption_review_required'&&found?.treatment==='exempt');
  return {state:'exemption_review_required',profile:found} as const;
 }
 check(exact(value,['state','profile','components'])&&value.state==='ready'&&exact(value.components,componentFields));
 const found=profile(value.profile,businessId,scope),components=value.components;
 check(found.effectiveFrom<=date&&(found.treatment==='inclusive_single'||found.treatment==='non_taxable'));
 check(componentFields.every(key=>isFinanceCents(components[key])));
 const strings=components as Record<typeof componentFields[number],string>;
 const expected=calculateInclusiveFinanceCharge(gross,discount,found.rate??'0');
 check(componentFields.every(key=>strings[key]===expected[key]));
 return {state:'ready',profile:found,components:Object.freeze(strings)} as const;
}
