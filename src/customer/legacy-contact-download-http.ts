import 'server-only';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {legacyContactArchiveFilename,parseLegacyContactDownloadRequest} from './legacy-contact-download-contract.ts';
import type {createCustomerDirectory} from './customer-directory.ts';

const releases=new WeakMap<Response,()=>void>();
export const isLegacyContactDownloadResponse=(response:Response)=>releases.has(response);
export function discardLegacyContactDownload(response:Response){
 releases.get(response)?.();
 releases.delete(response);
}

export function createLegacyContactDownloadHttp(directory:ReturnType<typeof createCustomerDirectory>){
 let active=false;
 return async(request:Request,credential:string,businessId:string,signal:AbortSignal)=>{
  if(active)return privateJsonResponse({error:'LEGACY_DOWNLOAD_BUSY'},429);
  active=true;
  let bytes:Uint8Array<ArrayBuffer>|undefined,registered=false;
  try{
   const input=parseLegacyContactDownloadRequest(await readFlatJsonBody(request,['batchId','applicationOperationId','recoveryEpoch']));
   const archive=(await directory.downloadLegacyApplication(credential,businessId,input,signal)).forServer();
   if(!archive)return privateJsonResponse({error:'LEGACY_DOWNLOAD_UNAVAILABLE'},404);
   bytes=archive.bytes;
   signal.throwIfAborted();
   const file=bytes;
   const headers=new Headers(privateJsonResponse({}).headers);
   headers.set('Cache-Control','private, no-store, max-age=0, no-transform');
   headers.set('Content-Type','application/zip');
   headers.set('Content-Length',String(file.byteLength));
   headers.set('Content-Disposition','attachment; filename="'+legacyContactArchiveFilename(input.batchId)+'"');
   headers.set('X-Crest-SHA256',archive.digest);
   let released=false;
   const release=()=>{if(!released){released=true;file.fill(0);active=false;}};
   const response=new Response(new ReadableStream<Uint8Array>({
    pull(stream){stream.enqueue(file);stream.close();},
    cancel(){release();},
   }),{headers});
   releases.set(response,release);
   registered=true;
   return response;
  }catch{return privateJsonResponse({error:'LEGACY_DOWNLOAD_UNAVAILABLE'},503);}
  finally{if(!registered){bytes?.fill(0);active=false;}}
 };
}
