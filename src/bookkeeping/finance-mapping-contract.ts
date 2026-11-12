import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountCode,financeAccountReviewReason,parseFinanceAccountIdentity,requireFinanceAccount as check} from './finance-account-contract.ts';

export const fixedFinanceMappingLabels={
 service_revenue:'Detailing service revenue',tips_revenue:'Tip revenue',discount:'Service discounts',returns:'Service returns',
 ar:'Accounts receivable',other_receivable:'Other documented receivables',customer_funds:'Customer funds held',
 cash:'Cash on hand',checks:'Undeposited checks',transfer_transit:'Transfers in transit',fee:'Payment and bank fees',
 owner_contribution:'Owner contributions',owner_draw:'Owner distributions',opening_equity:'Opening equity',
 payable:'Accounts payable',due_owner:'Amounts due to owner',purchase_tax_recoverable:'Recoverable purchase tax',
 fixed_asset:'Equipment at cost',accumulated_depreciation:'Accumulated depreciation',depreciation_expense:'Depreciation expense',
 disposal_gain:'Gain on asset disposal',disposal_loss:'Loss on asset disposal',prepaid:'Prepaid business costs',
 suspense_outflow:'Unresolved outflow clearing',unidentified_inflow:'Unidentified incoming funds',
} as const;
export type FixedFinanceMappingPurpose=keyof typeof fixedFinanceMappingLabels;
export const fixedFinanceMappingPurpose=(value:unknown):value is FixedFinanceMappingPurpose=>
 typeof value==='string'&&Object.hasOwn(fixedFinanceMappingLabels,value);

type Snapshot=Readonly<{schemaVersion:1;id:string;purpose:FixedFinanceMappingPurpose;version:string;accountId:string|null;
 effectiveFrom:string;reason:string;auditEventId:string}>;
type Revision=Readonly<Snapshot&{accountCode:string|null}>;
export type FinanceMappingReference=Readonly<{operationId:string;recoveryEpoch:string;
 purpose:FixedFinanceMappingPurpose;expectedVersion:string}>;
export type FinanceMappingApproval=Readonly<{accountId:string|null;effectiveFrom:string;reason:string}>;
export type FinanceMappingEditorData=Readonly<{
 purpose:FixedFinanceMappingPurpose;
 latest:Readonly<{version:string;accountId:string|null;effectiveFrom:string}>|null;
 eligible:Readonly<{id:string;code:string;name:string}>|null;
}>;
const snapshotFields=['schemaVersion','id','purpose','version','accountId','effectiveFrom','reason','auditEventId'] as const;
const revisionFields=[...snapshotFields,'accountCode'] as const;
const detailFields=['effectiveUntil','accountType','normalSide','controlKind','reportRole','currency'] as const;
function snapshot(value:unknown,purpose:FixedFinanceMappingPurpose):Snapshot{
 check(exact(value,snapshotFields)&&value.schemaVersion===1&&value.purpose===purpose
  &&customerUuid(value.id)&&customerVersion(value.version)&&customerDate(value.effectiveFrom)
  &&financeAccountReviewReason(value.reason)&&customerUuid(value.auditEventId)
  &&(value.accountId===null||customerUuid(value.accountId)));
 return Object.freeze(value) as Snapshot;
}
function revision(value:unknown,purpose:FixedFinanceMappingPurpose):Revision{
 check(exact(value,revisionFields));
 const {accountCode,...base}=value, parsed=snapshot(base,purpose);
 check(parsed.accountId===null?accountCode===null:financeAccountCode(accountCode));
 return Object.freeze({...parsed,accountCode}) as Revision;
}
export function parseFinanceMappingReference(value:unknown):FinanceMappingReference{
 check(exact(value,['operationId','recoveryEpoch','purpose','expectedVersion'])
  &&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch)&&fixedFinanceMappingPurpose(value.purpose)
  &&customerVersion(value.expectedVersion,true)&&BigInt(value.expectedVersion)<9_223_372_036_854_775_807n);
 return Object.freeze(value) as FinanceMappingReference;
}
export function parseFinanceMappingApproval(value:unknown):FinanceMappingApproval{
 check(exact(value,['accountId','effectiveFrom','reason'])&&(value.accountId===null||customerUuid(value.accountId))
  &&customerDate(value.effectiveFrom)&&financeAccountReviewReason(value.reason));
 return Object.freeze(value) as FinanceMappingApproval;
}
export function parseFinanceMappingEditor(value:unknown,businessId:string,purpose:FixedFinanceMappingPurpose):FinanceMappingEditorData{
 check(exact(value,['schemaVersion','businessId','purpose','latest','eligible'])&&value.schemaVersion===1
  &&value.businessId===businessId&&value.purpose===purpose);
 const {latest,eligible}=value;
 check(latest===null||exact(latest,['version','accountId','effectiveFrom'])&&customerVersion(latest.version)
  &&(latest.accountId===null||customerUuid(latest.accountId))&&customerDate(latest.effectiveFrom));
 check(eligible===null||exact(eligible,['id','code','name'])&&customerUuid(eligible.id)&&financeAccountCode(eligible.code)
  &&financeAccountReviewReason(eligible.name)&&[...eligible.name].length<=200);
 return {purpose,latest,eligible} as FinanceMappingEditorData;
}
export function parseFinanceMappingOperation(value:unknown,businessId:string,reference:FinanceMappingReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
  return {state:'conflict',reason:'operation'} as const;
 if(exact(value,['state','receipt'])&&value.state==='committed'){
  const receipt=snapshot(value.receipt,reference.purpose);
  check(receipt.version===String(BigInt(reference.expectedVersion)+1n));
  return {state:'committed',receipt} as const;
 }
 check(exact(value,['schemaVersion','state','operationId','recoveryEpoch','receipt'])&&value.schemaVersion===1
  &&value.state==='retired'&&value.operationId===reference.operationId&&value.recoveryEpoch===reference.recoveryEpoch);
 const receipt=value.receipt;
 check(exact(receipt,['schemaVersion','businessId','purpose','expectedVersion','auditEventId','reviewEpoch'])&&receipt.schemaVersion===1
  &&receipt.businessId===businessId&&receipt.purpose===reference.purpose&&receipt.expectedVersion===reference.expectedVersion
  &&customerUuid(receipt.auditEventId)&&customerUuid(receipt.reviewEpoch));
 return {state:'retired',reviewEpoch:receipt.reviewEpoch} as const;
}
export function parseFinanceMappingHistory(value:unknown,businessId:string,purpose:FixedFinanceMappingPurpose,before:string|null){
 check(exact(value,['schemaVersion','businessId','purpose','rows','hasMore'])&&value.schemaVersion===1
  &&value.businessId===businessId&&value.purpose===purpose&&typeof value.hasMore==='boolean'
  &&Array.isArray(value.rows)&&value.rows.length<=25&&(!value.hasMore||value.rows.length===25));
 const rows=value.rows.map(row=>revision(row,purpose));
 let previous=before===null?null:BigInt(before),previousDate:string|null=null;
 for(const row of rows){
  const version=BigInt(row.version);
  check((previous===null||version===previous-1n)&&(previousDate===null||row.effectiveFrom<previousDate));
  previous=version;previousDate=row.effectiveFrom;
 }
 check(new Set(rows.map(row=>row.id)).size===rows.length
  &&(!rows.length?!value.hasMore&&(before===null||before==='1'):((previous===1n)===!value.hasMore)));
 return {rows,hasMore:value.hasMore};
}
export function parseFinanceMappingAt(value:unknown,purpose:FixedFinanceMappingPurpose,date:string){
 if(exact(value,['state'])&&value.state==='unavailable')return null;
 check(exact(value,[...revisionFields,...detailFields]));
 const {effectiveUntil,accountType,normalSide,controlKind,reportRole,currency,...base}=value;
 const mapping=revision(base,purpose);
 check(mapping.accountId!==null&&mapping.accountCode!==null&&currency==='USD'&&mapping.effectiveFrom<=date
  &&(effectiveUntil===null||customerDate(effectiveUntil)&&date<effectiveUntil));
 const identity=parseFinanceAccountIdentity({code:mapping.accountCode,accountType,normalSide,controlKind,reportRole});
 return {...mapping,...identity,effectiveUntil,currency};
}
