import {createHash,randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import type {captureRecoveryOriginalInventory,RecoveryOriginalObject} from './recovery-original-inventory.ts';
import type {createRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryVault} from './recovery-vault.ts';

type Inventory=ReturnType<Awaited<ReturnType<typeof captureRecoveryOriginalInventory>>['forRecoveryTools']>;
type Encrypt=ReturnType<typeof createRecoveryFileEncryption>;
type Attempt=Awaited<ReturnType<typeof createRecoveryAttempt>>;
export class RecoveryOriginalArchiveError extends Error{constructor(){super('RECOVERY_ORIGINAL_ARCHIVE_REVIEW_REQUIRED');this.name='RecoveryOriginalArchiveError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryOriginalArchiveError();}
const domains=['expense_receipt','supplier_document','condition_photo'],uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

// Production supplies the held recovery attempt journal, fixed source stores,
// pinned age factory and independent vault. No reads, retries or keys originate
// in browser input. This copies published objects, not unresolved staging bytes.
export async function captureRecoveryOriginalArchive(input:Readonly<{inventory:Inventory;workspace:string;recipient:string;retainUntil:string}>,ports:Readonly<{readSource:(object:RecoveryOriginalObject,signal:AbortSignal)=>Promise<Uint8Array>;encrypt:Encrypt;attempt:Pick<Attempt,'publish'|'view'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>}>,signal:AbortSignal){
 try{
  signal.throwIfAborted();const inventory=input.inventory,state=ports.attempt.view();
  const until=Date.parse(input.retainUntil);require(Number.isFinite(until)&&new Date(until).toISOString()===input.retainUntil&&until>=Date.now()+7*86400000&&until<=Date.now()+500*86400000);
  require(inventory?.profile==='crest.private-original-inventory.v1'&&Array.isArray(inventory.objects)&&inventory.objects.length<=100000&&!state.reviewRequired&&state.header.sourceSchemaVersion===138);
  // Copy and check the entire descriptor list before the first storage dispatch.
  const seen=new Set<string>(),objects=inventory.objects.map(value=>{
   const object=Object.freeze({...value}),identity=object.domain+':'+object.key;
   require(domains.includes(object.domain)&&['original','preview'].includes(object.variant)&&new RegExp(`^${uuid}$`).test(object.businessId)&&new RegExp(`^${uuid}$`).test(object.attachmentId)&&new RegExp(`^${object.variant==='original'?'originals':'previews'}/${object.businessId}/${uuid}$`).test(object.key)&&Number.isSafeInteger(object.byteSize)&&object.byteSize>0&&object.byteSize<=(object.variant==='original'?26214400:8388608)&&/^[a-f0-9]{64}$/.test(object.sha256)&&['image/jpeg','image/png','image/heic','application/pdf'].includes(object.contentType)&&!seen.has(identity));seen.add(identity);return object;
  });
  const entries=[];
  for(const object of objects){
   signal.throwIfAborted();let bytes:Uint8Array|undefined;
   try{
    bytes=await ports.readSource(object,signal);signal.throwIfAborted();require(bytes instanceof Uint8Array&&bytes.byteLength===object.byteSize&&createHash('sha256').update(bytes).digest('hex')===object.sha256);
    const encrypted=(await ports.encrypt({workspace:input.workspace,recipient:input.recipient,bytes},signal)).forRecoveryTools();
    require(encrypted.plaintext.byteSize===object.byteSize&&encrypted.plaintext.sha256===object.sha256);signal.throwIfAborted();
    const artifact=await ports.attempt.publish({artifactId:randomUUID(),purpose:'original',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:input.retainUntil},encrypted.path,ports.vault,signal);
    // Journal acknowledgement follows version-pinned checksum/retention readback.
    // Unknown dispatch retains the encrypted spool file for explicit review.
    await unlink(encrypted.path);entries.push(Object.freeze({object,artifact}));
   }finally{bytes?.fill(0);}
  }
  const evidence=Object.freeze({profile:'crest.private-published-original-archive.v1' as const,pointId:state.header.pointId,snapshotId:inventory.snapshotId,entries:Object.freeze(entries),publishedObjectCount:entries.length,stagingBytesIncluded:false as const,retainedUnpublishedCandidatesIncluded:false as const,completeBackup:false as const});
  return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryOriginalArchiveError();}});
 }catch{throw new RecoveryOriginalArchiveError();}
}
