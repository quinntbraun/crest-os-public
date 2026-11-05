import {randomUUID} from 'node:crypto';
import {parseSourceExportJob} from '../../src/security/source-export-job-contract.ts';
export function sourceExportOwnerFixture(){
 const businessId=String(randomUUID()),actorId=String(randomUUID()),stamp='2026-10-27T05:00:00.000001Z';
 const original={schemaVersion:1,businessId,commandType:'export.request',reference:{operationId:String(randomUUID()),recoveryEpoch:String(randomUUID()),exportJobId:String(randomUUID()),appReleaseId:'a'.repeat(40),profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}};
 const decision={schemaVersion:1,recoveryEpoch:String(randomUUID()),original,reason:'Reviewed synthetic interrupted export é😀\n exactly'};
 const retired={schemaVersion:1,state:'retired',original,retirement:{operationRowId:String(randomUUID()),auditEventId:String(randomUUID()),recoveryEpoch:decision.recoveryEpoch,reason:decision.reason,recordedAt:stamp}};
 const job={id:original.reference.exportJobId,business_id:businessId,actor_id:actorId,profile:original.reference.profile,app_release_id:original.reference.appReleaseId,source_schema_version:43,recovery_epoch:original.reference.recoveryEpoch,request_operation_id:original.reference.operationId,state:'Queued',attempt_count:0,lease_id:null,lease_until:null,next_run_at:stamp,failure_code:null,version:'1',created_at:stamp,updated_at:stamp,created_by:actorId,updated_by:actorId,origin:'manual',operation_id:original.reference.operationId,import_row_id:null};
 const committed={state:'committed',operationId:original.reference.operationId,recoveryEpoch:original.reference.recoveryEpoch,receipt:{schemaVersion:1,command:original,auditEventId:String(randomUUID()),job}};
 return{businessId,actorId,original,decision,retired,job,committed};
}
export function sourceExportContextFixture(f=sourceExportOwnerFixture()){
 return{schemaVersion:1 as const,businessId:f.businessId,actorId:f.actorId,appReleaseId:f.original.reference.appReleaseId,profile:'crest.business-source-journal-bundle.v1' as const,sourceSchemaVersion:43 as const,writeState:'ready' as const,recoveryEpoch:f.original.reference.recoveryEpoch};
}
export function sourceExportListFixture(f=sourceExportOwnerFixture()){
 const jobs=Array.from({length:7},(_,i)=>{const stamp='2026-10-27T05:00:0'+(6-i)+'.000001Z';return parseSourceExportJob({...f.job,business_id:f.businessId,actor_id:f.actorId,created_by:f.actorId,updated_by:f.actorId,id:randomUUID(),request_operation_id:randomUUID(),operation_id:randomUUID(),state:'Failed',failure_code:'OWNER_STOPPED',version:'2',created_at:stamp,updated_at:stamp,next_run_at:stamp},f.businessId);});
 const cursor={createdAt:jobs[4]!.created_at,id:jobs[4]!.id};return{jobs,first:{schemaVersion:1 as const,jobs:jobs.slice(0,5),next:cursor},second:{schemaVersion:1 as const,jobs:jobs.slice(5),next:null},cursor};
}
