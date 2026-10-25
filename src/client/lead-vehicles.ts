import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,requireCustomer as check} from '../customer/customer-contract';
import {parseLeadVehicleSave,parseLeadVehicleCommitted,parseLeadVehiclePage,parseLeadVehicleHistory} from '../customer/lead-vehicle-command-contract';
import type {LeadVehicleDraft} from '../customer/lead-resource-contract';
import {leadVehicleDraftToWire} from '../customer/lead-vehicle-http-contract';
export type LeadVehicleReference=Readonly<{operationId:string;leadId:string;leadVehicleId:string;expectedVersion:string;recoveryEpoch:string}>;
export type LeadVehicleSave=LeadVehicleReference&Readonly<{schemaVersion:1;draft:LeadVehicleDraft}>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class LeadVehicleClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('LEAD_VEHICLE_REQUEST_FAILED');this.name='LeadVehicleClientError';this.kind=kind;}}
function reference(value:unknown):value is LeadVehicleReference{
 return exact(value,['operationId','leadId','leadVehicleId','expectedVersion','recoveryEpoch'])&&uuid(value.operationId)&&uuid(value.leadId)&&uuid(value.leadVehicleId)&&version(value.expectedVersion,true)&&uuid(value.recoveryEpoch);
}
function committed(value:unknown,businessId:string,ref:LeadVehicleReference){
 const result=parseLeadVehicleCommitted(value,businessId,ref.operationId);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.leadId===ref.leadId&&result.receipt.leadVehicleId===ref.leadVehicleId&&BigInt(result.receipt.leadVehicleVersion)===BigInt(ref.expectedVersion)+1n);return result;
}
async function post(route:'vehicle-save'|'vehicle-operation'|'vehicle-list'|'vehicle-history',body:object,proof:Proof,external:AbortSignal){
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
  while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
  if(exact(value,['error'])){
   const codes:Record<string,readonly[number,Kind]>={LEAD_VEHICLE_NOT_SUBMITTED:[503,'not_submitted'],LEAD_VEHICLE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],LEAD_REQUEST_LIMITED:[429,'limited'],LEAD_VEHICLE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
   if(mapped&&response.status===mapped[0])throw new LeadVehicleClientError(mapped[1]);throw new Error();
  }
  return {value,status:response.status};
 }catch(error){throw error instanceof LeadVehicleClientError?error:new LeadVehicleClientError(route==='vehicle-save'?'unknown':'unavailable');}
}
// Stateless transport. Original reports stay in private memory. The existing
// leads.context supplies advisory write state; every save rechecks authority.
export const leadVehicles=Object.freeze({
 async save(businessId:string,input:LeadVehicleSave,proof:Proof,signal:AbortSignal){
  let command:ReturnType<typeof parseLeadVehicleSave>;
  try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','leadId','leadVehicleId','expectedVersion','recoveryEpoch','draft']));command=parseLeadVehicleSave({...input,businessId});}catch{throw new LeadVehicleClientError('input');}
  const {draft,businessId:configuredBusiness,...ref}=command,body=Object.freeze({...ref,...leadVehicleDraftToWire(draft)});
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>131072)throw new LeadVehicleClientError('input');
  const r=await post('vehicle-save',body,proof,signal),v=r.value;
  try{
   if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(v.reason==='operation'||v.reason==='parent'||v.reason==='lead_vehicle'||v.reason==='vehicle'))return Object.freeze({state:'conflict' as const,reason:v.reason});
   if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion});
   check(r.status===200);return committed(v,configuredBusiness,ref);
  }catch{throw new LeadVehicleClientError('unknown');}
 },
 async lookup(businessId:string,input:LeadVehicleReference,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&reference(input));const ref=Object.freeze({...input}),r=await post('vehicle-operation',{operationId:ref.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,ref);}catch(error){throw error instanceof LeadVehicleClientError?error:new LeadVehicleClientError('unavailable');}
 },
 async list(businessId:string,input:{leadId:string;afterId:string|null;includeArchived:boolean;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['leadId','afterId','includeArchived','pageSize'])&&uuid(input.leadId)&&(input.afterId===null||uuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const p=Object.freeze({...input}),r=await post('vehicle-list',p,proof,signal);check(r.status===200);return parseLeadVehiclePage(r.value,businessId,p.leadId,p.afterId,p.includeArchived,p.pageSize);}catch(error){throw error instanceof LeadVehicleClientError?error:new LeadVehicleClientError('unavailable');}
 },
 async history(businessId:string,input:{leadId:string;leadVehicleId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['leadId','leadVehicleId','afterVersion','pageSize'])&&uuid(input.leadId)&&uuid(input.leadVehicleId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const p=Object.freeze({...input}),r=await post('vehicle-history',p,proof,signal);check(r.status===200);return parseLeadVehicleHistory(r.value,businessId,p.leadId,p.leadVehicleId,p.afterVersion,p.pageSize);}catch(error){throw error instanceof LeadVehicleClientError?error:new LeadVehicleClientError('unavailable');}
 }
});
