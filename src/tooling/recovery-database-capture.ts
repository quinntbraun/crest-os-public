// Isolated recovery-tool mechanics. No web import, credential provisioning,
// runtime grant, scheduler or complete-backup authority.
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {open,lstat,mkdtemp,rm,unlink} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname,basename} from 'node:path';
import {Readable,Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {recoveryBackupSnapshotMatches} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import {captureRecoveryDatabaseInventory} from './recovery-database-inventory.ts';
import {captureRecoveryOriginalInventory} from './recovery-original-inventory.ts';
import {openRecoveryReleaseFile,recoveryReleaseFileLimit,recoveryReleasePartLimit} from './recovery-release-files.ts';

type Command='pg_dump'|'age';
export type RecoveryCaptureLauncher=(command:Command,args:string[],environment:Record<string,string>)=>ChildProcessWithoutNullStreams;
export type RecoveryDatabaseCaptureInput=Readonly<{environment:'production'|'test';connectionString:string;rootCertificate:string|null;workspace:string;snapshot:RecoveryBackupSnapshot;recipient:string}>;
export class RecoveryDatabaseCaptureError extends Error{constructor(){super('RECOVERY_DATABASE_CAPTURE_REVIEW_REQUIRED');this.name='RecoveryDatabaseCaptureError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryDatabaseCaptureError();}
const limit=1024*1024*1024,ageHeader=Buffer.from('age-encryption.org/v1\n'),dumpHeader=Buffer.from('PGDMP');

function databaseTarget(input:RecoveryDatabaseCaptureInput){
 const url=new URL(input.connectionString),database=decodeURIComponent(url.pathname.slice(1)),user=decodeURIComponent(url.username),password=decodeURIComponent(url.password),host=url.hostname.replace(/^\[|\]$/g,''),port=Number(url.port||5432);
 require(['production','test'].includes(input.environment)&&['postgres:','postgresql:'].includes(url.protocol)&&!url.search&&!url.hash&&host.length>0&&/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(database)&&/^[a-zA-Z0-9_]{1,63}$/.test(user)&&password.length>0&&password.length<=4096&&!password.includes('\0')&&port>0&&port<=65535);
 require(input.environment!=='test'||(['127.0.0.1','::1'].includes(host)&&/^crest_migrate_[a-f0-9]{16}$/.test(database)&&input.rootCertificate===null));
 require(input.environment!=='production'||(process.platform==='linux'&&typeof input.rootCertificate==='string'&&isAbsolute(input.rootCertificate)));
 return{host,port,database,user,password,secure:input.environment==='production'};
}
function childEnvironment(home:string){
 const env:Record<string,string>={HOME:home,USERPROFILE:home,TMPDIR:home,TMP:home,TEMP:home,LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
 for(const name of ['PATH','SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name]!;return env;
}
function tracked(child:ChildProcessWithoutNullStreams,signal:AbortSignal){
 let errored=false,stderr=0,stopping=false;const timer:ReturnType<typeof setTimeout>[]=[];
 const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');const t=setTimeout(()=>child.kill('SIGKILL'),1000);t.unref();timer.push(t);};
 child.on('error',()=>{errored=true;});child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.length;if(stderr>16384)stop();});
 const closed=new Promise<void>((ok,bad)=>child.once('close',code=>{signal.removeEventListener('abort',stop);for(const t of timer)clearTimeout(t);if(code!==0||errored||stderr!==0)bad(new RecoveryDatabaseCaptureError());else ok();}));void closed.catch(()=>{});
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();return{child,closed};
}
async function version(launch:RecoveryCaptureLauncher,command:Command,env:Record<string,string>,signal:AbortSignal){
 const tool=tracked(launch(command,['--version'],env),signal),chunks:Buffer[]=[];let bytes=0;
 tool.child.stdin.end();tool.child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>4096)tool.child.kill('SIGKILL');else chunks.push(chunk);});await tool.closed;require(bytes<=4096);return Buffer.concat(chunks).toString('utf8').trim();
}
function meter(expected:Buffer){
 const digest=createHash('sha256'),prefix=Buffer.alloc(expected.length);let bytes=0,prefixBytes=0;
 const stream=new Transform({transform(chunk:Buffer,_encoding,done){bytes+=chunk.length;if(bytes>limit){done(new RecoveryDatabaseCaptureError());return;}const take=Math.min(chunk.length,prefix.length-prefixBytes);if(take>0){chunk.copy(prefix,prefixBytes,0,take);prefixBytes+=take;}digest.update(chunk);done(null,chunk);}});
 return{stream,finish(){require(bytes>=expected.length&&prefix.equals(expected));return Object.freeze({byteSize:bytes,sha256:digest.digest('hex')});}};
}

// Trusted launcher seam is for real-process native fixtures. Production uses the
// fixed executable factory below; no launcher is accepted by a runtime profile.
export function createRecoveryDatabaseCapture(launch:RecoveryCaptureLauncher){
 return async(input:RecoveryDatabaseCaptureInput,external:AbortSignal)=>{
  let home:string|undefined,path:string|undefined,file:Awaited<ReturnType<typeof open>>|undefined,created=false,complete=false;
  const controller=new AbortController(),signal=AbortSignal.any([external,controller.signal,AbortSignal.timeout(900000)]);const children:ReturnType<typeof tracked>[]=[];let jobs:Promise<unknown>[]=[];
  try{
   signal.throwIfAborted();const target=databaseTarget(input);require(recoveryBackupSnapshotMatches(input.snapshot,target)&&isAbsolute(input.workspace)&&/^age1[a-z0-9]{58}$/.test(input.recipient));
   const workspace=await lstat(input.workspace);require(workspace.isDirectory()&&(process.platform!=='linux'||((workspace.mode&0o077)===0&&workspace.uid===process.getuid!())));
   if(input.environment==='production')require((await lstat(input.rootCertificate!)).isFile());
   home=await mkdtemp(join(input.workspace,'.capture-home-'));const env=childEnvironment(home),toolSignal=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
   const dumpVersion=await version(launch,'pg_dump',env,toolSignal),ageVersion=await version(launch,'age',env,toolSignal);
   require(/^pg_dump \(PostgreSQL\) 17\.11(?:\s|$)/.test(dumpVersion)&&['1.3.2','v1.3.2'].includes(ageVersion));
   require(recoveryBackupSnapshotMatches(input.snapshot,target));
   path=join(input.workspace,'database-'+randomUUID()+'.age');file=await open(path,'wx',0o600);created=true;
   const databaseEnv={...env,PGHOST:target.host,PGPORT:String(target.port),PGDATABASE:target.database,PGUSER:target.user,PGPASSWORD:target.password,PGCONNECT_TIMEOUT:'5',PGAPPNAME:'crest_recovery_dump',PGSSLMODE:target.secure?'verify-full':'disable',...(target.secure?{PGSSLROOTCERT:input.rootCertificate!}:{}),PGOPTIONS:'-c statement_timeout=900000 -c lock_timeout=5000 -c row_security=off'};
   const dump=tracked(launch('pg_dump',['--format=custom','--no-password','--lock-wait-timeout=5s','--snapshot='+input.snapshot.id,'--role='+input.snapshot.databaseRole],databaseEnv),signal);children.push(dump);dump.child.stdin.end();
   const age=tracked(launch('age',['--encrypt','--recipient',input.recipient],env),signal);children.push(age);
   const plain=meter(dumpHeader),cipher=meter(ageHeader),output=file;
   const sink=new Writable({write(chunk:Buffer,_encoding,done){void(async()=>{let offset=0;while(offset<chunk.length){signal.throwIfAborted();const result=await output.write(chunk,offset,chunk.length-offset);require(result.bytesWritten>0);offset+=result.bytesWritten;}})().then(()=>done(),()=>done(new RecoveryDatabaseCaptureError()));}});
   jobs=[pipeline(dump.child.stdout,plain.stream,age.child.stdin,{signal}),pipeline(age.child.stdout,cipher.stream,sink,{signal}),dump.closed,age.closed];for(const job of jobs)void job.catch(()=>controller.abort());await Promise.all(jobs);
   signal.throwIfAborted();require(recoveryBackupSnapshotMatches(input.snapshot,target));const plaintext=plain.finish(),ciphertext=cipher.finish();await output.sync();await output.close();file=undefined;
   if(process.platform==='linux'){const directory=await open(input.workspace,'r');try{await directory.sync();}finally{await directory.close();}}
   const evidence=Object.freeze({profile:'crest.encrypted-database-capture.v1' as const,path,snapshotId:input.snapshot.id,database:input.snapshot.database,databaseRole:input.snapshot.databaseRole,plaintext,ciphertext,tools:Object.freeze({pgDump:dumpVersion,age:ageVersion}),completeBackup:false as const});complete=true;
   return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryDatabaseCaptureError();}});
  }catch{throw new RecoveryDatabaseCaptureError();}
  finally{
   controller.abort();await Promise.allSettled([...jobs,...children.map(child=>child.closed)]);await file?.close().catch(()=>{});if(created&&!complete&&path)await unlink(path).catch(()=>{});
   if(home&&dirname(resolve(home))===resolve(input.workspace)&&basename(home).startsWith('.capture-home-'))await rm(home,{recursive:true,force:true}).catch(()=>{});
  }
 };
}

async function pinnedRecoveryLauncher(tools:Readonly<{pgDump:string;age:string}>):Promise<RecoveryCaptureLauncher>{
 require(process.platform==='linux'&&Object.keys(tools).sort().join(',')==='age,pgDump');
 for(const path of [tools.pgDump,tools.age]){require(isAbsolute(path));const file=await lstat(path);require(file.isFile()&&(file.mode&0o111)!==0&&(file.mode&0o022)===0&&(file.uid===0||file.uid===process.getuid!()));}
 return(command,args,env)=>spawn(command==='pg_dump'?tools.pgDump:tools.age,args,{env:{...env,NODE_ENV:'production'},stdio:['pipe','pipe','pipe'],windowsHide:true});
}
export async function createPinnedRecoveryDatabaseCapture(tools:Readonly<{pgDump:string;age:string}>){
 const capture=createRecoveryDatabaseCapture(await pinnedRecoveryLauncher(tools));
 return(input:Omit<RecoveryDatabaseCaptureInput,'environment'>,signal:AbortSignal)=>capture({...input,environment:'production'},signal);
}

async function sealPrivateBytes(launch:RecoveryCaptureLauncher,input:Readonly<{workspace:string;recipient:string}>,plainInput:Uint8Array,signal:AbortSignal){
 let file:Awaited<ReturnType<typeof open>>|undefined,path:string|undefined,home:string|undefined,created=false,complete=false,plain:Buffer|undefined;
 let encryptor:ReturnType<typeof tracked>|undefined;let jobs:Promise<unknown>[]=[];
 const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(60000)]);
 try{
  active.throwIfAborted();require(isAbsolute(input.workspace)&&/^age1[a-z0-9]{58}$/.test(input.recipient)&&plainInput instanceof Uint8Array&&plainInput.byteLength<=26214400);const workspace=await lstat(input.workspace);require(workspace.isDirectory()&&(process.platform!=='linux'||((workspace.mode&0o077)===0&&workspace.uid===process.getuid!())));plain=Buffer.from(plainInput);
  const plaintext=Object.freeze({byteSize:plain.length,sha256:createHash('sha256').update(plain).digest('hex')});
  home=await mkdtemp(join(input.workspace,'.capture-home-'));const environment=childEnvironment(home);require(['1.3.2','v1.3.2'].includes(await version(launch,'age',environment,AbortSignal.any([active,AbortSignal.timeout(10000)]))));path=join(input.workspace,'artifact-'+randomUUID()+'.age');file=await open(path,'wx',0o600);created=true;
  encryptor=tracked(launch('age',['--encrypt','--recipient',input.recipient],environment),active);
  const cipher=meter(ageHeader),output=file;
  const sink=new Writable({write(chunk:Buffer,_encoding,done){void(async()=>{let offset=0;while(offset<chunk.length){active.throwIfAborted();const result=await output.write(chunk,offset,chunk.length-offset);require(result.bytesWritten>0);offset+=result.bytesWritten;}})().then(()=>done(),()=>done(new RecoveryDatabaseCaptureError()));}});
  jobs=[pipeline(Readable.from([plain]),encryptor.child.stdin,{signal:active}),pipeline(encryptor.child.stdout,cipher.stream,sink,{signal:active}),encryptor.closed];for(const job of jobs)void job.catch(()=>controller.abort());await Promise.all(jobs);
  active.throwIfAborted();const ciphertext=cipher.finish();require(ciphertext.byteSize<=plain.length+65536);await output.sync();await output.close();file=undefined;
  if(process.platform==='linux'){const directory=await open(input.workspace,'r');try{await directory.sync();}finally{await directory.close();}}
  complete=true;return Object.freeze({path,plaintext,ciphertext});
 }catch{throw new RecoveryDatabaseCaptureError();}
 finally{
  controller.abort();await Promise.allSettled([...jobs,...(encryptor?[encryptor.closed]:[])]);plain?.fill(0);await file?.close().catch(()=>{});if(created&&!complete&&path)await unlink(path).catch(()=>{});
  if(home&&dirname(resolve(home))===resolve(input.workspace)&&basename(home).startsWith('.capture-home-'))await rm(home,{recursive:true,force:true}).catch(()=>{});
 }
}
export function createRecoveryFileEncryption(launch:RecoveryCaptureLauncher){return async(input:Readonly<{workspace:string;recipient:string;bytes:Uint8Array}>,signal:AbortSignal)=>{const evidence=await sealPrivateBytes(launch,input,input.bytes,signal);return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryDatabaseCaptureError();}});};}
export async function createPinnedRecoveryFileEncryption(tools:Readonly<{pgDump:string;age:string}>){return createRecoveryFileEncryption(await pinnedRecoveryLauncher(tools));}
export function createRecoveryReleaseFileEncryption(launch:RecoveryCaptureLauncher){
 return async(input:Readonly<{workspace:string;recipient:string;path:string;expected:Readonly<{byteSize:number;sha256:string}>;range?:Readonly<{offset:number;byteSize:number;sha256:string}>}>,external:AbortSignal)=>{
  let source:Awaited<ReturnType<typeof openRecoveryReleaseFile>>|undefined,file:Awaited<ReturnType<typeof open>>|undefined,home:string|undefined,path:string|undefined,created=false,complete=false,encryptor:ReturnType<typeof tracked>|undefined;let jobs:Promise<unknown>[]=[];
  const controller=new AbortController(),signal=AbortSignal.any([external,controller.signal,AbortSignal.timeout(900000)]);
  try{
   signal.throwIfAborted();require(isAbsolute(input.workspace)&&/^age1[a-z0-9]{58}$/.test(input.recipient)&&Number.isSafeInteger(input.expected.byteSize)&&input.expected.byteSize>0&&input.expected.byteSize<=recoveryReleaseFileLimit&&/^[a-f0-9]{64}$/.test(input.expected.sha256));const workspace=await lstat(input.workspace);require(workspace.isDirectory()&&(process.platform!=='linux'||((workspace.mode&0o077)===0&&workspace.uid===process.getuid!())));
   const range=input.range??{offset:0,...input.expected};require(Number.isSafeInteger(range.offset)&&range.offset>=0&&Number.isSafeInteger(range.byteSize)&&range.byteSize>0&&range.byteSize<=recoveryReleasePartLimit&&range.offset+range.byteSize<=input.expected.byteSize&&/^[a-f0-9]{64}$/.test(range.sha256));source=await openRecoveryReleaseFile(input.path);require(source.byteSize===input.expected.byteSize);home=await mkdtemp(join(input.workspace,'.capture-home-'));const environment=childEnvironment(home);require(['1.3.2','v1.3.2'].includes(await version(launch,'age',environment,AbortSignal.any([signal,AbortSignal.timeout(10000)]))));
   path=join(input.workspace,'release-'+randomUUID()+'.age');file=await open(path,'wx',0o600);created=true;encryptor=tracked(launch('age',['--encrypt','--recipient',input.recipient],environment),signal);
   const plain=meter(Buffer.alloc(0)),cipher=meter(ageHeader),output=file,sink=new Writable({write(chunk:Buffer,_encoding,done){void(async()=>{let offset=0;while(offset<chunk.length){signal.throwIfAborted();const result=await output.write(chunk,offset,chunk.length-offset);require(result.bytesWritten>0);offset+=result.bytesWritten;}})().then(()=>done(),()=>done(new RecoveryDatabaseCaptureError()));}});
   jobs=[pipeline(source.stream(signal,range),plain.stream,encryptor.child.stdin,{signal}),pipeline(encryptor.child.stdout,cipher.stream,sink,{signal}),encryptor.closed];for(const job of jobs)void job.catch(()=>controller.abort());await Promise.all(jobs);signal.throwIfAborted();const plaintext=plain.finish(),ciphertext=cipher.finish();require(plaintext.byteSize===range.byteSize&&plaintext.sha256===range.sha256&&ciphertext.byteSize<=plaintext.byteSize+65536);await source.verifyUnchanged();await output.sync();await output.close();file=undefined;
   if(process.platform==='linux'){const directory=await open(input.workspace,'r');try{await directory.sync();}finally{await directory.close();}}
   const evidence=Object.freeze({profile:'crest.encrypted-release-file.v1' as const,path,plaintext,ciphertext,source:Object.freeze({...input.expected}),offset:range.offset,completeBackup:false as const});complete=true;return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryDatabaseCaptureError();}});
  }catch{throw new RecoveryDatabaseCaptureError();}finally{
   controller.abort();await Promise.allSettled([...jobs,...(encryptor?[encryptor.closed]:[])]);await source?.close().catch(()=>{});await file?.close().catch(()=>{});if(created&&!complete&&path)await unlink(path).catch(()=>{});if(home&&dirname(resolve(home))===resolve(input.workspace)&&basename(home).startsWith('.capture-home-'))await rm(home,{recursive:true,force:true}).catch(()=>{});
  }
 };
}
export async function createPinnedRecoveryReleaseFileEncryption(tools:Readonly<{pgDump:string;age:string}>){return createRecoveryReleaseFileEncryption(await pinnedRecoveryLauncher(tools));}
async function captureBundle(launch:RecoveryCaptureLauncher,capture:ReturnType<typeof createRecoveryDatabaseCapture>,input:RecoveryDatabaseCaptureInput,signal:AbortSignal){
 // The inventory and encrypted dump must both finish before the lease releases
 // the exported snapshot. No later connection may fill in missing metadata.
 const inventory=await captureRecoveryDatabaseInventory(input.snapshot,signal);
 const originalInventory=await captureRecoveryOriginalInventory(input.snapshot,signal);
 const database=await capture(input,signal),evidence=database.forRecoveryTools();let complete=false;
 try{
  require(inventory.forRecoveryTools().snapshotId===evidence.snapshotId);
  const metadata=Object.freeze({profile:'crest.private-database-recovery-metadata.v1' as const,databaseInventory:inventory.forRecoveryTools(),originalInventory:originalInventory.forRecoveryTools()});
  const metadataBytes=Buffer.from(JSON.stringify(metadata)+'\n');require(metadataBytes.length<=8388608);let encryptedInventory;try{encryptedInventory=await sealPrivateBytes(launch,input,metadataBytes,signal);}finally{metadataBytes.fill(0);}
  complete=true;return Object.freeze({forRecoveryTools:()=>Object.freeze({profile:'crest.private-database-bundle.v1' as const,database:evidence,inventory:inventory.forRecoveryTools(),originalInventory:originalInventory.forRecoveryTools(),encryptedInventory,completeBackup:false as const}),toJSON():never{throw new RecoveryDatabaseCaptureError();}});
 }finally{if(!complete)await unlink(evidence.path).catch(()=>{});}
}
export function createRecoveryDatabaseBundle(launch:RecoveryCaptureLauncher){const capture=createRecoveryDatabaseCapture(launch);return(input:RecoveryDatabaseCaptureInput,signal:AbortSignal)=>captureBundle(launch,capture,input,signal);}
export async function createPinnedRecoveryDatabaseBundle(tools:Readonly<{pgDump:string;age:string}>){
 const bundle=createRecoveryDatabaseBundle(await pinnedRecoveryLauncher(tools));
 return(input:Omit<RecoveryDatabaseCaptureInput,'environment'>,signal:AbortSignal)=>bundle({...input,environment:'production'},signal);
}
