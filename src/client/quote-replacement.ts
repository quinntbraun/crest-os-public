import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId,quoteResponseLimit,quoteBodyLimit,requireQuoteStorage as check} from '../commercial/quote-storage-contract';
import {parseQuoteReplacement,parseQuoteReplacementReference,replacementReference,bindQuoteReplacementReceipt,parseQuoteReplacementConflict} from '../commercial/quote-replacement-contract';
import {prepareQuoteReviewContent} from '../commercial/quote-review-content';
import type {QuoteReplacement,QuoteReplacementReference} from '../commercial/quote-replacement-contract';
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class QuoteReplacementClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('QUOTE_REPLACEMENT_REQUEST_FAILED');this.name='QuoteReplacementClientError';this.kind=kind;}}
async function post(route:'replacement'|'operation',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();
  const response=await fetch('/api/business/quotes/'+(route==='replacement'?'commercial/replacement':'operation'),{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=quoteResponseLimit);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=200000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){const errors:Record<string,readonly[number,Kind]>={QUOTE_REPLACEMENT_NOT_SUBMITTED:[503,'not_submitted'],QUOTE_REPLACEMENT_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],QUOTE_REPLACEMENT_REQUEST_LIMITED:[429,'limited'],QUOTE_REPLACEMENT_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(errors,value.error)?errors[value.error]:undefined;if(mapped&&response.status===mapped[0])throw new QuoteReplacementClientError(mapped[1]);throw Error();}
  return {value,status:response.status};
 }catch(error){throw error instanceof QuoteReplacementClientError?error:new QuoteReplacementClientError(route==='replacement'?'unknown':'unavailable');}
}

// Stateless transport; a missing original result never proves non-commit.
export const quoteReplacement=Object.freeze({
 async create(input:QuoteReplacement,proof:Proof,signal:AbortSignal){
  let request:QuoteReplacement;try{request=parseQuoteReplacement(input);}catch{throw new QuoteReplacementClientError('input');}
  const {businessId,...body}=request;if(new TextEncoder().encode(JSON.stringify(body)).byteLength>quoteBodyLimit)throw new QuoteReplacementClientError('input');
  const response=await post('replacement',body,proof,signal);
  try{
   if(response.status===409)return parseQuoteReplacementConflict(response.value);check(response.status===200);
   const result=bindQuoteReplacementReceipt(response.value,businessId,replacementReference(request));
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepareQuoteReviewContent(request.content).canonical))),hash=[...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
   check(!signal.aborted&&result.receipt.contentHash===hash&&result.receipt.itemAuditEventIds.length===request.content.lines.length);return result;
  }catch{throw new QuoteReplacementClientError('unknown');}
 },
 async lookup(businessId:string,reference:QuoteReplacementReference,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const pinned=parseQuoteReplacementReference(reference),response=await post('operation',{operationId:pinned.operationId},proof,signal);check(response.status===200);return exact(response.value,['state'])&&response.value.state==='absent'?Object.freeze({state:'absent' as const}):bindQuoteReplacementReceipt(response.value,businessId,pinned);}
  catch(error){throw error instanceof QuoteReplacementClientError?error:new QuoteReplacementClientError('unavailable');}
 }
});
