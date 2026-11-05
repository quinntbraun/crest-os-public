// Review-only memory store. Never imported by the production application.
// Uses shared production data validators; it does not implement PostgreSQL/Auth.
import {randomUUID} from 'node:crypto';
import {customerUuid,customerVersion,exactCustomerObject,parseCustomerDraft,parseCustomer} from '../src/customer/customer-contract.ts';
import {parseVehicleDraft,vehicleVinHint,parseAddressDraft} from '../src/customer/customer-resource-contract.ts';
import {parseCustomerAddress} from '../src/customer/customer-address-contract.ts';
import {parseVehicle} from '../src/customer/vehicle-contract.ts';
import {parseLeadDraft,parseLead,parseLeadSourceDraft,parseLeadSource} from '../src/customer/lead-contract.ts';
import {createReviewAssociations} from './associations.mjs';
import {createReviewConversions} from './conversions.mjs';
import {parseLeadStateSave,parseLeadStateCommitted,parseLeadStatePage} from '../src/customer/lead-state-command-contract.ts';
import {parseLeadEvent} from '../src/customer/lead-state-contract.ts';
import {validateLeadHistoryChange,sameLead} from '../src/customer/lead-history-contract.ts';
import {leadVehicleWireDraftKeys,parseLeadVehicleWireDraft} from '../src/customer/lead-vehicle-http-contract.ts';
import {parseLeadVehicle} from '../src/customer/lead-vehicle-contract.ts';
import {parseLeadVehicleCommitted,parseLeadVehiclePage,parseLeadVehicleHistory} from '../src/customer/lead-vehicle-command-contract.ts';
import {parseLeadAddress} from '../src/customer/lead-address-contract.ts';
import {parseLeadAddressCommitted,parseLeadAddressPage,parseLeadAddressHistory} from '../src/customer/lead-address-command-contract.ts';
const businessId='11111111-1111-4111-8111-111111111111',actorId='33333333-3333-4333-8333-333333333333';
const stamp=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
const phone=value=>value===null?null:value.replace(/[^0-9]/g,'')||null;
const email=value=>value===null?null:value.trim().toLowerCase()||null;
const copy=value=>structuredClone(value);
const configurations={
 addresses:{id:'addressId',parent:'customerId',singular:'address',version:'addressVersion',fields:['line1','line2','city','region','postalCode','country','exactLocationText','instructions','latitude','longitude','geocodeSource','geocodeAccuracy','verifiedAt','archived','archiveReason'],parseDraft:parseAddressDraft,parse:parseCustomerAddress,build:d=>({line1:d.line1,line2:d.line2,city:d.city,region:d.region,postal_code:d.postalCode,country:d.country,exact_location_text:d.exactLocationText,instructions:d.instructions,latitude:d.latitude,longitude:d.longitude,geocode_source:d.geocodeSource,geocode_accuracy:d.geocodeAccuracy,verified_at:d.verifiedAt})},
 customers:{id:'customerId',singular:'customer',version:'customerVersion',fields:['displayName','phone','email','contactPreference','outreachOptOut','notes','customerSince','archived','archiveReason'],parseDraft:parseCustomerDraft,parse:parseCustomer,build:d=>({display_name:d.displayName,phone_raw:d.phone,phone_normalized:phone(d.phone),email_raw:d.email,email_normalized:email(d.email),contact_preference:d.contactPreference,outreach_opt_out:d.outreachOptOut,notes:d.notes,customer_since:d.customerSince})},
 vehicles:{id:'vehicleId',singular:'vehicle',version:'vehicleVersion',fields:['label','year','make','model','color','vin','plate','kind','notes','archived','archiveReason'],parseDraft:parseVehicleDraft,parse:parseVehicle,build:d=>({label:d.label,year:d.year,make:d.make,model:d.model,color:d.color,vin_raw:d.vin,vin_normalized:vehicleVinHint(d.vin),plate:d.plate,kind:d.kind,notes:d.notes})},
 leads:{id:'leadId',singular:'lead',version:'leadVersion',fields:['label','customerId','sourceId','referralText','phone','email','requestedScope','availability','estimatedCents','followUpAt','notes'],parseDraft:parseLeadDraft,parse:parseLead,build:(d,before,sources)=>({label:d.label,customer_id:d.customerId,source_id:d.sourceId,source_snapshot:d.sourceId===null?null:copy(sources.get(d.sourceId)),referral_text:d.referralText,phone_raw:d.phone,phone_normalized:phone(d.phone),email_raw:d.email,email_normalized:email(d.email),requested_scope:d.requestedScope,availability:d.availability,estimated_cents:d.estimatedCents,state:before?.state??'new',follow_up_at:d.followUpAt,lost_reason:before?.lost_reason??null,notes:d.notes})},
 'lead-sources':{id:'leadSourceId',singular:'leadSource',version:'leadSourceVersion',fields:['label','kind','active','referralCustomerId'],parseDraft:parseLeadSourceDraft,parse:parseLeadSource,build:d=>({label:d.label,label_normalized:d.label.trim().toLowerCase(),kind:d.kind,active:d.active,referral_customer_id:d.referralCustomerId})},
 'lead-vehicles':{id:'leadVehicleId',parent:'leadId',parentResource:'leads',parentColumn:'lead_id',singular:'leadVehicle',version:'leadVehicleVersion',fields:leadVehicleWireDraftKeys,parseDraft:parseLeadVehicleWireDraft,parse:parseLeadVehicle,build:d=>({vehicle_id:d.vehicleId,reported_vehicle:d.reportedVehicle,requested_services:d.requestedServices,condition_notes:d.conditionNotes})}
};
configurations['lead-addresses']={...configurations.addresses,id:'leadAddressId',parent:'leadId',parentResource:'leads',parentColumn:'lead_id',singular:'leadAddress',version:'leadAddressVersion',parse:parseLeadAddress};
const leadChildren={
 vehicle:{resource:'lead-vehicles',id:'leadVehicleId',rows:'leadVehicles',parseCommitted:parseLeadVehicleCommitted,parsePage:parseLeadVehiclePage,parseHistory:parseLeadVehicleHistory},
 address:{resource:'lead-addresses',id:'leadAddressId',rows:'leadAddresses',parseCommitted:parseLeadAddressCommitted,parsePage:parseLeadAddressPage,parseHistory:parseLeadAddressHistory}
};
export function createReviewData(initial){
 let epoch=randomUUID(),events=0;const records={},histories={},operations=new Map(),activity=[],stateEvents=new Map(),stateAudits=new Map();
 for(const resource of Object.keys(configurations)){records[resource]=new Map();histories[resource]=new Map();}
 const associations=createReviewAssociations({businessId,actorId,epoch:()=>epoch,customers:records.customers,vehicles:records.vehicles,operations});
 const conversions=createReviewConversions({businessId,actorId,epoch:()=>epoch,records,histories,operations,configurations,room:n=>events+conversions.eventCount()+n<=1000,commit(changes,childOperations){
  for(const change of changes){records[change.resource].set(change.row.id,change.row);histories[change.resource].set(change.row.id,[...(histories[change.resource].get(change.row.id)??[]),change.event]);}
  for(const entry of childOperations)operations.set(entry.id,entry.value);events+=changes.length;
 }});
 function leadState(route,input){
  if(route==='state-operation'){
   if(Object.keys(input).length!==1||!customerUuid(input.operationId))throw Error('REVIEW_INPUT_INVALID');
   const prior=operations.get(input.operationId);return{status:200,value:prior?.resource==='lead-state'?copy(prior.result):{state:'absent'}};
  }
  if(route==='state-events'){
   if(Object.keys(input).length!==3||!customerUuid(input.leadId)||!customerVersion(input.afterVersion,true)||!Number.isInteger(input.pageSize)||input.pageSize<1||input.pageSize>50)throw Error('REVIEW_INPUT_INVALID');
   const row=records.leads.get(input.leadId);if(!row)return{status:200,value:{state:'absent'}};
   const all=[...stateEvents.values()].filter(e=>e.lead_id===row.id&&BigInt(e.lead_version)>BigInt(input.afterVersion)).sort((a,b)=>Number(BigInt(a.lead_version)-BigInt(b.lead_version)));
   const page={schemaVersion:1,businessId,leadId:row.id,leadVersion:row.version,events:copy(all.slice(0,input.pageSize)),hasMore:all.length>input.pageSize};parseLeadStatePage(page,businessId,row.id,input.afterVersion,input.pageSize);return{status:200,value:page};
  }
  const {schemaVersion,operationId,recoveryEpoch,leadId,expectedVersion,...draft}=input;
  const command=parseLeadStateSave({schemaVersion,businessId,operationId,recoveryEpoch,leadId,expectedVersion,draft});if(recoveryEpoch!==epoch)throw Error('REVIEW_INPUT_INVALID');
  const serialized=JSON.stringify(command),prior=operations.get(operationId);
  if(prior)return prior.resource==='lead-state'&&prior.serialized===serialized?{status:200,value:copy(prior.result)}:{status:409,value:{state:'conflict',reason:'operation'}};
  const before=records.leads.get(leadId);if(!before)return{status:409,value:{state:'conflict',reason:'lead'}};
  if(before.version!==expectedVersion)return{status:409,value:{state:'conflict',reason:'version',currentVersion:before.version}};
  if(before.state!==draft.fromState)return{status:409,value:{state:'conflict',reason:'state'}};
  if(events+conversions.eventCount()+2>1000)return{status:429,value:{error:'REVIEW_CAPACITY_REACHED'}};
  const now=stamp(),version=String(BigInt(expectedVersion)+1n),leadEventId=randomUUID(),leadAuditEventId=randomUUID(),eventAuditEventId=randomUUID();
  const after=parseLead({...before,state:draft.toState,lost_reason:draft.toState==='lost'?draft.reason:null,version,updated_at:now,updated_by:actorId,operation_id:operationId},businessId);
  validateLeadHistoryChange('state_change',before,after);
  const event=parseLeadEvent({id:leadEventId,business_id:businessId,lead_id:leadId,lead_version:version,from_state:draft.fromState,to_state:draft.toState,reason:draft.reason,effective_at:now,quote_send_id:null,acceptance_id:null,version:'1',created_at:now,updated_at:now,created_by:actorId,updated_by:actorId,origin:'manual',operation_id:operationId,import_row_id:null},businessId);
  const result=parseLeadStateCommitted({state:'committed',operationId,recoveryEpoch,receipt:{schemaVersion:1,businessId,leadId,leadVersion:version,leadEventId,leadAuditEventId,eventAuditEventId}},businessId,operationId);
  // Validate both retained images and the receipt before changing sample memory.
  const audit={version,eventId:leadAuditEventId,actorId,operationId,at:now,action:'state_change',before,after};
  records.leads.set(leadId,after);histories.leads.set(leadId,[...histories.leads.get(leadId),audit]);stateEvents.set(leadEventId,event);stateAudits.set(leadEventId,{version:'1',eventId:eventAuditEventId,actorId,operationId,at:now,action:'create',before:null,after:event});operations.set(operationId,{resource:'lead-state',serialized,result});events+=2;
  activity.unshift({id:leadAuditEventId,label:'Status: '+after.label+' → '+after.state.replaceAll('_',' '),at:now,resource:'leads'});activity.splice(12);
  return{status:200,value:copy(result)};
 }
 function save(resource,body){
  const c=configurations[resource];if(!c||body.schemaVersion!==1||!customerUuid(body.operationId)||!customerUuid(body[c.id])||!customerVersion(body.expectedVersion,true)||body.recoveryEpoch!==epoch)throw Error('REVIEW_INPUT_INVALID');
  const keys=['schemaVersion','operationId',c.id,'expectedVersion','recoveryEpoch',...c.parent?[c.parent]:[],...c.fields];
  if(Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))throw Error('REVIEW_INPUT_INVALID');
  const draft=c.parseDraft(Object.fromEntries(c.fields.map(k=>[k,body[k]]))),serialized=JSON.stringify(body),prior=operations.get(body.operationId);
  if(prior)return prior.resource===resource&&prior.serialized===serialized?{status:200,value:copy(prior.result)}:{status:409,value:{state:'conflict',reason:'operation'}};
  const id=body[c.id],before=records[resource].get(id)??null;
  if(resource==='leads'&&conversions.hasLead(id)&&draft.customerId!==conversions.hasLead(id).customer_id)return{status:409,value:{state:'conflict',reason:'converted'}};
  if(c.parent&&(!customerUuid(body[c.parent])||!records[c.parentResource??'customers'].has(body[c.parent])||before&&before[c.parentColumn??'customer_id']!==body[c.parent]))return{status:409,value:{state:'conflict',reason:'parent'}};
  if(resource==='lead-vehicles'&&draft.vehicleId!==null&&!records.vehicles.has(draft.vehicleId))return{status:409,value:{state:'conflict',reason:'vehicle'}};
  if((before?.version??'0')!==body.expectedVersion)return{status:409,value:{state:'conflict',reason:'version',currentVersion:before?.version??'0'}};
  if(events+conversions.eventCount()>=1000||!before&&records[resource].size>=200)return{status:429,value:{error:'REVIEW_CAPACITY_REACHED'}};
  if(resource==='leads'&&(draft.customerId!==null&&!records.customers.has(draft.customerId)||draft.sourceId!==null&&!records['lead-sources'].has(draft.sourceId))||resource==='lead-sources'&&draft.referralCustomerId!==null&&!records.customers.has(draft.referralCustomerId))return{status:409,value:{state:'conflict',reason:'parent'}};
  if(resource==='lead-sources'&&[...records[resource].values()].some(row=>row.id!==id&&row.label_normalized===draft.label.trim().toLowerCase()))return{status:409,value:{state:'conflict',reason:'label'}};
  const now=stamp(),version=String(BigInt(body.expectedVersion)+1n),eventId=randomUUID(),base={id,business_id:businessId,version,created_at:before?.created_at??now,updated_at:now,created_by:before?.created_by??actorId,updated_by:actorId,origin:'manual',operation_id:body.operationId,import_row_id:null};
  const archive=['customers','vehicles','addresses','lead-vehicles','lead-addresses'].includes(resource)?{archived_at:draft.archived?before?.archived_at??now:null,archived_reason:draft.archiveReason}:{};
  const after=c.parse({...base,...c.parent?{[c.parentColumn??'customer_id']:body[c.parent]}:{},...c.build(draft,before,records['lead-sources']),...archive},businessId);
  const action=before===null?'create':['customers','vehicles','addresses','lead-vehicles','lead-addresses'].includes(resource)?before.archived_at===null&&after.archived_at!==null?'archive':before.archived_at!==null&&after.archived_at===null?'reopen':'edit':'edit';
  const event={version,eventId,actorId,operationId:body.operationId,at:now,action,before,after};
  const result={state:'committed',operationId:body.operationId,recoveryEpoch:epoch,receipt:{schemaVersion:1,businessId,...c.parent?{[c.parent]:body[c.parent]}:{},[c.id]:id,[c.version]:version,auditEventId:eventId}};
  const child=Object.values(leadChildren).find(child=>child.resource===resource);if(child)child.parseCommitted(result,businessId,body.operationId);
  // Validation precedes all memory mutations. This is sample history only.
  records[resource].set(id,after);histories[resource].set(id,[...(histories[resource].get(id)??[]),event]);operations.set(body.operationId,{resource,serialized,result});events++;
  activity.unshift({id:eventId,label:(before?'Updated ':'Added ')+(after.display_name??after.label??after.reported_vehicle?.label??after.line1??'an address'),at:now,resource:child?'leads':resource});activity.splice(12);
  return{status:200,value:copy(result)};
 }
 function seed(){
  const customerDraft={phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null};
  const add=(resource,draft)=>{const id=randomUUID();save(resource,{schemaVersion:1,operationId:randomUUID(),[configurations[resource].id]:id,expectedVersion:'0',recoveryEpoch:epoch,...draft});return id;};
  const alex=add('customers',{...customerDraft,displayName:'Alex Morgan (sample)',phone:'202-555-0104',email:'alex@example.com',notes:'Fictional customer. Prefers weekend appointments.'});
  add('customers',{...customerDraft,displayName:'Jordan Lee (sample)',phone:'202-555-0117',notes:'Fictional customer with two vehicles.'});
  add('customers',{...customerDraft,displayName:'Taylor Brooks (sample)',email:'taylor@example.com'});
  const vehicleDraft={year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
  add('vehicles',{...vehicleDraft,label:'2022 Toyota 4Runner (sample)',year:2022,make:'Toyota',model:'4Runner',color:'White'});
  add('vehicles',{...vehicleDraft,label:'2021 Ford F-150 (sample)',year:2021,make:'Ford',model:'F-150',color:'Blue'});
  const source=add('lead-sources',{label:'Customer referral',kind:'Referral',active:true,referralCustomerId:null});
  add('lead-sources',{label:'Website inquiry',kind:'Website',active:true,referralCustomerId:null});
  const leadDraft={customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null};
  add('leads',{...leadDraft,label:'Interior detail inquiry (sample)',customerId:alex,sourceId:source,requestedScope:'Interior cleaning, seats and pet hair.',availability:'A Saturday morning.'});
  add('leads',{...leadDraft,label:'Paint correction inquiry (sample)',requestedScope:'Review paint condition before providing a quote.'});
 }
 function summary(){return{reviewOnly:true,persistence:'memory_until_restart',counts:Object.fromEntries(Object.keys(configurations).map(k=>[k,records[k].size])),activity:copy(activity)};}
 function dispatch(resource,route,body){
  if(resource==='vehicle-associations')return associations.dispatch(route,body);
  if(resource==='leads'&&['convert','conversion-operation','conversion','conversion-links'].includes(route))return conversions.dispatch(route,body);
  if(resource==='leads'&&['state','state-operation','state-events'].includes(route))return leadState(route,body);
  const childRoute=resource==='leads'?/^(vehicle|address)-(save|operation|list|history)$/.exec(route):null;
  if(childRoute){
   const child=leadChildren[childRoute[1]],action=childRoute[2];
   if(action==='save')return save(child.resource,body);
   if(action==='operation'){if(!exactCustomerObject(body,['operationId'])||!customerUuid(body.operationId))throw Error('REVIEW_INPUT_INVALID');const prior=operations.get(body.operationId);return{status:200,value:prior?.resource===child.resource?copy(prior.result):{state:'absent'}};}
   const list=action==='list';
   if(!exactCustomerObject(body,list?['leadId','afterId','includeArchived','pageSize']:['leadId',child.id,'afterVersion','pageSize'])||!customerUuid(body.leadId)||list&&typeof body.includeArchived!=='boolean')throw Error('REVIEW_INPUT_INVALID');
   const lead=records.leads.get(body.leadId);if(!lead)return{status:200,value:{state:'absent'}};
   const found=dispatch(child.resource,list?'list':'history',list?{...body,search:''}:body);
   if(list){const value={schemaVersion:1,businessId,leadId:lead.id,leadVersion:lead.version,[child.rows]:found.value[child.resource],hasMore:found.value.hasMore};child.parsePage(value,businessId,lead.id,body.afterId,body.includeArchived,body.pageSize);return{status:200,value};}
   child.parseHistory(found.value,businessId,lead.id,body[child.id],body.afterVersion,body.pageSize);return found;
  }
  if(!Object.hasOwn(configurations,resource))return{status:503,value:{error:'REVIEW_WORKFLOW_NOT_CONNECTED'}};
  const c=configurations[resource],rows=records[resource],history=histories[resource];
  const parent=c.parent?{[c.parent]:body[c.parent]}:{};
  if(c.parent&&(!customerUuid(body[c.parent])||!records[c.parentResource??'customers'].has(body[c.parent])))throw Error('REVIEW_INPUT_INVALID');
  if(route==='context')return{status:200,value:{schemaVersion:1,businessId,...parent,writeState:'ready',recoveryEpoch:epoch}};
  if(route==='save')return save(resource,body);
  if(route==='operation'){const saved=operations.get(body.operationId);return{status:200,value:saved?.resource===resource?copy(saved.result):{state:'absent'}};}
  if(route==='list'){
   if(typeof body.search!=='string'||[...body.search].length>200||!Number.isInteger(body.pageSize)||body.pageSize<1||body.pageSize>50||body.afterId!==null&&!customerUuid(body.afterId))throw Error('REVIEW_INPUT_INVALID');
   const search=body.search.toLowerCase(),all=[...rows.values()].filter(row=>(!c.parent||row[c.parentColumn??'customer_id']===body[c.parent])&&(body.afterId===null||row.id>body.afterId)&&(resource==='leads'?body.includeLost||row.state!=='lost':resource==='lead-sources'?body.includeInactive||row.active:body.includeArchived||row.archived_at===null)&&(!search||[row.display_name,row.label,row.phone_raw,row.email_raw,row.make,row.model,row.vin_raw,row.plate,row.line1,row.city,row.postal_code].some(v=>typeof v==='string'&&v.toLowerCase().includes(search)))).sort((a,b)=>a.id.localeCompare(b.id));
   return{status:200,value:{schemaVersion:1,businessId,...parent,[resource==='lead-sources'?'leadSources':resource]:copy(all.slice(0,body.pageSize)),hasMore:all.length>body.pageSize}};
  }
  if(route==='history'){
   if(!customerUuid(body[c.id])||!customerVersion(body.afterVersion,true)||!Number.isInteger(body.pageSize)||body.pageSize<1||body.pageSize>20)throw Error('REVIEW_INPUT_INVALID');
   const row=rows.get(body[c.id]);if(!row||c.parent&&row[c.parentColumn??'customer_id']!==body[c.parent])return{status:200,value:{state:'absent'}};
   const all=history.get(row.id).filter(event=>BigInt(event.version)>BigInt(body.afterVersion));
   return{status:200,value:{schemaVersion:1,businessId,...c.parent==='leadId'?{}:parent,[c.singular]:copy(row),history:copy(all.slice(0,body.pageSize)),hasMore:all.length>body.pageSize}};
  }
  return{status:503,value:{error:'REVIEW_WORKFLOW_NOT_CONNECTED'}};
 }
 function restoreLeadStates(initial){
  const rows=initial.records?.['lead-state-events']??[],audits=initial.history?.['lead-state-events']??[];
  if(!Array.isArray(rows)||rows.length>1000||!Array.isArray(audits)||audits.length!==rows.length)throw Error('REVIEW_SNAPSHOT_INVALID');
  const byVersion=new Map(),operationIds=new Set(),auditIds=new Set();
  for(const raw of rows){const event=parseLeadEvent(raw,businessId),key=event.lead_id+':'+event.lead_version;
   if(stateEvents.has(event.id)||!records.leads.has(event.lead_id)||byVersion.has(key)||operationIds.has(event.operation_id))throw Error('REVIEW_SNAPSHOT_INVALID');
   stateEvents.set(event.id,event);byVersion.set(key,event);operationIds.add(event.operation_id);
  }
  for(const audit of audits){const event=stateEvents.get(audit.after?.id);
   if(!exactCustomerObject(audit,['version','eventId','actorId','operationId','at','action','before','after'])||!event||stateAudits.has(event.id)||audit.version!=='1'||audit.action!=='create'||audit.before!==null||!customerUuid(audit.eventId)||auditIds.has(audit.eventId)||audit.eventId===event.id||audit.actorId!==event.created_by||audit.operationId!==event.operation_id||audit.at!==event.effective_at||JSON.stringify(audit.after)!==JSON.stringify(event))throw Error('REVIEW_SNAPSHOT_INVALID');
   stateAudits.set(event.id,copy(audit));auditIds.add(audit.eventId);
  }
  let matched=0;
  for(const chain of histories.leads.values()){let last=null;for(const audit of chain){
   const before=audit.before===null?null:parseLead(audit.before,businessId);validateLeadHistoryChange(audit.action,before,audit.after);
   if(last&&(!before||!sameLead(last,before)))throw Error('REVIEW_SNAPSHOT_INVALID');last=audit.after;
   if(audit.action!=='state_change')continue;
   const event=byVersion.get(audit.after.id+':'+audit.version);
   if(!event||event.from_state!==before.state||event.to_state!==audit.after.state||event.operation_id!==audit.operationId||event.created_by!==audit.actorId||event.effective_at!==audit.at||audit.after.updated_at!==audit.at||audit.eventId===event.id||auditIds.has(audit.eventId)||event.to_state==='lost'&&event.reason!==audit.after.lost_reason)throw Error('REVIEW_SNAPSHOT_INVALID');matched++;
  }}
  if(matched!==rows.length)throw Error('REVIEW_SNAPSHOT_INVALID');
  events+=rows.length;if(events>1000)throw Error('REVIEW_SNAPSHOT_INVALID');
 }
 seed();
 if(initial){
  if(initial.format!=='crest.review-sample.v1'||initial.reviewOnly!==true)throw Error('REVIEW_SNAPSHOT_INVALID');
  operations.clear();
  for(const [resource,c]of Object.entries(configurations)){
   const rows=initial.records?.[resource]??[],history=initial.history?.[resource]??[];if(!Array.isArray(rows)||rows.length>200||!Array.isArray(history)||history.length>1000)throw Error('REVIEW_SNAPSHOT_INVALID');
   records[resource].clear();histories[resource].clear();
   for(const raw of rows){const row=c.parse(raw,businessId);if(records[resource].has(row.id))throw Error('REVIEW_SNAPSHOT_INVALID');records[resource].set(row.id,row);histories[resource].set(row.id,[]);}
   for(const event of history){const after=c.parse(event.after,businessId);if(!records[resource].has(after.id)||event.version!==after.version||!customerUuid(event.operationId)||event.operationId!==after.operation_id)throw Error('REVIEW_SNAPSHOT_INVALID');histories[resource].get(after.id).push(copy(event));}
   for(const row of records[resource].values()){const chain=histories[resource].get(row.id).sort((a,b)=>Number(BigInt(a.version)-BigInt(b.version)));if(chain.length!==Number(row.version)||JSON.stringify(chain.at(-1).after)!==JSON.stringify(row))throw Error('REVIEW_SNAPSHOT_INVALID');}
  }
  for(const child of Object.values(leadChildren))for(const row of records[child.resource].values()){
   if(!records.leads.has(row.lead_id)||child.resource==='lead-vehicles'&&row.vehicle_id!==null&&!records.vehicles.has(row.vehicle_id))throw Error('REVIEW_SNAPSHOT_INVALID');
   const chain=histories[child.resource].get(row.id);let afterVersion='0';
   for(let offset=0;offset<chain.length;offset+=20){const page=chain.slice(offset,offset+20);child.parseHistory({schemaVersion:1,businessId,[configurations[child.resource].singular]:row,history:page,hasMore:offset+20<chain.length},businessId,row.lead_id,row.id,afterVersion,20);afterVersion=page.at(-1).version;}
  }
  events=Object.values(histories).reduce((sum,map)=>sum+[...map.values()].reduce((n,chain)=>n+chain.length,0),0);if(events>1000)throw Error('REVIEW_SNAPSHOT_INVALID');activity.length=0;
  associations.restore(initial);
  restoreLeadStates(initial);
  conversions.restore(initial);if(events+conversions.eventCount()>1000)throw Error('REVIEW_SNAPSHOT_INVALID');
 }
 return{dispatch,summary,customerVehicles:customerId=>associations.customerVehicles(customerId),snapshot:()=>({format:'crest.review-sample.v1',reviewOnly:true,createdAt:stamp(),records:{...conversions.snapshot().records,...Object.fromEntries(Object.entries(records).map(([k,v])=>[k,copy([...v.values()])])),'vehicle-associations':associations.snapshot().records,'lead-state-events':copy([...stateEvents.values()])},history:{...conversions.snapshot().history,...Object.fromEntries(Object.entries(histories).map(([k,v])=>[k,copy([...v.values()].flat())])),'vehicle-associations':associations.snapshot().history,'lead-state-events':copy([...stateAudits.values()])}}),reset(){for(const k of Object.keys(records)){records[k].clear();histories[k].clear();}associations.reset();conversions.reset();stateEvents.clear();stateAudits.clear();operations.clear();activity.length=0;events=0;epoch=randomUUID();seed();return summary();}};
}
