// Explicit synthetic certificate input: never edits a host trust store.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPrivateKey,createHash,X509Certificate} from 'node:crypto';

export async function readSyntheticTls(directory){
 try{
  const key=await readFile(join(directory,'tls.key')),cert=await readFile(join(directory,'tls.pem'));
  const parsed=new X509Certificate(cert),now=Date.now();
  if(parsed.ca||!parsed.checkPrivateKey(createPrivateKey(key))||!parsed.verify(parsed.publicKey)||!parsed.checkIP('127.0.0.1')||!parsed.checkHost('localhost',{subject:'never'})||Date.parse(parsed.validFrom)>now||Date.parse(parsed.validTo)<=now)throw Error();
  return {key,cert,sha256:createHash('sha256').update(cert).digest('hex')};
 }catch{throw Error('SYNTHETIC_LOCAL_TLS_INPUT_REQUIRED');}
}
