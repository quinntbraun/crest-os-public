// Real mTLS and same-release container decoders; authority/storage are deliberate
// seams. Windows uses the explicit Docker Desktop operator adapter. This does
// not claim Linux-host negative isolation, production MFA, R2 or SQL publication.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {X509Certificate,randomBytes,randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {browserTestTls} from '../support/browser-test-tls.mjs';
import {pdf} from '../support/pdf-fixtures.mjs';
import {createLocalSandboxValidator,createSyntheticWindowsSandboxValidator} from '../../src/files/local-sandbox-validator.ts';
import {createOpeningDocumentWorkerClient,createOpeningDocumentWorkerServer} from '../../src/server/receipt-worker-transport.ts';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const docker=(args)=>execFileSync('docker',args,{timeout:30000,maxBuffer:8*1024*1024,windowsHide:true});
const pin=tls=>new X509Certificate(tls.cert).fingerprint256.replaceAll(':','').toLowerCase();
const businessId=randomUUID(),credential=randomBytes(32).toString('base64url'),storageBinding=randomBytes(32).toString('hex');
let serverTls,clientTls,worker,client,validator,fixtures;
const jobs=new Map(),completed=new Map();
before(async()=>{
 assert.equal(process.env.CREST_ENV,'test');
 assert(['win32','linux'].includes(process.platform));
 const reference=process.env.CREST_IMAGE_ID??'crest-os:ci';
 assert(reference==='crest-os:ci'||/^sha256:[a-f0-9]{64}$/.test(reference));
 const imageId=docker(['image','inspect','--format','{{.Id}}',reference]).toString().trim();
 assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
 const containerArgs=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','--no-healthcheck'];
 const identity=JSON.parse(docker([...containerArgs,'--entrypoint','node',imageId,'--conditions=react-server','--input-type=module','-e',"const app=await import('/app/server/application.mjs');console.log(JSON.stringify(app.getServerBuildIdentity()));"]).toString());
 const expected=JSON.parse(await readFile(new URL('../../.local/server/build-identity.json',import.meta.url),'utf8'));
 assert.deepEqual(identity,expected,'same release image required');
 const {heic}=JSON.parse(await readFile(new URL('../../release/toolchain.json',import.meta.url),'utf8'));
 const archive='/app/.local/tools/heic/sources/libheif-'+heic.libheif+'.tar.gz';
 const actualSource=docker([...containerArgs,'--entrypoint','node',imageId,'--input-type=module','-e',"import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));",archive]).toString().trim();
 assert.equal(actualSource,heic.libheifSourceSha256);
 // This small upstream test pattern comes from the checksum-verified archive,
 // not a customer file or a newly downloaded unpinned binary.
 const heicBytes=docker([...containerArgs,'--entrypoint','tar',imageId,'-xOzf',archive,'libheif-'+heic.libheif+'/tests/data/rainbow-451x461.heic']);
 const png=await sharp({create:{width:32,height:16,channels:3,background:'#224466'}}).png().toBuffer();
 fixtures=[{type:'image/png',bytes:png},{type:'image/jpeg',bytes:await sharp(png).jpeg().toBuffer()},{type:'application/pdf',bytes:pdf()},{type:'image/heic',bytes:heicBytes}];
 validator=process.platform==='linux'?createLocalSandboxValidator({imageId}):createSyntheticWindowsSandboxValidator({imageId,dockerExecutable:process.env.CREST_TEST_DOCKER_EXECUTABLE,systemRoot:process.env.SystemRoot});
 serverTls=await browserTestTls();clientTls=await browserTestTls();
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const host='localhost:'+port;
 worker=createOpeningDocumentWorkerServer({host,businessId,storageBinding,clientFingerprint:pin(clientTls),tls:{...serverTls,ca:clientTls.cert}},async(token,business,documentId,operationId,signal)=>{
  assert.equal(token,credential);assert.equal(business,businessId);
  const job=jobs.get(documentId);assert(job);assert.equal(operationId,job.operationId);
  const decoded=await validator.validate(job.bytes,job.type,randomUUID(),signal);
  assert.equal(decoded.source.sha256,hash(job.bytes));assert.equal(decoded.source.byteSize,job.bytes.length);
  assert.equal(decoded.source.detectedType,job.type);
  completed.set(documentId,decoded);
 });
 await new Promise((resolve,reject)=>{worker.server.once('error',reject);worker.server.listen(port,'127.0.0.1',resolve);});
 client=createOpeningDocumentWorkerClient({origin:'https://'+host,businessId,storageBinding,serverFingerprint:pin(serverTls),tls:{...clientTls,ca:serverTls.cert}});
},{timeout:120000});
after(async()=>{
 client?.close();await worker?.close();
 for(const tls of [serverTls,clientTls])tls?.key.fill(0);
 for(const value of completed.values())value.preview.bytes.fill(0);
 for(const fixture of fixtures??[])fixture.bytes.fill(0);
 jobs.clear();completed.clear();
});
test('opening-document transport completes real JPEG, PNG, PDF and HEIC isolated decoding',{timeout:360000},async t=>{
 for(const fixture of fixtures)await t.test(fixture.type,async()=>{
  const documentId=randomUUID(),operationId=randomUUID();jobs.set(documentId,{...fixture,operationId});
  await client.dispatch(credential,businessId,documentId,operationId,AbortSignal.timeout(80000));
  const decoded=completed.get(documentId);assert(decoded);
  assert.equal(hash(decoded.preview.bytes),decoded.preview.sha256);
  const preview=await sharp(decoded.preview.bytes).metadata();assert.equal(preview.format,'jpeg');
  assert(preview.width>0&&preview.width<=2048&&preview.height>0&&preview.height<=2048);
 });
});
test('all four decoders refuse malformed files without a success acknowledgement',{timeout:360000},async t=>{
 for(const type of ['image/jpeg','image/png','application/pdf','image/heic'])await t.test(type,async()=>{
  const documentId=randomUUID(),operationId=randomUUID();
  jobs.set(documentId,{type,bytes:Buffer.from('invalid fictional file'),operationId});
  await assert.rejects(client.dispatch(credential,businessId,documentId,operationId,AbortSignal.timeout(80000)),/RECEIPT_WORKER_UNCONFIRMED/);
  assert.equal(completed.has(documentId),false);
 });
});
