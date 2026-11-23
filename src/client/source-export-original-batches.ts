import {zipSync,unzipSync} from 'fflate';
import {originalExportHash,downloadExportOriginal} from './source-export-originals';
import type {OriginalExportInventory,OriginalExportFile} from './source-export-originals';
import type {Proof} from './authentication';
import type {CurrentSourceBrowserFile} from './current-source-file-reader';

type Batch=Readonly<{ordinal:number;fileName:string;files:readonly OriginalExportFile[];originalBytes:number}>;
const maximum=33554432;
function require(value:unknown):asserts value{if(!value)throw Error('SOURCE_EXPORT_ORIGINAL_BATCH_UNCONFIRMED');}
export function originalExportBatches(inventory:OriginalExportInventory):readonly Batch[]{
 const batches:Batch[]=[],prefix=`crest_originals_${inventory.header.exportJobId.replaceAll('-','')}_`;let files:OriginalExportFile[]=[],bytes=0;
 function push(){if(!files.length)return;const ordinal=batches.length+1;batches.push(Object.freeze({ordinal,fileName:prefix+String(ordinal).padStart(6,'0')+'.zip',files:Object.freeze(files),originalBytes:bytes}));files=[];bytes=0;}
 for(const file of inventory.files){if(files.length&&(files.length>=25||bytes+file.byteSize>32505856))push();files.push(file);bytes+=file.byteSize;}push();return Object.freeze(batches);
}
function batchManifest(inventory:OriginalExportInventory,batch:Batch,total:number){
 return new TextEncoder().encode(JSON.stringify({schemaVersion:1,profile:'crest.source-export-original-batch.v1',header:inventory.header,inventorySha256:inventory.inventorySha256,batch:batch.ordinal,batchCount:total,originalCount:inventory.files.length,pendingCount:inventory.pendingCount,files:batch.files,completePortableExport:false,completeBackup:false})+'\n');
}
export function createOriginalExportBatchReader(inventory:OriginalExportInventory,receive=downloadExportOriginal){
 const batches=originalExportBatches(inventory);let disposed=false,active=false;
 function check(signal:AbortSignal){require(!disposed&&!signal.aborted);}
 return Object.freeze({batches,
  async receive(ordinal:number,fresh:(signal:AbortSignal)=>Promise<Proof>,signal:AbortSignal,consume:(value:CurrentSourceBrowserFile,signal:AbortSignal,expiresAt:number)=>Promise<void>,progress?:(loaded:number,total:number)=>void){
   const batch=batches.find(item=>item.ordinal===ordinal);require(batch&&!active);active=true;const entries:Record<string,Uint8Array<ArrayBuffer>>=Object.create(null);let archive:Uint8Array<ArrayBuffer>|undefined;
   try{
    check(signal);entries['original_batch.json']=batchManifest(inventory,batch,batches.length);
    let count=0;for(const file of batch.files){check(signal);const proof=await fresh(signal);check(signal);const bytes=await receive(inventory,file,proof,signal);entries[file.path]=bytes;check(signal);require(bytes.byteLength===file.byteSize&&await originalExportHash(bytes)===file.sha256);check(signal);progress?.(++count,batch.files.length);}
    const zipped=zipSync(entries,{level:0,mtime:new Date('2000-01-01T00:00:00Z')});require(zipped.buffer instanceof ArrayBuffer);archive=new Uint8Array(zipped.buffer,zipped.byteOffset,zipped.byteLength);require(archive.byteLength<=maximum);check(signal);const sha256=await originalExportHash(archive),proof=await fresh(signal);check(signal);
    await consume({header:inventory.header,logicalFile:{fileName:batch.fileName,contentType:'application/zip',bytes:archive.byteLength,sha256},bytes:archive},signal,proof.expiresAt);check(signal);
   }finally{for(const bytes of Object.values(entries))bytes.fill(0);archive?.fill(0);active=false;}
  },
  async compare(files:readonly File[],signal:AbortSignal){
   check(signal);require(!active&&files.length<=10000);active=true;const expected=new Map(batches.map(batch=>[batch.fileName,batch])),matches=new Map<string,File[]>();let extraCount=0;
   try{
    for(const file of files){if(!expected.has(file.name)){extraCount++;continue;}const values=matches.get(file.name)??[];values.push(file);matches.set(file.name,values);}
    const results:Readonly<{ordinal:number;state:'matching'|'missing'|'invalid'}>[]=[];
    for(const batch of batches){
     check(signal);const candidates=matches.get(batch.fileName);if(!candidates?.length){results.push({ordinal:batch.ordinal,state:'missing'});continue;}
     if(candidates.length!==1||candidates[0]!.size<1||candidates[0]!.size>maximum){results.push({ordinal:batch.ordinal,state:'invalid'});continue;}
     let bytes:Uint8Array<ArrayBuffer>|undefined,metadata:Uint8Array<ArrayBuffer>|undefined,decoded:Record<string,Uint8Array>|undefined;
     try{
      bytes=new Uint8Array(await candidates[0]!.arrayBuffer());check(signal);require(bytes.byteLength===candidates[0]!.size&&bytes.byteLength<=maximum);
      metadata=batchManifest(inventory,batch,batches.length);const names=new Map([['original_batch.json',metadata.byteLength],...batch.files.map(file=>[file.path,file.byteSize] as const)]),seen=new Set<string>();let invalid=false;
      decoded=unzipSync(bytes,{filter(entry){const size=names.get(entry.name);if(seen.has(entry.name)||size===undefined||entry.originalSize!==size){invalid=true;return false;}seen.add(entry.name);return true;}});
      require(!invalid&&seen.size===names.size&&Object.keys(decoded).length===names.size&&decoded['original_batch.json']?.byteLength===metadata.byteLength&&decoded['original_batch.json']!.every((byte,i)=>byte===metadata![i]));metadata.fill(0);
      for(const file of batch.files){check(signal);const value=decoded[file.path];require(value&&value.byteLength===file.byteSize&&await originalExportHash(value)===file.sha256);}
      check(signal);results.push({ordinal:batch.ordinal,state:'matching'});
     }catch{check(signal);results.push({ordinal:batch.ordinal,state:'invalid'});}
     finally{bytes?.fill(0);metadata?.fill(0);for(const value of Object.values(decoded??{}))value.fill(0);}
    }
    check(signal);return Object.freeze({batches:Object.freeze(results),extraCount});
   }finally{active=false;}
  },
  dispose(){disposed=true;},
 });
}

