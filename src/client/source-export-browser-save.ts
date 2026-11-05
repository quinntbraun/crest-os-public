import {downloadObject,downloadHeaderKeys,parseSourceExportDownloadHeader,parseSourceExportDownloadFile} from '../security/source-export-download-contract.ts';
import type {SourceExportBrowserFile} from './source-export-downloads.ts';

export class SourceExportBrowserSaveError extends Error{constructor(){super('SOURCE_EXPORT_BROWSER_SAVE_FAILED');this.name='SourceExportBrowserSaveError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportBrowserSaveError();}
async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{let done=false;const abort=()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new SourceExportBrowserSaveError());}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();work.then(value=>{if(!done){done=true;signal.removeEventListener('abort',abort);resolve(value);}},()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new SourceExportBrowserSaveError());}});});
}
// One private, short-lived Blob URL. Requesting the browser save proves no
// persistence. Blob/browser-internal immutable copies cannot be wiped by JS.
export function createSourceExportBrowserSave(onExpired:()=>void=()=>{}){
 if(typeof globalThis.document?.createElement!=='function'||!globalThis.document.body||typeof globalThis.URL?.createObjectURL!=='function'||typeof globalThis.URL?.revokeObjectURL!=='function'||typeof globalThis.Blob!=='function'||typeof globalThis.crypto?.subtle?.digest!=='function')throw new SourceExportBrowserSaveError();
 const doc=globalThis.document,BlobType=globalThis.Blob,create=globalThis.URL.createObjectURL.bind(globalThis.URL),revoke=globalThis.URL.revokeObjectURL.bind(globalThis.URL),digest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
 let disposed=false,running=false,serial=0,held:Readonly<{url:string;fileName:string;bytes:number;expiresAt:number}>|undefined,requested=false,timer:ReturnType<typeof setTimeout>|undefined,detach:undefined|(()=>void),current:AbortController|undefined;
 function clear(){serial++;current?.abort();current=undefined;if(timer!==undefined)clearTimeout(timer);timer=undefined;detach?.();detach=undefined;const old=held;held=undefined;requested=false;if(old){try{revoke(old.url);}catch{/* Cleanup does not expose private URLs. */}}}
 return Object.freeze({
  async prepare(input:SourceExportBrowserFile,external:AbortSignal,proofExpiresAt:number){
   let owned:Uint8Array<ArrayBuffer>|undefined,entered=false;
   try{
    require(!disposed&&!running&&!external.aborted);clear();const token=serial,controller=new AbortController();current=controller;running=true;entered=true;
    const value=downloadObject(input,['header','file','bytes']),raw=downloadObject(value.header,downloadHeaderKeys),header=parseSourceExportDownloadHeader(raw,raw.businessId as string,raw.exportJobId as string,raw.generationId as string),file=parseSourceExportDownloadFile(value.file);
    require(value.bytes instanceof Uint8Array&&value.bytes.byteLength===file.bytes&&file.ordinal<=header.fileCount&&file.bytes<=header.totalBytes&&Date.parse(header.completedAt)<=Date.now()&&Number.isSafeInteger(proofExpiresAt));
    const expiresAt=Math.min(proofExpiresAt,Date.parse(header.expiresAt),Date.now()+60000);require(expiresAt>Date.now());const signal=AbortSignal.any([external,controller.signal,AbortSignal.timeout(expiresAt-Date.now())]);require(!signal.aborted);
    owned=new Uint8Array(value.bytes);const hash=Array.from(new Uint8Array(await bounded(digest('SHA-256',owned),signal)),b=>b.toString(16).padStart(2,'0')).join('');require(hash===file.sha256&&!disposed&&!signal.aborted&&serial===token&&expiresAt>Date.now());
    const blob=new BlobType([owned],{type:file.contentType}),url=create(blob);if(typeof url!=='string'||!url.startsWith('blob:')){try{revoke(url);}catch{/* Reject even an invalid native URL without exposing it. */}throw new SourceExportBrowserSaveError();}
    held=Object.freeze({url,fileName:file.fileName,bytes:file.bytes,expiresAt});const abort=()=>clear();external.addEventListener('abort',abort,{once:true});detach=()=>external.removeEventListener('abort',abort);timer=setTimeout(()=>{clear();onExpired();},Math.max(0,expiresAt-Date.now()));require(!external.aborted&&!disposed&&expiresAt>Date.now());
   }catch{if(entered)clear();throw new SourceExportBrowserSaveError();}
   finally{owned?.fill(0);if(entered){running=false;current=undefined;}}
  },
  view(){if(held&&held.expiresAt<=Date.now())clear();return held?Object.freeze({fileName:held.fileName,bytes:held.bytes,expiresAt:held.expiresAt,state:requested?'requested' as const:'prepared' as const}):null;},
  request(external:AbortSignal){
   let anchor:HTMLAnchorElement|undefined;
   try{
    require(!disposed&&!running&&!external.aborted&&held&&!requested&&held.expiresAt>Date.now());const prepared=held;requested=true;anchor=doc.createElement('a');anchor.href=prepared.url;anchor.download=prepared.fileName;anchor.rel='noopener noreferrer';anchor.hidden=true;doc.body.append(anchor);anchor.click();
    return Object.freeze({state:'requested' as const,fileName:prepared.fileName});
   }catch{clear();throw new SourceExportBrowserSaveError();}finally{try{anchor?.remove();}catch{/* The private URL still expires even if DOM cleanup fails. */}}
  },
  clear,
  dispose(){disposed=true;clear();},
  toJSON():never{throw new SourceExportBrowserSaveError();}
 });
}
