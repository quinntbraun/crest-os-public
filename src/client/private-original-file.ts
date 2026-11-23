export type PrivateOriginalExpectation=Readonly<{byteSize:number;sha256:string;mediaType:string}>;
export type PrivateOriginalFile=Readonly<{bytes:Uint8Array<ArrayBuffer>;fileName:string;mediaType:string;sha256:string}>;
const extensions:Readonly<Record<string,string>>={'image/jpeg':'jpg','image/png':'png','image/heic':'heic','application/pdf':'pdf'};
const maximum=25*1024*1024,hash=/^[a-f0-9]{64}$/;
function require(value:unknown):asserts value{if(!value)throw Error('PRIVATE_ORIGINAL_FILE_UNCONFIRMED');}
// Bytes only. This creates no URL, initiates no save and grants no authority.
// The caller owns the returned buffer and must wipe it after use.
export async function readPrivateOriginalFile(response:Response,signal:AbortSignal,expected?:PrivateOriginalExpectation):Promise<PrivateOriginalFile>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,bytes:Uint8Array<ArrayBuffer>|undefined,complete=false;
 const abort=()=>{void reader?.cancel().catch(()=>undefined);};
 try{
  signal.throwIfAborted();const mediaType=response.headers.get('content-type')??'',sizeText=response.headers.get('content-length')??'',sha256=response.headers.get('x-crest-sha256')??'',disposition=response.headers.get('content-disposition')??'',match=/^attachment; filename="([a-z0-9][a-z0-9_.-]{0,159})"$/.exec(disposition);
  require(response.status===200&&response.headers.get('cache-control')?.includes('private')&&response.headers.get('cache-control')?.includes('no-store')&&response.headers.get('x-content-type-options')==='nosniff'&&Object.hasOwn(extensions,mediaType)&&/^[1-9][0-9]*$/.test(sizeText)&&hash.test(sha256)&&match&&!match[1]!.includes('..')&&match[1]!.endsWith('.'+extensions[mediaType]));
  const size=Number(sizeText);require(Number.isSafeInteger(size)&&size<=maximum);
  if(expected)require(Object.keys(expected).sort().join(',')==='byteSize,mediaType,sha256'&&size===expected.byteSize&&mediaType===expected.mediaType&&sha256===expected.sha256);
  reader=response.body?.getReader();require(reader);bytes=new Uint8Array(size);let at=0;signal.addEventListener('abort',abort,{once:true});signal.throwIfAborted();
  for(;;){const part=await reader.read();signal.throwIfAborted();if(part.done)break;require(part.value instanceof Uint8Array&&at+part.value.byteLength<=size);bytes.set(part.value,at);at+=part.value.byteLength;}
  require(at===size);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');signal.throwIfAborted();require(digest===sha256);
  complete=true;return Object.freeze({bytes,fileName:match[1]!,mediaType,sha256});
 }finally{
  signal.removeEventListener('abort',abort);if(!complete)bytes?.fill(0);
  if(reader){void reader.cancel().catch(()=>undefined);reader.releaseLock();}else void response.body?.cancel().catch(()=>undefined);
 }
}
