import 'server-only';
import {createProviderBoundary} from '../security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../security/provider-session-db.ts';
import {createProviderTokenStore} from '../security/provider-token-store.ts';
import type {AuthenticationConfiguration} from './node-server.ts';

type Configuration={
  database:Parameters<typeof createLiveProviderSessionLookup>[0];
  provider:Parameters<typeof createProviderBoundary>[0];
  loginKey:Uint8Array;owner:{subject:string;factorId:string};
  ingress:AuthenticationConfiguration['configuration']['ingress'];
  activeKeyId:string;keys:Parameters<typeof createProviderTokenStore>[1];
};
class AuthenticationRuntime{
  #configuration:AuthenticationConfiguration;
  constructor(configuration:AuthenticationConfiguration){this.#configuration=configuration;Object.freeze(this);}
  forServer():AuthenticationConfiguration{return this.#configuration;}
  toJSON():never{throw new Error('AUTHENTICATION_RUNTIME_PRIVATE');}
}
// Explicit trusted server configuration only: no environment activation switch,
// account provisioning, browser-selected owner, or default keys/credentials.
export async function createAuthenticationRuntime(config:Configuration){
  try{
    if(config.database.environment!==config.provider.environment||!(config.loginKey instanceof Uint8Array)||config.loginKey.byteLength!==32
      ||![config.owner.subject,config.owner.factorId].every(value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)))throw new Error();
    const provider=createProviderBoundary({...config.provider},createLiveProviderSessionLookup({...config.database}));
    const ingress=config.ingress.kind==='direct'?Object.freeze({kind:'direct' as const}):Object.freeze({kind:'proxy' as const,peers:Object.freeze([...config.ingress.peers])});
    const configuration=Object.freeze({...config.database,loginKey:new Uint8Array(config.loginKey),owner:Object.freeze({...config.owner}),ingress});
    const tokens=await createProviderTokenStore(config.activeKeyId,config.keys);
    return new AuthenticationRuntime(Object.freeze({configuration,provider,tokens}));
  }catch{throw new Error('AUTHENTICATION_RUNTIME_CONFIGURATION_REQUIRED');}
}
