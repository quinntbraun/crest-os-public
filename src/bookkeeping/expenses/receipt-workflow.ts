import 'server-only';
import {createValidatedFileIntake} from '../../files/validated-file-intake.ts';
import type {createLocalSandboxValidator} from '../../files/local-sandbox-validator.ts';
import type {createReceiptObjectStore} from './receipt-object-store.ts';
import {parseReceiptReservation,parseReceiptCandidate} from './receipt-contract.ts';
import type {ReceiptReservation,ReceiptCandidate} from './receipt-contract.ts';
import {expenseCheck as check,expenseId} from './expense-contract.ts';
type AuthorizedReceipt=Readonly<{reservation:ReceiptReservation;candidate:ReceiptCandidate|null}>;
export type ReceiptAuthority=Readonly<{
 // Each call MUST freshly verify owner/provider/session, exact business and (for
 // write) the reservation's original epoch, then use the restricted SQL commands.
 read:(credential:string,businessId:string,receiptId:string,signal:AbortSignal)=>Promise<AuthorizedReceipt>;
 writable:(credential:string,reservation:ReceiptReservation,signal:AbortSignal)=>Promise<void>;
 publish:(credential:string,reservation:ReceiptReservation,operationId:string,candidate:ReceiptCandidate,signal:AbortSignal)=>Promise<AuthorizedReceipt>;
}>;
export class ReceiptWorkflowError extends Error{constructor(){super('RECEIPT_OPERATION_UNCONFIRMED');this.name='ReceiptWorkflowError';}}
function seal(input:AuthorizedReceipt,businessId:string,receiptId:string){const reservation=parseReceiptReservation(input.reservation);check(reservation.businessId===businessId&&reservation.receiptId===receiptId);return {reservation,candidate:input.candidate===null?null:parseReceiptCandidate(input.candidate,reservation)};}
// Ordinary authenticated byte reads need no decoder or worker dispatch capability.
export function createReceiptDownload(authority:Pick<ReceiptAuthority,'read'>,objects:ReturnType<typeof createReceiptObjectStore>){return async(credential:string,businessId:string,receiptId:string,variant:'original'|'preview',signal:AbortSignal)=>{try{check(expenseId(businessId)&&expenseId(receiptId));const first=seal(await authority.read(credential,businessId,receiptId,signal),businessId,receiptId);check(first.candidate);const bytes=await objects.readAvailable(first.reservation,first.candidate,variant,signal);const latest=seal(await authority.read(credential,businessId,receiptId,signal),businessId,receiptId);check(!signal.aborted&&latest.candidate&&latest.candidate.original.sha256===first.candidate.original.sha256&&latest.candidate.preview.sha256===first.candidate.preview.sha256&&Object.entries(first.reservation).every(([k,v])=>latest.reservation[k as keyof typeof first.reservation]===v));
 const type=variant==='preview'?'image/jpeg':first.reservation.declaredType,extension=type==='application/pdf'?'pdf':type==='image/png'?'png':type==='image/heic'?'heic':'jpg';
 return new Response(bytes.forResponse(),{status:200,headers:{'content-type':type,'content-length':String(variant==='original'?first.candidate.original.byteSize:first.candidate.preview.byteSize),'content-disposition':`attachment; filename="receipt-${receiptId}${variant==='preview'?'-preview':''}.${extension}"`,'cache-control':'private, no-store','pragma':'no-cache','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }catch{throw new ReceiptWorkflowError();}};}
// Trusted dispatcher construction only. Never give an ordinary web process a
// Docker socket or accept candidate metadata/keys from a browser.
export function createReceiptWorkflow(authority:ReceiptAuthority,objects:ReturnType<typeof createReceiptObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
 const intake=createValidatedFileIntake(objects.intakeStore,validator);
 return Object.freeze({
  async upload(credential:string,businessId:string,receiptId:string,signal:AbortSignal){try{check(expenseId(businessId)&&expenseId(receiptId));const r=seal(await authority.read(credential,businessId,receiptId,signal),businessId,receiptId);check(r.candidate===null);await authority.writable(credential,r.reservation,signal);return await objects.issueReservedUpload(r.reservation,signal);}catch{throw new ReceiptWorkflowError();}},
  async prepareAndPublish(credential:string,businessId:string,receiptId:string,operationId:string,signal:AbortSignal){try{check(expenseId(businessId)&&expenseId(receiptId)&&expenseId(operationId));const r=seal(await authority.read(credential,businessId,receiptId,signal),businessId,receiptId);await authority.writable(credential,r.reservation,signal);if(r.candidate)return r;
   const v=r.reservation,candidate=parseReceiptCandidate(await intake.prepare({businessId,attemptId:receiptId,dispatchId:v.dispatchId,stagingKey:v.stagingKey,originalKey:v.originalKey,previewKey:v.previewKey,byteSize:v.byteSize,contentType:v.declaredType},signal),v);
   await authority.writable(credential,v,signal);const published=seal(await authority.publish(credential,v,operationId,candidate,signal),businessId,receiptId);check(published.candidate&&Object.entries(v).every(([k,value])=>published.reservation[k as keyof typeof v]===value)&&published.candidate.preview.sha256===candidate.preview.sha256&&published.candidate.validationVersion===candidate.validationVersion&&Object.entries(candidate.original).every(([k,value])=>published.candidate!.original[k as keyof typeof candidate.original]===value));return published;
  }catch{throw new ReceiptWorkflowError();}},
  download:createReceiptDownload(authority,objects)
 });
}
