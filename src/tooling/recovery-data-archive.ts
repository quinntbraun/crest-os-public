// A verified business-data component. Full recovery also requires the accepted
// application/configuration/key kit, final point marker and independent restore.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {withRecoveryBackupLease} from './recovery-backup-lease.ts';
import type {RecoveryBackupLease} from './recovery-backup-lease.ts';
import {verifyRecoveryBackupReader} from './recovery-backup-reader.ts';
import {createRecoveryDatabaseBundle,createRecoveryFileEncryption,createPinnedRecoveryDatabaseBundle,createPinnedRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {RecoveryCaptureLauncher,RecoveryDatabaseCaptureInput} from './recovery-database-capture.ts';
import {captureRecoveryRetainedArchive} from './recovery-retained-archive.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';
import type {createRecoveryVault} from './recovery-vault.ts';
import type {RecoveryVaultArtifact} from './recovery-vault.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryPrimaryStore} from './recovery-primary-store.ts';

const domains=['expense_receipt','supplier_document','condition_photo'] as const;
type Stage='preflight'|'snapshot'|'database_vault'|'retained_stores'|'manifest'|'completion';
export class RecoveryDataArchiveError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_DATA_ARCHIVE_REVIEW_REQUIRED');this.name='RecoveryDataArchiveError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryDataArchiveError('preflight');}
export type RecoveryDataArchiveInput=Readonly<{client:pg.Client;businessId:string;expectedAppReleaseId:string;migrationRegistrySha256:string;migrations:readonly Readonly<{version:string;name:string}>[];database:Omit<RecoveryDatabaseCaptureInput,'snapshot'>;retainUntil:string}>;
type Input=RecoveryDataArchiveInput;
export type RecoveryDataArchiveEvidence=Readonly<{profile:'crest.verified-business-data-archive.v1';pointId:string;snapshotId:string;manifest:RecoveryVaultArtifact;manifestPlaintext:Readonly<{byteSize:number;sha256:string}>;publishedObjectCount:number;quarantineObjectCount:number;retention:Readonly<{requested:string;data:string;originals:string}>;completeBackup:false}>;
export type RecoveryDataArchivePorts=Readonly<{sources:Readonly<Record<typeof domains[number],ReturnType<typeof createRecoveryPrimaryStore>>>;attempt:Pick<Awaited<ReturnType<typeof createRecoveryAttempt>>,'view'|'publish'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>;afterData?:(data:RecoveryDataArchiveEvidence,lease:RecoveryBackupLease)=>Promise<void>}>;
type Ports=RecoveryDataArchivePorts;

function compose(capture:ReturnType<typeof createRecoveryDatabaseBundle>,encrypt:ReturnType<typeof createRecoveryFileEncryption>){
 return async(input:Input,ports:Ports,external:AbortSignal)=>{
  let stage:Stage='preflight';const client=input.client;
  try{
   require(client instanceof pg.Client);const request=Object.freeze({...input,database:Object.freeze({...input.database}),migrations:Object.freeze(input.migrations.map(entry=>Object.freeze({...entry})))}),sources=Object.freeze({...ports.sources});
   return await withRecoveryBackupLease(client,request.businessId,external,async lease=>{
    const header=ports.attempt.view().header;require(!ports.attempt.view().reviewRequired&&header.businessId===request.businessId&&header.appReleaseId===request.expectedAppReleaseId&&header.migrationRegistrySha256===request.migrationRegistrySha256&&header.sourceSchemaVersion===138&&request.migrations.length===138);
    require(Object.keys(sources).sort().join(',')===[...domains].sort().join(',')&&domains.every(domain=>sources[domain]?.domain===domain)&&new Set(domains.map(domain=>sources[domain])).size===3);
    const until=Date.parse(request.retainUntil);require(Number.isFinite(until)&&new Date(until).toISOString()===request.retainUntil&&until>=Date.parse(header.startedAt)+7*86400000&&until<=Date.now()+500*86400000);const dataRetainUntil=new Date(Math.max(until,Date.now()+8*86400000)).toISOString(),originalRetainUntil=new Date(Math.max(Date.parse(dataRetainUntil),Date.now()+401*86400000)).toISOString();await verifyRecoveryBackupReader(client,request.migrations);await lease.assertHeld();
    stage='snapshot';const captured=await lease.capture(snapshot=>capture({...request.database,snapshot},lease.signal)),bundle=captured.value.forRecoveryTools();require(bundle.database.snapshotId===captured.snapshot.id&&bundle.inventory.snapshotId===captured.snapshot.id&&bundle.originalInventory.snapshotId===captured.snapshot.id&&bundle.financialControls.snapshotId===captured.snapshot.id&&bundle.financialControls.journalBalanced===true);
    async function publish(value:Readonly<{path:string;ciphertext:Readonly<{byteSize:number;sha256:string}>}>,purpose:'database'|'roles'|'manifest'){
     await lease.assertHeld();lease.signal.throwIfAborted();const artifactId=randomUUID(),artifact=await ports.attempt.publish({artifactId,purpose,byteSize:value.ciphertext.byteSize,sha256:value.ciphertext.sha256,retainUntil:dataRetainUntil},value.path,ports.vault,lease.signal);require(artifact.key===recoveryVaultArtifactKey(header.pointId,artifactId)&&artifact.byteSize===value.ciphertext.byteSize&&artifact.sha256===value.ciphertext.sha256&&artifact.retainUntil===dataRetainUntil);await unlink(value.path);return artifact;
    }
    stage='database_vault';const database=await publish(bundle.database,'database'),metadata=await publish(bundle.encryptedInventory,'roles');
    stage='retained_stores';const archives=[];
    for(const domain of domains){
     await lease.assertHeld();const archive=(await captureRecoveryRetainedArchive({inventory:bundle.originalInventory,workspace:request.database.workspace,recipient:request.database.recipient,retainUntil:originalRetainUntil},{source:sources[domain],encrypt,attempt:ports.attempt,vault:ports.vault},lease.signal)).forRecoveryTools();require(archive.domain===domain&&archive.pointId===header.pointId&&archive.snapshotId===captured.snapshot.id&&archive.quarantineRendered===false);archives.push(archive);
    }
    require(archives.reduce((sum,archive)=>sum+archive.publishedCount,0)===bundle.originalInventory.objects.length);await lease.assertHeld();
    stage='manifest';const index=Object.freeze({profile:'crest.private-business-data-archive.v1' as const,header,snapshot:captured.snapshot,retention:Object.freeze({requested:request.retainUntil,data:dataRetainUntil,originals:originalRetainUntil}),database:Object.freeze({artifact:database,plaintext:bundle.database.plaintext,tools:bundle.database.tools}),metadata:Object.freeze({profile:'crest.private-database-recovery-metadata.v2' as const,artifact:metadata,plaintext:bundle.encryptedInventory.plaintext}),financialSummary:Object.freeze({journalBalanced:true as const,debitCents:bundle.financialControls.journalDebitCents,creditCents:bundle.financialControls.journalCreditCents,fullBusinessReconciliationVerified:false as const}),sources:Object.freeze(archives),publishedObjectCount:bundle.originalInventory.objects.length,quarantineObjectCount:archives.reduce((sum,archive)=>sum+archive.quarantineCount,0),pendingAttachmentCount:bundle.originalInventory.pendingCount,primaryAtomicSnapshot:false as const,completeBackup:false as const});
    const bytes=Buffer.from(JSON.stringify(index)+'\n');require(bytes.length<=8388608);let encrypted;try{encrypted=(await encrypt({workspace:request.database.workspace,recipient:request.database.recipient,bytes},lease.signal)).forRecoveryTools();}finally{bytes.fill(0);}
    const manifest=await publish(encrypted,'manifest');await lease.assertHeld();const evidence:RecoveryDataArchiveEvidence=Object.freeze({profile:'crest.verified-business-data-archive.v1' as const,pointId:header.pointId,snapshotId:captured.snapshot.id,manifest,manifestPlaintext:encrypted.plaintext,publishedObjectCount:index.publishedObjectCount,quarantineObjectCount:index.quarantineObjectCount,retention:index.retention,completeBackup:false as const});stage='completion';if(ports.afterData)await ports.afterData(evidence,lease);await lease.assertHeld();return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryDataArchiveError('manifest');}});
   });
  }catch{if(client instanceof pg.Client)await client.end().catch(()=>{});throw new RecoveryDataArchiveError(stage);}
 };
}
export function createRecoveryDataArchive(launch:RecoveryCaptureLauncher){return compose(createRecoveryDatabaseBundle(launch),createRecoveryFileEncryption(launch));}
export async function createPinnedRecoveryDataArchive(tools:Readonly<{pgDump:string;age:string}>){
 const database=await createPinnedRecoveryDatabaseBundle(tools),encrypt=await createPinnedRecoveryFileEncryption(tools),run=compose((input,signal)=>database(input,signal),encrypt);
 return(input:Omit<Input,'database'>&Readonly<{database:Omit<Input['database'],'environment'>}>,ports:Ports,signal:AbortSignal)=>run({...input,database:{...input.database,environment:'production'}},ports,signal);
}
