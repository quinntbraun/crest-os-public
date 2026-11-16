import 'server-only';
import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyDecisionReceipt} from './legacy-contact-decision-contract.ts';

type Query=(text:string,parameters:unknown[])=>Promise<{rows:{result:unknown}[]}>;
const statement='SELECT crest_commands.legacy_contact_decision_source_page($1,$2,$3,$4,$5,$6) AS result';
const bindingKeys=['business_id','batch_id','source_namespace','first_operation_id','created_by'];
const decisionKeys=['id','business_id','batch_id','source_row','source_namespace','row_fingerprint','revision',
 'customer_action','customer_id','customer_version','vehicle_action','vehicle_id','vehicle_version','operation_id','created_by','created_at'];
const namespace=/^[a-z][a-z0-9_-]{1,63}$/;
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$/;
const pageSize=100;

/** Preserve literal decimal versions and every superseded decision in one private database snapshot. */
export async function* captureLegacyContactDecisionSource(query:Query,businessId:string,signal:AbortSignal){
 check(customerUuid(businessId));
 signal.throwIfAborted();
 yield JSON.stringify({schemaVersion:1,scope:'legacy_contact_decisions',businessId})+'\n';
 for(const kind of ['binding','decision'] as const){
  let batch:string|null=null,row:number|null=null,revision:number|null=null,more=true;
  while(more){
   signal.throwIfAborted();
   const response=await query(statement,[businessId,kind,batch,row,revision,pageSize]);
   signal.throwIfAborted();
   check(response.rows.length===1);
   const page=response.rows[0]!.result;
   check(exact(page,['schemaVersion','businessId','kind','rows','hasMore'])&&page.schemaVersion===1&&page.businessId===businessId&&
    page.kind===kind&&Array.isArray(page.rows)&&page.rows.length<=pageSize&&typeof page.hasMore==='boolean'&&(!page.hasMore||page.rows.length===pageSize));
   for(const record of page.rows){
    check(exact(record,kind==='binding'?bindingKeys:decisionKeys)&&record.business_id===businessId&&customerUuid(record.batch_id)&&
     customerUuid(record.created_by)&&typeof record.source_namespace==='string'&&namespace.test(record.source_namespace));
    if(kind==='binding'){
     check(customerUuid(record.first_operation_id)&&(batch===null||record.batch_id>batch));
    }else{
     const sourceRow=record.source_row,currentRevision=record.revision;
     check(typeof sourceRow==='number'&&Number.isInteger(sourceRow)&&sourceRow>=2&&sourceRow<=100001&&
      typeof currentRevision==='number'&&Number.isInteger(currentRevision)&&typeof record.created_at==='string'&&utc.test(record.created_at));
     const sameRow=batch===record.batch_id&&row===sourceRow;
     check((batch===null||record.batch_id>batch||batch===record.batch_id&&row!==null&&sourceRow>=row)&&
      currentRevision===(sameRow?revision!+1:1));
     legacyDecisionReceipt({schemaVersion:1,decisionId:record.id,businessId,batchId:record.batch_id,row:sourceRow,
      fingerprint:record.row_fingerprint,sourceNamespace:record.source_namespace,revision:currentRevision,operationId:record.operation_id,
      customerAction:record.customer_action,customerId:record.customer_id,customerVersion:record.customer_version,
      vehicleAction:record.vehicle_action,vehicleId:record.vehicle_id,vehicleVersion:record.vehicle_version},businessId,{batchId:record.batch_id,row:sourceRow});
     row=sourceRow;revision=currentRevision;
    }
    batch=record.batch_id;
    yield JSON.stringify({kind,record})+'\n';
   }
   more=page.hasMore;
  }
 }
}
