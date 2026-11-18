import type {LeadSource} from '../../customer/lead-contract';

const fields=[['label','Source label'],['kind','Source kind'],['active','Status'],['referral_customer_id','Referral customer']] as const;
export function leadSourceChanges(before:LeadSource|null,after:LeadSource){
 if(!before||before.id!==after.id||before.business_id!==after.business_id||!/^[1-9]\d*$/.test(before.version)||!/^[1-9]\d*$/.test(after.version)||BigInt(before.version)+1n!==BigInt(after.version))return null;
 return fields.filter(([key])=>before[key]!==after[key]).map(([key,label])=>({key,label,before:before[key],after:after[key]}));
}
