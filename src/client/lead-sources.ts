import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,customerInstant,requireCustomer as check} from '../customer/customer-contract';
import {parseLeadSource,leadSourceColumns} from '../customer/lead-contract';
import {parseLeadSourceDraft} from '../customer/lead-contract';
import type {LeadSourceDraft} from '../customer/lead-contract';
export type LeadSourceReference=Readonly<{operationId:string;leadSourceId:string;expectedVersion:string;recoveryEpoch:string}>;
export type LeadSourceSave=LeadSourceReference&Readonly<{schemaVersion:1;draft:LeadSourceDraft}>;
export type LeadSourceContext=Readonly<{schemaVersion:1;businessId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class LeadSourceClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('LEAD_SOURCE_REQUEST_FAILED');this.name='LeadSourceClientError';this.kind=kind;}}
function reference(value:unknown):value is LeadSourceReference{return !!value&&typeof value==='object'&&!Array.isArray(value)&&'operationId'in value&&uuid(value.operationId)&&'leadSourceId'in value&&uuid(value.leadSourceId)&&'expectedVersion'in value&&version(value.expectedVersion,true)&&'recoveryEpoch'in value&&uuid(value.recoveryEpoch);}
function committed(value:unknown,businessId:string,ref:LeadSourceReference){
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===ref.operationId&&value.recoveryEpoch===ref.recoveryEpoch&&exact(value.receipt,['schemaVersion','businessId','leadSourceId','leadSourceVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&r.leadSourceId===ref.leadSourceId&&version(r.leadSourceVersion)&&BigInt(r.leadSourceVersion)===BigInt(ref.expectedVersion)+1n&&uuid(r.auditEventId));
  return Object.freeze({state:'committed' as const,operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,businessId,leadSourceId:ref.leadSourceId,leadSourceVersion:r.leadSourceVersion,auditEventId:r.auditEventId})});
}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
  try{
    check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
    const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
    const response=await fetch('/api/business/lead-sources/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
    check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
    const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
    while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
    check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
    if(exact(value,['error'])){
      const codes:Record<string,readonly[number,Kind]>={LEAD_SOURCE_SAVE_NOT_SUBMITTED:[503,'not_submitted'],LEAD_SOURCE_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],LEAD_SOURCE_REQUEST_LIMITED:[429,'limited'],LEAD_SOURCE_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new LeadSourceClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof LeadSourceClientError?error:new LeadSourceClientError(route==='save'?'unknown':'unavailable');}
}
// Stateless browser transport: no local/offline leadSource cache, credentials,
// authority, retry loop or automatic operation-ID/epoch replacement.
export const leadSources=Object.freeze({
  async context(proof:Proof,signal:AbortSignal){
    try{const r=await post('context',{},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&uuid(v.businessId)&&(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));return Object.freeze({context:Object.freeze({...v}) as LeadSourceContext,binding:r.binding});}catch(e){throw e instanceof LeadSourceClientError?e:new LeadSourceClientError('unavailable');}
  },
  async save(businessId:string,input:LeadSourceSave,proof:Proof,signal:AbortSignal){
    let command:LeadSourceSave;
    try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','leadSourceId','expectedVersion','recoveryEpoch','draft'])&&input.schemaVersion===1&&reference(input));command=Object.freeze({...input,draft:parseLeadSourceDraft(input.draft)});}catch{throw new LeadSourceClientError('input');}
    const {draft,...ref}=command,body=Object.freeze({...ref,...draft});
    if(new TextEncoder().encode(JSON.stringify(body)).byteLength>8192)throw new LeadSourceClientError('input');
    const r=await post('save',body,proof,signal),v=r.value;
    try{
      if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(v.reason==='operation'||v.reason==='lead_source'||v.reason==='parent'||v.reason==='label'))return Object.freeze({state:'conflict' as const,reason:v.reason});
      if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion});
      check(r.status===200);return committed(v,businessId,ref);
    }catch{throw new LeadSourceClientError('unknown');}
  },
  async lookup(businessId:string,ref:LeadSourceReference,proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(ref,['operationId','leadSourceId','expectedVersion','recoveryEpoch'])&&reference(ref));const pinned=Object.freeze({...ref}),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,pinned);}catch(e){throw e instanceof LeadSourceClientError?e:new LeadSourceClientError('unavailable');}
  },
  async list(businessId:string,input:{search:string;afterId:string|null;includeInactive:boolean;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['search','afterId','includeInactive','pageSize'])&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||uuid(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal),v=r.value;
      check(r.status===200&&exact(v,['schemaVersion','businessId','leadSources','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.leadSources)&&v.leadSources.length<=pinned.pageSize&&typeof v.hasMore==='boolean');
      const rows=Array.from(v.leadSources,c=>parseLeadSource(c,businessId));let previous=pinned.afterId;for(const row of rows){check((previous===null||row.id>previous)&&(pinned.includeInactive||row.active));previous=row.id;}check(!v.hasMore||rows.length===pinned.pageSize);return Object.freeze({leadSources:Object.freeze(rows),hasMore:v.hasMore});
    }catch(e){throw e instanceof LeadSourceClientError?e:new LeadSourceClientError('unavailable');}
  },
  async history(businessId:string,input:{leadSourceId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['leadSourceId','afterVersion','pageSize'])&&uuid(input.leadSourceId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal),v=r.value;check(r.status===200);if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
      check(exact(v,['schemaVersion','businessId','leadSource','history','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.history)&&v.history.length<=pinned.pageSize&&typeof v.hasMore==='boolean');const leadSource=parseLeadSource(v.leadSource,businessId);check(leadSource.id===pinned.leadSourceId);let previous=BigInt(pinned.afterVersion);
      let last:ReturnType<typeof parseLeadSource>|null=null;
      const same=(a:ReturnType<typeof parseLeadSource>,b:ReturnType<typeof parseLeadSource>)=>leadSourceColumns.every(k=>a[k]===b[k]);
      const history=Array.from(v.history,e=>{
        check(exact(e,['version','eventId','actorId','operationId','at','action','before','after'])&&version(e.version)&&uuid(e.eventId)&&uuid(e.actorId)&&uuid(e.operationId)&&customerInstant(e.at));
        const after=parseLeadSource(e.after,businessId),before=e.before===null?null:parseLeadSource(e.before,businessId);
        check(after.id===leadSource.id&&after.version===e.version&&after.operation_id===e.operationId&&after.updated_by===e.actorId&&BigInt(e.version)===previous+1n&&BigInt(e.version)<=BigInt(leadSource.version)&&(before===null?e.version==='1'&&e.action==='create':before.id===leadSource.id&&BigInt(before.version)+1n===BigInt(e.version)&&e.action===(before.active===after.active?'edit':after.active?'activate':'deactivate')));
        check(last===null||before!==null&&same(last,before));last=after;previous=BigInt(e.version);return Object.freeze({...e,before,after});
      });
      const remaining=BigInt(leadSource.version)>BigInt(pinned.afterVersion)?BigInt(leadSource.version)-BigInt(pinned.afterVersion):0n;
      check(BigInt(history.length)===(remaining>BigInt(pinned.pageSize)?BigInt(pinned.pageSize):remaining)&&v.hasMore===(remaining>BigInt(pinned.pageSize))&&(last===null||previous!==BigInt(leadSource.version)||same(last,leadSource)));
      return Object.freeze({state:'found' as const,leadSource,history:Object.freeze(history),hasMore:v.hasMore});
    }catch(e){throw e instanceof LeadSourceClientError?e:new LeadSourceClientError('unavailable');}
  }
});
