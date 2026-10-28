import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {serviceId,serviceRevision,requireService as check,parseServiceSave,parseServiceDirectoryPage,parseServiceHistoryPage} from '../commercial/service-storage-contract';
import type {ServiceSave} from '../commercial/service-storage-contract';
import {parseServiceOriginalOperation,bindServiceOriginalReceipt} from '../commercial/service-original-operation';
import type {ServiceOriginalOperation} from '../commercial/service-original-operation';
export type ServiceReference=ServiceOriginalOperation['reference'];
export type ServiceContext=Readonly<{schemaVersion:1;businessId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class ServiceClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('SERVICE_REQUEST_FAILED');this.name='ServiceClientError';this.kind=kind;}}
function original(businessId:string,reference:ServiceReference){return parseServiceOriginalOperation({schemaVersion:1,businessId,commandType:'catalog.service.save',reference});}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
  const response=await fetch('/api/business/services/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
  if(exact(value,['error'])){
   const codes:Record<string,readonly[number,Kind]>={SERVICE_SAVE_NOT_SUBMITTED:[503,'not_submitted'],SERVICE_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],SERVICE_REQUEST_LIMITED:[429,'limited'],SERVICE_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
   if(mapped&&response.status===mapped[0])throw new ServiceClientError(mapped[1]);throw new Error();
  }
  return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
 }catch(error){throw error instanceof ServiceClientError?error:new ServiceClientError(route==='save'?'unknown':'unavailable');}
}
// Stateless transport. No operation creation, automatic retry, draft cache,
// current-epoch substitution, or release from a generic recorded observation.
export const services=Object.freeze({
 async context(proof:Proof,signal:AbortSignal){
  try{const r=await post('context',{},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&serviceId(v.businessId)&&(v.writeState==='ready'&&serviceId(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));
   return Object.freeze({context:Object.freeze({...v}) as ServiceContext,binding:r.binding});
  }catch(e){throw e instanceof ServiceClientError?e:new ServiceClientError('unavailable');}
 },
 async save(input:ServiceSave,proof:Proof,signal:AbortSignal){
  let command:ServiceSave;
  try{command=parseServiceSave(input);}catch{throw new ServiceClientError('input');}
  const {businessId,payload,...ref}=command,body={...ref,code:payload.code,active:payload.active,...payload.definition};
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>131072)throw new ServiceClientError('input');
  const r=await post('save',body,proof,signal),v=r.value;
  try{
   if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&['operation','service','code'].includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'service'|'code'});
   if(r.status===409&&exact(v,['state','reason','currentRevision'])&&v.state==='conflict'&&v.reason==='version'&&serviceRevision(v.currentRevision,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentRevision:v.currentRevision});
   check(r.status===200);
   if(exact(v,['state','serviceId','currentRevision'])&&v.state==='unchanged'){check(command.expectedRevision!=='0'&&v.serviceId===command.serviceId&&v.currentRevision===command.expectedRevision);return Object.freeze({state:'unchanged' as const,serviceId:v.serviceId,currentRevision:v.currentRevision});}
   return bindServiceOriginalReceipt(v,original(businessId,{operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,serviceId:command.serviceId,expectedRevision:command.expectedRevision}));
  }catch{throw new ServiceClientError('unknown');}
 },
 async lookup(businessId:string,reference:ServiceReference,proof:Proof,signal:AbortSignal){
  try{const pinned=original(businessId,reference),r=await post('operation',{operationId:pinned.reference.operationId},proof,signal);check(r.status===200);
   return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):bindServiceOriginalReceipt(r.value,pinned);
  }catch(e){throw e instanceof ServiceClientError?e:new ServiceClientError('unavailable');}
 },
 async list(businessId:string,input:{search:string;afterId:string|null;includeInactive:boolean;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(serviceId(businessId)&&exact(input,['search','afterId','includeInactive','pageSize'])&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||serviceId(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);
   const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal);check(r.status===200);return parseServiceDirectoryPage(r.value,{businessId,...pinned});
  }catch(e){throw e instanceof ServiceClientError?e:new ServiceClientError('unavailable');}
 },
 async history(businessId:string,input:{serviceId:string;afterRevision:string;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(serviceId(businessId)&&exact(input,['serviceId','afterRevision','pageSize'])&&serviceId(input.serviceId)&&serviceRevision(input.afterRevision,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);
   const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal);check(r.status===200);return parseServiceHistoryPage(r.value,{businessId,...pinned});
  }catch(e){throw e instanceof ServiceClientError?e:new ServiceClientError('unavailable');}
 }
});
