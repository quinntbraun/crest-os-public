import {test,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {S3Client} from '@aws-sdk/client-s3';
vi.mock('server-only',()=>({}));
import {createRecoveryPrimaryStore} from '../../src/tooling/recovery-primary-store';

async function fixture(mode='normal'){
 const business=randomUUID(),keys=[`originals/${business}/00000000-0000-0000-0000-000000000001`,`originals/${business}/00000000-0000-0000-0000-000000000002`],body=Buffer.from([0,255]),etag='"'+createHash('md5').update(body).digest('hex')+'"',modified=new Date('2026-11-22T00:00:00.000Z'),calls:string[]=[];let listings=0;
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://127.0.0.1');calls.push(req.method+' '+url.pathname);
  if(url.searchParams.get('list-type')==='2'){
   listings++;const second=url.searchParams.get('continuation-token')==='two',key=mode==='unknown'?'unknown/bytes':keys[second?1:0],size=mode==='oversize'?26214401:2;
   if(second&&mode==='normal')expect(url.searchParams.get('continuation-token')).toBe('two');
   res.writeHead(200,{'content-type':'application/xml'});res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${!second||mode==='loop'}</IsTruncated><KeyCount>1</KeyCount>${!second||mode==='loop'?'<NextContinuationToken>two</NextContinuationToken>':''}<Contents><Key>${mode==='reordered'&&second?keys[0]:key}</Key><Size>${size}</Size><ETag>${mode==='drift'&&listings>2?'"changed"':etag}</ETag><LastModified>${modified.toISOString()}</LastModified></Contents></ListBucketResult>`);return;
  }
  expect(req.headers['if-match']).toBe(etag);res.writeHead(200,{'content-type':'application/octet-stream','content-length':body.length,etag:mode==='changed-read'?'"changed"':etag,'last-modified':modified.toUTCString()});if(mode==='hang'){res.write(body.subarray(0,1));return;}res.end(body);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
 const client=new S3Client({region:'auto',endpoint:`http://127.0.0.1:${address.port}`,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 return{store:createRecoveryPrimaryStore(client,'crest-primary-test','expense_receipt'),calls,body,async close(){client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
const signal=()=>new AbortController().signal;
test('pages a complete catalog, conditionally reads exact observed bytes and verifies matching second listing',async()=>{
 const f=await fixture();try{const wrapper=await f.store.listRetained(signal());expect(()=>JSON.stringify(wrapper)).toThrow();const catalog=wrapper.forRecoveryTools();expect(catalog.objects).toHaveLength(2);expect(catalog.atomicSnapshot).toBe(false);const read=await f.store.readObserved(catalog.objects[0]!,signal());expect(()=>JSON.stringify(read)).toThrow();expect(read.forRecoveryTools().bytes).toEqual(f.body);expect(read.forRecoveryTools().observation.sha256).toBe(createHash('sha256').update(f.body).digest('hex'));expect(read.forRecoveryTools().observation.versionId).toBeNull();await expect(f.store.verifyStable(catalog,signal())).resolves.toMatchObject({verification:'two-matching-listings',atomicSnapshot:false});read.forRecoveryTools().bytes.fill(0);}finally{await f.close();}
});
for(const mode of ['unknown','oversize','loop','reordered'])test('refuses '+mode+' catalog rather than omitting retained bytes',async()=>{const f=await fixture(mode);try{await expect(f.store.listRetained(signal())).rejects.toThrow('RECOVERY_PRIMARY_STORE_REVIEW_REQUIRED');expect(f.calls.length).toBeLessThanOrEqual(2);}finally{await f.close();}});
test('refuses copied descriptors/catalogs before network dispatch and changed source metadata after dispatch',async()=>{
 const f=await fixture('changed-read');try{const catalog=(await f.store.listRetained(signal())).forRecoveryTools(),before=f.calls.length;await expect(f.store.readObserved({...catalog.objects[0]!},signal())).rejects.toThrow();await expect(f.store.verifyStable({...catalog},signal())).rejects.toThrow();expect(f.calls).toHaveLength(before);await expect(f.store.readObserved(catalog.objects[0]!,signal())).rejects.toThrow();}finally{await f.close();}
});
test('a changed second listing fails stability verification',async()=>{const f=await fixture('drift');try{const catalog=(await f.store.listRetained(signal())).forRecoveryTools();await expect(f.store.verifyStable(catalog,signal())).rejects.toThrow();}finally{await f.close();}});
test('cancellation destroys an interrupted response stream',async()=>{const f=await fixture('hang');try{const catalog=(await f.store.listRetained(signal())).forRecoveryTools(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50);try{await expect(f.store.readObserved(catalog.objects[0]!,controller.signal)).rejects.toThrow();}finally{clearTimeout(timer);}}finally{await f.close();}});
