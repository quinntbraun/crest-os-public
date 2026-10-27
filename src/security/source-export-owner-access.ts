import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseSourceExportCommand,parseSourceExportJob,parseSourceExportCommitted} from './source-export-job-contract.ts';
import {parseExportRequestRetirement,parseExportRequestResolution} from './source-export-request-resolution.ts';
import {parseSourceExportOwnerContext} from './source-export-owner-context.ts';
import {parseSourceExportCursor,parseSourceExportList} from './source-export-owner-list.ts';
import {parseSourceExportDownloadPageRequest,parseSourceExportDownloadPartRequest,parseSourceExportDownloadCatalogue} from './source-export-download-contract.ts';
import {parseSourceExportDownloadPermit} from './source-export-download-permit.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {SourceExportCommand} from './source-export-job-contract.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

type Code='SOURCE_EXPORT_ACCESS_INPUT_REQUIRED'|'SOURCE_EXPORT_REQUEST_NOT_SUBMITTED'|'SOURCE_EXPORT_REQUEST_OUTCOME_UNKNOWN'|'SOURCE_EXPORT_RESOLUTION_NOT_SUBMITTED'|'SOURCE_EXPORT_RESOLUTION_OUTCOME_UNKNOWN'|'SOURCE_EXPORT_READ_FAILED'|'SOURCE_EXPORT_ACCESS_PRIVATE'|'RECOVERY_REVIEW_REQUIRED';
export class SourceExportOwnerAccessError extends Error{constructor(code:Code){super(code);this.name='SourceExportOwnerAccessError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function privateResult<T>(value:T){return Object.freeze({forServer:()=>value,toJSON():never{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_PRIVATE');}});}

// Trusted server boundary, fixed business only. No route, automatic dispatch,
// retry, current lease or download authority follows from historical receipts.
export function createSourceExportOwnerAccess(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>,businessId:string,appReleaseId?:string){
 require(uuid(businessId)&&(appReleaseId===undefined||typeof appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(appReleaseId)));const scope=businessId,release=appReleaseId,database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 function requestCommand(input:unknown):Extract<SourceExportCommand,{commandType:'export.request'}>{
  try{const command=parseSourceExportCommand(input);require(command.businessId===scope&&command.commandType==='export.request');return command;}
  catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}
 }
 async function authorized<T>(credential:string,external:AbortSignal,work:(args:unknown[],actorId:string,signal:AbortSignal)=>Promise<T>){
  const signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{
   require(!signal.aborted);hash=sessionCredentialHash(credential);const v=await sessions.verify(credential,signal,'background',true);require(!signal.aborted);
   const result=await work([hash,v.sessionId,v.actorId,v.provider.issuer,v.provider.subject,v.provider.sessionId,new Date(v.provider.expiresAt),scope],v.actorId,signal);require(!signal.aborted);return result;
  }finally{hash?.fill(0);}
 }
 return Object.freeze({
  async downloadCatalogue(credential:string,input:unknown,external:AbortSignal){
   const request=(()=>{try{return parseSourceExportDownloadPageRequest(input);}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}})();
   try{return privateResult(await authorized(credential,external,async(args,_actor,signal)=>{
    const value=await database('SELECT crest_commands.read_source_export_download_page($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer) AS result',[...args,request.exportJobId,request.generationId,request.afterOrdinal],signal);require(!signal.aborted);const page=parseSourceExportDownloadCatalogue(value,scope,request);require(Date.parse(page.completedAt)<=Date.now()&&Date.parse(page.expiresAt)>Date.now());return page;
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async downloadPart(credential:string,input:unknown,external:AbortSignal){
   const request=(()=>{try{return parseSourceExportDownloadPartRequest(input);}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}})();
   try{return privateResult(await authorized(credential,external,async(args,actor,signal)=>{
    const value=await database('SELECT crest_commands.read_source_export_download_part($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid) AS result',[...args,request.exportJobId,request.generationId,request.partId],signal);require(!signal.aborted);return parseSourceExportDownloadPermit(value,scope,actor,request);
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async list(credential:string,input:unknown,external:AbortSignal){
   const cursor=(()=>{try{return parseSourceExportCursor(input);}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}})();
   try{return privateResult(await authorized(credential,external,async(args,_actor,signal)=>{
    const value=await database('SELECT crest_commands.list_source_exports($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid) AS result',[...args,cursor?.createdAt??null,cursor?.id??null],signal);require(!signal.aborted);return parseSourceExportList(value,scope,cursor);
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async context(credential:string,external:AbortSignal){
   try{
    require(release!==undefined);return privateResult(await authorized(credential,external,async(args,actor,signal)=>{
     const value=await database('SELECT crest_commands.read_business_settings_context($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid) AS result',args,signal);
     require(!signal.aborted&&exact(value,['schemaVersion','businessId','legalName','businessVersion','writeState','recoveryEpoch'])&&value.schemaVersion===1&&value.businessId===scope);
     return parseSourceExportOwnerContext({schemaVersion:1,businessId:scope,actorId:actor,appReleaseId:release,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
    }));
   }catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async request(credential:string,input:unknown,external:AbortSignal){
   const command=requestCommand(input),r=command.reference;let submitted=false;
   try{
    const result=await authorized(credential,external,(args,actor,signal)=>{
     submitted=true;return database.commandTransaction(async(query,current)=>{
      const value=await query('SELECT crest_commands.request_source_export($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::text) AS result',[...args,r.recoveryEpoch,r.operationId,r.exportJobId,r.appReleaseId]);require(!current.aborted);
      if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='active_or_identity'))return Object.freeze({state:'conflict' as const,reason:value.reason});
      return parseSourceExportCommitted(value,command,actor);
     },signal);
    });
    require(!external.aborted);return privateResult(result);
   }catch(error){
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new SourceExportOwnerAccessError('RECOVERY_REVIEW_REQUIRED');
    throw new SourceExportOwnerAccessError(submitted?'SOURCE_EXPORT_REQUEST_OUTCOME_UNKNOWN':'SOURCE_EXPORT_REQUEST_NOT_SUBMITTED');
   }
  },
  async status(credential:string,exportJobId:string,external:AbortSignal){
   require(uuid(exportJobId));const jobId=exportJobId;
   try{return privateResult(await authorized(credential,external,async(args,_actor,signal)=>{
    const value=await database('SELECT crest_commands.read_source_export($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,jobId],signal);require(!signal.aborted);
    if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
    require(exact(value,['state','job'])&&value.state==='found');const job=parseSourceExportJob(value.job,scope);require(job.id===jobId);return Object.freeze({state:'found' as const,job});
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async lookupRequest(credential:string,input:unknown,external:AbortSignal){
   const command=requestCommand(input);
   try{return privateResult(await authorized(credential,external,async(args,actor,signal)=>{
    const value=await database('SELECT crest_commands.lookup_source_export_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,command.reference.operationId],signal);require(!signal.aborted);
    if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
    return parseSourceExportCommitted(value,command,actor);
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  async retireRequest(credential:string,input:unknown,external:AbortSignal){
   const decision=(()=>{try{const r=parseExportRequestRetirement(input);require(r.original.businessId===scope);return r;}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_INPUT_REQUIRED');}})();let submitted=false;
   try{
    const result=await authorized(credential,external,(args,_actor,signal)=>{
     submitted=true;return database.commandTransaction(async(query,current)=>{
      const value=await query('SELECT crest_commands.retire_source_export_request($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::jsonb,$11::text) AS result',[...args,decision.recoveryEpoch,JSON.stringify(decision.original),decision.reason]);require(!current.aborted);const outcome=parseExportRequestResolution(value,decision.original);
      if(outcome.state==='retired')require(outcome.retirement.recoveryEpoch===decision.recoveryEpoch&&outcome.retirement.reason===decision.reason);return outcome;
     },signal);
    });require(!external.aborted);return privateResult(result);
   }catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new SourceExportOwnerAccessError('RECOVERY_REVIEW_REQUIRED');throw new SourceExportOwnerAccessError(submitted?'SOURCE_EXPORT_RESOLUTION_OUTCOME_UNKNOWN':'SOURCE_EXPORT_RESOLUTION_NOT_SUBMITTED');}
  },
  async lookupResolution(credential:string,input:unknown,external:AbortSignal){
   const original=requestCommand(input);
   try{return privateResult(await authorized(credential,external,async(args,_actor,signal)=>{
    const value=await database('SELECT crest_commands.lookup_source_export_request_resolution($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result',[...args,JSON.stringify(original)],signal);require(!signal.aborted);return parseExportRequestResolution(value,original);
   }));}catch{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_READ_FAILED');}
  },
  toJSON():never{throw new SourceExportOwnerAccessError('SOURCE_EXPORT_ACCESS_PRIVATE');}
 });
}
