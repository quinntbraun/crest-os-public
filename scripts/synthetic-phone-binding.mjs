// Explicit two-owned-device construction binding, never a production ingress.
import {isIPv4} from 'node:net';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,createPrivateKey,X509Certificate} from 'node:crypto';

export class SyntheticPhonePreviewError extends Error{constructor(){super('SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED');}}
function require(value){if(!value)throw new SyntheticPhonePreviewError();}
function address(value){
 require(typeof value==='string');const match=/^([^/]+)(?:\/([0-9]|[12][0-9]|3[0-2]))?$/.exec(value);
 require(match&&isIPv4(match[1]));const parts=match[1].split('.').map(Number);
 require(parts[0]===100&&parts[1]>=64&&parts[1]<=127);return match[1];
}
export function parseSyntheticPhoneBinding(value,status,workspaceId){
 try{
  const keys=['formatVersion','workspaceId','laptopAddress','phoneAddress','certificateSha256'];
  require(value&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)));
  require(value.formatVersion===1&&/^[a-f0-9]{16}$/.test(workspaceId)&&value.workspaceId===workspaceId&&/^[a-f0-9]{64}$/.test(value.certificateSha256));
  const laptop=address(value.laptopAddress),phone=address(value.phoneAddress);
  require(laptop===value.laptopAddress&&phone===value.phoneAddress&&laptop!==phone);
  require(status?.daemonStatus==='Connected'&&status.management?.connected===true&&address(status.netbirdIp)===laptop);
  // Lazy connections may report Idle until the phone actually requests the app.
  require(status.peers?.total===1&&Array.isArray(status.peers.details)&&status.peers.details.length===1&&address(status.peers.details[0].netbirdIp)===phone);
  return Object.freeze({...value,origin:'https://'+laptop+':4319'});
 }catch{throw new SyntheticPhonePreviewError();}
}
export async function readSyntheticPhoneTls(directory,binding){
 try{
  const key=await readFile(join(directory,'phone.key')),cert=await readFile(join(directory,'phone.pem')),parsed=new X509Certificate(cert),now=Date.now();
  require(!parsed.ca&&parsed.verify(parsed.publicKey)&&parsed.checkPrivateKey(createPrivateKey(key))&&parsed.checkIP(binding.laptopAddress)&&Date.parse(parsed.validFrom)<=now&&Date.parse(parsed.validTo)>now&&createHash('sha256').update(cert).digest('hex')===binding.certificateSha256);
  return {key,cert};
 }catch{throw new SyntheticPhonePreviewError();}
}
export function restrictSyntheticPhoneSockets(server,binding){
 const allowed=new Set([binding.laptopAddress,binding.phoneAddress]);
 server.prependListener('connection',socket=>{if(!allowed.has(socket.remoteAddress?.replace(/^::ffff:/,'')))socket.destroy();});
}
