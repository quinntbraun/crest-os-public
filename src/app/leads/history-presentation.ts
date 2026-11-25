import type {Lead} from '../../customer/lead-contract';
import {leadSourceColumns} from '../../customer/lead-contract';
import {customerVersion} from '../../customer/customer-contract';

export const leadHistoryFields=[['label','Lead label'],['state','Status'],['customer_id','Linked customer'],['source_id','Selected source'],['source_snapshot','Source attribution snapshot'],['referral_text','Referral evidence'],['phone_raw','Phone'],['email_raw','Email'],['requested_scope','Requested scope'],['availability','Availability'],['estimated_cents','Estimate (USD)'],['follow_up_at','Follow-up (UTC)'],['notes','Notes'],['lost_reason','Lost reason']] as const;
export function leadHistoryChanges(before:Lead|null,after:Lead){
 if(!before||before.id!==after.id||before.business_id!==after.business_id||!customerVersion(before.version)||!customerVersion(after.version)||BigInt(before.version)+1n!==BigInt(after.version))return null;
 return leadHistoryFields.filter(([key])=>key==='source_snapshot'?
  (before.source_snapshot===null||after.source_snapshot===null?before.source_snapshot!==after.source_snapshot:leadSourceColumns.some(field=>before.source_snapshot![field]!==after.source_snapshot![field])):before[key]!==after[key]
 ).map(([key,label])=>({key,label,before:before[key],after:after[key]}));
}
