import 'server-only';
import {createHash} from 'node:crypto';
import {fileTypes,imageValidationVersion,pdfValidationVersion,heicValidationVersion} from './validation-contract.ts';
import type {FileType,ValidatedFile} from './validation-contract.ts';

type Code='SANDBOX_INPUT_INVALID'|'SANDBOX_UNAVAILABLE'|'SANDBOX_TIMEOUT'|'SANDBOX_ABORTED'|'SANDBOX_EXECUTION_FAILED'
  |'SANDBOX_PROTOCOL_INVALID'|'SANDBOX_CLEANUP_UNCERTAIN'|'SANDBOX_CREATE_UNCERTAIN'|'FILE_QUARANTINED';
export class SandboxValidationError extends Error {
  readonly code:Code;readonly quarantineCode:string|undefined;
  constructor(code:Code,quarantineCode?:string){super(code);this.name='SandboxValidationError';this.code=code;this.quarantineCode=quarantineCode;}
}
export function fail(code:Code):never{throw new SandboxValidationError(code);}
export const fileHash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export function validInput(bytes:Uint8Array,type:string):asserts type is FileType{
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>25*1024*1024||!fileTypes.includes(type as FileType))fail('SANDBOX_INPUT_INVALID');
}
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('SANDBOX_PROTOCOL_INVALID');return v as Record<string,unknown>;};
function keys(v:Record<string,unknown>,expected:string[]){if(Object.keys(v).length!==expected.length||expected.some(k=>!Object.hasOwn(v,k)))fail('SANDBOX_PROTOCOL_INVALID');}
function integer(v:unknown,max:number){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>max)fail('SANDBOX_PROTOCOL_INVALID');return v as number;}
const quarantine=new Set([
  'IMAGE_SIZE_INVALID','IMAGE_FORMAT_UNAVAILABLE','IMAGE_TYPE_MISMATCH','IMAGE_CONTAINER_INVALID','IMAGE_PIXELS_EXCEEDED','IMAGE_ANIMATION_UNSUPPORTED','IMAGE_DECODE_FAILED','IMAGE_WORKER_TIMEOUT','IMAGE_SANDBOX_REQUIRED',
  'PDF_SIZE_INVALID','PDF_CONTAINER_INVALID','PDF_ENCRYPTED','PDF_ACTIVE_CONTENT','PDF_PAGE_LIMIT','PDF_UNINSPECTABLE','PDF_RENDER_FAILED','PDF_TOOLS_UNAVAILABLE','PDF_WORKER_TIMEOUT','PDF_SANDBOX_REQUIRED',
  'HEIC_SIZE_INVALID','HEIC_CONTAINER_INVALID','HEIC_TYPE_MISMATCH','HEIC_FORMAT_UNAVAILABLE','HEIC_PIXEL_LIMIT','HEIC_DECODE_FAILED','HEIC_TOOLS_UNAVAILABLE','HEIC_WORKER_TIMEOUT','HEIC_SANDBOX_REQUIRED']);

// Check transport integrity without decoding any untrusted image in the broker.
export function readValidationReply(stdout:Buffer,exit:number,expected:{type:FileType;byteSize:number;sha256:string}):ValidatedFile{
  if(!fileTypes.includes(expected.type)||!Number.isSafeInteger(expected.byteSize)||expected.byteSize<1||expected.byteSize>25*1024*1024||!/^[a-f0-9]{64}$/.test(expected.sha256))fail('SANDBOX_INPUT_INVALID');
  if(stdout.length>12*1024*1024)fail('SANDBOX_PROTOCOL_INVALID');
  let r:Record<string,unknown>;try{r=record(JSON.parse(stdout.toString('utf8')));}catch{ return fail('SANDBOX_PROTOCOL_INVALID');}
  const pdf=expected.type==='application/pdf',heic=expected.type==='image/heic',prefix=pdf?'PDF_':heic?'HEIC_':'IMAGE_';
  if(r.status==='Quarantined'){
    keys(r,['status','code']);if(exit!==1||typeof r.code!=='string'||!r.code.startsWith(prefix)||!quarantine.has(r.code))fail('SANDBOX_PROTOCOL_INVALID');
    throw new SandboxValidationError('FILE_QUARANTINED',r.code as string);
  }
  keys(r,['status','validationVersion','source','preview']);
  if(exit!==0||r.status!=='Validated'||r.validationVersion!==(pdf?pdfValidationVersion:heic?heicValidationVersion:imageValidationVersion))fail('SANDBOX_PROTOCOL_INVALID');
  const s=record(r.source),p=record(r.preview);
  keys(s,['sha256','byteSize','detectedType',...(pdf?['pageCount']:heic?['width','height','displayWidth','displayHeight','bitDepth']:['width','height'])]);
  if(s.sha256!==expected.sha256||s.byteSize!==expected.byteSize||s.detectedType!==expected.type)fail('SANDBOX_PROTOCOL_INVALID');
  if(pdf)integer(s.pageCount,100);else{
    if(integer(s.width,60_000_000)*integer(s.height,60_000_000)>60_000_000)fail('SANDBOX_PROTOCOL_INVALID');
    if(heic&&(integer(s.displayWidth,60_000_000)*integer(s.displayHeight,60_000_000)>60_000_000||integer(s.bitDepth,16)<8))fail('SANDBOX_PROTOCOL_INVALID');
  }
  keys(p,['bytes','sha256','byteSize','contentType','width','height',...(pdf?['pageNumber']:[])]);
  const width=integer(p.width,2048),height=integer(p.height,2048),size=integer(p.byteSize,8*1024*1024);
  if(p.contentType!=='image/jpeg'||typeof p.bytes!=='string'||p.bytes.length>Math.ceil(size/3)*4||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||pdf&&p.pageNumber!==1)fail('SANDBOX_PROTOCOL_INVALID');
  const encoded=p.bytes as string,previewHash=p.sha256 as string;
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==size||bytes.toString('base64')!==p.bytes||fileHash(bytes)!==p.sha256||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('SANDBOX_PROTOCOL_INVALID');
  return {validationVersion:r.validationVersion as string,source:s as ValidatedFile['source'],preview:{bytes,sha256:previewHash,byteSize:size,contentType:'image/jpeg',width,height,...(pdf?{pageNumber:1}:{})}};
}
