import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,requireCustomer as check} from '../customer/customer-contract';
import {parseLeadConversion} from '../customer/lead-conversion-contract';
import type {LeadConversion} from '../customer/lead-conversion-contract';
import {parseLeadConversionReference,leadConversionToWire,bindLeadConversionReference,bindLeadConversionCommitted,parseLeadConversionConflict,parseLeadConversionRead,parseLeadConversionLinkPage} from '../customer/lead-conversion-command-contract';
import type {LeadConversionReference} from '../customer/lead-conversion-command-contract';
export type {LeadConversionReference};
export type LeadConversionSave=Omit<LeadConversion,'businessId'>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class LeadConversionClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('LEAD_CONVERSION_REQUEST_FAILED');this.name='LeadConversionClientError';this.kind=kind;}}
async function post(route:'convert'|'conversion-operation'|'conversion'|'conversion-links',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
  const response=await fetch('/api/business/leads/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=50000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
  if(exact(value,['error'])){
   const codes:Record<string,readonly[number,Kind]>={LEAD_CONVERSION_NOT_SUBMITTED:[503,'not_submitted'],LEAD_CONVERSION_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],LEAD_REQUEST_LIMITED:[429,'limited'],LEAD_CONVERSION_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
   if(mapped&&response.status===mapped[0])throw new LeadConversionClientError(mapped[1]);throw new Error();
  }
  return {value,status:response.status};
 }catch(error){throw error instanceof LeadConversionClientError?error:new LeadConversionClientError(route==='convert'?'unknown':'unavailable');}
}
// Stateless transport. No generated IDs, storage, automatic lookup/retry or epoch rebasing.
export const leadConversions=Object.freeze({
 async convert(businessId:string,input:LeadConversionSave,proof:Proof,signal:AbortSignal){
  let request:LeadConversion,wire:ReturnType<typeof leadConversionToWire>;
  try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','customer','vehicles','addresses']));request=parseLeadConversion({...input,businessId});wire=leadConversionToWire(request);}catch{throw new LeadConversionClientError('input');}
  const r=await post('convert',wire,proof,signal);
  try{if(r.status===409)return parseLeadConversionConflict(r.value);check(r.status===200);return bindLeadConversionCommitted(r.value,request);}catch{throw new LeadConversionClientError('unknown');}
 },
 async lookup(businessId:string,input:LeadConversionReference,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId));const ref=parseLeadConversionReference(input),r=await post('conversion-operation',{operationId:ref.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):bindLeadConversionReference(r.value,businessId,ref);}catch(error){throw error instanceof LeadConversionClientError?error:new LeadConversionClientError('unavailable');}
 },
 async read(businessId:string,leadId:string,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&uuid(leadId));const r=await post('conversion',{leadId},proof,signal);check(r.status===200);return parseLeadConversionRead(r.value,businessId,leadId);}catch(error){throw error instanceof LeadConversionClientError?error:new LeadConversionClientError('unavailable');}
 },
 async links(businessId:string,input:{leadId:string;conversionId:string;afterId:string|null;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['leadId','conversionId','afterId','pageSize'])&&uuid(input.leadId)&&uuid(input.conversionId)&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const p=Object.freeze({...input}),r=await post('conversion-links',p,proof,signal);check(r.status===200);return parseLeadConversionLinkPage(r.value,businessId,p.leadId,p.conversionId,p.afterId,p.pageSize);}catch(error){throw error instanceof LeadConversionClientError?error:new LeadConversionClientError('unavailable');}
 }
});
