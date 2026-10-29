import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../../security/trusted-transport.ts';
import {createRequestProtection} from '../../security/request-protection.ts';
import {readBrowserCookies} from '../../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../../security/private-http.ts';
import {createSessionCsrfVerifier} from '../../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../../security/session-request-admission.ts';
import type {SessionDatabaseConfiguration} from '../../security/session-database.ts';
import {expenseCheck as check,expenseId,expenseRevision} from './expense-contract.ts';
import {createReceiptDirectory} from './receipt-directory.ts';
import {createReceiptDownload} from './receipt-workflow.ts';
import type {createReceiptObjectStore} from './receipt-object-store.ts';
import type {ReceiptRecord} from './receipt-contract.ts';
import {fileTypes} from '../../files/validation-contract.ts';
import type {FileType} from '../../files/validation-contract.ts';
const fields={list:['expenseId'],status:['receiptId'],reserve:['recoveryEpoch','operationId','receiptId','expenseId','expenseRevision','declaredType','byteSize'],upload:['receiptId'],publish:['receiptId','operationId'],download:['receiptId','variant']} as const;
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
// This is an operator-supplied isolated dispatcher transport, never browser
// candidate metadata or a Docker socket handed to the ordinary web process.
export type ReceiptDispatch=(credential:string,businessId:string,receiptId:string,operationId:string,signal:AbortSignal)=>Promise<void>;
export const receiptView=(record:ReceiptRecord)=>Object.freeze({receiptId:record.reservation.receiptId,expenseId:record.reservation.expenseId,expenseRevision:record.reservation.expenseRevision,receiptVersion:record.receiptVersion,status:record.candidate?'available' as const:'reserved' as const,declaredType:record.reservation.declaredType,byteSize:record.reservation.byteSize,sourceSha256:record.candidate?.source.sha256??null});
// Explicit test-only construction. Production worker/routing/source/recovery
// adoption is still required; this is not an ordinary runtime enable switch.
export function createReceiptHttp(config:Config,provider:Parameters<typeof createReceiptDirectory>[1],tokens:Parameters<typeof createReceiptDirectory>[2],objects:ReturnType<typeof createReceiptObjectStore>|undefined,dispatch:ReceiptDispatch|undefined,enabled=false){
 check(expenseId(config.businessId)&&typeof enabled==='boolean'&&(!enabled||config.environment==='test'&&objects&&dispatch));const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createReceiptDirectory(config,provider,tokens):undefined,download=enabled?createReceiptDownload(directory!,objects!):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{let submitted=false;try{
  resolve(request,peer);const url=new URL(request.url),prefix='/api/business/expense-receipts/',route=url.pathname.slice(prefix.length) as keyof typeof fields;
  if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return privateJsonResponse({error:'RECEIPT_REQUEST_FAILED'},404);
  if(request.method!=='POST'){const response=privateJsonResponse({error:'RECEIPT_REQUEST_FAILED'},405);response.headers.set('Allow','POST');return response;}
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(route==='publish'?180000:40000)]);protect.requireOrigin(request);const bounded=new Request(request,{signal}),credential=readBrowserCookies(bounded.headers).session;check(credential);const input=await readFlatJsonBody(bounded,fields[route],8192);
  if(route==='list')check(expenseId(input.expenseId));else check(expenseId(input.receiptId));
  if(route==='reserve')check(expenseId(input.recoveryEpoch)&&expenseId(input.operationId)&&expenseId(input.expenseId)&&expenseRevision(input.expenseRevision)&&fileTypes.includes(input.declaredType as FileType)&&Number.isSafeInteger(input.byteSize)&&Number(input.byteSize)>0&&Number(input.byteSize)<=25*1024*1024);
  if(route==='publish')check(expenseId(input.operationId));if(route==='download')check(input.variant==='original'||input.variant==='preview');
  const session=await csrf(bounded,credential,signal),binding=createHash('sha256').update('crest.expense.edit.v1\0').update(config.businessId).update('\0').update(session).digest('base64url');check(request.headers.get('x-crest-edit-binding')===binding);
  if(!await admit(credential,'ordinary',signal)){const response=privateJsonResponse({error:'RECEIPT_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
  if(route==='list')return privateJsonResponse({receipts:(await directory!.list(credential,config.businessId,input.expenseId as string,signal)).map(receiptView)});
  if(route==='reserve'){submitted=true;return privateJsonResponse({receipt:receiptView(await directory!.reserve(credential,{businessId:config.businessId,recoveryEpoch:input.recoveryEpoch as string,operationId:input.operationId as string,receiptId:input.receiptId as string,expenseId:input.expenseId as string,expenseRevision:input.expenseRevision as string,declaredType:input.declaredType as FileType,byteSize:input.byteSize as number},signal))});}
  const receiptId=input.receiptId as string;
  if(route==='status')return privateJsonResponse({receipt:receiptView(await directory!.read(credential,config.businessId,receiptId,signal))});
  if(route==='download')return await download!(credential,config.businessId,receiptId,input.variant as 'original'|'preview',signal);
  const record=await directory!.read(credential,config.businessId,receiptId,signal);
  if(route==='upload'){check(record.candidate===null);await directory!.writable(credential,record.reservation,signal);const capability=await objects!.issueReservedUpload(record.reservation,signal);check(!signal.aborted);return privateJsonResponse({capability:capability.forUpload()});}
  submitted=true;if(!record.candidate)await dispatch!(credential,config.businessId,receiptId,input.operationId as string,signal);const confirmed=await directory!.read(credential,config.businessId,receiptId,signal);check(!signal.aborted&&confirmed.candidate);return privateJsonResponse({receipt:receiptView(confirmed)});
 }catch{return privateJsonResponse({error:submitted?'RECEIPT_OUTCOME_UNKNOWN':'RECEIPT_REQUEST_FAILED'},submitted?503:400);}};
}
