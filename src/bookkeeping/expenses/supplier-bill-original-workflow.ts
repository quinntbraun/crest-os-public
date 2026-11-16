import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {expenseCheck as check,expenseExact as exact,expenseId} from './expense-contract.ts';
import {parseReceiptCandidate,parseReceiptReservation} from './receipt-contract.ts';
import type {ReceiptCandidate,ReceiptReservation} from './receipt-contract.ts';
import type {createReceiptObjectStore} from './receipt-object-store.ts';
import type {createLocalSandboxValidator} from '../../files/local-sandbox-validator.ts';
import {createReceiptDownload,createReceiptUpload,createReceiptWorkflow,ReceiptWorkflowError} from './receipt-workflow.ts';

type SupplierOriginalAuthority=Readonly<{
 read(credential:string,businessId:string,originalId:string,signal:AbortSignal):Promise<unknown>;
 authorizeWrite(credential:string,businessId:string,epoch:string,originalId:string,signal:AbortSignal):Promise<unknown>;
 publish(credential:string,reference:Readonly<{businessId:string;recoveryEpoch:string;originalId:string;
  billId:string;billRevision:string;operationId:string}>,candidate:ReceiptCandidate,signal:AbortSignal):Promise<unknown>;
}>;

function reservation(value:unknown,businessId:string,originalId:string){
 check(exact(value,['businessId','originalId','billId','billRevision','recoveryEpoch','declaredType','byteSize','dispatchId',
  'stagingKey','originalKey','previewKey'])&&value.businessId===businessId&&value.originalId===originalId);
 const {originalId:receiptId,billId:expenseId,billRevision:expenseRevision,...binding}=value;
 return parseReceiptReservation({...binding,receiptId,expenseId,expenseRevision});
}

export function parseSupplierOriginalRecord(value:unknown,businessId:string,originalId:string){
 check(exact(value,['state','schemaVersion','reservation','candidate'])&&value.state==='ready'&&value.schemaVersion===1);
 const bound=reservation(value.reservation,businessId,originalId);
 return {reservation:bound,candidate:value.candidate===null?null:parseReceiptCandidate(value.candidate,bound)};
}

// The server/worker supply a freshly authorized SQL port. A browser never
// supplies a storage key or a decoder result to this workflow.
function receiptAuthority(authority:Pick<SupplierOriginalAuthority,'read'|'authorizeWrite'>){
 const read=async(credential:string,businessId:string,originalId:string,signal:AbortSignal)=>{
  check(expenseId(businessId)&&expenseId(originalId));
  const record=parseSupplierOriginalRecord(await authority.read(credential,businessId,originalId,signal),businessId,originalId);
  signal.throwIfAborted();
  return record;
 };
 const writable=async(credential:string,binding:ReceiptReservation,signal:AbortSignal)=>{
  const {businessId,recoveryEpoch,receiptId}=binding;
  const allowed=await authority.authorizeWrite(credential,businessId,recoveryEpoch,receiptId,signal);
  check(exact(allowed,['state','schemaVersion','reservation'])&&allowed.state==='ready'&&allowed.schemaVersion===1
   &&isDeepStrictEqual(reservation(allowed.reservation,businessId,receiptId),binding));
  signal.throwIfAborted();
 };
 return {read,writable};
}

export function createSupplierOriginalAccess(authority:Pick<SupplierOriginalAuthority,'read'|'authorizeWrite'>,objects:ReturnType<typeof createReceiptObjectStore>){
 const access=receiptAuthority(authority);
 return {upload:createReceiptUpload(access,objects),download:createReceiptDownload(access,objects,true)};
}

export function createSupplierBillOriginalWorkflow(authority:SupplierOriginalAuthority,
 objects:ReturnType<typeof createReceiptObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
 const {read,writable}=receiptAuthority(authority);
 const workflow=createReceiptWorkflow({read,writable,async publish(credential,binding,operationId,candidate,signal){
  const {businessId,recoveryEpoch,receiptId:originalId,expenseId:billId,expenseRevision:billRevision}=binding;
  const result=await authority.publish(credential,{businessId,recoveryEpoch,originalId,billId,billRevision,operationId},candidate,signal);
  check(exact(result,['state','receipt'])&&result.state==='committed'&&exact(result.receipt,['schemaVersion','originalId','billId','billRevision','sha256'])
   &&result.receipt.schemaVersion===1&&result.receipt.originalId===originalId&&result.receipt.billId===billId
   &&result.receipt.billRevision===billRevision&&result.receipt.sha256===candidate.source.sha256);
  const current=await read(credential,businessId,originalId,signal);
  check(isDeepStrictEqual(current.reservation,binding)&&isDeepStrictEqual(current.candidate,candidate));
  return current;
 }},objects,validator,true);
 return Object.freeze({
  upload:workflow.upload,
  download:workflow.download,
  async prepareAndPublish(credential:string,businessId:string,originalId:string,operationId:string,signal:AbortSignal){
   try {
    check(expenseId(operationId));
    const current=await read(credential,businessId,originalId,signal);
    return current.candidate?current:await workflow.prepareAndPublish(credential,businessId,originalId,operationId,signal);
   } catch {
    throw new ReceiptWorkflowError();
   }
  },
 });
}
