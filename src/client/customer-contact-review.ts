import type {Proof} from './authentication';
import type {customers} from './customers';
import type {Customer,CustomerDraft} from '../customer/customer-contract';

export type ContactMatch=Readonly<{id:string;name:string;archived:boolean;phone:boolean;emailSearch:boolean}>;
export type CustomerContactReview=Readonly<{matches:readonly ContactMatch[];limited:boolean}>;
const asciiTrim=(value:string)=>value.replace(/^ +| +$/g,'');
export function customerContactKeys(value:Pick<CustomerDraft,'phone'|'email'>){
  return {phone:value.phone?.replace(/[^0-9]/g,'')||null,email:value.email===null?null:asciiTrim(value.email)||null};
}

/** Existing authorized search only: advisory candidates, never uniqueness or merge authority. */
export async function reviewCustomerContacts(input:CustomerDraft,current:Customer|null,businessId:string,proof:Proof,signal:AbortSignal,list:typeof customers.list):Promise<CustomerContactReview|null>{
  const keys=customerContactKeys(input);
  // Existing records need another review only when their recorded contact text changes.
  if(current&&current.phone_raw===input.phone&&current.email_raw===input.email)return null;
  const found=new Map<string,{row:Customer;phone:boolean;emailSearch:boolean}>();let limited=false;
  for(const kind of ['phone','email'] as const){
    const value=keys[kind];if(value===null)continue;
    const result=await list(businessId,{search:[...value].slice(0,200).join(''),afterId:null,includeArchived:true,pageSize:50},proof,signal);
    if(signal.aborted)throw Error('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');limited||=result.hasMore;
    for(const row of result.customers){
      if(row.business_id!==businessId)throw Error('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');
      if(row.id===current?.id)continue;
      const phone=kind==='phone'&&row.phone_normalized===keys.phone;
      // PostgreSQL performs the email search using its own collation. Do not
      // silently replace that with JavaScript Unicode lowercasing or claim exact identity.
      const emailSearch=kind==='email'&&row.email_normalized!==null;if(!phone&&!emailSearch)continue;
      const prior=found.get(row.id);
      if(prior&&(prior.row.version!==row.version||prior.row.display_name!==row.display_name||prior.row.phone_raw!==row.phone_raw||prior.row.email_raw!==row.email_raw||prior.row.archived_at!==row.archived_at))throw Error('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');
      found.set(row.id,{row,phone:phone||!!prior?.phone,emailSearch:emailSearch||!!prior?.emailSearch});
    }
  }
  if(found.size===0&&!limited)return null;
  return Object.freeze({matches:Object.freeze([...found.values()].map(({row,phone,emailSearch})=>Object.freeze({id:row.id,name:row.display_name,archived:row.archived_at!==null,phone,emailSearch}))),limited});
}
