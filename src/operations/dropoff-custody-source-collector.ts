import 'server-only';
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {custodySourceGroups,custodySourceKey,formatDropoffCustodySources} from './dropoff-custody-source.ts';

type Connection=Readonly<{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}>;
function check(value:unknown):asserts value{if(!value)throw Error('CUSTODY_SOURCE_REVIEW_REQUIRED');}
export async function collectDropoffCustodySourcesInSnapshot(connection:Connection,businessId:string,historyEvidence:string,signal:AbortSignal){
 check(customerUuid(businessId));
 const deadline=performance.now()+30000;
 const live=()=>{signal.throwIfAborted();check(performance.now()<deadline);};
 async function value(sql:string,args:unknown[]){
  live();const result=await connection.query(sql,args);live();check(result.rows.length===1);return result.rows[0]!.value;
 }
 const context=await value('SELECT crest_commands.dropoff_custody_source_context($1) AS value',[businessId]);
 check(exact(context,['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts'])&&
  context.schemaVersion===1&&context.profile==='crest.dropoff-custody-source.v1'&&context.businessId===businessId&&
  typeof context.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(context.snapshotToken)&&exact(context.expectedCounts,custodySourceGroups));
 const rows=Object.fromEntries(custodySourceGroups.map(group=>[group,[] as Record<string,unknown>[]]));
 let count=0;
 for(const group of custodySourceGroups){
  const expected=context.expectedCounts[group];check(customerVersion(expected,true)&&BigInt(expected)<=10000n);
  let after:string|null=null;
  for(;;){
   const page=await value('SELECT crest_commands.dropoff_custody_source_page($1,$2,$3,$4,20) AS value',[businessId,context.snapshotToken,group,after]);
   check(exact(page,['schemaVersion','businessId','snapshotToken','group','rows','hasMore'])&&page.schemaVersion===1&&
    page.businessId===businessId&&page.snapshotToken===context.snapshotToken&&page.group===group&&Array.isArray(page.rows)&&
    typeof page.hasMore==='boolean'&&page.rows.length<=20&&(!page.hasMore||page.rows.length===20));
   for(const row of page.rows){
    check(row&&typeof row==='object');
    const key=custodySourceKey(group,row);
    check(customerUuid(key)&&(after===null||key>after)&&++count<=10000);
    after=key;rows[group]!.push(row);
   }
   if(!page.hasMore)break;
  }
  check(BigInt(rows[group]!.length)===BigInt(expected));
 }
 const archive=formatDropoffCustodySources({context,rows,historyEvidence});live();
 return Object.freeze({forServer:()=>archive,toJSON():never{throw Error('CUSTODY_SOURCE_PRIVATE');}});
}
