// Real loopback SDK and age exercise; Linux uses the actual durable journal.
// Windows uses an explicit publication seam, never a durability acceptance claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {S3Client} from '@aws-sdk/client-s3';
import {createPrivateObjectStore} from '../../src/files/private-object-store.ts';
import {createRecoveryVault,recoveryVaultArtifactKey} from '../../src/tooling/recovery-vault.ts';
import {createRecoveryAttempt,inspectRecoveryAttempt} from '../../src/tooling/recovery-attempt.ts';
import {captureRecoveryOriginalArchive} from '../../src/tooling/recovery-original-archive.ts';
import {createRecoveryPrimaryStore} from '../../src/tooling/recovery-primary-store.ts';
import {captureRecoveryRetainedArchive} from '../../src/tooling/recovery-retained-archive.ts';

export async function exerciseRecoveryOriginalArchive({inventory,workspace,recipient,bytes,preview,encrypt,decrypt,mode}){
 const retained=new Map(),transferred=[],calls=[],point={formatVersion:1,pointId:randomUUID(),businessId:inventory.objects[0].businessId,startedAt:new Date().toISOString(),appReleaseId:'a'.repeat(40),migrationRegistrySha256:'b'.repeat(64),sourceSchemaVersion:138},retainUntil=new Date(Date.now()+400*86400000).toISOString();let attempt,client,directory,reviewRequired=false;
 const primary=new Map(inventory.objects.map(object=>['/source-'+object.domain.replaceAll('_','-')+'/'+object.key,Buffer.from(object.variant==='original'?bytes:preview)])),pending=inventory.stagingReservations.find(value=>value.publication==='pending'),modified=new Date('2026-11-22T00:00:00.000Z');let listings=0;const retainedMode=mode.startsWith('retained');
 if(retainedMode){primary.set('/source-expense-receipt/'+pending.key,Buffer.from([0,255,17,60,0]));primary.set(`/source-expense-receipt/originals/${pending.businessId}/${pending.attachmentId}`,Buffer.alloc(0));}
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1'),path=decodeURIComponent(url.pathname);calls.push({method:req.method,path,version:url.searchParams.get('versionId')});assert(req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 '));
  if(path.startsWith('/source-')){
   assert.equal(req.method,'GET');if(url.searchParams.get('list-type')==='2'){listings++;const prefix='/'+path.split('/')[1]+'/',entries=[...primary].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)));res.writeHead(200,{'content-type':'application/xml'});res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>${entries.length}</KeyCount>${entries.map(([key,body],index)=>`<Contents><Key>${key.slice(prefix.length)}</Key><Size>${body.length}</Size><ETag>"${mode==='retained-drift'&&listings>1&&index===0?'changed':createHash('md5').update(body).digest('hex')}"</ETag><LastModified>${modified.toISOString()}</LastModified></Contents>`).join('')}</ListBucketResult>`);return;}
   const object=inventory.objects.find(value=>path==='/source-'+value.domain.replaceAll('_','-')+'/'+value.key),value=primary.get(path);if(!value){res.writeHead(404);res.end();return;}const body=Buffer.from(value),etag='"'+createHash('md5').update(body).digest('hex')+'"';if(retainedMode)assert.equal(req.headers['if-match'],etag);if(mode==='corrupt')body[0]^=1;res.writeHead(200,{'content-type':object?.contentType??'application/octet-stream','content-length':body.length,etag,'last-modified':modified.toUTCString()});res.end(body);return;
  }
  assert(path.startsWith('/crest-test-vault/'));const key=path.slice('/crest-test-vault/'.length);
  if(req.method==='PUT'){assert(!retained.has(key));const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);assert.equal(req.headers['content-md5'],createHash('md5').update(body).digest('base64'));assert.equal(req.headers['x-amz-object-lock-mode'],'COMPLIANCE');assert.equal(req.headers['x-amz-object-lock-retain-until-date'],retainUntil);const version='synthetic-version-'+randomUUID();retained.set(key,{body,version});if(mode==='lost-write'){req.socket.destroy();return;}res.writeHead(200,{'x-amz-version-id':version});res.end();return;}
  const item=retained.get(key);assert(item);assert.equal(url.searchParams.get('versionId'),item.version);if(url.searchParams.has('retention')){res.writeHead(200,{'content-type':'application/xml'});res.end(`<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>${retainUntil}</RetainUntilDate></Retention>`);return;}
  res.writeHead(200,{'content-type':'application/octet-stream','content-length':item.body.length,'x-amz-version-id':item.version});res.end(item.body);
 }catch{res.destroy();}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));client=new S3Client({region:'auto',endpoint:`http://127.0.0.1:${server.address().port}`,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const vault=createRecoveryVault(client,'crest-test-vault',10000),stores=Object.fromEntries(['expense_receipt','supplier_document','condition_photo'].map(domain=>[domain,createPrivateObjectStore(client,'source-'+domain.replaceAll('_','-'))]));
  if(process.platform==='linux'){directory=await mkdtemp(join(workspace,'journal-'));attempt=await createRecoveryAttempt(directory,point);}else attempt={view:()=>({header:point,reviewRequired,completeBackup:false}),async publish(reserved,path,vault,signal){try{return await vault.publishEncryptedFile({key:recoveryVaultArtifactKey(point.pointId,reserved.artifactId),path,retainUntil:reserved.retainUntil},signal);}catch(error){reviewRequired=true;throw error;}}};
  const capture=()=>captureRecoveryOriginalArchive({inventory,workspace,recipient,retainUntil},{readSource:async(object,signal)=>{const value=await stores[object.domain].readVerifiedCandidate(object,signal);transferred.push(value);return value;},encrypt,attempt,vault},new AbortController().signal);
  if(retainedMode){
   const source=createRecoveryPrimaryStore(client,'source-expense-receipt','expense_receipt'),captureRetained=()=>captureRecoveryRetainedArchive({inventory,workspace,recipient,retainUntil},{source,encrypt,attempt,vault},new AbortController().signal);
   if(mode==='retained-drift'){await assert.rejects(captureRetained(),{message:'RECOVERY_RETAINED_ARCHIVE_REVIEW_REQUIRED'});assert.equal(retained.size,4);assert.equal(attempt.view().reviewRequired,false);}else{
    const result=await captureRetained();assert.throws(()=>JSON.stringify(result));const evidence=result.forRecoveryTools();assert.equal(evidence.entries.length,4);assert.equal(evidence.publishedCount,2);assert.equal(evidence.quarantineCount,2);assert.equal(evidence.quarantineRendered,false);assert.equal(evidence.primaryAtomicSnapshot,false);assert.equal(evidence.completeBackup,false);assert.equal(evidence.stability.verification,'two-matching-listings');assert.equal(retained.size,4);
    for(const entry of evidence.entries){assert.equal(entry.source.versionId,null);const path=join(workspace,randomUUID()+'.retained.age');await vault.retrieveEncryptedFile(entry.artifact,path,new AbortController().signal);const plain=await decrypt(await readFile(path));try{assert.deepEqual(plain,primary.get('/source-expense-receipt/'+entry.source.key));assert.equal(createHash('sha256').update(plain).digest('hex'),entry.source.sha256);if(entry.retention==='quarantine')assert.equal(entry.publishedSource,null);}finally{plain.fill(0);}}
   }assert.equal(listings,2);
  }else if(mode==='normal'){
   const result=await capture();assert.throws(()=>JSON.stringify(result));const evidence=result.forRecoveryTools();assert.equal(evidence.entries.length,inventory.objects.length);assert.equal(evidence.completeBackup,false);assert.equal(evidence.stagingBytesIncluded,false);assert.equal(evidence.retainedUnpublishedCandidatesIncluded,false);assert.equal(retained.size,inventory.objects.length);
   for(const entry of evidence.entries){const path=join(workspace,randomUUID()+'.retrieved.age');await vault.retrieveEncryptedFile(entry.artifact,path,new AbortController().signal);const plain=await decrypt(await readFile(path));try{assert.deepEqual(plain,entry.object.variant==='original'?bytes:preview);assert.equal(createHash('sha256').update(plain).digest('hex'),entry.object.sha256);}finally{plain.fill(0);}}
   assert.equal(attempt.view().reviewRequired,false);assert(transferred.every(value=>value.every(byte=>byte===0)));
  }else{
   await assert.rejects(capture(),{message:'RECOVERY_ORIGINAL_ARCHIVE_REVIEW_REQUIRED'});assert.equal(retained.size,mode==='corrupt'?0:1);assert.equal(calls.filter(call=>call.method==='PUT').length,mode==='corrupt'?0:1);assert.equal(attempt.view().reviewRequired,mode==='lost-write');if(mode==='lost-write')assert(transferred.every(value=>value.every(byte=>byte===0)));
  }
  if(directory){const journal=inspectRecoveryAttempt(await readFile(join(directory,point.pointId+'.jsonl'),'utf8'));assert.equal(journal.reviewRequired,mode==='lost-write');assert.equal(journal.completeBackup,false);}
 }finally{await attempt?.close?.();client?.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
}
