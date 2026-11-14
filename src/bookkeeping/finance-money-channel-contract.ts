import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountCode,financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';

export const moneyChannelKinds={bank:'Bank account',wallet:'Payment wallet',cash:'Physical cash',checks:'Undeposited checks'} as const;
export const moneyChannelScopes={
 dedicated_business:'Dedicated business account',physical_business_cash:'Business cash',check_custody:'Check custody',
 mixed_personal:'Business funds held by owner',
} as const;
export const moneyChannelOpeningStates={
 unknown:'Opening unknown',verified_zero:'Verified zero opening',verified:'Verified opening amount',
} as const;
export type MoneyChannelKind=keyof typeof moneyChannelKinds;
export type MoneyChannelScope=keyof typeof moneyChannelScopes;
type OpeningState=keyof typeof moneyChannelOpeningStates;

export type MoneyChannelIdentity=Readonly<{accountId:string;kind:MoneyChannelKind;ownershipScope:MoneyChannelScope;
 providerNamespace:string|null;maskedSuffix:string|null}>;
export type MoneyChannelDraft=Readonly<{identity:MoneyChannelIdentity|null;label:string;effectiveFrom:string;
 ownershipEvidence:string|null;openingState:OpeningState;openingOn:string|null;openingCents:string|null;
 openingEvidence:string|null;active:boolean;reason:string}>;
export type MoneyChannelReference=Readonly<{operationId:string;recoveryEpoch:string;channelId:string;expectedVersion:string}>;
export type MoneyChannel=Readonly<MoneyChannelIdentity&Omit<MoneyChannelDraft,'identity'>&{
 schemaVersion:1;businessId:string;channelId:string;ownerActorId:string;version:string;auditEventId:string;
}>;

const identityFields=['accountId','kind','ownershipScope','providerNamespace','maskedSuffix'] as const;
const detailsFields=['label','effectiveFrom','ownershipEvidence','openingState','openingOn','openingCents','openingEvidence','active','reason'] as const;
const snapshotFields=['schemaVersion','businessId','channelId','ownerActorId','version','auditEventId',...identityFields,...detailsFields] as const;
const minCents=-(2n**63n),maxCents=2n**63n-1n;
const providerPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const maskedPattern=/^[A-Z0-9]{4}$/;

export function moneyChannelKind(value:unknown):value is MoneyChannelKind{
 return typeof value==='string'&&Object.hasOwn(moneyChannelKinds,value);
}
export function moneyChannelScope(kind:MoneyChannelKind,value:unknown):value is MoneyChannelScope{
 if(value==='mixed_personal')return kind!=='checks';
 if(kind==='bank'||kind==='wallet')return value==='dedicated_business';
 return kind==='cash'?value==='physical_business_cash':value==='check_custody';
}
export function moneyChannelCents(value:unknown):value is string{
 return typeof value==='string'&&/^(0|-?[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)>=minCents&&BigInt(value)<=maxCents;
}
function validIdentity(value:Record<string,unknown>){
 return customerUuid(value.accountId)&&moneyChannelKind(value.kind)&&moneyChannelScope(value.kind,value.ownershipScope)
  &&(value.kind==='bank'||value.kind==='wallet'
   ?typeof value.providerNamespace==='string'&&providerPattern.test(value.providerNamespace)
    &&typeof value.maskedSuffix==='string'&&maskedPattern.test(value.maskedSuffix)
   :value.providerNamespace===null&&value.maskedSuffix===null);
}
function validDetails(value:Record<string,unknown>,scope?:MoneyChannelScope){
 if(!financeAccountReviewReason(value.label)||[...value.label].length>200||!customerDate(value.effectiveFrom)
  ||!(value.ownershipEvidence===null||financeAccountReviewReason(value.ownershipEvidence))
  ||typeof value.active!=='boolean'||!financeAccountReviewReason(value.reason))return false;
 if(value.openingState==='unknown')return value.openingOn===null&&value.openingCents===null&&value.openingEvidence===null;
 return (value.openingState==='verified'||value.openingState==='verified_zero')
  &&value.ownershipEvidence!==null&&customerDate(value.openingOn)&&moneyChannelCents(value.openingCents)
  &&financeAccountReviewReason(value.openingEvidence)&&(value.openingState==='verified_zero')===(value.openingCents==='0')
  &&(scope===undefined||scope==='dedicated_business'||!value.openingCents.startsWith('-'));
}
export function parseMoneyChannelReference(value:unknown):MoneyChannelReference{
 check(exact(value,['operationId','recoveryEpoch','channelId','expectedVersion'])&&customerUuid(value.operationId)
  &&customerUuid(value.recoveryEpoch)&&customerUuid(value.channelId)&&customerVersion(value.expectedVersion,true)
  &&BigInt(value.expectedVersion)<maxCents);
 return Object.freeze(value) as MoneyChannelReference;
}
export function parseMoneyChannelDraft(value:unknown,expectedVersion:string):MoneyChannelDraft{
 check(exact(value,['identity',...detailsFields]));
 const identity=value.identity;
 check(expectedVersion==='0'?exact(identity,identityFields)&&validIdentity(identity):identity===null);
 check(validDetails(value,identity===null?undefined:(identity as MoneyChannelIdentity).ownershipScope));
 return Object.freeze(value) as MoneyChannelDraft;
}
export function parseMoneyChannel(value:unknown,businessId:string):MoneyChannel{
 check(exact(value,snapshotFields)&&value.schemaVersion===1&&value.businessId===businessId
  &&customerUuid(value.channelId)&&customerUuid(value.ownerActorId)&&customerVersion(value.version)
  &&customerUuid(value.auditEventId)&&validIdentity(value)&&validDetails(value,value.ownershipScope as MoneyChannelScope));
 return Object.freeze(value) as MoneyChannel;
}
export function moneyChannelReceiptMatches(receipt:MoneyChannel,draft:MoneyChannelDraft){
 return detailsFields.every(key=>receipt[key]===draft[key])
  &&(draft.identity===null||identityFields.every(key=>receipt[key]===draft.identity?.[key]));
}
export function parseMoneyChannelOperation(value:unknown,businessId:string,reference:MoneyChannelReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
  return {state:'conflict',reason:'operation'} as const;
 if(exact(value,['state','receipt'])&&value.state==='committed'){
  const receipt=parseMoneyChannel(value.receipt,businessId);
  check(receipt.channelId===reference.channelId&&receipt.version===String(BigInt(reference.expectedVersion)+1n));
  return {state:'committed',receipt} as const;
 }
 check(exact(value,['schemaVersion','state','operationId','recoveryEpoch','receipt'])&&value.schemaVersion===1
  &&value.state==='retired'&&value.operationId===reference.operationId&&value.recoveryEpoch===reference.recoveryEpoch);
 const receipt=value.receipt;
 check(exact(receipt,['schemaVersion','businessId','channelId','expectedVersion','auditEventId','reviewEpoch'])
  &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.channelId===reference.channelId
  &&receipt.expectedVersion===reference.expectedVersion&&customerUuid(receipt.auditEventId)&&customerUuid(receipt.reviewEpoch));
 return {state:'retired',reviewEpoch:receipt.reviewEpoch} as const;
}
export function parseMoneyChannelPage(value:unknown,businessId:string,after:string|null){
 check(exact(value,['schemaVersion','businessId','rows','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId
  &&Array.isArray(value.rows)&&value.rows.length<=25&&typeof value.hasMore==='boolean'&&(!value.hasMore||value.rows.length===25));
 const rows=value.rows.map(row=>{
  check(exact(row,[...snapshotFields,'accountCode'])&&financeAccountCode(row.accountCode));
  const {accountCode,...snapshot}=row;
  return {...parseMoneyChannel(snapshot,businessId),accountCode};
 });
 let last=after;
 for(const row of rows){check(last===null||row.channelId>last);last=row.channelId;}
 return {rows,hasMore:value.hasMore};
}
export function parseMoneyChannelHistory(value:unknown,businessId:string,channelId:string,before:string|null){
 check(exact(value,['schemaVersion','businessId','channelId','rows','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId
  &&value.channelId===channelId&&Array.isArray(value.rows)&&value.rows.length<=25&&typeof value.hasMore==='boolean'
  &&(!value.hasMore||value.rows.length===25));
 const rows=value.rows.map(row=>parseMoneyChannel(row,businessId));
 let previous=before===null?null:BigInt(before),previousDate:string|null=null;
 const current=rows[0];
 for(const row of rows){
  const version=BigInt(row.version);
  check(row.channelId===channelId&&row.ownerActorId===current?.ownerActorId&&identityFields.every(key=>row[key]===current?.[key])
   &&(previous===null||version===previous-1n)&&(previousDate===null||row.effectiveFrom<previousDate));
  previous=version;previousDate=row.effectiveFrom;
 }
 check(new Set(rows.map(row=>row.auditEventId)).size===rows.length
  &&(rows.length?((previous===1n)===!value.hasMore):(!value.hasMore&&(before===null||before==='1'))));
 return {rows,hasMore:value.hasMore};
}
export function parseMoneyChannelAccounts(value:unknown,businessId:string,kind:MoneyChannelKind,scope:MoneyChannelScope){
 check(exact(value,['schemaVersion','businessId','kind','ownershipScope','rows','hasMore'])&&value.schemaVersion===1
  &&value.businessId===businessId&&value.kind===kind&&value.ownershipScope===scope&&Array.isArray(value.rows)
  &&value.rows.length<=25&&typeof value.hasMore==='boolean'&&(!value.hasMore||value.rows.length===25));
 const rows=value.rows.map(row=>{
  check(exact(row,['id','code','name'])&&customerUuid(row.id)&&financeAccountCode(row.code)
   &&financeAccountReviewReason(row.name)&&[...row.name].length<=200);
  return {id:row.id,code:row.code,name:row.name};
 });
 check(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.code)).size===rows.length);
 return {rows,hasMore:value.hasMore};
}
