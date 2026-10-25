import 'server-only';
import type {createPrivateObjectStore} from './private-object-store.ts';
import {PrivateObjectError} from './private-object-store.ts';
import type {createLocalSandboxValidator} from './local-sandbox-validator.ts';
import type {FileType} from './validation-contract.ts';
import {SandboxValidationError,fileHash,validInput} from './validation-reply.ts';

type Input={businessId:string;attemptId:string;dispatchId:string;stagingKey:string;originalKey:string;previewKey:string;byteSize:number;contentType:FileType};
type Code='FILE_INTAKE_INVALID'|'FILE_INTAKE_BUSY'|'FILE_INTAKE_ABORTED'|'FILE_INTAKE_TIMEOUT'|'FILE_INTAKE_FAILED'|'FILE_QUARANTINED';
export class FileIntakeError extends Error {
  readonly code:Code;readonly reason:string|undefined;
  constructor(code:Code,reason?:string){super(code);this.name='FileIntakeError';this.code=code;this.reason=reason;}
}
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',id=new RegExp(`^${uuid}$`);
function failure(code:Code):never{throw new FileIntakeError(code);}
const check=(s:AbortSignal)=>{if(s.aborted)failure(s.reason?.name==='TimeoutError'?'FILE_INTAKE_TIMEOUT':'FILE_INTAKE_ABORTED');};

// Private candidate preparation, not authorization or an Available publication.
// The trusted job must durably reserve dispatch/original/preview IDs before this
// call and retain ALL of them after uncertainty, cancellation or lost responses.
export function createValidatedFileIntake(store:ReturnType<typeof createPrivateObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
  let busy=false;
  return Object.freeze({async prepare(input:Input,signal?:AbortSignal){
    const c={...input};
    if(![c.businessId,c.attemptId,c.dispatchId].every(v=>typeof v==='string'&&id.test(v))
      ||!new RegExp(`^staging/${c.businessId}/${c.attemptId}/${uuid}$`).test(c.stagingKey)
      ||!new RegExp(`^originals/${c.businessId}/${uuid}$`).test(c.originalKey)
      ||!new RegExp(`^previews/${c.businessId}/${uuid}$`).test(c.previewKey)
      ||!Number.isSafeInteger(c.byteSize)||c.byteSize<1||c.byteSize>25*1024*1024
      ||!['image/jpeg','image/png','image/heic','application/pdf'].includes(c.contentType))failure('FILE_INTAKE_INVALID');
    const bounded=AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);check(bounded);
    if(busy)failure('FILE_INTAKE_BUSY');busy=true;
    try{
      const staged=await store.readStaging(c.stagingKey,c.byteSize,bounded);check(bounded);
      if(!staged.bytes)failure('FILE_INTAKE_FAILED');
      const bytes=Buffer.from(staged.bytes);validInput(bytes,c.contentType);
      if(bytes.length!==c.byteSize||fileHash(bytes)!==staged.sha256)failure('FILE_INTAKE_FAILED');
      const result=await validator.validate(bytes,c.contentType,c.dispatchId,bounded);check(bounded);
      if(result.source.sha256!==staged.sha256||result.source.byteSize!==bytes.length||result.source.detectedType!==c.contentType)failure('FILE_INTAKE_FAILED');
      // Seal preview and metadata before storage awaits. Never re-fetch staging.
      const preview=Buffer.from(result.preview.bytes),source={...result.source},version=result.validationVersion;
      const previewMetadata={sha256:result.preview.sha256,byteSize:result.preview.byteSize,contentType:result.preview.contentType,
        width:result.preview.width,height:result.preview.height,...(result.preview.pageNumber?{pageNumber:result.preview.pageNumber}:{})};
      if(preview.length!==previewMetadata.byteSize||fileHash(preview)!==previewMetadata.sha256)failure('FILE_INTAKE_FAILED');
      const original=await store.writeOriginalCandidate({key:c.originalKey,bytes,sha256:staged.sha256,contentType:c.contentType},bounded);check(bounded);
      if(original.key!==c.originalKey||original.sha256!==staged.sha256||original.byteSize!==bytes.length)failure('FILE_INTAKE_FAILED');
      const derivative=await store.writePreviewCandidate({key:c.previewKey,bytes:preview,sha256:previewMetadata.sha256,contentType:'image/jpeg'},bounded);check(bounded);
      if(derivative.key!==c.previewKey||derivative.sha256!==previewMetadata.sha256||derivative.byteSize!==preview.length)failure('FILE_INTAKE_FAILED');
      return Object.freeze({status:'PrivateValidatedCandidate' as const,validationVersion:version,source:Object.freeze(source),original,
        preview:Object.freeze({...previewMetadata,...derivative})});
    }catch(error){
      check(bounded);if(error instanceof FileIntakeError)throw error;
      if(error instanceof PrivateObjectError)throw new FileIntakeError('FILE_INTAKE_FAILED',error.code);
      if(error instanceof SandboxValidationError)throw new FileIntakeError(error.code==='FILE_QUARANTINED'?'FILE_QUARANTINED':'FILE_INTAKE_FAILED',error.quarantineCode??error.code);
      return failure('FILE_INTAKE_FAILED');
    }finally{busy=false;}
  }});
}
