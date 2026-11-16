import 'server-only';
import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyApprovalReceipt} from './legacy-contact-approval-contract.ts';

type Query=(text:string,parameters:unknown[])=>Promise<{rows:{result:unknown}[]}>;
const statement='SELECT crest_commands.legacy_contact_approval_source_page($1,$2,$3,$4) AS result';
const keys=['id','business_id','batch_id','source_namespace','evidence_sha256','original_sha256','mapping_sha256',
 'rows_sha256','decisions_sha256','row_count','skipped_rows','operation_id','approved_by','approved_at'];
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$(?![\s\S])/;
const pageSize=100;

/** Use an authorized export connection in a caller-owned read-only repeatable-read snapshot. */
export async function* captureLegacyContactApprovalSource(query:Query,businessId:string,signal:AbortSignal){
 check(customerUuid(businessId));
 signal.throwIfAborted();
 yield JSON.stringify({schemaVersion:1,scope:'legacy_contact_approvals',businessId})+'\n';
 let after:{batch:string;evidence:string}|null=null;
 for(;;){
  signal.throwIfAborted();
  const response=await query(statement,[businessId,after?.batch??null,after?.evidence??null,pageSize]);
  signal.throwIfAborted();
  check(response.rows.length===1);
  const page=response.rows[0]!.result;
  check(exact(page,['schemaVersion','businessId','rows','hasMore'])&&page.schemaVersion===1&&page.businessId===businessId&&
   Array.isArray(page.rows)&&page.rows.length<=pageSize&&typeof page.hasMore==='boolean'&&(!page.hasMore||page.rows.length===pageSize));
  for(const record of page.rows){
   signal.throwIfAborted();
   check(exact(record,keys)&&customerUuid(record.batch_id)&&typeof record.approved_at==='string'&&utc.test(record.approved_at));
   const receipt=legacyApprovalReceipt({
    schemaVersion:1,approvalId:record.id,businessId:record.business_id,batchId:record.batch_id,sourceNamespace:record.source_namespace,
    evidenceSha256:record.evidence_sha256,originalSha256:record.original_sha256,mappingSha256:record.mapping_sha256,rowsSha256:record.rows_sha256,
    decisionsSha256:record.decisions_sha256,rowCount:record.row_count,skippedRows:record.skipped_rows,operationId:record.operation_id,approvedBy:record.approved_by
   },businessId,record.batch_id);
   const {batchId,evidenceSha256}=receipt;
   check(after===null||batchId>after.batch||batchId===after.batch&&evidenceSha256>after.evidence);
   after={batch:batchId,evidence:evidenceSha256};
   yield JSON.stringify({kind:'approval',record})+'\n';
  }
  if(!page.hasMore)return;
 }
}
