// Real private Linux files/directory fsync; controlled capture and HTTP ports.
// This verifies composition and failure semantics, not a provider/DB restore.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,lstat,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createRecoveryCaptureController} from '../../src/tooling/recovery-capture-controller.ts';
import {createRecoveryMonitorAttempt} from '../../src/tooling/recovery-monitor.ts';
assert.equal(process.platform,'linux','Actual Linux durability is required');assert.equal(process.env.CREST_ENV,'test');
const directories=[];
after(async()=>{for(const directory of directories){assert.equal(dirname(directory),tmpdir());assert(basename(directory).startsWith('crest-capture-controller-'));await rm(directory,{recursive:true,force:true});}});
async function fixture(options={}){
 const directory=options.directory??await mkdtemp(join(tmpdir(),'crest-capture-controller-'));if(!options.directory)directories.push(directory);
 const pointId=options.pointId??randomUUID(),startedAt=new Date(Date.now()-1000).toISOString(),header={formatVersion:1,pointId,businessId:randomUUID(),startedAt,appReleaseId:'a'.repeat(40),migrationRegistrySha256:'b'.repeat(64),sourceSchemaVersion:138},artifactId=randomUUID();
 const manifest={key:`recovery/${pointId}/artifacts/${artifactId}.age`,versionId:'fixture-version',byteSize:100,sha256:'c'.repeat(64),retainUntil:'2028-01-01T00:00:00.000Z'},artifacts=[],requests=[];let captureCount=0,closeCount=0;
 const monitor=createRecoveryMonitorAttempt('https://hc-ping.com/'+randomUUID(),{runId:pointId,startedAt},async(url,request)=>{
  requests.push({url:String(url),body:JSON.parse(request.body),aborted:request.signal.aborted});
  if(options.startFailure&&requests.length===1||options.failureUnknown&&String(url).includes('/fail?'))throw Error('PRIVATE_MONITOR_PROVIDER_DETAIL');
  return new Response('OK',{status:200});
 });
 const client=new pg.Client();client.end=async()=>{closeCount++;if(options.closeFailure)throw Error('PRIVATE_CONNECTION_DETAIL');};
 const attempt={view:()=>({header,artifacts,reviewRequired:false,completeBackup:false})},request={client,businessId:header.businessId,expectedAppReleaseId:header.appReleaseId,migrationRegistrySha256:header.migrationRegistrySha256,database:{connectionString:'PRIVATE_DATABASE_CREDENTIAL'}};
 const evidence={profile:'crest.verified-recovery-run-candidate.v1',pointId,snapshotId:'00000001-00000002-1',manifest,manifestPlaintext:{byteSize:100,sha256:'d'.repeat(64)},completeBackup:false};
 const capture=async()=>{captureCount++;options.onCapture?.();if(options.captureFailure)throw Error('PRIVATE_CAPTURE_SOURCE_PATH');artifacts.push({state:'verified',reservation:{artifactId,purpose:options.wrongPurpose?'original':'manifest'},artifact:manifest});return Object.freeze({forRecoveryTools:()=>evidence,toJSON(){throw Error('PRIVATE_RESULT');}});};
 return{directory,pointId,request,monitor,requests,input:{request,ports:{attempt},recordDirectory:directory,monitor},capture,counts:()=>({captureCount,closeCount}),record:name=>readFile(join(directory,'run-'+pointId,name),'utf8'),run:signal=>createRecoveryCaptureController(capture)({request,ports:{attempt},recordDirectory:directory,monitor},signal??new AbortController().signal)};
}
test('persists a private candidate review record, retains its opaque result, and sends start/failure only',async()=>{
 const f=await fixture(),result=await f.run(),value=result.forRecoveryTools();assert.throws(()=>JSON.stringify(result));
 assert.equal(value.state,'candidate_review_required');assert.equal(value.completeBackup,false);assert.equal(value.candidate.forRecoveryTools().pointId,f.pointId);assert.equal(value.startAcknowledged,true);assert.equal(value.failureAcknowledged,true);
 const finish=JSON.parse(await f.record('finished.json'));assert.equal(finish.completeBackup,false);assert.equal(finish.state,'candidate_review_required');assert.equal(finish.startAcknowledged,true);
 assert.deepEqual(f.counts(),{captureCount:1,closeCount:1});assert.equal(f.requests.length,2);assert(f.requests[0].url.includes('/start?'));assert(f.requests[1].url.includes('/fail?'));assert.equal(f.requests[1].body.category,'recovery_review');
 for(const name of await readdir(join(f.directory,'run-'+f.pointId))){const info=await lstat(join(f.directory,'run-'+f.pointId,name));assert.equal(info.mode&0o077,0);assert.equal(info.uid,process.getuid());assert(!/PRIVATE_|hc-ping|connectionString/.test(await f.record(name)));}
 assert.deepEqual(JSON.parse(await f.record('monitor.json')),{profile:'crest.recovery-capture-monitor.v1',pointId:f.pointId,startedAt:value.startedAt,startAcknowledged:true,failureAcknowledged:true,completeBackup:false});
});
test('never reopens an existing point directory or automatically repeats its capture',async()=>{
 const original=await fixture();await original.run();const bytes=await original.record('finished.json'),retry=await fixture({directory:original.directory,pointId:original.pointId});
 await assert.rejects(retry.run(),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'journal'});assert.deepEqual(retry.counts(),{captureCount:0,closeCount:1});assert.equal(retry.requests.length,0);assert.equal(await original.record('finished.json'),bytes);
});
test('preserves failed capture category without private exception content',async()=>{
 const f=await fixture({captureFailure:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'capture'});
 const finish=JSON.parse(await f.record('finished.json'));assert.equal(finish.state,'failed');assert.equal(finish.stage,'capture');assert.equal(finish.completeBackup,false);assert(!JSON.stringify(finish).includes('PRIVATE_'));assert.equal(f.requests[1].body.category,'capture');assert.equal(f.counts().closeCount,1);
});
test('continues capture after an uncertain start signal and records both acknowledgments separately',async()=>{
 const f=await fixture({startFailure:true}),value=(await f.run()).forRecoveryTools();assert.equal(value.startAcknowledged,false);assert.equal(value.failureAcknowledged,true);assert.equal(f.requests.length,2);assert.equal(JSON.parse(await f.record('finished.json')).startAcknowledged,false);
});
test('refuses a candidate whose claimed manifest was not reserved as a manifest',async()=>{
 const f=await fixture({wrongPurpose:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'capture'});assert.equal(JSON.parse(await f.record('finished.json')).state,'failed');assert.equal(f.requests[1].body.category,'capture');
});
test('pre-cancelled capture creates no run directory and still closes its owned connection',async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.run(controller.signal),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'binding'});assert.deepEqual(await readdir(f.directory),[]);assert.equal(f.requests.length,0);assert.deepEqual(f.counts(),{captureCount:0,closeCount:1});
});
test('uses an independent bounded failure signal after capture cancellation',async()=>{
 const controller=new AbortController(),f=await fixture({captureFailure:true,onCapture:()=>controller.abort()});await assert.rejects(f.run(controller.signal),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'capture'});assert.equal(f.requests[1].aborted,false);assert.equal(f.requests[1].body.category,'cancelled');assert.equal(JSON.parse(await f.record('finished.json')).state,'failed');
});
test('retains an unknown failure acknowledgment without retries or success',async()=>{
 const f=await fixture({failureUnknown:true}),value=(await f.run()).forRecoveryTools();assert.equal(value.failureAcknowledged,false);assert.equal(value.completeBackup,false);assert.equal(f.requests.length,2);assert.equal(JSON.parse(await f.record('monitor.json')).failureAcknowledged,false);
});
test('refuses a non-private record parent before dispatch',async()=>{
 const f=await fixture();await chmod(f.directory,0o755);await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'binding'});assert.equal(f.requests.length,0);assert.equal(f.counts().captureCount,0);await chmod(f.directory,0o700);
});
test('connection cleanup failure cannot return a successful controller result',async()=>{
 const f=await fixture({closeFailure:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_RUN_REVIEW_REQUIRED',stage:'cleanup'});assert.equal(f.requests[1].body.category,'capture');assert.equal(JSON.parse(await f.record('finished.json')).completeBackup,false);
});
