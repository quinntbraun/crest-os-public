import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {formatBusinessSourceBundle} from './business-source-bundle.ts';
import {verifyBusinessSourceBundle} from './business-source-verifier.ts';
import {parseExportPartBinding} from './export-part-crypto.ts';
import {parseExportPartIntent} from '../files/export-part-store.ts';
import type {BusinessSourceCapture} from './business-foundation-collector.ts';
import type {ExportPartIntent,createEncryptedExportPartStore} from '../files/export-part-store.ts';

export type SourceExportClaim=Readonly<{
 formatVersion:1;profile:'crest.business-source-bundle.v1';businessId:string;actorId:string;
 exportJobId:string;recoveryEpoch:string;leaseId:string;
}>;
type File=Readonly<{partId:string;fileName:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';bytes:number;sha256:string}>;
export type SourceExportPlan=Readonly<{
 formatVersion:1;claim:SourceExportClaim;generationId:string;observedAt:string;appReleaseId:string;sourceSchemaVersion:42;
 manifestSha256:string;parts:readonly File[];totalBytes:number;referenceClosureComplete:false;completePortableExport:false;completeBackup:false;
}>;
type SnapshotRequest=Readonly<{plan:SourceExportPlan;planSha256:string}>;
export type SourceExportPartRequest=Readonly<{claim:SourceExportClaim;generationId:string;planSha256:string;partId:string;intent:ExportPartIntent}>;
export type SourceExportReadyRequest=SnapshotRequest&Readonly<{parts:readonly SourceExportPartRequest[]}>;
type Stage='authorize'|'snapshot'|'intent'|'verified'|'ready';
export type SourceExportAck=Readonly<{formatVersion:1;stage:Stage;requestSha256:string}>;
// Trusted server composition only. The future fixed database adapter MUST
// validate frozen job/lease/profile, fresh provider/session/owner membership,
// recovery authority and expiry on EVERY method; acknowledge committed state
// only. These callback receipts/hashes are not authentication capabilities.
export type SourceExportJobPort=Readonly<{
 authorize:(request:SourceExportClaim,signal:AbortSignal)=>Promise<SourceExportAck>;
 snapshot:(request:SnapshotRequest,signal:AbortSignal)=>Promise<SourceExportAck>;
 intent:(request:SourceExportPartRequest,signal:AbortSignal)=>Promise<SourceExportAck>;
 verified:(request:SourceExportPartRequest,signal:AbortSignal)=>Promise<SourceExportAck>;
 ready:(request:SourceExportReadyRequest,signal:AbortSignal)=>Promise<SourceExportAck>;
}>;
type Store=Pick<Awaited<ReturnType<typeof createEncryptedExportPartStore>>,'prepare'|'writeCandidate'>;
type Configuration=Readonly<{businessId:string;appReleaseId:string;timeoutMs?:number}>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const claimFields=['formatVersion','profile','businessId','actorId','exportJobId','recoveryEpoch','leaseId'];
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const jsonSha=(value:unknown)=>sha(JSON.stringify(value));
export class SourceExportWorkerError extends Error{constructor(){super('SOURCE_EXPORT_RUN_REVIEW_REQUIRED');this.name='SourceExportWorkerError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportWorkerError();}
function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));}
function claim(value:unknown,businessId:string):SourceExportClaim{
 require(exact(value,claimFields)&&value.formatVersion===1&&value.profile==='crest.business-source-bundle.v1'&&value.businessId===businessId);
 for(const field of claimFields.slice(2))require(typeof value[field]==='string'&&uuid.test(value[field]));
 return Object.freeze({formatVersion:1,profile:'crest.business-source-bundle.v1',businessId,actorId:value.actorId as string,exportJobId:value.exportJobId as string,recoveryEpoch:value.recoveryEpoch as string,leaseId:value.leaseId as string});
}
async function bounded<T>(work:()=>Promise<T>,signal:AbortSignal,deadline:number):Promise<T>{
 require(!signal.aborted&&performance.now()<deadline);let abort=()=>{};
 const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(new SourceExportWorkerError());signal.addEventListener('abort',abort,{once:true});});
 try{require(!signal.aborted&&performance.now()<deadline);const result=await Promise.race([work(),stopped]);require(!signal.aborted&&performance.now()<deadline);return result;}
 finally{signal.removeEventListener('abort',abort);}
}

// Internal worker mechanism; no scheduler, queue implementation, route,
// browser-selected job, download capability, automatic retry or activation.
export function createBusinessSourceExportWorker(config:Configuration,collector:(signal:AbortSignal)=>Promise<BusinessSourceCapture>,store:Store,jobs:SourceExportJobPort){
 require(config!==null&&typeof config==='object'&&store!==null&&typeof store==='object'&&jobs!==null&&typeof jobs==='object');
 require(exact(config,config.timeoutMs===undefined?['businessId','appReleaseId']:['businessId','appReleaseId','timeoutMs'])&&typeof config.businessId==='string'&&uuid.test(config.businessId)&&typeof config.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(config.appReleaseId));
 const {businessId,appReleaseId}=config,timeoutMs=config.timeoutMs??900000;
 require(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=900000&&typeof collector==='function');
 const stages=['authorize','snapshot','intent','verified','ready'] as const;
 for(const stage of stages)require(typeof jobs[stage]==='function');
 require(typeof store.prepare==='function'&&typeof store.writeCandidate==='function');
 const port=Object.freeze(Object.fromEntries(stages.map(stage=>[stage,jobs[stage].bind(jobs)]))) as SourceExportJobPort;
 const prepare=store.prepare.bind(store),write=store.writeCandidate.bind(store);let running=false;
 async function acknowledge<T extends SourceExportClaim|SnapshotRequest|SourceExportPartRequest|SourceExportReadyRequest>(stage:Stage,request:T,work:()=>Promise<SourceExportAck>,signal:AbortSignal,deadline:number){
  const expected=jsonSha(request),ack=await bounded(work,signal,deadline);
  require(exact(ack,['formatVersion','stage','requestSha256'])&&ack.formatVersion===1&&ack.stage===stage&&ack.requestSha256===expected);
 }
 return Object.freeze({async run(input:unknown,external:AbortSignal){
  require(!running);running=true;const plaintext:Buffer[]=[];
  try{
   const current=claim(input,businessId),signal=AbortSignal.any([external,AbortSignal.timeout(timeoutMs)]),deadline=performance.now()+timeoutMs;
   await acknowledge('authorize',current,()=>port.authorize(current,signal),signal,deadline);
   const captured=await bounded(()=>collector(signal),signal,deadline),value=formatBusinessSourceBundle(captured,{businessId,appReleaseId,sourceSchemaVersion:42}).forServer();
   require(!signal.aborted);
   const root=Buffer.from(value.manifest),files=[...value.parts].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(p=>({fileName:p.name,contentType:p.contentType,bytes:Buffer.from(p.content)}));
   plaintext.push(root,...files.map(p=>p.bytes));
   files.push({fileName:'source_manifest.json',contentType:'application/json',bytes:root});
   // Independent decode/source comparison succeeds before any ledger snapshot
   // publication, key preparation or object write. All outputs share capture.
   const checked=verifyBusinessSourceBundle({manifest:root,parts:files.slice(0,-1).map(p=>({name:p.fileName,bytes:p.bytes}))},{businessId,appReleaseId}).forServer();
   require(!signal.aborted&&typeof checked.observedAt==='string');
   const parts=Object.freeze(files.map(file=>Object.freeze({partId:randomUUID(),fileName:file.fileName,contentType:file.contentType,bytes:file.bytes.length,sha256:sha(file.bytes)})));
   const plan:SourceExportPlan=Object.freeze({formatVersion:1,claim:current,generationId:checked.generationId,observedAt:checked.observedAt,appReleaseId,sourceSchemaVersion:42,manifestSha256:sha(root),parts,totalBytes:files.reduce((n,f)=>n+f.bytes.length,0),referenceClosureComplete:false,completePortableExport:false,completeBackup:false});
   const snapshot=Object.freeze({plan,planSha256:jsonSha(plan)});
   await acknowledge('snapshot',snapshot,()=>port.snapshot(snapshot,signal),signal,deadline);
   const receipts:SourceExportPartRequest[]=[];
   for(const [index,file]of files.entries()){
    const descriptor=parts[index]!;
    const binding=parseExportPartBinding({businessId,actorId:current.actorId,exportJobId:current.exportJobId,generationId:plan.generationId,recoveryEpoch:current.recoveryEpoch,partId:descriptor.partId,fileName:descriptor.fileName,contentType:descriptor.contentType});
    const prepared=await bounded(()=>prepare(file.bytes,binding,signal),signal,deadline),intent=parseExportPartIntent(prepared.intentForServer(),binding);
    require(intent.plaintextBytes===descriptor.bytes&&intent.plaintextSha256===descriptor.sha256);
    const request=Object.freeze({claim:current,generationId:plan.generationId,planSha256:snapshot.planSha256,partId:descriptor.partId,intent});
    // A missing, lost or mismatched durable intent ACK forbids a PUT. A lost
    // PUT/read/verification ACK stops the generation with original intents
    // retained; reconciliation is a separate explicit database-fenced action.
    await acknowledge('intent',request,()=>port.intent(request,signal),signal,deadline);
    const written=parseExportPartIntent(await bounded(()=>write(prepared,signal),signal,deadline),binding);
    require(jsonSha(written)===jsonSha(intent));
    await acknowledge('verified',request,()=>port.verified(request,signal),signal,deadline);
    receipts.push(request);
   }
   const ready=Object.freeze({...snapshot,parts:Object.freeze(receipts)});
   await acknowledge('ready',ready,()=>port.ready(ready,signal),signal,deadline);
   const result=Object.freeze({claim:current,generationId:plan.generationId,planSha256:snapshot.planSha256,parts:receipts.length,completePortableExport:false as const,completeBackup:false as const});
   return Object.freeze({forServer:()=>result,toJSON():never{throw new SourceExportWorkerError();}});
  }catch{throw new SourceExportWorkerError();}
  finally{for(const bytes of plaintext)bytes.fill(0);running=false;}
 }});
}
