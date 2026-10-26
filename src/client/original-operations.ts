import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract';
import {parseOriginalOperationReference,parseOriginalOperationRetirement,parseOriginalOperationOutcome,bindOriginalOperationRetirement} from '../security/original-operation-reference';
import {originalOperationLookupToWire,originalOperationRetirementToWire} from '../security/original-operation-http-contract';
import type {OriginalOperationOutcome} from '../security/original-operation-reference';

type Kind='input'|'not_submitted'|'recovery'|'limited'|'unknown'|'unavailable';
export class OriginalOperationClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('ORIGINAL_OPERATION_REQUEST_FAILED');this.name='OriginalOperationClientError';this.kind=kind;}}
function require(value:unknown):asserts value{if(!value)throw new Error();}
const conflict=(value:unknown)=>exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation';
async function post(route:'retire'|'resolution',body:object,proof:Proof,external:AbortSignal){
 let sent=false;
 try{
  require(typeof proof?.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();
  sent=true;
  const response=await fetch('/api/business/original-operations/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
  require(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&!!response.headers.get('cache-control')?.includes('no-store'));
  const reader=response.body?.getReader();require(reader);const parts:Uint8Array[]=[];let size=0;
  try{
   for(;;){
    const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
    if(part.done)break;require(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=16384);parts.push(part.value);
   }
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  require(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
  while(nodes.length){require(++visited<=128);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  require((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);
  if(exact(value,['error'])){
   if(response.status===429&&value.error==='ORIGINAL_OPERATION_REQUEST_LIMITED')throw new OriginalOperationClientError('limited');
   if(route==='retire'&&response.status===409&&value.error==='RECOVERY_REVIEW_REQUIRED')throw new OriginalOperationClientError('recovery');
   if(route==='retire'&&response.status===503&&value.error==='ORIGINAL_OPERATION_NOT_SUBMITTED')throw new OriginalOperationClientError('not_submitted');
   throw new Error();
  }
  require(response.status===200);return value;
 }catch(error){throw error instanceof OriginalOperationClientError?error:new OriginalOperationClientError(route==='retire'?(sent?'unknown':'not_submitted'):'unavailable');}
}
// Stateless transport: no IDs, drafts, storage, retry, automatic lookup,
// reference clearing, provider effects or historical-epoch rebasing.
export const originalOperations=Object.freeze({
 async retire(input:unknown,proof:Proof,signal:AbortSignal):Promise<OriginalOperationOutcome|Readonly<{state:'conflict';reason:'operation'}>>{
  let request:ReturnType<typeof parseOriginalOperationRetirement>,wire:ReturnType<typeof originalOperationRetirementToWire>;
  try{request=parseOriginalOperationRetirement(input);wire=originalOperationRetirementToWire(request);}catch{throw new OriginalOperationClientError('input');}
  const value=await post('retire',wire,proof,signal);
  try{return conflict(value)?Object.freeze({state:'conflict',reason:'operation'}):bindOriginalOperationRetirement(value,request);}catch{throw new OriginalOperationClientError('unknown');}
 },
 async lookup(input:unknown,proof:Proof,signal:AbortSignal){
  let original:ReturnType<typeof parseOriginalOperationReference>;
  try{original=parseOriginalOperationReference(input);}catch{throw new OriginalOperationClientError('input');}
  try{
   const value=await post('resolution',originalOperationLookupToWire(original),proof,signal);
   if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
   if(conflict(value))return Object.freeze({state:'conflict' as const,reason:'operation' as const});
   return parseOriginalOperationOutcome(value,original);
  }catch(error){throw error instanceof OriginalOperationClientError?error:new OriginalOperationClientError('unavailable');}
 }
});
