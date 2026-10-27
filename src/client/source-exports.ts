import type {Proof} from './authentication';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {parseSourceExportJob,parseSourceExportCommitted} from '../security/source-export-job-contract';
import {parseExportRequestReference,parseExportRequestRetirement,parseExportRequestResolution} from '../security/source-export-request-resolution';
import {sourceExportReferenceToWire,sourceExportRetirementToWire,sourceExportBodyLimit} from '../security/source-export-http-contract';

type Kind='input'|'not_submitted'|'recovery'|'limited'|'unknown'|'unavailable';
type Route='request'|'status'|'original'|'retire'|'resolution';
export class SourceExportClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('SOURCE_EXPORT_REQUEST_FAILED');this.name='SourceExportClientError';this.kind=kind;}}
function require(value:unknown):asserts value{if(!value)throw new Error();}
async function readResponse(response:Response,signal:AbortSignal){
 const reader=response.body?.getReader();require(reader);const parts:Uint8Array[]=[];let size=0;
 try{
  require(/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')&&(response.headers.get('cache-control')??'').split(',').some(token=>token.trim().toLowerCase()==='no-store'));
  for(;;){
   const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
   if(part.done)break;require(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=sourceExportBodyLimit);parts.push(part.value);
  }
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 require(!signal.aborted);const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let fields=0,visited=0;
 while(nodes.length){require(++visited<=128);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
 require((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields);return value;
}
async function post(route:Route,body:object,proof:Proof,external:AbortSignal){
 const mutation=route==='request'||route==='retire';let sent=false;
 try{
  const csrfToken=proof?.csrfToken,expiresAt=proof?.expiresAt;
  require(typeof csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(csrfToken)&&Number.isSafeInteger(expiresAt)&&expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);require(!signal.aborted);sent=true;
  const response=await fetch('/api/business/exports/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':csrfToken},body:JSON.stringify(body),signal});
  const value=await readResponse(response,signal);require(!signal.aborted&&expiresAt>Date.now());
  if(exact(value,['error'])){
   if(response.status===429&&value.error==='SOURCE_EXPORT_REQUEST_LIMITED')throw new SourceExportClientError('limited');
   if(response.status===409&&value.error==='RECOVERY_REVIEW_REQUIRED')throw new SourceExportClientError('recovery');
   if(mutation&&response.status===503&&value.error===(route==='request'?'SOURCE_EXPORT_REQUEST_NOT_SUBMITTED':'SOURCE_EXPORT_RESOLUTION_NOT_SUBMITTED'))throw new SourceExportClientError('not_submitted');
   throw new Error();
  }
  require(response.status===200);return value;
 }catch(error){throw error instanceof SourceExportClientError?error:new SourceExportClientError(mutation?(sent?'unknown':'not_submitted'):'unavailable');}
}
// Stateless, fixed expected principal; server authority comes from the cookie
// and fresh verification. Caller must abort on principal changes. No IDs,
// storage, worker dispatch, download, retries or pending-reference clearing.
export function createSourceExportClient(businessId:string,actorId:string){
 if(!uuid(businessId)||!uuid(actorId))throw new SourceExportClientError('input');const scope=businessId,actor=actorId;
 function original(input:unknown){try{const value=parseExportRequestReference(input);require(value.businessId===scope);return value;}catch{throw new SourceExportClientError('input');}}
 async function receipt(route:'request'|'original',input:unknown,proof:Proof,signal:AbortSignal){
  const command=original(input),value=await post(route,sourceExportReferenceToWire(command),proof,signal);
  try{
   if(route==='original'&&exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
   if(route==='request'&&exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='active_or_identity'))return Object.freeze({state:'conflict' as const,reason:value.reason});
   return parseSourceExportCommitted(value,command,actor);
  }catch{throw new SourceExportClientError(route==='request'?'unknown':'unavailable');}
 }
 return Object.freeze({
  request:(input:unknown,proof:Proof,signal:AbortSignal)=>receipt('request',input,proof,signal),
  lookupRequest:(input:unknown,proof:Proof,signal:AbortSignal)=>receipt('original',input,proof,signal),
  async status(exportJobId:string,proof:Proof,signal:AbortSignal){
   if(!uuid(exportJobId))throw new SourceExportClientError('input');const jobId=exportJobId,value=await post('status',{exportJobId:jobId},proof,signal);
   try{if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});require(exact(value,['state','job'])&&value.state==='found');const job=parseSourceExportJob(value.job,scope);require(job.id===jobId);return Object.freeze({state:'found' as const,job});}catch{throw new SourceExportClientError('unavailable');}
  },
  async retireRequest(input:unknown,proof:Proof,signal:AbortSignal){
   let request:ReturnType<typeof parseExportRequestRetirement>;
   try{request=parseExportRequestRetirement(input);original(request.original);}catch{throw new SourceExportClientError('input');}
   const value=await post('retire',sourceExportRetirementToWire(request),proof,signal);
   try{const result=parseExportRequestResolution(value,request.original);if(result.state==='retired')require(result.retirement.recoveryEpoch===request.recoveryEpoch&&result.retirement.reason===request.reason);return result;}catch{throw new SourceExportClientError('unknown');}
  },
  async lookupResolution(input:unknown,proof:Proof,signal:AbortSignal){
   const command=original(input),value=await post('resolution',sourceExportReferenceToWire(command),proof,signal);
   try{return parseExportRequestResolution(value,command);}catch{throw new SourceExportClientError('unavailable');}
  }
 });
}
