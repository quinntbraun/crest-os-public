import {parseAcceptanceScopeBinding,parseAcceptanceScope} from '../commercial/quote-amendment-acceptance-context';
import {parseQuoteAmendmentTargetsRequest,parseQuoteAmendmentTargets} from '../commercial/quote-amendment-targets';
import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId,quoteBodyLimit,quoteResponseLimit} from '../commercial/quote-storage-contract';
import {prepareQuoteAmendmentContent} from '../commercial/quote-review-content';
import {parseQuoteAmendmentDraft,quoteAmendmentDraftReference,parseQuoteAmendmentDraftReference,bindQuoteAmendmentDraftReceipt,parseQuoteAmendmentDraftConflict} from '../commercial/quote-amendment-contract';
import {parseQuoteAmendmentSend,quoteAmendmentSendReference,parseQuoteAmendmentSendReference,bindQuoteAmendmentSendReceipt,parseQuoteAmendmentSendConflict} from '../commercial/quote-amendment-sharing-contract';
import {parseQuoteAmendmentReadRequest,parseQuoteAmendmentRead} from '../commercial/quote-amendment-read';
import {parseQuoteAmendmentAccept,quoteAmendmentAcceptReference,parseQuoteAmendmentAcceptReference} from '../commercial/quote-amendment-acceptance-contract';
import {bindQuoteAmendmentAcceptReceipt,parseQuoteAmendmentAcceptConflict} from '../commercial/quote-amendment-acceptance-receipt';
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
type Route='acceptance-scope'|'accept'|'targets'|'create'|'send'|'read'|'draft-operation'|'send-operation'|'accept-operation';
export class QuoteAmendmentClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('QUOTE_AMENDMENT_REQUEST_FAILED');this.name='QuoteAmendmentClientError';this.kind=kind;}}
function check(value:unknown):asserts value{if(!value)throw Error();}
async function post(route:Route,body:object,proof:Proof,external:AbortSignal){
 let attempted=false;const changing=route==='create'||route==='send'||route==='accept';
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();
  attempted=true;const response=await fetch('/api/business/quotes/amendments/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=quoteResponseLimit);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=200000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){const errors:Record<string,readonly[number,Kind]>={QUOTE_AMENDMENT_NOT_SUBMITTED:[503,'not_submitted'],QUOTE_AMENDMENT_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],QUOTE_AMENDMENT_REQUEST_LIMITED:[429,'limited'],QUOTE_AMENDMENT_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(errors,value.error)?errors[value.error]:undefined;if(mapped&&response.status===mapped[0])throw new QuoteAmendmentClientError(mapped[1]);throw Error();}
  return {value,status:response.status};
 }catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError(changing?(attempted?'unknown':'not_submitted'):'unavailable');}
}
const absent=(value:unknown)=>exact(value,['state'])&&value.state==='absent';
// Stateless transport: no content persistence, automatic retries, original
// retirement or current-epoch rebasing is performed here. Acceptance requires
// an explicit fully bound request and its separately gated authenticated route.
export const quoteAmendments=Object.freeze({
 async targets(input:unknown,proof:Proof,signal:AbortSignal){
  let request:ReturnType<typeof parseQuoteAmendmentTargetsRequest>;try{request=parseQuoteAmendmentTargetsRequest(input);}catch{throw new QuoteAmendmentClientError('input');}
  const {businessId,...body}=request;try{const response=await post('targets',body,proof,signal);check(response.status===200);const parsed=await parseQuoteAmendmentTargets(response.value,{...request,businessId});check(!signal.aborted);return parsed;}catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError('unavailable');}
 },
 async create(input:unknown,proof:Proof,signal:AbortSignal){
  let request:ReturnType<typeof parseQuoteAmendmentDraft>;try{request=parseQuoteAmendmentDraft(input);}catch{throw new QuoteAmendmentClientError('input');}
  const {businessId,...body}=request;if(new TextEncoder().encode(JSON.stringify(body)).byteLength>quoteBodyLimit)throw new QuoteAmendmentClientError('input');const response=await post('create',body,proof,signal);
  try{if(response.status===409)return parseQuoteAmendmentDraftConflict(response.value);check(response.status===200);const result=bindQuoteAmendmentDraftReceipt(response.value,businessId,quoteAmendmentDraftReference(request),request.expectedParentAcceptedHash),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepareQuoteAmendmentContent(request.content).canonical)),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');check(!signal.aborted&&result.receipt.contentHash===hash&&result.receipt.itemAuditEventIds.length===request.content.lines.length);return result;}catch{throw new QuoteAmendmentClientError('unknown');}
 },
 async send(input:unknown,proof:Proof,signal:AbortSignal){
  let request:ReturnType<typeof parseQuoteAmendmentSend>;try{request=parseQuoteAmendmentSend(input);}catch{throw new QuoteAmendmentClientError('input');}
  const {businessId,...body}=request;if(new TextEncoder().encode(JSON.stringify(body)).byteLength>65536)throw new QuoteAmendmentClientError('input');const response=await post('send',body,proof,signal);
  try{if(response.status===409)return parseQuoteAmendmentSendConflict(response.value);check(response.status===200&&!signal.aborted);return bindQuoteAmendmentSendReceipt(response.value,businessId,quoteAmendmentSendReference(request),{contentHash:request.expectedHash,presentationHash:request.body.presentationHash,parentAcceptedHash:request.expectedParentAcceptedHash});}catch{throw new QuoteAmendmentClientError('unknown');}
 },
 async acceptanceScope(input:unknown,proof:Proof,signal:AbortSignal){
  let expected:ReturnType<typeof parseAcceptanceScopeBinding>;try{expected=parseAcceptanceScopeBinding(input);}catch{throw new QuoteAmendmentClientError('input');}
  const response=await post('acceptance-scope',{familyId:expected.familyId,revisionId:expected.revisionId},proof,signal);try{check(response.status===200&&!signal.aborted);return parseAcceptanceScope(response.value,expected);}catch{throw new QuoteAmendmentClientError('unavailable');}
 },
 async accept(input:unknown,proof:Proof,signal:AbortSignal){
  let request:ReturnType<typeof parseQuoteAmendmentAccept>;try{request=parseQuoteAmendmentAccept(input);}catch{throw new QuoteAmendmentClientError('input');}
  const {businessId,...body}=request;const response=await post('accept',body,proof,signal);try{if(response.status===409)return parseQuoteAmendmentAcceptConflict(response.value);check(response.status===200&&!signal.aborted);return bindQuoteAmendmentAcceptReceipt(response.value,businessId,quoteAmendmentAcceptReference(request),request);}catch{throw new QuoteAmendmentClientError('unknown');}
 },
 async lookupDraft(businessId:string,input:unknown,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const reference=parseQuoteAmendmentDraftReference(input),r=await post('draft-operation',{reference},proof,signal);check(r.status===200&&!signal.aborted);return absent(r.value)?Object.freeze({state:'absent' as const}):bindQuoteAmendmentDraftReceipt(r.value,businessId,reference);}catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError('unavailable');}
 },
 async lookupSend(businessId:string,input:unknown,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const reference=parseQuoteAmendmentSendReference(input),r=await post('send-operation',{reference},proof,signal);check(r.status===200&&!signal.aborted);return absent(r.value)?Object.freeze({state:'absent' as const}):bindQuoteAmendmentSendReceipt(r.value,businessId,reference);}catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError('unavailable');}
 },
 // Construction transport only: the HTTP route stays closed until acceptance
 // adoption. Absence is an observation, never permission to clear or retry.
 async lookupAccept(businessId:string,input:unknown,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const reference=parseQuoteAmendmentAcceptReference(input),r=await post('accept-operation',{reference},proof,signal);check(r.status===200&&!signal.aborted);return absent(r.value)?Object.freeze({state:'absent' as const}):bindQuoteAmendmentAcceptReceipt(r.value,businessId,reference);}catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError('unavailable');}
 },
 async read(input:unknown,proof:Proof,signal:AbortSignal){
  try{const request=parseQuoteAmendmentReadRequest(input),{businessId,...body}=request,r=await post('read',body,proof,signal);check(r.status===200&&!signal.aborted);const value=await parseQuoteAmendmentRead(r.value,{...body,businessId});check(!signal.aborted);return value;}catch(error){throw error instanceof QuoteAmendmentClientError?error:new QuoteAmendmentClientError('unavailable');}
 }
});
