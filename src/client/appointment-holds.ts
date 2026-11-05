import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,requireCustomer as check} from '../customer/customer-contract';
import {parseHoldSave,parseHoldCommitted,parseStoredHold} from '../operations/appointment-hold-contract';
import type {HoldSave} from '../operations/appointment-hold-contract';
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class HoldClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('HOLD_REQUEST_FAILED');this.name='HoldClientError';this.kind=kind;}}
export type HoldReference=Readonly<{operationId:string;holdId:string;expectedSequence:string;recoveryEpoch:string}>;
export type HoldContext=Readonly<{schemaVersion:1;businessId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
  try{
    check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
    const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
    const response=await fetch('/api/business/appointment-holds/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
    check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
    const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
    while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
    check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
    if(exact(value,['error'])){
      const codes:Record<string,readonly[number,Kind]>={HOLD_SAVE_NOT_SUBMITTED:[503,'not_submitted'],HOLD_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],HOLD_REQUEST_LIMITED:[429,'limited'],HOLD_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new HoldClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof HoldClientError?error:new HoldClientError(route==='save'?'unknown':'unavailable');}
}
export const appointmentHolds=Object.freeze({
  async context(proof:Proof,signal:AbortSignal){
    try{const r=await post('context',{},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&uuid(v.businessId)&&(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));return Object.freeze({context:Object.freeze({...v}) as HoldContext,binding:r.binding});}catch(e){throw e instanceof HoldClientError?e:new HoldClientError('unavailable');}
  },
  async save(input:HoldSave,proof:Proof,signal:AbortSignal){
    let request:HoldSave;try{request=parseHoldSave(input);}catch{throw new HoldClientError('input');}const {businessId,payload,...reference}=request,body={...reference,...payload};if(new TextEncoder().encode(JSON.stringify(body)).byteLength>32768)throw new HoldClientError('input');
    const r=await post('save',body,proof,signal),v=r.value;
    try{if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&['operation','review'].includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'review'});if(r.status===409&&exact(v,['state','reason','currentSequence'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentSequence,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:v.currentSequence});check(r.status===200);const result=parseHoldCommitted(v,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.holdId===request.holdId&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return result;}catch{throw new HoldClientError('unknown');}
  },
  async lookup(businessId:string,reference:HoldReference,proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(reference,['operationId','holdId','expectedSequence','recoveryEpoch'])&&[reference.operationId,reference.holdId,reference.recoveryEpoch].every(uuid)&&version(reference.expectedSequence,true));const ref=Object.freeze({...reference}),r=await post('operation',{operationId:ref.operationId},proof,signal);check(r.status===200);if(exact(r.value,['state'])&&r.value.state==='absent')return Object.freeze({state:'absent' as const});const result=parseHoldCommitted(r.value,businessId,ref.operationId);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.holdId===ref.holdId&&BigInt(result.receipt.sequence)===BigInt(ref.expectedSequence)+1n);return result;}catch(e){throw e instanceof HoldClientError?e:new HoldClientError('unavailable');}
  },
  async list(businessId:string,input:{afterId:string|null;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['afterId','pageSize'])&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input}),r=await post('list',request,proof,signal),v=r.value;check(r.status===200&&exact(v,['schemaVersion','businessId','holds','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.holds)&&v.holds.length<=request.pageSize&&typeof v.hasMore==='boolean');let prior=request.afterId;const holds=v.holds.map(value=>{const h=parseStoredHold(value,businessId);check(prior===null||h.hold_id>prior);prior=h.hold_id;return h;});check(!v.hasMore||holds.length===request.pageSize);return Object.freeze({holds:Object.freeze(holds),hasMore:v.hasMore});}catch(e){throw e instanceof HoldClientError?e:new HoldClientError('unavailable');}
  },
  async history(businessId:string,input:{holdId:string;afterSequence:string;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['holdId','afterSequence','pageSize'])&&uuid(input.holdId)&&version(input.afterSequence,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input}),r=await post('history',request,proof,signal),v=r.value;check(r.status===200);if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});check(exact(v,['schemaVersion','businessId','holdId','currentSequence','versions','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&v.holdId===request.holdId&&version(v.currentSequence)&&Array.isArray(v.versions)&&typeof v.hasMore==='boolean');let prior=BigInt(request.afterSequence);const versions=v.versions.map(value=>{const h=parseStoredHold(value,businessId);check(h.hold_id===request.holdId&&BigInt(h.sequence)===prior+1n&&BigInt(h.sequence)<=BigInt(v.currentSequence as string));prior=BigInt(h.sequence);return h;});const left=BigInt(v.currentSequence)>BigInt(request.afterSequence)?BigInt(v.currentSequence)-BigInt(request.afterSequence):0n;check(BigInt(versions.length)===(left>BigInt(request.pageSize)?BigInt(request.pageSize):left)&&v.hasMore===(left>BigInt(request.pageSize)));return Object.freeze({state:'found' as const,currentSequence:v.currentSequence,versions:Object.freeze(versions),hasMore:v.hasMore});}catch(e){throw e instanceof HoldClientError?e:new HoldClientError('unavailable');}
  }
});
