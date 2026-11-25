// Inspect an already imported authenticated application image on the separately
// configured recovery daemon. No service/profile, migration or worker starts.
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {verifiedRecoveryReleaseFile} from './recovery-database-capture.ts';
import {readRecoveryReleaseManifest} from './recovery-release-distribution.ts';
import {hashRecoveryReleaseFile} from './recovery-release-files.ts';
import {parseRecoveryJson} from './recovery-json.ts';
type Stage='archive'|'binding'|'probe'|'identity'|'recheck'|'cleanup';
export class RecoveryImageIdentityError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_IMAGE_IDENTITY_REVIEW_REQUIRED');this.name='RecoveryImageIdentityError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
export type RecoveryImageIdentityLauncher=(args:string[])=>ChildProcessWithoutNullStreams;
const probe="import {readFileSync} from 'node:fs';import {isDeepStrictEqual} from 'node:util';const app=await import('/app/server/application.mjs');const file=JSON.parse(readFileSync('/app/server/build-identity.json','utf8'));const compiled=app.getServerBuildIdentity();if(!isDeepStrictEqual(compiled,file))throw Error('IDENTITY_MISMATCH');console.log(JSON.stringify({identity:compiled}));";
export function createRecoveryImageIdentityVerifier(launch:RecoveryImageIdentityLauncher){
 async function command(args:string[],signal:AbortSignal,allowNonzero=false){
  signal.throwIfAborted();const child=launch(args);let stdout='',bytes=0,oversized=false,timer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),5000);timer.unref();};
  signal.addEventListener('abort',stop,{once:true});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){oversized=true;stop();}else stdout+=chunk.toString('utf8');});
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){oversized=true;stop();}});child.stdin.on('error',()=>{});child.stdin.end();
  try{const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});signal.throwIfAborted();require(!oversized&&(allowNonzero||code===0));return{code,stdout};}
  finally{signal.removeEventListener('abort',stop);if(timer)clearTimeout(timer);}
 }
 return async(input:Readonly<{archive:unknown;buildManifest:unknown}>,external:AbortSignal)=>{
  let stage:Stage='archive',launched=false,failed=false,evidence:Readonly<Record<string,unknown>>|undefined;
  const signal=AbortSignal.any([external,AbortSignal.timeout(30000)]),name='crest-recovery-image-probe-'+randomUUID();
  try{
   signal.throwIfAborted();const archive=verifiedRecoveryReleaseFile(input.archive);require(archive.kind==='image');
   stage='binding';const build=readRecoveryReleaseManifest(input.buildManifest),imageId=archive.release.containerImageId;
   require(typeof imageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(imageId)&&isDeepStrictEqual(archive.release,build.release)&&archive.byteSize===build.imageArchive.byteSize&&archive.sha256===build.imageArchive.sha256);
   async function file(){const info=await lstat(archive.path);require(info.isFile()&&!info.isSymbolicLink()&&(process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!())));require(isDeepStrictEqual(await hashRecoveryReleaseFile(archive.path,signal),{byteSize:archive.byteSize,sha256:archive.sha256}));}await file();
   stage='probe';launched=true;
   const observed=await command(['run','--name',name,'--rm','--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','--memory','256m','--pids-limit','64','--no-healthcheck','--entrypoint','node',imageId,'--conditions=react-server','--input-type=module','-e',probe],signal);
   stage='identity';const parsed=parseRecoveryJson(observed.stdout,65536);require(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.keys(parsed).join(',')==='identity'&&isDeepStrictEqual((parsed as Record<string,unknown>).identity,build.buildIdentity));
   stage='recheck';await file();evidence=Object.freeze({profile:'crest.recovered-image-identity.v1',sourceCommit:archive.release.sourceCommit,appReleaseId:archive.release.appReleaseId,sourceSchemaVersion:archive.release.sourceSchemaVersion,imageId,archiveSha256:archive.sha256,archiveAuthenticated:true,compiledAndFileIdentityVerified:true,imageImportedByThisVerifier:false,independentHostVerified:false,runtimeActivated:false,completeBackup:false});
  }catch{failed=true;}
  finally{
   if(launched){try{const cleanup=AbortSignal.timeout(10000);await command(['container','rm','--force',name],cleanup,true);const remaining=await command(['container','ls','--all','--quiet','--filter','name='+name],cleanup);require(remaining.stdout.trim()==='');}catch{stage='cleanup';failed=true;}}
  }
  if(failed||!evidence)throw new RecoveryImageIdentityError(stage);const result=evidence;
  return Object.freeze({forRecoveryTools:()=>result,toJSON():never{throw new RecoveryImageIdentityError('identity');}});
 };
}
