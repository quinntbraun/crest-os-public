import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Explicit synthetic HTTP protocol store, never a cloud/conformance claim.
export function recoveryObjectDestinationHttp(beforePut=async()=>{}){
 const objects=new Map(),lostAcknowledgement=new Set(),corruptRead=new Set(),failures=[],requests=[],modified=new Date('2026-11-23T00:00:00.000Z');
 function seed(bucket,key,bytes,contentType='application/octet-stream'){const body=Buffer.from(bytes);objects.set(bucket+'/'+key,{body,contentType,etag:'"'+createHash('md5').update(body).digest('hex')+'"'});}
 async function handle(req,res,url,path){
  if(!path.startsWith('/restore-'))return false;
  try{
   assert(req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 '));const [bucket,...parts]=path.slice(1).split('/'),key=parts.join('/');requests.push({method:req.method,bucket,key});
   if(req.method==='GET'&&url.searchParams.get('list-type')==='2'){const prefix=bucket+'/',rows=[...objects].filter(([name])=>name.startsWith(prefix)).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)));res.writeHead(200,{'content-type':'application/xml'});res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>${rows.length}</KeyCount>${rows.map(([name,value])=>`<Contents><Key>${name.slice(prefix.length)}</Key><Size>${value.body.length}</Size><ETag>${value.etag}</ETag><LastModified>${modified.toISOString()}</LastModified></Contents>`).join('')}</ListBucketResult>`);return true;}
   if(req.method==='PUT'){assert.equal(req.headers['if-none-match'],'*');if(objects.has(bucket+'/'+key)){res.writeHead(412,{'content-type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');return true;}const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);assert.equal(Number(req.headers['content-length']),bytes.length);assert.equal(req.headers['content-md5'],createHash('md5').update(bytes).digest('base64'));await beforePut({bucket,key,bytes,contentType:req.headers['content-type']});seed(bucket,key,bytes,req.headers['content-type']);if(lostAcknowledgement.has(bucket)){req.socket.destroy();return true;}res.writeHead(200,{etag:objects.get(bucket+'/'+key).etag});res.end();return true;}
   assert.equal(req.method,'GET');const value=objects.get(bucket+'/'+key);assert(value);const body=Buffer.from(value.body);if(corruptRead.has(bucket)&&body.length)body[0]^=1;res.writeHead(200,{'content-type':value.contentType,'content-length':body.length,etag:value.etag,'last-modified':modified.toUTCString()});res.end(body);return true;
  }catch(error){failures.push(error);res.destroy();return true;}
 }
 return{objects,lostAcknowledgement,corruptRead,failures,requests,seed,handle};
}
