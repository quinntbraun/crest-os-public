// Single-host, at-most-one dispatch per canonical UTC slot. A claim survives
// process loss and never authorizes replay. No completed-backup authority.
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readPrivateToolText} from './private-tool-files.ts';
import {parseRecoveryJson} from './recovery-json.ts';
import {readRecoveryCaptureProfile} from './recovery-capture-profile.ts';
import {latestRecoveryBackupSlot} from './recovery-protection-policy.ts';
import {runRecoveryCaptureCommand} from './recovery-capture-command.ts';
type Stage='input'|'profile'|'claim'|'dispatch'|'record';
export class RecoveryScheduledCaptureError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_SCHEDULE_REVIEW_REQUIRED');this.name='RecoveryScheduledCaptureError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
async function syncDirectory(path:string){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function record(directory:string,name:string,value:unknown,created?:()=>void){
 const file=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created?.();
 try{const bytes=Buffer.from(JSON.stringify(typeof value==='function'?value():value)+'\n');require(bytes.length<=16384);await file.writeFile(bytes);await file.sync();}finally{await file.close();}await syncDirectory(directory);
}
export function createRecoveryScheduledCapture(dispatch:typeof runRecoveryCaptureCommand=runRecoveryCaptureCommand,now:()=>string=()=>new Date().toISOString()){
 return async(args:readonly string[],external:AbortSignal)=>{
  let stage:Stage='input',failure:Stage|undefined,claimed=false,directory:string|undefined,base:string|undefined,slot:string|undefined,pointId:string|undefined,claimedAt:string|undefined;
  try{
   require(process.platform==='linux'&&process.versions.node==='24.22.0'&&args.length===1);external.throwIfAborted();stage='profile';const source=await readPrivateToolText(args[0],65536,external),profile=readRecoveryCaptureProfile(parseRecoveryJson(source,65536)).forRecoveryTools();
   directory=profile.stateDirectory;const info=await lstat(directory);require(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&info.uid===process.getuid!());claimedAt=now();slot=latestRecoveryBackupSlot(claimedAt);base='scheduled-'+slot.replace(/\D/g,'');external.throwIfAborted();
   // UUID is chosen once and durably associated with this slot before calling
   // the explicit capture command. Existing claims are never read as retries.
   stage='claim';await record(directory,base+'.claimed.json',()=>{pointId=randomUUID();return{profile:'crest.recovery-schedule-claim.v1',slot,pointId,claimedAt,completeBackup:false};},()=>{claimed=true;});require(typeof pointId==='string');
   require(await readPrivateToolText(args[0],65536,external)===source);stage='dispatch';const result=await dispatch([args[0]!,pointId],external);require(result.pointId===pointId&&result.state==='candidate_review_required'&&result.completeBackup===false);
  }catch{failure=stage;}
  if(claimed&&directory&&base&&slot&&pointId&&claimedAt){
   try{await record(directory,base+'.finished.json',{profile:'crest.recovery-schedule-finish.v1',slot,pointId,claimedAt,finishedAt:now(),state:failure?'failed':'candidate_review_required',stage:failure??null,completeBackup:false});}catch{failure='record';}
  }
  if(failure||!slot||!pointId)throw new RecoveryScheduledCaptureError(failure??'dispatch');
  return Object.freeze({profile:'crest.recovery-scheduled-capture.v1' as const,slot,pointId,state:'candidate_review_required' as const,completeBackup:false as const});
 };
}
export const runRecoveryScheduledCapture=createRecoveryScheduledCapture();
