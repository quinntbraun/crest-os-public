import 'server-only';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class RequestProtectionError extends Error{
  constructor(){super('REQUEST_PROTECTION_FAILED');this.name='RequestProtectionError';}
}
function hash(token:string,sessionId:string):Buffer{
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||Buffer.from(token,'base64url').toString('base64url')!==token
    ||typeof sessionId!=='string'||!uuid.test(sessionId))throw new RequestProtectionError();
  return createHash('sha256').update('crest.csrf.session.v1\0').update(sessionId).update('\0').update(token).digest();
}
class CsrfToken{
  #token:string;#hash:Buffer;
  constructor(sessionId:string){this.#token=randomBytes(32).toString('base64url');this.#hash=hash(this.#token,sessionId);Object.freeze(this);}
  tokenForResponse(){return this.#token;}
  hashForDatabase(){return Buffer.from(this.#hash);}
  toJSON():never{throw new RequestProtectionError();}
}
export function createCsrfToken(sessionId:string){return new CsrfToken(sessionId);}
export function createRequestProtection(config:{origin:string;environment:'production'|'test'}){
  let origin:string;
  try{
    const url=new URL(config.origin);
    if(!['production','test'].includes(config.environment)||url.origin!==config.origin||url.username||url.password
      ||!(url.protocol==='https:'||config.environment==='test'&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw new Error();
    origin=url.origin;
  }catch{throw new Error('REQUEST_ORIGIN_CONFIGURATION_REQUIRED');}
  return (request:Pick<Request,'method'|'headers'>,sessionId:string,storedHash:Uint8Array):void=>{
    try{
      if(!['POST','PATCH'].includes(request.method)||request.headers.get('origin')!==origin
        ||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'
        ||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')
        ||!(storedHash instanceof Uint8Array)||storedHash.byteLength!==32)throw new RequestProtectionError();
      const actual=hash(request.headers.get('x-crest-csrf')??'',sessionId);
      try{if(!timingSafeEqual(actual,storedHash))throw new RequestProtectionError();}finally{actual.fill(0);}
    }catch{throw new RequestProtectionError();}
  };
}
