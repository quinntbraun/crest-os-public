import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {readSyntheticTls} from '../../scripts/synthetic-workspace-tls.mjs';
import {readSyntheticPhoneTls} from '../../scripts/synthetic-phone-binding.mjs';

test('local TLS preflight accepts the matching loopback pair and rejects unsafe inputs without disclosure',async()=>{
 const scope=resolve('.local/synthetic-tls-tests');await mkdir(scope,{recursive:true});const directory=await mkdtemp(join(scope,'case-'));
 try{
  await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);
  const generate=(name,san,ca=false)=>execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-noenc','-keyout',join(directory,name+'.key'),'-out',join(directory,name+'.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName='+san,'-addext','basicConstraints=critical,CA:'+String(ca).toUpperCase()],{stdio:'ignore',timeout:15000});
  generate('tls','IP:127.0.0.1,DNS:localhost');const originalKey=await readFile(join(directory,'tls.key')),originalCert=await readFile(join(directory,'tls.pem'));
  const accepted=await readSyntheticTls(directory);assert.deepEqual(accepted.key,originalKey);assert.deepEqual(accepted.cert,originalCert);assert.equal(accepted.sha256,createHash('sha256').update(originalCert).digest('hex'));
  generate('other','IP:127.0.0.1,DNS:localhost');await writeFile(join(directory,'tls.key'),await readFile(join(directory,'other.key')));await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);await writeFile(join(directory,'tls.key'),originalKey);
  generate('tls','DNS:localhost');await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);
  generate('tls','IP:127.0.0.1');await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);
  generate('tls','IP:127.0.0.1,DNS:localhost',true);await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);
  await writeFile(join(directory,'tls.pem'),'invalid private-looking input');await assert.rejects(readSyntheticTls(directory),/^Error: SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED$/);
  generate('phone','IP:100.64.1.1');const phoneCert=await readFile(join(directory,'phone.pem')),phoneKey=await readFile(join(directory,'phone.key')),binding={laptopAddress:'100.64.1.1',certificateSha256:createHash('sha256').update(phoneCert).digest('hex')};
  assert.deepEqual((await readSyntheticPhoneTls(directory,binding)).cert,phoneCert);
  for(const patch of [{laptopAddress:'100.64.1.2'},{certificateSha256:'0'.repeat(64)}])await assert.rejects(readSyntheticPhoneTls(directory,{...binding,...patch}),/^Error: SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED$/);
  await writeFile(join(directory,'phone.key'),await readFile(join(directory,'other.key')));await assert.rejects(readSyntheticPhoneTls(directory,binding),/^Error: SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED$/);await writeFile(join(directory,'phone.key'),phoneKey);
  generate('phone','IP:100.64.1.1',true);const ca=await readFile(join(directory,'phone.pem'));await assert.rejects(readSyntheticPhoneTls(directory,{...binding,certificateSha256:createHash('sha256').update(ca).digest('hex')}),/^Error: SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED$/);
 }finally{
  const child=relative(scope,directory);assert(dirname(directory)===scope&&child.startsWith('case-')&&!child.includes('..')&&!isAbsolute(child));await rm(directory,{recursive:true,force:true});
 }
});
