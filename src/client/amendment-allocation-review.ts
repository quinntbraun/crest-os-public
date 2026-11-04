// Read-only BR05/BR06 review of existing commitments. Reuses the genuine
// scheduling reader; never changes allocations or authorizes acceptance.
import {authentication} from './authentication';
import {scheduling} from './scheduling';
import {parseBookingAgreement} from '../operations/booking-context-contract';
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract';

export type AmendmentAllocationBinding=Readonly<{businessId:string;familyId:string;familyVersion:string;agreementId:string;agreementVersion:string;customerId:string;totalCents:string}>;
type Agreement=Exclude<ReturnType<typeof parseBookingAgreement>,{state:'absent'}>;
type State='unassigned'|'assigned'|'completed'|'cancelled';
type Summary=Readonly<{count:number;amountCents:string}>;
export type AmendmentAllocationReview=Readonly<{agreement:Agreement;byState:Readonly<Record<State,Summary>>}>;
export type AmendmentAllocationView=Readonly<{phase:'idle'|'loading'|'ready'|'unavailable';status:string;review:AmendmentAllocationReview|null}>;
export const initialAmendmentAllocationView:AmendmentAllocationView=Object.freeze({phase:'idle',status:'Load saved work to check what is assigned and what remains.',review:null});
const maximum=9223372036854775807n;
function requireReview(value:unknown):asserts value{if(!value)throw Error('AMENDMENT_ALLOCATION_REVIEW_REQUIRED');}
function binding(value:unknown):AmendmentAllocationBinding{
 requireReview(exact(value,['businessId','familyId','familyVersion','agreementId','agreementVersion','customerId','totalCents'])&&['businessId','familyId','agreementId','customerId'].every(key=>customerUuid(value[key]))&&customerVersion(value.familyVersion)&&customerVersion(value.agreementVersion)&&typeof value.totalCents==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value.totalCents)&&BigInt(value.totalCents)<=maximum);
 return Object.freeze({...value}) as AmendmentAllocationBinding;
}
export function bindAmendmentAllocationReview(value:unknown,expected:AmendmentAllocationBinding):AmendmentAllocationReview{
 const pinned=binding(expected),agreement=parseBookingAgreement(value,pinned.businessId,pinned.familyId);
 requireReview(!('state'in agreement)&&agreement.familyVersion===pinned.familyVersion&&agreement.agreementId===pinned.agreementId&&agreement.agreementVersion===pinned.agreementVersion&&agreement.customer.id===pinned.customerId);
 const states:State[]=['unassigned','assigned','completed','cancelled'],counts={unassigned:0,assigned:0,completed:0,cancelled:0},amounts={unassigned:0n,assigned:0n,completed:0n,cancelled:0n};let total=0n;
 for(const source of agreement.sources){total+=BigInt(source.amountCents);for(const part of source.parts){counts[part.state]++;amounts[part.state]+=BigInt(part.amountCents);}}
 requireReview(total===BigInt(pinned.totalCents)&&states.reduce((sum,state)=>sum+amounts[state],0n)===total);
 const byState=Object.freeze(Object.fromEntries(states.map(state=>[state,Object.freeze({count:counts[state],amountCents:amounts[state].toString()})])) as Record<State,Summary>);
 return Object.freeze({agreement,byState});
}
export function createAmendmentAllocationReview(expected:AmendmentAllocationBinding,deps:{change:(view:AmendmentAllocationView)=>void;session?:typeof authentication.session;read?:typeof scheduling.agreement}){
 const pinned=binding(expected),session=deps.session??authentication.session,read=deps.read??scheduling.agreement;
 let alive=true,active:AbortController|null=null;
 const publish=(view:AmendmentAllocationView)=>{if(alive)deps.change(Object.freeze(view));};
 return Object.freeze({
  async load(){
   if(!alive||active)return;const request=new AbortController();active=request;
   publish({phase:'loading',status:'Checking existing work…',review:null});
   const live=()=>alive&&active===request&&!request.signal.aborted;
   try{
    const proof=await session(request.signal);if(!live())return;
    const value=await read(pinned.businessId,pinned.familyId,proof,request.signal);if(!live())return;
    const review=bindAmendmentAllocationReview(value,pinned);if(!live())return;
    publish({phase:'ready',status:'Saved assignments loaded. Proposed changes have not changed this work.',review});
   }catch{if(live())publish({phase:'unavailable',status:'Existing work could not be verified. Reload accepted work if it changed, then check again.',review:null});}
   finally{if(active===request)active=null;}
  },
  clearPrivate(){active?.abort();active=null;publish(initialAmendmentAllocationView);},
  dispose(){alive=false;active?.abort();active=null;}
 });
}
