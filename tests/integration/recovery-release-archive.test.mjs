import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {S3Client} from '@aws-sdk/client-s3';
import {privateWorkspace,keyPair} from '../support/recovery-drill.mjs';
import {assertPrivateRecoveryArtifact} from '../support/private-recovery-permissions.mjs';
import {serverBuildIdentity} from '../../scripts/server-build-identity.mjs';
import {hashRecoveryReleaseFile} from '../../src/tooling/recovery-release-files.ts';
import {createRecoveryReleaseFileEncryption,createRecoveryReleaseArchiveRestore,createRecoveryArtifactRestore,createRecoveryFileEncryption} from '../../src/tooling/recovery-database-capture.ts';
import {captureRecoveryReleaseArchive} from '../../src/tooling/recovery-release-archive.ts';
import {createRecoveryVault,recoveryVaultArtifactKey} from '../../src/tooling/recovery-vault.ts';
import {createRecoveryAttempt} from '../../src/tooling/recovery-attempt.ts';
import {createRecoveryReleaseDistribution,readRecoveryReleaseManifest} from '../../src/tooling/recovery-release-distribution.ts';
import {createRecoveryConfigurationArchive,reconstructRecoveryConfiguration} from '../../src/tooling/recovery-configuration.ts';
import {recoveryConfigurationFixture} from '../support/recovery-configuration-fixture.ts';

const root=new URL('../../',import.meta.url),age=fileURLToPath(new URL('.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''),root)),signal=()=>new AbortController().signal,stored=new Map(),calls=[];let workspace,keys,sourcePath,expected,archive,client,vault,attempt,server;
const launch=(command,args,env)=>{assert.equal(command,'age');return spawn(age,args,{env:{...env,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});},encrypt=createRecoveryReleaseFileEncryption(launch),restore=createRecoveryReleaseArchiveRestore(launch),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

before(async()=>{
 workspace=await privateWorkspace();keys=await keyPair(workspace);sourcePath=join(workspace,'source.tar');execFileSync('git',['archive','--format=tar','--output='+sourcePath,'HEAD'],{cwd:fileURLToPath(root),stdio:'pipe'});expected=await hashRecoveryReleaseFile(sourcePath,signal());assert(expected.byteSize>25*1024*1024);
 const build=await serverBuildIdentity(),point={formatVersion:1,pointId:randomUUID(),businessId:randomUUID(),startedAt:new Date().toISOString(),appReleaseId:build.appReleaseId,migrationRegistrySha256:build.migrationRegistrySha256,sourceSchemaVersion:138},release={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),appReleaseId:build.appReleaseId,migrationRegistrySha256:build.migrationRegistrySha256,sourceSchemaVersion:138,containerImageId:null},retainUntil=new Date(Date.now()+400*86400000).toISOString();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1'),key=url.pathname.slice('/crest-release-test/'.length);calls.push({method:req.method,key,version:url.searchParams.get('versionId')});assert(req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 '));assert(url.pathname.startsWith('/crest-release-test/'));
  if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);assert.equal(req.headers['content-md5'],createHash('md5').update(bytes).digest('base64'));assert.equal(req.headers['x-amz-object-lock-mode'],'COMPLIANCE');assert.equal(req.headers['x-amz-object-lock-retain-until-date'],retainUntil);assert(!stored.has(key));const version='synthetic-'+randomUUID();stored.set(key,{bytes,version});res.writeHead(200,{'x-amz-version-id':version});res.end();return;}
  assert.equal(req.method,'GET');const value=stored.get(key);assert(value);assert.equal(url.searchParams.get('versionId'),value.version);if(url.searchParams.has('retention')){res.writeHead(200,{'content-type':'application/xml'});res.end(`<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>${retainUntil}</RetainUntilDate></Retention>`);return;}res.writeHead(200,{'content-type':'application/octet-stream','content-length':value.bytes.length,'x-amz-version-id':value.version});res.end(value.bytes);
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));client=new S3Client({region:'auto',endpoint:`http://127.0.0.1:${server.address().port}`,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});vault=createRecoveryVault(client,'crest-release-test',10000);
 // The real Linux journal is selected in CI; Windows only exercises its explicit
 // publication seam, not Linux durability or real cloud credential acceptance.
 if(process.platform==='linux')attempt=await createRecoveryAttempt(await mkdtemp(join(workspace,'journal-')),point);else attempt={view:()=>({header:point,reviewRequired:false}),publish:(reserved,path,vault,signal)=>vault.publishEncryptedFile({key:recoveryVaultArtifactKey(point.pointId,reserved.artifactId),path,retainUntil:reserved.retainUntil},signal)};
 archive=(await captureRecoveryReleaseArchive({kind:'source',release,path:sourcePath,expected,workspace,recipient:keys.recipient,retainUntil,partByteSize:8*1024*1024},{encrypt,attempt,vault},signal())).forRecoveryTools();assert(archive.parts.length>1);assert.equal(calls.filter(call=>call.method==='PUT').length,archive.parts.length);
});
after(async()=>{await attempt?.close?.();client?.destroy();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}if(workspace){assert.equal(dirname(resolve(workspace)),resolve(fileURLToPath(new URL('.local/recovery-drill/',root))));await rm(workspace,{recursive:true,force:true});}});

test('actual SDK vault parts authenticate and recover the complete Git archive in a new private file',async()=>{
 const value=await restore({archive,workspace,identityFile:keys.path},vault,signal());assert.throws(()=>JSON.stringify(value));const evidence=value.forRecoveryTools();assert.equal(evidence.authenticated,true);assert.equal(evidence.applicationLoaded,false);assert.equal(evidence.completeBackup,false);assert.deepEqual(await hashRecoveryReleaseFile(evidence.path,signal()),expected);await assertPrivateRecoveryArtifact(evidence.path);const prefix=(await readFile(evidence.path)).subarray(0,4096);assert.equal(execFileSync('git',['get-tar-commit-id'],{input:prefix,encoding:'utf8'}).trim(),archive.release.sourceCommit);assert((await readdir(workspace)).every(name=>!name.startsWith('restore-cipher-')&&!name.startsWith('.restore-home-')));
});
test('missing or reordered part metadata refuses before any vault request or destination file',async()=>{
 const before=(await readdir(workspace)).sort(),requests=calls.length;for(const bad of [{...archive,parts:archive.parts.slice(1)},{...archive,parts:[...archive.parts].reverse()},{...archive,completeBackup:true}])await assert.rejects(restore({archive:bad,workspace,identityFile:keys.path},vault,signal()),{message:'RECOVERY_RELEASE_RESTORE_REVIEW_REQUIRED'});assert.equal(calls.length,requests);assert.deepEqual((await readdir(workspace)).sort(),before);
});
test('ciphertext with a matching transport hash but invalid age authentication removes partial recovery',async()=>{
 const before=(await readdir(workspace)).sort(),part=archive.parts[1],value=stored.get(part.artifact.key),original=Buffer.from(value.bytes);value.bytes=Buffer.from(original);value.bytes[value.bytes.length-1]^=1;const bad={...archive,parts:archive.parts.map((item,index)=>index===1?{...item,artifact:{...item.artifact,sha256:hash(value.bytes)}}:item)};
 try{await assert.rejects(restore({archive:bad,workspace,identityFile:keys.path},vault,signal()),{message:'RECOVERY_RELEASE_RESTORE_REVIEW_REQUIRED'});assert.deepEqual((await readdir(workspace)).sort(),before);}finally{value.bytes=original;}
});
test('a wrong whole-file checksum removes the otherwise authenticated assembled output',async()=>{
 const before=(await readdir(workspace)).sort();await assert.rejects(restore({archive:{...archive,sha256:'0'.repeat(64)},workspace,identityFile:keys.path},vault,signal()),{message:'RECOVERY_RELEASE_RESTORE_REVIEW_REQUIRED'});assert.deepEqual((await readdir(workspace)).sort(),before);
});

// A deliberately synthetic image fixture tests distribution custody and binding.
// It is never loaded, started or described as an accepted Crest application image.
async function distributionFixture(){
 const imagePath=join(workspace,'synthetic-image-fixture.tar'),imageBytes=Buffer.from('Synthetic image fixture only; not a Docker application image.\n');await writeFile(imagePath,imageBytes,{flag:'wx',mode:0o600});
 const buildIdentity=await serverBuildIdentity(),digest=async path=>hash(await readFile(new URL(path,root))),imageArchive={file:'crest-os-image.tar',byteSize:imageBytes.length,sha256:hash(imageBytes)},manifest={formatVersion:2,sourceCommit:archive.release.sourceCommit,workingTreeDirty:false,nodeVersion:process.versions.node,packageManager:'npm@11.19.1',lockfileSha256:await digest('package-lock.json'),migrationRegistrySha256:buildIdentity.migrationRegistrySha256,canonicalMaintenanceSha256:await digest('docs/CANONICAL_MAINTENANCE.json'),toolchainSha256:await digest('release/toolchain.json'),compatibility:JSON.parse(await readFile(new URL('release/compatibility.json',root),'utf8')),containerImageId:'sha256:'+hash(imageBytes),buildIdentity,distributionDigest:'sha256:'+imageArchive.sha256,imageArchive,sourceArchive:{file:'crest-os-source.tar',...expected},productionActivation:'blocked'};
 return{imagePath,imageBytes,manifest};
}
let distribution;
test('distribution refuses incomplete, dirty or foreign release identity before vault dispatch',async()=>{
 distribution=await distributionFixture();const before=(await readdir(workspace)).sort(),requests=calls.length,run=createRecoveryReleaseDistribution(launch),input={manifest:distribution.manifest,sourcePath,imagePath:distribution.imagePath,workspace,recipient:keys.recipient,retainUntil:archive.parts[0].artifact.retainUntil};
 for(const manifest of [{...distribution.manifest,imageArchive:null},{...distribution.manifest,workingTreeDirty:true},{...distribution.manifest,distributionDigest:'sha256:'+'0'.repeat(64)},{...distribution.manifest,containerImageId:null},{...distribution.manifest,buildIdentity:{...distribution.manifest.buildIdentity,appReleaseId:'0'.repeat(40)}}])await assert.rejects(run({...input,manifest},{attempt,vault},signal()),{message:'RECOVERY_RELEASE_DISTRIBUTION_REVIEW_REQUIRED'});
 assert.throws(()=>readRecoveryReleaseManifest({...distribution.manifest,unreviewedField:true}));const foreign={...distribution.manifest,buildIdentity:{...distribution.manifest.buildIdentity,sourceContentSha256:'f'.repeat(64),appReleaseId:'f'.repeat(40)}};await assert.rejects(run({...input,manifest:foreign},{attempt,vault},signal()));assert.equal(calls.length,requests);assert.deepEqual((await readdir(workspace)).sort(),before);
});
test('both release archives and exact build manifest gain encrypted version-pinned distribution custody',async()=>{
 const run=createRecoveryReleaseDistribution(launch),result=await run({manifest:distribution.manifest,sourcePath,imagePath:distribution.imagePath,workspace,recipient:keys.recipient,retainUntil:archive.parts[0].artifact.retainUntil,partByteSize:8*1024*1024},{attempt,vault},signal());assert.throws(()=>JSON.stringify(result));const proof=result.forRecoveryTools();assert.equal(proof.completeBackup,false);assert.equal(proof.configurationIncluded,false);assert.equal(proof.offlineKeyCustodyVerified,false);assert.equal(proof.applicationLoaded,false);
 const index=JSON.parse(execFileSync(age,['--decrypt','--identity',keys.path],{input:stored.get(proof.manifest.key).bytes,maxBuffer:1048576,windowsHide:true}).toString('utf8'));assert.deepEqual(index.buildManifest,distribution.manifest);assert.deepEqual(index.archives.map(value=>value.kind),['source','image']);assert.equal(index.archives[0].sha256,expected.sha256);assert.equal(index.archives[0].byteSize,expected.byteSize);for(const item of index.archives){assert.equal(item.release.containerImageId,distribution.manifest.containerImageId);assert.deepEqual(item.release,proof.release);assert(item.parts.every(part=>stored.get(part.artifact.key).version===part.artifact.versionId));}
 const restored=(await restore({archive:index.archives[1],workspace,identityFile:keys.path},vault,signal())).forRecoveryTools();assert.deepEqual(await readFile(restored.path),distribution.imageBytes);assert.equal(restored.applicationLoaded,false);
});
test('a missing or changed image refuses before even source archive publication',async()=>{
 const before=(await readdir(workspace)).sort(),requests=calls.length,run=createRecoveryReleaseDistribution(launch),input={manifest:distribution.manifest,sourcePath,imagePath:distribution.imagePath,workspace,recipient:keys.recipient,retainUntil:archive.parts[0].artifact.retainUntil};await assert.rejects(run({...input,imagePath:join(workspace,'missing-image.tar')},{attempt,vault},signal()));await writeFile(distribution.imagePath,Buffer.from('Changed image fixture.\n'));await assert.rejects(run(input,{attempt,vault},signal()));assert.equal(calls.length,requests);assert.deepEqual((await readdir(workspace)).sort(),before);
});

let configurationEvidence;
test('secret-reference configuration survives actual age and versioned SDK custody then reconstructs only offline',async()=>{
 const header=attempt.view().header,fixture=recoveryConfigurationFixture({businessId:header.businessId,appReleaseId:header.appReleaseId,migrationRegistrySha256:header.migrationRegistrySha256,sourceSchemaVersion:138,referenceDirectoryId:randomUUID()}),run=createRecoveryConfigurationArchive(launch),result=await run({source:fixture.source,expected:fixture.target,workspace,recipient:keys.recipient,retainUntil:archive.parts[0].artifact.retainUntil},{attempt,vault},signal());assert.throws(()=>JSON.stringify(result));const proof=result.forRecoveryTools();assert.equal(proof.externalMaterialAvailabilityVerified,false);assert.equal(proof.completeBackup,false);assert.equal(proof.applicationStarted,false);
 configurationEvidence=proof;const recovered=(await createRecoveryArtifactRestore(launch)({kind:'metadata',artifact:proof.artifact,plaintext:proof.plaintext,workspace,identityFile:keys.path},vault,signal())).forRecoveryTools();assert.equal(recovered.authenticated,true);assert.equal(recovered.applied,false);assert.equal(recovered.rendered,false);await assertPrivateRecoveryArtifact(recovered.path);const plain=await readFile(recovered.path);try{
  assert.equal(hash(plain),proof.plaintext.sha256);assert.equal(plain.length,proof.plaintext.byteSize);const source=plain.toString('utf8');for(const ref of fixture.references.filter(item=>item.kind==='secret'))assert(!source.includes(fixture.material.get(ref.referenceId)));assert.deepEqual(JSON.parse(source),fixture.recipe);
  const restored=await reconstructRecoveryConfiguration({source,expected:fixture.target},async reference=>fixture.material.get(reference.referenceId),signal());assert.throws(()=>JSON.stringify(restored));assert.deepEqual(JSON.parse(restored.forRecoveryTools().profileSource),fixture.profile);assert.equal(restored.forRecoveryTools().applicationStarted,false);
  await assert.rejects(reconstructRecoveryConfiguration({source,expected:fixture.target},async()=>{throw Error('offline material missing');},signal()),{message:'RECOVERY_CONFIGURATION_REVIEW_REQUIRED'});
 }finally{plain.fill(0);}
});

test('artifact reader removes plaintext on wrong digest while preserving existing recovered files',async()=>{
 const before=(await readdir(workspace)).sort();await assert.rejects(createRecoveryArtifactRestore(launch)({kind:'metadata',artifact:configurationEvidence.artifact,plaintext:{...configurationEvidence.plaintext,sha256:'0'.repeat(64)},workspace,identityFile:keys.path},vault,signal()),{message:'RECOVERY_ARTIFACT_RESTORE_REVIEW_REQUIRED'});assert.deepEqual((await readdir(workspace)).sort(),before);
});
test('artifact reader rejects age tampering even after the transport digest is changed',async()=>{
 const before=(await readdir(workspace)).sort(),value=stored.get(configurationEvidence.artifact.key),original=Buffer.from(value.bytes);value.bytes=Buffer.from(original);value.bytes[value.bytes.length-1]^=1;try{await assert.rejects(createRecoveryArtifactRestore(launch)({kind:'metadata',artifact:{...configurationEvidence.artifact,sha256:hash(value.bytes)},plaintext:configurationEvidence.plaintext,workspace,identityFile:keys.path},vault,signal()),{message:'RECOVERY_ARTIFACT_RESTORE_REVIEW_REQUIRED'});assert.deepEqual((await readdir(workspace)).sort(),before);}finally{value.bytes=original;}
});
test('empty raw quarantine bytes recover without rendering and cannot masquerade as metadata',async()=>{
 const sealed=(await createRecoveryFileEncryption(launch)({workspace,recipient:keys.recipient,bytes:Buffer.alloc(0)},signal())).forRecoveryTools(),artifact=await attempt.publish({artifactId:randomUUID(),purpose:'quarantine',byteSize:sealed.ciphertext.byteSize,sha256:sealed.ciphertext.sha256,retainUntil:archive.parts[0].artifact.retainUntil},sealed.path,vault,signal()),read=createRecoveryArtifactRestore(launch),input={kind:'quarantine',artifact,plaintext:sealed.plaintext,workspace,identityFile:keys.path};const recovered=(await read(input,vault,signal())).forRecoveryTools();assert.equal((await readFile(recovered.path)).length,0);assert.equal(recovered.rendered,false);assert.equal(recovered.applied,false);const before=(await readdir(workspace)).sort(),requests=calls.length;await assert.rejects(read({...input,kind:'metadata'},vault,signal()),{message:'RECOVERY_ARTIFACT_RESTORE_REVIEW_REQUIRED'});assert.deepEqual((await readdir(workspace)).sort(),before);assert.equal(calls.length,requests);
});
