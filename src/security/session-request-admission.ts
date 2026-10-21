import 'server-only';
import {sessionCredentialHash} from './session-credential.ts';
import {sessionDatabase} from './session-database.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';

export class SessionAdmissionError extends Error{
  constructor(){super('SESSION_ADMISSION_FAILED');this.name='SessionAdmissionError';}
}
// Server-selected bucket only. A true result reserves work, never session/tenant authority.
// Keep this autocommit reservation outside provider I/O and domain transactions.
export function createSessionRequestAdmission(config:SessionDatabaseConfiguration){
  const query=sessionDatabase(config);
  return async(credential:string,bucket:'ordinary'|'logout',signal:AbortSignal):Promise<boolean>=>{
    let hash:Buffer|undefined;
    try{
      if(signal.aborted||!['ordinary','logout'].includes(bucket))throw new SessionAdmissionError();
      hash=sessionCredentialHash(credential);
      const result=await query('SELECT crest_commands.admit_session_request($1::bytea,$2::text) AS result',[hash,bucket],signal);
      if(typeof result!=='boolean')throw new SessionAdmissionError();
      return result;
    }catch{throw new SessionAdmissionError();}finally{hash?.fill(0);}
  };
}
