import {requireCustomer as check} from './customer-contract.ts';
import {leadColumns,leadSourceColumns} from './lead-contract.ts';
import type {Lead} from './lead-contract.ts';
import {manualLeadTargets} from './lead-state-contract.ts';
export function sameLead(a:Lead,b:Lead){
 return leadColumns.every(k=>k==='source_snapshot'?(a.source_snapshot===null||b.source_snapshot===null?a.source_snapshot===b.source_snapshot:leadSourceColumns.every(c=>a.source_snapshot![c]===b.source_snapshot![c])):a[k]===b[k]);
}
// Called after strict row parsing. Reopen reasons live in immutable state
// events; a lead audit image alone cannot establish the original reason.
export function validateLeadHistoryChange(action:unknown,before:Lead|null,after:Lead){
 if(before===null){check(action==='create'&&after.version==='1'&&after.state==='new'&&after.lost_reason===null);return;}
 check(before.id===after.id&&before.business_id===after.business_id&&BigInt(after.version)===BigInt(before.version)+1n);
 for(const key of ['created_at','created_by','origin','import_row_id'] as const)check(before[key]===after[key]);
 if(action==='edit'){check(before.state===after.state&&before.lost_reason===after.lost_reason);return;}
 check(action==='state_change'&&before.state!==after.state&&manualLeadTargets.includes(after.state as (typeof manualLeadTargets)[number])&&!(before.state==='won'&&after.state==='lost'));
 check(sameLead({...after,state:before.state,lost_reason:before.lost_reason,version:before.version,updated_at:before.updated_at,updated_by:before.updated_by,operation_id:before.operation_id},before));
}
