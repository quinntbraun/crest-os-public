// One bounded business lease coordinates database, three stores, application
// distribution and configuration. This candidate has no success marker/heartbeat
// until offline material, provider/restore and full-control acceptance exist.
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {unlink} from 'node:fs/promises';
import {createRecoveryDataArchive,createPinnedRecoveryDataArchive} from './recovery-data-archive.ts';
import type {RecoveryDataArchiveInput,RecoveryDataArchivePorts} from './recovery-data-archive.ts';
import {createRecoveryReleaseDistribution,createPinnedRecoveryReleaseDistribution,readRecoveryReleaseManifest} from './recovery-release-distribution.ts';
import {createRecoveryConfigurationArchive,createPinnedRecoveryConfigurationArchive,readRecoveryConfiguration} from './recovery-configuration.ts';
import {createRecoveryFileEncryption,createPinnedRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {RecoveryCaptureLauncher} from './recovery-database-capture.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';

type ConfigurationInput=Parameters<ReturnType<typeof createRecoveryConfigurationArchive>>[0];
type DistributionInput=Parameters<ReturnType<typeof createRecoveryReleaseDistribution>>[0];
type Input=RecoveryDataArchiveInput&Readonly<{distribution:Pick<DistributionInput,'manifest'|'sourcePath'|'imagePath'|'partByteSize'>;configuration:Pick<ConfigurationInput,'source'|'expected'>}>;
type Ports=Omit<RecoveryDataArchivePorts,'afterData'>;
export class RecoveryRunError extends Error{constructor(){super('RECOVERY_RUN_REVIEW_REQUIRED');this.name='RecoveryRunError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryRunError();}
function compose(data:ReturnType<typeof createRecoveryDataArchive>,distribution:ReturnType<typeof createRecoveryReleaseDistribution>,configuration:ReturnType<typeof createRecoveryConfigurationArchive>,seal:ReturnType<typeof createRecoveryFileEncryption>){
 return async(input:Input,ports:Ports,signal:AbortSignal)=>{
  try{
   signal.throwIfAborted();const manifest=readRecoveryReleaseManifest(input.distribution.manifest),recipe=readRecoveryConfiguration(input.configuration.source,input.configuration.expected),expected=recipe.binding;
   require(expected.businessId===input.businessId&&expected.appReleaseId===input.expectedAppReleaseId&&expected.migrationRegistrySha256===input.migrationRegistrySha256&&expected.sourceSchemaVersion===138&&manifest.release.appReleaseId===expected.appReleaseId&&manifest.release.migrationRegistrySha256===expected.migrationRegistrySha256);
   const {release:_release,...buildManifest}=manifest;void _release;
   const request=Object.freeze({...input,database:Object.freeze({...input.database}),migrations:Object.freeze(input.migrations.map(item=>Object.freeze({...item}))),distribution:Object.freeze({...input.distribution,manifest:buildManifest}),configuration:Object.freeze({source:JSON.stringify(recipe),expected})});
   let completed:Readonly<{profile:'crest.verified-recovery-run-candidate.v1';pointId:string;snapshotId:string;manifest:Awaited<ReturnType<Ports['attempt']['publish']>>;manifestPlaintext:Readonly<{byteSize:number;sha256:string}>;completeBackup:false}>|undefined;
   await data(request,{...ports,async afterData(data,lease){
    await lease.assertHeld();const common={workspace:request.database.workspace,recipient:request.database.recipient,retainUntil:data.retention.data};
    // Every component dispatch rechecks the same live business lease. Losing it
    // cannot be hidden by successful standalone component uploads.
    const attempt:Ports['attempt']=Object.freeze({view:()=>ports.attempt.view(),async publish(...args:Parameters<Ports['attempt']['publish']>){await lease.assertHeld();const result=await ports.attempt.publish(...args);await lease.assertHeld();return result;}}),owned={attempt,vault:ports.vault};
    const application=(await distribution({...request.distribution,...common},owned,lease.signal)).forRecoveryTools();await lease.assertHeld();const settings=(await configuration({...request.configuration,...common},owned,lease.signal)).forRecoveryTools();
    const header=attempt.view().header;require(!attempt.view().reviewRequired&&application.pointId===data.pointId&&settings.pointId===data.pointId&&header.pointId===data.pointId&&settings.binding.referenceDirectoryId===expected.referenceDirectoryId);
    const index=Object.freeze({profile:'crest.private-recovery-run-candidate.v1' as const,header,retention:data.retention,data,application,configuration:settings,requiredAcceptance:Object.freeze(['external_configuration_files_and_secrets','offline_age_key_custody','actual_provider_scope_and_retention','full_business_reconciliation','independent_full_restore'] as const),completeBackup:false as const}),bytes=Buffer.from(JSON.stringify(index)+'\n');require(bytes.length<=1048576);let encrypted;
    try{encrypted=(await seal({workspace:common.workspace,recipient:common.recipient,bytes},lease.signal)).forRecoveryTools();}finally{bytes.fill(0);}
    const artifactId=randomUUID(),artifact=await attempt.publish({artifactId,purpose:'manifest',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:common.retainUntil},encrypted.path,ports.vault,lease.signal);require(artifact.key===recoveryVaultArtifactKey(header.pointId,artifactId)&&artifact.byteSize===encrypted.ciphertext.byteSize&&artifact.sha256===encrypted.ciphertext.sha256&&artifact.retainUntil===common.retainUntil);await unlink(encrypted.path);await lease.assertHeld();
    completed=Object.freeze({profile:'crest.verified-recovery-run-candidate.v1' as const,pointId:header.pointId,snapshotId:data.snapshotId,manifest:artifact,manifestPlaintext:encrypted.plaintext,completeBackup:false as const});
   }},signal);
   require(completed);const evidence=completed;return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryRunError();}});
  }catch{if(input.client instanceof pg.Client)await input.client.end().catch(()=>{});throw new RecoveryRunError();}
 };
}
export function createRecoveryRun(launch:RecoveryCaptureLauncher){return compose(createRecoveryDataArchive(launch),createRecoveryReleaseDistribution(launch),createRecoveryConfigurationArchive(launch),createRecoveryFileEncryption(launch));}
export async function createPinnedRecoveryRun(tools:Readonly<{pgDump:string;age:string}>){
 const run=compose(await createPinnedRecoveryDataArchive(tools),await createPinnedRecoveryReleaseDistribution(tools),await createPinnedRecoveryConfigurationArchive(tools),await createPinnedRecoveryFileEncryption(tools));
 return(input:Omit<Input,'database'>&Readonly<{database:Omit<Input['database'],'environment'>}>,ports:Ports,signal:AbortSignal)=>run({...input,database:{...input.database,environment:'production'}},ports,signal);
}
