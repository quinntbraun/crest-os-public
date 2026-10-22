import 'server-only';
import {sessionCredentialHash} from './session-credential.ts';
import {sessionDatabase} from './session-database.ts';
import {createRequestProtection} from './request-protection.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
type RequestShape=Pick<Request,'method'|'headers'>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class SessionRequestGuardError extends Error{constructor(){super('SESSION_REQUEST_GUARD_FAILED');this.name='SessionRequestGuardError';}}
export function createSessionCsrfVerifier(config:SessionDatabaseConfiguration&{origin:string}){
  const query=sessionDatabase(config),protect=createRequestProtection(config);
  return async function requireSessionCsrf(request:RequestShape,credential:string,signal:AbortSignal){
    protect.requireOrigin(request);const hash=sessionCredentialHash(credential);
    try{
      const state=await query('SELECT crest_commands.browser_csrf_snapshot($1::bytea) AS result',[hash],signal) as {id?:string;hashes?:unknown[]}|null;
      if(!state||typeof state.id!=='string'||!uuid.test(state.id)||!Array.isArray(state.hashes)||!state.hashes.length||state.hashes.length>8)throw new SessionRequestGuardError();
      let matched=false;
      for(const value of state.hashes){
        if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new SessionRequestGuardError();const stored=Buffer.from(value,'base64');
        if(stored.byteLength!==32||stored.toString('base64')!==value){stored.fill(0);throw new SessionRequestGuardError();}
        try{protect(request,state.id,stored);matched=true;}catch{/* test every bounded stored proof */}finally{stored.fill(0);}
      }
      if(!matched||signal.aborted)throw new SessionRequestGuardError();
    }catch{throw new SessionRequestGuardError();}finally{hash.fill(0);}
  };
}
