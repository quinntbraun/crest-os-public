import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const capabilities=['identity.manage','crm.manage','finance.post','export.bulk'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Capability=typeof capabilities[number];
type Context=Readonly<{actorId:string;businessId:string;sessionId:string;recoveryEpoch:string;capability:Capability}>;
type Query=(text:string,values:unknown[])=>Promise<unknown>;
export class MutationBoundaryError extends Error{
  constructor(code:'MUTATION_BOUNDARY_FAILED'|'RECOVERY_REVIEW_REQUIRED'='MUTATION_BOUNDARY_FAILED'){super(code);this.name='MutationBoundaryError';}
}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function transactionScope(query:Query,context:Context,signal:AbortSignal){
  let active=true,pending=0,failed=false;
  const scope=Object.freeze({
    contextForServer:()=>context,
    // Trusted server SQL only; future public domain routines must themselves
    // enforce this fence and their fixed capability before replay or mutation.
    query:(text:string,values:unknown[])=>{
      const work=(async()=>{if(!active||signal.aborted)throw new MutationBoundaryError();pending++;
        try{return await query(text,values);}catch{failed=true;throw new MutationBoundaryError();}finally{pending--;}})();
      void work.catch(()=>undefined);return work;
    },
    toJSON:():never=>{throw new MutationBoundaryError();}
  });
  return {scope,close:()=>{active=false;if(pending!==0||failed)throw new MutationBoundaryError();}};
}
type Scope=ReturnType<typeof transactionScope>['scope'];

// Fixed policy is trusted server configuration, never a browser-selected power.
// This is only a transaction prerequisite: operation/audit/RLS consumers and
// typed domain mutation routines remain mandatory before business writes.
export function createMutationTransaction(config:SessionDatabaseConfiguration,policy:{capability:Capability;requireRecentAuth:boolean},
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  if(!exact(policy,['capability','requireRecentAuth'])||!capabilities.includes(policy.capability)||typeof policy.requireRecentAuth!=='boolean')throw new Error('MUTATION_POLICY_CONFIGURATION_REQUIRED');
  const capability=policy.capability,recent=policy.requireRecentAuth||capability==='export.bulk',query=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  return async<T>(credential:string,input:{businessId:string;recoveryEpoch:string},work:(scope:Scope,signal:AbortSignal)=>Promise<T>,external:AbortSignal):Promise<T>=>{
    let hash:Buffer|undefined;
    try{
      if(!exact(input,['businessId','recoveryEpoch'])||typeof input.businessId!=='string'||!uuid.test(input.businessId)||typeof input.recoveryEpoch!=='string'||!uuid.test(input.recoveryEpoch)||typeof work!=='function'||external.aborted)throw new MutationBoundaryError();
      // Snapshot caller input before awaits; never fetch or substitute a newer epoch.
      const businessId=input.businessId,recoveryEpoch=input.recoveryEpoch,signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);
      hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,signal,'background',recent),credentialHash=hash;
      return await query.commandTransaction(async(transaction,currentSignal)=>{
        const value=await transaction('SELECT crest_commands.lock_mutation_authority($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::boolean) AS result',
          [credentialHash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId,recoveryEpoch,capability,recent]);
        if(!exact(value,['actorId','businessId','sessionId','recoveryEpoch','capability'])||value.actorId!==verified.actorId||value.sessionId!==verified.sessionId||value.businessId!==businessId||value.recoveryEpoch!==recoveryEpoch||value.capability!==capability||currentSignal.aborted)throw new MutationBoundaryError();
        const context=Object.freeze({actorId:verified.actorId,businessId,sessionId:verified.sessionId,recoveryEpoch,capability}),current=transactionScope(transaction,context,currentSignal);
        try{return await work(current.scope,currentSignal);}finally{current.close();}
      },signal);
    }catch(error){throw new MutationBoundaryError(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED'?'RECOVERY_REVIEW_REQUIRED':'MUTATION_BOUNDARY_FAILED');}
    finally{hash?.fill(0);}
  };
}
