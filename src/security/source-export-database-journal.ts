import 'server-only';
import {createHash} from 'node:crypto';
import {sessionDatabase} from './session-database.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseSourceExportJob,parseSourceExportCommand,parseSourceExportCommitted} from './source-export-job-contract.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {SourceExportJob} from './source-export-job-contract.ts';
import type {SourceExportAck} from './business-source-export-worker.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

type Stage='authorize'|'snapshot'|'intent'|'verified'|'ready';
type Code='SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED'|'SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED'|'SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN'|'SOURCE_EXPORT_JOURNAL_LOOKUP_FAILED'|'RECOVERY_REVIEW_REQUIRED';
export class SourceExportJournalError extends Error{constructor(code:Code){super(code);this.name='SourceExportJournalError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportJournalError('SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED');}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const claimKeys=['formatVersion','profile','businessId','actorId','exportJobId','recoveryEpoch','leaseId'];
const limits={authorize:2048,snapshot:1048576,intent:8192,verified:8192,ready:12582912} as const;
const sql={
 authorize:'SELECT crest_commands.authorize_source_export_worker($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text) AS result',
 snapshot:'SELECT crest_commands.record_source_export_snapshot($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text) AS result',
 intent:'SELECT crest_commands.record_source_export_part_intent($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text) AS result',
 verified:'SELECT crest_commands.record_source_export_part_verified($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text) AS result',
 ready:'SELECT crest_commands.record_source_export_ready($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::text) AS result'
} as const;

// Trusted server candidate for the unregistered schema43 journal. It is not a
// schema42 worker port, public endpoint, scheduler or download authorization.
// Claimed source is historical binding only; SQL checks the current live lease.
// The caller retains this ORIGINAL Ready operation/version across uncertainty.
export function createSourceExportDatabaseJournal(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>,claimed:SourceExportJob,readyOperationId:string){
 require(claimed!==null&&typeof claimed==='object');
 const job=parseSourceExportJob(claimed,Object.getOwnPropertyDescriptor(claimed,'business_id')?.value as string);
 require(job.state==='Running'&&uuid(readyOperationId)&&readyOperationId!==job.operation_id&&readyOperationId!==job.request_operation_id);
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 const expected=Object.freeze({formatVersion:1,profile:job.profile,businessId:job.business_id,actorId:job.actor_id,exportJobId:job.id,recoveryEpoch:job.recovery_epoch,leaseId:job.lease_id});
 function original(stage:Stage,input:unknown):{raw:string;digest:string;generationId:string|undefined}{
  require(typeof input==='string'&&input.length>=1&&input.length<=limits[stage]&&Buffer.byteLength(input,'utf8')<=limits[stage]&&!input.includes('\0')&&Buffer.from(input,'utf8').toString('utf8')===input);
  const r:unknown=JSON.parse(input);let current:unknown;let generationId:string|undefined;
  if(stage==='authorize'){require(exact(r,claimKeys));current=r;}
  else if(stage==='snapshot'||stage==='ready'){
   require(exact(r,stage==='snapshot'?['plan','planSha256']:['plan','planSha256','parts'])&&r.plan!==null&&typeof r.plan==='object'&&!Array.isArray(r.plan));const plan=r.plan as Record<string,unknown>;
   require(plan.sourceSchemaVersion===43&&plan.appReleaseId===job.app_release_id&&uuid(plan.generationId));current=plan.claim;generationId=plan.generationId;
  }else{require(exact(r,['claim','generationId','planSha256','partId','intent'])&&uuid(r.generationId));current=r.claim;generationId=r.generationId;}
  require(exact(current,claimKeys)&&claimKeys.every(k=>current[k]===expected[k as keyof typeof expected]));
  // SQL owns full closed-shape, duplicate-key, original inventory and authority
  // validation. Never parse and reserialize away original bytes before sending.
  return {raw:input,digest:sha(input),generationId};
 }
 async function authorized<T>(credential:string,external:AbortSignal,work:(args:unknown[],signal:AbortSignal)=>Promise<T>){
  const signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{
   require(!signal.aborted);hash=sessionCredentialHash(credential);
   const verified=await sessions.verify(credential,signal,'background',true);
   require(!signal.aborted&&verified.actorId===job.actor_id);
   const result=await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),job.business_id],signal);
   require(!signal.aborted);return result;
  }finally{hash?.fill(0);}
 }
 async function execute(stage:Stage,credential:string,input:string,external:AbortSignal):Promise<SourceExportAck>{
  let submitted=false;
  try{
   const request=original(stage,input);
   const ack=await authorized(credential,external,async(args,signal)=>{
    submitted=true;
    return database.commandTransaction(async(query,current)=>{
     const values=[...args,job.recovery_epoch,...(stage==='ready'?[readyOperationId,job.version,request.raw]:[request.raw])];
     const value=await query(sql[stage],values);
     require(!current.aborted&&exact(value,['formatVersion','stage','requestSha256'])&&value.formatVersion===1&&value.stage===stage&&value.requestSha256===request.digest);
     return Object.freeze({formatVersion:1 as const,stage,requestSha256:request.digest});
    },signal);
   });
   require(!external.aborted);return ack;
  }catch(error){
   if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new SourceExportJournalError('RECOVERY_REVIEW_REQUIRED');
   throw new SourceExportJournalError(submitted?'SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN':'SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');
  }
 }
 return Object.freeze({
  authorize:(credential:string,input:string,signal:AbortSignal)=>execute('authorize',credential,input,signal),
  snapshot:(credential:string,input:string,signal:AbortSignal)=>execute('snapshot',credential,input,signal),
  intent:(credential:string,input:string,signal:AbortSignal)=>execute('intent',credential,input,signal),
  verified:(credential:string,input:string,signal:AbortSignal)=>execute('verified',credential,input,signal),
  ready:(credential:string,input:string,signal:AbortSignal)=>execute('ready',credential,input,signal),
  async lookupReady(credential:string,input:string,external:AbortSignal){
   try{
    const request=original('ready',input),command=parseSourceExportCommand({schemaVersion:1,businessId:job.business_id,commandType:'export.ready',reference:{operationId:readyOperationId,recoveryEpoch:job.recovery_epoch,exportJobId:job.id,expectedVersion:job.version,leaseId:job.lease_id,generationId:request.generationId,requestSha256:request.digest}});
    const result=await authorized(credential,external,async(args,signal)=>{
     const value=await database('SELECT crest_commands.lookup_source_export_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,readyOperationId],signal);
     require(!signal.aborted);return exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseSourceExportCommitted(value,command,job.actor_id);
    });
    require(!external.aborted);return Object.freeze({forServer:()=>result,toJSON():never{throw new SourceExportJournalError('SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED');}});
   }catch{
    throw new SourceExportJournalError('SOURCE_EXPORT_JOURNAL_LOOKUP_FAILED');
   }
  },
  toJSON():never{throw new SourceExportJournalError('SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED');}
 });
}
