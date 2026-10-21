import 'server-only';
import {createHash,createHmac,createSecretKey} from 'node:crypto';
import {isIP} from 'node:net';
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
function ip(value:string):string{
  if(typeof value!=='string'||value.length>45)throw new LoginAdmissionError();
  if(isIP(value)===4)return value;
  if(isIP(value)!==6)throw new LoginAdmissionError();
  const canonical=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const mapped=/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if(!mapped)return canonical;
  const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);
  return [high>>>8,high&255,low>>>8,low&255].join('.');
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
        createHmac('sha256',key).update('crest.login.ip.v1\0').update(ip(address)).digest(),Buffer.from(fingerprint)
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
