import {customerInstant,customerUuid,customerVersion,exactCustomerObject,requireCustomer} from './customer-contract.ts';

// Intake only. State changes, conversion and quote events require their own
// transactional commands; editing this draft cannot mark an opportunity Won.
export type LeadDraft=Readonly<{
  label:string;
  customerId:string|null;
  sourceId:string|null;
  referralText:string|null;
  phone:string|null;
  email:string|null;
  requestedScope:string|null;
  availability:string|null;
  estimatedCents:string|null;
  followUpAt:string|null;
  notes:string|null;
}>;

const keys=['label','customerId','sourceId','referralText','phone','email','requestedScope','availability','estimatedCents','followUpAt','notes'] as const;

function text(value:unknown,limit:number,meaningful=false,multiline=false):value is string{
  if(typeof value!=='string'||value.length>limit*2)return false;
  const points=[...value];
  return points.length<=limit&&(!meaningful||value.trim().length>0)&&points.every(c=>{
    const n=c.codePointAt(0)!;
    return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||multiline&&(n===9||n===10||n===13));
  });
}
const optional=(value:unknown,limit:number,meaningful=false,multiline=false):value is string|null=>value===null||text(value,limit,meaningful,multiline);

// PostgreSQL bigint cents stay decimal strings throughout intake and transport.
// Null is unknown; zero is an explicit estimate, never a default price.
export function leadEstimate(value:unknown):value is string{
  return typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
}

export function parseLeadDraft(value:unknown):LeadDraft{
  requireCustomer(exactCustomerObject(value,keys));
  requireCustomer(text(value.label,200,true)
    &&(value.customerId===null||customerUuid(value.customerId))
    &&(value.sourceId===null||customerUuid(value.sourceId))
    &&optional(value.referralText,2000,false,true)
    &&optional(value.phone,512,true)&&optional(value.email,512,true)
    &&optional(value.requestedScope,4000,false,true)
    &&optional(value.availability,4000,false,true)
    &&(value.estimatedCents===null||leadEstimate(value.estimatedCents))
    &&(value.followUpAt===null||customerInstant(value.followUpAt))
    &&optional(value.notes,4000,false,true));
  // Preserve original input. No contact validation, normalization, identity
  // merging, communication permission or existence claim follows from intake.
  return Object.freeze({...value}) as LeadDraft;
}

export type LeadSourceDraft=Readonly<{label:string;kind:string;active:boolean;referralCustomerId:string|null}>;
export const leadSourceColumns=['id','business_id','label','label_normalized','kind','active','referral_customer_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type LeadSource=Readonly<{id:string;business_id:string;label:string;label_normalized:string;kind:string;active:boolean;referral_customer_id:string|null;version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;

export function parseLeadSourceDraft(value:unknown):LeadSourceDraft{
  requireCustomer(exactCustomerObject(value,['label','kind','active','referralCustomerId'])&&text(value.label,200,true)&&text(value.kind,200,true)&&typeof value.active==='boolean'&&(value.referralCustomerId===null||customerUuid(value.referralCustomerId)));
  return Object.freeze({...value}) as LeadSourceDraft;
}
function provenance(value:Record<string,unknown>,businessId:string){
  requireCustomer(customerUuid(businessId)&&value.business_id===businessId&&customerUuid(value.id)&&customerVersion(value.version)&&customerUuid(value.created_by)&&customerUuid(value.updated_by)&&customerUuid(value.operation_id)&&(value.import_row_id===null||customerUuid(value.import_row_id))&&['manual','import','system'].includes(value.origin as string));
  requireCustomer(customerInstant(value.created_at)&&customerInstant(value.updated_at)&&value.updated_at>=value.created_at);
}
export function draftFromLeadSource(value:LeadSource):LeadSourceDraft{return parseLeadSourceDraft({label:value.label,kind:value.kind,active:value.active,referralCustomerId:value.referral_customer_id});}
export function parseLeadSource(value:unknown,businessId:string):LeadSource{
  requireCustomer(exactCustomerObject(value,leadSourceColumns));provenance(value,businessId);
  draftFromLeadSource(value as LeadSource);
  // PostgreSQL supplies the normalized label. Its Unicode case mapping is not
  // replaced with the browser's locale-sensitive implementation.
  requireCustomer(text(value.label_normalized,600,true));
  return Object.freeze({...value}) as LeadSource;
}

export const leadStates=['new','contacted','awaiting_information','quote_needed','quote_sent','follow_up','won','lost'] as const;
export type LeadState=(typeof leadStates)[number];
export const leadColumns=['id','business_id','label','customer_id','source_id','source_snapshot','referral_text','phone_raw','phone_normalized','email_raw','email_normalized','requested_scope','availability','estimated_cents','state','follow_up_at','lost_reason','notes','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type Lead=Readonly<{id:string;business_id:string;label:string;customer_id:string|null;source_id:string|null;source_snapshot:LeadSource|null;referral_text:string|null;phone_raw:string|null;phone_normalized:string|null;email_raw:string|null;email_normalized:string|null;requested_scope:string|null;availability:string|null;estimated_cents:string|null;state:LeadState;follow_up_at:string|null;lost_reason:string|null;notes:string|null;version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export function draftFromLead(value:Lead):LeadDraft{return parseLeadDraft({label:value.label,customerId:value.customer_id,sourceId:value.source_id,referralText:value.referral_text,phone:value.phone_raw,email:value.email_raw,requestedScope:value.requested_scope,availability:value.availability,estimatedCents:value.estimated_cents,followUpAt:value.follow_up_at,notes:value.notes});}
export function parseLead(value:unknown,businessId:string):Lead{
  requireCustomer(exactCustomerObject(value,leadColumns));provenance(value,businessId);draftFromLead(value as Lead);
  requireCustomer(leadStates.includes(value.state as LeadState)&&(value.state==='lost'?text(value.lost_reason,1000,true,true):value.lost_reason===null));
  requireCustomer((value.phone_normalized===null||typeof value.phone_normalized==='string'&&/^[0-9]{1,512}$/.test(value.phone_normalized))&&value.phone_normalized===(typeof value.phone_raw==='string'?value.phone_raw.replace(/[^0-9]/g,'')||null:null));
  requireCustomer(optional(value.email_normalized,1536,true));
  const snapshot=value.source_id===null?null:parseLeadSource(value.source_snapshot,businessId);
  requireCustomer(value.source_id===null?value.source_snapshot===null:snapshot?.id===value.source_id);
  return Object.freeze({...value,source_snapshot:snapshot}) as Lead;
}
