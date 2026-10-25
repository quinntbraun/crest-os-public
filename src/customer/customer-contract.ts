// Data-only boundary shared with the private browser screen. No credentials.
export const customerColumns=['id','business_id','display_name','phone_raw','phone_normalized','email_raw','email_normalized','contact_preference','outreach_opt_out','notes','customer_since','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type CustomerDraft=Readonly<{displayName:string;phone:string|null;email:string|null;contactPreference:string|null;outreachOptOut:boolean;notes:string|null;customerSince:string|null;archived:boolean;archiveReason:string|null}>;
export type Customer=Readonly<{id:string;business_id:string;display_name:string;phone_raw:string|null;phone_normalized:string|null;email_raw:string|null;email_normalized:string|null;contact_preference:string|null;outreach_opt_out:boolean;notes:string|null;customer_since:string|null;archived_at:string|null;archived_reason:string|null;version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export class CustomerDataError extends Error{constructor(){super('CUSTOMER_DATA_INVALID');this.name='CustomerDataError';}}
export function requireCustomer(value:unknown):asserts value{if(!value)throw new CustomerDataError();}
export function exactCustomerObject(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
export function customerUuid(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);}
export function customerVersion(value:unknown,allowZero=false):value is string{return typeof value==='string'&&(allowZero?/^(0|[1-9][0-9]{0,18})$/:/^[1-9][0-9]{0,18}$/).test(value)&&BigInt(value)<=9223372036854775807n;}
function text(value:unknown,limit:number,empty=true,multiline=false):value is string{
  return typeof value==='string'&&[...value].length<=limit&&(empty||value.trim().length>0)&&[...value].every(c=>{const n=c.codePointAt(0)??0;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&!(n<32||n===127)||multiline&&(n===9||n===10||n===13);});
}
const optionalText=(v:unknown,n:number,empty=true,multiline=false):v is string|null=>v===null||text(v,n,empty,multiline);
export function customerDate(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const y=Number(value.slice(0,4)),m=Number(value.slice(5,7)),d=Number(value.slice(8,10));
  return y>=1&&m>=1&&m<=12&&d>=1&&d<=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1]!;
}
export function customerInstant(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.\d{6}Z$/.test(value)&&customerDate(value.slice(0,10));}
export function parseCustomerDraft(value:unknown):CustomerDraft{
  requireCustomer(exactCustomerObject(value,['displayName','phone','email','contactPreference','outreachOptOut','notes','customerSince','archived','archiveReason']));
  requireCustomer(text(value.displayName,200,false)&&optionalText(value.phone,512,false)&&optionalText(value.email,512,false)&&optionalText(value.contactPreference,200)&&typeof value.outreachOptOut==='boolean'&&optionalText(value.notes,2000,true,true)&&(value.customerSince===null||customerDate(value.customerSince))&&typeof value.archived==='boolean');
  requireCustomer(value.archived?text(value.archiveReason,1000,false,true):value.archiveReason===null);
  return Object.freeze({...value}) as CustomerDraft;
}
export function parseCustomer(value:unknown,businessId:string):Customer{
  requireCustomer(exactCustomerObject(value,customerColumns)&&customerUuid(businessId)&&value.business_id===businessId&&customerUuid(value.id)&&customerVersion(value.version)&&customerUuid(value.created_by)&&customerUuid(value.updated_by)&&customerUuid(value.operation_id)&&(value.import_row_id===null||customerUuid(value.import_row_id))&&['manual','import','system'].includes(value.origin as string));
  parseCustomerDraft({displayName:value.display_name,phone:value.phone_raw,email:value.email_raw,contactPreference:value.contact_preference,outreachOptOut:value.outreach_opt_out,notes:value.notes,customerSince:value.customer_since,archived:value.archived_at!==null,archiveReason:value.archived_reason});
  requireCustomer((value.phone_normalized===null||typeof value.phone_normalized==='string'&&/^[0-9]{1,512}$/.test(value.phone_normalized))&&value.phone_normalized===(typeof value.phone_raw==='string'?value.phone_raw.replace(/[^0-9]/g,'')||null:null));
  requireCustomer(optionalText(value.email_normalized,1536,false)&&customerInstant(value.created_at)&&customerInstant(value.updated_at)&&(value.updated_at as string)>=(value.created_at as string)&&(value.archived_at===null||customerInstant(value.archived_at)));
  return Object.freeze({...value}) as Customer;
}
export function draftFromCustomer(customer:Customer):CustomerDraft{return Object.freeze({displayName:customer.display_name,phone:customer.phone_raw,email:customer.email_raw,contactPreference:customer.contact_preference,outreachOptOut:customer.outreach_opt_out,notes:customer.notes,customerSince:customer.customer_since,archived:customer.archived_at!==null,archiveReason:customer.archived_reason});}
