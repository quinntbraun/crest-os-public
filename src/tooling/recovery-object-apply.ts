// Apply only authenticated recovered bytes to four new private destinations.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {preparedRecoveryObjects} from './recovery-run-restore.ts';
import {hashRecoveryReleaseFile} from './recovery-release-files.ts';
import type {createRecoveryObjectDestination,RecoveryObjectSlot} from './recovery-object-destination.ts';
import type {RecoveryObjectApplyJournal} from './recovery-object-apply-journal.ts';
type Destination=ReturnType<typeof createRecoveryObjectDestination>;
type Ports=Readonly<{destinations:Readonly<Record<RecoveryObjectSlot,Destination>>;journal:RecoveryObjectApplyJournal}>;
type Stage='preflight'|'source_files'|'destinations'|'dispatch'|'final_inventory'|'journal';
export class RecoveryObjectApplyError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_OBJECT_APPLY_REVIEW_REQUIRED');this.name='RecoveryObjectApplyError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryObjectApplyError('preflight');}
const slots=['expense_receipt','supplier_document','condition_photo','quarantine'] as const;
export async function applyRecoveryObjects(prepared:unknown,ports:Ports,external:AbortSignal){
 let stage:Stage='preflight';const signal=AbortSignal.any([external,AbortSignal.timeout(3600000)]);
 try{
  signal.throwIfAborted();const source=preparedRecoveryObjects(prepared),destinations=Object.freeze({...ports.destinations}),journal=ports.journal,state=journal.view();require(Object.keys(destinations).sort().join(',')===[...slots].sort().join(',')&&slots.every(slot=>destinations[slot]?.slot===slot)&&new Set(slots.map(slot=>destinations[slot].binding)).size===4&&state.header.pointId===source.binding.pointId&&!state.reviewRequired&&isDeepStrictEqual(state.header.destinations,Object.fromEntries(slots.map(slot=>[slot,destinations[slot].binding]))));
  stage='source_files';for(const file of source.objects){signal.throwIfAborted();const info=await lstat(file.path);require(info.isFile()&&(process.platform!=='linux'||((info.mode&0o077)===0&&info.uid===process.getuid!())));if(file.byteSize===0){require(file.retention==='quarantine'&&info.size===0&&createHash('sha256').digest('hex')===file.sha256);}else{const observed=await hashRecoveryReleaseFile(file.path,signal);require(observed.byteSize===file.byteSize&&observed.sha256===file.sha256);}}
  stage='destinations';const begun=await Promise.allSettled(slots.map(slot=>destinations[slot].begin(signal)));require(begun.every(result=>result.status==='fulfilled'));
  for(const file of source.objects){
   signal.throwIfAborted();stage='source_files';const bytes=await readFile(file.path);try{
    require(bytes.length===file.byteSize&&createHash('sha256').update(bytes).digest('hex')===file.sha256);const slot=file.retention==='quarantine'?'quarantine':file.domain,key=slot==='quarantine'?`quarantine/${source.binding.pointId}/${file.domain}/${file.key}`:file.key,destination=destinations[slot];stage='journal';const reservation=await journal.reserve({slot,binding:destination.binding,key,byteSize:file.byteSize,sha256:file.sha256});
    try{stage='dispatch';const receipt=await destination.write({key,bytes,sha256:file.sha256,contentType:file.retention==='quarantine'?'application/octet-stream':file.contentType},signal);stage='journal';await journal.acknowledge(reservation,receipt);}catch{await journal.uncertain(reservation).catch(()=>{});throw new RecoveryObjectApplyError(stage);}
   }finally{bytes.fill(0);}
  }
  stage='final_inventory';const results=await Promise.allSettled(slots.map(slot=>destinations[slot].finish(signal)));require(results.every(result=>result.status==='fulfilled'));const destinationsVerified=results.map(result=>{require(result.status==='fulfilled');return result.value;});require(destinationsVerified.reduce((sum,item)=>sum+item.objectCount,0)===source.objects.length);stage='journal';signal.throwIfAborted();await journal.finish();
  const evidence=Object.freeze({profile:'crest.applied-recovery-objects.v1' as const,pointId:source.binding.pointId,operationId:state.header.operationId,objectCount:source.objects.length,publishedCount:source.objects.filter(file=>file.retention==='published').length,quarantineCount:source.objects.filter(file=>file.retention==='quarantine').length,destinations:Object.freeze(destinationsVerified),quarantineRendered:false as const,atomicDestinationSnapshot:false as const,runtimeActivated:false as const,completeBackup:false as const});return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryObjectApplyError('journal');}});
 }catch{throw new RecoveryObjectApplyError(stage);}
}
