import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm,chmod,lstat} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createRecoveryAlertDispatcher} from '../../src/tooling/recovery-alert-dispatch.ts';
assert.equal(process.platform,'linux');assert.equal(process.env.CREST_ENV,'test');
const roots=[],baseline='2026-11-20T00:00:00.000Z',at=hours=>new Date(Date.parse(baseline)+hours*3600000).toISOString();
after(async()=>{for(const root of roots){assert.equal(dirname(root),tmpdir());assert(basename(root).startsWith('crest-backup-alert-'));await rm(root,{recursive:true,force:true});}});
async function fixture(deliver){const directory=await mkdtemp(join(tmpdir(),'crest-backup-alert-'));roots.push(directory);let clock=8,snapshot=baseline,reads=0;const calls=[];const run=createRecoveryAlertDispatcher({directory,now:()=>at(clock),readLastVerifiedCompleteSnapshot:async()=>{reads++;return snapshot;},deliver:async(notice,signal)=>{calls.push(notice);return deliver?deliver(notice,signal,directory):{id:notice.id,acknowledged:true};}});return{directory,calls,run:(signal=new AbortController().signal)=>run(signal),clock:value=>{clock=value;},snapshot:value=>{snapshot=value;},reads:()=>reads,files:()=>readdir(directory)};}
test('a private durable reservation exists before delivery and repeated checks do not resend',async()=>{
 const f=await fixture(async(notice,_signal,directory)=>{const names=await readdir(directory),name=names.find(name=>name.endsWith('.attempt.json'));assert(name);const claim=JSON.parse(await readFile(join(directory,name),'utf8'));assert.deepEqual(claim.notice,notice);assert.equal((await lstat(join(directory,name))).mode&0o077,0);return{id:notice.id,acknowledged:true};});
 assert.equal((await f.run()).delivery,'acknowledged');assert.equal((await f.run()).delivery,'not_needed');assert.equal(f.calls.length,1);assert.equal((await f.files()).length,2);
});
test('unknown delivery persists without replay; later critical severity is a distinct attempt',async()=>{
 const f=await fixture(async()=>{throw Error('PRIVATE_TRANSPORT_ERROR_DO_NOT_ECHO');});const first=await f.run();assert.equal(first.delivery,'unknown');assert.equal(first.completeBackup,false);assert.equal((await f.run()).delivery,'not_needed');assert.equal(f.calls.length,1);f.clock(12);const second=await f.run();assert.equal(second.notification.kind,'critical');assert.equal(second.notification.incidentId,first.notification.incidentId);assert.equal(f.calls.length,2);const records=await Promise.all((await f.files()).map(name=>readFile(join(f.directory,name),'utf8')));assert(!records.join('').includes('PRIVATE_TRANSPORT_ERROR'));
});
test('the journal retains escalation, daily reminder and recovery history without claiming backup success',async()=>{
 const f=await fixture();const first=await f.run();f.clock(12);assert.equal((await f.run()).notification.kind,'critical');f.clock(24);assert.equal((await f.run()).notification.kind,'breach');f.clock(48);assert.equal((await f.run()).notification.kind,'reminder');f.clock(49);f.snapshot(at(48.5));const recovered=await f.run();assert.equal(recovered.notification.kind,'recovered');assert.equal(recovered.notification.incidentId,first.notification.incidentId);assert.equal(recovered.ordinaryFinancialWritesBlocked,false);assert.equal(recovered.completeBackup,false);assert.equal((await f.files()).length,10);assert.equal((await f.run()).notification,null);
});
test('an existing reservation without a delivery receipt is not permission to resend',async()=>{
 const f=await fixture();await f.run();const delivery=(await f.files()).find(name=>name.endsWith('.delivery.json'));await rm(join(f.directory,delivery));assert.equal((await f.run()).delivery,'not_needed');assert.equal(f.calls.length,1);
});
test('a torn attempt or unexpected journal entry refuses before catalog reads or delivery',async()=>{
 const f=await fixture();await writeFile(join(f.directory,'000001-'+'a'.repeat(64)+'.attempt.json'),'{',{mode:0o600});await assert.rejects(f.run(),{stage:'journal'});assert.equal(f.reads(),0);assert.equal(f.calls.length,0);assert.equal((await f.files()).length,1);
});
test('concurrent dispatchers cannot both deliver the same severity',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});const f=await fixture(async notice=>{entered();await gate;return{id:notice.id,acknowledged:true};});const running=f.run();await started;try{await assert.rejects(f.run(),{stage:'lock'});assert.equal(f.calls.length,1);}finally{release();}assert.equal((await running).delivery,'acknowledged');
});
test('pre-cancelled dispatch leaves no journal or notification',async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.run(controller.signal),{stage:'configuration'});assert.equal(f.calls.length,0);assert.deepEqual(await f.files(),[]);
});
test('nonprivate state directories refuse before any catalog read',async()=>{
 const f=await fixture();await chmod(f.directory,0o755);await assert.rejects(f.run(),{stage:'configuration'});assert.equal(f.reads(),0);assert.deepEqual(await f.files(),[]);
});
test('a mismatched acknowledgment is recorded as unknown and never retried',async()=>{
 const f=await fixture(async()=>({id:'a'.repeat(64),acknowledged:true}));assert.equal((await f.run()).delivery,'unknown');assert.equal((await f.run()).delivery,'not_needed');assert.equal(f.calls.length,1);
});
test('a lost catalog or regressed clock refuses without a false recovery or new send',async()=>{
 const f=await fixture();await f.run();f.clock(9);f.snapshot(null);await assert.rejects(f.run(),{stage:'policy'});assert.equal(f.calls.length,1);f.snapshot(baseline);f.clock(7);await assert.rejects(f.run(),{stage:'policy'});assert.equal(f.calls.length,1);
});
test('a leftover lock from a stopped process remains reserved for manual review',async()=>{
 const f=await fixture();await writeFile(join(f.directory,'.dispatch.lock'),'prior uncertain dispatch\n',{mode:0o600});await assert.rejects(f.run(),{stage:'lock'});assert.equal(f.calls.length,0);assert.equal(await readFile(join(f.directory,'.dispatch.lock'),'utf8'),'prior uncertain dispatch\n');
});
