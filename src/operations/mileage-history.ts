import {customerUuid,customerVersion,customerInstant} from '../customer/customer-contract.ts';
import {prepareMileageBody} from './mileage.ts';
export const mileageEvidenceColumns=['id','business_id','leg_id','leg_version_id','operator_actor_id','sequence','replaces_id','source','movement_kind','actual_miles','estimate_miles','estimate_source','odometer_start','odometer_end','allocation_state','notes','reason','confirmed_at','confirmed_by','created_at','created_by','operation_id','origin'] as const;
export const mileageAllocationColumns=['id','business_id','evidence_id','leg_id','job_id','fraction','reason','created_at','created_by','operation_id','origin'] as const;
export const mileageAuditColumns=['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','delta','recorded_at','origin'] as const;
type Row=Readonly<Record<string,unknown>>;
export type MileageHistoryPage=Readonly<{schemaVersion:1;state:'loaded';businessId:string;legId:string;throughVersion:string;afterVersion:string;observedLegVersionId:string;evidence:readonly Row[];allocations:readonly Row[];audits:readonly Row[];hasMore:boolean;nextAfterVersion:string|null}>;
export type MileageHistoryQuery=Readonly<{businessId:string;legId:string;afterVersion:string;throughVersion:string|null;pageSize:number}>;
function check(v:unknown):asserts v{if(!v)throw Error('MILEAGE_HISTORY_REQUIRED');}
function record(v:unknown,keys:readonly string[]):Record<string,unknown>{check(v!==null&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));}
function array(v:unknown,limit:number):unknown[]{check(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=limit);const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===v.length+1&&Array.from({length:v.length},(_,i)=>d[i]?.enumerable&&Object.hasOwn(d[i]!,'value')).every(Boolean));return Array.from({length:v.length},(_,i)=>d[i]!.value);}
const equal=(a:Row,b:Row)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
export function parseMileageHistoryQuery(input:unknown):MileageHistoryQuery{
 const {businessId,legId,afterVersion,throughVersion,pageSize}=record(input,['businessId','legId','afterVersion','throughVersion','pageSize']);
 check(customerUuid(businessId)&&customerUuid(legId)&&customerVersion(afterVersion,true)
  &&(throughVersion===null||customerVersion(throughVersion,true))&&typeof pageSize==='number'
  &&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=25);
 return Object.freeze({businessId,legId,afterVersion,throughVersion,pageSize});
}
export function parseMileageHistoryPage(value:unknown,binding:{businessId:string;legId:string;afterVersion:string;throughVersion?:string|null}):MileageHistoryPage{
 check(customerUuid(binding.businessId)&&customerUuid(binding.legId)&&customerVersion(binding.afterVersion,true));
 const p=record(value,['schemaVersion','state','businessId','legId','throughVersion','afterVersion','observedLegVersionId','evidence','allocations','audits','hasMore','nextAfterVersion']);
 check(p.schemaVersion===1&&p.state==='loaded'&&p.businessId===binding.businessId&&p.legId===binding.legId&&p.afterVersion===binding.afterVersion&&customerVersion(p.throughVersion,true)&&BigInt(p.throughVersion)>=BigInt(binding.afterVersion)&&customerUuid(p.observedLegVersionId)&&typeof p.hasMore==='boolean'&&(binding.throughVersion===undefined||binding.throughVersion===null||p.throughVersion===binding.throughVersion));
 const evidence=array(p.evidence,25).map(v=>record(v,mileageEvidenceColumns)),allocations=array(p.allocations,25000).map(v=>record(v,mileageAllocationColumns));
 check(new Set(evidence.map(e=>e.id)).size===evidence.length&&new Set(allocations.map(a=>a.id)).size===allocations.length);
 let version=BigInt(binding.afterVersion),prior:Row|undefined;
 for(const e of evidence){
  check(['id','business_id','leg_id','leg_version_id','operator_actor_id','created_by','operation_id'].every(k=>customerUuid(e[k]))&&e.business_id===p.businessId&&e.leg_id===p.legId&&customerVersion(e.sequence)&&BigInt(e.sequence)===++version&&version<=BigInt(p.throughVersion)&&customerInstant(e.created_at)&&e.origin==='manual');
  check(version===1n?e.replaces_id===null:customerUuid(e.replaces_id)&&e.reason!==null);if(prior)check(e.replaces_id===prior.id);prior=e;
  const parts=allocations.filter(a=>a.evidence_id===e.id),body=prepareMileageBody({source:e.source,movementKind:e.movement_kind,actualMiles:e.actual_miles,estimateMiles:e.estimate_miles,estimateSource:e.estimate_source,odometerStart:e.odometer_start,odometerEnd:e.odometer_end,notes:e.notes,reason:e.reason,allocationState:e.allocation_state,allocations:parts.map(a=>({jobId:a.job_id,fraction:a.fraction}))});
  check(body.actualMiles===e.actual_miles&&body.estimateMiles===e.estimate_miles&&body.odometerStart===e.odometer_start&&body.odometerEnd===e.odometer_end&&body.movementKind===e.movement_kind);
  check(e.actual_miles===null?e.confirmed_at===null&&e.confirmed_by===null:e.confirmed_at===e.created_at&&e.confirmed_by===e.created_by);
 }
 for(const a of allocations){const e=evidence.find(e=>e.id===a.evidence_id);check(e&&['id','business_id','evidence_id','leg_id','job_id','created_by','operation_id'].every(k=>customerUuid(a[k]))&&a.business_id===p.businessId&&a.leg_id===p.legId&&a.operation_id===e.operation_id&&a.created_by===e.created_by&&a.reason===e.reason&&customerInstant(a.created_at)&&a.origin==='manual');}
 const audits=array(p.audits,25025).map((v):Row=>{
  const a=record(v,mileageAuditColumns);check(customerUuid(a.id)&&a.business_id===p.businessId&&customerUuid(a.operation_id)&&customerUuid(a.actor_id)&&customerUuid(a.entity_id)&&customerVersion(a.entity_version)&&customerInstant(a.recorded_at)&&a.origin==='manual');
  const source=a.entity_kind==='mileage_evidence'?evidence.find(e=>e.leg_id===a.entity_id&&e.sequence===a.entity_version):a.entity_kind==='leg_job_allocations'?allocations.find(r=>r.id===a.entity_id):undefined;
  check(source&&a.operation_id===source.operation_id&&a.actor_id===source.created_by&&a.reason===source.reason&&a.action===(a.entity_kind==='mileage_evidence'&&source.sequence!=='1'?'correct':'create')&&(a.entity_kind!=='leg_job_allocations'||a.entity_version==='1'));
  const delta=record(a.delta,['schemaVersion','before','after']),columns=a.entity_kind==='mileage_evidence'?mileageEvidenceColumns:mileageAllocationColumns,after=record(delta.after,columns);check(delta.schemaVersion===1&&equal(after,source));
  const before=delta.before===null?null:record(delta.before,mileageEvidenceColumns);
  if(a.entity_kind==='leg_job_allocations'||source.sequence==='1')check(before===null);else{check(before&&Object.values(before).every(v=>v===null||typeof v==='string')&&before.id===source.replaces_id&&before.business_id===p.businessId&&before.leg_id===p.legId&&customerVersion(before.sequence)&&BigInt(before.sequence)+1n===BigInt(source.sequence as string));const retained=evidence.find(e=>e.id===before.id);if(retained)check(equal(before,retained));}
  return Object.freeze({...a,delta:Object.freeze({schemaVersion:1,before:before&&Object.freeze(before),after:Object.freeze(after)})});
 });
 check(audits.length===evidence.length+allocations.length&&new Set(audits.map(a=>a.id)).size===audits.length&&new Set(audits.map(a=>[a.entity_kind,a.entity_id,a.entity_version].join('/'))).size===audits.length);
 check(p.hasMore?p.nextAfterVersion===version.toString()&&version<BigInt(p.throughVersion)&&evidence.length>0:p.nextAfterVersion===null&&version===BigInt(p.throughVersion));
 const result: MileageHistoryPage={schemaVersion:1,state:'loaded',businessId:binding.businessId,legId:binding.legId,afterVersion:binding.afterVersion,throughVersion:p.throughVersion as string,observedLegVersionId:p.observedLegVersionId as string,hasMore:p.hasMore as boolean,nextAfterVersion:p.nextAfterVersion as string|null,evidence:Object.freeze(evidence.map(e=>Object.freeze(e))),allocations:Object.freeze(allocations.map(a=>Object.freeze(a))),audits:Object.freeze(audits)};
 check(new TextEncoder().encode(JSON.stringify(result)).length<=4194304);return Object.freeze(result);
}
