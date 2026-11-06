import type {Proof} from './authentication';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingWorkspace,parseBookingAgreement,parseJobResources,parsePendingChangesRequest,parsePendingChangesPage} from '../operations/booking-context-contract.ts';
import type {PendingChangesRequest} from '../operations/booking-context-contract.ts';
import {parseJobListRequest,parseJobListPage,parseJobDetail,parseJobHistoryRequest,parseJobHistoryPage} from '../operations/confirmed-job-read-contract.ts';
import type {JobListRequest,JobHistoryRequest} from '../operations/confirmed-job-read-contract.ts';
import {bookingConflictReasons,requireBooking as check} from '../operations/confirmed-booking-contract.ts';
import {parseBookJobCommand,parseCancelJobCommand,bindBookingCommandReceipt} from '../operations/amended-booking-contract.ts';
import type {BookJobCommand,CancelJobCommand} from '../operations/amended-booking-contract.ts';
import {parseChangeJobScheduleSave,parseRescheduledJobCommitted} from '../operations/confirmed-reschedule-contract.ts';
import type {ChangeJobScheduleSave} from '../operations/confirmed-reschedule-contract.ts';
import {parseFulfillmentModeSave,parseFulfillmentModeCommitted,parseFulfillmentModeHistory} from '../operations/fulfillment-mode-contract.ts';
import type {FulfillmentModeSave} from '../operations/fulfillment-mode-contract.ts';
import {parseBookingConflictRequest,parseBookingConflictReview} from '../operations/booking-conflict-review-contract.ts';
import type {BookingConflictRequest} from '../operations/booking-conflict-review-contract.ts';
import {postScheduling,SchedulingClientError} from './scheduling-transport.ts';
import {parseFieldSessionSave,parseFieldSessionCommitted,fieldSessionConflicts} from '../operations/field-session-contract.ts';
import type {FieldSessionSave} from '../operations/field-session-contract.ts';
export {SchedulingClientError};
function failure(error:unknown,kind:'input'|'unknown'|'unavailable'):never{throw error instanceof SchedulingClientError?error:new SchedulingClientError(kind);}
function conflict(v:unknown,status:number,reasons:readonly string[]){if(status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&typeof v.reason==='string'&&reasons.includes(v.reason))return Object.freeze({state:'conflict' as const,reason:v.reason});return null;}
export const scheduling=Object.freeze({
 async workspace(proof:Proof,signal:AbortSignal){try{
  const r=await postScheduling('workspace',{},proof,signal),v=r.value;check(r.status===200&&exact(v,['schemaVersion','businessId','operatorId','timezone','modeVersion','writeState','recoveryEpoch'])&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding));
  const workspace=parseBookingWorkspace({schemaVersion:v.schemaVersion,businessId:v.businessId,operatorId:v.operatorId,timezone:v.timezone,modeVersion:v.modeVersion},v.businessId as string);check(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null);
  return Object.freeze({...r.amendedSchedulingAvailable===true?{amendedSchedulingAvailable:true as const}:{},...r.fieldSessionAvailable===true?{fieldSessionAvailable:true as const}:{},context:Object.freeze({...workspace,...v.writeState==='ready'?{writeState:'ready' as const,recoveryEpoch:v.recoveryEpoch as string}:{writeState:'paused' as const,recoveryEpoch:null}}),binding:r.binding});
 }catch(e){failure(e,'unavailable');}},
 async reviewSlot(input:BookingConflictRequest,proof:Proof,signal:AbortSignal){let request:BookingConflictRequest;try{request=parseBookingConflictRequest(input);}catch{throw new SchedulingClientError('input');}try{const {businessId,...body}=request,r=await postScheduling('slot-review',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseBookingConflictReview(r.value,request);}catch(e){failure(e,'unavailable');}},
 async agreement(businessId:string,familyId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(familyId));const r=await postScheduling('agreement',{familyId},proof,signal);check(r.status===200);return parseBookingAgreement(r.value,businessId,familyId);}catch(e){failure(e,'unavailable');}},
 async resources(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(jobId));const r=await postScheduling('resources',{jobId},proof,signal);check(r.status===200);return parseJobResources(r.value,businessId,jobId);}catch(e){failure(e,'unavailable');}},
 async read(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(jobId));const r=await postScheduling('read',{jobId},proof,signal);check(r.status===200);return parseJobDetail(r.value,businessId,jobId);}catch(e){failure(e,'unavailable');}},
 async pending(input:PendingChangesRequest,proof:Proof,signal:AbortSignal){try{const request=parsePendingChangesRequest(input),{businessId,...body}=request,r=await postScheduling('pending',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parsePendingChangesPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async list(input:JobListRequest,proof:Proof,signal:AbortSignal){try{const request=parseJobListRequest(input),{businessId,...body}=request,r=await postScheduling('list',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseJobListPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async history(input:JobHistoryRequest,proof:Proof,signal:AbortSignal){try{const request=parseJobHistoryRequest(input),{businessId,...body}=request,r=await postScheduling('history',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseJobHistoryPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async modeHistory(businessId:string,input:{afterSequence:string;pageSize:number},proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&exact(input,['afterSequence','pageSize'])&&version(input.afterSequence,true)&&Number.isInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const body=Object.freeze({...input}),r=await postScheduling('mode-history',body,proof,signal);check(r.status===200);return parseFulfillmentModeHistory(r.value,businessId,body.afterSequence,body.pageSize);}catch(e){failure(e,'unavailable');}},
 async book(input:BookJobCommand,proof:Proof,signal:AbortSignal){let request:BookJobCommand;try{request=parseBookJobCommand(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('book',body,proof,signal),clash=conflict(r.value,r.status,bookingConflictReasons);if(clash)return clash;check(r.status===200);return bindBookingCommandReceipt(r.value,'book',request);
 }catch(e){failure(e,'unknown');}},
 async cancel(input:CancelJobCommand,proof:Proof,signal:AbortSignal){let request:CancelJobCommand;try{request=parseCancelJobCommand(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('cancel',body,proof,signal),clash=conflict(r.value,r.status,['operation','job','version','state']);if(clash)return clash;check(r.status===200);return bindBookingCommandReceipt(r.value,'cancel',request);
 }catch(e){failure(e,'unknown');}},
 async reschedule(input:ChangeJobScheduleSave,proof:Proof,signal:AbortSignal){let request:ChangeJobScheduleSave;try{request=parseChangeJobScheduleSave(input);}catch{throw new SchedulingClientError('input');}try{
  const {businessId,...body}=request,r=await postScheduling('reschedule',body,proof,signal),clash=conflict(r.value,r.status,['operation','job','customer','mode','version','state','appointment','proposal','review']);if(clash)return clash;check(r.status===200);const result=parseRescheduledJobCommitted(r.value,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.jobId===request.jobId&&BigInt(result.receipt.version)===BigInt(request.expectedJobVersion)+1n&&result.receipt.action===request.payload.action);return result;
 }catch(e){failure(e,'unknown');}},
 async saveFieldSession(input:FieldSessionSave,proof:Proof,signal:AbortSignal){let request:FieldSessionSave;try{request=parseFieldSessionSave(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('field-save',body,proof,signal),clash=conflict(r.value,r.status,fieldSessionConflicts);if(clash)return clash;check(r.status===200);return parseFieldSessionCommitted(r.value,request);
 }catch(e){failure(e,'unknown');}},
 async saveModes(input:FulfillmentModeSave,proof:Proof,signal:AbortSignal){let request:FulfillmentModeSave;try{request=parseFulfillmentModeSave(input);}catch{throw new SchedulingClientError('input');}try{
  const {businessId,...body}=request,r=await postScheduling('mode-save',body,proof,signal),clash=conflict(r.value,r.status,['operation','review']);if(clash)return clash;
  if(r.status===409&&exact(r.value,['state','reason','currentSequence'])&&r.value.state==='conflict'&&r.value.reason==='version'&&version(r.value.currentSequence,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:r.value.currentSequence});
  check(r.status===200);const result=parseFulfillmentModeCommitted(r.value,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return result;
 }catch(e){failure(e,'unknown');}}
});
