import 'server-only';
import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyApplyRequestStatus} from './legacy-contact-application-contract.ts';

type Query=(text:string,parameters:unknown[])=>Promise<{rows:{result:unknown}[]}>;
const statement='SELECT crest_commands.legacy_contact_request_source_page($1::uuid,$2::uuid,$3::integer) AS result';
const keys=['business_id','operation_id','batch_id','evidence_sha256','requested_by','requested_at','status','completed_at','attempt_count'];
const digest=/^[a-f0-9]{64}$(?![\s\S])/;
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$(?![\s\S])/;
const pageSize=100;

/** Caller supplies an authorized, private read-only repeatable-read transaction. */
export async function* captureLegacyContactRequestSource(query:Query,businessId:string,signal:AbortSignal){
 check(customerUuid(businessId));
 signal.throwIfAborted();
 yield JSON.stringify({schemaVersion:1,scope:'legacy_contact_apply_requests',businessId})+'\n';

 let afterOperation:string|null=null;
 for(;;){
  signal.throwIfAborted();
  const response=await query(statement,[businessId,afterOperation,pageSize]);
  signal.throwIfAborted();
  check(response.rows.length===1);
  const page=response.rows[0]!.result;
  check(exact(page,['schemaVersion','businessId','rows','hasMore'])&&page.schemaVersion===1&&page.businessId===businessId&&
   Array.isArray(page.rows)&&page.rows.length<=pageSize&&typeof page.hasMore==='boolean'&&(!page.hasMore||page.rows.length===pageSize));

  for(const row of page.rows){
   signal.throwIfAborted();
   check(exact(row,keys)&&row.business_id===businessId&&customerUuid(row.operation_id)&&
    (afterOperation===null||row.operation_id>afterOperation)&&customerUuid(row.batch_id)&&customerUuid(row.requested_by)&&
    typeof row.evidence_sha256==='string'&&digest.test(row.evidence_sha256)&&typeof row.requested_at==='string'&&utc.test(row.requested_at)&&
    typeof row.attempt_count==='number'&&Number.isInteger(row.attempt_count)&&row.attempt_count>=0&&row.attempt_count<=3);
   const status=legacyApplyRequestStatus({state:row.status,operationId:row.operation_id});
   check(status.state!=='absent'&&(status.state==='queued'?row.completed_at===null:
    typeof row.completed_at==='string'&&utc.test(row.completed_at))&&
     (status.state!=='review'||row.attempt_count===3));
   afterOperation=row.operation_id;
   yield JSON.stringify(row)+'\n';
  }
  if(!page.hasMore)return;
 }
}
