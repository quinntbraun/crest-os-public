// Isolated Linux command, one explicit run ID. This stages a candidate only;
// there is no success marker, completed-run record or healthy heartbeat here.
import {constants} from 'node:fs';
import {open,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {S3Client} from '@aws-sdk/client-s3';
import {parseRecoveryJson} from './recovery-json.ts';
import {readPrivateToolText} from './private-tool-files.ts';
import {readRecoveryCaptureProfile} from './recovery-capture-profile.ts';
import {readRecoveryReleaseManifest} from './recovery-release-distribution.ts';
import {readRecoveryConfiguration} from './recovery-configuration.ts';
import {createPinnedRecoveryRun} from './recovery-run.ts';
import {createRecoveryAttempt} from './recovery-attempt.ts';
import {createR2RecoveryPrimaryStore} from './recovery-primary-store.ts';
import {createRecoveryVault} from './recovery-vault.ts';
import {createRecoveryMonitorAttempt} from './recovery-monitor.ts';
import {createRecoveryCaptureController} from './recovery-capture-controller.ts';
import {readRecoveryCaptureRegistry} from './recovery-capture-registry.ts';

type Profile=ReturnType<ReturnType<typeof readRecoveryCaptureProfile>['forRecoveryTools']>;
type Stage='input'|'profile'|'journal'|'files'|'tools'|'attempt'|'connections'|'capture'|'cleanup';
export class RecoveryCaptureCommandError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED');this.name='RecoveryCaptureCommandError';this.stage=stage;}}
type Dependencies=Readonly<{makeRun:typeof createPinnedRecoveryRun;makeClient:(configuration:pg.ClientConfig)=>pg.Client;makeAttempt:typeof createRecoveryAttempt;makePrimary:typeof createR2RecoveryPrimaryStore;makeMonitor:typeof createRecoveryMonitorAttempt;makeVault:(configuration:Profile['vault'])=>Readonly<{vault:ReturnType<typeof createRecoveryVault>;close:()=>void}>}>;
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
async function directorySync(path:string){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function privateDirectory(path:string){const info=await lstat(path);require(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&info.uid===process.getuid!());}
async function json(directory:string,name:string,value:unknown,created?:()=>void){
 const file=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created?.();
 try{const bytes=Buffer.from(JSON.stringify(value)+'\n');require(bytes.length<=16384);await file.writeFile(bytes);await file.sync();}finally{await file.close();}await directorySync(directory);
}
export function createRecoveryCaptureCommand(dependencies:Dependencies){
 return async(args:readonly string[],external:AbortSignal)=>{
  const signal=AbortSignal.any([external,AbortSignal.timeout(70*60000)]);let stage:Stage='input',failure:Stage|undefined,profile:Profile|undefined,reserved=false,attempt:Awaited<ReturnType<typeof createRecoveryAttempt>>|undefined,monitor:ReturnType<typeof createRecoveryMonitorAttempt>|undefined,client:pg.Client|undefined,controllerOwnsClient=false;
  const closers:(()=>void)[]=[],startedAt=new Date().toISOString();let pointId:string|undefined,result:Readonly<{profile:'crest.recovery-capture-command.v1';pointId:string;state:'candidate_review_required';completeBackup:false}>|undefined;
  try{
   require(process.platform==='linux'&&process.versions.node==='24.22.0'&&args.length===2&&typeof args[1]==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args[1]));pointId=args[1];signal.throwIfAborted();
   stage='profile';profile=readRecoveryCaptureProfile(parseRecoveryJson(await readPrivateToolText(args[0],65536,signal),65536)).forRecoveryTools();await privateDirectory(profile.stateDirectory);await privateDirectory(profile.workspaceDirectory);
   // Reserve before any provider/client/tool dispatch. Even a failed preflight
   // cannot be silently restarted as a new run or overwrite an earlier result.
   stage='journal';await json(profile.stateDirectory,'command-'+pointId+'.started.json',{profile:'crest.recovery-capture-command-start.v1',pointId,startedAt,completeBackup:false},()=>{reserved=true;});
   monitor=dependencies.makeMonitor(profile.monitorPingUrl,{runId:pointId,startedAt});
   stage='files';const rootCertificate=await readPrivateToolText(profile.rootCertificateFile,1048576,signal);require(rootCertificate.includes('-----BEGIN CERTIFICATE-----'));
   const distribution=readRecoveryReleaseManifest(parseRecoveryJson(await readPrivateToolText(profile.distribution.manifestFile,1048576,signal,false),1048576)),{release,...manifest}=distribution;
   const {sourceSchemaVersion,registrySha256,migrations}=readRecoveryCaptureRegistry(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url)));require(release.migrationRegistrySha256===registrySha256&&release.sourceSchemaVersion===sourceSchemaVersion);
   const expected={businessId:profile.businessId,appReleaseId:release.appReleaseId,migrationRegistrySha256:release.migrationRegistrySha256,sourceSchemaVersion,referenceDirectoryId:profile.referenceDirectoryId},recipeSource=await readPrivateToolText(profile.recipeFile,262144,signal);readRecoveryConfiguration(recipeSource,expected);
   stage='tools';const run=await dependencies.makeRun(profile.tools);signal.throwIfAborted();
   stage='attempt';attempt=await dependencies.makeAttempt(profile.stateDirectory,{formatVersion:1,pointId,businessId:profile.businessId,startedAt,appReleaseId:release.appReleaseId,migrationRegistrySha256:release.migrationRegistrySha256,sourceSchemaVersion});
   stage='connections';client=dependencies.makeClient({connectionString:profile.databaseUrl,options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:5000,ssl:{ca:rootCertificate,rejectUnauthorized:true}});require(client instanceof pg.Client);client.on('error',()=>{});
   const domains=['expense_receipt','supplier_document','condition_photo'] as const,sources={} as Record<typeof domains[number],ReturnType<typeof createR2RecoveryPrimaryStore>['store']>;
   for(const domain of domains){const handle=dependencies.makePrimary(profile.sources[domain],domain);closers.push(handle.close);sources[domain]=handle.store;}
   const vault=dependencies.makeVault(profile.vault);closers.push(vault.close);
   // Connection failures occur inside the durable controller's capture phase,
   // so they receive its terminal record and independent bounded failure signal.
   const ownedClient=client,connected:Parameters<typeof createRecoveryCaptureController>[0]=async(input,ports,active)=>{active.throwIfAborted();await ownedClient.connect();active.throwIfAborted();return run(input,ports,active);};
   stage='capture';controllerOwnsClient=true;const controlled=(await createRecoveryCaptureController(connected)({request:{client,businessId:profile.businessId,expectedAppReleaseId:release.appReleaseId,migrationRegistrySha256:release.migrationRegistrySha256,migrations,database:{environment:'production',connectionString:profile.databaseUrl,rootCertificate:profile.rootCertificateFile,workspace:profile.workspaceDirectory,recipient:profile.recipient},retainUntil:new Date(Date.parse(startedAt)+profile.retentionDays*86400000).toISOString(),distribution:{manifest,sourcePath:profile.distribution.sourceFile,imagePath:profile.distribution.imageFile,partByteSize:profile.distribution.partByteSize},configuration:{source:recipeSource,expected}},ports:{sources,attempt,vault:vault.vault},recordDirectory:profile.stateDirectory,monitor},signal)).forRecoveryTools();
   require(controlled.pointId===pointId&&controlled.state==='candidate_review_required'&&controlled.completeBackup===false);result=Object.freeze({profile:'crest.recovery-capture-command.v1',pointId,state:'candidate_review_required',completeBackup:false});
  }catch{failure=stage;}
  finally{
   if(client&&!controllerOwnsClient)try{await client.end();}catch{failure??='cleanup';}
   if(attempt)try{await attempt.close();}catch{failure??='cleanup';}
   for(const close of closers.reverse())try{close();}catch{failure??='cleanup';}
  }
  if(reserved&&profile&&pointId){
   if(failure&&monitor&&!monitor.view().failureAttempted)try{await monitor.fail({failedAt:new Date().toISOString(),category:external.aborted?'cancelled':'capture'},AbortSignal.timeout(10000));}catch{/* no automatic repeat after an unknown signal */}
   try{await json(profile.stateDirectory,'command-'+pointId+'.finished.json',{profile:'crest.recovery-capture-command-finish.v1',pointId,startedAt,finishedAt:new Date().toISOString(),state:failure?'failed':'candidate_review_required',stage:failure??null,monitorPhase:monitor?.view().phase??null,completeBackup:false});}catch{failure='journal';}
  }
  if(failure||!result)throw new RecoveryCaptureCommandError(failure??'capture');return result;
 };
}
export const runRecoveryCaptureCommand=createRecoveryCaptureCommand({
 makeRun:createPinnedRecoveryRun,makeClient:configuration=>new pg.Client(configuration),makeAttempt:createRecoveryAttempt,makePrimary:createR2RecoveryPrimaryStore,makeMonitor:createRecoveryMonitorAttempt,
 makeVault(configuration){
  const client=new S3Client({region:configuration.region,endpoint:configuration.endpoint,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:configuration.accessKeyId,secretAccessKey:configuration.secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:{connectionTimeout:5000,requestTimeout:60000,throwOnRequestTimeout:true},logger:{debug(){},info(){},warn(){},error(){}}});
  try{return Object.freeze({vault:createRecoveryVault(client,configuration.bucket),close:()=>client.destroy()});}catch(error){client.destroy();throw error;}
 }
});
