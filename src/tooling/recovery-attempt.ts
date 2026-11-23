// Private Linux recovery-tool journal. This is not database authority, a backup
// scheduler or a complete-point marker. Unknown uploads are never retried here.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';
import type {RecoveryVaultArtifact,createRecoveryVault} from './recovery-vault.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/,maxLog=4*1024*1024,maxEvents=4096;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const purposes=['database','roles','original','application','configuration','manifest'] as const;
export type RecoveryAttemptHeader=Readonly<{formatVersion:1;pointId:string;businessId:string;startedAt:string;appReleaseId:string;migrationRegistrySha256:string;sourceSchemaVersion:number}>;
export type RecoveryArtifactReservation=Readonly<{artifactId:string;purpose:typeof purposes[number];byteSize:number;sha256:string;retainUntil:string}>;
type Event={kind:'started';header:RecoveryAttemptHeader}|{kind:'reserved';reservation:RecoveryArtifactReservation}|{kind:'verified';artifactId:string;artifact:RecoveryVaultArtifact}|{kind:'uncertain';artifactId:string};
type ArtifactState={reservation:RecoveryArtifactReservation;state:'reserved'|'verified'|'uncertain';artifact?:RecoveryVaultArtifact};
type State={header:RecoveryAttemptHeader|null;artifacts:Map<string,ArtifactState>;uncertain:boolean};
export class RecoveryAttemptError extends Error{constructor(){super('RECOVERY_ATTEMPT_REVIEW_REQUIRED');this.name='RecoveryAttemptError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryAttemptError();}
function fields(value:unknown,names:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(','));}
function date(value:unknown):asserts value is string{require(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);}
function header(value:unknown):asserts value is RecoveryAttemptHeader{
 fields(value,['formatVersion','pointId','businessId','startedAt','appReleaseId','migrationRegistrySha256','sourceSchemaVersion']);
 require(value.formatVersion===1&&typeof value.pointId==='string'&&uuid.test(value.pointId)&&typeof value.businessId==='string'&&uuid.test(value.businessId));date(value.startedAt);
 require(typeof value.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(value.appReleaseId)&&typeof value.migrationRegistrySha256==='string'&&digest.test(value.migrationRegistrySha256)&&Number.isSafeInteger(value.sourceSchemaVersion)&&(value.sourceSchemaVersion as number)>0);
}
function reservation(value:unknown):asserts value is RecoveryArtifactReservation{
 fields(value,['artifactId','purpose','byteSize','sha256','retainUntil']);require(typeof value.artifactId==='string'&&uuid.test(value.artifactId)&&purposes.includes(value.purpose as typeof purposes[number]));
 require(Number.isSafeInteger(value.byteSize)&&(value.byteSize as number)>=21&&(value.byteSize as number)<=1024*1024*1024&&typeof value.sha256==='string'&&digest.test(value.sha256));date(value.retainUntil);
}
function consume(state:State,input:unknown):Event{
 fields(input,input&&typeof input==='object'&&'kind' in input&&input.kind==='started'?['kind','header']:input&&typeof input==='object'&&'kind' in input&&input.kind==='reserved'?['kind','reservation']:input&&typeof input==='object'&&'kind' in input&&input.kind==='verified'?['kind','artifactId','artifact']:['kind','artifactId']);
 if(input.kind==='started'){require(!state.header);header(input.header);state.header=Object.freeze({...input.header});return{kind:'started',header:state.header};}
 require(state.header&&!state.uncertain);
 if(input.kind==='reserved'){
  reservation(input.reservation);require(!state.artifacts.has(input.reservation.artifactId)&&![...state.artifacts.values()].some(item=>item.state==='reserved'));const copy=Object.freeze({...input.reservation});state.artifacts.set(copy.artifactId,{reservation:copy,state:'reserved'});return{kind:'reserved',reservation:copy};
 }
 require(typeof input.artifactId==='string');const current=state.artifacts.get(input.artifactId);require(current?.state==='reserved');
 if(input.kind==='uncertain'){current.state='uncertain';state.uncertain=true;return{kind:'uncertain',artifactId:input.artifactId};}
 require(input.kind==='verified');fields(input.artifact,['key','versionId','byteSize','sha256','retainUntil']);const receipt=input.artifact,expected=current.reservation;
 require(receipt.key===recoveryVaultArtifactKey(state.header.pointId,input.artifactId)&&receipt.byteSize===expected.byteSize&&receipt.sha256===expected.sha256&&receipt.retainUntil===expected.retainUntil&&typeof receipt.versionId==='string'&&receipt.versionId.length>0&&receipt.versionId.length<=1024&&receipt.versionId!=='null'&&!Array.from(receipt.versionId).some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127));
 current.state='verified';current.artifact=Object.freeze({...receipt}) as RecoveryVaultArtifact;return{kind:'verified',artifactId:input.artifactId,artifact:current.artifact};
}
function summary(state:State){require(state.header);return Object.freeze({header:state.header,completeBackup:false as const,reviewRequired:state.uncertain||[...state.artifacts.values()].some(item=>item.state==='reserved'),artifacts:Object.freeze([...state.artifacts.values()].map(item=>Object.freeze({...item})))});}

// Hash chaining detects torn lines/reordering/corruption, not authorship or a
// removed complete suffix. A trusted external manifest/head remains necessary.
export function inspectRecoveryAttempt(text:string){
 try{
  require(typeof text==='string'&&Buffer.byteLength(text)<=maxLog&&text.endsWith('\n'));const lines=text.slice(0,-1).split('\n');require(lines.length>0&&lines.length<=maxEvents);
  const state:State={header:null,artifacts:new Map(),uncertain:false};let previous='0'.repeat(64);
  for(const [sequence,line]of lines.entries()){
   const row:unknown=JSON.parse(line);fields(row,['formatVersion','sequence','previousSha256','event','sha256']);require(row.formatVersion===1&&row.sequence===sequence&&row.previousSha256===previous&&typeof row.sha256==='string');
   const event=consume(state,row.event),encoded=JSON.stringify({formatVersion:1,sequence,previousSha256:previous,event});require(hash(encoded)===row.sha256&&JSON.stringify({...JSON.parse(encoded),sha256:row.sha256})===line);previous=row.sha256;
  }
  return summary(state);
 }catch{throw new RecoveryAttemptError();}
}

async function directorySync(directory:string){const file=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await file.sync();}finally{await file.close();}}
// One scheduler host owns this private spool. The future cross-host backup lease
// remains separate. An existing lock or journal is refused, never stolen/reset.
export async function createRecoveryAttempt(directory:string,input:RecoveryAttemptHeader){
 let lock:Awaited<ReturnType<typeof open>>|undefined,file:Awaited<ReturnType<typeof open>>|undefined,lockPath:string|undefined,ownsLock=false;
 try{
  require(process.platform==='linux'&&isAbsolute(directory));header(input);const initial=Object.freeze({...input}),root=await lstat(directory);require(root.isDirectory()&&(root.mode&0o077)===0&&root.uid===process.getuid!());
  lockPath=join(directory,initial.pointId+'.lock');lock=await open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);ownsLock=true;await lock.sync();await directorySync(directory);
  file=await open(join(directory,initial.pointId+'.jsonl'),constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await directorySync(directory);
  const journal=file,heldLock=lock,ownedLockPath=lockPath,state:State={header:null,artifacts:new Map(),uncertain:false};let sequence=0,previous='0'.repeat(64),bytes=0,busy=false,closed=false,poisoned=false;
  async function append(event:Event){
   require(!closed&&!poisoned&&sequence<maxEvents);const encoded=JSON.stringify({formatVersion:1,sequence,previousSha256:previous,event}),sha256=hash(encoded),line=JSON.stringify({...JSON.parse(encoded),sha256})+'\n';require(bytes+Buffer.byteLength(line)<=maxLog);
   try{await journal.writeFile(line);await journal.sync();}catch{poisoned=true;throw new RecoveryAttemptError();}
   consume(state,event);sequence++;previous=sha256;bytes+=Buffer.byteLength(line);
  }
  await append({kind:'started',header:initial});
  return Object.freeze({
   view:()=>summary(state),
   async publish(reserved:RecoveryArtifactReservation,path:string,vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>,signal:AbortSignal){
    require(!closed&&!poisoned&&!busy&&!state.uncertain);reservation(reserved);require(!state.artifacts.has(reserved.artifactId)&&typeof path==='string'&&path.length>0);signal.throwIfAborted();busy=true;
    try{
     // Persist reservation before dispatch. A crash or a missing acknowledgement
     // leaves a reviewable reserved key, not permission to repeat the write.
     const copy=Object.freeze({...reserved});await append({kind:'reserved',reservation:copy});
     try{
      const artifact=Object.freeze({...await vault.publishEncryptedFile({key:recoveryVaultArtifactKey(initial.pointId,copy.artifactId),path,retainUntil:copy.retainUntil},signal)});
      // Validate against a disposable state before acknowledging the real one.
      const trial:State={header:state.header,artifacts:new Map([[copy.artifactId,{reservation:copy,state:'reserved'}]]),uncertain:false};consume(trial,{kind:'verified',artifactId:copy.artifactId,artifact});
      signal.throwIfAborted();await append({kind:'verified',artifactId:copy.artifactId,artifact});return artifact;
     }catch{if(!poisoned)await append({kind:'uncertain',artifactId:copy.artifactId});throw new RecoveryAttemptError();}
    }finally{busy=false;}
   },
   async close(){
    require(!busy);if(closed)return;closed=true;let failed=false;
    try{await journal.close();}catch{failed=true;}try{await heldLock.close();}catch{failed=true;}
    try{await unlink(ownedLockPath);await directorySync(directory);}catch{failed=true;}
    if(failed)throw new RecoveryAttemptError();
   }
  });
 }catch{
  await file?.close().catch(()=>{});await lock?.close().catch(()=>{});if(ownsLock&&lockPath)await unlink(lockPath).catch(()=>{});throw new RecoveryAttemptError();
 }
}
