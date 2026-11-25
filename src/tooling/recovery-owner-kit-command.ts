// Explicit owner-only command. Paths, never credentials, appear in argv.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {parseRecoveryJson} from './recovery-json.ts';
import {readRecoveryConfiguration} from './recovery-configuration.ts';
import {createPinnedRecoveryOfflineMaterialCapture,readRecoveryOfflineMaterial,materializeRecoveryOfflineConfiguration,RecoveryOfflineMaterialError} from './recovery-offline-material.ts';

function require(value:unknown):asserts value{if(!value)throw new RecoveryOfflineMaterialError();}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
function path(value:unknown):asserts value is string{require(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'));}
async function source(pathname:string,maximum:number,signal:AbortSignal){
 signal.throwIfAborted();path(pathname);const before=await lstat(pathname);require(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maximum&&(process.platform!=='linux'||((before.mode&0o077)===0&&before.uid===process.getuid!())));
 const file=await open(pathname,constants.O_RDONLY|(process.platform==='linux'?constants.O_NOFOLLOW:0));let bytes:Buffer|undefined;
 try{
  const info=await file.stat();require(info.dev===before.dev&&info.ino===before.ino&&info.size===before.size&&info.isFile()&&(process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!())));bytes=Buffer.alloc(info.size);let at=0;
  while(at<bytes.length){signal.throwIfAborted();const next=await file.read(bytes,at,bytes.length-at,at);require(next.bytesRead>0);at+=next.bytesRead;}
  const extra=Buffer.alloc(1);require((await file.read(extra,0,1,at)).bytesRead===0);const after=await file.stat();require(after.size===info.size&&after.mtimeMs===info.mtimeMs&&after.ctimeMs===info.ctimeMs);signal.throwIfAborted();const text=bytes.toString('utf8');require(Buffer.from(text).equals(bytes));return text;
 }finally{bytes?.fill(0);await file.close();}
}

export async function runRecoveryOwnerKitCommand(args:readonly string[],external:AbortSignal){
 const signal=AbortSignal.any([external,AbortSignal.timeout(120000)]);
 try{
  require(args.length===2&&['capture','materialize'].includes(args[0]!));path(args[1]);const request=parseRecoveryJson(await source(args[1],16384,signal),16384),capture=args[0]==='capture';
  exact(request,capture?['schemaVersion','expected','recipeFile','profileFile','workspace','recipient','tools']:['schemaVersion','expected','recipeFile','materialFile','plaintext','parent']);require(request.schemaVersion===1);path(request.recipeFile);
  const recipeSource=await source(request.recipeFile,262144,signal),recipe=readRecoveryConfiguration(recipeSource,request.expected as Parameters<typeof readRecoveryConfiguration>[1]);
  if(capture){
   require(process.platform==='linux');path(request.profileFile);path(request.workspace);require(typeof request.recipient==='string'&&/^age1[a-z0-9]{58}$/.test(request.recipient));exact(request.tools,['age']);path(request.tools.age);
   const profileSource=await source(request.profileFile,65536,signal),run=await createPinnedRecoveryOfflineMaterialCapture({age:request.tools.age}),result=await run({recipeSource,expected:recipe.binding,profileSource,workspace:request.workspace,recipient:request.recipient},signal);return result.forRecoveryTools();
  }
  path(request.materialFile);path(request.parent);exact(request.plaintext,['byteSize','sha256']);require(typeof request.plaintext.byteSize==='number'&&typeof request.plaintext.sha256==='string');
  const material=readRecoveryOfflineMaterial({source:await source(request.materialFile,8388608,signal),plaintext:{byteSize:request.plaintext.byteSize,sha256:request.plaintext.sha256},recipeSource,expected:recipe.binding}),result=await materializeRecoveryOfflineConfiguration({material,recipeSource,expected:recipe.binding,parent:request.parent},signal);return result.forRecoveryTools();
 }catch{throw new RecoveryOfflineMaterialError();}
}
