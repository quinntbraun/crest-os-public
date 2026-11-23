// Explicit private operator command. Only a request-file path appears in argv.
import {constants} from 'node:fs';
import {lstat,open,readFile,mkdtemp,rm} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {parseRecoveryJson} from './recovery-json.ts';
import {migrationTestTarget} from './migration-coordinator.ts';
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import {captureOperatorSources138,formatOperatorSourceExport,OperatorSourceExportError} from './operator-source-export.ts';
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
async function privateText(path:unknown,maximum:number,signal:AbortSignal){
 require(typeof path==='string'&&isAbsolute(path)&&!path.includes('\0'));signal.throwIfAborted();const before=await lstat(path);require(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maximum&&(process.platform!=='linux'||((before.mode&0o077)===0&&before.uid===process.getuid!())));
 const file=await open(path,constants.O_RDONLY|(process.platform==='linux'?constants.O_NOFOLLOW:0));let bytes:Buffer|undefined;
 try{const info=await file.stat();require(info.isFile()&&info.dev===before.dev&&info.ino===before.ino&&info.size===before.size&&(process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!())));bytes=Buffer.alloc(info.size);let at=0;while(at<bytes.length){signal.throwIfAborted();const next=await file.read(bytes,at,bytes.length-at,at);require(next.bytesRead>0);at+=next.bytesRead;}require((await file.read(Buffer.alloc(1),0,1,at)).bytesRead===0);const after=await file.stat();require(after.size===info.size&&after.mtimeMs===info.mtimeMs&&after.ctimeMs===info.ctimeMs);const text=bytes.toString('utf8');require(Buffer.from(text).equals(bytes));signal.throwIfAborted();return text;}finally{bytes?.fill(0);await file.close();}
}
async function syncDirectory(path:string){if(process.platform==='linux'){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}}
export async function runOperatorSourceCommand(args:readonly string[],external:AbortSignal){
 const signal=AbortSignal.any([external,AbortSignal.timeout(180000)]),test=process.env.CREST_ENV==='test';let client:pg.Client|undefined,directory:string|undefined,parent:string|undefined;
 try{
  require(args.length===1&&(process.platform==='linux'||test));const request=parseRecoveryJson(await privateText(args[0],16384,signal),16384);exact(request,['schemaVersion','leaseBusinessId','databaseUrl','rootCertificateFile','outputParent']);require(request.schemaVersion===1&&typeof request.leaseBusinessId==='string'&&typeof request.databaseUrl==='string');
  const url=new URL(request.databaseUrl);require(['postgres:','postgresql:'].includes(url.protocol)&&url.username&&url.password&&!url.search&&!url.hash);
  if(test)migrationTestTarget('test',request.databaseUrl);else require(typeof request.rootCertificateFile==='string');
  const ca=request.rootCertificateFile===null?null:await privateText(request.rootCertificateFile,1048576,signal);require(test||ca?.includes('-----BEGIN CERTIFICATE-----'));
  require(typeof request.outputParent==='string'&&isAbsolute(request.outputParent));parent=resolve(request.outputParent);const root=await lstat(parent);require(root.isDirectory()&&!root.isSymbolicLink()&&(process.platform!=='linux'||((root.mode&0o077)===0&&root.uid===process.getuid!())));
  const registry=await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url));require(createHash('sha256').update(registry).digest('hex')===recoveryRoutineBaseline138.migrationRegistrySha256);const parsed=parseRecoveryJson(registry.toString('utf8'),262144) as {migrations:{version:string;file:string}[]};require(Array.isArray(parsed.migrations)&&parsed.migrations.length===138);const migrations=parsed.migrations.map(row=>({version:row.version,name:row.file.slice(15,-4)}));
  signal.throwIfAborted();client=new pg.Client({connectionString:request.databaseUrl,options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:5000,ssl:ca?{ca,rejectUnauthorized:true}:false});client.on('error',()=>{});await client.connect();
  const capture=await captureOperatorSources138({client,leaseBusinessId:request.leaseBusinessId,migrations},signal),data=capture.forRecoveryTools(),files=formatOperatorSourceExport(capture);client=undefined;signal.throwIfAborted();
  directory=await mkdtemp(join(parent,'crest-operator-export-'));await syncDirectory(parent);
  for(const[name,bytes]of Object.entries(files)){
   require(/^(?:crest_private_[a-z_]+\.csv|operator_(?:dictionary|escape_map|manifest)\.json)$/.test(name));signal.throwIfAborted();const file=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(process.platform==='linux'?constants.O_NOFOLLOW:0),0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}require((await readFile(join(directory,name))).equals(Buffer.from(bytes)));
  }
  await syncDirectory(directory);signal.throwIfAborted();return Object.freeze({profile:'crest.private-operator-export-delivery.v1',directory,fileCount:Object.keys(files).length,recordCount:data.recordCount,manifestSha256:createHash('sha256').update(files['operator_manifest.json']!).digest('hex'),scope:'instance_operator',referenceClosureVerified:false,completePortableExport:false,completeBackup:false});
 }catch{
  if(directory&&parent&&dirname(resolve(directory))===parent&&basename(directory).startsWith('crest-operator-export-'))try{await rm(directory,{recursive:true,force:true});await syncDirectory(parent);}catch{throw new OperatorSourceExportError();}
  throw new OperatorSourceExportError();
 }finally{await client?.end().catch(()=>{});}
}
