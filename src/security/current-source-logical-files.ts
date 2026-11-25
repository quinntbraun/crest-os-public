import 'server-only';
import {createHash} from 'node:crypto';
import {readCurrentSourceLogicalFiles} from '../client/current-source-logical-files.ts';
import type {CurrentLogicalBinding} from '../client/current-source-logical-files.ts';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Input=Readonly<{name:string;bytes:Uint8Array}>;
export async function formatCurrentSourceLogicalFiles(inputs:readonly Input[],binding:CurrentLogicalBinding,observedAt:string,signal:AbortSignal){
 const parts:{name:string;contentType:'text/plain; charset=utf-8';content:string;bytes:number;sha256:string}[]=[],files:Record<string,unknown>[]=[];let encodedTotal=0,decodedTotal=0;
 try{
  if(inputs.length<1||inputs.length>1024)throw Error();
  for(const [index,file]of inputs.entries()){
   if(!/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt|xlsx)$/.test(file.name)||!(file.bytes instanceof Uint8Array)||file.bytes.length<1||file.bytes.length>33554432||signal.aborted)throw Error();
   const binary=file.name.endsWith('.xlsx'),encoded=binary?Buffer.from(Buffer.from(file.bytes).toString('base64')):Buffer.from(file.bytes),physical:{name:string;offsetBytes:number;bytes:number;sha256:string}[]=[];
   try{
    encodedTotal+=encoded.length;decodedTotal+=file.bytes.length;if(encodedTotal>67108864||decodedTotal>67108864)throw Error();
    let offset=0;
    while(offset<encoded.length){
     let end=Math.min(offset+4194304,encoded.length);while(end<encoded.length&&(encoded[end]!&192)===128)end--;if(end<=offset||parts.length>=1024)throw Error();
     const bytes=encoded.subarray(offset,end),name='current_file_'+String(index+1).padStart(4,'0')+'_part_'+String(physical.length+1).padStart(4,'0')+'.txt',sha256=digest(bytes),content=bytes.toString('utf8');
     if(Buffer.byteLength(content)!==bytes.length||!Buffer.from(content).equals(bytes))throw Error();
     parts.push({name,contentType:'text/plain; charset=utf-8',content,bytes:bytes.length,sha256});physical.push({name,offsetBytes:offset,bytes:bytes.length,sha256});offset=end;
    }
    files.push({name:file.name,contentType:binary?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':file.name.endsWith('.csv')?'text/csv; charset=utf-8':file.name.endsWith('.json')?'application/json':'text/plain; charset=utf-8',encoding:binary?'base64':'utf8',bytes:file.bytes.length,sha256:digest(file.bytes),encodedBytes:encoded.length,encodedSha256:digest(encoded),parts:physical});
   }finally{encoded.fill(0);}
  }
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.current-source-logical-files.v1',businessId:binding.businessId,generationId:binding.generationId,appReleaseId:binding.appReleaseId,sourceSchemaVersion:binding.sourceSchemaVersion,observedAt,totalEncodedBytes:encodedTotal,totalDecodedBytes:decodedTotal,files,completePortableExport:false,completeBackup:false})+'\n';
  const verified=await readCurrentSourceLogicalFiles(manifest,parts.map(part=>({name:part.name,bytes:Buffer.from(part.content)})),binding,signal);
  try{if(verified.length!==inputs.length||verified.some((file,index)=>file.name!==inputs[index]!.name||!Buffer.from(file.bytes).equals(inputs[index]!.bytes)))throw Error();}finally{for(const file of verified)file.bytes.fill(0);}
  return Object.freeze({manifest,parts:Object.freeze(parts.map(part=>Object.freeze(part)))});
 }catch{throw Error('CURRENT_SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');}
}
