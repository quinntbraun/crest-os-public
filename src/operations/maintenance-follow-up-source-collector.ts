import 'server-only';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {formatMaintenanceFollowUpSources,maintenanceSourceGroups} from './maintenance-follow-up-source.ts';

type Connection=Readonly<{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}>;
function check(value:unknown):asserts value{if(!value)throw Error('MAINTENANCE_SOURCE_REVIEW_REQUIRED');}

// The trusted worker holds a single read-only repeatable-read transaction for
// the task pages and its business history evidence. SQL enforces that boundary.
export async function collectMaintenanceFollowUpSourcesInSnapshot(connection:Connection,businessId:string,historyEvidence:string,signal:AbortSignal){
 check(uuid(businessId));
 const deadline=performance.now()+30000;
 const live=()=>{signal.throwIfAborted();check(performance.now()<deadline);};
 async function value(sql:string,args:unknown[]){
  live();const result=await connection.query(sql,args);live();check(result.rows.length===1);
  return result.rows[0]!.value;
 }
 const context=await value('SELECT crest_commands.maintenance_follow_up_source_context($1) AS value',[businessId]);
 check(exact(context,['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts'])&&
  context.businessId===businessId&&typeof context.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(context.snapshotToken)&&
  exact(context.expectedCounts,maintenanceSourceGroups));
 const rows:{follow_up_tasks:unknown[];follow_up_task_events:unknown[]}={follow_up_tasks:[],follow_up_task_events:[]};
 let count=0;
 for(const group of maintenanceSourceGroups){
  const expected=context.expectedCounts[group];check(version(expected,true)&&BigInt(expected)<=10000n);
  let after:string|null=null;
  for(;;){
   const page=await value('SELECT crest_commands.maintenance_follow_up_source_page($1,$2,$3,$4,20) AS value',
    [businessId,context.snapshotToken,group,after]);
   check(exact(page,['schemaVersion','businessId','snapshotToken','group','rows','hasMore'])&&page.schemaVersion===1&&
    page.businessId===businessId&&page.snapshotToken===context.snapshotToken&&page.group===group&&
    typeof page.hasMore==='boolean'&&Array.isArray(page.rows)&&page.rows.length<=20&&(!page.hasMore||page.rows.length===20));
   for(const row of page.rows){
    check(row&&typeof row==='object'&&uuid(row.id)&&(after===null||row.id>after)&&++count<=10000);
    after=row.id;rows[group].push(row);
   }
   if(!page.hasMore)break;
  }
  check(BigInt(rows[group].length)===BigInt(expected));
 }
 const archive=formatMaintenanceFollowUpSources({context,rows,historyEvidence});
 live();
 return Object.freeze({forServer:()=>archive,toJSON():never{throw Error('MAINTENANCE_SOURCE_PRIVATE');}});
}
