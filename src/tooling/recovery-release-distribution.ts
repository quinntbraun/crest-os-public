// Independent custody of both release archives and their exact build manifest.
// This does not certify CI authorship, activate a release or include private keys.
import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {captureRecoveryReleaseArchive} from './recovery-release-archive.ts';
import {recoveryReleaseFileLimit,hashRecoveryReleaseFile} from './recovery-release-files.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';
import {createRecoveryFileEncryption,createRecoveryReleaseFileEncryption,createPinnedRecoveryFileEncryption,createPinnedRecoveryReleaseFileEncryption} from './recovery-database-capture.ts';
import type {RecoveryCaptureLauncher} from './recovery-database-capture.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryVault} from './recovery-vault.ts';

export class RecoveryReleaseDistributionError extends Error{constructor(){super('RECOVERY_RELEASE_DISTRIBUTION_REVIEW_REQUIRED');this.name='RecoveryReleaseDistributionError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryReleaseDistributionError();}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));}
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commit=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
function archive(value:unknown,file:string){exact(value,['file','byteSize','sha256']);require(value.file===file&&Number.isSafeInteger(value.byteSize)&&Number(value.byteSize)>0&&Number(value.byteSize)<=recoveryReleaseFileLimit&&sha(value.sha256));return Object.freeze({file,byteSize:value.byteSize as number,sha256:value.sha256});}

// Closed current format. Historical manifests are not relabeled or activated.
export function readRecoveryReleaseManifest(value:unknown){
 try{
  exact(value,['formatVersion','sourceCommit','workingTreeDirty','nodeVersion','packageManager','lockfileSha256','migrationRegistrySha256','canonicalMaintenanceSha256','toolchainSha256','compatibility','containerImageId','buildIdentity','distributionDigest','imageArchive','sourceArchive','productionActivation']);
  require(value.formatVersion===2&&commit(value.sourceCommit)&&value.workingTreeDirty===false&&value.nodeVersion==='24.22.0'&&value.packageManager==='npm@11.19.1');
  for(const field of ['lockfileSha256','migrationRegistrySha256','canonicalMaintenanceSha256','toolchainSha256'])require(sha(value[field]));
  const c=value.compatibility;exact(c,['schemaVersion','appVersion','databaseMajor','schemaMinimum','schemaMaximum','reportVersion','commandVersion','productionActivation']);require(c.schemaVersion===1&&c.appVersion==='0.1.0'&&c.databaseMajor===17&&c.schemaMinimum===0&&c.schemaMaximum===138&&c.reportVersion===0&&c.commandVersion===1&&['blocked','ready'].includes(c.productionActivation as string));
  const b=value.buildIdentity;exact(b,['schemaVersion','appReleaseId','sourceContentSha256','migrationRegistrySha256','sourceSchemaVersion']);require(b.schemaVersion===1&&commit(b.appReleaseId)&&sha(b.sourceContentSha256)&&b.appReleaseId===b.sourceContentSha256.slice(0,40)&&b.migrationRegistrySha256===value.migrationRegistrySha256&&b.sourceSchemaVersion===138);
  require(typeof value.containerImageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(value.containerImageId)&&value.productionActivation==='blocked');
  const imageArchive=archive(value.imageArchive,'crest-os-image.tar'),sourceArchive=archive(value.sourceArchive,'crest-os-source.tar');require(value.distributionDigest==='sha256:'+imageArchive.sha256);
  return Object.freeze({...value,compatibility:Object.freeze({...c}),buildIdentity:Object.freeze({...b}),imageArchive,sourceArchive,release:Object.freeze({sourceCommit:value.sourceCommit,appReleaseId:b.appReleaseId,migrationRegistrySha256:value.migrationRegistrySha256 as string,sourceSchemaVersion:138,containerImageId:value.containerImageId})});
 }catch{throw new RecoveryReleaseDistributionError();}
}

type Input=Readonly<{manifest:unknown;sourcePath:string;imagePath:string;workspace:string;recipient:string;retainUntil:string;partByteSize?:number}>;
type Ports=Readonly<{attempt:Pick<Awaited<ReturnType<typeof createRecoveryAttempt>>,'view'|'publish'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>}>;
function compose(encrypt:ReturnType<typeof createRecoveryReleaseFileEncryption>,seal:ReturnType<typeof createRecoveryFileEncryption>){
 return async(input:Input,ports:Ports,signal:AbortSignal)=>{
  try{
   signal.throwIfAborted();const request=Object.freeze({...input}),manifest=readRecoveryReleaseManifest(request.manifest),state=ports.attempt.view(),until=Date.parse(request.retainUntil);
   require(!state.reviewRequired&&state.header.appReleaseId===manifest.release.appReleaseId&&state.header.migrationRegistrySha256===manifest.release.migrationRegistrySha256&&state.header.sourceSchemaVersion===138&&Number.isFinite(until)&&new Date(until).toISOString()===request.retainUntil&&until>=Date.now()+7*86400000&&until<=Date.now()+500*86400000&&request.sourcePath!==request.imagePath);
   // Verify both before the first dispatch. Each producer repeats its own full
   // plan and per-part checks to detect later changes; no plaintext parts exist.
   for(const [path,expected]of [[request.sourcePath,manifest.sourceArchive],[request.imagePath,manifest.imageArchive]] as const){const actual=await hashRecoveryReleaseFile(path,signal);require(actual.byteSize===expected.byteSize&&actual.sha256===expected.sha256);}
   const sources=[];for(const kind of ['source','image'] as const)sources.push((await captureRecoveryReleaseArchive({kind,release:manifest.release,path:kind==='source'?request.sourcePath:request.imagePath,expected:kind==='source'?manifest.sourceArchive:manifest.imageArchive,workspace:request.workspace,recipient:request.recipient,retainUntil:request.retainUntil,...request.partByteSize?{partByteSize:request.partByteSize}:{}},{encrypt,...ports},signal)).forRecoveryTools());
   const {release,...buildManifest}=manifest,index=Object.freeze({profile:'crest.private-release-distribution.v1' as const,pointId:state.header.pointId,release,buildManifest,archives:Object.freeze(sources),configurationIncluded:false as const,offlineKeyCustodyVerified:false as const,applicationLoaded:false as const,completeBackup:false as const}),bytes=Buffer.from(JSON.stringify(index)+'\n');require(bytes.length<=1048576);let encrypted;
   try{encrypted=(await seal({workspace:request.workspace,recipient:request.recipient,bytes},signal)).forRecoveryTools();}finally{bytes.fill(0);}
   const artifactId=randomUUID(),artifact=await ports.attempt.publish({artifactId,purpose:'application',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:request.retainUntil},encrypted.path,ports.vault,signal);require(artifact.key===recoveryVaultArtifactKey(state.header.pointId,artifactId)&&artifact.byteSize===encrypted.ciphertext.byteSize&&artifact.sha256===encrypted.ciphertext.sha256&&artifact.retainUntil===request.retainUntil);await unlink(encrypted.path);signal.throwIfAborted();
   const evidence=Object.freeze({profile:'crest.verified-release-distribution.v1' as const,pointId:state.header.pointId,release,manifest:artifact,manifestPlaintext:encrypted.plaintext,configurationIncluded:false as const,offlineKeyCustodyVerified:false as const,applicationLoaded:false as const,completeBackup:false as const});return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryReleaseDistributionError();}});
  }catch{throw new RecoveryReleaseDistributionError();}
 };
}
export function createRecoveryReleaseDistribution(launch:RecoveryCaptureLauncher){return compose(createRecoveryReleaseFileEncryption(launch),createRecoveryFileEncryption(launch));}
export async function createPinnedRecoveryReleaseDistribution(tools:Readonly<{pgDump:string;age:string}>){return compose(await createPinnedRecoveryReleaseFileEncryption(tools),await createPinnedRecoveryFileEncryption(tools));}
