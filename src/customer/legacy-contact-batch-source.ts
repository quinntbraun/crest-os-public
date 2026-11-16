import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';

type Query=(text:string,parameters:unknown[])=>Promise<{rows:{result:unknown}[]}>;
const batchKeys=['id','business_id','source_label','original_sha256','mapping_version','mapping','mapping_sha256',
 'rows_sha256','row_count','rejected_count','operation_id','created_by','created_at'];
const rowKeys=['business_id','batch_id','source_row','candidate','fingerprint'];
const hash=/^[a-f0-9]{64}$/;

async function capture(query:Query,text:string,parameters:unknown[]){
 const response=await query(text,parameters);
 check(response.rows.length===1);
 return response.rows[0]!.result;
}

/** Stream newline-delimited source records from one caller-owned, read-only repeatable-read snapshot. */
export async function* captureLegacyContactDraftSource(query:Query,businessId:string,signal:AbortSignal){
 check(customerUuid(businessId));
 signal.throwIfAborted();
 yield JSON.stringify({schemaVersion:1,scope:'legacy_contact_drafts',businessId})+'\n';
 let after:string|null=null;
 let more=true;
 while(more){
  signal.throwIfAborted();
  const page=await capture(query,'SELECT crest_commands.legacy_contact_batch_source_page($1,$2,$3) AS result',[businessId,after,20]);
  check(exact(page,['schemaVersion','businessId','batches','hasMore'])&&page.schemaVersion===1&&page.businessId===businessId&&
   Array.isArray(page.batches)&&page.batches.length<=20&&typeof page.hasMore==='boolean'&&(!page.hasMore||page.batches.length===20));
  for(const batch of page.batches){
   check(exact(batch,batchKeys)&&batch.business_id===businessId&&customerUuid(batch.id)&&(after===null||batch.id>after)&&
    typeof batch.rows_sha256==='string'&&hash.test(batch.rows_sha256)&&typeof batch.row_count==='number'&&
    Number.isSafeInteger(batch.row_count)&&batch.row_count>=1&&batch.row_count<=100000&&typeof batch.rejected_count==='number'&&
    Number.isSafeInteger(batch.rejected_count)&&batch.rejected_count>=0&&batch.rejected_count<=batch.row_count);
   yield JSON.stringify({kind:'batch',record:batch})+'\n';
   const digest=createHash('sha256');
   let row=1,rejected=0;
   while(row<batch.row_count+1){
    signal.throwIfAborted();
    const detail=await capture(query,'SELECT crest_commands.legacy_contact_row_source_page($1,$2,$3,$4) AS result',
     [businessId,batch.id,row,100]);
    check(exact(detail,['schemaVersion','businessId','batchId','rows','hasMore'])&&detail.schemaVersion===1&&
     detail.businessId===businessId&&detail.batchId===batch.id&&Array.isArray(detail.rows)&&
     detail.rows.length===Math.min(100,batch.row_count+1-row)&&detail.hasMore===(row+detail.rows.length<batch.row_count+1));
    for(const item of detail.rows){
     check(exact(item,rowKeys)&&item.business_id===businessId&&item.batch_id===batch.id&&item.source_row===row+1&&
      typeof item.fingerprint==='string'&&hash.test(item.fingerprint)&&exact(item.candidate,['customer','vehicle','issues']));
     digest.update(item.fingerprint);
     if(item.candidate.customer===null)rejected++;
     row++;
     yield JSON.stringify({kind:'row',record:item})+'\n';
    }
   }
   check(rejected===batch.rejected_count&&digest.digest('hex')===batch.rows_sha256);
   after=batch.id;
  }
  more=page.hasMore;
 }
}
