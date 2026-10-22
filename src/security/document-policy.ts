import 'server-only';
import {randomBytes} from 'node:crypto';

export function createDocumentPolicy(mode:'production'|'development'){
  if(mode!=='production'&&mode!=='development')throw new Error('DOCUMENT_POLICY_CONFIGURATION_REQUIRED');
  const nonce=randomBytes(32).toString('base64');
  const policy=[
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${mode==='development'?" 'unsafe-eval'":''}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "img-src 'self' blob:","font-src 'self'",
    `connect-src 'self'${mode==='development'?' ws: wss:':''}`,
    "object-src 'none'","base-uri 'none'","frame-src 'none'","frame-ancestors 'none'",
    "form-action 'self'","worker-src 'none'","manifest-src 'self'","media-src 'none'"
  ].join('; ');
  return Object.freeze({nonce,policy});
}
export function requireDocumentNonce(headers:Pick<Headers,'get'>):string{
  const nonce=headers.get('x-crest-nonce');
  if(typeof nonce!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(nonce)
    ||Buffer.from(nonce,'base64').toString('base64')!==nonce)throw new Error('DOCUMENT_POLICY_REQUIRED');
  const script=headers.get('content-security-policy')?.split(';').map(value=>value.trim()).find(value=>value.startsWith('script-src '));
  if(!script?.split(/\s+/).includes(`'nonce-${nonce}'`))throw new Error('DOCUMENT_POLICY_REQUIRED');
  return nonce;
}
