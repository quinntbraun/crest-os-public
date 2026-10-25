// Private generated-fixture filesystem transport. This is NOT a B2/R2 adapter
// or proof of independent-account access, Object Lock, retention or capacity.
import assert from 'node:assert/strict';
import {open,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,run} from './recovery-drill.mjs';
const age=fileURLToPath(new URL(`../../.local/tools/recovery/age/age${process.platform==='win32'?'.exe':''}`,import.meta.url));
export async function objectDirectory(directory){
  assert.equal(process.env.CREST_ENV,'test');await mkdir(directory,{recursive:true,mode:0o700});
  const path=key=>join(directory,hash(key)+'.bin');
  return {
    path,
    async read(key,maximumBytes,signal){
      signal.throwIfAborted();assert(Number.isSafeInteger(maximumBytes)&&maximumBytes>0&&maximumBytes<=26*1024*1024);
      const file=await open(path(key),'r');
      try{
        const info=await file.stat();assert(info.isFile()&&info.size>0&&info.size<=maximumBytes);
        const chunks=[];let size=0;
        while(true){
          signal.throwIfAborted();const buffer=Buffer.alloc(Math.min(65536,maximumBytes+1-size));
          const {bytesRead}=await file.read(buffer);if(!bytesRead)break;size+=bytesRead;assert(size<=maximumBytes);chunks.push(buffer.subarray(0,bytesRead));
        }
        signal.throwIfAborted();return Buffer.concat(chunks,size);
      }finally{await file.close();}
    },
    async put(key,bytes,signal){
      signal.throwIfAborted();const file=await open(path(key),'wx',0o600);
      try{await file.writeFile(bytes);await file.sync();signal.throwIfAborted();}finally{await file.close();}
    }
  };
}
export function encryptor(recipient){return async(bytes,signal)=>{signal.throwIfAborted();const result=await run(age,['--encrypt','--recipient',recipient],{input:bytes,signal});signal.throwIfAborted();return result;};}
export function decryptor(identity){return async(bytes,signal)=>{signal.throwIfAborted();const result=await run(age,['--decrypt','--identity',identity],{input:bytes,signal});signal.throwIfAborted();return result;};}
