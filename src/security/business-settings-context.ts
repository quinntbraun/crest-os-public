import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Context=Readonly<{schemaVersion:1;businessId:string;legalName:string;businessVersion:string}&
  ({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
export class BusinessSettingsContextError extends Error{constructor(){super('BUSINESS_SETTINGS_CONTEXT_FAILED');this.name='BusinessSettingsContextError';}}
class SettingsContext{
  #value:Context;
  constructor(value:Context){this.#value=Object.freeze({...value});Object.freeze(this);}
  // Snapshot for review of a new edit, never reusable authority or permission
  // to replace an older operation's pinned epoch/version. Reauthorize writes.
  forServer():Context{return this.#value;}
  toJSON():never{throw new BusinessSettingsContextError();}
}
export function createBusinessSettingsContextReader(config:SessionDatabaseConfiguration,
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const query=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  return async(credential:string,businessId:string,external:AbortSignal)=>{
    let hash:Buffer|undefined;
    try{
      if(typeof businessId!=='string'||!uuid.test(businessId)||external.aborted)throw new BusinessSettingsContextError();
      const requestedBusiness=businessId,signal=AbortSignal.any([external,AbortSignal.timeout(25000)]);
      hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,signal,'background',false);
      if(signal.aborted)throw new BusinessSettingsContextError();
      const value=await query('SELECT crest_commands.read_business_settings_context($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid) AS result',
        [hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),requestedBusiness],signal);
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==6
        ||!['schemaVersion','businessId','legalName','businessVersion','writeState','recoveryEpoch'].every(key=>Object.hasOwn(value,key)))throw new BusinessSettingsContextError();
      const current=value as Context;
      if(current.schemaVersion!==1||current.businessId!==requestedBusiness||typeof current.legalName!=='string'||!current.legalName.replace(/^ +| +$/g,'')
        ||current.legalName.length>400||[...current.legalName].length>200||[...current.legalName].some(c=>{const n=c.codePointAt(0)??0;return n===0||n>=0xd800&&n<=0xdfff;})
        ||typeof current.businessVersion!=='string'||!/^[1-9][0-9]{0,18}$/.test(current.businessVersion)||BigInt(current.businessVersion)>9223372036854775807n
        ||!(current.writeState==='ready'&&typeof current.recoveryEpoch==='string'&&uuid.test(current.recoveryEpoch)
          ||current.writeState==='paused'&&current.recoveryEpoch===null)||signal.aborted)throw new BusinessSettingsContextError();
      return new SettingsContext(current);
    }catch{throw new BusinessSettingsContextError();}finally{hash?.fill(0);}
  };
}
