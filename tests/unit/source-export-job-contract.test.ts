import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseSourceExportCommand,parseSourceExportJob,parseSourceExportCommitted} from '../../src/security/source-export-job-contract.ts';
import type {SourceExportCommand,SourceExportJob} from '../../src/security/source-export-job-contract.ts';
const error='SOURCE_EXPORT_COMMAND_REVIEW_REQUIRED',profile='crest.business-source-bundle.v1',stamp='2026-10-26T01:02:03.123456Z';
function fixture(kind:SourceExportCommand['commandType']='export.request',expectedVersion='1'){
 const businessId=randomUUID(),actor=randomUUID(),epoch=randomUUID(),operationId=randomUUID(),jobId=randomUUID(),leaseId=randomUUID();
 const command=parseSourceExportCommand({schemaVersion:1,businessId,commandType:kind,reference:{operationId,recoveryEpoch:epoch,exportJobId:jobId,...(kind==='export.request'?{appReleaseId:'a'.repeat(40),profile,sourceSchemaVersion:43}:{expectedVersion,...(kind==='export.stop'?{}:{leaseId}),...(kind==='export.ready'?{generationId:randomUUID(),requestSha256:'c'.repeat(64)}:{})})}});
 const job:{-readonly [K in keyof SourceExportJob]:SourceExportJob[K]}={id:jobId,business_id:businessId,actor_id:actor,profile,app_release_id:'a'.repeat(40),source_schema_version:43,recovery_epoch:epoch,request_operation_id:kind==='export.request'?operationId:randomUUID(),state:kind==='export.claim'?'Running':kind==='export.stop'?'Failed':'Queued',attempt_count:kind==='export.request'?0:1,lease_id:kind==='export.claim'?leaseId:null,lease_until:kind==='export.claim'?'2026-10-26T01:17:03.123456Z':null,next_run_at:kind==='export.expire'?'2026-10-26T01:03:03.123456Z':stamp,failure_code:kind==='export.stop'?'OWNER_STOPPED':kind==='export.expire'?'LEASE_EXPIRED':null,version:kind==='export.request'?'1':String(BigInt(expectedVersion)+1n),created_at:stamp,updated_at:stamp,created_by:actor,updated_by:actor,origin:'manual',operation_id:operationId,import_row_id:null};
 if(kind==='export.ready')job.state='Ready';
 const result={state:'committed',operationId,recoveryEpoch:epoch,receipt:{schemaVersion:1,command,job,auditEventId:randomUUID()}};
 return {businessId,actor,epoch,operationId,jobId,leaseId,command,job,result};
}
it.each(['export.request','export.claim','export.expire','export.stop','export.ready'] as const)('binds every original %s reference and exact original source projection',kind=>{
 const f=fixture(kind),read=parseSourceExportCommitted(f.result,f.command,f.actor);expect(read).toEqual(f.result);for(const value of [read,read.receipt,read.receipt.command,read.receipt.command.reference,read.receipt.job])expect(Object.isFrozen(value)).toBe(true);
 expect(read.receipt.job.created_at).toBe(stamp);expect(read.receipt.command.reference.operationId).toBe(f.operationId);
});
it.each(['leaseId','generationId','requestSha256','expectedVersion'] as const)('Ready retains its exact original %s after consuming the live lease',field=>{
 const f=fixture('export.ready'),changed=JSON.parse(JSON.stringify(f.command));changed.reference[field]=field==='expectedVersion'?'2':field==='requestSha256'?'d'.repeat(64):randomUUID();expect(()=>parseSourceExportCommitted(f.result,changed,f.actor)).toThrow(error);expect(parseSourceExportCommitted(f.result,f.command,f.actor).receipt.job.lease_id).toBeNull();
});
it.each([{attempt_count:0},{failure_code:'OWNER_STOPPED'},{lease_id:randomUUID(),lease_until:'2026-10-26T01:17:03.123456Z'},{state:'Running'}])('Ready rejects incompatible source projection %j',patch=>{
 const f=fixture('export.ready');expect(()=>parseSourceExportCommitted({...f.result,receipt:{...f.result.receipt,job:{...f.job,...patch}}},f.command,f.actor)).toThrow(error);
});
it.each([{generationId:'invalid'},{requestSha256:'A'.repeat(64)},{requestSha256:null},{leaseId:null}])('Ready refuses malformed retained completion references %j',patch=>{
 const f=fixture('export.ready');expect(()=>parseSourceExportCommand({...f.command,reference:{...f.command.reference,...patch}})).toThrow(error);
});
it('copies command and receipt scalars before later mutation',()=>{
 const f=fixture('export.claim'),input=JSON.parse(JSON.stringify(f.command)),parsed=parseSourceExportCommand(input),result=JSON.parse(JSON.stringify(f.result)),read=parseSourceExportCommitted(result,parsed,f.actor);input.reference.leaseId=randomUUID();result.receipt.job.lease_id=randomUUID();expect(parsed.reference).toEqual(f.command.reference);expect(read).toEqual(f.result);
});
it('retains decimal-string versions beyond Number precision and original UTC microseconds',()=>{
 const f=fixture('export.claim','9007199254740993');expect(parseSourceExportCommitted(f.result,f.command,f.actor).receipt.job.version).toBe('9007199254740994');expect(f.command.reference).toMatchObject({expectedVersion:'9007199254740993'});
});
it('preserves an expired original lease in its command even though the job projection clears the lease',()=>{
 const f=fixture('export.expire'),read=parseSourceExportCommitted(f.result,f.command,f.actor);expect(read.receipt.job.lease_id).toBeNull();expect(read.receipt.command.reference).toMatchObject({leaseId:f.leaseId});const wrong=JSON.parse(JSON.stringify(f.command));wrong.reference.leaseId=randomUUID();expect(()=>parseSourceExportCommitted(f.result,wrong,f.actor)).toThrow(error);
});
it('an explicit stop may retain an old request epoch and original actor while the stopping owner is current',()=>{
 const f=fixture('export.stop');f.job.recovery_epoch=randomUUID();f.job.actor_id=randomUUID();f.job.created_by=f.job.actor_id;expect(parseSourceExportCommitted(f.result,f.command,f.actor).receipt.job).toEqual(f.job);
});
it.each(['businessId','commandType','schemaVersion','extra'])('rejects changed or unknown top-level command field %s',field=>{
 const f=fixture(),input=JSON.parse(JSON.stringify(f.command));input[field]=field==='extra'?{token:'never persisted'}:'invalid';expect(()=>parseSourceExportCommand(input)).toThrow(error);
});
it.each(['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion','credentials','filters','draft'])('rejects invalid or additional frozen request field %s',field=>{
 const f=fixture(),input=JSON.parse(JSON.stringify(f.command));input.reference[field]='invalid';expect(()=>parseSourceExportCommand(input)).toThrow(error);
});
it.each(['0','01','-1','9223372036854775808',1,null])('rejects invalid expected version %j without numeric coercion',value=>{
 const f=fixture('export.claim'),input=JSON.parse(JSON.stringify(f.command));input.reference.expectedVersion=value;expect(()=>parseSourceExportCommand(input)).toThrow(error);
});
it('does not accept the current worker schema42 as the proposed schema43 request',()=>{const f=fixture(),input=JSON.parse(JSON.stringify(f.command));input.reference.sourceSchemaVersion=42;expect(()=>parseSourceExportCommand(input)).toThrow(error);});
it('does not execute getters and rejects symbols, custom prototypes and hidden fields',()=>{
 const f=fixture();let reads=0;const getter={...f.command,get reference(){reads++;return f.command.reference;}};expect(()=>parseSourceExportCommand(getter)).toThrow(error);expect(reads).toBe(0);
 for(const input of [{...f.command,[Symbol('extra')]:1},Object.assign(Object.create({unsafe:true}),f.command),Object.defineProperty({...f.command},'hidden',{value:1})])expect(()=>parseSourceExportCommand(input)).toThrow(error);
 expect(parseSourceExportCommand(Object.assign(Object.create(null),f.command))).toEqual(f.command);
});
it.each(['id','business_id','actor_id','profile','app_release_id','source_schema_version','recovery_epoch','request_operation_id','state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'])('requires the complete typed projection field %s',field=>{
 const f=fixture('export.claim'),job={...f.job,[field]:'invalid'};expect(()=>parseSourceExportJob(job,f.businessId)).toThrow(error);
});
it.each(['operationId','recoveryEpoch','receipt','extra'])('rejects mismatched outcome field %s',field=>{const f=fixture('export.claim'),value={...f.result,[field]:'invalid'};expect(()=>parseSourceExportCommitted(value,f.command,f.actor)).toThrow(error);});
it.each(['schemaVersion','command','job','auditEventId','extra'])('rejects malformed receipt field %s',field=>{const f=fixture('export.claim'),value={...f.result,receipt:{...f.result.receipt,[field]:'invalid'}};expect(()=>parseSourceExportCommitted(value,f.command,f.actor)).toThrow(error);});
it('binds request release, job identity and authenticated recording actor independently of a valid command',()=>{
 for(const field of ['app_release_id','id','updated_by']){const f=fixture();(f.job as unknown as Record<string,unknown>)[field]=field==='app_release_id'?'b'.repeat(40):randomUUID();expect(()=>parseSourceExportCommitted(f.result,f.command,f.actor)).toThrow(error);}
});
it('claim/expiry receipts cannot silently substitute another recovery epoch or recording actor',()=>{for(const kind of ['export.claim','export.expire'] as const){const f=fixture(kind);f.job.recovery_epoch=randomUUID();expect(()=>parseSourceExportCommitted(f.result,f.command,f.actor)).toThrow(error);}});
it('requires the exact post-command version even when a different version is otherwise valid',()=>{const f=fixture('export.claim');f.job.version='3';expect(()=>parseSourceExportCommitted(f.result,f.command,f.actor)).toThrow(error);});
it('rejects an expired/completed lease projection masquerading as a successful current claim receipt',()=>{const f=fixture('export.claim');f.job.lease_until='2026-10-26T01:02:03.123455Z';expect(()=>parseSourceExportCommitted(f.result,f.command,f.actor)).toThrow(error);});
it('rejects impossible queue/lease/failure combinations and invalid calendar dates',()=>{
 const samples=[{state:'Queued',attempt_count:5,failure_code:'LEASE_EXPIRED'},{state:'Failed',attempt_count:1,failure_code:'LEASE_EXPIRED'},{state:'Running',attempt_count:0,lease_id:randomUUID(),lease_until:'2026-10-26T01:17:03.123456Z'},{state:'Queued',failure_code:'OWNER_STOPPED'},{created_at:'2026-02-30T01:02:03.123456Z'}];
 for(const patch of samples){const f=fixture('export.expire');expect(()=>parseSourceExportJob({...f.job,...patch},f.businessId)).toThrow(error);}
});
it('the fifth expired attempt is Failed and earlier expired attempts remain Queued',()=>{
 const f=fixture('export.expire','9');f.job.attempt_count=5;f.job.state='Failed';expect(parseSourceExportCommitted(f.result,f.command,f.actor).receipt.job.state).toBe('Failed');f.job.state='Queued';expect(()=>parseSourceExportCommitted(f.result,f.command,f.actor)).toThrow(error);
});
