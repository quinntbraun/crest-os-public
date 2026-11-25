// EXPORTS_AND_BACKUPS6 notification policy. The caller must read an actual
// authoritative complete-point timestamp and durable notification attempts.
// A capture candidate, acknowledgment or scheduler start cannot supply it.
import {createHash} from 'node:crypto';
import {recoveryProtectionStatus} from './recovery-protection-policy.ts';

type Kind='unprotected'|'warning'|'critical'|'breach'|'reminder'|'recovered';
export type RecoveryAlertAttempt=Readonly<{
 id:string;incidentId:string;kind:Kind;at:string;lastVerifiedCompleteSnapshotAt:string|null;
 delivery:'reserved'|'acknowledged'|'unknown';
}>;
type Notice=Omit<RecoveryAlertAttempt,'delivery'>;
const day=86400000,ranks={unprotected:0,warning:1,critical:2,breach:3} as const;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const kinds=['unprotected','warning','critical','breach','reminder','recovered'];
export class RecoveryAlertPolicyError extends Error{constructor(){super('RECOVERY_ALERT_REVIEW_REQUIRED');this.name='RecoveryAlertPolicyError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryAlertPolicyError();}
function instant(value:unknown):number{
 require(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
 const result=Date.parse(value);require(Number.isSafeInteger(result)&&new Date(result).toISOString()===value);return result;
}
function noticeId(value:Omit<Notice,'id'>){return sha(JSON.stringify(['crest.backup-alert.v1',value.incidentId,value.kind,value.at,value.lastVerifiedCompleteSnapshotAt]));}
function readAttempts(value:readonly RecoveryAlertAttempt[],now:number){
 require(Array.isArray(value)&&value.length<=4096);const ids=new Set<string>();let previous=-Infinity;
 for(const row of value){
  require(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='at,delivery,id,incidentId,kind,lastVerifiedCompleteSnapshotAt');
  require(typeof row.id==='string'&&/^[a-f0-9]{64}$/.test(row.id)&&!ids.has(row.id)&&typeof row.incidentId==='string'&&/^[a-f0-9]{64}$/.test(row.incidentId)&&kinds.includes(row.kind)&&['reserved','acknowledged','unknown'].includes(row.delivery));
  const at=instant(row.at);require(at>=previous&&at<=now);previous=at;ids.add(row.id);
  const status=recoveryProtectionStatus(row.at,row.lastVerifiedCompleteSnapshotAt);
  require(row.kind==='recovered'?status.level==='current':row.kind==='reminder'?status.attentionRequired:row.kind===status.level);
  require(row.id===noticeId(row));
 }
 return value;
}

export function planRecoveryProtectionAlert(input:Readonly<{
 now:string;lastVerifiedCompleteSnapshotAt:string|null;attempts:readonly RecoveryAlertAttempt[];
}>){
 try{
  require(input&&typeof input==='object'&&Object.keys(input).sort().join(',')==='attempts,lastVerifiedCompleteSnapshotAt,now');
  const now=instant(input.now),attempts=readAttempts(input.attempts,now),status=recoveryProtectionStatus(input.now,input.lastVerifiedCompleteSnapshotAt);
  const last=attempts.at(-1),open=last&&last.kind!=='recovered'?last.incidentId:null;
  // A known complete-point catalog becoming unavailable is a failed read, not
  // a newly established empty catalog. The dispatcher must stop and alert its
  // independent monitor rather than inventing an age or a recovery notice.
  const known=attempts.filter(row=>row.lastVerifiedCompleteSnapshotAt!==null).at(-1)?.lastVerifiedCompleteSnapshotAt;
  if(known){require(input.lastVerifiedCompleteSnapshotAt!==null&&instant(input.lastVerifiedCompleteSnapshotAt)>=instant(known));}
  let kind:Kind|undefined,incidentId:string|undefined;
  if(status.level==='current'){
   if(open){kind='recovered';incidentId=open;}
  }else if(!open){
   kind=status.level;incidentId=sha('crest.backup-incident.v1:'+String(input.lastVerifiedCompleteSnapshotAt));
  }else{
   incidentId=open;const currentIncident=attempts.filter(row=>row.incidentId===open),primary=currentIncident.filter(row=>row.kind in ranks);
   const highest=Math.max(-1,...primary.map(row=>ranks[row.kind as keyof typeof ranks]));
   if(ranks[status.level]>highest)kind=status.level;
   else if(last&&now-instant(last.at)>=day)kind='reminder';
  }
  let notification:Readonly<Notice>|null=null;
  if(kind&&incidentId){const fields={incidentId,kind,at:input.now,lastVerifiedCompleteSnapshotAt:input.lastVerifiedCompleteSnapshotAt};notification=Object.freeze({id:noticeId(fields),...fields});require(!attempts.some(row=>row.id===notification!.id));}
  return Object.freeze({profile:'crest.backup-alert-plan.v1' as const,status,notification,
   ordinaryFinancialWritesBlocked:false as const,completeBackup:false as const});
 }catch{throw new RecoveryAlertPolicyError();}
}
