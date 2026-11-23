// Isolated capture composition. A staged run is never a completed backup, never
// enters the complete-point catalog and never sends a success heartbeat.
import {constants} from 'node:fs';
import {open,lstat,mkdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {createRecoveryRun} from './recovery-run.ts';
import type {createRecoveryMonitorAttempt} from './recovery-monitor.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';

type Capture=ReturnType<typeof createRecoveryRun>;
type Input=Readonly<{request:Parameters<Capture>[0];ports:Parameters<Capture>[1];recordDirectory:string;monitor:ReturnType<typeof createRecoveryMonitorAttempt>}>;
type Stage='binding'|'journal'|'capture'|'candidate_record'|'failure_record'|'cleanup';
export class RecoveryCaptureControllerError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED');this.name='RecoveryCaptureControllerError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
async function syncDirectory(path:string){const directory=await open(path,'r');try{await directory.sync();}finally{await directory.close();}}
async function record(directory:string,name:string,value:unknown){
 const file=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{const bytes=Buffer.from(JSON.stringify(value)+'\n');require(bytes.length<=16384);await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await syncDirectory(directory);
}
function instant(value:string){const parsed=Date.parse(value);require(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value);return parsed;}

export function createRecoveryCaptureController(capture:Capture){
 return async(input:Input,external:AbortSignal)=>{
  let stage:Stage='binding',directory:string|undefined,started=false,terminalAttempted=false,failure:Stage|undefined,candidate:Awaited<ReturnType<Capture>>|undefined;
  let startAcknowledged=false,failureAcknowledged=false;
  let identity:Readonly<{pointId:string;startedAt:string}>|undefined;
  try{
   const header=Object.freeze({...input.ports.attempt.view().header});identity=Object.freeze({pointId:header.pointId,startedAt:header.startedAt});
   require(process.platform==='linux'&&typeof capture==='function'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(header.pointId));
   require(header.businessId===input.request.businessId&&header.appReleaseId===input.request.expectedAppReleaseId&&header.migrationRegistrySha256===input.request.migrationRegistrySha256&&header.sourceSchemaVersion===138&&!input.ports.attempt.view().reviewRequired&&input.ports.attempt.view().artifacts.length===0);
   require(instant(header.startedAt)<=Date.now()&&input.monitor.view().runId===header.pointId&&input.monitor.view().phase==='fresh');
   require(typeof input.recordDirectory==='string'&&isAbsolute(input.recordDirectory));const parent=await lstat(input.recordDirectory);require(parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o077)===0&&parent.uid===process.getuid!());
   external.throwIfAborted();stage='journal';directory=join(input.recordDirectory,'run-'+header.pointId);await mkdir(directory,{mode:0o700});await syncDirectory(input.recordDirectory);
   await record(directory,'started.json',{profile:'crest.recovery-capture-start.v1',...identity,completeBackup:false});started=true;
   // Monitoring failure must not prevent a backup attempt. Its unknown outcome
   // is retained in the terminal record; the external deadline check still runs.
   try{await input.monitor.start(external);startAcknowledged=true;}catch{/* keep capture independent of monitor availability */}
   stage='capture';external.throwIfAborted();candidate=await capture(input.request,input.ports,external);const evidence=candidate.forRecoveryTools();
   require(evidence.profile==='crest.verified-recovery-run-candidate.v1'&&evidence.pointId===header.pointId&&evidence.completeBackup===false&&typeof evidence.snapshotId==='string'&&evidence.snapshotId.length>0);
   const after=input.ports.attempt.view();require(isDeepStrictEqual(after.header,header)&&!after.reviewRequired);
   const manifest=after.artifacts.find(item=>item.state==='verified'&&item.artifact?.key===evidence.manifest.key);
   require(manifest?.reservation.purpose==='manifest'&&isDeepStrictEqual(manifest.artifact,evidence.manifest)&&evidence.manifest.key===recoveryVaultArtifactKey(header.pointId,manifest.reservation.artifactId));
   external.throwIfAborted();stage='candidate_record';terminalAttempted=true;
   await record(directory,'finished.json',{profile:'crest.recovery-capture-finish.v1',...identity,finishedAt:new Date().toISOString(),state:'candidate_review_required',snapshotId:evidence.snapshotId,manifest:evidence.manifest,manifestPlaintext:evidence.manifestPlaintext,startAcknowledged,completeBackup:false});
  }catch{failure=stage;}
  finally{
   // This controller owns this dedicated capture connection, not the artifact
   // attempt journal or SDK clients supplied by the isolated composition.
   try{await input.request.client.end();}catch{failure??='cleanup';}
  }
  const failedAt=new Date().toISOString();
  if(failure&&started&&!terminalAttempted&&directory){
   try{terminalAttempted=true;await record(directory,'finished.json',{profile:'crest.recovery-capture-finish.v1',...identity,finishedAt:failedAt,state:'failed',stage:failure,startAcknowledged,completeBackup:false});}
   catch{failure='failure_record';}
  }
  // Use a separate bounded shutdown signal even when capture was cancelled.
  // A staged candidate is itself review-required, never a successful backup.
  if(started)try{await input.monitor.fail({failedAt,category:failure?(external.aborted?'cancelled':'capture'):'recovery_review'},AbortSignal.timeout(10000));failureAcknowledged=true;}catch{/* preserve the unknown acknowledgment; never retry it here */}
  if(started&&directory)try{await record(directory,'monitor.json',{profile:'crest.recovery-capture-monitor.v1',...identity,startAcknowledged,failureAcknowledged,completeBackup:false});}catch{failure??='journal';}
  if(failure||!candidate)throw new RecoveryCaptureControllerError(failure??'capture');
  return Object.freeze({forRecoveryTools:()=>Object.freeze({profile:'crest.recovery-capture-controller.v1' as const,...identity,state:'candidate_review_required' as const,startAcknowledged,failureAcknowledged,candidate,completeBackup:false as const}),toJSON():never{throw new RecoveryCaptureControllerError('binding');}});
 };
}
