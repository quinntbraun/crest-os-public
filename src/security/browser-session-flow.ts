import 'server-only';
import {randomUUID} from 'node:crypto';
import {createSessionCredential,sessionCredentialHash} from './session-credential.ts';
import {createCsrfToken,createRequestProtection} from './request-protection.ts';
import {createLoginAdmission,createLoginFingerprinter} from './login-admission.ts';
import {sessionDatabase} from './session-database.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type RequestShape=Pick<Request,'method'|'headers'>;
type LoginInput={email:string;password:string;code:string;trusted:boolean};
export class BrowserSessionError extends Error{
  constructor(){super('BROWSER_SESSION_FAILED');this.name='BrowserSessionError';}
}
class LoginContext{
  #credential:ReturnType<typeof createSessionCredential>;#csrf:ReturnType<typeof createCsrfToken>;
  readonly expiresAt:number;
  constructor(credential:ReturnType<typeof createSessionCredential>,csrf:ReturnType<typeof createCsrfToken>,expiresAt:number){this.#credential=credential;this.#csrf=csrf;this.expiresAt=expiresAt;Object.freeze(this);}
  cookieValueForResponse(){return this.#credential.cookieValueForResponse();}
  csrfTokenForResponse(){return this.#csrf.tokenForResponse();}
  toJSON():never{throw new BrowserSessionError();}
}
class BrowserSession{
  #credential:string;#csrf:ReturnType<typeof createCsrfToken>;
  readonly evidence:Awaited<ReturnType<ReturnType<typeof createSessionLifecycle>['verify']>>;
  constructor(credential:string,csrf:ReturnType<typeof createCsrfToken>,evidence:BrowserSession['evidence']){this.#credential=credential;this.#csrf=csrf;this.evidence=evidence;Object.freeze(this);}
  cookieValueForResponse(){return this.#credential;}
  csrfTokenForResponse(){return this.#csrf.tokenForResponse();}
  toJSON():never{throw new BrowserSessionError();}
}
function optionalHash(credential?:string):Buffer|null{
  if(!credential)return null;try{return sessionCredentialHash(credential);}catch{return null;}
}
function loginInput(value:LoginInput):LoginInput{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4
    ||!['email','password','code','trusted'].every(key=>Object.hasOwn(value,key))
    ||typeof value.email!=='string'||!value.email.trim()||value.email.length>320
    ||typeof value.password!=='string'||!value.password||value.password.length>1024
    ||typeof value.code!=='string'||!/^\d{6}$/.test(value.code)||typeof value.trusted!=='boolean')throw new BrowserSessionError();
  return Object.freeze({...value});
}
export function createBrowserSessionFlow(config:SessionDatabaseConfiguration&{origin:string;loginKey:Uint8Array;owner:{subject:string;factorId:string}},
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const owner=Object.freeze({...config.owner});
  if(!uuid.test(owner.subject)||!uuid.test(owner.factorId))throw new Error('BROWSER_OWNER_CONFIGURATION_REQUIRED');
  const query=sessionDatabase(config),fingerprint=createLoginFingerprinter(config.loginKey),admit=createLoginAdmission(config,config.loginKey);
  const protect=createRequestProtection(config),lifecycle=createSessionLifecycle(config,provider,tokens);
  const clock=(external:AbortSignal)=>AbortSignal.any([external,AbortSignal.timeout(30000)]);
  async function bind(credential:string,csrf:ReturnType<typeof createCsrfToken>,previous:string|undefined,signal:AbortSignal){
    const hash=sessionCredentialHash(credential),old=optionalHash(previous),csrfHash=csrf.hashForDatabase();
    try{
      const result=await query('SELECT crest_commands.bind_browser_session($1::bytea,$2::bytea,$3::bytea) AS result',[hash,csrfHash,old],signal) as {id?:unknown}|null;
      if(!result||typeof result.id!=='string'||!uuid.test(result.id))throw new BrowserSessionError();
    }finally{hash.fill(0);old?.fill(0);csrfHash.fill(0);}
  }
  async function requireSessionCsrf(request:RequestShape,credential:string,signal:AbortSignal){
    protect.requireOrigin(request);const hash=sessionCredentialHash(credential);
    try{
      const state=await query('SELECT crest_commands.browser_csrf_snapshot($1::bytea) AS result',[hash],signal) as {id?:string;hashes?:unknown[]}|null;
      if(!state||typeof state.id!=='string'||!uuid.test(state.id)||!Array.isArray(state.hashes)||!state.hashes.length||state.hashes.length>8)throw new BrowserSessionError();
      let matched=false;
      for(const value of state.hashes){
        if(typeof value!=='string')throw new BrowserSessionError();const stored=Buffer.from(value,'base64');
        try{protect(request,state.id,stored);matched=true;}catch{/* test every bounded stored proof */}finally{stored.fill(0);}
      }
      if(!matched)throw new BrowserSessionError();
    }finally{hash.fill(0);}
  }
  return Object.freeze({
    async beginLogin(request:RequestShape,address:string,external:AbortSignal,previous?:string):Promise<LoginContext>{
      const signal=clock(external);let values:Buffer[]=[];let hash:Buffer|undefined;const old=optionalHash(previous);
      try{
        protect.requireOrigin(request);if(signal.aborted)throw new BrowserSessionError();
        values=fingerprint('login-context',address).parametersForDatabase();const id=randomUUID(),credential=createSessionCredential(),csrf=createCsrfToken(id,'login');hash=credential.hashForDatabase();
        const result=await query('SELECT crest_commands.create_login_context($1::uuid,$2::bytea,$3::bytea,$4::bytea,$5::bytea,$6::bytea) AS result',
          [id,hash,values[1],csrf.hashForDatabase(),values[2],old],signal) as {id?:string;expiresAt?:number}|null;
        if(!result||result.id!==id||!Number.isSafeInteger(result.expiresAt))throw new BrowserSessionError();
        return new LoginContext(credential,csrf,result.expiresAt!);
      }catch{throw new BrowserSessionError();}finally{hash?.fill(0);old?.fill(0);for(const value of values)value.fill(0);}
    },
    async login(request:RequestShape,address:string,pendingCredential:string,input:LoginInput,external:AbortSignal,previous?:string):Promise<BrowserSession>{
      const signal=clock(external);let values:Buffer[]=[];let hash:Buffer|undefined;let issued:Awaited<ReturnType<typeof lifecycle.login>>|undefined;
      try{
        protect.requireOrigin(request);input=loginInput(input);values=fingerprint(input.email,address).parametersForDatabase();hash=sessionCredentialHash(pendingCredential);
        const context=await query('SELECT crest_commands.login_context_snapshot($1::bytea,$2::bytea) AS result',[hash,values[1]],signal) as {id?:string;csrfHash?:string}|null;
        if(!context||typeof context.id!=='string'||!uuid.test(context.id)||typeof context.csrfHash!=='string')throw new BrowserSessionError();
        const stored=Buffer.from(context.csrfHash,'base64');
        try{
          protect(request,context.id,stored,'login');
          if(await query('SELECT crest_commands.consume_login_context($1::bytea,$2::bytea,$3::bytea) AS result',[hash,values[1],stored],signal)!==true)throw new BrowserSessionError();
        }finally{stored.fill(0);}
        if(await admit(input.email,address,signal)!==true)throw new BrowserSessionError();
        issued=await lifecycle.login({email:input.email,password:input.password,code:input.code,factorId:owner.factorId},{subject:owner.subject},input.trusted,signal);
        const csrf=createCsrfToken(issued.evidence.sessionId),credential=issued.cookieValueForResponse();await bind(credential,csrf,previous,signal);
        return new BrowserSession(credential,csrf,await lifecycle.verify(credential,signal));
      }catch{
        if(issued)try{await lifecycle.logout(issued.cookieValueForResponse(),AbortSignal.timeout(4000));}catch{/* no unverified credential handoff */}
        throw new BrowserSessionError();
      }finally{hash?.fill(0);for(const value of values)value.fill(0);}
    },
    async session(request:RequestShape,credential:string,external:AbortSignal):Promise<BrowserSession>{
      const signal=clock(external);
      try{
        protect.requireOrigin(request);
        const first=await lifecycle.verify(credential,signal),csrf=createCsrfToken(first.sessionId);await bind(credential,csrf,undefined,signal);
        return new BrowserSession(credential,csrf,await lifecycle.verify(credential,signal));
      }catch{throw new BrowserSessionError();}
    },
    async logout(request:RequestShape,credential:string,external:AbortSignal){
      const signal=clock(external);
      try{await requireSessionCsrf(request,credential,signal);return await lifecycle.logout(credential,signal);}catch{throw new BrowserSessionError();}
    }
  });
}
