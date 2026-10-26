// Real AWS SDK signing/HTTP/streams and standard JWE against a deliberately
// bounded synthetic object fixture. No cloud/provider-conformance or owner auth.
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {createServer} from 'node:http';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {S3Client} from '@aws-sdk/client-s3';
import {createEncryptedExportPartStore,createR2EncryptedExportPartStore,ExportObjectError} from '../../src/files/export-part-store.ts';
import {maximumExportPartBytes,maximumEncryptedExportPartBytes} from '../../src/security/export-part-crypto.ts';

const bucket='crest-synthetic-exports',access=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex'),key=randomBytes(32),plain=Buffer.from('"Private synthetic é 😀","9007199254740993"\r\n');
const binding=()=>({businessId:randomUUID(),actorId:randomUUID(),exportJobId:randomUUID(),generationId:randomUUID(),recoveryEpoch:randomUUID(),partId:randomUUID(),fileName:'customers.csv',contentType:'text/csv; charset=utf-8'});
const sha=b=>createHash('sha256').update(b).digest('hex'),hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
let server,client,store,origin,mode,objects,requests,seen;
function signed(req,url,bytes){
 const match=/^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(req.headers.authorization??'');if(!match)return false;
 const credential=match[1].split('/'),headers=match[2].split(';'),date=req.headers['x-amz-date'],payload=req.headers['x-amz-content-sha256'];
 if(credential.length!==5||credential[0]!==access||credential[2]!=='auto'||credential[3]!=='s3'||credential[4]!=='aws4_request'||!headers.includes('host')||payload!==sha(bytes)||typeof date!=='string'||!/^\d{8}T\d{6}Z$/.test(date))return false;
 const query=[...url.searchParams].map(([k,v])=>[encode(k),encode(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&');
 const canonicalHeaders=headers.map(name=>name+':'+String(req.headers[name]??'').trim().replace(/\s+/g,' ')+'\n').join('');
 const canonical=[req.method,url.pathname,query,canonicalHeaders,match[2],payload].join('\n'),scope=credential.slice(1).join('/');
 const signing=hmac(hmac(hmac(hmac('AWS4'+secret,credential[1]),'auto'),'s3'),'aws4_request'),expected=hmac(signing,['AWS4-HMAC-SHA256',date,scope,sha(Buffer.from(canonical))].join('\n'));
 return timingSafeEqual(expected,Buffer.from(match[3],'hex'));
}
const xml=(res,status,code)=>{res.writeHead(status,{'content-type':'application/xml'});res.end('<Error><Code>'+code+'</Code></Error>');};
before(async()=>{
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),objectKey=url.pathname.slice(('/'+bucket+'/').length);
   requests.push({method:req.method,key:objectKey,headers:req.headers,query:url.searchParams});seen?.(req.method);
   if(!url.pathname.startsWith('/'+bucket+'/')||!signed(req,url,bytes))return xml(res,403,'AccessDenied');
   if(req.method==='PUT'){
    if(mode==='refused-write')return xml(res,403,'AccessDenied');
    if(req.headers['if-none-match']!=='*'||objects.has(objectKey))return xml(res,412,'PreconditionFailed');
    objects.set(objectKey,{bytes,type:req.headers['content-type']});
    if(mode==='lost-write-response'){req.socket.destroy();return;}
    if(mode==='stalled-write-response')return;
    res.writeHead(200,{etag:'"not-a-content-hash"'});res.end();return;
   }
   if(req.method!=='GET')return xml(res,405,'MethodNotAllowed');
   if(mode==='missing-read')return xml(res,404,'NoSuchKey');const object=objects.get(objectKey);if(!object)return xml(res,404,'NoSuchKey');
   if(mode==='stalled-headers')return;
   const data=mode==='corrupt'?Buffer.from(object.bytes):object.bytes;if(mode==='corrupt')data[0]^=1;
   const headers={'content-type':mode==='wrong-type'?'text/plain':object.type,etag:'"not-sha256"'};
   if(mode!=='missing-length')headers['content-length']=mode==='oversized-header'?maximumEncryptedExportPartBytes+1:data.length;
   res.writeHead(200,headers);
   if(mode==='stalled-body'){res.flushHeaders();return;}
   if(mode==='truncated'){res.write(data.subarray(0,data.length-1));res.socket.destroy();return;}
   if(mode==='missing-length'){res.write(data);res.end();return;}
   res.end(data);
  }catch{res.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 client=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 store=await createEncryptedExportPartStore(client,bucket,'export1',[{id:'export1',key}]);
});
after(async()=>{client?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{server.closeAllConnections();mode='normal';objects=new Map();requests=[];seen=undefined;});
const signal=()=>new AbortController().signal;
const denied=(work,code='EXPORT_OBJECT_REVIEW_REQUIRED')=>assert.rejects(work,e=>e instanceof ExportObjectError&&e.code===code&&e.message===code&&e.cause===undefined);
async function saved(s=store,b=binding(),bytes=plain){const prepared=await s.prepare(bytes,b,signal()),expected=prepared.intentForServer();return {prepared,expected,b,receipt:await s.writeCandidate(prepared,signal())};}

test('encrypted export intent precedes all HTTP effects; conditional ciphertext write/read verifies exact original bytes',async()=>{
 const b=binding(),prepared=await store.prepare(plain,b,signal()),expected=prepared.intentForServer();assert.equal(requests.length,0);assert.throws(()=>JSON.stringify(prepared),ExportObjectError);assert(Object.isFrozen(expected));
 assert.equal(expected.objectKey,`exports/${b.businessId}/${b.exportJobId}/${b.generationId}/${b.partId}.jwe`);assert.equal(expected.plaintextBytes,plain.length);assert.equal(expected.plaintextSha256,sha(plain));assert.equal(expected.keyId,'export1');
 assert.deepEqual(await store.writeCandidate(prepared,signal()),expected);assert.deepEqual(requests.map(r=>r.method),['PUT','GET']);
 const put=requests[0];assert.equal(put.headers['if-none-match'],'*');assert.equal(put.headers['cache-control'],'no-store');assert.equal(put.headers['content-disposition'],'attachment');assert.equal(put.headers['content-type'],'application/jose+json');assert.equal(Number(put.headers['content-length']),expected.ciphertextBytes);assert(!put.query.has('X-Amz-Signature'));assert(!Object.keys(put.headers).some(k=>k.startsWith('x-amz-meta-')));
 const ciphertext=objects.get(expected.objectKey).bytes;assert(!ciphertext.includes(plain));assert(!ciphertext.includes(Buffer.from(sha(plain))));assert.equal(sha(ciphertext),expected.ciphertextSha256);
 const part=await store.readVerified(expected,b,signal());assert.deepEqual(part.forServer().bytes,plain);assert.throws(()=>JSON.stringify(part));part.dispose();assert.throws(()=>part.forServer());
});
test('unsigned direct GET and PUT never gain access to an encrypted private part',async()=>{
 const f=await saved();for(const method of ['GET','PUT']){const response=await fetch(origin+'/'+bucket+'/'+f.expected.objectKey,{method,...(method==='PUT'?{body:'untrusted'}:{})});assert.equal(response.status,403);await response.arrayBuffer();}assert.equal(sha(objects.get(f.expected.objectKey).bytes),f.expected.ciphertextSha256);
});
test('source buffers and mutable bindings are copied before encryption and upload',async()=>{
 const original=Buffer.from(plain),b=binding(),expectedBinding={...b},preparing=store.prepare(original,b,signal());original.fill(88);b.businessId=randomUUID();b.fileName='changed.csv';const prepared=await preparing;
 await store.writeCandidate(prepared,signal());const part=await store.readVerified(prepared.intentForServer(),expectedBinding,signal());assert.deepEqual(part.forServer().bytes,plain);part.dispose();
});
test('a prepared candidate permits one upload attempt; explicit verification performs no replacement write',async()=>{
 const f=await saved(),before=requests.length;await denied(store.writeCandidate(f.prepared,signal()));assert.equal(requests.length,before);assert.deepEqual(await store.verifyCandidate(f.expected,f.b,signal()),f.expected);assert.equal(requests.at(-1).method,'GET');assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
test('concurrent attempts using one prepared intent have a single PUT winner',async()=>{
 const prepared=await store.prepare(plain,binding(),signal()),results=await Promise.allSettled([store.writeCandidate(prepared,signal()),store.writeCandidate(prepared,signal())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='EXPORT_OBJECT_REVIEW_REQUIRED').length,1);assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
test('two different encrypted candidates cannot overwrite the same business/job/generation/part object',async()=>{
 const b=binding(),a=await store.prepare(plain,b,signal()),other=await store.prepare(Buffer.from('different private bytes'),b,signal());await store.writeCandidate(a,signal());const before=Buffer.from(objects.get(a.intentForServer().objectKey).bytes);
 await denied(store.writeCandidate(other,signal()),'EXPORT_OBJECT_EXISTS');assert.deepEqual(objects.get(a.intentForServer().objectKey).bytes,before);await denied(store.verifyCandidate(other.intentForServer(),b,signal()));
});
test('lost committed PUT response stays uncertain and is reconciled only against its original ciphertext intent',async()=>{
 mode='lost-write-response';const b=binding(),prepared=await store.prepare(plain,b,signal()),expected=prepared.intentForServer();await denied(store.writeCandidate(prepared,signal()),'EXPORT_OBJECT_WRITE_UNCERTAIN');assert(objects.has(expected.objectKey));assert.deepEqual(requests.map(r=>r.method),['PUT']);
 await denied(store.writeCandidate(prepared,signal()));mode='normal';assert.deepEqual(await store.verifyCandidate(expected,b,signal()),expected);assert.deepEqual(requests.map(r=>r.method),['PUT','GET']);
});
test('a refused PUT exposes no raw provider error and never initiates an automatic retry',async()=>{
 mode='refused-write';const prepared=await store.prepare(plain,binding(),signal());await denied(store.writeCandidate(prepared,signal()),'EXPORT_OBJECT_WRITE_UNCERTAIN');assert.equal(objects.size,0);assert.deepEqual(requests.map(r=>r.method),['PUT']);
});
test('cancellation after a real PUT commits remains uncertain and keeps the original verifiable intent',{timeout:5000},async()=>{
 const b=binding(),prepared=await store.prepare(plain,b,signal()),expected=prepared.intentForServer(),c=new AbortController();mode='stalled-write-response';let observed;const request=new Promise(resolve=>{observed=resolve;});seen=method=>{if(method==='PUT')observed();};
 const writing=store.writeCandidate(prepared,c.signal);await request;c.abort();await denied(writing,'EXPORT_OBJECT_WRITE_UNCERTAIN');assert(objects.has(expected.objectKey));mode='normal';assert.deepEqual(await store.verifyCandidate(expected,b,signal()),expected);assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
test('cancellation during the final verification read cannot publish a successful write receipt',{timeout:5000},async()=>{
 const b=binding(),prepared=await store.prepare(plain,b,signal()),expected=prepared.intentForServer(),c=new AbortController();mode='stalled-body';let observed;const request=new Promise(resolve=>{observed=resolve;});seen=method=>{if(method==='GET')observed();};
 const writing=store.writeCandidate(prepared,c.signal);await request;c.abort();await denied(writing);assert(objects.has(expected.objectKey));mode='normal';assert.deepEqual(await store.verifyCandidate(expected,b,signal()),expected);assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
test('a successful PUT with unavailable final GET returns no verified result and preserves the original candidate',async()=>{
 mode='missing-read';const b=binding(),prepared=await store.prepare(plain,b,signal());await denied(store.writeCandidate(prepared,signal()));assert(objects.has(prepared.intentForServer().objectKey));mode='normal';assert.deepEqual(await store.verifyCandidate(prepared.intentForServer(),b,signal()),prepared.intentForServer());assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
for(const fault of ['corrupt','truncated','missing-length','oversized-header','wrong-type'])test('encrypted verified reads reject '+fault+' without releasing plaintext or trusting ETag',async()=>{
 const f=await saved();mode=fault;await denied(store.readVerified(f.expected,f.b,signal()));assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
for(const fault of ['stalled-headers','stalled-body'])test('external cancellation tears down actual '+fault+' HTTP read',{timeout:5000},async()=>{
 const f=await saved(),c=new AbortController();mode=fault;let observed;const request=new Promise(resolve=>{observed=resolve;});seen=method=>{if(method==='GET')observed();};const reading=store.readVerified(f.expected,f.b,c.signal);await request;c.abort();await denied(reading);
});
test('the bounded storage deadline stops an actual stalled response body',{timeout:5000},async()=>{
 const f=await saved(),bounded=await createEncryptedExportPartStore(client,bucket,'export1',[{id:'export1',key}],25);mode='stalled-body';await denied(bounded.readVerified(f.expected,f.b,signal()));
});
test('unavailable/forged ciphertext hashes, lengths, key IDs and plaintext descriptors fail closed',async()=>{
 const f=await saved();for(const patch of [{ciphertextSha256:'0'.repeat(64)},{ciphertextBytes:f.expected.ciphertextBytes+1},{keyId:'unknown'},{plaintextSha256:'0'.repeat(64)},{plaintextBytes:plain.length+1}])await denied(store.readVerified({...f.expected,...patch},f.b,signal()));assert.equal(requests.filter(r=>r.method==='PUT').length,1);
});
test('encrypted binding prevents changing actor, recovery authority or filename even when the object key is unchanged',async()=>{
 const f=await saved();for(const patch of [{actorId:randomUUID()},{recoveryEpoch:randomUUID()},{fileName:'other.csv'}])await denied(store.readVerified(f.expected,{...f.b,...patch},signal()));
});
test('malformed, unscoped or oversized recorded intents fail before HTTP effects',async()=>{
 const f=await saved(),before=requests.length;for(const patch of [{objectKey:'originals/'+randomUUID()},{ciphertextBytes:maximumEncryptedExportPartBytes+1},{plaintextBytes:maximumExportPartBytes+1},{secret:'unused'},{formatVersion:2}])await denied(store.readVerified({...f.expected,...patch},f.b,signal()));assert.equal(requests.length,before);
});
test('pre-aborted prepare, PUT and read perform no new HTTP operation',async()=>{
 const b=binding(),prepared=await store.prepare(plain,b,signal()),c=new AbortController();c.abort();await denied(store.prepare(plain,b,c.signal));await denied(store.writeCandidate(prepared,c.signal));await denied(store.readVerified(prepared.intentForServer(),b,c.signal));assert.equal(requests.length,0);
});
test('empty, oversized, invalid namespace and forged prepared input never initiate a write',async()=>{
 for(const source of [new Uint8Array(),new Uint8Array(maximumExportPartBytes+1)])await denied(store.prepare(source,binding(),signal()));
 await denied(store.prepare(plain,{...binding(),fileName:'../private.csv'},signal()));await denied(store.writeCandidate({intentForServer:()=>({})},signal()));assert.equal(requests.length,0);
});
test('a restarted store reconciles original objects with retained keys but cannot upload another stores prepared object',async()=>{
 const f=await saved(),next=randomBytes(32),rotated=await createEncryptedExportPartStore(client,bucket,'export2',[{id:'export1',key},{id:'export2',key:next}]);assert.deepEqual(await rotated.verifyCandidate(f.expected,f.b,signal()),f.expected);
 const foreign=await store.prepare(plain,binding(),signal()),before=requests.length;await denied(rotated.writeCandidate(foreign,signal()));assert.equal(requests.length,before);const prepared=await rotated.prepare(plain,binding(),signal());assert.equal(prepared.intentForServer().keyId,'export2');
 const missing=await createEncryptedExportPartStore(client,bucket,'export2',[{id:'export2',key:next}]);await denied(missing.readVerified(f.expected,f.b,signal()));
});
test('a client configured for SDK retries is refused before sending an HTTP request',async()=>{
 const retrying=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},maxAttempts:3});
 try{const closed=await createEncryptedExportPartStore(retrying,bucket,'export1',[{id:'export1',key}]),prepared=await closed.prepare(plain,binding(),signal());await denied(closed.writeCandidate(prepared,signal()));assert.equal(requests.length,0);}finally{retrying.destroy();}
});
test('abort also bounds an unresolved trusted SDK retry-configuration provider',{timeout:5000},async()=>{
 const unresolved=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},maxAttempts:()=>new Promise(()=>{})});
 try{const bounded=await createEncryptedExportPartStore(unresolved,bucket,'export1',[{id:'export1',key}],25),prepared=await bounded.prepare(plain,binding(),signal());await denied(bounded.writeCandidate(prepared,signal()));assert.equal(requests.length,0);}finally{unresolved.destroy();}
});
test('R2 composition accepts only the fixed account endpoint, explicit credentials and private bucket names',async()=>{
 const config={accountId:'a'.repeat(32),bucket,accessKeyId:access,secretAccessKey:secret,activeKeyId:'export1',keys:[{id:'export1',key}]};
 for(const patch of [{accountId:'https://elsewhere.example.com'},{bucket:'public.example.com'},{accessKeyId:'short'},{secretAccessKey:secret+'\n'}])await assert.rejects(createR2EncryptedExportPartStore({...config,...patch}));
 const configured=await createR2EncryptedExportPartStore(config);configured.close();assert.equal(requests.length,0);
});
