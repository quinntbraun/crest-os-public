// Isolated recovery-tool orchestration, never an application route or authority.
// Callers reserve the point/destination before dispatch and retain unknown writes.
// Transport adapters must bound reads while streaming, honor the signal, and use
// immutable create-only writes. Encryption adapters use standard age, not a cipher
// designed here. The backup side receives only a public encryption recipient.
import {createHash} from 'node:crypto';

export type RecoveryObject=Readonly<{key:string;byteSize:number;sha256:string;retention:'original'|'derivative'|'quarantine'}>;
type Digest=Readonly<{key:string;byteSize:number;sha256:string}>;
export type ObjectArchiveReceipt=Readonly<{version:1;pointId:string;manifest:Digest}>;
export type RecoveryReader=(key:string,maximumBytes:number,signal:AbortSignal)=>Promise<Uint8Array>;
export type RecoveryWriter=(key:string,bytes:Uint8Array,signal:AbortSignal)=>Promise<void>;
type Crypt=(bytes:Uint8Array,signal:AbortSignal)=>Promise<Uint8Array>;
type Stage='inventory'|'source'|'encrypt'|'vault_write'|'vault_verify'|'manifest'|'decrypt'|'destination_write'|'destination_verify'|'aborted';
export class ObjectRecoveryError extends Error {
  readonly stage:Stage;
  constructor(stage:Stage){super('OBJECT_RECOVERY_FAILED:'+stage);this.name='ObjectRecoveryError';this.stage=stage;}
}
const maxObject=25*1024*1024,maxManifest=2*1024*1024,overhead=64*1024,maxTotal=256*1024*1024;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const pointPattern=new RegExp(`^${uuid}$`),retainedPattern=new RegExp(`^(originals|previews)/${uuid}/${uuid}$`);
const stagingPattern=new RegExp(`^staging/${uuid}/${uuid}/${uuid}$`);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function check(value:unknown):asserts value{if(!value)throw new Error('invalid');}
function fields(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
  check(value&&typeof value==='object'&&!Array.isArray(value));
  check(Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)));
}
function inventory(value:readonly RecoveryObject[]){
  check(Array.isArray(value)&&value.length<=1000);let total=0;const keys=new Set<string>();
  return Object.freeze(value.map(v=>{
    fields(v,['key','byteSize','sha256','retention']);
    const {key,byteSize,sha256,retention}=v;
    check(typeof key==='string'&&(retainedPattern.test(key)||(retention==='quarantine'&&stagingPattern.test(key))));
    check(retention==='original'||retention==='derivative'||retention==='quarantine');
    check(retention!=='original'||key.startsWith('originals/'));check(retention!=='derivative'||key.startsWith('previews/'));
    check(typeof byteSize==='number'&&Number.isSafeInteger(byteSize)&&byteSize>0&&byteSize<=maxObject&&(!key.startsWith('previews/')||byteSize<=8*1024*1024));
    check(typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256)&&!keys.has(key));keys.add(key);
    total+=byteSize;check(total<=maxTotal);return Object.freeze({key,byteSize,sha256,retention});
  }));
}
function bounded(bytes:Uint8Array,max:number){check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=max);return Buffer.from(bytes);}
function matches(bytes:Uint8Array,digest:{byteSize:number;sha256:string}){check(bytes.byteLength===digest.byteSize&&sha(bytes)===digest.sha256);}
function encrypted(bytes:Uint8Array,max:number){const b=bounded(bytes,max),header='age-encryption.org/v1\n';check(b.subarray(0,header.length).toString()===header);return b;}
function signalFor(signal?:AbortSignal){return AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);}
function live(signal:AbortSignal){if(signal.aborted)throw new ObjectRecoveryError('aborted');}
function objectKey(pointId:string,index:number){return `recovery/${pointId}/objects/${index}.age`;}
function manifestKey(pointId:string){return `recovery/${pointId}/manifest.age`;}
function receiptCopy(receipt:ObjectArchiveReceipt){
  fields(receipt,['version','pointId','manifest']);check(receipt.version===1&&typeof receipt.pointId==='string'&&pointPattern.test(receipt.pointId));
  fields(receipt.manifest,['key','byteSize','sha256']);const {key,byteSize,sha256}=receipt.manifest;
  check(key===manifestKey(receipt.pointId)&&Number.isSafeInteger(byteSize)&&byteSize>0&&byteSize<=maxManifest+overhead&&typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256));
  return {version:1 as const,pointId:receipt.pointId,manifest:{key,byteSize,sha256}};
}

// Inventory comes from the held DB snapshot, including archived/historical and
// quarantined retained bytes. No status filtering, listing, decoding or deletion.
export async function captureObjectArchive(pointId:string,objects:readonly RecoveryObject[],ports:{readSource:RecoveryReader;seal:Crypt;putVault:RecoveryWriter;readVault:RecoveryReader},signal?:AbortSignal):Promise<ObjectArchiveReceipt>{
  let stage:Stage='inventory';const boundedSignal=signalFor(signal);
  try{
    check(typeof pointId==='string'&&pointPattern.test(pointId));const expected=inventory(objects),{readSource,seal,putVault,readVault}=ports;live(boundedSignal);
    const entries=[];
    for(const [index,object] of expected.entries()){
      stage='source';const plain=bounded(await readSource(object.key,object.byteSize,boundedSignal),object.byteSize);matches(plain,object);live(boundedSignal);
      stage='encrypt';const cipher=encrypted(await seal(plain,boundedSignal),object.byteSize+overhead);live(boundedSignal);
      const archived={key:objectKey(pointId,index),byteSize:cipher.length,sha256:sha(cipher)};
      stage='vault_write';await putVault(archived.key,Buffer.from(cipher),boundedSignal);live(boundedSignal);
      stage='vault_verify';matches(bounded(await readVault(archived.key,archived.byteSize,boundedSignal),archived.byteSize),archived);live(boundedSignal);
      entries.push({...object,cipher:archived});
    }
    stage='manifest';const plain=Buffer.from(JSON.stringify({version:1,scope:'retained_object_archive',pointId,completeBackup:false,objects:entries}));
    check(plain.length<=maxManifest);const cipher=encrypted(await seal(plain,boundedSignal),maxManifest+overhead);live(boundedSignal);
    const manifest=Object.freeze({key:manifestKey(pointId),byteSize:cipher.length,sha256:sha(cipher)});
    stage='vault_write';await putVault(manifest.key,Buffer.from(cipher),boundedSignal);live(boundedSignal);
    stage='vault_verify';matches(bounded(await readVault(manifest.key,manifest.byteSize,boundedSignal),manifest.byteSize),manifest);live(boundedSignal);
    return Object.freeze({version:1,pointId,manifest});
  }catch{throw new ObjectRecoveryError(boundedSignal.aborted?'aborted':stage);}
}

// Receipt AND expected inventory are taken from the independently trusted,
// decrypted DB recovery manifest, never inferred from an untrusted vault listing.
// Preflight every object before any destination write, then verify again during
// copying. A late vault/write failure can leave private candidates; retain them.
export async function restoreObjectArchive(receipt:ObjectArchiveReceipt,objects:readonly RecoveryObject[],ports:{readVault:RecoveryReader;unseal:Crypt;putDestination:RecoveryWriter;readDestination:RecoveryReader},signal?:AbortSignal){
  let stage:Stage='inventory';const boundedSignal=signalFor(signal);
  try{
    const expected=inventory(objects),point=receiptCopy(receipt),{readVault,unseal,putDestination,readDestination}=ports;live(boundedSignal);
    stage='manifest';const cipher=encrypted(await readVault(point.manifest.key,point.manifest.byteSize,boundedSignal),point.manifest.byteSize);matches(cipher,point.manifest);
    const plain=bounded(await unseal(cipher,boundedSignal),maxManifest);live(boundedSignal);
    const manifest:unknown=JSON.parse(plain.toString('utf8'));fields(manifest,['version','scope','pointId','completeBackup','objects']);
    check(manifest.version===1&&manifest.scope==='retained_object_archive'&&manifest.pointId===point.pointId&&manifest.completeBackup===false);
    check(Array.isArray(manifest.objects)&&manifest.objects.length===expected.length);
    const entries=manifest.objects.map((v:unknown,i:number)=>{
      fields(v,['key','byteSize','sha256','retention','cipher']);const object=expected[i];check(object);
      check(v.key===object.key&&v.byteSize===object.byteSize&&v.sha256===object.sha256&&v.retention===object.retention);
      fields(v.cipher,['key','byteSize','sha256']);const c=v.cipher;
      check(c.key===objectKey(point.pointId,i)&&typeof c.byteSize==='number'&&Number.isSafeInteger(c.byteSize)&&c.byteSize>0&&c.byteSize<=object.byteSize+overhead&&typeof c.sha256==='string'&&/^[a-f0-9]{64}$/.test(c.sha256));
      return {object,cipher:{key:c.key,byteSize:c.byteSize,sha256:c.sha256}};
    });
    async function recover(entry:(typeof entries)[number]){
      stage='vault_verify';const c=encrypted(await readVault(entry.cipher.key,entry.cipher.byteSize,boundedSignal),entry.cipher.byteSize);matches(c,entry.cipher);live(boundedSignal);
      stage='decrypt';const bytes=bounded(await unseal(c,boundedSignal),entry.object.byteSize);matches(bytes,entry.object);live(boundedSignal);return bytes;
    }
    for(const entry of entries)await recover(entry);
    for(const entry of entries){
      const bytes=await recover(entry);stage='destination_write';await putDestination(entry.object.key,bytes,boundedSignal);live(boundedSignal);
      stage='destination_verify';matches(bounded(await readDestination(entry.object.key,entry.object.byteSize,boundedSignal),entry.object.byteSize),entry.object);live(boundedSignal);
    }
    return Object.freeze({status:'PrivateObjectsRestored' as const,pointId:point.pointId,objectCount:entries.length});
  }catch{throw new ObjectRecoveryError(boundedSignal.aborted?'aborted':stage);}
}
