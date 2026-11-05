import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid} from '../customer/customer-contract.ts';

type Input=Readonly<{name:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';content:string}>;
type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
type Part=Readonly<{name:string;contentType:'text/plain; charset=utf-8';content:string;bytes:number;sha256:string}>;
const partLimit=4194304,fileLimit=33554432,totalLimit=67108864;
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export class SourceLogicalFilesError extends Error{constructor(){super('SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');this.name='SourceLogicalFilesError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceLogicalFilesError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);
 require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
// Format bytes only. This proposed schema43 container is deliberately distinct
// from the current worker/manifest. It establishes no capture or owner authority.
export function formatSourceLogicalFiles(inputs:readonly Input[],expected:Binding){
 try{
  const binding=object(expected,['businessId','generationId','appReleaseId','sourceSchemaVersion']);require(uuid(binding.businessId)&&uuid(binding.generationId)&&typeof binding.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&binding.sourceSchemaVersion===43);
  require(Array.isArray(inputs)&&inputs.length>=1&&inputs.length<=1024);const source=inputs.map(value=>object(value,['name','contentType','content'])),names=new Set<string>(),parts:Part[]=[],files:{name:string;contentType:string;bytes:number;sha256:string;parts:{name:string;offsetBytes:number;bytes:number;sha256:string}[]}[]=[];let total=0;
  for(const [index,file]of source.entries()){
   require(typeof file.name==='string'&&/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(file.name)&&!names.has(file.name)&&['text/csv; charset=utf-8','application/json','text/plain; charset=utf-8'].includes(file.contentType as string));names.add(file.name);
   require(typeof file.content==='string'&&file.content.length>=1&&file.content.length<=fileLimit&&!file.content.includes('\0'));const bytes=Buffer.from(file.content);require(bytes.length<=fileLimit&&bytes.toString('utf8')===file.content&&total+bytes.length<=totalLimit);total+=bytes.length;
   const physical:{name:string;offsetBytes:number;bytes:number;sha256:string}[]=[];let offset=0;
   while(offset<bytes.length){let end=Math.min(offset+partLimit,bytes.length);while(end<bytes.length&&(bytes[end]!&192)===128)end--;require(end>offset&&parts.length<1024);const piece=bytes.subarray(offset,end),content=piece.toString('utf8');require(Buffer.byteLength(content)===piece.length);
    const name='source_file_'+String(index+1).padStart(4,'0')+'_part_'+String(physical.length+1).padStart(4,'0')+'.txt',digest=sha(piece);parts.push(Object.freeze({name,contentType:'text/plain; charset=utf-8',content,bytes:piece.length,sha256:digest}));physical.push({name,offsetBytes:offset,bytes:piece.length,sha256:digest});offset=end;
   }
   files.push({name:file.name,contentType:file.contentType as string,bytes:bytes.length,sha256:sha(bytes),parts:physical});
  }
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.source-logical-files.v1',...binding,assurance:'byte_consistency_only',completePortableExport:false,completeBackup:false,totalBytes:total,files})+'\n';require(Buffer.byteLength(manifest)<=partLimit&&total+Buffer.byteLength(manifest)<=totalLimit);
  const result=Object.freeze({parts:Object.freeze(parts),manifest});return Object.freeze({forLogicalFiles:()=>result,toJSON():never{throw new SourceLogicalFilesError();}});
 }catch{throw new SourceLogicalFilesError();}
}
