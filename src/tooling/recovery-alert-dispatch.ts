// Isolated host notification journal. It is not complete-point authority and
// never marks a backup successful. Production catalog/mail composition remains
// separate. The injected catalog reader must never use candidate/profile times.
import {constants} from 'node:fs';
import {open,lstat,readdir,unlink} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readPrivateToolText} from './private-tool-files.ts';
import {parseRecoveryJson} from './recovery-json.ts';
import {planRecoveryProtectionAlert} from './recovery-alert-policy.ts';
import type {RecoveryAlertAttempt} from './recovery-alert-policy.ts';

type Notice=NonNullable<ReturnType<typeof planRecoveryProtectionAlert>['notification']>;
type Ports=Readonly<{
 directory:string;
 readLastVerifiedCompleteSnapshot:(signal:AbortSignal)=>Promise<string|null>;
 deliver:(notice:Notice,signal:AbortSignal)=>Promise<Readonly<{id:string;acknowledged:true}>>;
 now?:()=>string;
}>;
type Stage='configuration'|'lock'|'journal'|'catalog'|'policy'|'reservation'|'delivery_record'|'cleanup';
export class RecoveryAlertDispatchError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_ALERT_DISPATCH_REVIEW_REQUIRED');this.name='RecoveryAlertDispatchError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
const profile='crest.backup-alert-journal.v1',pattern=/^(\d{6})-([a-f0-9]{64})\.(attempt|delivery)\.json$/;
async function sync(directory:string){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function record(directory:string,name:string,value:unknown){
 const bytes=Buffer.from(JSON.stringify(value)+'\n');require(bytes.length<=4096);
 const handle=await open(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await sync(directory);
}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));}
async function history(directory:string,signal:AbortSignal){
 const names=(await readdir(directory)).filter(name=>name!=='.dispatch.lock');require(names.length<=8192);
 const rows=new Map<number,{id:string;attempt?:string;delivery?:string}>();
 for(const name of names){const match=pattern.exec(name);require(match);const sequence=Number(match[1]);require(sequence>0&&sequence<=4096);const row:{id:string;attempt?:string;delivery?:string}=rows.get(sequence)??{id:match[2]!};require(row.id===match[2]);require(!row[match[3] as 'attempt'|'delivery']);row[match[3] as 'attempt'|'delivery']=name;rows.set(sequence,row);}
 const result:RecoveryAlertAttempt[]=[];
 for(const [sequence,files] of [...rows].sort((a,b)=>a[0]-b[0])){
  signal.throwIfAborted();require(sequence===result.length+1&&files.attempt);
  const value=parseRecoveryJson(await readPrivateToolText(join(directory,files.attempt),4096,signal),4096);
  exact(value,['profile','sequence','notice']);require(value.profile===profile&&value.sequence===sequence);exact(value.notice,['id','incidentId','kind','at','lastVerifiedCompleteSnapshotAt']);require(value.notice.id===files.id);
  let delivery:RecoveryAlertAttempt['delivery']='reserved';
  if(files.delivery){
   const outcome=parseRecoveryJson(await readPrivateToolText(join(directory,files.delivery),4096,signal),4096);
   exact(outcome,['profile','sequence','notice','delivery','finishedAt']);require(outcome.profile===profile&&outcome.sequence===sequence&&isDeepStrictEqual(outcome.notice,value.notice)&&['acknowledged','unknown'].includes(outcome.delivery as string));
   require(typeof outcome.finishedAt==='string'&&new Date(outcome.finishedAt).toISOString()===outcome.finishedAt&&Date.parse(outcome.finishedAt)>=Date.parse(value.notice.at as string));delivery=outcome.delivery as RecoveryAlertAttempt['delivery'];
  }
  result.push({...value.notice,delivery} as RecoveryAlertAttempt);
 }
 return result;
}

export function createRecoveryAlertDispatcher(ports:Ports){
 return async(signal:AbortSignal)=>{
  let stage:Stage='configuration',lock:Awaited<ReturnType<typeof open>>|undefined,result:unknown,failure=false;
  try{
   require(process.platform==='linux'&&isAbsolute(ports.directory)&&typeof ports.readLastVerifiedCompleteSnapshot==='function'&&typeof ports.deliver==='function');
   const info=await lstat(ports.directory);require(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid!()&&(info.mode&0o077)===0);signal.throwIfAborted();
   stage='lock';lock=await open(join(ports.directory,'.dispatch.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await lock.writeFile('crest.backup-alert-lock.v1\n');await lock.sync();await sync(ports.directory);
   stage='journal';const attempts=await history(ports.directory,signal);
   stage='catalog';const snapshot=await ports.readLastVerifiedCompleteSnapshot(signal);signal.throwIfAborted();
   stage='policy';const now=ports.now??(()=>new Date().toISOString()),plan=planRecoveryProtectionAlert({now:now(),lastVerifiedCompleteSnapshotAt:snapshot,attempts});
   if(!plan.notification){result=Object.freeze({...plan,delivery:'not_needed' as const});}
   else{
    const notice=plan.notification,sequence=attempts.length+1;require(sequence<=4096);const prefix=String(sequence).padStart(6,'0')+'-'+notice.id;
    stage='reservation';signal.throwIfAborted();await record(ports.directory,prefix+'.attempt.json',{profile,sequence,notice});
    let delivery:'acknowledged'|'unknown'='unknown';
    try{signal.throwIfAborted();const acknowledgment=await ports.deliver(notice,AbortSignal.any([signal,AbortSignal.timeout(10000)]));exact(acknowledgment,['id','acknowledged']);require(acknowledgment.id===notice.id&&acknowledgment.acknowledged===true);delivery='acknowledged';}catch{/* An uncertain delivery is durable and never automatically resent. */}
    stage='delivery_record';const finishedAt=now();require(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(finishedAt)&&new Date(finishedAt).toISOString()===finishedAt&&Date.parse(finishedAt)>=Date.parse(notice.at));await record(ports.directory,prefix+'.delivery.json',{profile,sequence,notice,delivery,finishedAt});
    result=Object.freeze({...plan,delivery});
   }
  }catch{failure=true;}
  finally{
   if(lock){try{await lock.close();await unlink(join(ports.directory,'.dispatch.lock'));await sync(ports.directory);}catch{stage='cleanup';failure=true;}}
  }
  if(failure||!result)throw new RecoveryAlertDispatchError(stage);
  return result as Readonly<ReturnType<typeof planRecoveryProtectionAlert>&{delivery:'not_needed'|'acknowledged'|'unknown'}>;
 };
}
