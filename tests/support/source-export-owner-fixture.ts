import {randomUUID} from 'node:crypto';
export function sourceExportOwnerFixture(){
 const businessId=String(randomUUID()),actorId=String(randomUUID()),stamp='2026-10-27T05:00:00.000001Z';
 const original={schemaVersion:1,businessId,commandType:'export.request',reference:{operationId:String(randomUUID()),recoveryEpoch:String(randomUUID()),exportJobId:String(randomUUID()),appReleaseId:'a'.repeat(40),profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}};
 const decision={schemaVersion:1,recoveryEpoch:String(randomUUID()),original,reason:'Reviewed synthetic interrupted export é😀\n exactly'};
 const retired={schemaVersion:1,state:'retired',original,retirement:{operationRowId:String(randomUUID()),auditEventId:String(randomUUID()),recoveryEpoch:decision.recoveryEpoch,reason:decision.reason,recordedAt:stamp}};
 const job={id:original.reference.exportJobId,business_id:businessId,actor_id:actorId,profile:original.reference.profile,app_release_id:original.reference.appReleaseId,source_schema_version:43,recovery_epoch:original.reference.recoveryEpoch,request_operation_id:original.reference.operationId,state:'Queued',attempt_count:0,lease_id:null,lease_until:null,next_run_at:stamp,failure_code:null,version:'1',created_at:stamp,updated_at:stamp,created_by:actorId,updated_by:actorId,origin:'manual',operation_id:original.reference.operationId,import_row_id:null};
 const committed={state:'committed',operationId:original.reference.operationId,recoveryEpoch:original.reference.recoveryEpoch,receipt:{schemaVersion:1,command:original,auditEventId:String(randomUUID()),job}};
 return{businessId,actorId,original,decision,retired,job,committed};
}
