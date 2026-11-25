// Read-only operator diagnostics. Local capture records and artifact checks
// never establish complete-point protection, cloud availability or tenant access.
import {lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readPrivateToolText} from './private-tool-files.ts';
import {parseRecoveryJson} from './recovery-json.ts';
import {readRecoveryCaptureProfile} from './recovery-capture-profile.ts';
import {inspectRecoveryAttempt} from './recovery-attempt.ts';

type Stage='input'|'profile'|'directory'|'records'|'artifacts'|'recheck';
export class RecoveryCaptureStatusError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_CAPTURE_STATUS_REVIEW_REQUIRED');this.name='RecoveryCaptureStatusError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));}
function instant(value:unknown,now:number):asserts value is string{require(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&new Date(value).toISOString()===value&&Date.parse(value)<=now);}
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',pattern=new RegExp('^command-('+uuid+')[.](started|finished)[.]json$');
const stages=['input','profile','journal','files','tools','attempt','connections','capture','cleanup'];
const phases=['fresh','started','start_unknown','failed','failure_unknown'];
type Attempt={pointId:string;startedAt:string;finishedAt:string|null;state:'failed'|'candidate_review_required'|'unfinished_or_uncertain';stage:string|null;monitorPhase:string|null};
async function recordNames(directory:string){const all=await readdir(directory);require(all.length<=32768);const names=all.filter(name=>name.startsWith('command-')).sort();require(names.length<=20000&&names.every(name=>pattern.test(name)));return{all,names};}
export function createRecoveryCaptureStatusCommand(clock:()=>string=()=>new Date().toISOString()){
 return async(args:readonly string[],external:AbortSignal)=>{
  let stage:Stage='input';const signal=AbortSignal.any([external,AbortSignal.timeout(30000)]);
  try{
   require(process.platform==='linux'&&process.versions.node==='24.22.0'&&args.length===1);signal.throwIfAborted();
   stage='profile';const source=await readPrivateToolText(args[0],65536,signal),profile=readRecoveryCaptureProfile(parseRecoveryJson(source,65536)).forRecoveryTools();
   stage='directory';const directory=profile.stateDirectory,info=await lstat(directory);require(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid!()&&(info.mode&0o077)===0);
   const before=await recordNames(directory),rows=new Map<string,{started?:Record<string,unknown>;finished?:Record<string,unknown>}>();let bytes=0;
   stage='records';
   for(const name of before.names){
    signal.throwIfAborted();const match=pattern.exec(name)!;const text=await readPrivateToolText(join(directory,name),16384,signal);bytes+=Buffer.byteLength(text);require(bytes<=32*1024*1024);const value=parseRecoveryJson(text,16384),kind=match[2] as 'started'|'finished';
    exact(value,kind==='started'?['profile','pointId','startedAt','completeBackup']:['profile','pointId','startedAt','finishedAt','state','stage','monitorPhase','completeBackup']);
    require(value.profile===(kind==='started'?'crest.recovery-capture-command-start.v1':'crest.recovery-capture-command-finish.v1')&&value.pointId===match[1]&&value.completeBackup===false);
    const row=rows.get(match[1]!)??{};require(!row[kind]);row[kind]=value;rows.set(match[1]!,row);
   }
   const evaluatedAt=clock();instant(evaluatedAt,Infinity);const now=Date.parse(evaluatedAt),attempts:Attempt[]=[];
   for(const [pointId,row] of rows){
    require(row.started);instant(row.started.startedAt,now);const start=row.started.startedAt;
    if(!row.finished){attempts.push({pointId,startedAt:start,finishedAt:null,state:'unfinished_or_uncertain',stage:null,monitorPhase:null});continue;}
    const finish=row.finished;instant(finish.finishedAt,now);require(finish.startedAt===start&&Date.parse(finish.finishedAt)>=Date.parse(start));
    require((finish.state==='failed'&&typeof finish.stage==='string'&&stages.includes(finish.stage)||finish.state==='candidate_review_required'&&finish.stage===null)&&(finish.monitorPhase===null||typeof finish.monitorPhase==='string'&&phases.includes(finish.monitorPhase)));
    attempts.push({pointId,startedAt:start,finishedAt:finish.finishedAt,state:finish.state as Attempt['state'],stage:finish.stage as string|null,monitorPhase:finish.monitorPhase as string|null});
   }
   attempts.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||a.pointId.localeCompare(b.pointId));
   stage='artifacts';const recent=[];
   for(const attempt of attempts.slice(0,20)){
    const name=attempt.pointId+'.jsonl';let artifacts:null|Readonly<{verified:number;reserved:number;uncertain:number;reviewRequired:boolean}>=null;
    if(before.all.includes(name)){
     const journal=inspectRecoveryAttempt(await readPrivateToolText(join(directory,name),4*1024*1024,signal));require(journal.header.pointId===attempt.pointId&&journal.header.startedAt===attempt.startedAt&&journal.header.businessId===profile.businessId);
     artifacts=Object.freeze({verified:journal.artifacts.filter(item=>item.state==='verified').length,reserved:journal.artifacts.filter(item=>item.state==='reserved').length,uncertain:journal.artifacts.filter(item=>item.state==='uncertain').length,reviewRequired:journal.reviewRequired});
    }
    recent.push(Object.freeze({...attempt,artifactJournal:artifacts,artifactLockPresent:before.all.includes(attempt.pointId+'.lock')}));
   }
   stage='recheck';signal.throwIfAborted();require(await readPrivateToolText(args[0],65536,signal)===source&&isDeepStrictEqual((await recordNames(directory)).names,before.names));
   return Object.freeze({profile:'crest.recovery-capture-status.v1' as const,evaluatedAt,totalAttempts:attempts.length,
    failedAttempts:attempts.filter(row=>row.state==='failed').length,candidatesRequiringReview:attempts.filter(row=>row.state==='candidate_review_required').length,
    unfinishedOrUncertainAttempts:attempts.filter(row=>row.state==='unfinished_or_uncertain').length,recentAttempts:Object.freeze(recent),moreAttempts:attempts.length>recent.length,
    completePointCatalogLoaded:false as const,protectionLevel:'unknown' as const,journalSnapshotAtomic:false as const,
    ordinaryFinancialWritesBlocked:false as const,completeBackup:false as const});
  }catch{throw new RecoveryCaptureStatusError(stage);}
 };
}
export const runRecoveryCaptureStatusCommand=createRecoveryCaptureStatusCommand();
