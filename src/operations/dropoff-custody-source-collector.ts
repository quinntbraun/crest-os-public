import 'server-only';
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {custodySourceGroups,custodySourceKey,formatDropoffCustodySources} from './dropoff-custody-source.ts';
import {pickupCustodySourceGroups,pickupCustodySourceKey,pickupReturnCustodySourceGroups,pickupReturnCustodySourceProfile,pickupReturnFailureSourceGroups,pickupReturnFailureSourceProfile} from './pickup-custody-source.ts';

type Connection=Readonly<{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}>;
function check(value:unknown):asserts value{if(!value)throw Error('CUSTODY_SOURCE_REVIEW_REQUIRED');}
async function collectCustodyRows<Group extends string>(connection:Connection,businessId:string,historyEvidence:string,signal:AbortSignal,
 deadline:number,mode:'dropoff'|'pickup',baseGroups:readonly Group[],sourceKey:(group:Group,row:Record<string,unknown>)=>unknown,
 pickupGroups?:Readonly<{returns:readonly Group[];failures:readonly Group[]}>){
 check(customerUuid(businessId));
 const live=()=>{signal.throwIfAborted();check(performance.now()<deadline);};
 async function value(sql:string,args:unknown[]){
  live();const result=await connection.query(sql,args);live();check(result.rows.length===1);return result.rows[0]!.value;
 }
 const prefix='crest_commands.'+mode+'_custody_source_';
 const context=await value('SELECT '+prefix+'context($1) AS value',[businessId]);
 check(exact(context,['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts']));
 const groups=mode==='pickup'&&context.schemaVersion===3&&context.profile===pickupReturnFailureSourceProfile?pickupGroups?.failures:
  mode==='pickup'&&context.schemaVersion===2&&context.profile===pickupReturnCustodySourceProfile?pickupGroups?.returns:
  context.schemaVersion===1&&context.profile==='crest.'+mode+'-custody-source.v1'?baseGroups:undefined;
 check(groups&&context.businessId===businessId&&typeof context.snapshotToken==='string'&&
  /^[a-f0-9]{64}$/.test(context.snapshotToken)&&exact(context.expectedCounts,groups));
 const rows=Object.fromEntries(groups.map(group=>[group,[] as Record<string,unknown>[]]));
 let count=0;
 for(const group of groups){
  const expected=context.expectedCounts[group];check(customerVersion(expected,true)&&BigInt(expected)<=10000n);
  let after:string|null=null;
  for(;;){
   const page=await value('SELECT '+prefix+'page($1,$2,$3,$4,20) AS value',[businessId,context.snapshotToken,group,after]);
   check(exact(page,['schemaVersion','businessId','snapshotToken','group','rows','hasMore'])&&page.schemaVersion===context.schemaVersion&&
    page.businessId===businessId&&page.snapshotToken===context.snapshotToken&&page.group===group&&Array.isArray(page.rows)&&
    typeof page.hasMore==='boolean'&&page.rows.length<=20&&(!page.hasMore||page.rows.length===20));
   for(const row of page.rows){
    check(row&&typeof row==='object');
    const key=sourceKey(group,row);
    check(customerUuid(key)&&(after===null||key>after)&&++count<=10000);
    after=key;rows[group]!.push(row);
   }
   if(!page.hasMore)break;
  }
  check(BigInt(rows[group]!.length)===BigInt(expected));
 }
 live();return {context,rows,historyEvidence};
}

function privateCustody<T>(value:T){
 return Object.freeze({forServer:()=>value,toJSON():never{throw Error('CUSTODY_SOURCE_PRIVATE');}});
}
export async function collectDropoffCustodySourcesInSnapshot(connection:Connection,businessId:string,historyEvidence:string,signal:AbortSignal){
 const deadline=performance.now()+30000;
 const input=await collectCustodyRows(connection,businessId,historyEvidence,signal,deadline,'dropoff',custodySourceGroups,custodySourceKey);
 const archive=formatDropoffCustodySources(input);signal.throwIfAborted();check(performance.now()<deadline);
 return privateCustody(archive);
}
export async function collectPickupAndDropoffCustodyInputsInSnapshot(connection:Connection,businessId:string,historyEvidence:string,signal:AbortSignal){
 const deadline=performance.now()+30000;
 const custody=await collectCustodyRows(connection,businessId,historyEvidence,signal,deadline,'dropoff',custodySourceGroups,custodySourceKey);
 const pickupCustody=await collectCustodyRows(connection,businessId,historyEvidence,signal,deadline,'pickup',pickupCustodySourceGroups,pickupCustodySourceKey,{returns:pickupReturnCustodySourceGroups,failures:pickupReturnFailureSourceGroups});
 check(custody.context.historySnapshotToken===pickupCustody.context.historySnapshotToken);
 return privateCustody(Object.freeze({custody,pickupCustody}));
}
