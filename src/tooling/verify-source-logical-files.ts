import {createHash} from 'node:crypto';
// Independent decoder: no formatter, collector, database or provider import.
// Every physical and logical descriptor is checked before releasing any file.
export class SourceLogicalFileVerificationError extends Error{constructor(){super('SOURCE_LOGICAL_FILE_VERIFICATION_REQUIRED');this.name='SourceLogicalFileVerificationError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceLogicalFileVerificationError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const integer=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=max;
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function verifySourceLogicalFiles(manifestText:unknown,physical:unknown,expected:Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>){
 try{
  const binding=object(expected,['businessId','generationId','appReleaseId','sourceSchemaVersion']);require(uuid(binding.businessId)&&uuid(binding.generationId)&&typeof binding.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&binding.sourceSchemaVersion===43);
  require(typeof manifestText==='string'&&manifestText.length>=1&&manifestText.length<=4194304&&Buffer.byteLength(manifestText)<=4194304&&Buffer.from(manifestText).toString('utf8')===manifestText&&!manifestText.includes('\0'));
  const m=object(JSON.parse(manifestText),['formatVersion','profile','businessId','generationId','appReleaseId','sourceSchemaVersion','assurance','completePortableExport','completeBackup','totalBytes','files']);
  // Reject duplicate/noncanonical envelope keys, including aliases that ordinary
  // JSON.parse would silently collapse. The proposed formatter has one encoding.
  require(JSON.stringify(m)+'\n'===manifestText&&m.formatVersion===1&&m.profile==='crest.source-logical-files.v1'&&Object.entries(binding).every(([k,v])=>m[k]===v)&&m.assurance==='byte_consistency_only'&&m.completePortableExport===false&&m.completeBackup===false&&integer(m.totalBytes,67108864)&&Array.isArray(m.files)&&m.files.length>=1&&m.files.length<=1024&&Array.isArray(physical)&&physical.length>=1&&physical.length<=1024);
  const supplied=new Map<string,Record<string,unknown>>();let suppliedBytes=0;
  for(const value of physical){const p=object(value,['name','contentType','content','bytes','sha256']);require(typeof p.name==='string'&&!supplied.has(p.name)&&p.contentType==='text/plain; charset=utf-8'&&integer(p.bytes,4194304)&&digest(p.sha256)&&typeof p.content==='string'&&p.content.length>=1&&p.content.length<=4194304&&!p.content.includes('\0'));const b=Buffer.from(p.content);require(b.length===p.bytes&&b.toString('utf8')===p.content&&sha(b)===p.sha256);suppliedBytes+=b.length;require(suppliedBytes+Buffer.byteLength(manifestText)<=67108864);supplied.set(p.name,p);}
  const files:{name:string;contentType:string;content:string;bytes:number;sha256:string}[]=[],names=new Set<string>(),used=new Set<string>();let total=0;
  for(const [index,value]of m.files.entries()){
   const f=object(value,['name','contentType','bytes','sha256','parts']);require(typeof f.name==='string'&&/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(f.name)&&!names.has(f.name)&&['text/csv; charset=utf-8','application/json','text/plain; charset=utf-8'].includes(f.contentType as string)&&integer(f.bytes,33554432)&&digest(f.sha256)&&Array.isArray(f.parts)&&f.parts.length>=1&&f.parts.length<=9);names.add(f.name);
   const pieces:Buffer[]=[];let offset=0;
   for(const [partIndex,value]of f.parts.entries()){
    const p=object(value,['name','offsetBytes','bytes','sha256']),name='source_file_'+String(index+1).padStart(4,'0')+'_part_'+String(partIndex+1).padStart(4,'0')+'.txt';require(p.name===name&&!used.has(name)&&p.offsetBytes===offset&&integer(p.bytes,4194304)&&digest(p.sha256));const raw=supplied.get(name);require(raw&&raw.bytes===p.bytes&&raw.sha256===p.sha256);const b=Buffer.from(raw.content as string);offset+=b.length;require(offset<=f.bytes);pieces.push(b);used.add(name);
   }
   require(offset===f.bytes);const b=Buffer.concat(pieces,offset),content=b.toString('utf8');require(sha(b)===f.sha256&&Buffer.from(content).equals(b));total+=offset;require(total+Buffer.byteLength(manifestText)<=67108864);files.push(Object.freeze({name:f.name,contentType:f.contentType as string,content,bytes:offset,sha256:f.sha256 as string}));
  }
  require(used.size===supplied.size&&total===m.totalBytes&&total===suppliedBytes);return Object.freeze({files:Object.freeze(files),totalBytes:total,assurance:'byte_consistency_only' as const,completePortableExport:false as const,completeBackup:false as const});
 }catch{throw new SourceLogicalFileVerificationError();}
}
