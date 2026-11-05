import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId,quoteVersion,quoteResponseLimit} from '../commercial/quote-storage-contract';
import {parseQuoteReviewSubmit,parseQuoteReviewApprove,parseQuoteReviewCommitted,parseQuoteReviewRead,requireQuoteReview as check} from '../commercial/quote-review-contract';
import type {QuoteReviewSubmit,QuoteReviewApprove} from '../commercial/quote-review-contract';

export type QuoteReviewReference=Readonly<{action:'submit'|'approve';operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;approvalId:string|null}>;
export function parseQuoteReviewReference(value:unknown):QuoteReviewReference{
 check(exact(value,['action','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId'])&&(value.action==='submit'||value.action==='approve')&&quoteId(value.operationId)&&quoteId(value.recoveryEpoch)&&quoteId(value.familyId)&&quoteId(value.revisionId)&&quoteVersion(value.expectedFamilyVersion)&&quoteVersion(value.expectedRevisionVersion)&&quoteVersion(value.expectedContentVersion)&&BigInt(value.expectedContentVersion)<=BigInt(value.expectedRevisionVersion)&&(value.action==='submit'?value.approvalId===null:quoteId(value.approvalId)));return Object.freeze({...value}) as QuoteReviewReference;
}
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class QuoteReviewClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('QUOTE_REVIEW_REQUEST_FAILED');this.name='QuoteReviewClientError';this.kind=kind;}}
async function post(route:'read'|'submit'|'approve'|'operation',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();
  const response=await fetch('/api/business/quotes/review/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=quoteResponseLimit);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=200000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){const errors:Record<string,readonly[number,Kind]>={QUOTE_REVIEW_NOT_SUBMITTED:[503,'not_submitted'],QUOTE_REVIEW_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],QUOTE_REVIEW_REQUEST_LIMITED:[429,'limited'],QUOTE_REVIEW_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(errors,value.error)?errors[value.error]:undefined;if(mapped&&response.status===mapped[0])throw new QuoteReviewClientError(mapped[1]);throw Error();}
  return {value,status:response.status};
 }catch(error){throw error instanceof QuoteReviewClientError?error:new QuoteReviewClientError(route==='submit'||route==='approve'?'unknown':'unavailable');}
}
function committed(value:unknown,businessId:string,reference:QuoteReviewReference,expectedHash?:string){
 const pinned=parseQuoteReviewReference(reference),result=parseQuoteReviewCommitted(value,businessId,pinned.operationId),r=result.receipt;
 check(result.recoveryEpoch===pinned.recoveryEpoch&&r.action===pinned.action&&r.familyId===pinned.familyId&&r.revisionId===pinned.revisionId&&BigInt(r.familyVersion)===BigInt(pinned.expectedFamilyVersion)+1n&&BigInt(r.revisionVersion)===BigInt(pinned.expectedRevisionVersion)+1n&&r.contentVersion===pinned.expectedContentVersion&&r.approvalId===pinned.approvalId&&(expectedHash===undefined||r.contentHash===expectedHash));return result;
}
async function change(input:QuoteReviewSubmit|QuoteReviewApprove,action:'submit'|'approve',proof:Proof,signal:AbortSignal){
 let request:QuoteReviewSubmit,approval:QuoteReviewApprove|null;try{approval=action==='approve'?parseQuoteReviewApprove(input):null;request=approval??parseQuoteReviewSubmit(input);check(BigInt(request.expectedContentVersion)<=BigInt(request.expectedRevisionVersion));}catch{throw new QuoteReviewClientError('input');}
 const {businessId,...body}=request,r=await post(action,body,proof,signal),v=r.value;
 try{
  if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&['operation','family','revision','state','approval','readiness','extreme'].includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'family'|'revision'|'state'|'approval'|'readiness'|'extreme'});
  if(r.status===409&&exact(v,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&v.state==='conflict'&&v.reason==='version'&&quoteVersion(v.currentFamilyVersion,true)&&quoteVersion(v.currentRevisionVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:v.currentFamilyVersion,currentRevisionVersion:v.currentRevisionVersion});
  check(r.status===200);return committed(v,businessId,{action,operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,familyId:request.familyId,revisionId:request.revisionId,expectedFamilyVersion:request.expectedFamilyVersion,expectedRevisionVersion:request.expectedRevisionVersion,expectedContentVersion:request.expectedContentVersion,approvalId:approval?.approvalId??null},request.expectedHash);
 }catch{throw new QuoteReviewClientError('unknown');}
}
// Stateless transport: no pending-store hashes, cache, retry or epoch rebasing.
export const quoteReview=Object.freeze({
 submit:(input:QuoteReviewSubmit,proof:Proof,signal:AbortSignal)=>change(input,'submit',proof,signal),
 approve:(input:QuoteReviewApprove,proof:Proof,signal:AbortSignal)=>change(input,'approve',proof,signal),
 async lookup(businessId:string,reference:QuoteReviewReference,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const pinned=parseQuoteReviewReference(reference),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);
   // An opaque reference intentionally has no expected hash. This confirms its
   // exact original server receipt; a fresh state read precedes further action.
   return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):committed(r.value,businessId,pinned);
  }catch(error){throw error instanceof QuoteReviewClientError?error:new QuoteReviewClientError('unavailable');}
 },
 async read(businessId:string,input:Readonly<{familyId:string;revisionId:string}>,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId)&&exact(input,['familyId','revisionId'])&&quoteId(input.familyId)&&quoteId(input.revisionId));const pinned=Object.freeze({...input}),r=await post('read',pinned,proof,signal);check(r.status===200);const result=parseQuoteReviewRead(r.value,{businessId,...pinned});
   if('approval'in result&&result.approval){const approval=result.approval,digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(approval.presentationText))),expected=Uint8Array.from(approval.presentationHash.match(/../g)!.map(byte=>Number.parseInt(byte,16)));check(digest.length===32&&expected.length===32&&digest.every((byte,index)=>byte===expected[index]));}if(signal.aborted)throw Error();return result;
  }catch(error){throw error instanceof QuoteReviewClientError?error:new QuoteReviewClientError('unavailable');}
 }
});
