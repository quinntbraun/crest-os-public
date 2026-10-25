import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,customerInstant,requireCustomer as check} from '../customer/customer-contract';
import {parseLead} from '../customer/lead-contract';
import {parseLeadDraft} from '../customer/lead-contract';
import {sameLead,validateLeadHistoryChange} from '../customer/lead-history-contract';
import type {LeadDraft} from '../customer/lead-contract';
export type LeadReference=Readonly<{operationId:string;leadId:string;expectedVersion:string;recoveryEpoch:string}>;
export type LeadSave=LeadReference&Readonly<{schemaVersion:1;draft:LeadDraft}>;
export type LeadContext=Readonly<{schemaVersion:1;businessId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class LeadClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('LEAD_REQUEST_FAILED');this.name='LeadClientError';this.kind=kind;}}
function reference(value:unknown):value is LeadReference{return !!value&&typeof value==='object'&&!Array.isArray(value)&&'operationId'in value&&uuid(value.operationId)&&'leadId'in value&&uuid(value.leadId)&&'expectedVersion'in value&&version(value.expectedVersion,true)&&'recoveryEpoch'in value&&uuid(value.recoveryEpoch);}
function committed(value:unknown,businessId:string,ref:LeadReference){
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===ref.operationId&&value.recoveryEpoch===ref.recoveryEpoch&&exact(value.receipt,['schemaVersion','businessId','leadId','leadVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&r.leadId===ref.leadId&&version(r.leadVersion)&&BigInt(r.leadVersion)===BigInt(ref.expectedVersion)+1n&&uuid(r.auditEventId));
  return Object.freeze({state:'committed' as const,operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,businessId,leadId:ref.leadId,leadVersion:r.leadVersion,auditEventId:r.auditEventId})});
}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
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
      const codes:Record<string,readonly[number,Kind]>={LEAD_SAVE_NOT_SUBMITTED:[503,'not_submitted'],LEAD_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],LEAD_REQUEST_LIMITED:[429,'limited'],LEAD_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new LeadClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof LeadClientError?error:new LeadClientError(route==='save'?'unknown':'unavailable');}
}
// Stateless browser transport: no local/offline lead cache, credentials,
// authority, retry loop or automatic operation-ID/epoch replacement.
export const leads=Object.freeze({
  async context(proof:Proof,signal:AbortSignal){
    try{const r=await post('context',{},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&uuid(v.businessId)&&(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));return Object.freeze({context:Object.freeze({...v}) as LeadContext,binding:r.binding});}catch(e){throw e instanceof LeadClientError?e:new LeadClientError('unavailable');}
  },
  async save(businessId:string,input:LeadSave,proof:Proof,signal:AbortSignal){
    let command:LeadSave;
    try{check(uuid(businessId)&&exact(input,['schemaVersion','operationId','leadId','expectedVersion','recoveryEpoch','draft'])&&input.schemaVersion===1&&reference(input));command=Object.freeze({...input,draft:parseLeadDraft(input.draft)});}catch{throw new LeadClientError('input');}
    const {draft,...ref}=command,body=Object.freeze({...ref,...draft});
    if(new TextEncoder().encode(JSON.stringify(body)).byteLength>131072)throw new LeadClientError('input');
    const r=await post('save',body,proof,signal),v=r.value;
    try{
      if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(v.reason==='operation'||v.reason==='lead'||v.reason==='parent'||v.reason==='converted'))return Object.freeze({state:'conflict' as const,reason:v.reason});
      if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion});
      check(r.status===200);return committed(v,businessId,ref);
    }catch{throw new LeadClientError('unknown');}
  },
  async lookup(businessId:string,ref:LeadReference,proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(ref,['operationId','leadId','expectedVersion','recoveryEpoch'])&&reference(ref));const pinned=Object.freeze({...ref}),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,pinned);}catch(e){throw e instanceof LeadClientError?e:new LeadClientError('unavailable');}
  },
  async list(businessId:string,input:{search:string;afterId:string|null;includeLost:boolean;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['search','afterId','includeLost','pageSize'])&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||uuid(input.afterId))&&typeof input.includeLost==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal),v=r.value;
      check(r.status===200&&exact(v,['schemaVersion','businessId','leads','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.leads)&&v.leads.length<=pinned.pageSize&&typeof v.hasMore==='boolean');
      const rows=Array.from(v.leads,c=>parseLead(c,businessId));let previous=pinned.afterId;for(const row of rows){check((previous===null||row.id>previous)&&(pinned.includeLost||row.state!=='lost'));previous=row.id;}check(!v.hasMore||rows.length===pinned.pageSize);return Object.freeze({leads:Object.freeze(rows),hasMore:v.hasMore});
    }catch(e){throw e instanceof LeadClientError?e:new LeadClientError('unavailable');}
  },
  async history(businessId:string,input:{leadId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
    try{check(uuid(businessId)&&exact(input,['leadId','afterVersion','pageSize'])&&uuid(input.leadId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal),v=r.value;check(r.status===200);if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
      check(exact(v,['schemaVersion','businessId','lead','history','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.history)&&v.history.length<=pinned.pageSize&&typeof v.hasMore==='boolean');const lead=parseLead(v.lead,businessId);check(lead.id===pinned.leadId);let previous=BigInt(pinned.afterVersion);
      let last:ReturnType<typeof parseLead>|null=null;
      const history=Array.from(v.history,e=>{
        check(exact(e,['version','eventId','actorId','operationId','at','action','before','after'])&&version(e.version)&&uuid(e.eventId)&&uuid(e.actorId)&&uuid(e.operationId)&&customerInstant(e.at));
        const after=parseLead(e.after,businessId),before=e.before===null?null:parseLead(e.before,businessId);
        check(after.id===lead.id&&after.version===e.version&&after.operation_id===e.operationId&&after.updated_by===e.actorId&&BigInt(e.version)===previous+1n&&BigInt(e.version)<=BigInt(lead.version)&&(before===null?e.version==='1'&&e.action==='create':before.id===lead.id&&BigInt(before.version)+1n===BigInt(e.version)));
        validateLeadHistoryChange(e.action,before,after);check(last===null||before!==null&&sameLead(last,before));last=after;previous=BigInt(e.version);return Object.freeze({...e,before,after});
      });
      const remaining=BigInt(lead.version)>BigInt(pinned.afterVersion)?BigInt(lead.version)-BigInt(pinned.afterVersion):0n;
      check(BigInt(history.length)===(remaining>BigInt(pinned.pageSize)?BigInt(pinned.pageSize):remaining)&&v.hasMore===(remaining>BigInt(pinned.pageSize))&&(last===null||previous!==BigInt(lead.version)||sameLead(last,lead)));
      return Object.freeze({state:'found' as const,lead,history:Object.freeze(history),hasMore:v.hasMore});
    }catch(e){throw e instanceof LeadClientError?e:new LeadClientError('unavailable');}
  }
});
