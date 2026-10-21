import 'server-only';
import { createHash,randomBytes } from 'node:crypto';

export class SessionCredentialError extends Error {
  constructor(){super('SESSION_CREDENTIAL_INVALID');this.name='SessionCredentialError';}
}
export function sessionCredentialHash(credential:string):Buffer {
  if(typeof credential!=='string'||!/^[-A-Za-z0-9_]{43}$/.test(credential))throw new SessionCredentialError();
  const bytes=Buffer.from(credential,'base64url');
  if(bytes.length!==32||bytes.toString('base64url')!==credential)throw new SessionCredentialError();
  // Hash exactly the canonical opaque cookie value, never an identity claim.
  return createHash('sha256').update(credential,'ascii').digest();
}
class SessionCredential {
  #value:string;
  constructor(){this.#value=randomBytes(32).toString('base64url');Object.freeze(this);}
  cookieValueForResponse():string{return this.#value;}
  hashForDatabase():Buffer{return sessionCredentialHash(this.#value);}
  toJSON():never{throw new SessionCredentialError();}
}
// This creates credential material only. It issues no database session/cookie.
export function createSessionCredential(){return new SessionCredential();}
