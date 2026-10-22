import 'server-only';
import {createHash,createHmac,createSecretKey} from 'node:crypto';
import {normalizeClientAddress} from './client-address.ts';
import {sessionDatabase} from './session-database.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';

export class LoginAdmissionError extends Error{
  constructor(){super('LOGIN_ADMISSION_FAILED');this.name='LoginAdmissionError';}
}
function identifier(value:string):string{
  if(typeof value!=='string'||value.length>320)throw new LoginAdmissionError();
  const normalized=value.trim().toLowerCase();
  if(!normalized||normalized.length>320||/\s/u.test(normalized)
    ||Array.from(normalized).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))throw new LoginAdmissionError();
  return normalized;
}
class LoginFingerprints{
  #parameters:Buffer[];
  constructor(parameters:Buffer[]){this.#parameters=parameters;Object.freeze(this);}
  parametersForDatabase(){return this.#parameters.map(value=>Buffer.from(value));}
  toJSON():never{throw new LoginAdmissionError();}
}
// Trusted server key only. Never derive the client IP from untrusted headers here.
export function createLoginFingerprinter(bytes:Uint8Array){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==32)throw new Error('LOGIN_KEY_CONFIGURATION_REQUIRED');
  const copy=Buffer.from(bytes),key=createSecretKey(copy);
  const fingerprint=createHash('sha256').update('crest.login.key.v1\0').update(copy).digest();copy.fill(0);
  return (email:string,address:string):LoginFingerprints=>{
    try{
      return new LoginFingerprints([
        createHmac('sha256',key).update('crest.login.identifier.v1\0').update(identifier(email)).digest(),
        createHmac('sha256',key).update('crest.login.ip.v1\0').update(normalizeClientAddress(address)).digest(),Buffer.from(fingerprint)
      ]);
    }catch{throw new LoginAdmissionError();}
  };
}
export function createLoginAdmission(config:SessionDatabaseConfiguration,key:Uint8Array){
  const query=sessionDatabase(config),fingerprint=createLoginFingerprinter(key);
  return async(email:string,address:string,signal:AbortSignal):Promise<boolean>=>{
    let parameters:Buffer[]=[];
    try{
      if(signal.aborted)throw new LoginAdmissionError();
      parameters=fingerprint(email,address).parametersForDatabase();
      const result=await query('SELECT crest_commands.admit_login($1::bytea,$2::bytea,$3::bytea) AS result',parameters,signal);
      if(typeof result!=='boolean')throw new LoginAdmissionError();
      return result;
    }catch{throw new LoginAdmissionError();}finally{for(const value of parameters)value.fill(0);}
  };
}
