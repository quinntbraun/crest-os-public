import type {Proof} from './authentication';
import {exactCustomerObject as exact,customerUuid as uuid,customerVersion as version,customerInstant as instant,requireCustomer as check} from '../customer/customer-contract';
import {parseAssociation,associationColumns,associationClose} from '../customer/vehicle-association-contract';
import {parseAssociationSave,parseAssociationCommitted} from '../customer/association-command-contract';
import type {AssociationSave,AssociationBody} from '../customer/association-command-contract';
export type AssociationReference=Readonly<{operationId:string;recoveryEpoch:string;action:AssociationBody['action'];associationId:string;vehicleId:string;expectedVersion:'0'|'1';nextAssociationId:string|null}>;
export type AssociationCommand=Omit<AssociationSave,'businessId'>;
export type AssociationContext=Readonly<{schemaVersion:1;businessId:string;vehicleId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
export type AssociationCommit=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Readonly<{schemaVersion:1;businessId:string;action:AssociationBody['action'];vehicleId:string;associationId:string;associationVersion:'1'|'2';closedAuditId:string|null;openedAssociationId:string|null;openedAuditId:string|null}>}>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class AssociationClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('ASSOCIATION_REQUEST_FAILED');this.name='AssociationClientError';this.kind=kind;}}
export function associationReference(value:unknown):AssociationReference{
 check(exact(value,['operationId','recoveryEpoch','action','associationId','vehicleId','expectedVersion','nextAssociationId'])&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.associationId)&&uuid(value.vehicleId)&&['open','close','transfer'].includes(value.action as string)&&value.expectedVersion===(value.action==='open'?'0':'1')&&(value.action==='transfer'?uuid(value.nextAssociationId)&&value.nextAssociationId!==value.associationId:value.nextAssociationId===null));
 return Object.freeze({...value}) as AssociationReference;
}
function committed(value:unknown,businessId:string,reference:AssociationReference):AssociationCommit{
 const result=parseAssociationCommitted(value,businessId,reference.operationId),r=result.receipt;
 check(result.recoveryEpoch===reference.recoveryEpoch&&r.action===reference.action&&r.vehicleId===reference.vehicleId&&r.associationId===reference.associationId&&(reference.action!=='transfer'||r.openedAssociationId===reference.nextAssociationId));
 return result as AssociationCommit;
}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
  try{
    check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
    const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
    const response=await fetch('/api/business/vehicle-associations/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
    check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
    const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=1048576);parts.push(part.value);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
    while(nodes.length){check(++visited<=10000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
    check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);
    if(exact(value,['error'])){
      const codes:Record<string,readonly[number,Kind]>={ASSOCIATION_SAVE_NOT_SUBMITTED:[503,'not_submitted'],ASSOCIATION_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],ASSOCIATION_REQUEST_LIMITED:[429,'limited'],ASSOCIATION_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(codes,value.error)?codes[value.error]:undefined;
      if(mapped&&response.status===mapped[0])throw new AssociationClientError(mapped[1]);throw new Error();
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof AssociationClientError?error:new AssociationClientError(route==='save'?'unknown':'unavailable');}
}
// Stateless transport: the caller retains original intent; this module never
// caches records, generates identities/epochs, retries, or performs lookup.
export const associations=Object.freeze({
 async context(businessId:string,vehicleId:string,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&uuid(vehicleId));const r=await post('context',{vehicleId},proof,signal),v=r.value;
   check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','vehicleId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&v.businessId===businessId&&v.vehicleId===vehicleId&&(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));
   return Object.freeze({context:Object.freeze({...v}) as AssociationContext,binding:r.binding});
  }catch(e){throw e instanceof AssociationClientError?e:new AssociationClientError('unavailable');}
 },
 async save(businessId:string,input:AssociationCommand,proof:Proof,signal:AbortSignal){
  let command:AssociationSave;
  try{check(exact(input,['schemaVersion','operationId','recoveryEpoch','expectedVersion','body']));command=parseAssociationSave({...input,businessId});}catch{throw new AssociationClientError('input');}
  const {body,...identity}=command,reference=associationReference({operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,expectedVersion:command.expectedVersion,action:body.action,associationId:body.associationId,vehicleId:body.vehicleId,nextAssociationId:body.nextAssociationId});
  const wire={schemaVersion:identity.schemaVersion,operationId:identity.operationId,recoveryEpoch:identity.recoveryEpoch,expectedVersion:identity.expectedVersion,...body};
  if(new TextEncoder().encode(JSON.stringify(wire)).byteLength>8192)throw new AssociationClientError('input');
  const r=await post('save',wire,proof,signal),v=r.value;
  try{
   if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&['operation','parent','association','owner_period','billing_period'].includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'parent'|'association'|'owner_period'|'billing_period'});
   if(r.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&['1','2'].includes(v.currentVersion as string))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:v.currentVersion as '1'|'2'});
   check(r.status===200);return committed(v,businessId,reference);
  }catch{throw new AssociationClientError('unknown');}
 },
 async lookup(businessId:string,input:AssociationReference,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId));const reference=associationReference(input),r=await post('operation',{operationId:reference.operationId},proof,signal);check(r.status===200);
   return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,reference);
  }catch(e){throw e instanceof AssociationClientError?e:new AssociationClientError('unavailable');}
 },
 async list(businessId:string,input:{vehicleId:string;afterId:string|null;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['vehicleId','afterId','pageSize'])&&uuid(input.vehicleId)&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal),v=r.value;
   check(r.status===200&&exact(v,['schemaVersion','businessId','vehicleId','associations','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&v.vehicleId===pinned.vehicleId&&Array.isArray(v.associations)&&v.associations.length<=pinned.pageSize&&typeof v.hasMore==='boolean');
   const rows=Array.from(v.associations,row=>parseAssociation(row,businessId));let previous=pinned.afterId;for(const row of rows){check(row.vehicle_id===pinned.vehicleId&&(previous===null||row.id>previous));previous=row.id;}check(!v.hasMore||rows.length===pinned.pageSize);
   return Object.freeze({associations:Object.freeze(rows),hasMore:v.hasMore});
  }catch(e){throw e instanceof AssociationClientError?e:new AssociationClientError('unavailable');}
 },
 async history(businessId:string,input:{associationId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&exact(input,['associationId','afterVersion','pageSize'])&&uuid(input.associationId)&&['0','1','2'].includes(input.afterVersion)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal),v=r.value;check(r.status===200);
   if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
   check(exact(v,['schemaVersion','businessId','association','history','hasMore'])&&v.schemaVersion===1&&v.businessId===businessId&&Array.isArray(v.history)&&v.history.length<=pinned.pageSize&&typeof v.hasMore==='boolean');
   const association=parseAssociation(v.association,businessId);check(association.id===pinned.associationId);let previous=BigInt(pinned.afterVersion),previousRow:ReturnType<typeof parseAssociation>|undefined;
   const history=Array.from(v.history,event=>{
    check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&version(event.version)&&uuid(event.eventId)&&uuid(event.actorId)&&uuid(event.operationId)&&instant(event.at));
    const after=parseAssociation(event.after,businessId),before=event.before===null?null:parseAssociation(event.before,businessId);
    check(after.id===association.id&&after.version===event.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&event.at>=after.updated_at&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(association.version));
    if(before===null)check(event.action==='open'&&after.version==='1');else{check(event.action==='close');associationClose(before,after,businessId);if(previousRow)check(associationColumns.every(k=>before[k]===previousRow![k]));}
    previous=BigInt(event.version);previousRow=after;return Object.freeze({...event,before,after});
   });
   const remaining=Math.max(0,Number(association.version)-Number(pinned.afterVersion));check(history.length===Math.min(pinned.pageSize,remaining)&&v.hasMore===(remaining>pinned.pageSize));
   if(history.length&&history.at(-1)!.after.version===association.version)check(associationColumns.every(k=>history.at(-1)!.after[k]===association[k]));
   return Object.freeze({state:'found' as const,association,history:Object.freeze(history),hasMore:v.hasMore});
  }catch(e){throw e instanceof AssociationClientError?e:new AssociationClientError('unavailable');}
 }
});
