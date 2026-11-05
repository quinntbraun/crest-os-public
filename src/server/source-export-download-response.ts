import 'server-only';
import {createHash} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {privateJsonResponse} from '../security/private-http.ts';
import {parseSourceExportDownloadHeader,parseSourceExportDownloadFile} from '../security/source-export-download-contract.ts';
import {SourceExportDeliveryError} from '../security/source-export-download-reader.ts';
import type {SourceExportDelivery} from '../security/source-export-download-reader.ts';

type State={header:SourceExportDelivery['header'];file:SourceExportDelivery['file'];signal:AbortSignal;headers:readonly(readonly[string,string])[];started:boolean;settle:(finished:boolean)=>void};
const states=new WeakMap<Response,State>(),known=new WeakSet<Response>();
function require(v:unknown):asserts v{if(!v)throw new SourceExportDeliveryError();}
export const isSourceExportDownloadResponse=(response:Response)=>known.has(response);
export const discardSourceExportDownloadResponse=(response:Response)=>states.get(response)?.settle(false);
// The reader retains and wipes bytes only after this completion is settled.
// This is a one-use transport handoff, never a reusable file capability.
export function sourceExportDownloadResponse(value:SourceExportDelivery,signal:AbortSignal){
 const header=parseSourceExportDownloadHeader(value.header,value.header.businessId,value.header.exportJobId,value.header.generationId),file=parseSourceExportDownloadFile(value.file);require(value.bytes instanceof Uint8Array&&value.bytes.byteLength===file.bytes&&file.bytes<=8388608&&!signal.aborted);
 let resolve:()=>void=()=>{},reject:(error:Error)=>void=()=>{},controller:ReadableStreamDefaultController<Uint8Array>|undefined,done=false,offset=0;
 const completion=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void completion.catch(()=>{});
 const abort=()=>settle(false);
 function settle(finished:boolean){if(done)return;done=true;signal.removeEventListener('abort',abort);states.delete(response);if(finished)resolve();else{try{controller?.error(new SourceExportDeliveryError());}catch{/* A closed stream still needs its ownership promise rejected. */}reject(new SourceExportDeliveryError());}}
 const body=new ReadableStream<Uint8Array>({start(c){controller=c;},pull(c){if(done||signal.aborted){settle(false);return;}const end=Math.min(offset+65536,value.bytes.byteLength);c.enqueue(value.bytes.subarray(offset,end));offset=end;if(offset===value.bytes.byteLength)c.close();},cancel(){settle(false);}});
 const headers=new Headers(privateJsonResponse({}).headers);headers.set('Cache-Control','private, no-store, max-age=0, no-transform');headers.set('Content-Type',file.contentType);headers.set('Content-Length',String(file.bytes));headers.set('Content-Disposition','attachment; filename="'+file.fileName+'"');headers.set('X-Crest-SHA256',file.sha256);
 const response=new Response(body,{headers});known.add(response);states.set(response,{header,file,signal,headers:Object.freeze([...headers.entries()].map(pair=>Object.freeze(pair))),started:false,settle});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 return Object.freeze({response,completion});
}
export async function writeSourceExportDownloadResponse(outgoing:ServerResponse,response:Response,external:AbortSignal):Promise<void>{
 const state=states.get(response);let finished=false,body:Buffer|undefined;
 try{
  require(state&&!state.started&&!outgoing.headersSent&&!outgoing.destroyed);state.started=true;
  const signal=AbortSignal.any([external,state.signal,AbortSignal.timeout(30000)]),reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;require(reader);
  try{
   for(;;){
    const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new SourceExportDeliveryError());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
    if(part.done)break;require(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=state.file.bytes&&size<=8388608);chunks.push(part.value);
   }
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  body=Buffer.concat(chunks,size);require(!signal.aborted&&body.byteLength===state.file.bytes&&createHash('sha256').update(body).digest('hex')===state.file.sha256&&Date.parse(state.header.expiresAt)>Date.now());
  await new Promise<void>((resolve,reject)=>{
   function clean(){outgoing.off('finish',finish);outgoing.off('close',fail);outgoing.off('error',fail);signal.removeEventListener('abort',fail);}
   function finish(){finished=true;clean();resolve();}
   function fail(){clean();reject(new SourceExportDeliveryError());}
   outgoing.once('finish',finish);outgoing.once('close',fail);outgoing.once('error',fail);signal.addEventListener('abort',fail,{once:true});
   try{require(!signal.aborted&&!outgoing.destroyed);for(const [key,value]of state.headers)outgoing.setHeader(key,value);outgoing.writeHead(200);outgoing.end(body);}catch{fail();}
  });
 }catch{throw new SourceExportDeliveryError();}
 finally{body?.fill(0);if(!finished)outgoing.destroy();state?.settle(finished);}
}
