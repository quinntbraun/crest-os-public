import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,copyFile,mkdir,rm,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateWorkspace,keyPair} from '../support/recovery-drill.mjs';
import {readRecoveryReleaseManifest} from '../../src/tooling/recovery-release-distribution.ts';
import {captureRecoveryReleaseArchive} from '../../src/tooling/recovery-release-archive.ts';
import {createRecoveryReleaseFileEncryption,createRecoveryReleaseArchiveRestore} from '../../src/tooling/recovery-database-capture.ts';
import {createRecoveryImageIdentityVerifier} from '../../src/tooling/recovery-image-identity.ts';
const signal=()=>AbortSignal.timeout(300000),docker=process.env.CREST_TEST_DOCKER_BINARY??'docker';
let workspace,manifest,recovered,verify,commands=[];
before(async()=>{
 assert.equal(process.env.CREST_ENV,'test');const manifestPath=process.env.CREST_TEST_RECOVERY_IMAGE_MANIFEST,imagePath=process.env.CREST_TEST_RECOVERY_IMAGE_ARCHIVE;assert(manifestPath&&isAbsolute(manifestPath));assert(imagePath&&isAbsolute(imagePath));
 const bytes=await readFile(manifestPath);assert(bytes.length<=1048576);manifest=readRecoveryReleaseManifest(JSON.parse(bytes.toString('utf8')));workspace=await privateWorkspace();const keys=await keyPair(workspace),vaultRoot=join(workspace,'file-vault');await mkdir(vaultRoot);const entries=new Map(),retainUntil=new Date(Date.now()+8*86400000).toISOString(),pointId=randomUUID();
 // Real standard encryption/authentication and release production functions;
 // disk-backed fixture receipts isolate provider transport/retention acceptance.
 const vault={async publishEncryptedFile(input){const destination=join(vaultRoot,randomUUID()+'.age');await copyFile(input.path,destination,constants.COPYFILE_EXCL);const {hashRecoveryReleaseFile}=await import('../../src/tooling/recovery-release-files.ts'),info=await hashRecoveryReleaseFile(destination,signal()),artifact=Object.freeze({key:input.key,versionId:'disk-fixture-'+randomUUID(),...info,retainUntil:input.retainUntil});entries.set(input.key,{destination,artifact});return artifact;},async retrieveEncryptedFile(artifact,destination){const found=entries.get(artifact.key);assert(found);assert.deepEqual(artifact,found.artifact);await copyFile(found.destination,destination,constants.COPYFILE_EXCL);return found.artifact;}};
 const age=resolve('.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':'')),launch=(command,args,env)=>{assert.equal(command,'age');return spawn(age,args,{env:{...env,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});};
 const header={formatVersion:1,pointId,businessId:randomUUID(),startedAt:new Date().toISOString(),appReleaseId:manifest.release.appReleaseId,migrationRegistrySha256:manifest.release.migrationRegistrySha256,sourceSchemaVersion:manifest.release.sourceSchemaVersion},attempt={view:()=>({header,reviewRequired:false}),publish:(reservation,path,vault)=>vault.publishEncryptedFile({key:'recovery/'+pointId+'/artifacts/'+reservation.artifactId+'.age',path,retainUntil:reservation.retainUntil},signal())};
 const {byteSize,sha256}=manifest.imageArchive,archive=(await captureRecoveryReleaseArchive({kind:'image',release:manifest.release,path:imagePath,expected:{byteSize,sha256},workspace,recipient:keys.recipient,retainUntil},{encrypt:createRecoveryReleaseFileEncryption(launch),attempt,vault},signal())).forRecoveryTools();
 recovered=await createRecoveryReleaseArchiveRestore(launch)({archive,workspace,identityFile:keys.path},vault,signal());
 execFileSync(docker,['image','load','--input',recovered.forRecoveryTools().path],{encoding:'utf8',timeout:120000,maxBuffer:1048576,windowsHide:true});
 verify=createRecoveryImageIdentityVerifier(args=>{commands.push(args);return spawn(docker,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});});
});
after(async()=>{if(workspace){assert.equal(dirname(resolve(workspace)),resolve('.local/recovery-drill'));await rm(workspace,{recursive:true,force:true});}});
test('actual encrypted application archive recovers and matches the compiled and file build identity',async()=>{
 const result=await verify({archive:recovered,buildManifest:manifestForRead()},signal()),evidence=result.forRecoveryTools();assert.throws(()=>JSON.stringify(result));assert.equal(evidence.imageId,manifest.release.containerImageId);assert.equal(evidence.appReleaseId,manifest.release.appReleaseId);assert.equal(evidence.compiledAndFileIdentityVerified,true);assert.equal(evidence.archiveAuthenticated,true);assert.equal(evidence.runtimeActivated,false);assert.equal(evidence.completeBackup,false);
 const args=commands.find(args=>args[0]==='run');assert(args);for(const value of ['--pull=never','--read-only','no-new-privileges','--no-healthcheck'])assert(args.includes(value));assert.equal(args[args.indexOf('--network')+1],'none');assert.equal(args[args.indexOf('--user')+1],'node');assert(commands.some(args=>args[0]==='container'&&args[1]==='ls'));
});
function manifestForRead(){const {release:_release,...build}=manifest;void _release;return build;}
test('copied capability and a valid but foreign expected build refuse before Docker dispatch',async()=>{
 const before=commands.length;await assert.rejects(verify({archive:{...recovered},buildManifest:manifestForRead()},signal()),{message:'RECOVERY_IMAGE_IDENTITY_REVIEW_REQUIRED',stage:'archive'});
 const foreign=manifestForRead();foreign.buildIdentity={...foreign.buildIdentity,appReleaseId:'a'.repeat(40),sourceContentSha256:'a'.repeat(64)};await assert.rejects(verify({archive:recovered,buildManifest:foreign},signal()),{message:'RECOVERY_IMAGE_IDENTITY_REVIEW_REQUIRED',stage:'binding'});assert.equal(commands.length,before);
});
test('changed recovered archive refuses before Docker while exact byte repair passes again',async()=>{
 const file=await open(recovered.forRecoveryTools().path,'r+'),original=Buffer.alloc(1);await file.read(original,0,1,0);await file.write(Buffer.from([original[0]^1]),0,1,0);await file.sync();const before=commands.length;
 try{await assert.rejects(verify({archive:recovered,buildManifest:manifestForRead()},signal()),{message:'RECOVERY_IMAGE_IDENTITY_REVIEW_REQUIRED',stage:'binding'});assert.equal(commands.length,before);}finally{await file.write(original,0,1,0);await file.sync();await file.close();}
 const repaired=await verify({archive:recovered,buildManifest:manifestForRead()},signal());assert.equal(repaired.forRecoveryTools().compiledAndFileIdentityVerified,true);
});
test('cancelled verification does not create a probe container',async()=>{
 const controller=new AbortController();controller.abort();const before=commands.length;await assert.rejects(verify({archive:recovered,buildManifest:manifestForRead()},controller.signal),{message:'RECOVERY_IMAGE_IDENTITY_REVIEW_REQUIRED',stage:'archive'});assert.equal(commands.length,before);
});
