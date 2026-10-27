import type {Proof} from './authentication.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {downloadObject,downloadHeaderKeys,parseSourceExportDownloadPageRequest,parseSourceExportDownloadHeader,parseSourceExportDownloadFile,parseSourceExportDownloadCatalogue} from '../security/source-export-download-contract.ts';

type Header=ReturnType<typeof parseSourceExportDownloadHeader>;
type Part=ReturnType<typeof parseSourceExportDownloadFile>;
export type SourceExportBrowserFile=Readonly<{header:Header;file:Part;bytes:Uint8Array<ArrayBuffer>}>;
export class SourceExportDownloadClientError extends Error{
 readonly kind:'input'|'limited'|'unavailable';
 constructor(kind:SourceExportDownloadClientError['kind']){super('SOURCE_EXPORT_DOWNLOAD_FAILED');this.name='SourceExportDownloadClientError';this.kind=kind;}
}
function require(value:unknown):asserts value{if(!value)throw new Error();}
async function bounded<T>(work:Promise<T>,signal:AbortSignal,late?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let done=false;const abort=()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new Error());}};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  work.then(value=>{if(done){try{late?.(value);}catch{/* Late cleanup must not expose transport details. */}return;}done=true;signal.removeEventListener('abort',abort);resolve(value);},()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new Error());}});
 });
}
const noStore=(r:Response)=>new Set((r.headers.get('cache-control')??'').split(',').map(v=>v.trim().toLowerCase()));
function cancel(response:Response|undefined){void response?.body?.cancel().catch(()=>{});}
async function json(r:Response,signal:AbortSignal){
 require(/^application\/json(?:;\s*charset=utf-8)?$/i.test(r.headers.get('content-type')??'')&&noStore(r).has('no-store'));
 const reader=r.body?.getReader();require(reader);const owned=new Uint8Array(16384);let size=0;
 try{
  for(;;){const part=await bounded(reader.read(),signal);if(part.done)break;require(part.value instanceof Uint8Array&&part.value.byteLength>0&&size+part.value.byteLength<=owned.byteLength);owned.set(part.value,size);size+=part.value.byteLength;}
  require(!signal.aborted);const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(owned.subarray(0,size)),value:unknown=JSON.parse(text),nodes:unknown[]=[value];let count=0,fields=0;
  while(nodes.length){require(++count<=128);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  require((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(v=>v===':').length===fields);return value;
 }finally{owned.fill(0);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
// Stateless whole-part protocol. No disk writes, URLs, storage, retries or
// saved-file claims. Caller must abort when its current principal changes.
export function createSourceExportDownloadClient(businessId:string){
 if(!uuid(businessId))throw new SourceExportDownloadClientError('input');
 if(typeof globalThis.fetch!=='function'||typeof globalThis.crypto?.subtle?.digest!=='function')throw new SourceExportDownloadClientError('unavailable');
 const scope=businessId,fetch=globalThis.fetch.bind(globalThis),digest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let active=false;
 function header(input:unknown){const v=downloadObject(input,downloadHeaderKeys),value=parseSourceExportDownloadHeader(v,scope,v.exportJobId as string,v.generationId as string);require(Date.parse(value.completedAt)<=Date.now()&&Date.parse(value.expiresAt)>Date.now());return value;}
 function context(proof:Proof,external:AbortSignal){
  const p=downloadObject(proof,['csrfToken','expiresAt']);require(typeof p.csrfToken==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(p.csrfToken)&&typeof p.expiresAt==='number'&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>Date.now());
  const signal=AbortSignal.any([external,AbortSignal.timeout(Math.min(60000,p.expiresAt-Date.now()))]);require(!signal.aborted);return{csrf:p.csrfToken,expiresAt:p.expiresAt,signal};
 }
 async function post(route:'downloads'|'file',body:object,c:ReturnType<typeof context>){
  const response=await bounded(fetch('/api/business/exports/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':c.csrf},body:JSON.stringify(body),signal:c.signal}),c.signal,value=>{void value.body?.cancel().catch(()=>{});});
  try{require(!response.redirected&&!c.signal.aborted&&c.expiresAt>Date.now());
   if(response.status!==200){const value=downloadObject(await json(response,c.signal),['error']);if(response.status===429&&value.error==='SOURCE_EXPORT_DOWNLOAD_LIMITED')throw new SourceExportDownloadClientError('limited');throw new Error();}
   return response;
  }catch(error){cancel(response);throw error;}
 }
 return Object.freeze({
  async catalogue(input:unknown,proof:Proof,external:AbortSignal,pinned?:unknown){
   let request:ReturnType<typeof parseSourceExportDownloadPageRequest>,pin:Header|undefined;
   try{request=parseSourceExportDownloadPageRequest(input);pin=pinned===undefined?undefined:header(pinned);if(pin)require(request.exportJobId===pin.exportJobId&&request.generationId===pin.generationId);else require(request.generationId===null&&request.afterOrdinal===0);}catch{throw new SourceExportDownloadClientError('input');}
   let response:Response|undefined;
   try{
    const c=context(proof,external);response=await post('downloads',request,c);const page=parseSourceExportDownloadCatalogue(await json(response,c.signal),scope,request),pageHeader=header(Object.fromEntries(downloadHeaderKeys.map(k=>[k,page[k]])));
    require(!c.signal.aborted&&c.expiresAt>Date.now()&&(!pin||JSON.stringify(pageHeader)===JSON.stringify(pin)));return page;
   }catch(error){throw error instanceof SourceExportDownloadClientError?error:new SourceExportDownloadClientError('unavailable');}finally{cancel(response);}
  },
  async receive(inputHeader:unknown,inputFile:unknown,proof:Proof,external:AbortSignal,consume:(value:SourceExportBrowserFile,signal:AbortSignal)=>Promise<void>):Promise<void>{
   let h:Header,file:Part;
   try{h=header(inputHeader);file=parseSourceExportDownloadFile(inputFile);require(file.ordinal<=h.fileCount&&file.bytes<=h.totalBytes&&typeof consume==='function');}catch{throw new SourceExportDownloadClientError('input');}
   let owned:Uint8Array<ArrayBuffer>|undefined,response:Response|undefined,entered=false;
   try{
    const c=context(proof,external);require(!active);active=true;entered=true;
    response=await post('file',{exportJobId:h.exportJobId,generationId:h.generationId,partId:file.partId},c);const cache=noStore(response);
    require(cache.has('private')&&cache.has('no-store')&&cache.has('no-transform')&&!cache.has('public')&&response.headers.get('content-type')===file.contentType&&response.headers.get('content-length')===String(file.bytes)&&response.headers.get('content-disposition')==='attachment; filename="'+file.fileName+'"'&&response.headers.get('x-crest-sha256')===file.sha256&&[null,'identity'].includes(response.headers.get('content-encoding')));
    const reader=response.body?.getReader();require(reader);owned=new Uint8Array(file.bytes);let size=0;
    try{for(;;){const part=await bounded(reader.read(),c.signal);if(part.done)break;require(part.value instanceof Uint8Array&&part.value.byteLength>0&&size+part.value.byteLength<=file.bytes);owned.set(part.value,size);size+=part.value.byteLength;}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    require(size===file.bytes&&!c.signal.aborted);const hash=Array.from(new Uint8Array(await bounded(digest('SHA-256',owned),c.signal)),b=>b.toString(16).padStart(2,'0')).join('');
    require(hash===file.sha256&&!c.signal.aborted&&c.expiresAt>Date.now()&&Date.parse(h.expiresAt)>Date.now());
    await bounded(consume(Object.freeze({header:h,file,bytes:owned}),c.signal),c.signal);require(!c.signal.aborted&&c.expiresAt>Date.now());
   }catch(error){throw error instanceof SourceExportDownloadClientError?error:new SourceExportDownloadClientError('unavailable');}
   finally{owned?.fill(0);cancel(response);if(entered)active=false;}
  },
  toJSON():never{throw new SourceExportDownloadClientError('unavailable');}
 });
}
