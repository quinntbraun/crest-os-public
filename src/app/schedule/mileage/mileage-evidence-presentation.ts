import type {MileageHistoryPage} from '../../../operations/mileage-history';
type Evidence=MileageHistoryPage['evidence'][number];
const fields=[['source','Distance source'],['movement_kind','Type of travel'],['actual_miles','Actual miles'],['estimate_miles','Estimated miles'],['estimate_source','Estimate source'],['odometer_start','Starting odometer'],['odometer_end','Ending odometer'],['allocation_state','Attribution state'],['notes','Notes']] as const;
const allocations=(history:MileageHistoryPage,id:unknown)=>JSON.stringify(history.allocations.filter(row=>row.evidence_id===id).map(row=>[row.job_id,row.fraction]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
export function mileageEvidenceChanges(history:MileageHistoryPage,previous:Evidence|undefined,current:Evidence){
 if(!previous||previous.business_id!==current.business_id||previous.business_id!==history.businessId||previous.leg_id!==current.leg_id||current.leg_id!==history.legId||current.replaces_id!==previous.id||BigInt(String(current.sequence))!==BigInt(String(previous.sequence))+1n)return null;
 const changes:{key:string;label:string;before:string|null;after:string|null}[]=fields.filter(([key])=>previous[key]!==current[key]).map(([key,label])=>({key,label,before:previous[key]===null?null:String(previous[key]),after:current[key]===null?null:String(current[key])}));
 if(allocations(history,previous.id)!==allocations(history,current.id))changes.push({key:'allocations',label:'Job allocations',before:String(previous.id),after:String(current.id)});
 return changes;
}
