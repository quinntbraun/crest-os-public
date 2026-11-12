import {createHash} from 'node:crypto';
import {customerUuid as uuid,customerInstant as instant,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {verifyBusinessHistoryEvidence} from '../security/business-history-evidence.ts';
import {historyJsonEqual,historyJsonNumber,parseHistoryJson} from '../security/history-evidence-json.ts';
import {parsePickupCollectionSave,parsePickupPolicySave,pickupCollectionKind,pickupPolicyKind,verifyPickupCollectionWrite,verifyPickupPolicyWrite} from './pickup-custody-contract.ts';

const columns={
 pickup_custody_policies:['id','business_id','mode_version_id','sequence','replaces_sequence','reason','created_by',
  'acknowledgement_text','condition_photo_required','recorded_at'],
 pickup_job_policies:['business_id','job_id','policy_id'],
 pickup_custody_collections:['id','business_id','job_id','job_vehicle_id','vehicle_id','pickup_leg_version_id','policy_id',
  'effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','condition_photo_id',
  'acknowledgement_confirmed','created_by','operation_id'],
 pickup_photo_slots:['business_id','photo_id','job_id','job_vehicle_id','collection_id','arrival_version_id','policy_id',
  'job_version','actor_id','recovery_epoch'],
 vehicle_custody_claims:['business_id','vehicle_id','dropoff_case_id','pickup_collection_id']
} as const;
export {columns as pickupCustodySourceColumns};
const keys={pickup_custody_policies:'id',pickup_job_policies:'job_id',pickup_custody_collections:'id',pickup_photo_slots:'photo_id',
 vehicle_custody_claims:'vehicle_id'} as const;
export const pickupCustodySourceGroups=Object.freeze(Object.keys(columns) as (keyof typeof columns)[]);
type Group=typeof pickupCustodySourceGroups[number];
type Row=Readonly<Record<string,string|boolean|null>>;
export type PickupCustodySourceInput=Readonly<{context:unknown;rows:unknown;historyEvidence:string}>;
const profile='crest.pickup-custody-source.v1';
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nullable=new Set(['replaces_sequence','reason','acknowledgement_text','notes','missing_photo_reason','condition_photo_id',
 'acknowledgement_confirmed','dropoff_case_id','pickup_collection_id']);
const booleans=new Set(['condition_photo_required','acknowledgement_confirmed']);
const jsonColumns=['person_snapshot','location_snapshot'] as const;
const commands=new Set<string>([pickupPolicyKind,pickupCollectionKind]);
const entities=new Set(['pickup_custody_policies','pickup_custody_collections']);
function check(ok:unknown):asserts ok{if(!ok)throw Error('PICKUP_CUSTODY_SOURCE_REVIEW_REQUIRED');}
function object(value:unknown):asserts value is Record<string,unknown>{check(value!==null&&typeof value==='object'&&!Array.isArray(value));}
function json(value:unknown){check(typeof value==='string');return parseHistoryJson(value);}
function snapshot(value:unknown){
 check(typeof value==='string');
 const parsed:unknown=JSON.parse(value);
 check(historyJsonEqual(json(value),parseHistoryJson(JSON.stringify(parsed))));
 return parsed;
}
function same(value:unknown,expected:unknown){return historyJsonEqual(value,parseHistoryJson(JSON.stringify(expected)));}
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
export function pickupCustodySourceKey(group:Group,row:Record<string,unknown>){return row[keys[group]];}
function row(group:Group,value:unknown,businessId:string):Row{
 check(exact(value,columns[group])&&value.business_id===businessId);
 for(const name of columns[group]){
  const item=value[name];
  if(item===null){check(nullable.has(name));continue;}
  if(booleans.has(name)){check(typeof item==='boolean');continue;}
  check(typeof item==='string'&&!item.includes('\0')&&Buffer.from(item).toString('utf8')===item);
  if(name==='id'||name.endsWith('_id')||name==='created_by'||name==='recovery_epoch')check(uuid(item));
  else if(name.endsWith('_at'))check(instant(item));
  else if(['sequence','replaces_sequence','job_version'].includes(name))check(version(item));
  else if(name==='person_snapshot'||name==='location_snapshot')object(json(item));
 }
 return Object.freeze({...value}) as Row;
}

export function formatPickupCustodySources(input:PickupCustodySourceInput){
 check(exact(input,['context','rows','historyEvidence'])&&exact(input.context,
  ['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts'])&&
  input.context.schemaVersion===1&&input.context.profile===profile&&uuid(input.context.businessId)&&
  hash(input.context.snapshotToken)&&hash(input.context.historySnapshotToken)&&
  exact(input.context.expectedCounts,pickupCustodySourceGroups)&&exact(input.rows,pickupCustodySourceGroups));
 const {businessId,snapshotToken,historySnapshotToken}=input.context;
 const expectedCounts=Object.freeze({...input.context.expectedCounts});
 const context=Object.freeze({schemaVersion:1 as const,profile,businessId,snapshotToken,historySnapshotToken,expectedCounts});
 const rows={} as Record<Group,readonly Row[]>;
 let total=0,bytes=0;
 for(const group of pickupCustodySourceGroups){
  const source=input.rows[group],count=expectedCounts[group];
  check(version(count,true)&&Array.isArray(source)&&BigInt(count)===BigInt(source.length)&&(total+=source.length)<=10000);
  let last='';
  rows[group]=Object.freeze(source.map(value=>{
   const parsed=row(group,value,businessId),key=pickupCustodySourceKey(group,parsed);
   check(uuid(key)&&key>last);last=key;
   bytes+=Buffer.byteLength(JSON.stringify(parsed));check(bytes<=32*1024*1024);
   return parsed;
  }));
 }
 const history=verifyBusinessHistoryEvidence(input.historyEvidence,{businessId});
 check(history.context.snapshotToken===historySnapshotToken);
 const operations=new Map<string,Record<string,unknown>>(),audits=new Map<string,Record<string,unknown>>();
 const selected=[];
 for(const entry of history.records){
  const evidence=json(entry.canonicalEvidence);object(evidence);object(evidence.row);
  const source=evidence.row;
  const index=entry.kind==='operation'&&commands.has(String(source.command_type))?operations:
   entry.kind==='audit_event'&&entities.has(String(source.entity_kind))?audits:null;
  if(index){check(uuid(source.operation_id)&&!index.has(source.operation_id));index.set(source.operation_id,source);selected.push(entry);}
 }
 function evidence(id:unknown,kind:string,entity:string,sequence:string,actor:unknown){
  check(uuid(id)&&uuid(actor));
  const op=operations.get(id),audit=audits.get(id);
  check(op&&audit&&op.command_type===kind&&op.state==='committed'&&op.origin==='manual'&&op.import_row_id===null&&
   historyJsonNumber(op.schema_version,1)&&historyJsonNumber(op.result_schema_version,1)&&op.created_by===actor&&op.actor_id===actor&&
   audit.entity_kind===entity&&audit.entity_id===id&&audit.entity_version===sequence&&audit.action==='create'&&
   audit.origin==='manual'&&audit.import_row_id===null&&audit.actor_id===actor&&audit.created_by===actor&&uuid(audit.id));
  operations.delete(id);audits.delete(id);
  return {op,audit};
 }
 const policies=new Map(rows.pickup_custody_policies.map(p=>[p.id,p]));
 let prior:Record<string,unknown>|null=null;
 for(const policy of [...policies.values()].sort((a,b)=>BigInt(String(a.sequence))<BigInt(String(b.sequence))?-1:1)){
  const expected=prior===null?'0':String(prior.sequence);
  check(policy.replaces_sequence===(prior===null?null:expected)&&BigInt(String(policy.sequence))===BigInt(expected)+1n);
  const {op,audit}=evidence(policy.id,pickupPolicyKind,'pickup_custody_policies',String(policy.sequence),policy.created_by);
  const body={acknowledgementText:policy.acknowledgement_text,conditionPhotoRequired:policy.condition_photo_required,reason:policy.reason};
  const request=parsePickupPolicySave({schemaVersion:1,businessId,operationId:policy.id,recoveryEpoch:op.recovery_epoch,expectedSequence:expected,body});
  const saved={id:policy.id,modeVersionId:policy.mode_version_id,sequence:policy.sequence,recordedAt:policy.recorded_at,...body};
  const receipt={schemaVersion:1,policy:saved,auditId:audit.id};
  verifyPickupPolicyWrite({state:'committed',receipt},request);
  check(same(json(op.result),receipt)&&same(json(audit.delta),{schemaVersion:1,before:prior,after:saved}));
  prior=saved;
 }
 const jobs=new Map(rows.pickup_job_policies.map(link=>[link.job_id,link.policy_id]));
 for(const policyId of jobs.values())check(policies.has(policyId));
 const collections=new Map(rows.pickup_custody_collections.map(collection=>[collection.id,collection]));
 const slots=new Map(rows.pickup_photo_slots.map(slot=>[slot.photo_id,slot]));
 const claims=new Map(rows.vehicle_custody_claims.map(claim=>[claim.vehicle_id,claim]));
 const usedVehicleTargets=new Set(),usedPhotos=new Set();
 for(const slot of slots.values()){
  check(jobs.get(slot.job_id)===slot.policy_id);
  const collection=collections.get(slot.collection_id);
  if(collection)check(collection.job_id===slot.job_id&&collection.job_vehicle_id===slot.job_vehicle_id&&collection.pickup_leg_version_id===slot.arrival_version_id&&
   collection.policy_id===slot.policy_id&&collection.created_by===slot.actor_id);
 }
 for(const collection of collections.values()){
  const policy=policies.get(collection.policy_id);
  check(policy&&jobs.get(collection.job_id)===policy.id&&claims.get(collection.vehicle_id)?.pickup_collection_id===collection.id&&
   collection.id===collection.operation_id&&!usedVehicleTargets.has(collection.job_vehicle_id)&&
   collection.acknowledgement_confirmed===(policy.acknowledgement_text===null?null:true)&&
   (!policy.condition_photo_required||collection.condition_photo_id!==null));
  usedVehicleTargets.add(collection.job_vehicle_id);
  const {op,audit}=evidence(collection.operation_id,pickupCollectionKind,'pickup_custody_collections','1',collection.created_by);
  const retained=json(op.result);object(retained);object(retained.request);
  const version=retained.request.expectedJobVersion;
  const body={effectiveAt:collection.effective_at,person:snapshot(collection.person_snapshot),location:snapshot(collection.location_snapshot),
   notes:collection.notes,missingPhotoReason:collection.missing_photo_reason,acknowledgementConfirmed:collection.acknowledgement_confirmed,
   ...(collection.condition_photo_id!==null?{conditionPhotoId:collection.condition_photo_id}:{})};
  const request=parsePickupCollectionSave({schemaVersion:1,businessId,operationId:collection.operation_id,recoveryEpoch:op.recovery_epoch,
   jobId:collection.job_id,jobVehicleId:collection.job_vehicle_id,expectedJobVersion:version,pickupLegVersionId:collection.pickup_leg_version_id,
   policyId:collection.policy_id,body});
  if(body.conditionPhotoId){
   const slot=slots.get(body.conditionPhotoId);
   check(slot&&slot.collection_id===collection.id&&slot.job_version===request.expectedJobVersion&&slot.recovery_epoch===op.recovery_epoch&&
    !usedPhotos.has(body.conditionPhotoId));usedPhotos.add(body.conditionPhotoId);
  }
  const projected:Record<string,unknown>={...collection,person_snapshot:body.person,location_snapshot:body.location};
  if(collection.condition_photo_id===null)delete projected.condition_photo_id;
  const receipt={collection:projected,auditId:audit.id};
  verifyPickupCollectionWrite({state:'committed',receipt},request);
  const auditPayload=json(audit.payload);object(auditPayload);
  // History verification has already matched the physical timestamp to the
  // canonical audit payload at microsecond precision.
  check(same(retained,{schemaVersion:1,request:{...request,commandType:pickupCollectionKind,actorId:collection.created_by},receipt})&&
   same(json(audit.delta),{schemaVersion:1,before:null,after:projected})&&auditPayload.effectiveAt===collection.effective_at);
 }
 for(const claim of claims.values()){
  check((claim.dropoff_case_id===null)!==(claim.pickup_collection_id===null));
  if(claim.pickup_collection_id!==null)check(collections.get(claim.pickup_collection_id)?.vehicle_id===claim.vehicle_id);
 }
 check(operations.size===0&&audits.size===0);
 const files:Record<string,string>={},escapes:{table:Group;rowId:string;column:string}[]=[];
 const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 for(const group of pickupCustodySourceGroups){
  const lines=[columns[group].map(quote).join(',')];
  for(const value of rows[group])lines.push(columns[group].map(column=>{
   const original=value[column];if(original===null)return quote('\\N');
   let cell=String(original).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(cell.startsWith("'")||/^[=+@-]/.test(cell.trimStart()))){
    cell="'"+cell;escapes.push({table:group,rowId:String(pickupCustodySourceKey(group,value)),column});
   }
   return quote(cell);
  }).join(','));
  files[group+'.csv']=lines.join('\r\n')+'\r\n';
 }
 files['pickup_custody_source.json']=JSON.stringify({context,rows,historyEvidence:{schemaVersion:1,snapshotToken:historySnapshotToken,records:selected}})+'\n';
 files['pickup_custody_dictionary.json']=JSON.stringify({schemaVersion:1,profile,columns,keyColumns:keys,escapes,
  booleans:[...booleans],jsonTextColumns:jsonColumns,
  decode:'UTF-8 RFC4180 CRLF. Unescaped \\N is null. Remove exactly one mapped apostrophe, then unescape paired backslashes.'})+'\n';
 check(Object.values(files).every(value=>Buffer.byteLength(value)<=32*1024*1024));
 const manifest=JSON.stringify({...context,sourceAuditClosureChecked:true,sharedPhotoInventorySeparate:true,photoBytesIncluded:false,
  referenceClosureComplete:false,completePortableExport:false,completeBackup:false,
  parts:Object.entries(files).map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:digest(content)}))})+'\n';
 return Object.freeze({files:Object.freeze(files),manifest,context,rows:Object.freeze(rows)});
}
export type PickupCustodySources=ReturnType<typeof formatPickupCustodySources>;
