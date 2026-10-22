import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Receipt=Readonly<{schemaVersion:1;businessId:string;businessVersion:string;auditEventId:string}>;
type Result=Readonly<{state:'absent'}|{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
export class BusinessOperationLookupError extends Error{constructor(){super('BUSINESS_OPERATION_LOOKUP_FAILED');this.name='BusinessOperationLookupError';}}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
class LookupResult{
  #value:Result;
  constructor(value:Result){this.#value=Object.freeze(value);Object.freeze(this);}
  // Point-in-time evidence. Absence does not prove an in-flight command failed;
  // a historical epoch must never replace a pending command's expected epoch.
  forServer():Result{return this.#value;}
  toJSON():never{throw new BusinessOperationLookupError();}
}
export function createBusinessOperationLookup(config:SessionDatabaseConfiguration,
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const query=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  return async(credential:string,input:{businessId:string;operationId:string},external:AbortSignal)=>{
    let hash:Buffer|undefined;
    try{
      if(!exact(input,['businessId','operationId'])||typeof input.businessId!=='string'||!uuid.test(input.businessId)
        ||typeof input.operationId!=='string'||!uuid.test(input.operationId)||external.aborted)throw new BusinessOperationLookupError();
      const businessId=input.businessId,operationId=input.operationId,signal=AbortSignal.any([external,AbortSignal.timeout(25000)]);
      hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,signal,'background',false);
      const value=await query('SELECT crest_commands.lookup_business_name_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',
        [hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId,operationId],signal);
      if(signal.aborted)throw new BusinessOperationLookupError();
      if(exact(value,['state'])&&value.state==='absent')return new LookupResult({state:'absent'});
      if(!exact(value,['state','operationId','recoveryEpoch','receipt'])||value.state!=='committed'||value.operationId!==operationId
        ||typeof value.recoveryEpoch!=='string'||!uuid.test(value.recoveryEpoch)||!exact(value.receipt,['schemaVersion','businessId','businessVersion','auditEventId']))throw new BusinessOperationLookupError();
      const receipt=value.receipt;
      if(receipt.schemaVersion!==1||receipt.businessId!==businessId||typeof receipt.businessVersion!=='string'
        ||!/^[1-9][0-9]{0,18}$/.test(receipt.businessVersion)||BigInt(receipt.businessVersion)>9223372036854775807n
        ||typeof receipt.auditEventId!=='string'||!uuid.test(receipt.auditEventId))throw new BusinessOperationLookupError();
      return new LookupResult({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,
        receipt:Object.freeze({schemaVersion:1,businessId,businessVersion:receipt.businessVersion,auditEventId:receipt.auditEventId})});
    }catch{throw new BusinessOperationLookupError();}finally{hash?.fill(0);}
  };
}
