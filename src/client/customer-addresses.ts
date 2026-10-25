import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,customerInstant,requireCustomer as check} from '../customer/customer-contract';
import {parseAddressDraft} from '../customer/customer-resource-contract';
import {parseCustomerAddress} from '../customer/customer-address-contract';
import type {AddressDraft} from '../customer/customer-resource-contract';
export type AddressReference=Readonly<{operationId:string;customerId:string;addressId:string;expectedVersion:string;recoveryEpoch:string}>;
export type AddressSave=AddressReference&Readonly<{schemaVersion:1;draft:AddressDraft}>;
export type AddressContext=Readonly<{schemaVersion:1;businessId:string;customerId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class AddressClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('ADDRESS_REQUEST_FAILED');this.name='AddressClientError';this.kind=kind;}}
function reference(value:unknown):value is AddressReference{return !!value&&typeof value==='object'&&!Array.isArray(value)&&'operationId'in value&&uuid(value.operationId)&&'customerId'in value&&uuid(value.customerId)&&'addressId'in value&&uuid(value.addressId)&&'expectedVersion'in value&&version(value.expectedVersion,true)&&'recoveryEpoch'in value&&uuid(value.recoveryEpoch);}
function committed(value:unknown,businessId:string,ref:AddressReference){
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===ref.operationId&&value.recoveryEpoch===ref.recoveryEpoch&&exact(value.receipt,['schemaVersion','businessId','customerId','addressId','addressVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&r.customerId===ref.customerId&&r.addressId===ref.addressId&&version(r.addressVersion)&&BigInt(r.addressVersion)===BigInt(ref.expectedVersion)+1n&&uuid(r.auditEventId));
  return Object.freeze({state:'committed' as const,operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,businessId,customerId:ref.customerId,addressId:ref.addressId,addressVersion:r.addressVersion,auditEventId:r.auditEventId})});
}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
  try{
    check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
    const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
    const response=await fetch('/api/business/customers/addresses/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
    check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
    const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
    while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
    check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
    if(exact(value,['error'])){
      const codes:Record<string,readonly[number,Kind]>={ADDRESS_SAVE_NOT_SUBMITTED:[503,'not_submitted'],ADDRESS_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],ADDRESS_REQUEST_LIMITED:[429,'limited'],ADDRESS_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new AddressClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof AddressClientError?error:new AddressClientError(route==='save'?'unknown':'unavailable');}
}
// Stateless browser transport: no local/offline customer cache, credentials,
// authority, retry loop or automatic operation-ID/epoch replacement.
export const addresses=Object.freeze({
  async context(customerId:string,proof:Proof,signal:AbortSignal){
    try{check(uuid(customerId));const r=await post('context',{customerId},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','customerId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&uuid(v.businessId)&&v.customerId===customerId&&(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));return Object.freeze({context:Object.freeze({...v}) as AddressContext,binding:r.binding});}catch(e){throw e instanceof AddressClientError?e:new AddressClientError('unavailable');}
  },
  async save(businessId:string,input:AddressSave,proof:Proof,signal:AbortSignal){
    let command:AddressSave;
    try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','customerId','addressId','expectedVersion','recoveryEpoch','draft'])&&input.schemaVersion===1&&reference(input));command=Object.freeze({...input,draft:parseAddressDraft(input.draft)});}catch{throw new AddressClientError('input');}
    const {draft,...ref}=command,body=Object.freeze({...ref,...draft});
    if(new TextEncoder().encode(JSON.stringify(body)).byteLength>8192)throw new AddressClientError('input');
    const r=await post('save',body,proof,signal),v=r.value;
    try{
      if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(v.reason==='operation'||v.reason==='address'||v.reason==='parent'))return Object.freeze({state:'conflict' as const,reason:v.reason});
      if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion});
      check(r.status===200);return committed(v,businessId,ref);
    }catch{throw new AddressClientError('unknown');}
  },
  async lookup(businessId:string,ref:AddressReference,proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(ref,['operationId','customerId','addressId','expectedVersion','recoveryEpoch'])&&reference(ref));const pinned=Object.freeze({...ref}),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,pinned);}catch(e){throw e instanceof AddressClientError?e:new AddressClientError('unavailable');}
  },
  async list(businessId:string,input:{customerId:string;search:string;afterId:string|null;includeArchived:boolean;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['customerId','search','afterId','includeArchived','pageSize'])&&uuid(input.customerId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||uuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal),v=r.value;
      check(r.status===200&&exact(v,['schemaVersion','businessId','customerId','addresses','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&v.customerId===pinned.customerId&&Array.isArray(v.addresses)&&v.addresses.length<=pinned.pageSize&&typeof v.hasMore==='boolean');
      const rows=Array.from(v.addresses,c=>parseCustomerAddress(c,businessId,pinned.customerId));let previous=pinned.afterId;for(const row of rows){check((previous===null||row.id>previous)&&(pinned.includeArchived||row.archived_at===null));previous=row.id;}check(!v.hasMore||rows.length===pinned.pageSize);return Object.freeze({addresses:Object.freeze(rows),hasMore:v.hasMore});
    }catch(e){throw e instanceof AddressClientError?e:new AddressClientError('unavailable');}
  },
  async history(businessId:string,input:{customerId:string;addressId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['customerId','addressId','afterVersion','pageSize'])&&uuid(input.customerId)&&uuid(input.addressId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal),v=r.value;check(r.status===200);if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
      check(exact(v,['schemaVersion','businessId','customerId','address','history','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&v.customerId===pinned.customerId&&Array.isArray(v.history)&&v.history.length<=pinned.pageSize&&typeof v.hasMore==='boolean');const address=parseCustomerAddress(v.address,businessId,pinned.customerId);check(address.id===pinned.addressId);let previous=BigInt(pinned.afterVersion);
      const history=Array.from(v.history,e=>{check(exact(e,['version','eventId','actorId','operationId','at','action','before','after'])&&version(e.version)&&uuid(e.eventId)&&uuid(e.actorId)&&uuid(e.operationId)&&customerInstant(e.at)&&['create','edit','archive','reopen'].includes(e.action as string));const after=parseCustomerAddress(e.after,businessId,pinned.customerId),before=e.before===null?null:parseCustomerAddress(e.before,businessId,pinned.customerId);check(after.id===address.id&&after.version===e.version&&after.operation_id===e.operationId&&after.updated_by===e.actorId&&BigInt(e.version)===previous+1n&&BigInt(e.version)<=BigInt(address.version)&&(before===null?e.version==='1'&&e.action==='create':before.id===address.id&&BigInt(before.version)+1n===BigInt(e.version)));previous=BigInt(e.version);return Object.freeze({...e,before,after});});check(!v.hasMore||history.length===pinned.pageSize);return Object.freeze({state:'found' as const,address,history:Object.freeze(history),hasMore:v.hasMore});
    }catch(e){throw e instanceof AddressClientError?e:new AddressClientError('unavailable');}
  }
});
