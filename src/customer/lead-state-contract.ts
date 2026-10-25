import {customerUuid,customerVersion,customerInstant,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {leadStates} from './lead-contract.ts';
import type {LeadState} from './lead-contract.ts';

// BR02.2: these targets need no commercial event. Quote Sent and Won belong
// to future confirmed-send/acceptance commands, never this owner input.
export const manualLeadTargets=['new','contacted','awaiting_information','quote_needed','follow_up','lost'] as const;
export type ManualLeadTarget=(typeof manualLeadTargets)[number];
export type LeadStateDraft=Readonly<{fromState:LeadState;toState:ManualLeadTarget;reason:string|null}>;

function reasonText(value:unknown):value is string{
  if(typeof value!=='string'||value.length>2000||value.trim().length===0)return false;
  const points=[...value];
  return points.length<=1000&&points.every(point=>{
    const n=point.codePointAt(0)!;
    return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);
  });
}

export function parseLeadStateDraft(value:unknown):LeadStateDraft{
  requireCustomer(exactCustomerObject(value,['fromState','toState','reason']));
  requireCustomer(leadStates.includes(value.fromState as LeadState)
    &&manualLeadTargets.includes(value.toState as ManualLeadTarget)
    &&value.fromState!==value.toState
    &&(value.reason===null||reasonText(value.reason)));
  const reopening=value.fromState==='lost'||value.fromState==='won';
  // A won opportunity can reopen to an active state with a reason; cancelling
  // its job does not turn the historical win into a lost opportunity.
  requireCustomer(!(reopening&&value.toState==='lost'));
  requireCustomer(!(reopening||value.toState==='lost')||reasonText(value.reason));
  // The command must compare fromState AND expectedVersion under the lead lock.
  // This parser is data validation and grants no transition/write authority.
  return Object.freeze({...value}) as LeadStateDraft;
}

export const leadEventColumns=['id','business_id','lead_id','lead_version','from_state','to_state','reason','effective_at','quote_send_id','acceptance_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type LeadEvent=Readonly<{id:string;business_id:string;lead_id:string;lead_version:string;from_state:LeadState;to_state:ManualLeadTarget;reason:string|null;effective_at:string;quote_send_id:null;acceptance_id:null;version:'1';created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual';operation_id:string;import_row_id:null}>;
// Only the manual source defined in migration38; future commercial events
// require a reviewed schema/contract change with genuine source references.
export function parseLeadEvent(value:unknown,businessId:string):LeadEvent{
  requireCustomer(exactCustomerObject(value,leadEventColumns)&&customerUuid(businessId)&&value.business_id===businessId
    &&customerUuid(value.id)&&customerUuid(value.lead_id)&&customerVersion(value.lead_version)&&BigInt(value.lead_version)>1n
    &&customerUuid(value.created_by)&&value.updated_by===value.created_by&&customerUuid(value.operation_id)
    &&value.version==='1'&&value.origin==='manual'&&value.import_row_id===null&&value.quote_send_id===null&&value.acceptance_id===null
    &&customerInstant(value.effective_at)&&value.created_at===value.effective_at&&value.updated_at===value.effective_at);
  parseLeadStateDraft({fromState:value.from_state,toState:value.to_state,reason:value.reason});
  return Object.freeze({...value}) as LeadEvent;
}
