// Review adapter for the existing association contracts. No PostgreSQL substitute.
import {randomUUID} from 'node:crypto';
import {customerUuid as uuid,customerInstant as instant} from '../src/customer/customer-contract.ts';
import {parseAssociationSave,parseAssociationCommitted} from '../src/customer/association-command-contract.ts';
import {parseAssociation,associationClose,associationTransfer,ownerPeriodsOverlap,billingPeriodsOverlap,associationContains} from '../src/customer/vehicle-association-contract.ts';
const time=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),clone=value=>structuredClone(value),resource='vehicle-associations';
export function createReviewAssociations({businessId,actorId,epoch,customers,vehicles,operations}){
 const rows=new Map(),histories=new Map();
 const conflict=reason=>({status:409,value:{state:'conflict',reason}});
 function save(input){
  const {schemaVersion,operationId,recoveryEpoch,expectedVersion,...body}=input;
  const command=parseAssociationSave({schemaVersion,businessId,operationId,recoveryEpoch,expectedVersion,body});if(recoveryEpoch!==epoch())throw Error('REVIEW_INPUT_INVALID');
  const serialized=JSON.stringify(command),prior=operations.get(operationId);
  if(prior)return prior.resource===resource&&prior.serialized===serialized?{status:200,value:clone(prior.result)}:conflict('operation');
  if(!vehicles.has(body.vehicleId)||!customers.has(body.customerId))return conflict('parent');
  const previous=rows.get(body.associationId);
  if(body.action==='open'&&previous)return conflict('association');
  if(body.action!=='open'&&(!previous||previous.vehicle_id!==body.vehicleId||body.action==='close'&&previous.customer_id!==body.customerId))return conflict('association');
  if(previous&&(previous.version!=='1'||previous.valid_to!==null))return{status:409,value:{state:'conflict',reason:'version',currentVersion:previous.version}};
  if(previous&&body.effectiveAt<previous.valid_from)throw Error('REVIEW_INPUT_INVALID');
  if(body.action==='transfer'&&rows.has(body.nextAssociationId))return conflict('association');
  if(rows.size+(body.action==='close'?0:1)>200||[...histories.values()].reduce((n,events)=>n+events.length,0)+(body.action==='transfer'?2:1)>400)return{status:429,value:{error:'REVIEW_CAPACITY_REACHED'}};
  const now=time(),closedAuditId=body.action==='open'?null:randomUUID(),openedAuditId=body.action==='close'?null:randomUUID(),openedId=body.action==='transfer'?body.nextAssociationId:body.associationId;
  const closed=body.action==='open'?null:parseAssociation({...previous,valid_to:body.effectiveAt,close_reason:body.reason,closed_at:now,closed_by:actorId,version:'2',updated_at:now,updated_by:actorId,operation_id:operationId},businessId);
  const opened=body.action==='close'?null:parseAssociation({id:openedId,business_id:businessId,customer_id:body.customerId,vehicle_id:body.vehicleId,valid_from:body.effectiveAt,valid_to:null,relationship:body.relationship,is_billing:body.isBilling,evidence:body.evidence,close_reason:null,closed_at:null,closed_by:null,version:'1',created_at:now,updated_at:now,created_by:actorId,updated_by:actorId,origin:'manual',operation_id:operationId,import_row_id:null},businessId);
  if(closed)associationClose(previous,closed,businessId);if(closed&&opened)associationTransfer(previous,closed,opened,businessId);
  const candidates=[...rows.values()].filter(row=>!closed||row.id!==closed.id).concat(closed?[closed]:[],opened?[opened]:[]);
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
   if(ownerPeriodsOverlap(candidates[i],candidates[j],businessId))return conflict('owner_period');
   if(billingPeriodsOverlap(candidates[i],candidates[j],businessId))return conflict('billing_period');
  }
  const result=parseAssociationCommitted({state:'committed',operationId,recoveryEpoch,receipt:{schemaVersion:1,businessId,action:body.action,vehicleId:body.vehicleId,associationId:body.associationId,associationVersion:body.action==='open'?'1':'2',closedAuditId,openedAssociationId:opened?.id??null,openedAuditId}},businessId,operationId);
  // Every candidate and receipt is checked before either side of a transfer changes.
  if(closed){rows.set(closed.id,closed);histories.set(closed.id,[...histories.get(closed.id),{version:'2',eventId:closedAuditId,actorId,operationId,at:now,action:'close',before:previous,after:closed}]);}
  if(opened){rows.set(opened.id,opened);histories.set(opened.id,[{version:'1',eventId:openedAuditId,actorId,operationId,at:now,action:'open',before:null,after:opened}]);}
  operations.set(operationId,{resource,serialized,result});return{status:200,value:clone(result)};
 }
 return{
  dispatch(route,input){
   if(route==='save')return save(input);
   if(route==='operation'){if(!uuid(input.operationId))throw Error('REVIEW_INPUT_INVALID');const prior=operations.get(input.operationId);return{status:200,value:prior?.resource===resource?clone(prior.result):{state:'absent'}};}
   if(route==='context'||route==='list'){
    if(!uuid(input.vehicleId)||!vehicles.has(input.vehicleId))throw Error('REVIEW_INPUT_INVALID');
    if(route==='context')return{status:200,value:{schemaVersion:1,businessId,vehicleId:input.vehicleId,writeState:'ready',recoveryEpoch:epoch()}};
    if(!Number.isInteger(input.pageSize)||input.pageSize<1||input.pageSize>50||input.afterId!==null&&!uuid(input.afterId))throw Error('REVIEW_INPUT_INVALID');
    const all=[...rows.values()].filter(row=>row.vehicle_id===input.vehicleId&&(input.afterId===null||row.id>input.afterId)).sort((a,b)=>a.id.localeCompare(b.id));
    return{status:200,value:{schemaVersion:1,businessId,vehicleId:input.vehicleId,associations:clone(all.slice(0,input.pageSize)),hasMore:all.length>input.pageSize}};
   }
   if(route==='history'){
    if(!uuid(input.associationId)||!['0','1','2'].includes(input.afterVersion)||!Number.isInteger(input.pageSize)||input.pageSize<1||input.pageSize>20)throw Error('REVIEW_INPUT_INVALID');
    const row=rows.get(input.associationId);if(!row)return{status:200,value:{state:'absent'}};
    const all=histories.get(row.id).filter(e=>Number(e.version)>Number(input.afterVersion));return{status:200,value:{schemaVersion:1,businessId,association:clone(row),history:clone(all.slice(0,input.pageSize)),hasMore:all.length>input.pageSize}};
   }
   return{status:503,value:{error:'REVIEW_WORKFLOW_NOT_CONNECTED'}};
  },
  customerVehicles(customerId){
   if(!uuid(customerId)||!customers.has(customerId))throw Error('REVIEW_INPUT_INVALID');
   const now=time();return{reviewOnly:true,customerId,links:[...rows.values()].filter(row=>row.customer_id===customerId).map(row=>({associationId:row.id,vehicleId:row.vehicle_id,label:vehicles.get(row.vehicle_id).label,relationship:row.relationship,isBilling:row.is_billing,validFrom:row.valid_from,validTo:row.valid_to,status:associationContains(row,businessId,now)?'Current':row.valid_from>now?'Scheduled':'Historical'}))};
  },
  snapshot(){return{records:clone([...rows.values()]),history:clone([...histories.values()].flat())};},
  restore(snapshot){
   const source=snapshot.records?.[resource]??[],events=snapshot.history?.[resource]??[];if(!Array.isArray(source)||source.length>200||!Array.isArray(events)||events.length>400)throw Error('REVIEW_SNAPSHOT_INVALID');
   rows.clear();histories.clear();
   for(const value of source){const row=parseAssociation(value,businessId);if(rows.has(row.id)||!customers.has(row.customer_id)||!vehicles.has(row.vehicle_id))throw Error('REVIEW_SNAPSHOT_INVALID');rows.set(row.id,row);histories.set(row.id,[]);}
   for(const event of events){const row=parseAssociation(event.after,businessId);if(!rows.has(row.id)||event.operationId!==row.operation_id||event.actorId!==row.updated_by||event.version!==row.version||!uuid(event.eventId)||!instant(event.at)||event.at<row.updated_at)throw Error('REVIEW_SNAPSHOT_INVALID');if(row.version==='1'){if(event.action!=='open'||event.before!==null)throw Error('REVIEW_SNAPSHOT_INVALID');}else{if(event.action!=='close')throw Error('REVIEW_SNAPSHOT_INVALID');associationClose(event.before,row,businessId);}histories.get(row.id).push(clone(event));}
   for(const row of rows.values()){const chain=histories.get(row.id).sort((a,b)=>Number(a.version)-Number(b.version));if(chain.length!==Number(row.version)||JSON.stringify(chain.at(-1).after)!==JSON.stringify(row)||chain[0].version!=='1'||row.version==='2'&&JSON.stringify(chain[1].before)!==JSON.stringify(chain[0].after))throw Error('REVIEW_SNAPSHOT_INVALID');}
   const all=[...rows.values()];for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(ownerPeriodsOverlap(all[i],all[j],businessId)||billingPeriodsOverlap(all[i],all[j],businessId))throw Error('REVIEW_SNAPSHOT_INVALID');
  },
  reset(){rows.clear();histories.clear();}
 };
}
