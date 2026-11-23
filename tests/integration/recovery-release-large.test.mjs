import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,open,writeFile,copyFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRecoveryReleaseFileEncryption,createRecoveryReleaseArchiveRestore} from '../../src/tooling/recovery-database-capture.ts';
import {captureRecoveryReleaseArchive} from '../../src/tooling/recovery-release-archive.ts';
import {hashRecoveryReleaseFile} from '../../src/tooling/recovery-release-files.ts';
assert.equal(process.env.CREST_ENV,'test');
const age=process.env.CREST_TEST_RECOVERY_AGE;assert(age);
const launch=(command,args,env)=>{assert.equal(command,'age');return spawn(age,args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true});};
async function keygen(args){return new Promise((resolve,reject)=>{const child=spawn(join(dirname(age),'age-keygen'+(process.platform==='win32'?'.exe':'')),args,{stdio:['pipe','pipe','pipe'],windowsHide:true}),chunks=[];child.stdin.end();child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.resume();child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error('AGE_TEST_FAILED')));});}
test('standard age overhead above 256MiB survives default part capture and authenticated full restore',{timeout:120000},async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'crest-release-large-')),signal=AbortSignal.timeout(110000);
 try{
  const identity=join(workspace,'identity.txt');await writeFile(identity,await keygen([]),{flag:'wx',mode:0o600});
  const recipient=(await keygen(['-y',identity])).toString().trim(),source=join(workspace,'image.tar'),file=await open(source,'wx',0o600);
  try{await file.truncate(256*1024*1024+17);await file.write(Buffer.from('Crest large release boundary'),0,28,12345);await file.sync();}finally{await file.close();}
  const expected=await hashRecoveryReleaseFile(source,signal),vaultRoot=join(workspace,'vault');await mkdir(vaultRoot,{mode:0o700});const entries=new Map();
  const retainUntil=new Date(Date.now()+8*86400000).toISOString(),pointId=randomUUID(),release={sourceCommit:'a'.repeat(40),appReleaseId:'b'.repeat(40),migrationRegistrySha256:'c'.repeat(64),sourceSchemaVersion:138,containerImageId:'sha256:'+'d'.repeat(64)};
  const vault={async publishEncryptedFile(input){const destination=join(vaultRoot,randomUUID()+'.age');await copyFile(input.path,destination);const artifact={key:input.key,versionId:randomUUID(),...await hashRecoveryReleaseFile(destination,signal),retainUntil:input.retainUntil};entries.set(artifact.key,{artifact,destination});return artifact;},async retrieveEncryptedFile(artifact,destination){const saved=entries.get(artifact.key);assert(saved);assert.deepEqual(saved.artifact,artifact);await copyFile(saved.destination,destination);return saved.artifact;}};
  const attempt={view:()=>({reviewRequired:false,header:{...release,pointId}}),publish:(reservation,path)=>vault.publishEncryptedFile({key:'recovery/'+pointId+'/artifacts/'+reservation.artifactId+'.age',path,retainUntil})};
  const archive=(await captureRecoveryReleaseArchive({kind:'image',release,path:source,expected,workspace,recipient,retainUntil},{encrypt:createRecoveryReleaseFileEncryption(launch),attempt,vault},signal)).forRecoveryTools();
  assert.equal(archive.parts.length,2);const first=archive.parts[0];assert.equal(first.plaintext.byteSize,256*1024*1024);assert(first.artifact.byteSize>first.plaintext.byteSize+65536);
  const restored=(await createRecoveryReleaseArchiveRestore(launch)({archive,workspace,identityFile:identity},vault,signal)).forRecoveryTools();assert.equal(restored.authenticated,true);assert.equal(restored.completeBackup,false);assert.deepEqual(await hashRecoveryReleaseFile(restored.path,signal),expected);
 }finally{assert.equal(dirname(workspace),tmpdir());assert(basename(workspace).startsWith('crest-release-large-'));await rm(workspace,{recursive:true,force:true});}
});
