import {test,expect} from 'vitest';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {S3Client} from '@aws-sdk/client-s3';
import {createRecoveryVault,createB2RecoveryVault,recoveryVaultArtifactKey} from '../../src/tooling/recovery-vault';

async function fixture(mode='normal'){
 const root=await mkdtemp(join(tmpdir(),'crest-vault-')),path=join(root,'cipher.age'),cipher=Buffer.from('age-encryption.org/v1\nsynthetic ciphertext, not decryptable\n');await writeFile(path,cipher);
 const key=recoveryVaultArtifactKey(randomUUID(),randomUUID()),retainUntil=new Date(Date.now()+400*86400000).toISOString(),version='synthetic-version-'+randomUUID(),calls:{method:string;version:string|null;retention:boolean;lock:string|undefined;until:string|undefined}[]=[];
 let stored:Buffer|undefined,putCount=0,currentMode=mode;
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url!,'http://127.0.0.1'),chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);
   calls.push({method:req.method!,version:url.searchParams.get('versionId'),retention:url.searchParams.has('retention'),lock:req.headers['x-amz-object-lock-mode'] as string|undefined,until:req.headers['x-amz-object-lock-retain-until-date'] as string|undefined});
   if(!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')||url.pathname!=='/crest-test-vault/'+key){res.writeHead(403);res.end();return;}
   if(req.method==='PUT'){
    putCount++;stored=body;
    if(mode==='lost-write'){req.socket.destroy();return;}
    if(req.headers['content-md5']!==createHash('md5').update(body).digest('base64')){res.writeHead(400);res.end();return;}
    res.writeHead(200,mode==='missing-version'?{}:{'x-amz-version-id':version});res.end();return;
   }
   if(url.searchParams.get('versionId')!==version){res.writeHead(404);res.end();return;}
   if(url.searchParams.has('retention')){
    const date=mode==='short-lock'?new Date(Date.now()+86400000).toISOString():retainUntil;
    res.writeHead(200,{'content-type':'application/xml'});res.end(`<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${mode==='governance'?'GOVERNANCE':'COMPLIANCE'}</Mode><RetainUntilDate>${date}</RetainUntilDate></Retention>`);return;
   }
   const bytes=Buffer.from(stored!);if(currentMode==='corrupt')bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
   const headers:Record<string,string|number>={'content-type':mode==='wrong-type'?'text/plain':'application/octet-stream','x-amz-version-id':mode==='wrong-version'?'other-version':version,'content-length':bytes.length};
   if(mode==='missing-length')delete headers['content-length'];res.writeHead(200,headers);
   if(mode==='missing-length'){res.write(bytes);res.end();return;}
   res.end(bytes);
  }catch{res.destroy();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
 const client=new S3Client({region:'auto',endpoint:`http://127.0.0.1:${address.port}`,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('hex')},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 return{path,cipher,key,retainUntil,version,calls,corrupt:()=>{currentMode='corrupt';},vault:createRecoveryVault(client,'crest-test-vault',10000),putCount:()=>putCount,async close(){client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}};
}
const signal=()=>new AbortController().signal;
test('streams ciphertext, pins the returned version and verifies exact bytes and compliance retention',async()=>{
 const f=await fixture();try{
  const artifact=await f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},signal());
  expect(artifact).toEqual({key:f.key,versionId:f.version,byteSize:f.cipher.length,sha256:createHash('sha256').update(f.cipher).digest('hex'),retainUntil:f.retainUntil});
  expect(f.calls).toHaveLength(3);expect(f.calls[0]).toMatchObject({method:'PUT',lock:'COMPLIANCE',until:f.retainUntil});expect(f.calls.slice(1).every(call=>call.version===f.version)).toBe(true);
  await expect(f.vault.verify(artifact,signal())).resolves.toEqual(artifact);expect(f.putCount()).toBe(1);
  const recovered=f.path+'.recovered';await expect(f.vault.retrieveEncryptedFile(artifact,recovered,signal())).resolves.toEqual(artifact);expect(await readFile(recovered)).toEqual(f.cipher);
 }finally{await f.close();}
});
test('recovery refuses an existing file without modifying its bytes',async()=>{
 const f=await fixture();try{const artifact=await f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},signal());await expect(f.vault.retrieveEncryptedFile(artifact,f.path,signal())).rejects.toMatchObject({code:'RECOVERY_VAULT_READ_FAILED'});expect(await readFile(f.path)).toEqual(f.cipher);}finally{await f.close();}
});
test('recovery removes its partial ciphertext after a hash mismatch',async()=>{
 const f=await fixture();try{const artifact=await f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},signal());f.corrupt();const recovered=f.path+'.recovered';await expect(f.vault.retrieveEncryptedFile(artifact,recovered,signal())).rejects.toMatchObject({code:'RECOVERY_VAULT_READ_FAILED'});await expect(readFile(recovered)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(f.path)).toEqual(f.cipher);}finally{await f.close();}
});
for(const mode of ['missing-version','governance','short-lock','corrupt','wrong-type','wrong-version','missing-length','lost-write'])test(`refuses ${mode} without retrying or claiming a verified artifact`,async()=>{
 const f=await fixture(mode);try{
  await expect(f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},signal())).rejects.toMatchObject({code:'RECOVERY_VAULT_WRITE_UNCERTAIN'});expect(f.putCount()).toBe(1);
 }finally{await f.close();}
});
test('refuses plaintext before any vault request',async()=>{
 const f=await fixture();try{await writeFile(f.path,'private plaintext');await expect(f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},signal())).rejects.toMatchObject({code:'RECOVERY_VAULT_INPUT_REQUIRED'});expect(f.calls).toHaveLength(0);}finally{await f.close();}
});
test('refuses an aborted operation before opening the file or making a request',async()=>{
 const f=await fixture();try{await expect(f.vault.publishEncryptedFile({key:f.key,path:f.path,retainUntil:f.retainUntil},AbortSignal.abort())).rejects.toMatchObject({code:'RECOVERY_VAULT_INPUT_REQUIRED'});expect(f.calls).toHaveLength(0);}finally{await f.close();}
});
test('rejects foreign keys and unversioned receipts before reading storage',async()=>{
 const f=await fixture();try{await expect(f.vault.verify({key:'other/file',versionId:'null',byteSize:f.cipher.length,sha256:'a'.repeat(64),retainUntil:f.retainUntil},signal())).rejects.toMatchObject({code:'RECOVERY_VAULT_READ_FAILED'});expect(f.calls).toHaveLength(0);}finally{await f.close();}
});
test('configuration cannot choose an arbitrary endpoint or ambient credentials',()=>{
 expect(()=>createB2RecoveryVault({region:'https://example.com',bucket:'crest-test-vault',accessKeyId:'',secretAccessKey:''})).toThrow('RECOVERY_VAULT_INPUT_REQUIRED');
 expect(()=>recoveryVaultArtifactKey('../foreign',randomUUID())).toThrow('RECOVERY_VAULT_INPUT_REQUIRED');
});
