import 'server-only';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class RequestProtectionError extends Error{
  constructor(){super('REQUEST_PROTECTION_FAILED');this.name='RequestProtectionError';}
}
function hash(token:string,sessionId:string,purpose:'session'|'login'='session'):Buffer{
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||Buffer.from(token,'base64url').toString('base64url')!==token
    ||typeof sessionId!=='string'||!uuid.test(sessionId)||!['session','login'].includes(purpose))throw new RequestProtectionError();
  return createHash('sha256').update(`crest.csrf.${purpose}.v1\0`).update(sessionId).update('\0').update(token).digest();
}
class CsrfToken{
  #token:string;#hash:Buffer;
  constructor(sessionId:string,purpose:'session'|'login'){this.#token=randomBytes(32).toString('base64url');this.#hash=hash(this.#token,sessionId,purpose);Object.freeze(this);}
  tokenForResponse(){return this.#token;}
  hashForDatabase(){return Buffer.from(this.#hash);}
  toJSON():never{throw new RequestProtectionError();}
}
export function createCsrfToken(sessionId:string,purpose:'session'|'login'='session'){return new CsrfToken(sessionId,purpose);}
export function createRequestProtection(config:{origin:string;environment:'production'|'test'}){
  let origin:string;
  try{
    const url=new URL(config.origin);
    if(!['production','test'].includes(config.environment)||url.origin!==config.origin||url.username||url.password
      ||!(url.protocol==='https:'||config.environment==='test'&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw new Error();
    origin=url.origin;
  }catch{throw new Error('REQUEST_ORIGIN_CONFIGURATION_REQUIRED');}
  const requireOrigin=(request:Pick<Request,'method'|'headers'>):void=>{
    try{
      if(!['POST','PATCH'].includes(request.method)||request.headers.get('origin')!==origin
        ||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'
        ||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new RequestProtectionError();
    }catch{throw new RequestProtectionError();}
  };
  const requireToken=(request:Pick<Request,'method'|'headers'>,sessionId:string,storedHash:Uint8Array,purpose:'session'|'login'='session'):void=>{
    try{
      requireOrigin(request);
      if(!(storedHash instanceof Uint8Array)||storedHash.byteLength!==32)throw new RequestProtectionError();
      const actual=hash(request.headers.get('x-crest-csrf')??'',sessionId,purpose);
      try{if(!timingSafeEqual(actual,storedHash))throw new RequestProtectionError();}finally{actual.fill(0);}
    }catch{throw new RequestProtectionError();}
  };
  return Object.assign(requireToken,{requireOrigin});
}
