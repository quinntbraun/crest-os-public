import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import type {createRecoveryPrimaryStore} from './recovery-primary-store.ts';
import type {captureRecoveryOriginalInventory} from './recovery-original-inventory.ts';
import type {createRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryVault} from './recovery-vault.ts';

type Inventory=ReturnType<Awaited<ReturnType<typeof captureRecoveryOriginalInventory>>['forRecoveryTools']>;
type Attempt=Awaited<ReturnType<typeof createRecoveryAttempt>>;
export class RecoveryRetainedArchiveError extends Error{constructor(){super('RECOVERY_RETAINED_ARCHIVE_REVIEW_REQUIRED');this.name='RecoveryRetainedArchiveError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryRetainedArchiveError();}

// Captures a dedicated primary bucket, not just Available attachment rows.
// Unreferenced/staging bytes remain quarantine evidence and never become a
// published attachment or a claimed database-snapshot fact.
export async function captureRecoveryRetainedArchive(input:Readonly<{inventory:Inventory;workspace:string;recipient:string;retainUntil:string}>,ports:Readonly<{source:ReturnType<typeof createRecoveryPrimaryStore>;encrypt:ReturnType<typeof createRecoveryFileEncryption>;attempt:Pick<Attempt,'view'|'publish'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>}>,signal:AbortSignal){
 try{
  signal.throwIfAborted();const state=ports.attempt.view(),until=Date.parse(input.retainUntil);require(!state.reviewRequired&&state.header.sourceSchemaVersion===138&&input.inventory.profile==='crest.private-original-inventory.v1'&&Number.isFinite(until)&&new Date(until).toISOString()===input.retainUntil&&until>=Date.now()+7*86400000&&until<=Date.now()+500*86400000);
  const catalog=(await ports.source.listRetained(signal)).forRecoveryTools(),wanted=input.inventory.objects.filter(object=>object.domain===catalog.domain),expected=new Map(wanted.map(object=>[object.key,object])),available=new Set(catalog.objects.map(object=>object.key));
  require(expected.size===wanted.length);for(const key of expected.keys())require(available.has(key));
  const entries=[];
  for(const object of catalog.objects){
   signal.throwIfAborted();const read=(await ports.source.readObserved(object,signal)).forRecoveryTools();
   try{
    const known=expected.get(object.key);if(known)require(known.byteSize===read.observation.byteSize&&known.sha256===read.observation.sha256);
    const retention=known?'published':'quarantine',encrypted=(await ports.encrypt({workspace:input.workspace,recipient:input.recipient,bytes:read.bytes},signal)).forRecoveryTools();require(encrypted.plaintext.byteSize===read.observation.byteSize&&encrypted.plaintext.sha256===read.observation.sha256);
    const artifact=await ports.attempt.publish({artifactId:randomUUID(),purpose:known?'original':'quarantine',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:input.retainUntil},encrypted.path,ports.vault,signal);
    await unlink(encrypted.path);entries.push(Object.freeze({source:read.observation,retention,publishedSource:known??null,artifact}));
   }finally{read.bytes.fill(0);}
  }
  const stability=await ports.source.verifyStable(catalog,signal),evidence=Object.freeze({profile:'crest.private-retained-bucket-archive.v1' as const,pointId:state.header.pointId,snapshotId:input.inventory.snapshotId,domain:catalog.domain,observedAt:catalog.observedAt,stability,entries:Object.freeze(entries),publishedCount:expected.size,quarantineCount:entries.filter(entry=>entry.retention==='quarantine').length,quarantineRendered:false as const,primaryAtomicSnapshot:false as const,completeBackup:false as const});
  return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryRetainedArchiveError();}});
 }catch{throw new RecoveryRetainedArchiveError();}
}
