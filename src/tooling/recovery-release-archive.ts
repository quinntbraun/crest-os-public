import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {hashRecoveryReleaseParts,recoveryReleaseFileLimit,recoveryReleasePartLimit} from './recovery-release-files.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';
import type {RecoveryVaultArtifact,createRecoveryVault} from './recovery-vault.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryReleaseFileEncryption} from './recovery-database-capture.ts';

type Release=Readonly<{sourceCommit:string;appReleaseId:string;migrationRegistrySha256:string;sourceSchemaVersion:number;containerImageId:string|null}>;
type Part=Readonly<{offset:number;plaintext:Readonly<{byteSize:number;sha256:string}>;artifact:RecoveryVaultArtifact}>;
export type RecoveryReleaseArchive=Readonly<{profile:'crest.recovery-release-archive.v1';kind:'source'|'image';release:Release;byteSize:number;sha256:string;parts:readonly Part[];completeBackup:false}>;
export class RecoveryReleaseArchiveError extends Error{constructor(){super('RECOVERY_RELEASE_ARCHIVE_REVIEW_REQUIRED');this.name='RecoveryReleaseArchiveError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryReleaseArchiveError();}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));}
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=(value:unknown,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=max;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',key=new RegExp(`^recovery/${uuid}/artifacts/${uuid}\\.age$`);
function readRelease(release:unknown,kind:unknown):Release{
 require(kind==='source'||kind==='image');exact(release,['sourceCommit','appReleaseId','migrationRegistrySha256','sourceSchemaVersion','containerImageId']);require(typeof release.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(release.sourceCommit)&&typeof release.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(release.appReleaseId)&&sha(release.migrationRegistrySha256)&&count(release.sourceSchemaVersion,999)&&(release.containerImageId===null&&kind==='source'||typeof release.containerImageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(release.containerImageId)));return Object.freeze({...release}) as Release;
}

export function readRecoveryReleaseArchive(value:unknown):RecoveryReleaseArchive{
 try{
  exact(value,['profile','kind','release','byteSize','sha256','parts','completeBackup']);require(value.profile==='crest.recovery-release-archive.v1'&&(value.kind==='source'||value.kind==='image')&&value.completeBackup===false&&count(value.byteSize,recoveryReleaseFileLimit)&&sha(value.sha256));
  const release=readRelease(value.release,value.kind);
  require(Array.isArray(value.parts)&&value.parts.length>0&&value.parts.length<=128);let offset=0;const seen=new Set<string>(),parts:Part[]=[];
  for(const part of value.parts){
   exact(part,['offset','plaintext','artifact']);require(part.offset===offset);exact(part.plaintext,['byteSize','sha256']);require(count(part.plaintext.byteSize,recoveryReleasePartLimit)&&sha(part.plaintext.sha256));
   const a=part.artifact;exact(a,['key','versionId','byteSize','sha256','retainUntil']);require(typeof a.key==='string'&&key.test(a.key)&&!seen.has(a.key)&&typeof a.versionId==='string'&&a.versionId.length>0&&a.versionId.length<=1024&&a.versionId!=='null'&&!/\s|\p{Cc}/u.test(a.versionId)&&count(a.byteSize,1024*1024*1024)&&a.byteSize>=21&&sha(a.sha256)&&typeof a.retainUntil==='string'&&Number.isFinite(Date.parse(a.retainUntil))&&new Date(a.retainUntil).toISOString()===a.retainUntil);seen.add(a.key);
   require(a.byteSize<=part.plaintext.byteSize+65536);offset+=part.plaintext.byteSize;require(offset<=value.byteSize);parts.push(Object.freeze({offset:part.offset as number,plaintext:Object.freeze({...part.plaintext}) as Part['plaintext'],artifact:Object.freeze({...a}) as RecoveryVaultArtifact}));
  }
  require(offset===value.byteSize);return Object.freeze({profile:value.profile,kind:value.kind,release:Object.freeze({...release}) as Release,byteSize:value.byteSize,sha256:value.sha256,parts:Object.freeze(parts),completeBackup:false});
 }catch{throw new RecoveryReleaseArchiveError();}
}

export async function captureRecoveryReleaseArchive(input:Readonly<{kind:'source'|'image';release:Release;path:string;expected:Readonly<{byteSize:number;sha256:string}>;workspace:string;recipient:string;retainUntil:string;partByteSize?:number}>,ports:Readonly<{encrypt:ReturnType<typeof createRecoveryReleaseFileEncryption>;attempt:Pick<Awaited<ReturnType<typeof createRecoveryAttempt>>,'view'|'publish'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>}>,signal:AbortSignal){
 try{
  signal.throwIfAborted();const release=readRelease(input.release,input.kind),request=Object.freeze({...input,release,expected:Object.freeze({...input.expected})}),state=ports.attempt.view();require(!state.reviewRequired&&state.header.appReleaseId===release.appReleaseId&&state.header.migrationRegistrySha256===release.migrationRegistrySha256&&state.header.sourceSchemaVersion===release.sourceSchemaVersion&&count(request.expected.byteSize,recoveryReleaseFileLimit)&&sha(request.expected.sha256));
  const until=Date.parse(request.retainUntil);require(Number.isFinite(until)&&new Date(until).toISOString()===request.retainUntil&&until>=Date.now()+7*86400000&&until<=Date.now()+500*86400000);
  const plan=await hashRecoveryReleaseParts(request.path,signal,request.partByteSize);require(plan.byteSize===request.expected.byteSize&&plan.sha256===request.expected.sha256);const parts:Part[]=[];
  for(const range of plan.parts){
   signal.throwIfAborted();const encrypted=(await ports.encrypt({workspace:request.workspace,recipient:request.recipient,path:request.path,expected:request.expected,range},signal)).forRecoveryTools();require(encrypted.offset===range.offset&&encrypted.plaintext.byteSize===range.byteSize&&encrypted.plaintext.sha256===range.sha256);
   const artifactId=randomUUID(),artifact=await ports.attempt.publish({artifactId,purpose:'application',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:request.retainUntil},encrypted.path,ports.vault,signal);require(artifact.key===recoveryVaultArtifactKey(state.header.pointId,artifactId)&&artifact.byteSize===encrypted.ciphertext.byteSize&&artifact.sha256===encrypted.ciphertext.sha256&&artifact.retainUntil===request.retainUntil);
   await unlink(encrypted.path);parts.push(Object.freeze({offset:range.offset,plaintext:encrypted.plaintext,artifact}));
  }
  const archive=readRecoveryReleaseArchive({profile:'crest.recovery-release-archive.v1',kind:request.kind,release,byteSize:plan.byteSize,sha256:plan.sha256,parts,completeBackup:false});return Object.freeze({forRecoveryTools:()=>archive,toJSON():never{throw new RecoveryReleaseArchiveError();}});
 }catch{throw new RecoveryReleaseArchiveError();}
}
