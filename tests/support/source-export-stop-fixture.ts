import {randomUUID} from 'node:crypto';
import {sourceExportOwnerFixture} from './source-export-owner-fixture';
import {parseSourceExportStopCommand} from '../../src/security/source-export-stop-contract';
import {parseSourceExportJob,parseSourceExportCommitted} from '../../src/security/source-export-job-contract';
export function sourceExportStopFixture(){
 const f=sourceExportOwnerFixture(),profile='crest.current-business-source-bundle.v1' as const,job=parseSourceExportJob({...f.job,profile,source_schema_version:134},f.businessId);
 const context={schemaVersion:1 as const,businessId:f.businessId,actorId:f.actorId,appReleaseId:job.app_release_id,profile,sourceSchemaVersion:134 as const,writeState:'ready' as const,recoveryEpoch:job.recovery_epoch};
 const command=parseSourceExportStopCommand({schemaVersion:1,businessId:f.businessId,commandType:'export.stop',reference:{operationId:randomUUID(),recoveryEpoch:job.recovery_epoch,exportJobId:job.id,expectedVersion:job.version}},f.businessId);
 const auditEventId=randomUUID();
 function stopped(cmd=command){return parseSourceExportCommitted({state:'committed',operationId:cmd.reference.operationId,recoveryEpoch:cmd.reference.recoveryEpoch,receipt:{schemaVersion:1,command:cmd,auditEventId,job:{...job,state:'Failed',failure_code:'OWNER_STOPPED',version:String(BigInt(cmd.reference.expectedVersion)+1n),operation_id:cmd.reference.operationId}}},cmd,f.actorId);}
 const running=parseSourceExportJob({...job,state:'Running',attempt_count:1,version:'2',lease_id:randomUUID(),lease_until:'2026-10-27T05:05:00.000001Z',operation_id:randomUUID()},f.businessId);
 return{...f,job,context,command,stopped,running};
}
