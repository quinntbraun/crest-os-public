import {authentication} from './authentication';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {
 parseFinanceAccountHistory,parseFinanceAccountPage,parseFinanceAccountReceipt,
 parseFinanceAccountReference,parseFinanceAccountResolution,financeAccountReviewReason,requireFinanceAccount as check,
} from '../bookkeeping/finance-account-contract';
import type {FinanceAccountDraft,FinanceAccountReference} from '../bookkeeping/finance-account-contract';
import {parseFinanceMappingAt,parseFinanceMappingEditor,parseFinanceMappingHistory,parseFinanceMappingOperation,parseFinanceMappingReference} from '../bookkeeping/finance-mapping-contract';
import type {FinanceMappingApproval,FinanceMappingReference,FixedFinanceMappingPurpose} from '../bookkeeping/finance-mapping-contract';

export type FinanceAccountContext=Readonly<{businessId:string;recoveryEpoch:string|null;writeState:'ready'|'paused';binding:string;fixedMappings:boolean}>;
const bindingPattern=/^[A-Za-z0-9_-]{43}$/;
const knownFailure=['RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SIGN_IN_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED'] as const;
const pendingKey='crest.finance-account.pending-reference.v1';
type Pending=Readonly<{businessId:string;binding:string;reference:FinanceAccountReference}>;
const mappingPendingKey='crest.finance-mapping.pending-reference.v1';
type MappingPending=Readonly<{businessId:string;binding:string;reference:FinanceMappingReference}>;
const mappingFailure=[...knownFailure,'FINANCE_MAPPING_VERSION_CONFLICT','FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED',
 'FINANCE_MAPPING_ACCOUNT_REQUIRED','FINANCE_MAPPING_CLOSURE_REQUIRED'] as const;

async function post(route:string,body:object,signal:AbortSignal,binding?:string){
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(40000)]),proof=await authentication.session(bounded);
 check(!bounded.aborted&&bindingPattern.test(proof.csrfToken)&&proof.expiresAt>Date.now());
 const response=await fetch('/api/business/finance-accounts/'+route,{
  method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
  headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken,...(binding?{'x-crest-edit-binding':binding}:{})},
  body:JSON.stringify(body),signal:bounded,
 });
 check(response.headers.get('cache-control')?.includes('no-store')
  &&/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''));
 const reader=response.body?.getReader();check(reader);
 const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   bytes+=part.value.byteLength;check(bytes<=196608&&!bounded.aborted);
   text+=decoder.decode(part.value,{stream:true});
  }
  text+=decoder.decode();
 }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
 return {status:response.status,value:JSON.parse(text) as unknown,binding:response.headers.get('x-crest-edit-binding'),
  fixedMappings:response.headers.get('x-crest-finance-fixed-mappings')==='1'};
}

export const financeAccounts={
 async context(signal:AbortSignal):Promise<FinanceAccountContext>{
  const {status,value,binding,fixedMappings}=await post('context',{},signal);
  check(status===200&&binding&&bindingPattern.test(binding)&&exact(value,['businessId','recoveryEpoch','writeState'])
   &&customerUuid(value.businessId)&&(value.writeState==='ready'&&customerUuid(value.recoveryEpoch)
    ||value.writeState==='paused'&&value.recoveryEpoch===null));
  return Object.freeze({...value,binding,fixedMappings}) as FinanceAccountContext;
 },
 async mappingAt(context:FinanceAccountContext,purpose:FixedFinanceMappingPurpose,date:string,signal:AbortSignal){
  check(context.fixedMappings);
  const {status,value}=await post('mapping-at',{purpose,date},signal,context.binding);
  check(status===200);return parseFinanceMappingAt(value,purpose,date);
 },
 async mappingHistory(context:FinanceAccountContext,purpose:FixedFinanceMappingPurpose,beforeVersion:string|null,signal:AbortSignal){
  check(context.fixedMappings);
  const {status,value}=await post('mapping-history',{purpose,beforeVersion},signal,context.binding);
  check(status===200);return parseFinanceMappingHistory(value,context.businessId,purpose,beforeVersion);
 },
 async mappingEditor(context:FinanceAccountContext,purpose:FixedFinanceMappingPurpose,signal:AbortSignal){
  check(context.fixedMappings);
  const {status,value}=await post('mapping-editor',{purpose},signal,context.binding);
  check(status===200);return parseFinanceMappingEditor(value,context.businessId,purpose);
 },
 async mappingOperation(context:FinanceAccountContext,reference:FinanceMappingReference,signal:AbortSignal){
  check(context.fixedMappings);
  const {status,value}=await post('mapping-operation',reference,signal,context.binding);
  check(status===200);return parseFinanceMappingOperation(value,context.businessId,reference);
 },
 async approveMapping(context:FinanceAccountContext,reference:FinanceMappingReference,approval:FinanceMappingApproval,signal:AbortSignal){
  check(context.fixedMappings&&context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('mapping-approve',{reference,approval},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const reason=mappingFailure.find(code=>code===value.error);check(reason);
   return {state:'rejected',reason} as const;
  }
  const result=parseFinanceMappingOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&result.state==='committed'
   &&result.receipt.accountId===approval.accountId&&result.receipt.effectiveFrom===approval.effectiveFrom
   &&result.receipt.reason===approval.reason);
  return result;
 },
 async retireMappingApproval(context:FinanceAccountContext,reference:FinanceMappingReference,reason:string,signal:AbortSignal){
  check(context.fixedMappings&&context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('mapping-retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected',reason:failure} as const;
  }
  const result=parseFinanceMappingOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&(result.state==='committed'
   ||result.state==='retired'&&result.reviewEpoch===context.recoveryEpoch));
  return result;
 },
 async list(context:FinanceAccountContext,afterCode:string|null,includeArchived:boolean,signal:AbortSignal){
  const result=await post('list',{afterCode,includeArchived},signal,context.binding);
  check(result.status===200);return parseFinanceAccountPage(result.value,context.businessId);
 },
 async history(context:FinanceAccountContext,accountId:string,afterVersion:string,signal:AbortSignal){
  const result=await post('history',{accountId,afterVersion},signal,context.binding);
  check(result.status===200);return parseFinanceAccountHistory(result.value,context.businessId,accountId,afterVersion);
 },
 async lookup(context:FinanceAccountContext,reference:FinanceAccountReference,signal:AbortSignal){
  const result=await post('operation',reference,signal,context.binding);
  check(result.status===200);
  return parseFinanceAccountResolution(result.value,context.businessId,reference);
 },
 async retire(context:FinanceAccountContext,reference:FinanceAccountReference,reason:string,signal:AbortSignal){
  check(context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected' as const,reason:failure};
  }
  const decision=parseFinanceAccountResolution(value,context.businessId,reference);
  check(decision.state!=='absent'&&status===(decision.state==='conflict'?409:200)
   &&(decision.state!=='retired'||decision.receipt.reviewEpoch===context.recoveryEpoch));
  return decision;
 },
 async save(context:FinanceAccountContext,reference:FinanceAccountReference,draft:FinanceAccountDraft,signal:AbortSignal){
  check(context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('save',{reference,draft},signal,context.binding);
  if(status===409){
   if(exact(value,['error'])){
    const failure=knownFailure.find(code=>code===value.error);check(failure);
    return {state:'rejected' as const,reason:failure};
   }
   if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='account'||value.reason==='operation'))
    return {state:'conflict' as const,reason:value.reason};
   if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version')
    return {state:'conflict' as const,reason:'version' as const};
  }
  check(status===200);return parseFinanceAccountReceipt(value,context.businessId,reference);
 },
};

// Only opaque references cross a page reload. Name, account details, and draft
// remain in memory. An absent lookup does not establish that a write failed.
export function readPendingFinanceAccount():Pending|null{
 const raw=sessionStorage.getItem(pendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseFinanceAccountReference(value.reference)};
}
export function retainPendingFinanceAccount(context:FinanceAccountContext,reference:FinanceAccountReference):Pending{
 check(readPendingFinanceAccount()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(pendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFinanceAccount())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFinanceAccount(entry:Pending){
 check(JSON.stringify(readPendingFinanceAccount())===JSON.stringify(entry));
 sessionStorage.removeItem(pendingKey);
 check(readPendingFinanceAccount()===null);
}

// The saved approval body and review reason stay in memory only.
export function readPendingFinanceMapping():MappingPending|null{
 const raw=sessionStorage.getItem(mappingPendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseFinanceMappingReference(value.reference)};
}
export function retainPendingFinanceMapping(context:FinanceAccountContext,reference:FinanceMappingReference):MappingPending{
 check(readPendingFinanceMapping()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(mappingPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFinanceMapping())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFinanceMapping(entry:MappingPending){
 check(JSON.stringify(readPendingFinanceMapping())===JSON.stringify(entry));
 sessionStorage.removeItem(mappingPendingKey);
 check(readPendingFinanceMapping()===null);
}

export function downloadFinanceHistory(filename:string,rows:readonly (readonly string[])[]){
 const csv=(value:string)=>{
  const escaped=/^[=+\-@']/.test(value.trimStart())?"'"+value:value;
  return '"'+escaped.replaceAll('"','""')+'"';
 };
 const data=rows.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download=filename;link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
