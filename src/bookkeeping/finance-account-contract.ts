import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract';

export const financeAccountTypes=['asset','liability','equity','revenue','contra_revenue','expense'] as const;
export type FinanceAccountType=typeof financeAccountTypes[number];
export type FinanceAccountIdentity=Readonly<{
 code:string;accountType:FinanceAccountType;normalSide:'debit'|'credit';controlKind:string|null;reportRole:string;
}>;
export type FinanceAccount=Readonly<FinanceAccountIdentity&{
 schemaVersion:1;id:string;currency:'USD';version:string;name:string;active:boolean;
}>;
export type FinanceAccountHistory=Readonly<FinanceAccount&{reason:string|null;auditEventId:string}>;
export type FinanceAccountReference=Readonly<{
 operationId:string;recoveryEpoch:string;accountId:string;expectedVersion:string;
}>;
export type FinanceAccountDraft=Readonly<{identity:FinanceAccountIdentity|null;name:string;active:boolean;reason:string|null}>;
export type FinanceAccountReceipt=Readonly<{
 state:'committed';operationId:string;recoveryEpoch:string;
 receipt:Readonly<{schemaVersion:1;businessId:string;accountId:string;version:string;auditEventId:string}>;
}>;
export type FinanceAccountRetirement=Readonly<{
 schemaVersion:1;state:'retired';operationId:string;recoveryEpoch:string;
 receipt:Readonly<{schemaVersion:1;businessId:string;accountId:string;expectedVersion:string;auditEventId:string;reviewEpoch:string}>;
}>;
const identityFields=['code','accountType','normalSide','controlKind','reportRole'] as const;
const accountFields=['schemaVersion','id','currency','version','name','active',...identityFields] as const;
const role=/^[a-z][a-z0-9_]{0,63}$/;
export function requireFinanceAccount(value:unknown):asserts value{
 if(!value)throw Error('FINANCE_ACCOUNT_REVIEW_REQUIRED');
}
function printable(value:unknown,limit:number):value is string{
 return typeof value==='string'&&value.trim()===value&&[...value].length>=1&&[...value].length<=limit
  &&[...value].every(ch=>{const point=ch.codePointAt(0)!;return point>=32&&(point<127||point>159)&&!(point>=0xd800&&point<=0xdfff);});
}
export const financeAccountCode=(value:unknown):value is string=>printable(value,64);
export const financeAccountReviewReason=(value:unknown):value is string=>printable(value,1000);
export function parseFinanceAccountIdentity(value:unknown):FinanceAccountIdentity{
 requireFinanceAccount(exact(value,identityFields)&&financeAccountCode(value.code)
  &&financeAccountTypes.some(type=>type===value.accountType)
  &&(value.normalSide==='debit'||value.normalSide==='credit')
  &&(value.controlKind===null||typeof value.controlKind==='string'&&role.test(value.controlKind))
  &&typeof value.reportRole==='string'&&role.test(value.reportRole));
 const {accountType:type,normalSide:side,controlKind:control,reportRole:report}=value;
 const expected=report==='contra_asset'?'credit':report==='contra_equity'?'debit':
  type==='asset'||type==='expense'||type==='contra_revenue'?'debit':'credit';
 requireFinanceAccount(side===expected&&(report!=='contra_asset'||type==='asset')&&(report!=='contra_equity'||type==='equity')
  &&(report==='owner_custody')===(control==='owner_custody')&&(report!=='owner_custody'||type==='asset'));
 return Object.freeze(value) as FinanceAccountIdentity;
}
export function parseFinanceAccountReference(value:unknown):FinanceAccountReference{
 requireFinanceAccount(exact(value,['operationId','recoveryEpoch','accountId','expectedVersion'])
  &&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch)&&customerUuid(value.accountId)
  &&customerVersion(value.expectedVersion,true)&&BigInt(value.expectedVersion)<9_223_372_036_854_775_807n);
 return Object.freeze(value) as FinanceAccountReference;
}
export function parseFinanceAccountDraft(value:unknown,expectedVersion:string):FinanceAccountDraft{
 requireFinanceAccount(exact(value,['identity','name','active','reason'])&&printable(value.name,200)&&typeof value.active==='boolean'
  &&(value.reason===null?expectedVersion==='0':printable(value.reason,1000)));
 const identity=expectedVersion==='0'?parseFinanceAccountIdentity(value.identity):null;
 requireFinanceAccount(expectedVersion==='0'||value.identity===null);
 return Object.freeze({identity,name:value.name,active:value.active,reason:value.reason as string|null});
}
export function parseFinanceAccountReceipt(value:unknown,businessId:string,reference:FinanceAccountReference):FinanceAccountReceipt{
 requireFinanceAccount(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'
  &&value.operationId===reference.operationId&&value.recoveryEpoch===reference.recoveryEpoch);
 const receipt=value.receipt;
 requireFinanceAccount(exact(receipt,['schemaVersion','businessId','accountId','version','auditEventId'])
  &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.accountId===reference.accountId
  &&receipt.version===String(BigInt(reference.expectedVersion)+1n)&&customerUuid(receipt.auditEventId));
 return Object.freeze({...value,receipt:Object.freeze(receipt)}) as FinanceAccountReceipt;
}
export function parseFinanceAccountResolution(value:unknown,businessId:string,reference:FinanceAccountReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
  return {state:'conflict',reason:'operation'} as const;
 if(exact(value,['schemaVersion','state','operationId','recoveryEpoch','receipt'])&&value.schemaVersion===1&&value.state==='retired'){
  const receipt=value.receipt;
  requireFinanceAccount(value.operationId===reference.operationId&&value.recoveryEpoch===reference.recoveryEpoch
   &&exact(receipt,['schemaVersion','businessId','accountId','expectedVersion','auditEventId','reviewEpoch'])
   &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.accountId===reference.accountId
   &&receipt.expectedVersion===reference.expectedVersion&&customerUuid(receipt.auditEventId)&&customerUuid(receipt.reviewEpoch));
  return Object.freeze({...value,receipt:Object.freeze(receipt)}) as FinanceAccountRetirement;
 }
 return parseFinanceAccountReceipt(value,businessId,reference);
}
function parseAccount(value:unknown):FinanceAccount{
 requireFinanceAccount(exact(value,accountFields)&&value.schemaVersion===1&&customerUuid(value.id)&&value.currency==='USD'
  &&customerVersion(value.version)&&printable(value.name,200)&&typeof value.active==='boolean');
 parseFinanceAccountIdentity(Object.fromEntries(identityFields.map(field=>[field,value[field]])));
 return Object.freeze(value) as FinanceAccount;
}
export function parseFinanceAccountPage(value:unknown,businessId:string){
 requireFinanceAccount(exact(value,['schemaVersion','businessId','hasMore','rows'])&&value.schemaVersion===1
  &&value.businessId===businessId&&typeof value.hasMore==='boolean'&&Array.isArray(value.rows)&&value.rows.length<=25);
 const rows=value.rows.map(parseAccount);
 requireFinanceAccount(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.code)).size===rows.length
  &&(!value.hasMore||rows.length===25));
 return {rows,hasMore:value.hasMore};
}
export function parseFinanceAccountHistory(value:unknown,businessId:string,accountId:string,afterVersion:string){
 requireFinanceAccount(exact(value,['schemaVersion','businessId','accountId','hasMore','rows'])&&value.schemaVersion===1
  &&value.businessId===businessId&&value.accountId===accountId&&typeof value.hasMore==='boolean'
  &&Array.isArray(value.rows)&&value.rows.length<=25&&(!value.hasMore||value.rows.length===25));
 let previous=BigInt(afterVersion);
 const rows:FinanceAccountHistory[]=value.rows.map(entry=>{
  requireFinanceAccount(exact(entry,[...accountFields,'reason','auditEventId'])&&customerUuid(entry.auditEventId)
   &&(entry.reason===null||printable(entry.reason,1000)));
  const {reason,auditEventId,...account}=entry,row=parseAccount(account);
  requireFinanceAccount(row.id===accountId&&BigInt(row.version)===previous+1n&&(reason!==null||row.version==='1'));
  previous=BigInt(row.version);
  return {...row,reason:reason as string|null,auditEventId};
 });
 return {rows,hasMore:value.hasMore};
}
