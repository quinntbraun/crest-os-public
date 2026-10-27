import {randomUUID} from 'node:crypto';
import type {StoredService,StoredServiceContent,ServiceSave} from '../../src/commercial/service-storage-contract.ts';
export function serviceStorageFixture(){
 const business=randomUUID(),actor=randomUUID(),operation=randomUUID(),epoch=randomUUID(),stamp='2026-10-27T12:34:56.123456Z';
 const service:StoredService={id:randomUUID(),business_id:business,code:'synthetic-interior',current_version_id:randomUUID(),active:true,version:'1',created_at:stamp,updated_at:stamp,created_by:actor,updated_by:actor,origin:'manual',operation_id:operation,import_row_id:null};
 const content:StoredServiceContent={id:service.current_version_id,business_id:business,service_id:service.id,sequence:'1',name:'Synthetic interior',inclusions:'Vacuum.\nApplicable leather care.',exclusions:'No exterior protection.',internal_guidance:'Private synthetic note',range_low_cents:'0',range_high_cents:null,estimated_seconds:'5430',created_at:stamp,created_by:actor,origin:'manual',operation_id:operation,import_row_id:null};
 const payload={code:service.code,active:true,definition:{name:content.name,inclusions:content.inclusions,exclusions:content.exclusions,internalGuidance:content.internal_guidance,rangeLowCents:content.range_low_cents,rangeHighCents:content.range_high_cents,estimatedSeconds:content.estimated_seconds}};
 const request:ServiceSave={schemaVersion:1,businessId:business,operationId:operation,recoveryEpoch:epoch,serviceId:service.id,expectedRevision:'0',payload};
 const receipt={schemaVersion:1 as const,businessId:business,serviceId:service.id,serviceRevision:'1',contentVersionId:content.id,contentSequence:'1',auditEventId:randomUUID(),contentAuditEventId:randomUUID()};
 const committed={state:'committed' as const,operationId:operation,recoveryEpoch:epoch,receipt};
 const event={revision:'1',eventId:receipt.auditEventId,actorId:actor,operationId:operation,at:stamp,action:'create',before:null,after:service,content};
 const directory={schemaVersion:1,businessId:business,services:[{service,content}],hasMore:false};
 const history={schemaVersion:1,businessId:business,service,history:[event],hasMore:false};
 const listRequest={businessId:business,search:'',afterId:null,includeInactive:false,pageSize:20};
 const historyRequest={businessId:business,serviceId:service.id,afterRevision:'0',pageSize:20};
 return{business,actor,operation,epoch,stamp,service,content,request,receipt,committed,event,directory,history,listRequest,historyRequest};
}
