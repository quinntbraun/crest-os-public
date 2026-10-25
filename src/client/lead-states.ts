import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,requireCustomer as check} from '../customer/customer-contract';
import {parseLeadStateDraft} from '../customer/lead-state-contract';
import type {LeadStateDraft} from '../customer/lead-state-contract';
import {parseLeadStateCommitted,parseLeadStatePage} from '../customer/lead-state-command-contract';
export type LeadStateReference=Readonly<{operationId:string;leadId:string;expectedVersion:string;recoveryEpoch:string}>;
export type LeadStateChange=LeadStateReference&Readonly<{schemaVersion:1;draft:LeadStateDraft}>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class LeadStateClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('LEAD_STATE_REQUEST_FAILED');this.name='LeadStateClientError';this.kind=kind;}}
function reference(value:unknown):value is LeadStateReference{return !!value&&typeof value==='object'&&!Array.isArray(value)&&'operationId'in value&&uuid(value.operationId)&&'leadId'in value&&uuid(value.leadId)&&'expectedVersion'in value&&version(value.expectedVersion)&&'recoveryEpoch'in value&&uuid(value.recoveryEpoch);}
function committed(value:unknown,businessId:string,ref:LeadStateReference){
 const result=parseLeadStateCommitted(value,businessId,ref.operationId);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.leadId===ref.leadId&&BigInt(result.receipt.leadVersion as string)===BigInt(ref.expectedVersion)+1n);return result;
}
async function post(route:'state'|'state-operation'|'state-events',body:object,proof:Proof,external:AbortSignal){
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
      const codes:Record<string,readonly[number,Kind]>={LEAD_STATE_NOT_SUBMITTED:[503,'not_submitted'],LEAD_STATE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],LEAD_REQUEST_LIMITED:[429,'limited'],LEAD_STATE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new LeadStateClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof LeadStateClientError?error:new LeadStateClientError(route==='state'?'unknown':'unavailable');}
}
// Stateless status transport. Original draft/reason stays private in memory;
// no cache, retry loop or replacement operation/version/epoch is created here.
export const leadStates=Object.freeze({
 async change(businessId:string,input:LeadStateChange,proof:Proof,signal:AbortSignal){
  let command:LeadStateChange;
  try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','leadId','expectedVersion','recoveryEpoch','draft'])&&input.schemaVersion===1&&reference(input));command=Object.freeze({...input,draft:parseLeadStateDraft(input.draft)});}catch{throw new LeadStateClientError('input');}
  const {draft,...ref}=command,body=Object.freeze({...ref,...draft});
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>131072)throw new LeadStateClientError('input');
  const r=await post('state',body,proof,signal),v=r.value;
  try{
   if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(v.reason==='operation'||v.reason==='lead'||v.reason==='state'))return Object.freeze({state:'conflict' as const,reason:v.reason});
   if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion});
   check(r.status===200);return committed(v,businessId,ref);
  }catch{throw new LeadStateClientError('unknown');}
 },
 async lookup(businessId:string,ref:LeadStateReference,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(ref,['operationId','leadId','expectedVersion','recoveryEpoch'])&&reference(ref));const pinned=Object.freeze({...ref}),r=await post('state-operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,pinned);}catch(e){throw e instanceof LeadStateClientError?e:new LeadStateClientError('unavailable');}
 },
 async events(businessId:string,input:{leadId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['leadId','afterVersion','pageSize'])&&uuid(input.leadId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('state-events',pinned,proof,signal);check(r.status===200);return parseLeadStatePage(r.value,businessId,pinned.leadId,pinned.afterVersion,pinned.pageSize);}catch(e){throw e instanceof LeadStateClientError?e:new LeadStateClientError('unavailable');}
 }
});
