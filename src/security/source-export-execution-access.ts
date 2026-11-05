import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseSourceExportCommand} from './source-export-job-contract.ts';
import {parseSourceExportAdmission} from './source-export-admission.ts';
import type {SourceExportCommand,SourceExportJob} from './source-export-job-contract.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';
type RequestCommand=Extract<SourceExportCommand,{commandType:'export.request'}>;
type Work=Readonly<{command:RequestCommand;job:SourceExportJob}>;
type Code='SOURCE_EXPORT_EXECUTION_INPUT_REQUIRED'|'SOURCE_EXPORT_EXECUTION_NOT_SUBMITTED'|'SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN'|'SOURCE_EXPORT_EXECUTION_PRIVATE'|'SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED'|'RECOVERY_REVIEW_REQUIRED';
export class SourceExportExecutionAccessError extends Error{constructor(code:Code){super(code);this.name='SourceExportExecutionAccessError';}}
const admissions=new WeakMap<object,Work>();
const privateFailure=():never=>{throw new SourceExportExecutionAccessError('SOURCE_EXPORT_EXECUTION_PRIVATE');};
// Scheduling permission only, consumed before work. No cookie/key/credential,
// claim/lease or storage authority follows from this object or its receipt.
export function consumeSourceExportExecutionAdmission(input:unknown,signal:AbortSignal):Work{
 if(input===null||typeof input!=='object')throw new SourceExportExecutionAccessError('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');
 const work=admissions.get(input);admissions.delete(input);
 if(!work||signal.aborted)throw new SourceExportExecutionAccessError('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');
 return work;
}
// Unregistered migration44 construction. No route/task manager is enabled.
// Only a resolved COMMIT from the fresh database branch can mint scheduling
// permission. Original lookup/JSON/replayed responses cannot recreate it.
export function createSourceExportExecutionAccess(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>,businessId:string,appReleaseId:string){
 if(!uuid(businessId)||typeof appReleaseId!=='string'||!/^[a-f0-9]{40}$/.test(appReleaseId))throw new SourceExportExecutionAccessError('SOURCE_EXPORT_EXECUTION_INPUT_REQUIRED');
 const scope=businessId,release=appReleaseId,database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 function request(input:unknown):RequestCommand{
  try{const command=parseSourceExportCommand(input);if(command.commandType!=='export.request'||command.businessId!==scope||command.reference.appReleaseId!==release)throw Error();return command;}
  catch{throw new SourceExportExecutionAccessError('SOURCE_EXPORT_EXECUTION_INPUT_REQUIRED');}
 }
 return Object.freeze({
  async request(credential:string,input:unknown,external:AbortSignal){
   const command=request(input),reference=command.reference,signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);let submitted=false,hash:Buffer|undefined;
   try{
    if(signal.aborted)throw Error();hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,signal,'background',true);if(signal.aborted)throw Error();
    const admission=await database.commandTransaction(async(query,current)=>{
     if(current.aborted)throw Error();submitted=true;
     const value=await query('SELECT crest_commands.request_source_export_for_execution($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::text) AS result',[hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),scope,reference.recoveryEpoch,reference.operationId,reference.exportJobId,release]);
     if(current.aborted)throw Error();return parseSourceExportAdmission(value,command,verified.actorId);
    },signal);
    if(signal.aborted)throw Error();
    if(admission.state==='conflict')return Object.freeze({state:admission.state,forServer:()=>admission,toJSON:privateFailure});
    const result=admission.result,output=Object.freeze({state:admission.state,forServer:()=>result,toJSON:privateFailure});
    if(admission.state==='created')admissions.set(output,Object.freeze({command,job:result.receipt.job}));
    return output;
   }catch(error){
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new SourceExportExecutionAccessError('RECOVERY_REVIEW_REQUIRED');
    throw new SourceExportExecutionAccessError(submitted?'SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN':'SOURCE_EXPORT_EXECUTION_NOT_SUBMITTED');
   }finally{hash?.fill(0);}
  },
  toJSON:privateFailure
 });
}
