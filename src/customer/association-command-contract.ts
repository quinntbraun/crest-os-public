import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseVehicleAssociation,parseVehicleAssociationClose} from './customer-resource-contract.ts';
export type AssociationBody=Readonly<{action:'open'|'close'|'transfer';associationId:string;customerId:string;vehicleId:string;effectiveAt:string;relationship:'owner'|'keeper'|null;isBilling:boolean|null;evidence:string|null;reason:string|null;nextAssociationId:string|null}>;
export function parseAssociationBody(value:unknown):AssociationBody{
 check(exact(value,['action','associationId','customerId','vehicleId','effectiveAt','relationship','isBilling','evidence','reason','nextAssociationId'])&&['open','close','transfer'].includes(value.action as string)&&uuid(value.associationId)&&uuid(value.customerId)&&uuid(value.vehicleId));
 if(value.action==='close')check(value.relationship===null&&value.isBilling===null&&value.evidence===null);
 else{check(typeof value.isBilling==='boolean');parseVehicleAssociation({customerId:value.customerId,vehicleId:value.vehicleId,validFrom:value.effectiveAt,relationship:value.relationship,evidence:value.evidence});}
 if(value.action==='open')check(value.reason===null);
 else parseVehicleAssociationClose({associationId:value.associationId,validTo:value.effectiveAt,reason:value.reason});
 check(value.action==='transfer'?uuid(value.nextAssociationId)&&value.nextAssociationId!==value.associationId:value.nextAssociationId===null);
 return Object.freeze({...value}) as AssociationBody;
}
export type AssociationSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;expectedVersion:'0'|'1';body:AssociationBody}>;
export function parseAssociationSave(value:unknown):AssociationSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','expectedVersion','body'])&&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&version(value.expectedVersion,true));
 const body=parseAssociationBody(value.body);check(value.expectedVersion===(body.action==='open'?'0':'1'));
 return Object.freeze({...value,body}) as AssociationSave;
}
export function parseAssociationCommitted(value:unknown,businessId:string,operationId:string){
 check(uuid(businessId)&&uuid(operationId));
 check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&uuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','action','vehicleId','associationId','associationVersion','closedAuditId','openedAssociationId','openedAuditId']));
 const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&['open','close','transfer'].includes(r.action as string)&&uuid(r.vehicleId)&&uuid(r.associationId));
 check(r.action==='open'?r.associationVersion==='1'&&r.closedAuditId===null&&r.openedAssociationId===r.associationId&&uuid(r.openedAuditId):r.associationVersion==='2'&&uuid(r.closedAuditId));
 check(r.action==='close'?r.openedAssociationId===null&&r.openedAuditId===null:r.action==='open'||uuid(r.openedAssociationId)&&r.openedAssociationId!==r.associationId&&uuid(r.openedAuditId)&&r.openedAuditId!==r.closedAuditId);
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})});
}
