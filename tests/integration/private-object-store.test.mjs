// Actual AWS SDK + Node HTTP/streams against a deliberately small synthetic S3
// fault fixture. This is not an R2/provider-conformance or file-decoder proof.
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {S3Client} from '@aws-sdk/client-s3';
import {createPrivateObjectStore,createR2ObjectStore,newOriginalKey,newPreviewKey,maximumFileBytes,PrivateObjectError} from '../../src/files/private-object-store.ts';

const business=randomUUID(),attempt=randomUUID(),bucket='crest-synthetic-files';
const access=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
let server,client,store,origin,mode,objects,requests;
function validSignature(req,url){
  const q=url.searchParams,credential=q.get('X-Amz-Credential')?.split('/'),signed=q.get('X-Amz-SignedHeaders')?.split(';');
  if(credential?.length!==5||credential[0]!==access||credential[2]!=='auto'||credential[3]!=='s3'||credential[4]!=='aws4_request'
    ||!signed||!signed.includes('content-type')||!signed.includes('host')||q.get('X-Amz-Expires')!=='600')return false;
  const date=q.get('X-Amz-Date');
  if(!/^\d{8}T\d{6}Z$/.test(date??''))return false;
  const timestamp=Date.parse(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+'T'+date.slice(9,11)+':'+date.slice(11,13)+':'+date.slice(13,15)+'Z');
  if(Date.now()<timestamp-1000||Date.now()>timestamp+600000)return false;
  const query=[...q].filter(([k])=>k!=='X-Amz-Signature').map(([k,v])=>[encode(k),encode(v)])
    .sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&');
  const headers=signed.map(name=>name+':'+String(req.headers[name]??'').trim().replace(/\s+/g,' ')+'\n').join('');
  const canonical=[req.method,url.pathname,query,headers,signed.join(';'),'UNSIGNED-PAYLOAD'].join('\n');
  const scope=credential.slice(1).join('/');
  const stringToSign=['AWS4-HMAC-SHA256',date,scope,digest(Buffer.from(canonical))].join('\n');
  const key=hmac(hmac(hmac(hmac('AWS4'+secret,credential[1]),'auto'),'s3'),'aws4_request');
  const expected=hmac(key,stringToSign),provided=Buffer.from(q.get('X-Amz-Signature')??'','hex');
  return provided.length===expected.length&&timingSafeEqual(provided,expected);
}
function xml(res,status,code){res.writeHead(status,{'content-type':'application/xml'});res.end(`<Error><Code>${code}</Code></Error>`);}
before(async()=>{
  server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin),key=url.pathname.slice(('/'+bucket+'/').length);
      requests.push({method:req.method,key,headers:req.headers});
      if(!url.pathname.startsWith('/'+bucket+'/'))return xml(res,404,'NoSuchBucket');
      if(url.searchParams.has('X-Amz-Signature')){
        if(!validSignature(req,url))return xml(res,403,'SignatureDoesNotMatch');
      }else if(!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 '))return xml(res,403,'AccessDenied');
      if(req.method==='PUT'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const bytes=Buffer.concat(chunks);
        if((key.startsWith('originals/')||key.startsWith('previews/'))&&(req.headers['if-none-match']!=='*'||objects.has(key)))return xml(res,412,'PreconditionFailed');
        objects.set(key,{bytes,type:req.headers['content-type']});
        if(mode==='lost-write-response'){req.socket.destroy();return;}
        res.writeHead(200,{etag:'"deliberately-not-a-content-hash"'});res.end();return;
      }
      if(req.method!=='GET')return xml(res,405,'MethodNotAllowed');
      if(mode==='missing-final-read'&&(key.startsWith('originals/')||key.startsWith('previews/')))return xml(res,404,'NoSuchKey');
      const object=objects.get(key);if(!object)return xml(res,404,'NoSuchKey');
      const bytes=mode==='corrupt-original'&&(key.startsWith('originals/')||key.startsWith('previews/'))?Buffer.alloc(object.bytes.length,99):object.bytes;
      if(mode==='oversized-header'){res.writeHead(200,{'content-length':maximumFileBytes+1});res.end();return;}
      if(mode==='missing-length'){res.writeHead(200);res.end(bytes);return;}
      res.writeHead(200,{'content-length':bytes.length+(mode==='truncated'?1:0),'content-type':object.type,etag:'"not-sha256"'});
      if(mode==='stalled'){res.flushHeaders();return;}
      if(mode==='truncated'){res.write(bytes);res.socket.destroy();return;}
      res.end(bytes);
    }catch{if(!res.destroyed)res.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  client=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},
    maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  store=createPrivateObjectStore(client,bucket);
});
after(async()=>{client?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{mode='normal';objects=new Map();requests=[];});
const ticket=(override={})=>store.issueStagingUpload({businessId:business,attemptId:attempt,byteSize:4,contentType:'image/jpeg',...override});
const denied=async(promise,code)=>assert.rejects(promise,error=>{
  assert(error instanceof PrivateObjectError);assert.equal(error.message,code);assert.equal(error.cause,undefined);return true;
});
async function upload(issued,bytes=Buffer.from('jpeg')){
  const capability=issued.capability.forUpload();
  const response=await fetch(capability.url,{method:capability.method,headers:capability.headers,body:bytes});
  assert.equal(response.status,200);await response.arrayBuffer();
}
const candidate=(bytes=Buffer.from('jpeg'),key=newOriginalKey(business))=>({key,bytes,sha256:digest(bytes),contentType:'image/jpeg'});

test('D11: random business/attempt-scoped PUT, signed type, ten minutes and no signed GET',async()=>{
  const a=await ticket(),b=await ticket(),c=a.capability.forUpload(),url=new URL(c.url);
  assert.notEqual(a.key,b.key);assert(a.key.startsWith(`staging/${business}/${attempt}/`));
  assert.equal(c.method,'PUT');assert.equal(c.expiresInSeconds,600);assert.equal(a.expectedByteSize,4);
  assert(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-type'));
  assert.throws(()=>JSON.stringify(a.capability),PrivateObjectError);
  await upload(a);assert.equal(requests.length,1);
  const read=await store.readStaging(a.key,4);
  assert.equal(read.sha256,digest(Buffer.from('jpeg')));assert.equal(read.byteSize,4);assert.equal(read.bytes.toString(),'jpeg');
});
test('PUT signature rejects another method, key and declared type',async()=>{
  const a=await ticket(),c=a.capability.forUpload();
  const other=new URL(c.url);other.pathname=other.pathname.replace('staging/','originals/');
  for(const [url,method,type] of [[c.url,'GET','image/jpeg'],[other.href,'PUT','image/jpeg'],[c.url,'PUT','image/png']]){
    const response=await fetch(url,{method,headers:{'content-type':type},...(method==='PUT'?{body:'jpeg'}:{})});
    assert.equal(response.status,403);await response.arrayBuffer();
  }
  assert.equal(objects.size,0);
});
test('ticket byte count is checked on intake even if signed PUT accepted a different size',async()=>{
  const a=await ticket();await upload(a,Buffer.from('different size'));
  await denied(store.readStaging(a.key,a.expectedByteSize),'OBJECT_BYTES_MISMATCH');
});
test('original candidate uses conditional create, no-store, exact bytes and independent final SHA-256',async()=>{
  const a=await ticket();await upload(a);const snapshot=await store.readStaging(a.key,4),input=candidate(snapshot.bytes);
  const saved=await store.writeOriginalCandidate(input);
  assert.deepEqual(saved,{key:input.key,byteSize:4,sha256:snapshot.sha256});
  assert.deepEqual(requests.map(r=>r.method),['PUT','GET','PUT','GET']);
  const put=requests[2];assert.equal(put.headers['if-none-match'],'*');assert.equal(put.headers['cache-control'],'no-store');
  assert.equal(put.headers['content-length'],'4');assert.equal(put.headers['content-type'],'image/jpeg');
  assert.equal(objects.get(input.key).bytes.toString(),'jpeg');assert(Object.isFrozen(saved));
});
test('reusing staged PUT and mutating the caller buffer cannot replace a sealed original',async()=>{
  const a=await ticket();await upload(a);const snapshot=await store.readStaging(a.key,4),input=candidate(snapshot.bytes);
  const writing=store.writeOriginalCandidate(input);input.bytes.fill(88);await upload(a,Buffer.from('late'));await writing;
  assert.equal(objects.get(input.key).bytes.toString(),'jpeg');assert.equal(objects.get(a.key).bytes.toString(),'late');
});
test('changed bytes fail the expected digest before any original write',async()=>{
  const input=candidate();input.bytes.fill(88);await denied(store.writeOriginalCandidate(input),'OBJECT_BYTES_MISMATCH');
  assert.equal(requests.length,0);
});
test('concurrent writes to the same original key have one winner and never overwrite',async()=>{
  const input=candidate(),other=candidate(Buffer.from('abcd'),input.key);
  const results=await Promise.allSettled([store.writeOriginalCandidate(input),store.writeOriginalCandidate(other)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'OBJECT_KEY_EXISTS');
  const first=Buffer.from(objects.get(input.key).bytes);
  await denied(store.writeOriginalCandidate(candidate(Buffer.from('zzzz'),input.key)),'OBJECT_KEY_EXISTS');
  assert(objects.get(input.key).bytes.equals(first));
});
test('a lying ETag or successful PUT cannot hide corrupted final bytes',async()=>{
  mode='corrupt-original';const input=candidate();await denied(store.writeOriginalCandidate(input),'OBJECT_BYTES_MISMATCH');
  assert(objects.has(input.key),'unverified private candidate is retained for reconciliation');
});
test('lost PUT response is uncertain, not retried/deleted or mistaken for success',async()=>{
  mode='lost-write-response';const input=candidate();await denied(store.writeOriginalCandidate(input),'OBJECT_WRITE_UNCERTAIN');
  assert(objects.has(input.key));assert.deepEqual(requests.map(r=>r.method),['PUT']);
});
test('successful PUT with unavailable final read returns no verified result and retains its candidate',async()=>{
  mode='missing-final-read';const input=candidate();await denied(store.writeOriginalCandidate(input),'OBJECT_STORAGE_FAILED');
  assert(objects.has(input.key));assert.deepEqual(requests.map(r=>r.method),['PUT','GET']);
});
test('maximum 25 MiB succeeds without shrinking original bytes',async()=>{
  const bytes=Buffer.alloc(maximumFileBytes,0x61),input=candidate(bytes),saved=await store.writeOriginalCandidate(input);
  assert.equal(saved.byteSize,maximumFileBytes);assert.equal(saved.sha256,digest(bytes));assert(objects.get(input.key).bytes.equals(bytes));
});
test('oversized metadata, missing length and truncated transfer fail closed',async()=>{
  const a=await ticket();await upload(a);
  mode='oversized-header';await denied(store.readStaging(a.key,4),'OBJECT_TOO_LARGE');
  mode='missing-length';await denied(store.readStaging(a.key,4),'OBJECT_BYTES_MISMATCH');
  mode='truncated';await denied(store.readStaging(a.key,5),'OBJECT_STORAGE_FAILED');
});
test('actual stream bytes remain bounded even when an adapter lies about length',async()=>{
  let destroyed=false;
  const fake={send:async()=>({ContentLength:4,Body:new Readable({read(){this.push(Buffer.alloc(5));this.push(null);},destroy(error,callback){destroyed=true;callback(error);}})})};
  await denied(createPrivateObjectStore(fake,bucket).readStaging(`staging/${business}/${attempt}/${randomUUID()}`,4),'OBJECT_BYTES_MISMATCH');
  assert(destroyed);
});
test('missing objects and SDK failures expose only stable redacted errors',async()=>{
  await denied(store.readStaging(`staging/${business}/${attempt}/${randomUUID()}`,4),'OBJECT_STORAGE_FAILED');
  const fake={send:async()=>{throw new Error('sensitive SDK URL/credential detail');}};
  await denied(createPrivateObjectStore(fake,bucket).readStaging(`staging/${business}/${attempt}/${randomUUID()}`,4),'OBJECT_STORAGE_FAILED');
});
test('deadline aborts an already-started stalled response body',async()=>{
  const a=await ticket();await upload(a);mode='stalled';
  await denied(createPrivateObjectStore(client,bucket,100).readStaging(a.key,4),'OBJECT_TIMEOUT');
});
test('caller cancellation before I/O and during a stalled read releases the response',async()=>{
  const a=await ticket();await upload(a);const stopped=AbortSignal.abort();
  const count=requests.length;
  await denied(store.readStaging(a.key,4,stopped),'OBJECT_ABORTED');
  await denied(store.writeOriginalCandidate(candidate(),stopped),'OBJECT_ABORTED');assert.equal(requests.length,count);
  mode='stalled';const cancel=new AbortController();const reading=store.readStaging(a.key,4,cancel.signal);
  setTimeout(()=>cancel.abort(),50);await denied(reading,'OBJECT_ABORTED');
});
test('invalid type/size/namespace never signs, reads or writes storage',async()=>{
  for(const contentType of ['image/svg+xml','text/html','video/mp4','application/zip','image/jpeg\r\nx: y'])await denied(ticket({contentType}),'OBJECT_INPUT_INVALID');
  for(const byteSize of [0,-1,1.5,NaN,Infinity,maximumFileBytes+1])await denied(ticket({byteSize}),'OBJECT_INPUT_INVALID');
  for(const key of [newOriginalKey(business),`staging/${business}/../x`,'https://example.com/private','staging/foreign'])await denied(store.readStaging(key,4),'OBJECT_INPUT_INVALID');
  for(const key of [`staging/${business}/${attempt}/${randomUUID()}`,'originals/../x'])await denied(store.writeOriginalCandidate({...candidate(),key}),'OBJECT_INPUT_INVALID');
  await denied(store.writeOriginalCandidate({...candidate(),sha256:'etag'}),'OBJECT_INPUT_INVALID');
  await denied(store.writeOriginalCandidate(candidate(Buffer.alloc(maximumFileBytes+1))),'OBJECT_INPUT_INVALID');
  assert.equal(requests.length,0);
});
test('production construction fixes HTTPS R2 endpoint and refuses arbitrary accounts/credentials/buckets',()=>{
  const config={accountId:'a'.repeat(32),bucket,accessKeyId:access,secretAccessKey:secret};
  for(const change of [{accountId:'https://other.example.com'},{bucket:'../public'},{bucket:'ab'},{accessKeyId:''},{secretAccessKey:'unsafe\nsecret'}]){
    assert.throws(()=>createR2ObjectStore({...config,...change}),PrivateObjectError);
  }
  const live=createR2ObjectStore(config);assert(live.store);live.close();
});

test('private preview candidates preserve sealed bytes, enforce8 MiB and conditionally refuse replacement',async()=>{
  const bytes=Buffer.alloc(8*1024*1024,7),key=newPreviewKey(business),sha256=digest(bytes);
  const writing=store.writePreviewCandidate({key,bytes,sha256,contentType:'image/jpeg'});bytes.fill(9);
  const r=await writing;assert.equal(r.sha256,sha256);assert.equal(r.byteSize,8*1024*1024);assert.equal(digest(objects.get(key).bytes),sha256);
  assert.equal(requests.find(r=>r.method==='PUT').headers['if-none-match'],'*');
  await denied(store.writePreviewCandidate({key,bytes:Buffer.alloc(1),sha256:digest(Buffer.alloc(1)),contentType:'image/jpeg'}),'OBJECT_KEY_EXISTS');
});
test('preview namespace, JPEG MIME, hash and size are checked before I/O',async()=>{
  const input={key:newPreviewKey(business),bytes:Buffer.from('jpeg'),sha256:digest(Buffer.from('jpeg')),contentType:'image/jpeg'};
  for(const change of [{key:newOriginalKey(business)},{key:'previews/../x'},{contentType:'image/png'},{bytes:Buffer.alloc(0)},{bytes:Buffer.alloc(8*1024*1024+1)},{sha256:'not-sha256'}])
    await denied(store.writePreviewCandidate({...input,...change}),'OBJECT_INPUT_INVALID');
  assert.equal(requests.length,0);assert.throws(()=>newPreviewKey('invalid'),PrivateObjectError);
});
test('lost, missing and corrupt preview outcomes retain the private candidate without retry or deletion',async()=>{
  const bytes=Buffer.from('jpeg');
  for(const [failure,code] of [['lost-write-response','OBJECT_WRITE_UNCERTAIN'],['missing-final-read','OBJECT_STORAGE_FAILED'],['corrupt-original','OBJECT_BYTES_MISMATCH']]){
    mode=failure;const key=newPreviewKey(business);await denied(store.writePreviewCandidate({key,bytes,sha256:digest(bytes),contentType:'image/jpeg'}),code);
    assert(objects.has(key));assert.equal(requests.filter(r=>r.key===key&&r.method==='PUT').length,1);
  }
  assert(!requests.some(r=>r.method==='DELETE'));
});
