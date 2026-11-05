import 'server-only';
import {createHash} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {expenseCheck as check} from './expense-contract.ts';

type File={name:string;type:string;byteSize:number;sha256:string};
type State={file:Readonly<File>;headers:readonly(readonly[string,string])[];started:boolean};
const states=new WeakMap<Response,State>(),known=new WeakSet<Response>();
const maximumOriginal=25*1024*1024,maximumPreview=8*1024*1024;
export class ReceiptDeliveryError extends Error{constructor(){super('RECEIPT_DELIVERY_UNCONFIRMED');this.name='ReceiptDeliveryError';}}
export const isReceiptDownloadResponse=(response:Response)=>known.has(response);
// Only the freshly authorized receipt reader creates this one-use binary handoff.
// Ordinary JSON responses retain their existing small transport limits.
export function receiptDownloadResponse(bytes:Uint8Array,input:File){
 const file=Object.freeze({...input}),match=/^receipt-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(-preview)?\.(jpg|png|heic|pdf)$/.exec(file.name);
 check(match&&['image/jpeg','image/png','image/heic','application/pdf'].includes(file.type)&&file.type===({'jpg':'image/jpeg','png':'image/png','heic':'image/heic','pdf':'application/pdf'}[match[2]!])&&(!match[1]||file.type==='image/jpeg'));
 check(bytes instanceof Uint8Array&&Number.isSafeInteger(file.byteSize)&&file.byteSize>0&&file.byteSize<=(match[1]?maximumPreview:maximumOriginal)&&bytes.byteLength===file.byteSize&&/^[a-f0-9]{64}$/.test(file.sha256)&&createHash('sha256').update(bytes).digest('hex')===file.sha256);
 const response=new Response(bytes as BodyInit,{status:200,headers:{'content-type':file.type,'content-length':String(file.byteSize),'content-disposition':`attachment; filename="${file.name}"`,'cache-control':'private, no-store','pragma':'no-cache','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 known.add(response);states.set(response,{file,headers:Object.freeze([...response.headers.entries()].map(pair=>Object.freeze(pair))),started:false});return response;
}
export async function writeReceiptDownloadResponse(outgoing:ServerResponse,response:Response,external:AbortSignal):Promise<void>{
 const state=states.get(response),chunks:Uint8Array[]=[];let finished=false,body:Buffer|undefined;
 try{
  check(state&&!state.started&&!outgoing.headersSent&&!outgoing.destroyed&&response.status===200&&JSON.stringify([...response.headers.entries()])===JSON.stringify(state.headers));state.started=true;
  const signal=AbortSignal.any([external,AbortSignal.timeout(30000)]),reader=response.body?.getReader();let size=0;check(reader);
  try{for(;;){
   const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(new ReceiptDeliveryError());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
   if(part.done)break;check(part.value instanceof Uint8Array&&part.value.byteLength>0&&(size+=part.value.byteLength)<=state.file.byteSize&&size<=maximumOriginal);chunks.push(part.value);
  }}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  body=Buffer.concat(chunks,size);check(!signal.aborted&&body.byteLength===state.file.byteSize&&createHash('sha256').update(body).digest('hex')===state.file.sha256&&JSON.stringify([...response.headers.entries()])===JSON.stringify(state.headers));
  await new Promise<void>((resolve,reject)=>{
   function clean(){outgoing.off('finish',finish);outgoing.off('close',fail);outgoing.off('error',fail);signal.removeEventListener('abort',fail);}
   function finish(){finished=true;clean();resolve();}
   function fail(){clean();reject(new ReceiptDeliveryError());}
   outgoing.once('finish',finish);outgoing.once('close',fail);outgoing.once('error',fail);signal.addEventListener('abort',fail,{once:true});
   try{check(!signal.aborted&&!outgoing.destroyed);for(const [key,value]of state.headers)outgoing.setHeader(key,value);outgoing.writeHead(200);outgoing.end(body);}catch{fail();}
  });
 }catch{throw new ReceiptDeliveryError();}
 finally{for(const chunk of chunks)chunk.fill(0);body?.fill(0);states.delete(response);if(!finished)outgoing.destroy();}
}
