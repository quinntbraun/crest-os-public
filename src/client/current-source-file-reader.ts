import type {Proof} from './authentication';
import type {createSourceExportDownloadClient} from './source-export-downloads';
import type {SourceExportDownloadInventory} from './source-export-download-inventory';
import {describeCurrentSourceLogicalFiles,readCurrentSourceLogicalSelection} from './current-source-logical-files';
export type CurrentSourceBrowserFile=Readonly<{header:SourceExportDownloadInventory['header'];logicalFile:Readonly<{fileName:string;contentType:string;bytes:number;sha256:string}>;bytes:Uint8Array<ArrayBuffer>}>;
export function createCurrentSourceFileReader(inventory:SourceExportDownloadInventory,api:ReturnType<typeof createSourceExportDownloadClient>){
 const header=inventory.header;if(header.profile!=='crest.current-business-source-bundle.v1'||(header.sourceSchemaVersion!==134&&header.sourceSchemaVersion!==135&&header.sourceSchemaVersion!==136&&header.sourceSchemaVersion!==137))throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');
 const binding={businessId:header.businessId,generationId:header.generationId,appReleaseId:header.appReleaseId,sourceSchemaVersion:header.sourceSchemaVersion};
 let disposed=false,manifest:string|undefined,index:Awaited<ReturnType<typeof describeCurrentSourceLogicalFiles>>|undefined;
 function check(signal:AbortSignal){if(disposed||signal.aborted)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');}
 async function list(fresh:(signal:AbortSignal)=>Promise<Proof>,signal:AbortSignal){
  check(signal);if(index)return index;
  const root=inventory.files.find(file=>file.fileName==='source_manifest.json');if(!root||root.sha256!==header.manifestSha256)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');
  const proof=await fresh(signal);check(signal);await api.receive(header,root,proof,signal,async value=>{check(signal);manifest=new TextDecoder('utf-8',{fatal:true}).decode(value.bytes);});check(signal);
  const next=await describeCurrentSourceLogicalFiles(manifest!,binding,signal);check(signal);
  // The manifest may describe only the physical files in this authorized job.
  const expected=new Map(inventory.files.filter(file=>file!==root).map(file=>[file.fileName,file]));let count=0;
  for(const file of next)for(const part of file.parts){const actual=expected.get(part.name);if(!actual||actual.bytes!==part.bytes||actual.sha256!==part.sha256)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');count++;}
  if(count!==expected.size)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');index=next;return index;
 }
 return Object.freeze({list,
  async receive(name:string,fresh:(signal:AbortSignal)=>Promise<Proof>,signal:AbortSignal,consume:(file:CurrentSourceBrowserFile,signal:AbortSignal,proofExpiresAt:number)=>Promise<void>){
   const parts:{name:string;bytes:Uint8Array<ArrayBuffer>}[]=[];let decoded:Awaited<ReturnType<typeof readCurrentSourceLogicalSelection>>|undefined;
   try{
    const files=await list(fresh,signal),file=files.find(file=>file.name===name);if(!file)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');
    for(const part of file.parts){check(signal);const physical=inventory.files.find(item=>item.fileName===part.name);if(!physical)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');const proof=await fresh(signal);check(signal);await api.receive(header,physical,proof,signal,async value=>{check(signal);parts.push({name:part.name,bytes:new Uint8Array(value.bytes)});});}
    check(signal);decoded=await readCurrentSourceLogicalSelection(manifest!,parts,binding,[name],signal);check(signal);if(decoded.length!==1||decoded[0]!.name!==name)throw Error('CURRENT_SOURCE_FILE_REVIEW_REQUIRED');
    const proof=await fresh(signal);check(signal);const bytes=new Uint8Array(decoded[0]!.bytes);
    try{await consume({header,logicalFile:{fileName:file.name,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256},bytes},signal,proof.expiresAt);check(signal);}finally{bytes.fill(0);}
   }finally{for(const file of [...parts,...(decoded??[])])file.bytes.fill(0);}
  },
  dispose(){disposed=true;manifest=undefined;index=undefined;}
 });
}
