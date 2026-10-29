import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId,quoteVersion,quoteResponseLimit,quoteBodyLimit} from '../commercial/quote-storage-contract';
import {parseQuoteManualSend,parseQuoteConfirmationAccept,parseQuoteCommercialCommitted,requireQuoteCommercial as check} from '../commercial/quote-commercial-contract';
import type {QuoteManualSend,QuoteConfirmationAccept} from '../commercial/quote-commercial-contract';
import {parseQuoteCommercialRead} from '../commercial/quote-commercial-read';

type CommonReference=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string}>;
export type QuoteCommercialReference=CommonReference&(Readonly<{action:'send';sendId:string;approvalId:string}>|Readonly<{action:'accept';acceptanceId:string;agreementId:string}>);
export function parseQuoteCommercialReference(value:unknown):QuoteCommercialReference{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value));const raw=value as Record<string,unknown>,fields=raw.action==='send'?['sendId','approvalId']:raw.action==='accept'?['acceptanceId','agreementId']:[];
 check(fields.length===2&&exact(raw,['action','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion',...fields])&&quoteId(raw.operationId)&&quoteId(raw.recoveryEpoch)&&quoteId(raw.familyId)&&quoteId(raw.revisionId)&&quoteVersion(raw.expectedFamilyVersion)&&quoteVersion(raw.expectedRevisionVersion)&&quoteVersion(raw.expectedContentVersion)&&BigInt(raw.expectedContentVersion)<=BigInt(raw.expectedRevisionVersion)&&fields.every(key=>quoteId(raw[key])));return Object.freeze({...raw}) as QuoteCommercialReference;
}
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class QuoteCommercialClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('QUOTE_COMMERCIAL_REQUEST_FAILED');this.name='QuoteCommercialClientError';this.kind=kind;}}
async function post(route:'read'|'send'|'accept'|'operation',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();
  const response=await fetch('/api/business/quotes/commercial/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=quoteResponseLimit);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=200000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){const errors:Record<string,readonly[number,Kind]>={QUOTE_COMMERCIAL_NOT_SUBMITTED:[503,'not_submitted'],QUOTE_COMMERCIAL_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],QUOTE_COMMERCIAL_REQUEST_LIMITED:[429,'limited'],QUOTE_COMMERCIAL_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(errors,value.error)?errors[value.error]:undefined;if(mapped&&response.status===mapped[0])throw new QuoteCommercialClientError(mapped[1]);throw Error();}
  return {value,status:response.status};
 }catch(error){throw error instanceof QuoteCommercialClientError?error:new QuoteCommercialClientError(route==='send'||route==='accept'?'unknown':'unavailable');}
}

export function bindQuoteCommercialCommitted(value:unknown,businessId:string,reference:QuoteCommercialReference,request?:QuoteManualSend|QuoteConfirmationAccept){
 const pinned=parseQuoteCommercialReference(reference),result=parseQuoteCommercialCommitted(value,businessId,pinned.operationId),r=result.receipt;
 check(result.recoveryEpoch===pinned.recoveryEpoch&&r.action===pinned.action&&r.familyId===pinned.familyId&&r.revisionId===pinned.revisionId&&BigInt(r.familyVersion)===BigInt(pinned.expectedFamilyVersion)+1n&&BigInt(r.revisionVersion)===BigInt(pinned.expectedRevisionVersion)+1n&&r.contentVersion===pinned.expectedContentVersion);
 if(pinned.action==='send')check(r.sendId===pinned.sendId&&r.approvalId===pinned.approvalId);else check(r.acceptanceId===pinned.acceptanceId&&r.agreementId===pinned.agreementId);
 if(request){check(r.contentHash===request.expectedHash);if('sendId'in request)check(r.supersededRevisionId===request.body.replacesRevisionId);else check(r.sendId===request.body.sendId&&r.customerId===request.body.customerId);}
 return result;
}
async function change(input:QuoteManualSend|QuoteConfirmationAccept,action:'send'|'accept',proof:Proof,signal:AbortSignal){
 let request:QuoteManualSend|QuoteConfirmationAccept;try{request=action==='send'?parseQuoteManualSend(input):parseQuoteConfirmationAccept(input);}catch{throw new QuoteCommercialClientError('input');}
 const {businessId,...body}=request;if(new TextEncoder().encode(JSON.stringify(body)).byteLength>quoteBodyLimit)throw new QuoteCommercialClientError('input');const r=await post(action,body,proof,signal),v=r.value;
 try{
  if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&['operation','family','revision','state','accepted','approval','offer','send','expired','confirmation','conversion','identity'].includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'family'|'revision'|'state'|'accepted'|'approval'|'offer'|'send'|'expired'|'confirmation'|'conversion'|'identity'});
  if(r.status===409&&exact(v,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&v.state==='conflict'&&v.reason==='version'&&quoteVersion(v.currentFamilyVersion,true)&&quoteVersion(v.currentRevisionVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:v.currentFamilyVersion,currentRevisionVersion:v.currentRevisionVersion});
  check(r.status===200);const common={operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,familyId:request.familyId,revisionId:request.revisionId,expectedFamilyVersion:request.expectedFamilyVersion,expectedRevisionVersion:request.expectedRevisionVersion,expectedContentVersion:request.expectedContentVersion};
  return bindQuoteCommercialCommitted(v,businessId,'sendId'in request?{...common,action:'send',sendId:request.sendId,approvalId:request.approvalId}:{...common,action:'accept',acceptanceId:request.acceptanceId,agreementId:request.agreementId},request);
 }catch{throw new QuoteCommercialClientError('unknown');}
}
// Stateless transport. No cached facts, retry, durable content or epoch rebasing.
export const quoteCommercial=Object.freeze({
 send:(input:QuoteManualSend,proof:Proof,signal:AbortSignal)=>change(input,'send',proof,signal),
 accept:(input:QuoteConfirmationAccept,proof:Proof,signal:AbortSignal)=>change(input,'accept',proof,signal),
 async lookup(businessId:string,reference:QuoteCommercialReference,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const pinned=parseQuoteCommercialReference(reference),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):bindQuoteCommercialCommitted(r.value,businessId,pinned);}
  catch(error){throw error instanceof QuoteCommercialClientError?error:new QuoteCommercialClientError('unavailable');}
 },
 async read(businessId:string,input:Readonly<{familyId:string;revisionId:string}>,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId)&&exact(input,['familyId','revisionId'])&&quoteId(input.familyId)&&quoteId(input.revisionId));const pinned=Object.freeze({...input}),r=await post('read',pinned,proof,signal);check(r.status===200);const result=parseQuoteCommercialRead(r.value,{businessId,...pinned});
   if('approval'in result&&result.approval){const approval=result.approval,digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(approval.presentationText))),expected=Uint8Array.from(approval.presentationHash.match(/../g)!.map(byte=>Number.parseInt(byte,16)));check(digest.length===32&&expected.length===32&&digest.every((byte,index)=>byte===expected[index]));}if(signal.aborted)throw Error();return result;
  }catch(error){throw error instanceof QuoteCommercialClientError?error:new QuoteCommercialClientError('unavailable');}
 }
});
