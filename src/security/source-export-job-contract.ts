// Data-only proposed schema43 boundary. No I/O, authorization, queue, retry,
// worker dispatch or route. Original receipts are historical, never live leases.
import {customerUuid as uuid,customerVersion as version,customerInstant as instant} from '../customer/customer-contract.ts';
type Common=Readonly<{operationId:string;recoveryEpoch:string;exportJobId:string}>;
type Targets={
 'export.request':Readonly<{appReleaseId:string;profile:'crest.business-source-bundle.v1';sourceSchemaVersion:43}>;
 'export.claim':Readonly<{expectedVersion:string;leaseId:string}>;
 'export.expire':Readonly<{expectedVersion:string;leaseId:string}>;
 'export.stop':Readonly<{expectedVersion:string}>;
 'export.ready':Readonly<{expectedVersion:string;leaseId:string;generationId:string;requestSha256:string}>;
};
export type SourceExportCommand={ [K in keyof Targets]:Readonly<{schemaVersion:1;businessId:string;commandType:K;reference:Common&Targets[K]}> }[keyof Targets];
export type SourceExportJob=Readonly<{
 id:string;business_id:string;actor_id:string;profile:'crest.business-source-bundle.v1';app_release_id:string;source_schema_version:43;
 recovery_epoch:string;request_operation_id:string;state:'Queued'|'Running'|'Failed'|'Ready';attempt_count:number;lease_id:string|null;lease_until:string|null;
 next_run_at:string;failure_code:'LEASE_EXPIRED'|'OWNER_STOPPED'|null;version:string;created_at:string;updated_at:string;
 created_by:string;updated_by:string;origin:'manual';operation_id:string;import_row_id:null;
}>;
export class SourceExportContractError extends Error{constructor(){super('SOURCE_EXPORT_COMMAND_REVIEW_REQUIRED');this.name='SourceExportContractError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportContractError();}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);
 require(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(k=>Object.hasOwn(descriptors,k)&&descriptors[k]!.enumerable&&Object.hasOwn(descriptors[k]!,'value')));
 return Object.fromEntries(keys.map(k=>[k,descriptors[k]!.value]));
}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const profile='crest.business-source-bundle.v1';
const fields={
 'export.request':['appReleaseId','profile','sourceSchemaVersion'],
 'export.claim':['expectedVersion','leaseId'],
 'export.expire':['expectedVersion','leaseId'],
 'export.stop':['expectedVersion'],
 'export.ready':['expectedVersion','leaseId','generationId','requestSha256']
} as const;
export function parseSourceExportCommand(input:unknown):SourceExportCommand{
 const v=object(input,['schemaVersion','businessId','commandType','reference']);require(v.schemaVersion===1&&uuid(v.businessId)&&typeof v.commandType==='string'&&Object.hasOwn(fields,v.commandType));
 const kind=v.commandType as keyof Targets,r=object(v.reference,['operationId','recoveryEpoch','exportJobId',...fields[kind]]);
 require(uuid(r.operationId)&&uuid(r.recoveryEpoch)&&uuid(r.exportJobId));
 if(kind==='export.request')require(hash(r.appReleaseId)&&r.profile===profile&&r.sourceSchemaVersion===43);
 else{require(version(r.expectedVersion));if(kind!=='export.stop')require(uuid(r.leaseId));if(kind==='export.ready')require(uuid(r.generationId)&&typeof r.requestSha256==='string'&&/^[a-f0-9]{64}$/.test(r.requestSha256));}
 return Object.freeze({...v,reference:Object.freeze(r)}) as SourceExportCommand;
}
export const sourceExportJobColumns=['id','business_id','actor_id','profile','app_release_id','source_schema_version','recovery_epoch','request_operation_id','state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export function parseSourceExportJob(input:unknown,businessId:string):SourceExportJob{
 require(uuid(businessId));const j=object(input,sourceExportJobColumns);
 for(const k of ['id','actor_id','recovery_epoch','request_operation_id','created_by','updated_by','operation_id'])require(uuid(j[k]));
 require(j.business_id===businessId&&j.actor_id===j.created_by&&j.profile===profile&&hash(j.app_release_id)&&j.source_schema_version===43&&j.origin==='manual'&&j.import_row_id===null&&version(j.version));
 require(instant(j.created_at)&&instant(j.updated_at)&&j.updated_at>=j.created_at&&instant(j.next_run_at)&&j.next_run_at>=j.created_at);
 require(typeof j.attempt_count==='number'&&Number.isInteger(j.attempt_count)&&j.attempt_count>=0&&j.attempt_count<=5);
 require(j.failure_code===null||j.failure_code==='LEASE_EXPIRED'||j.failure_code==='OWNER_STOPPED');
 if(j.state==='Running')require(j.attempt_count>=1&&uuid(j.lease_id)&&instant(j.lease_until)&&j.lease_until>j.updated_at&&j.failure_code===null);
 else{
  require(j.lease_id===null&&j.lease_until===null);
  if(j.state==='Queued')require(j.attempt_count===0?j.failure_code===null:j.attempt_count<5&&j.failure_code==='LEASE_EXPIRED');
  else if(j.state==='Ready')require(j.attempt_count>=1&&j.failure_code===null);
  else require(j.state==='Failed'&&(j.failure_code==='OWNER_STOPPED'||j.failure_code==='LEASE_EXPIRED'&&j.attempt_count===5));
 }
 require(j.version==='1'?j.operation_id===j.request_operation_id&&j.state==='Queued'&&j.attempt_count===0&&j.updated_at===j.created_at&&j.next_run_at===j.created_at:j.operation_id!==j.request_operation_id);
 return Object.freeze(j) as SourceExportJob;
}
export function parseSourceExportCommitted(input:unknown,original:SourceExportCommand,expectedActorId:string){
 const command=parseSourceExportCommand(original);require(uuid(expectedActorId));const r=command.reference;
 const v=object(input,['state','operationId','recoveryEpoch','receipt']);require(v.state==='committed'&&v.operationId===r.operationId&&v.recoveryEpoch===r.recoveryEpoch);
 const receipt=object(v.receipt,['schemaVersion','command','job','auditEventId']);require(receipt.schemaVersion===1&&uuid(receipt.auditEventId));
 const retained=parseSourceExportCommand(receipt.command);require(JSON.stringify(retained)===JSON.stringify(command));
 const job=parseSourceExportJob(receipt.job,command.businessId);require(job.id===r.exportJobId&&job.operation_id===r.operationId&&job.updated_by===expectedActorId);
 if(command.commandType==='export.request'){
  require(job.actor_id===expectedActorId&&job.recovery_epoch===r.recoveryEpoch&&job.version==='1'&&job.request_operation_id===r.operationId&&job.app_release_id===command.reference.appReleaseId);
 }else{
  require(BigInt(job.version)===BigInt(command.reference.expectedVersion)+1n);
  if(command.commandType==='export.stop')require(job.state==='Failed'&&job.failure_code==='OWNER_STOPPED');
  else{
   require(job.actor_id===expectedActorId&&job.recovery_epoch===r.recoveryEpoch);
   if(command.commandType==='export.ready')require(job.state==='Ready');
   else if(command.commandType==='export.claim')require(job.state==='Running'&&job.lease_id===command.reference.leaseId);
   else require((job.state==='Queued'||job.state==='Failed')&&job.failure_code==='LEASE_EXPIRED');
  }
 }
 return Object.freeze({state:'committed' as const,operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,command:retained,job,auditEventId:receipt.auditEventId})});
}
