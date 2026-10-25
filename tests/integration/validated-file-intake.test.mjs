// Actual SDK/loopback fault transport + actual restricted release containers.
// Generated data only; this does not establish actual R2 or phone conformance.
import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {createServer} from 'node:http';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {S3Client} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {createPrivateObjectStore,newOriginalKey,newPreviewKey} from '../../src/files/private-object-store.ts';
import {createLocalSandboxValidator} from '../../src/files/local-sandbox-validator.ts';
import {createValidatedFileIntake,FileIntakeError} from '../../src/files/validated-file-intake.ts';
import {heicFixtures,boundaryHeic} from '../support/heic-fixtures.mjs';
import {pdf} from '../support/pdf-fixtures.mjs';
const execute=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex'),business=randomUUID(),bucket='crest-synthetic-intake';
let server,client,store,validator,intake,origin,objects,requests,mode,fixtures;
const xml=(res,status,code)=>{res.writeHead(status,{'content-type':'application/xml'});res.end(`<Error><Code>${code}</Code></Error>`);};
before(async()=>{
  assert.equal(process.platform,'linux');
  const imageId=execFileSync('docker',['image','inspect','--format','{{.Id}}','crest-os:ci'],{encoding:'utf8',timeout:10000}).trim();
  validator=createLocalSandboxValidator({imageId});
  const png=await sharp({create:{width:96,height:48,channels:3,background:'#224466'}}).withExif({IFD0:{Copyright:'Synthetic only'}}).png().toBuffer();
  fixtures=[{type:'image/png',bytes:png},{type:'image/jpeg',bytes:await sharp(png).jpeg().toBuffer()},{type:'image/heic',bytes:(await heicFixtures()).plain},{type:'application/pdf',bytes:pdf({pages:2})}];
  server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin),prefix='/'+bucket+'/';if(!url.pathname.startsWith(prefix))return xml(res,404,'NoSuchBucket');
      if(!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')&&!url.searchParams.has('X-Amz-Signature'))return xml(res,403,'AccessDenied');
      const key=url.pathname.slice(prefix.length);requests.push({key,method:req.method});
      if(req.method==='PUT'){
        const chunks=[];for await(const b of req)chunks.push(b);const bytes=Buffer.concat(chunks);
        if(!key.startsWith('staging/')&&(req.headers['if-none-match']!=='*'||objects.has(key)))return xml(res,412,'PreconditionFailed');
        objects.set(key,{bytes,type:req.headers['content-type']});
        if(mode==='lost-original'&&key.startsWith('originals/')){req.socket.destroy();return;}
        res.writeHead(200,{etag:'"not-a-hash"'});res.end();return;
      }
      if(req.method!=='GET')return xml(res,405,'MethodNotAllowed');
      const o=objects.get(key);if(!o)return xml(res,404,'NoSuchKey');
      const bytes=mode==='corrupt-preview'&&key.startsWith('previews/')?Buffer.alloc(o.bytes.length,0):o.bytes;
      res.writeHead(200,{'content-length':bytes.length,'content-type':o.type});res.end(bytes);
      if(mode==='reuse-staging'&&key.startsWith('staging/'))objects.set(key,{...o,bytes:Buffer.alloc(o.bytes.length,0)});
    }catch{res.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  client=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  store=createPrivateObjectStore(client,bucket);intake=createValidatedFileIntake(store,validator);
});
beforeEach(()=>{objects=new Map();requests=[];mode='normal';});
after(async()=>{client?.destroy();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));});
async function uploaded(fixture){
  const attemptId=randomUUID(),dispatchId=randomUUID(),t=await store.issueStagingUpload({businessId:business,attemptId,byteSize:fixture.bytes.length,contentType:fixture.type}),cap=t.capability.forUpload();
  const put=await fetch(cap.url,{method:'PUT',headers:cap.headers,body:fixture.bytes});assert.equal(put.status,200);await put.arrayBuffer();
  return {businessId:business,attemptId,dispatchId,stagingKey:t.key,originalKey:newOriginalKey(business),previewKey:newPreviewKey(business),byteSize:fixture.bytes.length,contentType:fixture.type};
}
async function absent(dispatchId){
  try{await execute('docker',['inspect',`crest-file-${dispatchId}`],{timeout:5000,maxBuffer:65536});assert.fail('owned container leaked');}
  catch(e){assert.equal(e.code,1,'expected absent owned container');}
}
test('real isolated intake stores hash-verified originals and private metadata-free previews for all supported formats',async t=>{
  for(const f of fixtures)await t.test(f.type,async()=>{
    const c=await uploaded(f),r=await intake.prepare(c);assert.equal(r.status,'PrivateValidatedCandidate');assert.equal(r.source.sha256,hash(f.bytes));
    assert.equal(r.original.key,c.originalKey);assert(objects.get(c.originalKey).bytes.equals(f.bytes));assert.equal(r.original.sha256,hash(f.bytes));
    const p=objects.get(c.previewKey).bytes,m=await sharp(p).metadata();assert.equal(hash(p),r.preview.sha256);assert.equal(p.length,r.preview.byteSize);assert.equal(m.format,'jpeg');
    for(const key of ['exif','xmp','icc','orientation'])assert.equal(m[key],undefined);assert.equal(Object.hasOwn(r.preview,'bytes'),false);
    assert(!requests.some(x=>x.method==='DELETE'));await absent(c.dispatchId);
  });
});
test('malformed original quarantines before any durable candidate write',async()=>{
  const c=await uploaded({type:'image/png',bytes:Buffer.from('not PNG')});await assert.rejects(intake.prepare(c),e=>e instanceof FileIntakeError&&e.code==='FILE_QUARANTINED');
  assert.equal(objects.size,1);assert(!requests.some(x=>x.method==='PUT'&&!x.key.startsWith('staging/')));await absent(c.dispatchId);
});
test('reused staging PUT cannot change the exact original whose pixels were validated',async()=>{
  const f=fixtures[0],c=await uploaded(f);mode='reuse-staging';const r=await intake.prepare(c);
  assert.equal(r.source.sha256,hash(f.bytes));assert(objects.get(c.originalKey).bytes.equals(f.bytes));assert(!objects.get(c.stagingKey).bytes.equals(f.bytes));
  assert.equal(requests.filter(x=>x.method==='GET'&&x.key===c.stagingKey).length,1);await absent(c.dispatchId);
});
test('corrupt final preview withholds the pair and preserves candidates for reconciliation',async()=>{
  const c=await uploaded(fixtures[0]);mode='corrupt-preview';await assert.rejects(intake.prepare(c),e=>e.code==='FILE_INTAKE_FAILED'&&e.reason==='OBJECT_BYTES_MISMATCH');
  assert(objects.has(c.originalKey));assert(objects.has(c.previewKey));assert(!requests.some(x=>x.method==='DELETE'));await absent(c.dispatchId);
});
test('committed original PUT with lost response remains uncertain, with no retry or derivative write',async()=>{
  const c=await uploaded(fixtures[0]);mode='lost-original';await assert.rejects(intake.prepare(c),e=>e.reason==='OBJECT_WRITE_UNCERTAIN');
  assert(objects.has(c.originalKey));assert(!objects.has(c.previewKey));assert.equal(requests.filter(x=>x.key===c.originalKey&&x.method==='PUT').length,1);await absent(c.dispatchId);
});
test('cancellation during an actual maximum-size HEIC worker removes only the owned container and withholds output',async()=>{
  const bytes=await boundaryHeic(),dispatchId=randomUUID(),controller=new AbortController();
  const outcome=validator.validate(bytes,'image/heic',dispatchId,controller.signal).then(()=>null,e=>e);
  let running=false;const until=Date.now()+10000;
  while(Date.now()<until&&!running){
    try{const r=await execute('docker',['inspect','--format','{{json .State}}',`crest-file-${dispatchId}`],{timeout:1000,maxBuffer:65536});running=JSON.parse(r.stdout).Running===true;}catch{/* Create may still be in flight. */}
    if(!running)await new Promise(r=>setTimeout(r,20));
  }
  controller.abort();const error=await outcome;assert(running,'actual worker did not enter running state');assert.equal(error?.code,'SANDBOX_ABORTED');assert.equal(error.cause,undefined);await absent(dispatchId);
});
