import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Context=Readonly<{actorId:string;businessId:string;currency:'USD';timezone:string}>;
export class TenantReadError extends Error{constructor(){super('TENANT_READ_FAILED');this.name='TenantReadError';}}
class BusinessContext{
  #value:Context;
  constructor(value:Context){this.#value=Object.freeze({...value});Object.freeze(this);}
  // Data read at one point in time, never authority for another SQL statement,
  // mutation, sensitive export or a later request. Reauthorize each operation.
  forServer():Context{return this.#value;}
  toJSON():never{throw new TenantReadError();}
}
export function createTenantContextReader(config:SessionDatabaseConfiguration,
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const query=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  return async(credential:string,businessId:string,external:AbortSignal)=>{
    let hash:Buffer|undefined;
    try{
      if(typeof businessId!=='string'||!uuid.test(businessId)||external.aborted)throw new TenantReadError();
      hash=sessionCredentialHash(credential);const signal=AbortSignal.any([external,AbortSignal.timeout(25000)]);
      // Fresh real provider signature/live-session and local eligibility first.
      const verified=await sessions.verify(credential,signal,'background',false);
      const value=await query('SELECT crest_commands.read_authorized_business_context($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid) AS result',
        [hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],signal);
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4)throw new TenantReadError();
      const current=value as Context;
      if(current.actorId!==verified.actorId||current.businessId!==businessId||current.currency!=='USD'||typeof current.timezone!=='string'||current.timezone.length<1||current.timezone.length>100||signal.aborted)throw new TenantReadError();
      return new BusinessContext(current);
    }catch{throw new TenantReadError();}finally{hash?.fill(0);}
  };
}
