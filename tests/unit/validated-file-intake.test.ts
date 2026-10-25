import {beforeEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {createValidatedFileIntake} from '../../src/files/validated-file-intake.ts';
import {PrivateObjectError} from '../../src/files/private-object-store.ts';
import {SandboxValidationError,fileHash} from '../../src/files/validation-reply.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
import type {ValidatedFile} from '../../src/files/validation-contract.ts';
const business=randomUUID(),attempt=randomUUID(),originalBytes=Buffer.from('original synthetic bytes'),preview=Buffer.from([255,216,1,2,255,217]);
const config=()=>({businessId:business,attemptId:attempt,dispatchId:randomUUID(),stagingKey:`staging/${business}/${attempt}/${randomUUID()}`,
  originalKey:`originals/${business}/${randomUUID()}`,previewKey:`previews/${business}/${randomUUID()}`,byteSize:originalBytes.length,contentType:'image/png' as const});
const result=():ValidatedFile=>({validationVersion:imageValidationVersion,source:{sha256:fileHash(originalBytes),byteSize:originalBytes.length,detectedType:'image/png',width:20,height:10},
  preview:{bytes:Buffer.from(preview),sha256:fileHash(preview),byteSize:preview.length,contentType:'image/jpeg',width:20,height:10}});
const read=vi.fn(),original=vi.fn(),derivative=vi.fn(),validate=vi.fn();
const store={issueStagingUpload:vi.fn(),readStaging:read,writeOriginalCandidate:original,writePreviewCandidate:derivative};
const setup=()=>createValidatedFileIntake(store,{validate});
beforeEach(()=>{
  vi.resetAllMocks();read.mockResolvedValue({bytes:Buffer.from(originalBytes),sha256:fileHash(originalBytes)});validate.mockResolvedValue(result());
  original.mockImplementation(async i=>({key:i.key,sha256:fileHash(i.bytes),byteSize:i.bytes.length}));
  derivative.mockImplementation(async i=>({key:i.key,sha256:fileHash(i.bytes),byteSize:i.bytes.length}));
});
it('prepares both private candidates from one validated snapshot without publishing or returning file bytes',async()=>{
  const c=config(),r=await setup().prepare(c);expect(r.status).toBe('PrivateValidatedCandidate');expect(r.original.key).toBe(c.originalKey);expect(r.preview.key).toBe(c.previewKey);
  expect(read).toHaveBeenCalledOnce();expect(validate.mock.calls[0]![2]).toBe(c.dispatchId);expect(original.mock.calls[0]![0].bytes).toEqual(originalBytes);
  expect(derivative.mock.calls[0]![0].bytes).toEqual(preview);expect(Object.hasOwn(r.preview,'bytes')).toBe(false);expect(Object.isFrozen(r.source)).toBe(true);
});
it('seals input context and preview bytes across asynchronous storage writes',async()=>{
  const c=config(),key=c.originalKey,validation=result();validate.mockResolvedValue(validation);
  original.mockImplementation(async i=>{validation.preview.bytes.fill(0);return {key:i.key,sha256:fileHash(i.bytes),byteSize:i.bytes.length};});
  const pending=setup().prepare(c);c.originalKey='replacement';c.dispatchId=randomUUID();const r=await pending;
  expect(r.original.key).toBe(key);expect(derivative.mock.calls[0]![0].bytes).toEqual(preview);
});
it.each(['businessId','attemptId','dispatchId','stagingKey','originalKey','previewKey','byteSize','contentType'])('rejects invalid/cross-business %s before reading staging',async key=>{
  const c=config();Object.assign(c,{[key]:key==='byteSize'?0:'invalid'});await expect(setup().prepare(c)).rejects.toThrow('FILE_INTAKE_INVALID');expect(read).not.toHaveBeenCalled();
});
it('rejects guessed cross-tenant paths even if each UUID is well formed',async()=>{const c=config();c.originalKey=`originals/${randomUUID()}/${randomUUID()}`;await expect(setup().prepare(c)).rejects.toThrow('FILE_INTAKE_INVALID');expect(read).not.toHaveBeenCalled();});
it('does not promote bytes on quarantine, decode failure, altered snapshot or unbound validation results',async()=>{
  for(const error of [new SandboxValidationError('FILE_QUARANTINED','IMAGE_DECODE_FAILED'),new SandboxValidationError('SANDBOX_CLEANUP_UNCERTAIN')]){
    validate.mockRejectedValueOnce(error);await expect(setup().prepare(config())).rejects.toMatchObject({reason:error.quarantineCode??error.code});
  }
  validate.mockResolvedValue({...result(),source:{...result().source,sha256:'e'.repeat(64)}});await expect(setup().prepare(config())).rejects.toThrow('FILE_INTAKE_FAILED');
  read.mockResolvedValue({bytes:originalBytes,sha256:'d'.repeat(64)});await expect(setup().prepare(config())).rejects.toThrow('FILE_INTAKE_FAILED');
  expect(original).not.toHaveBeenCalled();expect(derivative).not.toHaveBeenCalled();
});
it('detects altered preview bytes before writing either candidate',async()=>{const r=result();r.preview.bytes.fill(0);validate.mockResolvedValue(r);await expect(setup().prepare(config())).rejects.toThrow('FILE_INTAKE_FAILED');expect(original).not.toHaveBeenCalled();});
it('retains uncertainty after original PUT and never attempts preview or an automatic retry',async()=>{original.mockRejectedValue(new PrivateObjectError('OBJECT_WRITE_UNCERTAIN'));await expect(setup().prepare(config())).rejects.toMatchObject({reason:'OBJECT_WRITE_UNCERTAIN'});expect(original).toHaveBeenCalledOnce();expect(derivative).not.toHaveBeenCalled();});
it('withholds a pair after preview failure and preserves the completed original for reconciliation',async()=>{derivative.mockRejectedValue(new PrivateObjectError('OBJECT_BYTES_MISMATCH'));await expect(setup().prepare(config())).rejects.toMatchObject({reason:'OBJECT_BYTES_MISMATCH'});expect(original).toHaveBeenCalledOnce();expect(derivative).toHaveBeenCalledOnce();});
it.each(['original','preview'])('rejects wrong final-object receipts: %s',async target=>{(target==='original'?original:derivative).mockResolvedValue({key:'wrong',sha256:'a'.repeat(64),byteSize:1});await expect(setup().prepare(config())).rejects.toThrow('FILE_INTAKE_FAILED');});
it('rejects pre-cancellation, stops after mid-job cancellation, and resets its concurrency latch',async()=>{
  const worker=setup();await expect(worker.prepare(config(),AbortSignal.abort())).rejects.toThrow('FILE_INTAKE_ABORTED');expect(read).not.toHaveBeenCalled();
  const controller=new AbortController();validate.mockImplementationOnce(async()=>{controller.abort();return result();});await expect(worker.prepare(config(),controller.signal)).rejects.toThrow('FILE_INTAKE_ABORTED');expect(original).not.toHaveBeenCalled();
  await worker.prepare(config());
});
it('blocks overlapping intake before extra storage I/O',async()=>{let release!:(v:ValidatedFile)=>void;validate.mockImplementationOnce(()=>new Promise(r=>{release=r;}));const worker=setup(),pending=worker.prepare(config());for(let i=0;i<5;i++)await Promise.resolve();await expect(worker.prepare(config())).rejects.toThrow('FILE_INTAKE_BUSY');release(result());await pending;expect(read).toHaveBeenCalledOnce();});
it('does not retain raw exception messages or causes',async()=>{read.mockRejectedValue(new Error('private provider credential'));try{await setup().prepare(config());throw Error('expected rejection');}catch(e){expect((e as Error).message).toBe('FILE_INTAKE_FAILED');expect((e as Error).cause).toBeUndefined();expect(JSON.stringify(e)).not.toContain('credential');}});
