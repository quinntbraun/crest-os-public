import "server-only";
import { FlattenedEncrypt, flattenedDecrypt } from "jose";
import type { FlattenedJWE } from "jose";

const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keyId=/^[A-Za-z0-9_-]{1,100}$/;
const type='application/vnd.crest.provider-tokens.v1+json';
const maximumBytes=65536;
export class ProviderTokenStorageError extends Error {
  constructor(){super('PROVIDER_TOKEN_STORAGE_FAILED');this.name='ProviderTokenStorageError';}
}
export type TokenBinding=Readonly<{
  actorId:string;appSessionId:string;providerSessionId:string;securityEpoch:string;subject:string;issuer:string;
}>;
export type ProviderTokens=Readonly<{accessToken:string;refreshToken:string}>;
export type EncryptedProviderTokens=Readonly<{keyId:string;ciphertext:Uint8Array}>;

class DecryptedProviderTokens {
  #tokens:ProviderTokens;
  constructor(tokens:ProviderTokens){this.#tokens=Object.freeze({...tokens});Object.freeze(this);}
  // Explicit server-only handoff. Decryption is not provider/local/tenant authorization.
  tokensForProvider():ProviderTokens{return this.#tokens;}
  toJSON():never{throw new ProviderTokenStorageError();}
}

function exactObject(value:unknown,fields:string[]):asserts value is Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field)))throw new ProviderTokenStorageError();
}
function parse(bytes:Uint8Array):unknown {
  const text=decoder.decode(bytes);const value:unknown=JSON.parse(text);
  // Our storage profile uses ordinary JSON serialization: no duplicate names,
  // alternate whitespace/escapes, or trailing data with ambiguous interpretations.
  if(JSON.stringify(value)!==text)throw new ProviderTokenStorageError();
  return value;
}
function additionalData(binding:TokenBinding):Uint8Array {
  const {actorId,appSessionId,providerSessionId,securityEpoch,subject,issuer}=binding;
  if([actorId,appSessionId,providerSessionId,securityEpoch,subject].some(value=>typeof value!=='string'||!uuid.test(value))
    ||typeof issuer!=='string'||issuer.length>2048)throw new ProviderTokenStorageError();
  const url=new URL(issuer);
  if(url.toString()!==issuer||url.username||url.password||url.search||url.hash||url.pathname!=='/auth/v1'
    ||!(url.protocol==='https:'&&!url.port||url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw new ProviderTokenStorageError();
  // Standard JWE AAD is authenticated, not secret. Only immutable row metadata.
  return encoder.encode(JSON.stringify(['crest.provider-tokens.v1',actorId,appSessionId,providerSessionId,securityEpoch,subject,issuer]));
}
function tokenPayload(value:unknown):ProviderTokens {
  exactObject(value,['accessToken','refreshToken']);
  const {accessToken,refreshToken}=value;
  if(typeof accessToken!=='string'||typeof refreshToken!=='string'
    ||!/^[-A-Za-z0-9._~]{1,16384}$/.test(accessToken)||!/^[-A-Za-z0-9._~]{1,32768}$/.test(refreshToken))throw new ProviderTokenStorageError();
  return Object.freeze({accessToken,refreshToken});
}
function base64(value:unknown):Uint8Array {
  if(typeof value!=='string'||!value||!/^[A-Za-z0-9_-]+$/.test(value))throw new ProviderTokenStorageError();
  const decoded=Buffer.from(value,'base64url');
  if(decoded.toString('base64url')!==value)throw new ProviderTokenStorageError();
  return decoded;
}

// Keys must come from trusted server configuration, separately from database
// backups. There are no defaults, environment reads, remote key URLs or key export.
export async function createProviderTokenStore(activeKeyId:string,configured:ReadonlyArray<Readonly<{id:string;key:Uint8Array}>>) {
  try {
    if(typeof activeKeyId!=='string'||!keyId.test(activeKeyId)||!Array.isArray(configured)||configured.length<1||configured.length>16)throw new ProviderTokenStorageError();
    const copies=configured.map(entry=>{
      if(!entry||typeof entry.id!=='string'||!keyId.test(entry.id)||!(entry.key instanceof Uint8Array)||entry.key.byteLength!==32)throw new ProviderTokenStorageError();
      return {id:entry.id,key:new Uint8Array(entry.key)};
    });
    const keys=new Map<string,CryptoKey>();
    try {
      for(const entry of copies){
        if(keys.has(entry.id))throw new ProviderTokenStorageError();
        keys.set(entry.id,await crypto.subtle.importKey('raw',entry.key,{name:'AES-GCM'},false,['encrypt','decrypt']));
      }
    }finally{for(const entry of copies)entry.key.fill(0);}
    const active=keys.get(activeKeyId);if(!active)throw new ProviderTokenStorageError();
    return Object.freeze({
      async encrypt(tokens:ProviderTokens,binding:TokenBinding):Promise<EncryptedProviderTokens>{
        try {
          const payload=encoder.encode(JSON.stringify(tokenPayload(tokens))),aad=additionalData(binding);
          const jwe=await new FlattenedEncrypt(payload).setProtectedHeader({alg:'dir',enc:'A256GCM',kid:activeKeyId,typ:type})
            .setAdditionalAuthenticatedData(aad).encrypt(active);
          const ciphertext=encoder.encode(JSON.stringify(jwe));
          if(ciphertext.byteLength>maximumBytes)throw new ProviderTokenStorageError();
          return Object.freeze({keyId:activeKeyId,ciphertext});
        }catch{throw new ProviderTokenStorageError();}
      },
      async decrypt(record:EncryptedProviderTokens,binding:TokenBinding):Promise<DecryptedProviderTokens>{
        try {
          const aad=additionalData(binding),id=record.keyId;
          if(typeof id!=='string'||!keyId.test(id)||!(record.ciphertext instanceof Uint8Array)
            ||!record.ciphertext.byteLength||record.ciphertext.byteLength>maximumBytes)throw new ProviderTokenStorageError();
          const jwe=parse(new Uint8Array(record.ciphertext));
          exactObject(jwe,['protected','aad','iv','ciphertext','tag']);
          const header=parse(base64(jwe.protected));exactObject(header,['alg','enc','kid','typ']);
          if(header.alg!=='dir'||header.enc!=='A256GCM'||header.kid!==id||header.typ!==type
            ||Buffer.compare(base64(jwe.aad),aad)!==0||base64(jwe.iv).byteLength!==12||base64(jwe.tag).byteLength!==16)throw new ProviderTokenStorageError();
          base64(jwe.ciphertext);
          const key=keys.get(id);if(!key)throw new ProviderTokenStorageError();
          // All five required string fields were checked by base64 above.
          const result=await flattenedDecrypt(jwe as unknown as FlattenedJWE,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
          return new DecryptedProviderTokens(tokenPayload(parse(result.plaintext)));
        }catch{throw new ProviderTokenStorageError();}
      }
    });
  }catch{throw new ProviderTokenStorageError();}
}
