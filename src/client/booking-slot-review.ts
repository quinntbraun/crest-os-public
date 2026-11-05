import {authentication} from './authentication';
import {scheduling} from './scheduling';
import {bookingConflictRequestFields,parseBookingConflictRequest,parseBookingConflictReview} from '../operations/booking-conflict-review-contract';
import type {BookingConflictRequest} from '../operations/booking-conflict-review-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
export type SlotReview=Exclude<ReturnType<typeof parseBookingConflictReview>,{state:'absent'}>;
export type SlotReviewSelection=Readonly<{key:string;review:SlotReview;unknownTravelReviewed:boolean;overrideReason:string}>;
export function bookingSlotInput(context:Context,slot:{start_at:string;end_at:string;travel_before_seconds:number|null;travel_after_seconds:number|null},rescheduledJobId:string|null):BookingConflictRequest|null{
 try{return parseBookingConflictRequest({schemaVersion:1,businessId:context.context.businessId,operatorId:context.context.operatorId,rescheduledJobId,startAt:slot.start_at,endAt:slot.end_at,travelBeforeSeconds:slot.travel_before_seconds,travelAfterSeconds:slot.travel_after_seconds});}catch{return null;}
}
const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&a.context.timezone===b.context.timezone&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch&&(a.context.modeVersion?.sequence??null)===(b.context.modeVersion?.sequence??null);
export function slotReviewKey(context:Context,input:BookingConflictRequest,displayZone:string){
 const q=parseBookingConflictRequest(input);new Intl.DateTimeFormat('en-US',{timeZone:displayZone}).format(0);return JSON.stringify([context.binding,context.context.businessId,context.context.operatorId,context.context.timezone,context.context.writeState,context.context.recoveryEpoch,context.context.modeVersion?.sequence??null,displayZone,...bookingConflictRequestFields.map(key=>q[key])]);
}
export async function readBookingSlotReview(expected:Context,input:BookingConflictRequest,signal:AbortSignal,deps:{api?:typeof scheduling;session?:typeof authentication.session}={}){
 const request=parseBookingConflictRequest(input),api=deps.api??scheduling;if(signal.aborted||expected.context.businessId!==request.businessId||expected.context.operatorId!==request.operatorId||expected.context.writeState!=='ready'||expected.context.recoveryEpoch===null)throw Error('SLOT_REVIEW_UNAVAILABLE');
 const proof=await(deps.session??authentication.session)(signal),before=await api.workspace(proof,signal);if(signal.aborted||!same(expected,before))throw Error('SLOT_REVIEW_CONTEXT_CHANGED');
 const result=await api.reviewSlot(request,proof,signal),after=await api.workspace(proof,signal);if(signal.aborted||!same(before,after)||!same(expected,after))throw Error('SLOT_REVIEW_CONTEXT_CHANGED');
 const parsed=parseBookingConflictReview(result,request);if('state'in parsed)throw Error('SLOT_REVIEW_UNAVAILABLE');return parsed;
}
export function prepareSlotReview(selection:SlotReviewSelection|null,context:Context,input:BookingConflictRequest,displayZone:string){
 if(!selection||selection.key!==slotReviewKey(context,input,displayZone))throw Error('SLOT_REVIEW_REQUIRED');
 const review=parseBookingConflictReview(selection.review,input);if('state'in review||typeof selection.unknownTravelReviewed!=='boolean'||review.unknownTravel&&!selection.unknownTravelReviewed)throw Error('UNKNOWN_TRAVEL_REVIEW_REQUIRED');
 const reason=selection.overrideReason.trim();if(review.conflictingAppointmentIds.length&&(reason===''||[...reason].length>1000))throw Error('OVERLAP_REASON_REQUIRED');
 return Object.freeze({expectedAppointmentIds:review.conflictingAppointmentIds,expectedUnknownTravel:review.unknownTravel,unknownTravelReviewed:selection.unknownTravelReviewed,overrideReason:review.conflictingAppointmentIds.length?reason:null});
}
