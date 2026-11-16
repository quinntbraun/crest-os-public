import {legacyContactArchiveFilename,legacyContactDownloadLimit,legacyContactDownloadRoute,parseLegacyContactDownloadRequest}
 from '../customer/legacy-contact-download-contract.ts';
import type {Proof} from './authentication.ts';

export async function downloadLegacyContactImport(input:ReturnType<typeof parseLegacyContactDownloadRequest>,proof:Proof,external:AbortSignal){
 const request=parseLegacyContactDownloadRequest(input),name=legacyContactArchiveFilename(request.batchId);
 const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);
 if(!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)||proof.expiresAt<=Date.now())
  throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
 const response=await fetch('/api/business/customers/'+legacyContactDownloadRoute,{
  method:'POST',headers:{'Content-Type':'application/json','x-crest-csrf':proof.csrfToken},
  credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal,body:JSON.stringify(request),
 });
 const length=Number(response.headers.get('content-length')),digest=response.headers.get('x-crest-sha256')??'';
 if(response.status!==200||response.headers.get('content-type')!=='application/zip'||
  response.headers.get('content-disposition')!=='attachment; filename="'+name+'"'||
  !response.headers.get('cache-control')?.includes('no-store')||
  !Number.isSafeInteger(length)||length<1||length>legacyContactDownloadLimit||digest.length!==64||!/^[a-f0-9]+$/.test(digest)){
  await response.body?.cancel().catch(()=>undefined);
  throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
 }
 const bytes=new Uint8Array(length),reader=response.body?.getReader();
 if(!reader)throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
 try{
  let offset=0;
  for(;;){
   signal.throwIfAborted();
   const read=await reader.read();
   if(read.done)break;
   if(!read.value.byteLength||offset+read.value.byteLength>length)throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
   bytes.set(read.value,offset);
   offset+=read.value.byteLength;
  }
  if(offset!==length)throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
  const observed=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  if(Array.from(observed,value=>value.toString(16).padStart(2,'0')).join('')!==digest)throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');
  signal.throwIfAborted();
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
  try{
   const link=document.createElement('a');
   link.href=url;link.download=name;
   document.body.append(link);
   try{link.click();}finally{link.remove();}
  }finally{window.setTimeout(()=>URL.revokeObjectURL(url),10000);}
 }finally{
  bytes.fill(0);
  void reader.cancel().catch(()=>undefined);
  reader.releaseLock();
 }
}
