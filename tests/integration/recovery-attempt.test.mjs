import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,chmod,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRecoveryAttempt,inspectRecoveryAttempt} from '../../src/tooling/recovery-attempt.ts';
import {recoveryVaultArtifactKey} from '../../src/tooling/recovery-vault.ts';

const linux={skip:process.platform!=='linux'},signal=()=>new AbortController().signal;
const header=()=>({formatVersion:1,pointId:randomUUID(),businessId:randomUUID(),startedAt:new Date().toISOString(),appReleaseId:'a'.repeat(40),migrationRegistrySha256:'b'.repeat(64),sourceSchemaVersion:137});
const reservation=()=>({artifactId:randomUUID(),purpose:'database',byteSize:100,sha256:'c'.repeat(64),retainUntil:new Date(Date.now()+400*86400000).toISOString()});
const receipt=(point,reserved)=>({key:recoveryVaultArtifactKey(point.pointId,reserved.artifactId),versionId:'synthetic-version',byteSize:reserved.byteSize,sha256:reserved.sha256,retainUntil:reserved.retainUntil});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'crest-recovery-journal-'));await chmod(directory,0o700);const point=header();return{directory,point,path:join(directory,point.pointId+'.jsonl'),async close(){await rm(directory,{recursive:true,force:true});}};}

test('reservation is fsynced before dispatch; verified ciphertext receipt survives close',linux,async()=>{
 const f=await fixture();let journal;try{
  journal=await createRecoveryAttempt(f.directory,f.point);const reserved=reservation();let dispatched=0;
  const result=await journal.publish(reserved,'/private/not-written-here.age',{async publishEncryptedFile(input){
   dispatched++;const persisted=inspectRecoveryAttempt(await readFile(f.path,'utf8'));assert.equal(persisted.artifacts[0].state,'reserved');assert.equal(persisted.reviewRequired,true);assert.equal(input.key,recoveryVaultArtifactKey(f.point.pointId,reserved.artifactId));return receipt(f.point,reserved);
  }},signal());assert.deepEqual(result,receipt(f.point,reserved));assert.equal(dispatched,1);assert.equal(journal.view().completeBackup,false);await journal.close();journal=undefined;
  const text=await readFile(f.path,'utf8'),persisted=inspectRecoveryAttempt(text);assert.equal(persisted.artifacts[0].state,'verified');assert.equal(persisted.reviewRequired,false);assert.equal(persisted.completeBackup,false);assert(!text.includes('/private/'));assert.equal((await stat(f.path)).mode&0o077,0);
 }finally{await journal?.close();await f.close();}
});
test('lost upload acknowledgement is durable uncertainty and cannot dispatch again',linux,async()=>{
 const f=await fixture();let journal;try{
  journal=await createRecoveryAttempt(f.directory,f.point);let calls=0;const vault={async publishEncryptedFile(){calls++;throw Error('credential-bearing internal provider failure');}};
  await assert.rejects(journal.publish(reservation(),'/private/cipher.age',vault,signal()),{message:'RECOVERY_ATTEMPT_REVIEW_REQUIRED'});assert.equal(inspectRecoveryAttempt(await readFile(f.path,'utf8')).artifacts[0].state,'uncertain');
  await assert.rejects(journal.publish(reservation(),'/private/cipher.age',vault,signal()),{message:'RECOVERY_ATTEMPT_REVIEW_REQUIRED'});assert.equal(calls,1);await journal.close();journal=undefined;
  const original=await readFile(f.path,'utf8');assert(!original.includes('credential-bearing'));await assert.rejects(createRecoveryAttempt(f.directory,f.point));assert.equal(await readFile(f.path,'utf8'),original);
 }finally{await journal?.close();await f.close();}
});
for(const changed of ['key','byteSize','sha256','retainUntil','versionId'])test('changed '+changed+' receipt is uncertain, never verified',linux,async()=>{
 const f=await fixture();let journal;try{journal=await createRecoveryAttempt(f.directory,f.point);const reserved=reservation(),bad={...receipt(f.point,reserved),[changed]:changed==='byteSize'?101:changed==='versionId'?'null':'foreign'};await assert.rejects(journal.publish(reserved,'/private/cipher.age',{async publishEncryptedFile(){return bad;}},signal()));assert.equal(inspectRecoveryAttempt(await readFile(f.path,'utf8')).artifacts[0].state,'uncertain');}finally{await journal?.close();await f.close();}
});
test('concurrent publisher is refused before dispatch and completed artifact cannot repeat',linux,async()=>{
 const f=await fixture();let journal,release;try{
  journal=await createRecoveryAttempt(f.directory,f.point);const reserved=reservation();let calls=0;const wait=new Promise(resolve=>{release=resolve;});
  const first=journal.publish(reserved,'/private/cipher.age',{async publishEncryptedFile(){calls++;await wait;return receipt(f.point,reserved);}},signal());await assert.rejects(journal.publish(reservation(),'/private/other.age',{async publishEncryptedFile(){calls++;throw Error('unreachable');}},signal()));release();await first;
  await assert.rejects(journal.publish(reserved,'/private/cipher.age',{async publishEncryptedFile(){calls++;throw Error('unreachable');}},signal()));assert.equal(calls,1);
 }finally{release?.();await journal?.close();await f.close();}
});
test('a second writer cannot steal the existing lock',linux,async()=>{
 const f=await fixture();let journal;try{journal=await createRecoveryAttempt(f.directory,f.point);await assert.rejects(createRecoveryAttempt(f.directory,f.point));await stat(join(f.directory,f.point.pointId+'.lock'));assert.equal(journal.view().header.pointId,f.point.pointId);}finally{await journal?.close();await f.close();}
});
test('corrupt, truncated or reordered durable history is rejected',linux,async()=>{
 const f=await fixture();let journal;try{
  journal=await createRecoveryAttempt(f.directory,f.point);const reserved=reservation();await journal.publish(reserved,'/private/cipher.age',{async publishEncryptedFile(){return receipt(f.point,reserved);}},signal());const text=await readFile(f.path,'utf8'),lines=text.trimEnd().split('\n');
  for(const bad of [text.slice(0,-1),text.replace('synthetic-version','other-version'),[lines[1],lines[0],lines[2]].join('\n')+'\n',text+lines[2]+'\n'])assert.throws(()=>inspectRecoveryAttempt(bad),{message:'RECOVERY_ATTEMPT_REVIEW_REQUIRED'});
 }finally{await journal?.close();await f.close();}
});
test('unprivate directory is rejected before creating a lock or journal',linux,async()=>{
 const f=await fixture();try{await chmod(f.directory,0o755);await assert.rejects(createRecoveryAttempt(f.directory,f.point));await assert.rejects(stat(f.path),{code:'ENOENT'});}finally{await f.close();}
});
test('process death retains a reserved artifact and never steals its abandoned lock',{...linux,timeout:30000},async()=>{
 const f=await fixture();let child;try{
  const source=new URL('../../src/tooling/recovery-attempt.ts',import.meta.url).href;
  const code=`setInterval(()=>{},1000);const {createRecoveryAttempt}=await import(process.argv[1]);const journal=await createRecoveryAttempt(process.argv[2],JSON.parse(process.argv[3]));await journal.publish(JSON.parse(process.argv[4]),'/private/cipher.age',{async publishEncryptedFile(){process.stdout.write('RESERVED\\n');return new Promise(()=>{});}},new AbortController().signal);`;
  child=spawn(process.execPath,['--input-type=module','-e',code,source,f.directory,JSON.stringify(f.point),JSON.stringify(reservation())],{stdio:['ignore','pipe','pipe']});let output='';await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('RESERVED\n'))resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('fixture exited before reservation')));});const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const persisted=inspectRecoveryAttempt(await readFile(f.path,'utf8'));assert.equal(persisted.artifacts[0].state,'reserved');assert.equal(persisted.reviewRequired,true);assert.equal(persisted.completeBackup,false);await assert.rejects(createRecoveryAttempt(f.directory,f.point));await stat(join(f.directory,f.point.pointId+'.lock'));
 }finally{if(child?.exitCode===null&&child?.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await f.close();}
});
