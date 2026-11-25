// Explicit private operator command. Only a request-file path appears in argv.
import {constants} from 'node:fs';
import {lstat,open,readFile,mkdtemp,rm} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {parseRecoveryJson} from './recovery-json.ts';
import {migrationTestTarget} from './migration-coordinator.ts';
import {readRecoveryCaptureRegistry} from './recovery-capture-registry.ts';
import {captureOperatorSources138,captureInstanceSources138,captureInstanceSources139,formatOperatorSourceExport,formatInstanceSourceExport,formatInstanceSourceExport139,OperatorSourceExportError} from './operator-source-export.ts';
import {readPrivateToolText as privateText} from './private-tool-files.ts';
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
async function syncDirectory(path:string){if(process.platform==='linux'){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}}
export async function runOperatorSourceCommand(args:readonly string[],external:AbortSignal){
 const signal=AbortSignal.any([external,AbortSignal.timeout(180000)]),test=process.env.CREST_ENV==='test';let client:pg.Client|undefined,directory:string|undefined,parent:string|undefined;
 try{
  require(args.length===1&&(process.platform==='linux'||test));const request=parseRecoveryJson(await privateText(args[0],16384,signal),16384),instance=!!request&&typeof request==='object'&&'schemaVersion' in request&&request.schemaVersion===2;exact(request,instance?['schemaVersion','sourceSet','leaseBusinessId','databaseUrl','rootCertificateFile','outputParent']:['schemaVersion','leaseBusinessId','databaseUrl','rootCertificateFile','outputParent']);require((instance?request.sourceSet==='instance_sources':request.schemaVersion===1)&&typeof request.leaseBusinessId==='string'&&typeof request.databaseUrl==='string');
  const url=new URL(request.databaseUrl);require(['postgres:','postgresql:'].includes(url.protocol)&&url.username&&url.password&&!url.search&&!url.hash);
  if(test)migrationTestTarget('test',request.databaseUrl);else require(typeof request.rootCertificateFile==='string');
  const ca=request.rootCertificateFile===null?null:await privateText(request.rootCertificateFile,1048576,signal);require(test||ca?.includes('-----BEGIN CERTIFICATE-----'));
  require(typeof request.outputParent==='string'&&isAbsolute(request.outputParent));parent=resolve(request.outputParent);const root=await lstat(parent);require(root.isDirectory()&&!root.isSymbolicLink()&&(process.platform!=='linux'||((root.mode&0o077)===0&&root.uid===process.getuid!())));
  const {sourceSchemaVersion,migrations}=readRecoveryCaptureRegistry(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url)));const registered139=sourceSchemaVersion===139;require(!registered139||instance);
  signal.throwIfAborted();client=new pg.Client({connectionString:request.databaseUrl,options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:5000,ssl:ca?{ca,rejectUnauthorized:true}:false});client.on('error',()=>{});await client.connect();
  const capture=await(registered139?captureInstanceSources139:instance?captureInstanceSources138:captureOperatorSources138)({client,leaseBusinessId:request.leaseBusinessId,migrations},signal),data=capture.forRecoveryTools(),files=(registered139?formatInstanceSourceExport139:instance?formatInstanceSourceExport:formatOperatorSourceExport)(capture),prefix=instance?'instance':'operator';client=undefined;signal.throwIfAborted();
  directory=await mkdtemp(join(parent,'crest-'+prefix+'-export-'));await syncDirectory(parent);
  for(const[name,bytes]of Object.entries(files)){
   require(/^(?:crest_[a-z_]+\.csv|(?:operator|instance)_(?:dictionary|escape_map|manifest)\.json|(?:operator|instance)_reimport\.sql)$/.test(name));signal.throwIfAborted();const file=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(process.platform==='linux'?constants.O_NOFOLLOW:0),0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}require((await readFile(join(directory,name))).equals(Buffer.from(bytes)));
  }
  await syncDirectory(directory);signal.throwIfAborted();return Object.freeze({profile:registered139?'crest.private-instance139-export-delivery.v1':instance?'crest.private-instance-export-delivery.v1':'crest.private-operator-export-delivery.v1',directory,fileCount:Object.keys(files).length,recordCount:data.recordCount,manifestSha256:createHash('sha256').update(files[prefix+'_manifest.json']!).digest('hex'),scope:'instance_operator',...(instance?{sourceCount:data.sources.length}:{}),...(registered139?{sourceSchemaVersion:139,catalogRegistered:true}:{}),referenceClosureVerified:false,completePortableExport:false,completeBackup:false});
 }catch{
  if(directory&&parent&&dirname(resolve(directory))===parent&&/^crest-(?:operator|instance)-export-/.test(basename(directory)))try{await rm(directory,{recursive:true,force:true});await syncDirectory(parent);}catch{throw new OperatorSourceExportError();}
  throw new OperatorSourceExportError();
 }finally{await client?.end().catch(()=>{});}
}
