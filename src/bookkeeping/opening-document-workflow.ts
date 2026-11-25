import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {parseReceiptReservation,parseReceiptCandidate} from './expenses/receipt-contract.ts';
import type {ReceiptCandidate,ReceiptReservation} from './expenses/receipt-contract.ts';
import {createReceiptDownload,createReceiptUpload,createReceiptWorkflow,ReceiptWorkflowError} from './expenses/receipt-workflow.ts';
import type {createReceiptObjectStore} from './expenses/receipt-object-store.ts';
import type {createLocalSandboxValidator} from '../files/local-sandbox-validator.ts';

type Authority=Readonly<{
 read(credential:string,businessId:string,documentId:string,signal:AbortSignal):Promise<unknown>;
 authorizeWrite(credential:string,businessId:string,recoveryEpoch:string,documentId:string,signal:AbortSignal):Promise<unknown>;
 publish(credential:string,binding:Readonly<{businessId:string;documentId:string;recoveryEpoch:string;operationId:string}>,candidate:ReceiptCandidate,signal:AbortSignal):Promise<unknown>;
}>;
function require(value:unknown):asserts value{if(!value)throw new ReceiptWorkflowError();}
function reservation(value:unknown,businessId:string,documentId:string){
 require(exact(value,['businessId','documentId','reference','sha256','recoveryEpoch','declaredType','byteSize','dispatchId','stagingKey','originalKey','previewKey'])&&value.businessId===businessId&&value.documentId===documentId&&uuid(documentId));
 require(financeAccountReviewReason(value.reference)&&[...value.reference].length<=200&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));
 const {documentId:receiptId,reference,sha256,...fields}=value;
 // Receipt processing is a private byte-validation adapter. No expense row or
 // financial source is created; the document is its own immutable parent.
 const bytes=parseReceiptReservation({...fields,receiptId,expenseId:documentId,expenseRevision:'1'});
 return Object.freeze({bytes,evidence:Object.freeze({reference,sha256})});
}
export function parseOpeningDocumentRecord(value:unknown,businessId:string,documentId:string){
 require(exact(value,['state','schemaVersion','reservation','candidate'])&&value.state==='ready'&&value.schemaVersion===1);
 const binding=reservation(value.reservation,businessId,documentId),candidate=value.candidate===null?null:parseReceiptCandidate(value.candidate,binding.bytes);
 require(!candidate||candidate.source.sha256===binding.evidence.sha256);
 return Object.freeze({reservation:binding.bytes,evidence:binding.evidence,candidate});
}
function access(authority:Pick<Authority,'read'|'authorizeWrite'>){
 const read=async(credential:string,businessId:string,documentId:string,signal:AbortSignal)=>{
  require(uuid(businessId)&&uuid(documentId));const record=parseOpeningDocumentRecord(await authority.read(credential,businessId,documentId,signal),businessId,documentId);signal.throwIfAborted();return record;
 };
 const writable=async(credential:string,binding:ReceiptReservation,signal:AbortSignal)=>{
  const current=await read(credential,binding.businessId,binding.receiptId,signal);require(isDeepStrictEqual(current.reservation,binding));
  const allowed=await authority.authorizeWrite(credential,binding.businessId,binding.recoveryEpoch,binding.receiptId,signal);
  require(exact(allowed,['state','schemaVersion','reservation'])&&allowed.state==='ready'&&allowed.schemaVersion===1);
  const approved=reservation(allowed.reservation,binding.businessId,binding.receiptId);require(isDeepStrictEqual(approved.bytes,binding)&&isDeepStrictEqual(approved.evidence,current.evidence));signal.throwIfAborted();
 };
 return {read,writable};
}
export function createOpeningDocumentAccess(authority:Pick<Authority,'read'|'authorizeWrite'>,objects:ReturnType<typeof createReceiptObjectStore>){
 const scoped=access(authority);return Object.freeze({upload:createReceiptUpload(scoped,objects),download:createReceiptDownload(scoped,objects,true)});
}
export function createOpeningDocumentWorkflow(authority:Authority,objects:ReturnType<typeof createReceiptObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
 const {read,writable}=access(authority);
 const workflow=createReceiptWorkflow({read,writable,async publish(credential,binding,operationId,candidate,signal){
  const before=await read(credential,binding.businessId,binding.receiptId,signal);require(isDeepStrictEqual(before.reservation,binding)&&before.evidence.sha256===candidate.source.sha256);
  const result=await authority.publish(credential,{businessId:binding.businessId,documentId:binding.receiptId,recoveryEpoch:binding.recoveryEpoch,operationId},candidate,signal);
  require(exact(result,['state','receipt'])&&result.state==='committed'&&exact(result.receipt,['schemaVersion','documentId','reference','sha256'])&&result.receipt.schemaVersion===1&&result.receipt.documentId===binding.receiptId&&result.receipt.reference===before.evidence.reference&&result.receipt.sha256===candidate.source.sha256);
  const current=await read(credential,binding.businessId,binding.receiptId,signal);require(isDeepStrictEqual(current.reservation,binding)&&isDeepStrictEqual(current.evidence,before.evidence)&&isDeepStrictEqual(current.candidate,candidate));return current;
 }},objects,validator,true);
 return Object.freeze({...workflow,async prepareAndPublish(credential:string,businessId:string,documentId:string,operationId:string,signal:AbortSignal){
  require(uuid(operationId));const current=await read(credential,businessId,documentId,signal);return current.candidate?current:await workflow.prepareAndPublish(credential,businessId,documentId,operationId,signal);
 }});
}
