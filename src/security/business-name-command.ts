import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,maximum=9223372036854775807n;
type Input={schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;expectedVersion:string;legalName:string};
type Receipt=Readonly<{schemaVersion:1;businessId:string;businessVersion:string;auditEventId:string}>;
type Result=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}|
  {state:'conflict';reason:'operation'}|{state:'conflict';reason:'version';currentVersion:string}>;
type Code='BUSINESS_RENAME_INPUT_REQUIRED'|'BUSINESS_RENAME_NOT_SUBMITTED'|'BUSINESS_RENAME_DENIED'|'RECOVERY_REVIEW_REQUIRED'|'BUSINESS_RENAME_OUTCOME_UNKNOWN'|'BUSINESS_RENAME_RESULT_PRIVATE';
export class BusinessNameCommandError extends Error{constructor(code:Code){super(code);this.name='BusinessNameCommandError';}}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function version(value:unknown):value is string{return typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=maximum;}
class CommandResult{
  #value:Result;
  constructor(value:Result){this.#value=Object.freeze(value);Object.freeze(this);}
  forServer():Result{return this.#value;}
  toJSON():never{throw new BusinessNameCommandError('BUSINESS_RENAME_RESULT_PRIVATE');}
}
export function createBusinessNameCommand(config:SessionDatabaseConfiguration,
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  return async(credential:string,input:Input,external:AbortSignal)=>{
    let hash:Buffer|undefined,submitted=false;
    try{
      if(!exact(input,['schemaVersion','businessId','operationId','recoveryEpoch','expectedVersion','legalName'])||input.schemaVersion!==1
        ||typeof input.businessId!=='string'||!uuid.test(input.businessId)||typeof input.operationId!=='string'||!uuid.test(input.operationId)
        ||typeof input.recoveryEpoch!=='string'||!uuid.test(input.recoveryEpoch)||!version(input.expectedVersion)
        ||typeof input.legalName!=='string'||input.legalName.length>400||[...input.legalName].length>200||!input.legalName.replace(/^ +| +$/g,'')
        ||[...input.legalName].some(c=>{const point=c.codePointAt(0)??0;return point===0||point>=0xd800&&point<=0xdfff;}))throw new BusinessNameCommandError('BUSINESS_RENAME_INPUT_REQUIRED');
      const request=Object.freeze({...input}),signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);
      if(signal.aborted)throw new BusinessNameCommandError('BUSINESS_RENAME_NOT_SUBMITTED');
      hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,signal,'background',false),credentialHash=hash;
      if(signal.aborted)throw new BusinessNameCommandError('BUSINESS_RENAME_NOT_SUBMITTED');
      submitted=true;
      // The fixed SQL routine takes its own typed authorization/root locks.
      // Do not wrap it in the generic SHARE-root mutation fence first.
      const outcome=await database.commandTransaction(async(query,currentSignal)=>{
        const value=await query('SELECT crest_commands.rename_business($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::bigint,$13::text) AS result',
          [credentialHash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),
            request.businessId,request.recoveryEpoch,request.operationId,request.schemaVersion,request.expectedVersion,request.legalName]);
        if(currentSignal.aborted)throw new Error();
        if(exact(value,['state'])&&value.state==='denied')return null;
        if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return new CommandResult({state:'conflict',reason:'operation'});
        if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&version(value.currentVersion))
          return new CommandResult({state:'conflict',reason:'version',currentVersion:value.currentVersion});
        if(!exact(value,['state','operationId','recoveryEpoch','receipt'])||value.state!=='committed'||value.operationId!==request.operationId
          ||value.recoveryEpoch!==request.recoveryEpoch||!exact(value.receipt,['schemaVersion','businessId','businessVersion','auditEventId']))throw new Error();
        const receipt=value.receipt;
        if(receipt.schemaVersion!==1||receipt.businessId!==request.businessId||!version(receipt.businessVersion)
          ||BigInt(receipt.businessVersion)!==BigInt(request.expectedVersion)+1n||typeof receipt.auditEventId!=='string'||!uuid.test(receipt.auditEventId))throw new Error();
        return new CommandResult({state:'committed',operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,
          receipt:Object.freeze({schemaVersion:1,businessId:request.businessId,businessVersion:receipt.businessVersion,auditEventId:receipt.auditEventId})});
      },signal);
      if(outcome===null)throw new BusinessNameCommandError('BUSINESS_RENAME_DENIED');
      return outcome;
    }catch(error){
      // No automatic retry/new ID/epoch substitution. Unknown submission needs
      // authenticated operation lookup before an identical unchanged-epoch retry.
      if(error instanceof BusinessNameCommandError)throw error;
      if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new BusinessNameCommandError('RECOVERY_REVIEW_REQUIRED');
      throw new BusinessNameCommandError(submitted?'BUSINESS_RENAME_OUTCOME_UNKNOWN':'BUSINESS_RENAME_NOT_SUBMITTED');
    }finally{hash?.fill(0);}
  };
}
