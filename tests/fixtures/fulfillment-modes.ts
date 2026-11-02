import {randomUUID} from 'node:crypto';
import type {FulfillmentModeSave,FulfillmentModeVersion} from '../../src/operations/fulfillment-mode-contract';
export function modeHistoryFixture(count=2){
 const businessId=randomUUID(),actor=randomUUID();
 const versions:FulfillmentModeVersion[]=Array.from({length:count},(_,index)=>({id:randomUUID(),business_id:businessId,sequence:String(index+1),replaces_sequence:index?String(index):null,mobile_enabled:true,dropoff_enabled:index%2===0,pickup_return_enabled:false,reason:index?'Synthetic arrangement change '+index:null,created_at:'2026-11-02T12:00:00.123456Z',created_by:actor,operation_id:randomUUID(),origin:'manual'}));
 return {businessId,actor,versions};
}
export function modeCommitted(request:FulfillmentModeSave){return {state:'committed' as const,operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,receipt:{schemaVersion:1 as const,businessId:request.businessId,sequence:String(BigInt(request.expectedSequence)+1n),versionId:randomUUID(),auditEventId:randomUUID()}};}
