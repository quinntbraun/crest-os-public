import 'server-only';
import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyApplicationRow,legacyIdentitySourceKey} from './legacy-contact-application-contract.ts';

type Query=(text:string,parameters:unknown[])=>Promise<{rows:{result:unknown}[]}>;
const statement='SELECT crest_commands.legacy_contact_application_source_page($1,$2,$3,$4,$5,$6,$7,$8) AS result';
const kinds=['identity','application','outcome'] as const;
const keySets={
 identity:['business_id','source_namespace','entity_kind','external_id','customer_id','vehicle_id','first_batch_id','first_evidence_sha256',
  'first_source_row','first_decision_revision','first_apply_operation_id','created_by','created_at'],
 application:['business_id','batch_id','evidence_sha256','operation_id','applied_by'],
 outcome:['business_id','batch_id','source_row','decision_revision','customer_action','customer_id','customer_version','vehicle_action','vehicle_id','vehicle_version'],
};
const digest=(value:unknown)=>typeof value==='string'&&value.length===64&&/^[a-f0-9]+$/.test(value);
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$(?![\s\S])/;
const pageSize=100;
type Key={batch:string;row:number|null}|{namespace:string;entityKind:string;externalId:string};

function strictlyAfter(previous:Key|null,current:Key){
 if(previous===null)return true;
 if('batch' in previous&&'batch' in current){
  return current.batch>previous.batch||current.batch===previous.batch&&current.row!==null&&previous.row!==null&&current.row>previous.row;
 }
 if('namespace' in previous&&'namespace' in current){
  if(current.namespace!==previous.namespace)return current.namespace>previous.namespace;
  if(current.entityKind!==previous.entityKind)return current.entityKind>previous.entityKind;
  return Buffer.compare(Buffer.from(current.externalId),Buffer.from(previous.externalId))>0;
 }
 return false;
}

function recordKey(kind:typeof kinds[number],record:unknown,businessId:string):Key{
 check(exact(record,keySets[kind])&&record.business_id===businessId);
 if(kind==='identity'){
  const {source_namespace,entity_kind,external_id,first_source_row,first_decision_revision}=record;
  check(legacyIdentitySourceKey(source_namespace)&&(entity_kind==='customer'||entity_kind==='vehicle')&&typeof external_id==='string'&&
   [...external_id].length>=1&&[...external_id].length<=200&&
   [...external_id].every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)!==127)&&customerUuid(record.first_batch_id)&&
   digest(record.first_evidence_sha256)&&typeof first_source_row==='number'&&Number.isInteger(first_source_row)&&first_source_row>=2&&first_source_row<=100001&&
   typeof first_decision_revision==='number'&&Number.isInteger(first_decision_revision)&&first_decision_revision>=1&&first_decision_revision<=2147483647&&
   customerUuid(record.first_apply_operation_id)&&customerUuid(record.created_by)&&typeof record.created_at==='string'&&utc.test(record.created_at)&&
   (entity_kind==='customer'?customerUuid(record.customer_id)&&record.vehicle_id===null:customerUuid(record.vehicle_id)&&record.customer_id===null));
  return {namespace:source_namespace,entityKind:entity_kind,externalId:external_id};
 }
 check(customerUuid(record.batch_id));
 if(kind==='application'){
  check(customerUuid(record.operation_id)&&customerUuid(record.applied_by)&&digest(record.evidence_sha256));
  return {batch:record.batch_id,row:null};
 }
 const row=record.source_row;
 check(typeof row==='number');
 legacyApplicationRow({row,decisionRevision:record.decision_revision,customerAction:record.customer_action,customerId:record.customer_id,
  customerVersion:record.customer_version,vehicleAction:record.vehicle_action,vehicleId:record.vehicle_id,vehicleVersion:record.vehicle_version},row);
 return {batch:record.batch_id,row};
}

/** Caller supplies an authorized, private read-only repeatable-read transaction. */
export async function* captureLegacyContactApplicationSource(query:Query,businessId:string,signal:AbortSignal){
 check(customerUuid(businessId));
 signal.throwIfAborted();
 yield JSON.stringify({schemaVersion:1,scope:'legacy_contact_applications',businessId})+'\n';
 for(const kind of kinds){
  let cursor:Key|null=null;
  for(;;){
   signal.throwIfAborted();
   const position:unknown[]=cursor&&'batch' in cursor?[cursor.batch,cursor.row,null,null,null]:
    cursor?[null,null,cursor.namespace,cursor.entityKind,cursor.externalId]:[null,null,null,null,null];
   const response=await query(statement,[businessId,kind,...position,pageSize]);
   signal.throwIfAborted();
   check(response.rows.length===1);
   const page=response.rows[0]!.result;
   check(exact(page,['schemaVersion','businessId','kind','rows','hasMore'])&&page.schemaVersion===1&&page.businessId===businessId&&
    page.kind===kind&&Array.isArray(page.rows)&&page.rows.length<=pageSize&&typeof page.hasMore==='boolean'&&(!page.hasMore||page.rows.length===pageSize));
   for(const record of page.rows){
    signal.throwIfAborted();
    const key=recordKey(kind,record,businessId);
    check(strictlyAfter(cursor,key));
    cursor=key;
    yield JSON.stringify({kind,record})+'\n';
   }
   if(!page.hasMore)break;
  }
 }
}
