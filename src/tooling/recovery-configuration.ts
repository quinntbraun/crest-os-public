import {recoverySourceProfileMatches} from './recovery-source-profile.ts';
// Operator preparation and offline reconstruction only. The backup process
// receives a secret-free recipe, never the live operator profile or private key.
import {randomUUID,createHash} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {parseProductionProfile} from '../server/production-configuration.ts';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import {createRecoveryFileEncryption,createPinnedRecoveryFileEncryption} from './recovery-database-capture.ts';
import type {RecoveryCaptureLauncher} from './recovery-database-capture.ts';
import {recoveryVaultArtifactKey} from './recovery-vault.ts';
import type {createRecoveryAttempt} from './recovery-attempt.ts';
import type {createRecoveryVault} from './recovery-vault.ts';

export class RecoveryConfigurationError extends Error{constructor(){super('RECOVERY_CONFIGURATION_REVIEW_REQUIRED');this.name='RecoveryConfigurationError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryConfigurationError();}
function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{require(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(','));}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
type Binding=Readonly<{businessId:string;appReleaseId:string;migrationRegistrySha256:string;sourceSchemaVersion:import('./recovery-source-profile.ts').RecoverySourceSchemaVersion;referenceDirectoryId:string}>;
type ReferenceBinding=Readonly<{path:string;kind:'secret'|'file';referenceId:string}>;
type Reference=ReferenceBinding&Readonly<{valueSha256:string|null}>;
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const marker=(id:string)=>'crest-recovery-reference:'+id;
const order=(a:Readonly<{path:string}>,b:Readonly<{path:string}>)=>a.path<b.path?-1:a.path>b.path?1:0;
function binding(value:unknown):asserts value is Binding{exact(value,['businessId','appReleaseId','migrationRegistrySha256','sourceSchemaVersion','referenceDirectoryId']);require(uuid(value.businessId)&&uuid(value.referenceDirectoryId)&&typeof value.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(value.appReleaseId)&&typeof value.migrationRegistrySha256==='string'&&/^[a-f0-9]{64}$/.test(value.migrationRegistrySha256)&&recoverySourceProfileMatches(value.sourceSchemaVersion,value.migrationRegistrySha256));}
function member(root:unknown,path:string){let parent=root as Record<string,unknown>;const parts=path.slice(1).split('/');for(const name of parts.slice(0,-1)){require(parent&&typeof parent==='object'&&Object.hasOwn(parent,name));parent=parent[name] as Record<string,unknown>;}const name=parts.at(-1)!;require(parent&&typeof parent==='object'&&Object.hasOwn(parent,name));return{get:()=>parent[name],set:(value:string)=>{parent[name]=value;}};}
function paths(value:unknown){
 require(value&&typeof value==='object'&&!Array.isArray(value));const profile=value as Record<string,unknown>,auth=profile.authentication as Record<string,unknown>;require(auth&&typeof auth==='object'&&Array.isArray(auth.tokenKeys)&&auth.tokenKeys.length>=1&&auth.tokenKeys.length<=8);
 const result:{path:string;kind:'secret'|'file'}[]=[],secret=(path:string)=>result.push({path,kind:'secret'}),file=(path:string)=>result.push({path,kind:'file'});
 secret('/authentication/databaseUrl');secret('/authentication/loginKey');auth.tokenKeys.forEach((_,index)=>secret(`/authentication/tokenKeys/${index}/key`));
 if(Object.hasOwn(profile,'tls')){file('/tls/keyFile');file('/tls/certFile');}
 for(const section of ['finance','financeExports','exports','calendar'])if(Object.hasOwn(profile,section))secret('/'+section+'/connectionString');
 for(const section of ['receipts','photos','supplierOriginals','exports'])if(Object.hasOwn(profile,section)){secret('/'+section+'/storage/accessKeyId');secret('/'+section+'/storage/secretAccessKey');if(section!=='exports')for(const name of ['keyFile','certFile','caFile'])file('/'+section+'/worker/'+name);}
 if(Object.hasOwn(profile,'exports')){const section=profile.exports as Record<string,unknown>;require(section&&typeof section==='object'&&Array.isArray(section.keys)&&section.keys.length>=1&&section.keys.length<=8);section.keys.forEach((_,index)=>secret(`/exports/keys/${index}/key`));}
 if(Object.hasOwn(profile,'calendar')){secret('/calendar/clientSecret');secret('/calendar/calendarKeyMaterial');}
 require(result.length<=64);return result.sort(order);
}
function privateValue<T>(value:T){return Object.freeze({forRecoveryTools:()=>value,toJSON():never{throw new RecoveryConfigurationError();}});}
function validateTemplate(template:unknown,references:readonly Reference[]){
 // Validate all nonsecret fields with the real closed production parser before
 // an offline resolver is called. Dummy material is local, distinct, never used
 // to connect, and discarded; it cannot establish actual key availability.
 const value=parseEvidenceJson(JSON.stringify(template));
 for(const [index,reference]of references.entries()){
  const digest=createHash('sha256').update(reference.referenceId).digest('base64url'),path=reference.path;
  const dummy=reference.kind==='file'?resolvePath('/recovery-material/'+reference.referenceId):path.endsWith('/databaseUrl')||path.endsWith('/connectionString')?`postgresql://crest_ref_${index}:reference-only@database.example.com/crest`:path.endsWith('/key')||path.endsWith('/loginKey')||path.endsWith('/calendarKeyMaterial')?digest:'reference-only-'+digest;
  member(value,path).set(dummy);
 }
 parseProductionProfile(JSON.stringify(value));
}

export function requiredRecoveryConfigurationReferences(profileSource:string){
 try{parseProductionProfile(profileSource);return Object.freeze(paths(parseEvidenceJson(profileSource)).map(item=>Object.freeze(item)));}catch{throw new RecoveryConfigurationError();}
}
export function prepareRecoveryConfiguration(input:Readonly<{profileSource:string;binding:Binding;references:readonly ReferenceBinding[]}>){
 try{
  binding(input.binding);const target=Object.freeze({...input.binding});parseProductionProfile(input.profileSource);const template=parseEvidenceJson(input.profileSource) as Record<string,unknown>;require(template.businessId===target.businessId);
  const expected=paths(template);require(Array.isArray(input.references)&&input.references.length===expected.length);const supplied=input.references.map(item=>{exact(item,['path','kind','referenceId']);require(typeof item.path==='string'&&['secret','file'].includes(item.kind as string)&&uuid(item.referenceId));return Object.freeze({...item}) as ReferenceBinding;}).sort(order);require(new Set(supplied.map(item=>item.referenceId)).size===supplied.length);
  const excluded:string[]=[],references:Reference[]=[];for(const [index,needed]of expected.entries()){const reference=supplied[index]!;require(reference.path===needed.path&&reference.kind===needed.kind);const slot=member(template,needed.path),original=slot.get();require(typeof original==='string'&&original.length>0);if(needed.kind==='secret')excluded.push(original);references.push(Object.freeze({...reference,valueSha256:needed.kind==='secret'?hash(original):null}));slot.set(marker(reference.referenceId));}
  const text=JSON.stringify(template);require(!excluded.some(secret=>text.includes(secret)));const recipe=Object.freeze({profile:'crest.private-configuration-recipe.v1' as const,binding:target,template:text,references:Object.freeze(references),externalMaterialAvailabilityVerified:false as const,applicationStarted:false as const,completeBackup:false as const});require(Buffer.byteLength(JSON.stringify(recipe))<=262144);return privateValue(recipe);
 }catch{throw new RecoveryConfigurationError();}
}

export function readRecoveryConfiguration(source:string,expected:Binding){
 try{
  binding(expected);require(typeof source==='string'&&Buffer.byteLength(source)<=262144);const recipe=parseEvidenceJson(source);exact(recipe,['profile','binding','template','references','externalMaterialAvailabilityVerified','applicationStarted','completeBackup']);binding(recipe.binding);const target=recipe.binding;require(Object.keys(expected).every(key=>target[key as keyof Binding]===expected[key as keyof Binding])&&recipe.profile==='crest.private-configuration-recipe.v1'&&recipe.externalMaterialAvailabilityVerified===false&&recipe.applicationStarted===false&&recipe.completeBackup===false&&typeof recipe.template==='string'&&Buffer.byteLength(recipe.template)<=65536&&Array.isArray(recipe.references));
  const template=parseEvidenceJson(recipe.template) as Record<string,unknown>;require(template.businessId===expected.businessId);const required=paths(template);require(recipe.references.length===required.length);const references:Reference[]=[];
  for(const [index,needed]of required.entries()){const ref=recipe.references[index];exact(ref,['path','kind','referenceId','valueSha256']);require(ref.path===needed.path&&ref.kind===needed.kind&&uuid(ref.referenceId)&&member(template,needed.path).get()===marker(ref.referenceId)&&(ref.kind==='file'?ref.valueSha256===null:typeof ref.valueSha256==='string'&&/^[a-f0-9]{64}$/.test(ref.valueSha256)));references.push(Object.freeze({...ref}) as Reference);}
  require(new Set(references.map(item=>item.referenceId)).size===references.length);validateTemplate(template,references);return Object.freeze({profile:recipe.profile,binding:Object.freeze({...recipe.binding}),template:recipe.template,references:Object.freeze(references),externalMaterialAvailabilityVerified:false as const,applicationStarted:false as const,completeBackup:false as const});
 }catch{throw new RecoveryConfigurationError();}
}

// The resolver is an explicit offline owner port. No provider URL, environment
// credential, process execution, file write or application start is performed.
export async function reconstructRecoveryConfiguration(input:Readonly<{source:string;expected:Binding}>,resolve:(reference:Reference,signal:AbortSignal)=>Promise<string>,signal:AbortSignal){
 try{
  signal.throwIfAborted();const recipe=readRecoveryConfiguration(input.source,input.expected),template=parseEvidenceJson(recipe.template);
  for(const reference of recipe.references){signal.throwIfAborted();const value=await resolve(reference,signal);require(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=65536&&!value.startsWith('crest-recovery-reference:')&&(reference.kind==='file'||hash(value)===reference.valueSha256));member(template,reference.path).set(value);}
  signal.throwIfAborted();const profileSource=JSON.stringify(template);parseProductionProfile(profileSource);require(Buffer.byteLength(profileSource)<=65536);return privateValue(Object.freeze({profile:'crest.reconstructed-private-configuration.v1' as const,profileSource,referenceDirectoryId:recipe.binding.referenceDirectoryId,applicationStarted:false as const,completeBackup:false as const}));
 }catch{throw new RecoveryConfigurationError();}
}

type CaptureInput=Readonly<{source:string;expected:Binding;workspace:string;recipient:string;retainUntil:string}>;
type Ports=Readonly<{attempt:Pick<Awaited<ReturnType<typeof createRecoveryAttempt>>,'view'|'publish'>;vault:Pick<ReturnType<typeof createRecoveryVault>,'publishEncryptedFile'>}>;
function compose(seal:ReturnType<typeof createRecoveryFileEncryption>){return async(input:CaptureInput,ports:Ports,signal:AbortSignal)=>{
 try{
  signal.throwIfAborted();const request=Object.freeze({...input,expected:Object.freeze({...input.expected})}),recipe=readRecoveryConfiguration(request.source,request.expected),state=ports.attempt.view(),until=Date.parse(request.retainUntil);require(!state.reviewRequired&&state.header.businessId===recipe.binding.businessId&&state.header.appReleaseId===recipe.binding.appReleaseId&&state.header.migrationRegistrySha256===recipe.binding.migrationRegistrySha256&&state.header.sourceSchemaVersion===recipe.binding.sourceSchemaVersion&&Number.isFinite(until)&&new Date(until).toISOString()===request.retainUntil&&until>=Date.now()+7*86400000&&until<=Date.now()+500*86400000);
  const bytes=Buffer.from(JSON.stringify(recipe)+'\n');let encrypted;try{encrypted=(await seal({workspace:request.workspace,recipient:request.recipient,bytes},signal)).forRecoveryTools();}finally{bytes.fill(0);}
  const artifactId=randomUUID(),artifact=await ports.attempt.publish({artifactId,purpose:'configuration',byteSize:encrypted.ciphertext.byteSize,sha256:encrypted.ciphertext.sha256,retainUntil:request.retainUntil},encrypted.path,ports.vault,signal);require(artifact.key===recoveryVaultArtifactKey(state.header.pointId,artifactId)&&artifact.byteSize===encrypted.ciphertext.byteSize&&artifact.sha256===encrypted.ciphertext.sha256&&artifact.retainUntil===request.retainUntil);await unlink(encrypted.path);signal.throwIfAborted();return privateValue(Object.freeze({profile:'crest.verified-configuration-archive.v1' as const,pointId:state.header.pointId,binding:recipe.binding,artifact,plaintext:encrypted.plaintext,externalMaterialAvailabilityVerified:false as const,applicationStarted:false as const,completeBackup:false as const}));
 }catch{throw new RecoveryConfigurationError();}
};}
export function createRecoveryConfigurationArchive(launch:RecoveryCaptureLauncher){return compose(createRecoveryFileEncryption(launch));}
export async function createPinnedRecoveryConfigurationArchive(tools:Readonly<{pgDump:string;age:string}>){return compose(await createPinnedRecoveryFileEncryption(tools));}
