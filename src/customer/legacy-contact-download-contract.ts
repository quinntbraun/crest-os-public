import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';

export const legacyContactDownloadRoute='legacy-batches/download';
export const legacyContactDownloadLimit=16*1024*1024;
export const legacyContactOutcomeHeader='source_row,decision_revision,customer_action,customer_id,customer_version,vehicle_action,vehicle_id,vehicle_version\r\n';
export const legacyContactRequestHeader='operation_id,evidence_sha256,requested_by,requested_at,status,completed_at,attempt_count\r\n';

export function parseLegacyContactDownloadRequest(input:unknown){
 check(exact(input,['batchId','applicationOperationId','recoveryEpoch'])&&customerUuid(input.batchId)&&
  customerUuid(input.applicationOperationId)&&customerUuid(input.recoveryEpoch));
 return {batchId:input.batchId,applicationOperationId:input.applicationOperationId,recoveryEpoch:input.recoveryEpoch} as const;
}

export function legacyContactArchiveFilename(batchId:string){
 check(customerUuid(batchId));
 return 'crest-contact-import-'+batchId+'.zip';
}
