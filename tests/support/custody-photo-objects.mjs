import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {S3Client} from '@aws-sdk/client-s3';
import {createPrivateObjectStore} from '../../src/files/private-object-store.ts';

// Local S3 wire fixture for generated photos. It exercises the real SDK and
// storage code without claiming provider policy or signature conformance.
export async function custodyPhotoObjects(){
 const bucket='crest-synthetic-custody-photos',objects=new Map(),requests=[];
 let origin,loseOriginal=false,afterRead=()=>{};
 function refusal(response,status,code){
  response.writeHead(status,{'content-type':'application/xml'});
  response.end(`<Error><Code>${code}</Code></Error>`);
 }
 const server=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url,origin),prefix='/'+bucket+'/';
   if(!url.pathname.startsWith(prefix)||(!url.searchParams.has('X-Amz-Signature')&&
    !request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')))return refusal(response,403,'AccessDenied');
   const key=url.pathname.slice(prefix.length);
   requests.push({key,method:request.method});
   if(request.method==='PUT'){
    const staging=key.startsWith('staging/');
    if(!staging&&(request.headers['if-none-match']!=='*'||objects.has(key)))return refusal(response,412,'PreconditionFailed');
    const chunks=[];
    for await(const chunk of request)chunks.push(chunk);
    objects.set(key,{bytes:Buffer.concat(chunks),type:request.headers['content-type']});
    if(loseOriginal&&key.startsWith('originals/')){loseOriginal=false;request.socket.destroy();return;}
    response.writeHead(200);response.end();return;
   }
   if(request.method!=='GET')return refusal(response,405,'MethodNotAllowed');
   const object=objects.get(key);
   if(!object)return refusal(response,404,'NoSuchKey');
   await afterRead(key);
   response.writeHead(200,{'content-length':object.bytes.length,'content-type':object.type});
   response.end(object.bytes);
  }catch{response.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 const sdk=new S3Client({endpoint:origin,region:'auto',forcePathStyle:true,maxAttempts:1,
  credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},
  requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 return {store:createPrivateObjectStore(sdk,bucket),origin,objects,requests,loseNextOriginal(){loseOriginal=true;},
  onRead(callback){assert.equal(typeof callback,'function');afterRead=callback;},
  async close(){sdk.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
