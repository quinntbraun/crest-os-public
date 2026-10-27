// Fictional review transactions only; production continues using PostgreSQL.
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {customerUuid as uuid,exactCustomerObject as exact} from '../src/customer/customer-contract.ts';
import {parseLead} from '../src/customer/lead-contract.ts';
import {validateLeadHistoryChange} from '../src/customer/lead-history-contract.ts';
import {prepareLeadConversion} from '../src/customer/lead-conversion-contract.ts';
import {prepareLeadConversionReview} from '../src/customer/lead-conversion-preview.ts';
import {parseLeadConversionWire,bindLeadConversionCommitted,parseLeadConversionLinkPage} from '../src/customer/lead-conversion-command-contract.ts';
import {parseLeadConversionRecord,parseConversionLink,parseLeadConversionCollection} from '../src/customer/lead-conversion-record.ts';
const clone=value=>structuredClone(value),time=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
export function reviewConversionChild(business,operation,conversion,role,id){
 const bytes=createHash('sha256').update(['crest:lead-conversion:child:1',role,business,operation,conversion,id].join('\x1f'),'utf8').digest().subarray(0,16);bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
export function createReviewConversions({businessId,actorId,epoch,records,histories,operations,configurations,room,commit}){
 const conversions=new Map(),links=new Map(),audits=new Map(),linkAudits=new Map();
 const conflict=reason=>({status:409,value:{state:'conflict',reason}}),byLead=id=>[...conversions.values()].find(row=>row.lead_id===id);
 const historical=(resource,id,version,auditId)=>{const event=histories[resource].get(id)?.find(e=>e.version===version&&(auditId===undefined||e.eventId===auditId));if(!event)throw Error('REVIEW_CONVERSION_EVIDENCE_INVALID');return event;};
 function save(input){
  const request=parseLeadConversionWire(input,businessId);if(request.recoveryEpoch!==epoch())throw Error('REVIEW_INPUT_INVALID');
  const serialized=JSON.stringify(request),prior=operations.get(request.operationId);
  if(prior)return prior.resource==='lead-conversions'&&prior.serialized===serialized?{status:200,value:clone(prior.result)}:conflict('operation');
  if(conversions.has(request.conversionId)||byLead(request.leadId)||[...request.vehicles,...request.addresses].some(m=>links.has(m.linkId)))return conflict('conversion');
  const lead=records.leads.get(request.leadId),vs=request.vehicles.map(m=>records['lead-vehicles'].get(m.leadVehicleId)),as=request.addresses.map(m=>records['lead-addresses'].get(m.leadAddressId));
  if(!lead||lead.version!==request.expectedLeadVersion||lead.customer_id!==null&&(request.customer.kind!=='existing'||lead.customer_id!==request.customer.id))return conflict('lead');
  try{prepareLeadConversion(request,lead,vs,as);}catch{return conflict('source');}
  const existing=(mappings,resource)=>[...new Map(mappings.filter(m=>m.target.kind==='existing').map(m=>[m.target.id,records[resource].get(m.target.id)])).values()];
  try{prepareLeadConversionReview(request,lead,vs,as,{customer:request.customer.kind==='existing'?records.customers.get(request.customer.id):null,vehicles:existing(request.vehicles,'vehicles'),addresses:existing(request.addresses,'addresses')});}catch{return conflict('destination');}
  const targets=[['customers',request.customer],...request.vehicles.map(m=>['vehicles',m.target]),...request.addresses.map(m=>['addresses',m.target])];
  if(targets.some(([resource,target])=>target.kind==='new'&&records[resource].has(target.id)))return conflict('destination');
  const now=time(),changes=[],childOperations=[],staged=new Map(),childIds=new Set(),child=(role,id)=>reviewConversionChild(businessId,request.operationId,request.conversionId,role,id);
  const base=(id,operationId)=>({id,business_id:businessId,version:'1',created_at:now,updated_at:now,created_by:actorId,updated_by:actorId,origin:'manual',operation_id:operationId,import_row_id:null});
  const audit=(after,before=null,action='create')=>({version:after.version,eventId:randomUUID(),actorId,operationId:after.operation_id,at:now,action,before,after});
  function create(resource,target){
   if(target.kind==='existing')return{row:records[resource].get(target.id),audit:historical(resource,target.id,target.expectedVersion),childId:null};
   const role=resource==='customers'?'customer':resource==='vehicles'?'vehicle':'address',operationId=child(role,target.id),c=configurations[resource],draft=c.parseDraft(target.draft);
   const row=c.parse({...base(target.id,operationId),...resource==='addresses'?{customer_id:request.customer.id}:{},...c.build(draft,null,records['lead-sources']),archived_at:null,archived_reason:null},businessId),event=audit(row);
   changes.push({resource,row,event});childIds.add(operationId);staged.set(resource+':'+row.id,{row,audit:event,childId:operationId});
   childOperations.push({id:operationId,value:{resource,serialized:'conversion-child:'+serialized,result:{state:'committed',operationId,recoveryEpoch:epoch(),receipt:{schemaVersion:1,businessId,...resource==='addresses'?{customerId:request.customer.id}:{},[c.id]:row.id,[c.version]:'1',auditEventId:event.eventId}}}});
   return staged.get(resource+':'+row.id);
  }
  const customer=create('customers',request.customer);
  for(const [resource,target]of targets.slice(1))if(target.kind==='new')create(resource,target);
  const leadOperation=child('lead',lead.id),after=parseLead({...lead,customer_id:request.customer.id,version:String(BigInt(lead.version)+1n),updated_at:now,updated_by:actorId,operation_id:leadOperation},businessId);
  validateLeadHistoryChange('edit',lead,after);const leadAudit=audit(after,lead,'edit'),beforeAudit=historical('leads',lead.id,lead.version);changes.push({resource:'leads',row:after,event:leadAudit});childIds.add(leadOperation);
  childOperations.push({id:leadOperation,value:{resource:'leads',serialized:'conversion-child:'+serialized,result:{state:'committed',operationId:leadOperation,recoveryEpoch:epoch(),receipt:{schemaVersion:1,businessId,leadId:lead.id,leadVersion:after.version,auditEventId:leadAudit.eventId}}}});
  if(childIds.size!==changes.length||childIds.has(request.operationId)||[...childIds].some(id=>operations.has(id)))return conflict('operation');
  const parent=parseLeadConversionRecord({...base(request.conversionId,request.operationId),lead_id:lead.id,customer_id:customer.row.id,expected_lead_version:lead.version,lead_version:after.version,customer_version:customer.row.version,lead_before_audit_id:beforeAudit.eventId,lead_audit_id:leadAudit.eventId,customer_audit_id:customer.audit.eventId,lead_child_operation_id:leadOperation,customer_child_operation_id:customer.childId,request,converted_at:now},businessId);
  const mapped=[];
  for(const [resource,sourceResource,mappings]of [['vehicles','lead-vehicles',request.vehicles],['addresses','lead-addresses',request.addresses]])for(const m of mappings){
   const vehicle=resource==='vehicles',sourceId=vehicle?m.leadVehicleId:m.leadAddressId,sourceVersion=vehicle?m.expectedLeadVehicleVersion:m.expectedLeadAddressVersion,destination=staged.get(resource+':'+m.target.id)??create(resource,m.target),source=historical(sourceResource,sourceId,sourceVersion);
   mapped.push(parseConversionLink({...base(m.linkId,request.operationId),conversion_id:parent.id,lead_id:lead.id,lead_vehicle_id:vehicle?sourceId:null,vehicle_id:vehicle?destination.row.id:null,lead_address_id:vehicle?null:sourceId,address_id:vehicle?null:destination.row.id,source_version:sourceVersion,target_version:destination.row.version,source_audit_id:source.eventId,target_audit_id:destination.audit.eventId,target_child_operation_id:destination.childId},businessId,parent));
  }
  const parentAudit=audit(parent),mappingAudits=mapped.map(row=>audit(row)),result=bindLeadConversionCommitted({state:'committed',operationId:request.operationId,recoveryEpoch:epoch(),receipt:{schemaVersion:1,businessId,conversionId:parent.id,leadId:lead.id,leadVersion:after.version,customerId:customer.row.id,auditEventId:parentAudit.eventId}},request);
  if(conversions.size>=200||links.size+mapped.length>1000||!room(changes.length+1+mapped.length)||Object.keys(configurations).some(resource=>records[resource].size+changes.filter(c=>c.resource===resource&&!records[resource].has(c.row.id)).length>200))return{status:429,value:{error:'REVIEW_CAPACITY_REACHED'}};
  // No callbacks, I/O or validation after publication starts. All candidates are ready.
  commit(changes,childOperations);conversions.set(parent.id,parent);audits.set(parent.id,parentAudit);for(const [i,row]of mapped.entries()){links.set(row.id,row);linkAudits.set(row.id,mappingAudits[i]);}
  operations.set(request.operationId,{resource:'lead-conversions',serialized,result});return{status:200,value:clone(result)};
 }
 function checkAudit(row,audit){
  if(!exact(audit,['version','eventId','actorId','operationId','at','action','before','after'])||!uuid(audit.eventId)||audit.version!=='1'||audit.action!=='create'||audit.before!==null||audit.actorId!==row.created_by||audit.operationId!==row.operation_id||audit.at!==row.created_at||!same(audit.after,row))throw Error('REVIEW_CONVERSION_EVIDENCE_INVALID');
 }
 return{
  hasLead:id=>byLead(id)??null,eventCount:()=>audits.size+linkAudits.size,
  dispatch(route,input){
   if(route==='convert')return save(input);
   if(route==='conversion-operation'){if(!exact(input,['operationId'])||!uuid(input.operationId))throw Error('REVIEW_INPUT_INVALID');const saved=operations.get(input.operationId);return{status:200,value:saved?.resource==='lead-conversions'?clone(saved.result):{state:'absent'}};}
   if(route==='conversion'){if(!exact(input,['leadId'])||!uuid(input.leadId))throw Error('REVIEW_INPUT_INVALID');const row=byLead(input.leadId);return{status:200,value:row?{schemaVersion:1,businessId,conversion:clone(row)}:{state:'absent'}};}
   if(!exact(input,['leadId','conversionId','afterId','pageSize'])||!uuid(input.leadId)||!uuid(input.conversionId))throw Error('REVIEW_INPUT_INVALID');
   const row=conversions.get(input.conversionId);if(!row||row.lead_id!==input.leadId)return{status:200,value:{state:'absent'}};
   const all=[...links.values()].filter(link=>link.conversion_id===row.id&&(input.afterId===null||link.id>input.afterId)).sort((a,b)=>a.id.localeCompare(b.id)),value={schemaVersion:1,businessId,conversion:clone(row),links:clone(all.slice(0,input.pageSize)),hasMore:all.length>input.pageSize};
   parseLeadConversionLinkPage(value,businessId,input.leadId,row.id,input.afterId,input.pageSize);return{status:200,value};
  },
  snapshot(){const sorted=map=>clone([...map.values()].sort((a,b)=>(a.after?.id??a.id).localeCompare(b.after?.id??b.id)));return{records:{'lead-conversions':sorted(conversions),'lead-conversion-links':sorted(links)},history:{'lead-conversions':sorted(audits),'lead-conversion-links':sorted(linkAudits)}};},
  restore(snapshot){
   const source=parseLeadConversionCollection(snapshot.records?.['lead-conversions']??[],snapshot.records?.['lead-conversion-links']??[],businessId);
   if(source.conversions.length>200)throw Error('REVIEW_SNAPSHOT_INVALID');
   for(const [resource,rows,map,auditMap]of [['lead-conversions',source.conversions,conversions,audits],['lead-conversion-links',source.links,links,linkAudits]]){
    const history=snapshot.history?.[resource]??[];if(!Array.isArray(history)||history.length!==rows.length)throw Error('REVIEW_SNAPSHOT_INVALID');
    for(const row of rows){const matching=history.filter(a=>a.after?.id===row.id);if(matching.length!==1)throw Error('REVIEW_SNAPSHOT_INVALID');checkAudit(row,matching[0]);map.set(row.id,row);auditMap.set(row.id,clone(matching[0]));}
   }
   for(const parent of conversions.values()){
    const req=parent.request,leadBefore=historical('leads',parent.lead_id,parent.expected_lead_version,parent.lead_before_audit_id),leadAfter=historical('leads',parent.lead_id,parent.lead_version,parent.lead_audit_id),customer=historical('customers',parent.customer_id,parent.customer_version,parent.customer_audit_id);
    if(!same(leadAfter.before,leadBefore.after)||leadAfter.after.customer_id!==parent.customer_id||leadAfter.operationId!==parent.lead_child_operation_id||parent.lead_child_operation_id!==reviewConversionChild(businessId,parent.operation_id,parent.id,'lead',parent.lead_id)||records.leads.get(parent.lead_id)?.customer_id!==parent.customer_id||leadAfter.at!==parent.converted_at||leadAfter.actorId!==parent.created_by||req.customer.kind==='new'&&parent.customer_child_operation_id!==customer.operationId)throw Error('REVIEW_SNAPSHOT_INVALID');
    validateLeadHistoryChange('edit',leadBefore.after,leadAfter.after);
    const children=[...links.values()].filter(row=>row.conversion_id===parent.id),vs=[],as=[],destV=new Map(),destA=new Map();
    for(const link of children){const vehicle=link.lead_vehicle_id!==null,resource=vehicle?'vehicles':'addresses',source=historical(vehicle?'lead-vehicles':'lead-addresses',vehicle?link.lead_vehicle_id:link.lead_address_id,link.source_version,link.source_audit_id),target=historical(resource,vehicle?link.vehicle_id:link.address_id,link.target_version,link.target_audit_id);if(link.created_at!==parent.created_at)throw Error('REVIEW_SNAPSHOT_INVALID');(vehicle?vs:as).push(source.after);if(link.target_child_operation_id===null)(vehicle?destV:destA).set(target.after.id,target.after);else if(target.operationId!==link.target_child_operation_id||link.target_child_operation_id!==reviewConversionChild(businessId,parent.operation_id,parent.id,vehicle?'vehicle':'address',target.after.id))throw Error('REVIEW_SNAPSHOT_INVALID');}
    prepareLeadConversionReview(req,leadBefore.after,vs,as,{customer:req.customer.kind==='existing'?customer.after:null,vehicles:[...destV.values()],addresses:[...destA.values()]});
    for(const [resource,target]of [['customers',req.customer],...req.vehicles.map(m=>['vehicles',m.target]),...req.addresses.map(m=>['addresses',m.target])])if(target.kind==='new'){
     const original=historical(resource,target.id,'1'),c=configurations[resource],draft=c.parseDraft(target.draft),fields=c.build(draft,null,records['lead-sources']);
     if(original.operationId!==reviewConversionChild(businessId,parent.operation_id,parent.id,resource==='customers'?'customer':resource==='vehicles'?'vehicle':'address',target.id)||Object.entries(fields).some(([key,value])=>!same(original.after[key],value))||resource==='addresses'&&original.after.customer_id!==req.customer.id)throw Error('REVIEW_SNAPSHOT_INVALID');
    }
   }
  },
  reset(){conversions.clear();links.clear();audits.clear();linkAudits.clear();}
 };
}
