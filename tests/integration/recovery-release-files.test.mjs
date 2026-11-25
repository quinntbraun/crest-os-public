import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {privateWorkspace,keyPair} from '../support/recovery-drill.mjs';
import {assertPrivateRecoveryArtifact} from '../support/private-recovery-permissions.mjs';
import {hashRecoveryReleaseFile,hashRecoveryReleaseParts} from '../../src/tooling/recovery-release-files.ts';
import {createRecoveryReleaseFileEncryption} from '../../src/tooling/recovery-database-capture.ts';

const root=new URL('../../',import.meta.url),age=fileURLToPath(new URL('.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''),root)),signal=()=>new AbortController().signal;let workspace,keys,path,expected,calls=0;
const encrypt=createRecoveryReleaseFileEncryption((command,args,environment)=>{assert.equal(command,'age');calls++;return spawn(age,args,{env:{...environment,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});});
before(async()=>{workspace=await privateWorkspace();keys=await keyPair(workspace);path=join(workspace,'source.tar');execFileSync('git',['archive','--format=tar','--output='+path,'HEAD'],{cwd:fileURLToPath(root),stdio:'pipe'});expected=await hashRecoveryReleaseFile(path,signal());assert(expected.byteSize>25*1024*1024);});
after(async()=>{if(workspace){assert.equal(dirname(resolve(workspace)),resolve(fileURLToPath(new URL('.local/recovery-drill/',root))));await rm(workspace,{recursive:true,force:true});}});

test('actual source archive streams into age and independently decrypts beyond the attachment limit',async()=>{
 const value=await encrypt({workspace,recipient:keys.recipient,path,expected},signal());assert.throws(()=>JSON.stringify(value));const evidence=value.forRecoveryTools();assert.deepEqual(evidence.plaintext,expected);assert.equal(evidence.completeBackup,false);await assertPrivateRecoveryArtifact(evidence.path);
 const child=spawn(age,['--decrypt','--identity',keys.path],{stdio:['pipe','pipe','pipe'],windowsHide:true}),closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('AGE_RESTORE_FAILED')));});let stderr=0,count=0,prefix=Buffer.alloc(0);const hash=createHash('sha256');child.stderr.on('data',chunk=>{stderr+=chunk.length;});void closed.catch(()=>{});
 try{
  await Promise.all([pipeline(createReadStream(evidence.path),child.stdin),pipeline(child.stdout,new Writable({write(chunk,_encoding,done){count+=chunk.length;if(count>expected.byteSize){done(Error('RESTORE_SIZE_REQUIRED'));return;}hash.update(chunk);if(prefix.length<4096)prefix=Buffer.concat([prefix,chunk.subarray(0,4096-prefix.length)]);done();}})),closed]);assert.equal(stderr,0);assert.equal(count,expected.byteSize);assert.equal(hash.digest('hex'),expected.sha256);assert.equal(execFileSync('git',['get-tar-commit-id'],{input:prefix,encoding:'utf8'}).trim(),execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim());
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed.catch(()=>{});}
});
test('a wrong expected digest removes unfinished encrypted release output',async()=>{const before=(await readdir(workspace)).sort();await assert.rejects(encrypt({workspace,recipient:keys.recipient,path,expected:{...expected,sha256:'0'.repeat(64)}},signal()));assert.deepEqual((await readdir(workspace)).sort(),before);});
test('wrong source size and nonfile source refuse before launching encryption',async()=>{const before=calls;await assert.rejects(encrypt({workspace,recipient:keys.recipient,path,expected:{...expected,byteSize:expected.byteSize+1}},signal()));await assert.rejects(encrypt({workspace,recipient:keys.recipient,path:workspace,expected},signal()));await assert.rejects(hashRecoveryReleaseFile(workspace,signal()));assert.equal(calls,before);});
test('encrypted release parts reassemble to the exact whole source archive without plaintext part files',async()=>{
 const plan=await hashRecoveryReleaseParts(path,signal(),8*1024*1024);assert(plan.parts.length>1);assert.equal(plan.byteSize,expected.byteSize);assert.equal(plan.sha256,expected.sha256);let offset=0;const full=createHash('sha256');
 for(const range of plan.parts){
  assert.equal(range.offset,offset);const encrypted=(await encrypt({workspace,recipient:keys.recipient,path,expected,range},signal())).forRecoveryTools();assert.equal(encrypted.offset,offset);assert.deepEqual(encrypted.source,expected);const hash=createHash('sha256');let count=0,stderr=0;const child=spawn(age,['--decrypt','--identity',keys.path],{stdio:['pipe','pipe','pipe'],windowsHide:true}),closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('AGE_PART_RESTORE_FAILED')));});child.stderr.on('data',chunk=>{stderr+=chunk.length;});void closed.catch(()=>{});
  try{await Promise.all([pipeline(createReadStream(encrypted.path),child.stdin),pipeline(child.stdout,new Writable({write(chunk,_encoding,done){count+=chunk.length;if(count>range.byteSize){done(Error('PART_SIZE_REQUIRED'));return;}hash.update(chunk);full.update(chunk);done();}})),closed]);assert.equal(stderr,0);assert.equal(count,range.byteSize);assert.equal(hash.digest('hex'),range.sha256);offset+=count;}finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed.catch(()=>{});}
 }
 assert.equal(offset,expected.byteSize);assert.equal(full.digest('hex'),expected.sha256);assert((await readdir(workspace)).every(name=>name==='source.tar'||name.startsWith('key-')||name.endsWith('.age')));
});
