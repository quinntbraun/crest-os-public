import 'server-only';
import {createHash} from 'node:crypto';
import {FlattenedEncrypt,flattenedDecrypt} from 'jose';
import type {FlattenedJWE} from 'jose';

export const maximumExportPartBytes=8*1024*1024;
export const maximumEncryptedExportPartBytes=16*1024*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,keyId=/^[A-Za-z0-9_-]{1,100}$/;
const type='application/vnd.crest.export-part.v1+json',encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const fields=['businessId','actorId','exportJobId','generationId','recoveryEpoch','partId','fileName','contentType'] as const;
export type ExportPartBinding=Readonly<{
 businessId:string;actorId:string;exportJobId:string;generationId:string;recoveryEpoch:string;partId:string;
 fileName:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';
}>;
export type EncryptedExportPart=Readonly<{keyId:string;ciphertext:Uint8Array}>;
export class ExportPartError extends Error{constructor(){super('EXPORT_PART_REVIEW_REQUIRED');this.name='ExportPartError';}}
function require(value:unknown):asserts value{if(!value)throw new ExportPartError();}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function parseExportPartBinding(value:unknown):ExportPartBinding{
 require(exact(value,fields));
 for(const name of fields.slice(0,6))require(typeof value[name]==='string'&&uuid.test(value[name]));
 require(typeof value.fileName==='string'&&/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(value.fileName));
 require(value.contentType===(value.fileName.endsWith('.csv')?'text/csv; charset=utf-8':value.fileName.endsWith('.json')?'application/json':'text/plain; charset=utf-8'));
 return Object.freeze({...value}) as ExportPartBinding;
}
export function exportPartObjectKey(binding:ExportPartBinding):string{
 const b=parseExportPartBinding(binding);return `exports/${b.businessId}/${b.exportJobId}/${b.generationId}/${b.partId}.jwe`;
}
const aad=(b:ExportPartBinding)=>encoder.encode(JSON.stringify(['crest.export-part.v1',...fields.map(f=>b[f])]));
function base64(value:unknown,limit:number):Uint8Array{
 require(typeof value==='string'&&value.length>0&&value.length<=Math.ceil(limit*4/3)+2&&/^[A-Za-z0-9_-]+$/.test(value));
 const bytes=Buffer.from(value,'base64url');require(bytes.length<=limit&&bytes.toString('base64url')===value);return bytes;
}
function parse(bytes:Uint8Array):unknown{
 const text=decoder.decode(bytes),value:unknown=JSON.parse(text);require(JSON.stringify(value)===text);return value;
}
function check(signal:AbortSignal){require(!signal.aborted);}
class DecryptedExportPart{
 #bytes:Buffer|undefined;
 #binding:ExportPartBinding;
 #byteSize:number;
 #sha256:string;
 constructor(bytes:Uint8Array,binding:ExportPartBinding){this.#bytes=Buffer.from(bytes);this.#binding=binding;this.#byteSize=bytes.byteLength;this.#sha256=digest(bytes);Object.freeze(this);}
 // Explicit handoff after independent current download authorization. Never a
 // capability, signed URL or claim that its source/export job is complete.
 metadataForServer(){require(this.#bytes);return Object.freeze({binding:this.#binding,byteSize:this.#byteSize,sha256:this.#sha256});}
 forServer(){require(this.#bytes);return Object.freeze({...this.metadataForServer(),bytes:Buffer.from(this.#bytes)});}
 dispose(){this.#bytes?.fill(0);this.#bytes=undefined;}
 toJSON():never{throw new ExportPartError();}
}
// Standard JOSE flattened JWE, dir/A256GCM. Export keys are trusted separate
// server configuration, not provider-token keys, database rows or remote URLs.
// The encrypted ordinary JSON payload contains content bytes and their digest;
// neither a plaintext checksum nor content is exposed in the JWE AAD/header.
export async function createExportPartCodec(activeKeyId:string,configured:ReadonlyArray<Readonly<{id:string;key:Uint8Array}>>){
 try{
  require(typeof activeKeyId==='string'&&keyId.test(activeKeyId)&&Array.isArray(configured)&&configured.length>=1&&configured.length<=16);
  for(const entry of configured)require(exact(entry,['id','key'])&&typeof entry.id==='string'&&keyId.test(entry.id)&&entry.key instanceof Uint8Array&&entry.key.byteLength===32);
  const copies=configured.map(entry=>({id:entry.id,key:new Uint8Array(entry.key)}));
  const keys=new Map<string,CryptoKey>();
  try{for(const entry of copies){require(!keys.has(entry.id));keys.set(entry.id,await crypto.subtle.importKey('raw',entry.key,{name:'AES-GCM'},false,['encrypt','decrypt']));}}
  finally{for(const entry of copies)entry.key.fill(0);}
  const active=keys.get(activeKeyId);require(active);
  return Object.freeze({
   async encrypt(source:Uint8Array,rawBinding:ExportPartBinding,signal:AbortSignal):Promise<EncryptedExportPart>{
    let bytes:Buffer|undefined,payload:Uint8Array|undefined;
    try{
     check(signal);const binding=parseExportPartBinding(rawBinding);require(source instanceof Uint8Array&&source.byteLength>=1&&source.byteLength<=maximumExportPartBytes);bytes=Buffer.from(source);
     payload=encoder.encode(JSON.stringify({schemaVersion:1,byteSize:bytes.length,sha256:digest(bytes),content:bytes.toString('base64url')}));
     const value=await new FlattenedEncrypt(payload).setProtectedHeader({alg:'dir',enc:'A256GCM',kid:activeKeyId,typ:type}).setAdditionalAuthenticatedData(aad(binding)).encrypt(active);
     check(signal);const ciphertext=encoder.encode(JSON.stringify(value));require(ciphertext.byteLength<=maximumEncryptedExportPartBytes);
     return Object.freeze({keyId:activeKeyId,ciphertext});
    }catch{throw new ExportPartError();}
    finally{bytes?.fill(0);payload?.fill(0);}
   },
   async decrypt(record:EncryptedExportPart,rawBinding:ExportPartBinding,signal:AbortSignal):Promise<DecryptedExportPart>{
    let plaintext:Uint8Array|undefined,bytes:Uint8Array|undefined;
    try{
     check(signal);const binding=parseExportPartBinding(rawBinding);require(exact(record,['keyId','ciphertext'])&&typeof record.keyId==='string'&&keyId.test(record.keyId)&&record.ciphertext instanceof Uint8Array&&record.ciphertext.byteLength>0&&record.ciphertext.byteLength<=maximumEncryptedExportPartBytes);
     const id=record.keyId,value=parse(new Uint8Array(record.ciphertext));require(exact(value,['protected','aad','iv','ciphertext','tag']));
     const header=parse(base64(value.protected,512));require(exact(header,['alg','enc','kid','typ'])&&header.alg==='dir'&&header.enc==='A256GCM'&&header.kid===id&&header.typ===type);
     require(Buffer.compare(base64(value.aad,2048),aad(binding))===0&&base64(value.iv,12).byteLength===12&&base64(value.tag,16).byteLength===16);
     base64(value.ciphertext,12*1024*1024);const key=keys.get(id);require(key);
     const opened=await flattenedDecrypt(value as unknown as FlattenedJWE,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
     plaintext=opened.plaintext;check(signal);const payload=parse(plaintext);
     require(exact(payload,['schemaVersion','byteSize','sha256','content'])&&payload.schemaVersion===1&&typeof payload.byteSize==='number'&&Number.isSafeInteger(payload.byteSize)&&payload.byteSize>=1&&payload.byteSize<=maximumExportPartBytes&&typeof payload.sha256==='string'&&/^[a-f0-9]{64}$/.test(payload.sha256));
     bytes=base64(payload.content,maximumExportPartBytes);require(bytes.length===payload.byteSize&&digest(bytes)===payload.sha256);check(signal);
     return new DecryptedExportPart(bytes,binding);
    }catch{throw new ExportPartError();}
    finally{plaintext?.fill(0);bytes?.fill(0);}
   }
  });
 }catch{throw new ExportPartError();}
}
