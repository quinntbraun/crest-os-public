// Pure policy from EXPORTS_AND_BACKUPS6. The caller must obtain the timestamp
// from the authoritative verified-complete-point store, never a staged run.
const hour=3600000n,period=6n*hour,offset=20n*60000n;
export class RecoveryProtectionPolicyError extends Error{constructor(){super('RECOVERY_PROTECTION_REVIEW_REQUIRED');this.name='RecoveryProtectionPolicyError';}}
function milliseconds(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw new RecoveryProtectionPolicyError();const parsed=Date.parse(value);if(!Number.isSafeInteger(parsed)||new Date(parsed).toISOString()!==value)throw new RecoveryProtectionPolicyError();return BigInt(parsed);}
export function recoveryProtectionStatus(now:string,lastVerifiedCompleteSnapshotAt:string|null){
 const clock=milliseconds(now),common={evaluatedAt:now,ordinaryFinancialWritesBlocked:false as const,completeBackup:false as const};
 if(lastVerifiedCompleteSnapshotAt===null)return Object.freeze({...common,level:'unprotected' as const,lastVerifiedCompleteSnapshotAt:null,ageMilliseconds:null,recoveryObjectiveBreachVerified:false as const,attentionRequired:true as const});
 const captured=milliseconds(lastVerifiedCompleteSnapshotAt),age=clock-captured;if(age<0n)throw new RecoveryProtectionPolicyError();
 const level=age>=24n*hour?'breach':age>=12n*hour?'critical':age>=8n*hour?'warning':'current';
 return Object.freeze({...common,level,lastVerifiedCompleteSnapshotAt,ageMilliseconds:age.toString(),recoveryObjectiveBreachVerified:level==='breach',attentionRequired:level!=='current'});
}
export function nextRecoveryBackupSlot(after:string){
 const now=milliseconds(after);if(now<0n)throw new RecoveryProtectionPolicyError();
 const since=now-offset,quotient=since>=0n?since/period:-1n,next=(quotient+1n)*period+offset;
 const value=Number(next);if(!Number.isSafeInteger(value)||value>253402300799999)throw new RecoveryProtectionPolicyError();
 return new Date(value).toISOString();
}
