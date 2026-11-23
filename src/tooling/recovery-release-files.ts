// Stream release archives without loading a container image into memory or
// making a second plaintext copy. Digests establish bytes, not CI authorship.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

export const recoveryReleaseFileLimit=8*1024*1024*1024;
export const recoveryReleasePartLimit=1024*1024*1024-65536;
export class RecoveryReleaseFileError extends Error{constructor(){super('RECOVERY_RELEASE_FILE_REVIEW_REQUIRED');this.name='RecoveryReleaseFileError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryReleaseFileError();}
export async function openRecoveryReleaseFile(path:string){
 let file:Awaited<ReturnType<typeof open>>|undefined;
 try{
  require(isAbsolute(path));const link=await lstat(path);require(link.isFile()&&!link.isSymbolicLink());file=await open(path,constants.O_RDONLY|(process.platform==='linux'?constants.O_NOFOLLOW:0));const before=await file.stat();
  require(before.isFile()&&before.size>0&&before.size<=recoveryReleaseFileLimit&&link.dev===before.dev&&link.ino===before.ino);
  const source=file;let streamed=false,closed=false;
  return Object.freeze({byteSize:before.size,
   stream(signal:AbortSignal,range?:Readonly<{offset:number;byteSize:number}>){require(!streamed&&!closed);signal.throwIfAborted();if(range)require(Number.isSafeInteger(range.offset)&&range.offset>=0&&Number.isSafeInteger(range.byteSize)&&range.byteSize>0&&range.offset+range.byteSize<=before.size);streamed=true;return source.createReadStream({start:range?.offset??0,...(range?{end:range.offset+range.byteSize-1}:{}),autoClose:false,signal});},
   async verifyUnchanged(){require(!closed);const after=await source.stat();require(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs);},
   async close(){if(!closed){closed=true;await source.close();}}
  });
 }catch{await file?.close().catch(()=>{});throw new RecoveryReleaseFileError();}
}
export async function hashRecoveryReleaseParts(path:string,signal:AbortSignal,partByteSize=256*1024*1024){
 let source:Awaited<ReturnType<typeof openRecoveryReleaseFile>>|undefined;
 try{
  require(Number.isSafeInteger(partByteSize)&&partByteSize>=1048576&&partByteSize<=recoveryReleasePartLimit);signal.throwIfAborted();source=await openRecoveryReleaseFile(path);require(Math.ceil(source.byteSize/partByteSize)<=128);
  const full=createHash('sha256'),parts:Readonly<{offset:number;byteSize:number;sha256:string}>[]=[];let part=createHash('sha256'),count=0,partCount=0;
  function finish(){parts.push(Object.freeze({offset:count-partCount,byteSize:partCount,sha256:part.digest('hex')}));part=createHash('sha256');partCount=0;}
  for await(const chunk of source.stream(signal)){
   signal.throwIfAborted();full.update(chunk);let offset=0;
   while(offset<chunk.length){const take=Math.min(partByteSize-partCount,chunk.length-offset);part.update(chunk.subarray(offset,offset+take));offset+=take;count+=take;partCount+=take;require(count<=source.byteSize);if(partCount===partByteSize)finish();}
  }
  if(partCount)finish();require(count===source.byteSize);await source.verifyUnchanged();signal.throwIfAborted();return Object.freeze({profile:'crest.release-file-parts.v1' as const,byteSize:count,sha256:full.digest('hex'),parts:Object.freeze(parts)});
 }catch{throw new RecoveryReleaseFileError();}finally{await source?.close();}
}
export async function hashRecoveryReleaseFile(path:string,signal:AbortSignal){
 let source:Awaited<ReturnType<typeof openRecoveryReleaseFile>>|undefined;
 try{
  signal.throwIfAborted();source=await openRecoveryReleaseFile(path);const hash=createHash('sha256');let count=0;
  for await(const chunk of source.stream(signal)){signal.throwIfAborted();count+=chunk.length;require(count<=source.byteSize);hash.update(chunk);}
  require(count===source.byteSize);await source.verifyUnchanged();signal.throwIfAborted();return Object.freeze({byteSize:count,sha256:hash.digest('hex')});
 }catch{throw new RecoveryReleaseFileError();}finally{await source?.close();}
}
