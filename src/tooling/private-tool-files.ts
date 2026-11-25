// Tool-only bounded local input. No URL, ambient credentials or permissive
// symlink fallback. The caller decides whether a file contains private material.
import {constants} from 'node:fs';
import type {Stats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
export async function readPrivateToolText(path:unknown,maximum:number,signal:AbortSignal,privateFile=true){
 function require(value:unknown):asserts value{if(!value)throw Error('PRIVATE_TOOL_FILE_REVIEW_REQUIRED');}
 require(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=8388608&&typeof path==='string'&&isAbsolute(path)&&!path.includes('\0'));signal.throwIfAborted();
 const owner=(info:Stats)=>!privateFile||process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!());
 const before=await lstat(path);require(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maximum&&owner(before));
 const file=await open(path,constants.O_RDONLY|(process.platform==='linux'?constants.O_NOFOLLOW:0));let bytes:Buffer|undefined;
 try{const info=await file.stat();require(info.isFile()&&info.dev===before.dev&&info.ino===before.ino&&info.size===before.size&&owner(info));bytes=Buffer.alloc(info.size);let at=0;while(at<bytes.length){signal.throwIfAborted();const next=await file.read(bytes,at,bytes.length-at,at);require(next.bytesRead>0);at+=next.bytesRead;}require((await file.read(Buffer.alloc(1),0,1,at)).bytesRead===0);const after=await file.stat();require(after.size===info.size&&after.mtimeMs===info.mtimeMs&&after.ctimeMs===info.ctimeMs&&owner(after));const text=bytes.toString('utf8');require(Buffer.from(text).equals(bytes));signal.throwIfAborted();return text;}finally{bytes?.fill(0);await file.close();}
}
