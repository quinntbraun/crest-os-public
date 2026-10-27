import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {downloadObject,downloadHeaderKeys,parseSourceExportDownloadHeader,parseSourceExportDownloadFile,parseSourceExportDownloadCatalogue} from '../security/source-export-download-contract.ts';

type Header=ReturnType<typeof parseSourceExportDownloadHeader>;
type Part=ReturnType<typeof parseSourceExportDownloadFile>;
export type SourceExportDownloadInventory=Readonly<{formatVersion:1;header:Header;files:readonly Part[];assurance:'catalogue_consistency_only';completePortableExport:false;completeBackup:false}>;
export class SourceExportInventoryError extends Error{constructor(){super('SOURCE_EXPORT_INVENTORY_REVIEW_REQUIRED');this.name='SourceExportInventoryError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportInventoryError();}
function header(input:unknown,businessId:string){const v=downloadObject(input,downloadHeaderKeys);return parseSourceExportDownloadHeader(v,businessId,v.exportJobId as string,v.generationId as string);}
function array(input:unknown,max:number):unknown[]{
 require(Array.isArray(input)&&input.length<=max);const d=Object.getOwnPropertyDescriptors(input),length=input.length;require(Reflect.ownKeys(d).length===length+1);
 return Array.from({length},(_,i)=>{const field=d[String(i)];require(field?.enumerable&&Object.hasOwn(field,'value'));return field.value;});
}
function entries(input:readonly Part[],h:Header,final:boolean){
 require(input.length<=h.fileCount);const names=new Set<string>(),ids=new Set<string>();let bytes=0,previous='';
 for(const [i,file]of input.entries()){
  require(file.ordinal===i+1&&!names.has(file.fileName)&&!ids.has(file.partId));names.add(file.fileName);ids.add(file.partId);bytes+=file.bytes;require(bytes<=h.totalBytes);
  if(file.ordinal===h.fileCount)require(file.fileName==='source_manifest.json'&&file.contentType==='application/json'&&file.sha256===h.manifestSha256);
  else{require(file.fileName!=='source_manifest.json'&&file.fileName>previous);previous=file.fileName;}
 }
 if(final)require(input.length===h.fileCount&&bytes===h.totalBytes);else require(input.length<h.fileCount&&bytes+h.fileCount-input.length<=h.totalBytes);
}
export function parseSourceExportDownloadInventory(input:unknown,businessId:string):SourceExportDownloadInventory{
 try{
  const v=downloadObject(input,['formatVersion','header','files','assurance','completePortableExport','completeBackup']);require(uuid(businessId)&&v.formatVersion===1&&v.assurance==='catalogue_consistency_only'&&v.completePortableExport===false&&v.completeBackup===false);
  const h=header(v.header,businessId),files=array(v.files,1024).map(parseSourceExportDownloadFile);entries(files,h,true);return Object.freeze({formatVersion:1,header:h,files:Object.freeze(files),assurance:'catalogue_consistency_only',completePortableExport:false,completeBackup:false});
 }catch{throw new SourceExportInventoryError();}
}
// Metadata consistency only. No fetch, credentials, saved-file claims or
// authority follows from a completed inventory, including an expired one.
export function createSourceExportInventoryBuilder(businessId:string,exportJobId:string){
 require(uuid(businessId)&&uuid(exportJobId));const business=businessId,job=exportJobId;let pin:Header|undefined,files:readonly Part[]=Object.freeze([]),next:number|null=0,disposed=false;
 function live(){require(!disposed);}
 return Object.freeze({
  request(){live();return next===null?null:Object.freeze({exportJobId:job,generationId:pin?.generationId??null,afterOrdinal:next});},
  pinnedHeader(){live();return pin;},
  progress(){live();return Object.freeze({loaded:files.length,total:pin?.fileCount??null,metadataComplete:next===null});},
  append(input:unknown){
   try{
    live();require(next!==null);const page=parseSourceExportDownloadCatalogue(input,business,{exportJobId:job,generationId:pin?.generationId??null,afterOrdinal:next}),h=header(Object.fromEntries(downloadHeaderKeys.map(k=>[k,page[k]])),business);
    require(!pin||JSON.stringify(h)===JSON.stringify(pin));const combined=Object.freeze([...files,...page.files]);entries(combined,h,page.nextOrdinal===null);
    // All checks precede state changes; a rejected page cannot poison resume.
    files=combined;pin=h;next=page.nextOrdinal;
   }catch{throw new SourceExportInventoryError();}
  },
  snapshot(){
   live();require(next===null&&pin);const value=parseSourceExportDownloadInventory({formatVersion:1,header:pin,files,assurance:'catalogue_consistency_only',completePortableExport:false,completeBackup:false},business);
   return Object.freeze({forDownloadInventory:()=>value,toJSON():never{throw new SourceExportInventoryError();}});
  },
  dispose(){disposed=true;pin=undefined;files=Object.freeze([]);next=0;},
  toJSON():never{throw new SourceExportInventoryError();}
 });
}
