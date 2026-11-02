// Ephemeral test-only TLS. No certificate store, trust-store or host-policy changes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,rm,rmdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {privateRecoveryWorkspace} from './private-recovery-permissions.mjs';
export async function browserTestTls(){
 assert.equal(process.env.CREST_ENV,'test');
 const directory=await privateRecoveryWorkspace(),key=join(directory,'ephemeral.key'),cert=join(directory,'ephemeral.pem');
 try{
  if(process.platform==='linux')execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-noenc','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore',timeout:15000});
  else{
   assert.equal(process.platform,'win32');const executable=process.env.CREST_TEST_POWERSHELL;assert(executable&&isAbsolute(executable),'EXPLICIT_TEST_POWERSHELL_REQUIRED');
   const script=`$ErrorActionPreference='Stop'
$rsa=[Security.Cryptography.RSA]::Create(2048)
try{
 $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
 $san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'));$san.AddDnsName('localhost');$request.CertificateExtensions.Add($san.Build())
 $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddDays(1))
 try{[IO.File]::WriteAllText($env:CREST_TEST_TLS_KEY,$rsa.ExportPkcs8PrivateKeyPem());[IO.File]::WriteAllText($env:CREST_TEST_TLS_CERT,$certificate.ExportCertificatePem())}finally{$certificate.Dispose()}
}finally{$rsa.Dispose()}`;
   execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,CREST_TEST_TLS_KEY:key,CREST_TEST_TLS_CERT:cert},stdio:'ignore',timeout:15000});
  }
  return {key:await readFile(key),cert:await readFile(cert)};
 }catch{throw Error('SYNTHETIC_BROWSER_TLS_FAILED');}
 finally{await rm(key,{force:true});await rm(cert,{force:true});await rmdir(directory);}
}
