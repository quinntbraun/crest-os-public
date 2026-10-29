import type {Proof} from './authentication';
import {quoteId,quoteVersion,quoteBodyLimit,quoteResponseLimit,quoteHistoryPageLimit,requireQuoteStorage as check,parseQuoteSave,parseQuoteCommitted,parseQuoteDirectoryPage,parseQuoteHistoryPage} from '../commercial/quote-storage-contract';
import type {QuoteSave} from '../commercial/quote-storage-contract';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteReference} from './pending-quote-edit';
import type {QuoteReference} from './pending-quote-edit';
export type QuoteContext=Readonly<{schemaVersion:1;businessId:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class QuoteClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('QUOTE_REQUEST_FAILED');this.name='QuoteClientError';this.kind=kind;}}
async function post(route:'context'|'list'|'save'|'history'|'operation',body:object,proof:Proof,external:AbortSignal){
 try{
  check(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();
  const response=await fetch('/api/business/quotes/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();check(reader);let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=quoteResponseLimit);parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  check(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){check(++visited<=200000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){
   const errors:Record<string,readonly[number,Kind]>={QUOTE_SAVE_NOT_SUBMITTED:[503,'not_submitted'],QUOTE_SAVE_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],QUOTE_REQUEST_LIMITED:[429,'limited'],QUOTE_SAVE_OUTCOME_UNKNOWN:[503,'unknown']},mapped=typeof value.error==='string'&&Object.hasOwn(errors,value.error)?errors[value.error]:undefined;
   if(mapped&&response.status===mapped[0])throw new QuoteClientError(mapped[1]);throw Error();
  }
  return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding'),reviewAvailable:response.headers.get('x-crest-quote-review')==='1',commercialAvailable:response.headers.get('x-crest-quote-commercial')==='1'};
 }catch(error){throw error instanceof QuoteClientError?error:new QuoteClientError(route==='save'?'unknown':'unavailable');}
}
function bindReceipt(value:unknown,businessId:string,reference:QuoteReference){
 const r=quoteReference(reference),result=parseQuoteCommitted(value,businessId,r.operationId);
 check(result.recoveryEpoch===r.recoveryEpoch&&result.receipt.familyId===r.familyId&&result.receipt.revisionId===r.revisionId&&BigInt(result.receipt.familyVersion)===BigInt(r.expectedFamilyVersion)+1n&&BigInt(result.receipt.revisionVersion)===BigInt(r.expectedRevisionVersion)+1n);return result;
}
export const quotes=Object.freeze({
 async context(proof:Proof,signal:AbortSignal){
  try{const r=await post('context',{},proof,signal),v=r.value;check(r.status===200&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding)&&exact(v,['schemaVersion','businessId','writeState','recoveryEpoch'])&&v.schemaVersion===1&&quoteId(v.businessId)&&(v.writeState==='ready'&&quoteId(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null));return Object.freeze({context:Object.freeze({...v}) as QuoteContext,binding:r.binding,...r.reviewAvailable?{reviewAvailable:true as const}:{},...r.commercialAvailable&&r.reviewAvailable?{commercialAvailable:true as const}:{}});}catch(error){throw error instanceof QuoteClientError?error:new QuoteClientError('unavailable');}
 },
 async save(input:QuoteSave,proof:Proof,signal:AbortSignal){
  let command:QuoteSave;try{command=parseQuoteSave(input);}catch{throw new QuoteClientError('input');}
  const {businessId,...body}=command;if(new TextEncoder().encode(JSON.stringify(body)).byteLength>quoteBodyLimit)throw new QuoteClientError('input');
  const r=await post('save',body,proof,signal),v=r.value;
  try{
   if(r.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&(command.content.schemaVersion===2?['operation','family','revision','state','assessment']:['operation','family','revision','state']).includes(v.reason as string))return Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'family'|'revision'|'state'|'assessment'});
   if(r.status===409&&exact(v,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&v.state==='conflict'&&v.reason==='version'&&quoteVersion(v.currentFamilyVersion,true)&&quoteVersion(v.currentRevisionVersion,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:v.currentFamilyVersion,currentRevisionVersion:v.currentRevisionVersion});
   check(r.status===200);
   if(exact(v,['state','familyId','familyVersion','revisionId','revisionVersion','contentHash'])&&v.state==='unchanged'){check(command.expectedFamilyVersion!=='0'&&v.familyId===command.familyId&&v.revisionId===command.revisionId&&v.familyVersion===command.expectedFamilyVersion&&v.revisionVersion===command.expectedRevisionVersion&&typeof v.contentHash==='string'&&/^[a-f0-9]{64}$/.test(v.contentHash));return Object.freeze({...v}) as Readonly<{state:'unchanged';familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentHash:string}>;}
   return bindReceipt(v,businessId,{operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,familyId:command.familyId,revisionId:command.revisionId,expectedFamilyVersion:command.expectedFamilyVersion,expectedRevisionVersion:command.expectedRevisionVersion});
  }catch{throw new QuoteClientError('unknown');}
 },
 async lookup(businessId:string,reference:QuoteReference,proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId));const pinned=quoteReference(reference),r=await post('operation',{operationId:pinned.operationId},proof,signal);check(r.status===200);return exact(r.value,['state'])&&r.value.state==='absent'?Object.freeze({state:'absent' as const}):bindReceipt(r.value,businessId,pinned);}catch(error){throw error instanceof QuoteClientError?error:new QuoteClientError('unavailable');}
 },
 async list(businessId:string,input:{search:string;afterId:string|null;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId)&&exact(input,['search','afterId','pageSize'])&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||quoteId(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const pinned=Object.freeze({...input}),r=await post('list',pinned,proof,signal);check(r.status===200);return parseQuoteDirectoryPage(r.value,{businessId,...pinned});}catch(error){throw error instanceof QuoteClientError?error:new QuoteClientError('unavailable');}
 },
 async history(businessId:string,input:{familyId:string;revisionId:string;afterVersion:string;pageSize:number},proof:Proof,signal:AbortSignal){
  try{check(quoteId(businessId)&&exact(input,['familyId','revisionId','afterVersion','pageSize'])&&quoteId(input.familyId)&&quoteId(input.revisionId)&&quoteVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=quoteHistoryPageLimit);const pinned=Object.freeze({...input}),r=await post('history',pinned,proof,signal);check(r.status===200);return parseQuoteHistoryPage(r.value,{businessId,...pinned});}catch(error){throw error instanceof QuoteClientError?error:new QuoteClientError('unavailable');}
 }
});
