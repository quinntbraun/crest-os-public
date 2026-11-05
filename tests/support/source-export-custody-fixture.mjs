import assert from 'node:assert/strict';
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {S3Client} from '@aws-sdk/client-s3';
import {createEncryptedExportPartStore} from '../../src/files/export-part-store.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
// Shared synthetic loopback SDK/SigV4/JWE fixture. No hosted storage access.
export async function custodyFixture(onRequest,mode='normal'){
 const bucket='crest-journal-synthetic',access=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex'),key=randomBytes(32),objects=new Map(),requests=[];let origin,failure;
 const hmac=(k,v)=>createHmac('sha256',k).update(v).digest(),encode=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 function signed(req,url,bytes){
  const m=/^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(req.headers.authorization??'');if(!m)return false;const credential=m[1].split('/'),headers=m[2].split(';'),date=req.headers['x-amz-date'];if(credential.length!==5||credential[0]!==access||credential[2]!=='auto'||credential[3]!=='s3'||credential[4]!=='aws4_request'||!headers.includes('host')||req.headers['x-amz-content-sha256']!==sha(bytes)||typeof date!=='string'||!/^\d{8}T\d{6}Z$/.test(date))return false;
  const q=[...url.searchParams].map(([k,v])=>[encode(k),encode(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&'),canonicalHeaders=headers.map(name=>name+':'+String(req.headers[name]??'').trim().replace(/\s+/g,' ')+'\n').join(''),canonical=[req.method,url.pathname,q,canonicalHeaders,m[2],sha(bytes)].join('\n'),signing=hmac(hmac(hmac(hmac('AWS4'+secret,credential[1]),'auto'),'s3'),'aws4_request'),expected=hmac(signing,['AWS4-HMAC-SHA256',date,credential.slice(1).join('/'),sha(canonical)].join('\n'));return timingSafeEqual(expected,Buffer.from(m[3],'hex'));
 }
 const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,origin),chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(!url.pathname.startsWith('/'+bucket+'/')||!signed(req,url,bytes)){res.writeHead(403);res.end();return;}const objectKey=url.pathname.slice(('/'+bucket+'/').length);requests.push({method:req.method,key:objectKey});await onRequest(req.method,objectKey,bytes);
   if(req.method==='PUT'){assert.equal(req.headers['if-none-match'],'*');if(objects.has(objectKey)){res.writeHead(412,{'content-type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}objects.set(objectKey,Buffer.from(bytes));if(mode==='lost-put'){req.socket.destroy();return;}res.writeHead(200,{etag:'"opaque"'});res.end();return;}
   assert.equal(req.method,'GET');assert(objects.has(objectKey));const data=Buffer.from(objects.get(objectKey));if(mode==='corrupt-read')data[0]^=1;res.writeHead(200,{'content-type':'application/jose+json','content-length':data.length,etag:'"not-a-content-hash"'});res.end(data);
  }catch(e){failure=e;res.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 const sdk=new S3Client({region:'auto',endpoint:origin,forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 try{const store=await createEncryptedExportPartStore(sdk,bucket,'journal-key',[{id:'journal-key',key}]);return {store,requests,objects,async close(){sdk.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(failure)throw failure;}};}
 catch(e){sdk.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw e;}
}
