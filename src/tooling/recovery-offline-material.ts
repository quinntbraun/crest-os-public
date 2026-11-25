// Owner-only preparation and reconstruction. Never imported by the scheduler.
import {constants} from 'node:fs';
import type {Stats} from 'node:fs';
import {open,lstat,mkdir,rm} from 'node:fs/promises';
import {join,isAbsolute,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {readRecoveryConfiguration,reconstructRecoveryConfiguration} from './recovery-configuration.ts';
import {parseRecoveryJson} from './recovery-json.ts';
import {createRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {RecoveryCaptureLauncher} from './recovery-database-capture.ts';

type Binding=Parameters<typeof readRecoveryConfiguration>[1];
type Recipe=ReturnType<typeof readRecoveryConfiguration>;
type Entry=Readonly<{referenceId:string;kind:'secret'|'file';value:string;byteSize:number;sha256:string}>;
type Material=Readonly<{recipeSha256:string;recipe:Recipe;entries:readonly Entry[]}>;
type ExpectedPlaintext=Readonly<{byteSize:number;sha256:string}>;
const prepared=new WeakMap<object,Material>();
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const maxFile=1048576,maxTotal=4194304,maxEnvelope=8388608;
export class RecoveryOfflineMaterialError extends Error{
 constructor(){super('RECOVERY_OFFLINE_MATERIAL_REVIEW_REQUIRED');this.name='RecoveryOfflineMaterialError';}
}
function require(value:unknown):asserts value{if(!value)throw new RecoveryOfflineMaterialError();}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{
 require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));
}
function privateValue<T>(value:T){return Object.freeze({forRecoveryTools:()=>value,toJSON():never{throw new RecoveryOfflineMaterialError();}});}
function member(profile:unknown,path:string){let value=profile;for(const name of path.slice(1).split('/')){require(value&&typeof value==='object'&&Object.hasOwn(value,name));value=(value as Record<string,unknown>)[name];}require(typeof value==='string');return value;}
function privateOwner(info:Stats){return process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!());}
async function protectedBytes(path:string,signal:AbortSignal){
 require(isAbsolute(path));signal.throwIfAborted();const before=await lstat(path);require(before.isFile()&&privateOwner(before)&&before.size>0&&before.size<=maxFile);
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let bytes:Buffer|undefined;
 try{
  const opened=await file.stat();require(opened.isFile()&&privateOwner(opened)&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size);
  // Allocate only the validated bound, even if a source grows while reading.
  bytes=Buffer.alloc(opened.size);let at=0;while(at<bytes.length){signal.throwIfAborted();const next=await file.read(bytes,at,bytes.length-at,at);require(next.bytesRead>0);at+=next.bytesRead;}
  const extra=Buffer.alloc(1);require((await file.read(extra,0,1,at)).bytesRead===0);const after=await file.stat();
  require(after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&after.ctimeMs===opened.ctimeMs);signal.throwIfAborted();return bytes;
 }catch(error){bytes?.fill(0);throw error;}finally{await file.close();}
}

function capture(seal:ReturnType<typeof createRecoveryFileEncryption>){
 return async(input:Readonly<{recipeSource:string;expected:Binding;profileSource:string;workspace:string;recipient:string}>,signal:AbortSignal)=>{
  let plain:Buffer|undefined;
  try{
   signal.throwIfAborted();const request=Object.freeze({...input,expected:Object.freeze({...input.expected})}),recipe=readRecoveryConfiguration(request.recipeSource,request.expected),profile=parseRecoveryJson(request.profileSource,65536),values=new Map<string,string>();
   for(const reference of recipe.references)values.set(reference.referenceId,member(profile,reference.path));
   // The real production parser and the recipe's secret digests must accept the
   // original profile before any file is opened or an encryptor is launched.
   const reconstructed=await reconstructRecoveryConfiguration({source:request.recipeSource,expected:request.expected},async reference=>values.get(reference.referenceId)!,signal);
   require(isDeepStrictEqual(parseRecoveryJson(reconstructed.forRecoveryTools().profileSource,65536),profile));
   const entries:Entry[]=[];let total=0;
   for(const reference of recipe.references){
    signal.throwIfAborted();const value=values.get(reference.referenceId)!;
    if(reference.kind==='secret'){const bytes=Buffer.from(value);try{total+=bytes.length;require(total<=maxTotal);entries.push(Object.freeze({referenceId:reference.referenceId,kind:reference.kind,value,byteSize:bytes.length,sha256:hash(bytes)}));}finally{bytes.fill(0);}}
    else{const bytes=await protectedBytes(value,signal);try{total+=bytes.length;require(total<=maxTotal);entries.push(Object.freeze({referenceId:reference.referenceId,kind:reference.kind,value:bytes.toString('base64'),byteSize:bytes.length,sha256:hash(bytes)}));}finally{bytes.fill(0);}}
   }
   const recipeSha256=hash(request.recipeSource);plain=Buffer.from(JSON.stringify({profile:'crest.offline-material.v1',binding:recipe.binding,recipeSha256,entries})+'\n');require(plain.length<=maxEnvelope);
   const encrypted=(await seal({workspace:request.workspace,recipient:request.recipient,bytes:plain},signal)).forRecoveryTools();
   return privateValue(Object.freeze({profile:'crest.encrypted-offline-material.v1' as const,referenceDirectoryId:recipe.binding.referenceDirectoryId,recipeSha256,referenceCount:entries.length,...encrypted,offlineCopiesVerified:false as const,accountRecoveryVerified:false as const,applicationStarted:false as const,completeBackup:false as const}));
  }catch{throw new RecoveryOfflineMaterialError();}finally{plain?.fill(0);}
 };
}
export function createRecoveryOfflineMaterialCapture(launch:RecoveryCaptureLauncher){return capture(createRecoveryFileEncryption(launch));}
export async function createPinnedRecoveryOfflineMaterialCapture(tools:Readonly<{age:string}>){
 try{
  require(process.platform==='linux'&&Object.keys(tools).join(',')==='age'&&isAbsolute(tools.age));const executable=tools.age,file=await lstat(executable);require(file.isFile()&&(file.mode&0o111)!==0&&(file.mode&0o022)===0&&(file.uid===0||file.uid===process.getuid!()));
  return createRecoveryOfflineMaterialCapture((command,args,environment)=>{require(command==='age');return spawn(executable,args,{env:{...environment,NODE_ENV:'production'},stdio:['pipe','pipe','pipe'],windowsHide:true});});
 }catch{throw new RecoveryOfflineMaterialError();}
}

// Only call after standard age decryption on the independent owner recovery
// machine. Expected length/hash come from the owner's retained kit descriptor.
export function readRecoveryOfflineMaterial(input:Readonly<{source:string;plaintext:ExpectedPlaintext;recipeSource:string;expected:Binding}>){
 try{
  const recipe=readRecoveryConfiguration(input.recipeSource,input.expected);require(typeof input.source==='string'&&Number.isSafeInteger(input.plaintext.byteSize)&&input.plaintext.byteSize>0&&input.plaintext.byteSize<=maxEnvelope&&Buffer.byteLength(input.source)===input.plaintext.byteSize&&/^[a-f0-9]{64}$/.test(input.plaintext.sha256)&&hash(input.source)===input.plaintext.sha256);
  const envelope=parseRecoveryJson(input.source,maxEnvelope);exact(envelope,['profile','binding','recipeSha256','entries']);
  require(envelope.profile==='crest.offline-material.v1'&&isDeepStrictEqual(envelope.binding,recipe.binding)&&envelope.recipeSha256===hash(input.recipeSource)&&Array.isArray(envelope.entries)&&envelope.entries.length===recipe.references.length);
  const entries:Entry[]=[];let total=0;
  for(const [index,reference]of recipe.references.entries()){
   const entry=envelope.entries[index];exact(entry,['referenceId','kind','value','byteSize','sha256']);require(entry.referenceId===reference.referenceId&&entry.kind===reference.kind&&typeof entry.value==='string'&&Number.isSafeInteger(entry.byteSize)&&typeof entry.byteSize==='number'&&entry.byteSize>0&&entry.byteSize<=(reference.kind==='file'?maxFile:65536)&&typeof entry.sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256));
   const bytes=Buffer.from(entry.value,reference.kind==='file'?'base64':'utf8');try{require(bytes.length===entry.byteSize&&hash(bytes)===entry.sha256&&(reference.kind==='file'?bytes.toString('base64')===entry.value:entry.sha256===reference.valueSha256));total+=bytes.length;require(total<=maxTotal);}finally{bytes.fill(0);}
   entries.push(Object.freeze({...entry}) as Entry);
  }
  const evidence=privateValue(Object.freeze({profile:'crest.checked-offline-material.v1' as const,referenceDirectoryId:recipe.binding.referenceDirectoryId,referenceCount:entries.length,applicationStarted:false as const,completeBackup:false as const}));prepared.set(evidence,Object.freeze({recipeSha256:hash(input.recipeSource),recipe,entries:Object.freeze(entries)}));return evidence;
 }catch{throw new RecoveryOfflineMaterialError();}
}

export async function materializeRecoveryOfflineConfiguration(input:Readonly<{material:unknown;recipeSource:string;expected:Binding;parent:string}>,signal:AbortSignal){
 let directory:string|undefined,owned=false;
 async function syncDirectory(path:string){if(process.platform==='linux'){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}}
 async function writePrivate(path:string,bytes:Uint8Array){const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await syncDirectory(directory!);}
 try{
  signal.throwIfAborted();const material=input.material&&typeof input.material==='object'?prepared.get(input.material):undefined;require(material&&material.recipeSha256===hash(input.recipeSource));const recipe=readRecoveryConfiguration(input.recipeSource,input.expected);require(isDeepStrictEqual(recipe.binding,material.recipe.binding));
  const parent=resolve(input.parent);require(isAbsolute(input.parent));const info=await lstat(parent);require(info.isDirectory()&&privateOwner(info));directory=join(parent,'configuration-'+randomUUID());await mkdir(directory,{mode:0o700});owned=true;await syncDirectory(parent);
  const paths=new Map<string,string>();
  for(const entry of material.entries){signal.throwIfAborted();if(entry.kind==='file'){const path=join(directory,entry.referenceId),bytes=Buffer.from(entry.value,'base64');try{await writePrivate(path,bytes);paths.set(entry.referenceId,path);}finally{bytes.fill(0);}}}
  const reconstructed=await reconstructRecoveryConfiguration({source:input.recipeSource,expected:input.expected},async reference=>{signal.throwIfAborted();const entry=material.entries.find(item=>item.referenceId===reference.referenceId);require(entry);return entry.kind==='file'?paths.get(entry.referenceId)!:entry.value;},signal);
  signal.throwIfAborted();const path=join(directory,'production-profile.json'),bytes=Buffer.from(reconstructed.forRecoveryTools().profileSource+'\n');try{await writePrivate(path,bytes);}finally{bytes.fill(0);}signal.throwIfAborted();
  return privateValue(Object.freeze({profile:'crest.materialized-offline-configuration.v1' as const,referenceDirectoryId:recipe.binding.referenceDirectoryId,profilePath:path,fileCount:paths.size,platformDirectoryFlush:process.platform==='linux',credentialsRotated:false as const,certificateValidityVerified:false as const,offlineCopiesVerified:false as const,applicationStarted:false as const,completeBackup:false as const}));
 }catch{
  if(owned&&directory&&dirname(directory)===resolve(input.parent)&&/^configuration-[a-f0-9-]{36}$/.test(directory.slice(dirname(directory).length+1)))await rm(directory,{recursive:true,force:true}).catch(()=>{});
  throw new RecoveryOfflineMaterialError();
 }
}
