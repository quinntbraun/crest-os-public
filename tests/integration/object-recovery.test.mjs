// Actual pinned age + private bounded create-only disk transports, generated data.
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {copyFile,unlink,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {hash,keyPair,privateWorkspace,run} from '../support/recovery-drill.mjs';
import {objectDirectory,encryptor,decryptor} from '../support/object-recovery-drill.mjs';
let directory,keys,emergencyKey,serial=0;
before(async()=>{directory=await privateWorkspace();keys=await keyPair(directory);emergencyKey=join(directory,'emergency.txt');await copyFile(keys.path,emergencyKey);});
after(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
const signal=()=>AbortSignal.timeout(30000);
async function fixture(){
  const root=join(directory,String(++serial)),source=await objectDirectory(join(root,'source')),vault=await objectDirectory(join(root,'vault')),destination=await objectDirectory(join(root,'destination'));
  const business=randomUUID(),bytes=[Buffer.from('original Unicode é 😀 private evidence\0'),Buffer.from([255,216,0,255,217]),Buffer.from('rejected bytes kept without rendering')];
  const objects=bytes.map((b,i)=>({key:i===0?`originals/${business}/${randomUUID()}`:i===1?`previews/${business}/${randomUUID()}`:`staging/${business}/${randomUUID()}/${randomUUID()}`,byteSize:b.length,sha256:hash(b),retention:['original','derivative','quarantine'][i]}));
  for(const [i,o] of objects.entries())await source.put(o.key,bytes[i],signal());
  const pointId=randomUUID(),capture={readSource:source.read,seal:encryptor(keys.recipient),putVault:vault.put,readVault:vault.read},restore={readVault:vault.read,unseal:decryptor(emergencyKey),putDestination:destination.put,readDestination:destination.read};
  return {root,source,vault,destination,bytes,objects,pointId,capture,restore};
}
const capture=f=>captureObjectArchive(f.pointId,f.objects,f.capture);
const restore=(f,r)=>restoreObjectArchive(r,f.objects,f.restore);
const failed=(work,stage)=>assert.rejects(work,e=>e.name==='ObjectRecoveryError'&&e.message==='OBJECT_RECOVERY_FAILED:'+stage&&!('cause' in e));
async function contents(f,r){return JSON.parse(Buffer.from(await f.restore.unseal(await f.vault.read(r.manifest.key,r.manifest.byteSize,signal()),signal())).toString());}
async function changedManifest(f,r,change){
  const value=await contents(f,r);change(value);const bytes=await f.capture.seal(Buffer.from(JSON.stringify(value)),signal());await writeFile(f.vault.path(r.manifest.key),bytes);
  return {...r,manifest:{...r.manifest,byteSize:bytes.length,sha256:hash(bytes)}};
}

test('actual age restores original, preview and quarantined exact bytes into a separate empty destination',async()=>{
  const f=await fixture(),r=await capture(f),result=await restore(f,r);assert.equal(result.objectCount,3);
  for(const [i,o] of f.objects.entries())assert.deepEqual(await f.destination.read(o.key,o.byteSize,signal()),f.bytes[i]);
  for(const file of await readdir(join(f.root,'vault')))assert.match((await readFile(join(f.root,'vault',file))).subarray(0,32).toString(),/^age-encryption.org\/v1/);
  assert.equal((await contents(f,r)).completeBackup,false);
});
test('fresh process restores with emergency copy after source files and original key disappear',async()=>{
  const f=await fixture(),original=await keyPair(f.root),copy=join(f.root,'emergency.txt');f.capture.seal=encryptor(original.recipient);
  const r=await capture(f);await copyFile(original.path,copy);await unlink(original.path);await rm(join(f.root,'source'),{recursive:true});
  const spec=join(f.root,'request.json');await writeFile(spec,JSON.stringify({receipt:r,inventory:f.objects}),{mode:0o600,flag:'wx'});
  const result=await run(process.execPath,['tests/support/restore-object-drill.mjs',spec,copy,join(f.root,'vault'),join(f.root,'fresh')]);assert.match(result.toString(),/^Synthetic private object restore completed/);
  const restored=await objectDirectory(join(f.root,'fresh'));for(const [i,o] of f.objects.entries())assert.deepEqual(await restored.read(o.key,o.byteSize,signal()),f.bytes[i]);
});
test('missing source prevents manifest publication and preserves prior point',async()=>{
  const prior=await fixture(),receipt=await capture(prior),f=await fixture();await unlink(f.source.path(f.objects[2].key));await failed(capture(f),'source');
  await assert.rejects(readFile(f.vault.path(`recovery/${f.pointId}/manifest.age`)),e=>e.code==='ENOENT');await restore(prior,receipt);
});
test('same-length source corruption fails independent plaintext checksum',async()=>{
  const f=await fixture();await writeFile(f.source.path(f.objects[0].key),Buffer.alloc(f.objects[0].byteSize));await failed(capture(f),'source');assert.deepEqual(await readdir(join(f.root,'vault')),[]);
});
test('missing last vault object fails preflight before any destination write',async()=>{
  const f=await fixture(),r=await capture(f),m=await contents(f,r);await unlink(f.vault.path(m.objects[2].cipher.key));await failed(restore(f,r),'vault_verify');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
});
test('truncated object fails ciphertext length before decryption or writes',async()=>{
  const f=await fixture(),r=await capture(f),m=await contents(f,r),p=f.vault.path(m.objects[1].cipher.key),b=await readFile(p);await writeFile(p,b.subarray(0,b.length-1));await failed(restore(f,r),'vault_verify');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
});
test('recomputed checksums cannot conceal authenticated ciphertext tampering',async()=>{
  const f=await fixture(),r=await capture(f),m=await contents(f,r),entry=m.objects[0],p=f.vault.path(entry.cipher.key),b=await readFile(p);b[b.length-20]^=1;await writeFile(p,b);
  const changed=await changedManifest(f,r,v=>{v.objects[0].cipher.sha256=hash(b);});await failed(restore(f,changed),'decrypt');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
});
test('wrong emergency key cannot decrypt manifest or create a destination object',async()=>{
  const f=await fixture(),r=await capture(f),wrong=await keyPair(f.root);f.restore.unseal=decryptor(wrong.path);await failed(restore(f,r),'manifest');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
});
test('missing emergency key never becomes an empty successful restore',async()=>{
  const f=await fixture(),r=await capture(f);f.restore.unseal=decryptor(join(f.root,'absent'));await failed(restore(f,r),'manifest');
});
test('snapshot inventory binds every entry even when encrypted manifest is rewritten',async()=>{
  for(const change of [m=>m.objects.pop(),m=>m.objects.reverse(),m=>{m.objects[0].sha256='0'.repeat(64);},m=>{m.objects[2].retention='original';},m=>{m.objects[0].cipher.key='../escape';},m=>{m.extra=true;}]){
    const f=await fixture(),r=await capture(f),changed=await changedManifest(f,r,change);await failed(restore(f,changed),'manifest');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
  }
});
test('receipt rejects a different point, unexpected fields and unbounded metadata before I/O',async()=>{
  const f=await fixture(),r=await capture(f);for(const invalid of [{...r,pointId:randomUUID()},{...r,extra:true},{...r,manifest:{...r.manifest,byteSize:Infinity}},{...r,manifest:{...r.manifest,key:'../../escape'}}])await failed(restore(f,invalid),'inventory');
});
test('invalid, duplicate, oversized and cross-namespace inventories fail before I/O',async()=>{
  const f=await fixture(),o=f.objects[0];let calls=0;f.capture.readSource=async()=>{calls++;throw new Error('credential-bearing URL');};
  for(const invalid of [[o,o],[{...o,key:'../escape'}],[{...o,byteSize:25*1024*1024+1}],[{...o,retention:'derivative'}],[{...o,extra:true}],Array(1001).fill(o)])await failed(captureObjectArchive(f.pointId,invalid,f.capture),'inventory');assert.equal(calls,0);
});
test('lost vault PUT response is retained and never retried or published complete',async()=>{
  const f=await fixture();let writes=0;f.capture.putVault=async(...args)=>{writes++;await f.vault.put(...args);throw new Error('secret transport detail');};await failed(capture(f),'vault_write');assert.equal(writes,1);assert.equal((await readdir(join(f.root,'vault'))).length,1);
});
test('vault readback corruption withholds the receipt',async()=>{
  const f=await fixture();f.capture.readVault=async(...args)=>{const b=await f.vault.read(...args);b[b.length-1]^=1;return b;};await failed(capture(f),'vault_verify');
});
test('destination refuses overwrite and retains existing evidence',async()=>{
  const f=await fixture(),r=await capture(f),old=Buffer.from('existing evidence');await f.destination.put(f.objects[0].key,old,signal());await failed(restore(f,r),'destination_write');assert.deepEqual(await f.destination.read(f.objects[0].key,old.length,signal()),old);
});
test('destination verification detects corrupt writes and withholds success',async()=>{
  const f=await fixture(),r=await capture(f);f.restore.putDestination=(key,b,s)=>f.destination.put(key,Buffer.alloc(b.length),s);await failed(restore(f,r),'destination_verify');
});
test('unknown destination write retains candidate without retry',async()=>{
  const f=await fixture(),r=await capture(f);let writes=0;f.restore.putDestination=async(...args)=>{writes++;await f.destination.put(...args);throw new Error('secret');};await failed(restore(f,r),'destination_write');assert.equal(writes,1);assert.equal((await readdir(join(f.root,'destination'))).length,1);
});
test('vault changes after preflight are rechecked before destination write',async()=>{
  const f=await fixture(),r=await capture(f),read=f.restore.readVault;let count=0;f.restore.readVault=async(...args)=>{const b=await read(...args);if(++count===5)b[b.length-1]^=1;return b;};await failed(restore(f,r),'vault_verify');assert.deepEqual(await readdir(join(f.root,'destination')),[]);
});
test('caller inventory mutation during encryption cannot change captured bindings',async()=>{
  const f=await fixture(),expected=structuredClone(f.objects),seal=f.capture.seal;let changed=false;f.capture.seal=async(...args)=>{if(!changed){changed=true;f.objects[2].sha256='0'.repeat(64);f.objects.pop();}return seal(...args);};
  const r=await capture(f);assert.equal((await restoreObjectArchive(r,expected,f.restore)).objectCount,3);
});
test('cancellation before dispatch does no I/O and cancellation after PUT stops verification',async()=>{
  const f=await fixture(),c=new AbortController();c.abort();await failed(captureObjectArchive(f.pointId,f.objects,f.capture,c.signal),'aborted');assert.deepEqual(await readdir(join(f.root,'vault')),[]);
  const active=new AbortController();let reads=0;f.capture.putVault=async(...args)=>{await f.vault.put(...args);active.abort();};f.capture.readVault=async(...args)=>{reads++;return f.vault.read(...args);};await failed(captureObjectArchive(f.pointId,f.objects,f.capture,active.signal),'aborted');assert.equal(reads,0);assert.equal((await readdir(join(f.root,'vault'))).length,1);
});
test('empty snapshot is explicit and does not list or invent objects',async()=>{
  const f=await fixture(),r=await captureObjectArchive(f.pointId,[],f.capture);assert.equal((await restoreObjectArchive(r,[],f.restore)).objectCount,0);
});
test('full allowed 25MiB original round trips without weakening limits',async()=>{
  const f=await fixture(),bytes=Buffer.alloc(25*1024*1024,0xa5),key=`originals/${randomUUID()}/${randomUUID()}`;
  await f.source.put(key,bytes,signal());f.objects=[{key,byteSize:bytes.length,sha256:hash(bytes),retention:'original'}];
  const r=await capture(f);await restore(f,r);assert.equal(hash(await f.destination.read(key,bytes.length,signal())),hash(bytes));
});
test('aggregate capacity is refused before transport rather than partially archived',async()=>{
  const f=await fixture();let reads=0;f.capture.readSource=async()=>{reads++;throw new Error('private');};
  const objects=Array.from({length:11},()=>({...f.objects[0],key:`originals/${randomUUID()}/${randomUUID()}`,byteSize:25*1024*1024}));
  await failed(captureObjectArchive(f.pointId,objects,f.capture),'inventory');assert.equal(reads,0);
});
