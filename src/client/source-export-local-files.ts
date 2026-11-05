import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseSourceExportDownloadInventory} from './source-export-download-inventory.ts';

export class SourceExportLocalFilesError extends Error{
 readonly kind:'input'|'unavailable';
 constructor(kind:SourceExportLocalFilesError['kind']){super('SOURCE_EXPORT_LOCAL_FILES_FAILED');this.name='SourceExportLocalFilesError';this.kind=kind;}
}
function require(v:unknown):asserts v{if(!v)throw new Error();}
type Local=Readonly<{name:string;size:number;stream:()=>ReadableStream<Uint8Array>}>;
type Invalid='duplicate'|'length'|'checksum'|'unreadable';
async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{let done=false;const abort=()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new Error());}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();work.then(value=>{if(!done){done=true;signal.removeEventListener('abort',abort);resolve(value);}},()=>{if(!done){done=true;signal.removeEventListener('abort',abort);reject(new Error());}});});
}
// Read-only selected File comparison. A File can also be constructed in memory:
// this is not proof of disk persistence, server origin or backup completeness.
export function createSourceExportLocalVerifier(businessId:string,input:unknown){
 let inventory:ReturnType<typeof parseSourceExportDownloadInventory>;
 try{require(uuid(businessId));inventory=parseSourceExportDownloadInventory(input,businessId);}catch{throw new SourceExportLocalFilesError('input');}
 if(typeof globalThis.File!=='function'||typeof globalThis.crypto?.subtle?.digest!=='function')throw new SourceExportLocalFilesError('unavailable');
 const FileType=globalThis.File,digest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let running=false,disposed=false,current:AbortController|undefined;
 function selected(input:unknown):readonly Local[]{
  require(Array.isArray(input)&&input.length<=1024);const descriptors=Object.getOwnPropertyDescriptors(input),length=input.length;require(Reflect.ownKeys(descriptors).length===length+1);
  return Object.freeze(Array.from({length},(_,i)=>{const field=descriptors[String(i)];require(field?.enumerable&&Object.hasOwn(field,'value')&&field.value instanceof FileType);const file=field.value as File,name=file.name,size=file.size,stream=file.stream;require(typeof name==='string'&&name.length>=1&&name.length<=1024&&Number.isSafeInteger(size)&&size>=0&&typeof stream==='function');return Object.freeze({name,size,stream:stream.bind(file)});}));
 }
 async function inspect(file:Local,expected:(typeof inventory.files)[number],signal:AbortSignal):Promise<Invalid|null>{
  const owned=new Uint8Array(expected.bytes);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,size=0;
  try{
   try{
    require(!signal.aborted);reader=file.stream().getReader();
    for(;;){const part=await bounded(reader.read(),signal);if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength===0)throw new Error();if(size+part.value.byteLength>owned.byteLength)return 'length';owned.set(part.value,size);size+=part.value.byteLength;}
   }catch{if(signal.aborted)throw new Error();return 'unreadable';}
   require(!signal.aborted);if(size!==owned.byteLength)return 'length';
   // A crypto failure aborts the whole comparison; it is not a corrupt file.
   const hash=Array.from(new Uint8Array(await bounded(digest('SHA-256',owned),signal)),b=>b.toString(16).padStart(2,'0')).join('');require(!signal.aborted);return hash===expected.sha256?null:'checksum';
  }finally{owned.fill(0);try{void reader?.cancel().catch(()=>{});reader?.releaseLock();}catch{/* Cleanup cannot disclose a local path or replace the comparison outcome. */}}
 }
 return Object.freeze({
  async verify(inputFiles:unknown,external:AbortSignal){
   let entered=false;
   try{
    require(!disposed&&!running&&!external.aborted);const controller=new AbortController(),signal=AbortSignal.any([external,controller.signal,AbortSignal.timeout(60000)]);
    let files:readonly Local[];try{files=selected(inputFiles);}catch{throw new SourceExportLocalFilesError('input');}require(!signal.aborted&&!disposed);running=true;entered=true;current=controller;
    const byName=new Map<string,Local[]>(),names=new Set(inventory.files.map(f=>f.fileName));let extraCount=0;
    for(const file of files){if(!names.has(file.name)){extraCount++;continue;}const list=byName.get(file.name)??[];list.push(file);byName.set(file.name,list);}
    const matched:string[]=[],missing:string[]=[],invalid:Readonly<{partId:string;reason:Invalid}>[]=[];
    for(const expected of inventory.files){
     require(!signal.aborted);const candidates=byName.get(expected.fileName);
     if(!candidates){missing.push(expected.partId);continue;}
     if(candidates.length!==1){invalid.push(Object.freeze({partId:expected.partId,reason:'duplicate'}));continue;}
     const file=candidates[0]!;if(file.size!==expected.bytes){invalid.push(Object.freeze({partId:expected.partId,reason:'length'}));continue;}
     const reason=await inspect(file,expected,signal);if(reason)invalid.push(Object.freeze({partId:expected.partId,reason}));else matched.push(expected.partId);
    }
    require(!signal.aborted&&!disposed);const matches=new Set(matched),remaining=inventory.files.filter(f=>!matches.has(f.partId)).map(f=>f.partId),value=Object.freeze({formatVersion:1 as const,header:inventory.header,state:remaining.length===0&&extraCount===0?'matching' as const:'incomplete' as const,selectedCount:files.length,matchedPartIds:Object.freeze(matched),missingPartIds:Object.freeze(missing),invalid:Object.freeze(invalid),remainingPartIds:Object.freeze(remaining),extraCount,assurance:'selected_file_bytes_only' as const,completePortableExport:false as const,completeBackup:false as const});
    return Object.freeze({forLocalFileComparison:()=>value,toJSON():never{throw new SourceExportLocalFilesError('unavailable');}});
   }catch(error){throw error instanceof SourceExportLocalFilesError?error:new SourceExportLocalFilesError('unavailable');}
   finally{if(entered){current=undefined;running=false;}}
  },
  dispose(){disposed=true;current?.abort();},
  toJSON():never{throw new SourceExportLocalFilesError('unavailable');}
 });
}
