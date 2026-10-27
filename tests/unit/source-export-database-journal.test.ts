import {beforeEach,it,expect,vi} from 'vitest';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),read:vi.fn(),query:vi.fn(),transaction:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>Object.assign(mock.read,{commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createSourceExportDatabaseJournal} from '../../src/security/source-export-database-journal.ts';
import type {SourceExportJob} from '../../src/security/source-export-job-contract.ts';
const stamp='2026-10-26T21:00:00.000001Z',sha=(v:string)=>createHash('sha256').update(v).digest('hex'),credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const job:SourceExportJob={id:randomUUID(),business_id:randomUUID(),actor_id:randomUUID(),profile:'crest.business-source-journal-bundle.v1',app_release_id:'a'.repeat(40),source_schema_version:43,recovery_epoch:randomUUID(),request_operation_id:randomUUID(),state:'Running',attempt_count:1,lease_id:randomUUID(),lease_until:'2026-10-26T21:15:00.000001Z',next_run_at:stamp,failure_code:null,version:'2',created_at:stamp,updated_at:stamp,created_by:'',updated_by:'',origin:'manual',operation_id:randomUUID(),import_row_id:null};
const claimed=Object.freeze({...job,created_by:job.actor_id,updated_by:job.actor_id}),operation=randomUUID(),generation=randomUUID();
const claim={formatVersion:1,profile:claimed.profile,businessId:claimed.business_id,actorId:claimed.actor_id,exportJobId:claimed.id,recoveryEpoch:claimed.recovery_epoch,leaseId:claimed.lease_id};
const plan={claim,sourceSchemaVersion:43,appReleaseId:claimed.app_release_id,generationId:generation};
const raw=(stage:string)=>JSON.stringify(stage==='authorize'?claim:stage==='snapshot'?{plan,planSha256:'b'.repeat(64)}:stage==='ready'?{plan,planSha256:'b'.repeat(64),parts:[]}:{claim,generationId:generation,planSha256:'b'.repeat(64),partId:randomUUID(),intent:{}});
const stages=['authorize','snapshot','intent','verified','ready'] as const;
const factory=(source=claimed,op:string=operation)=>createSourceExportDatabaseJournal({connectionString:'unused-by-mock',environment:'test'},{} as Parameters<typeof createSourceExportDatabaseJournal>[1],{} as Parameters<typeof createSourceExportDatabaseJournal>[2],source,op);
beforeEach(()=>{
 vi.clearAllMocks();mock.events.length=0;
 mock.verify.mockImplementation(async()=>{mock.events.push('fresh-provider');return {sessionId:randomUUID(),actorId:claimed.actor_id,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+300000}};});
 mock.query.mockImplementation(async(sql:string,args:unknown[])=>{mock.events.push('sql');const stage=sql.includes('_worker(')?'authorize':sql.includes('_snapshot(')?'snapshot':sql.includes('_part_intent(')?'intent':sql.includes('_part_verified(')?'verified':'ready';return {formatVersion:1,stage,requestSha256:sha(args.at(-1) as string)};});
 mock.transaction.mockImplementation(async(work,current)=>{mock.events.push('begin');const r=await work(mock.query,current);mock.events.push('commit');return r;});mock.read.mockResolvedValue({state:'absent'});
});
it.each(stages)('%s uses fresh recent background authentication and releases its exact-byte acknowledgment only after commit',async stage=>{
 const original=' '+raw(stage),result=await factory()[stage](credential,original,signal());expect(mock.events).toEqual(['fresh-provider','begin','sql','commit']);expect(result).toEqual({formatVersion:1,stage,requestSha256:sha(original)});expect(Object.isFrozen(result)).toBe(true);expect(mock.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);
 const [sql,args]=mock.query.mock.calls[0]!;expect(sql).toMatch(/^SELECT crest_commands\./);expect(args[0]).toEqual(Buffer.alloc(32));expect(args[7]).toBe(claimed.business_id);expect(args[8]).toBe(claimed.recovery_epoch);expect(args.at(-1)).toBe(original);if(stage==='ready')expect(args.slice(9,11)).toEqual([operation,'2']);else expect(args).toHaveLength(10);
});
it('copies the original claim/version/operation before later caller mutation and never serializes its private adapter',async()=>{
 const input={...claimed},port=factory(input);input.id=randomUUID();input.version='99';await port.ready(credential,raw('ready'),signal());expect(mock.query.mock.calls[0]![1].slice(9,11)).toEqual([operation,'2']);expect(()=>JSON.stringify(port)).toThrow('SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED');
});
it.each(['businessId','actorId','exportJobId','recoveryEpoch','leaseId','profile'])('refuses a changed %s before authentication or submission',async field=>{
 const input=JSON.stringify({...claim,[field]:randomUUID()});await expect(factory().authorize(credential,input,signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();
});
it.each(stages)('%s refuses malformed or oversized original JSON before submitting',async stage=>{
 for(const input of ['{',' '.repeat(stage==='authorize'?2049:stage==='snapshot'?1048577:stage==='ready'?12582913:8193),'\ud800'])await expect(factory()[stage](credential,input,signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();
});
it.each(['snapshot','ready'] as const)('%s refuses schema42 and changed pinned release without relabeling a worker plan',async stage=>{
 for(const patch of [{sourceSchemaVersion:42},{appReleaseId:'c'.repeat(40)}]){const value=JSON.parse(raw(stage));Object.assign(value.plan,patch);await expect(factory()[stage](credential,JSON.stringify(value),signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');}expect(mock.query).not.toHaveBeenCalled();
});
it.each(stages)('%s withholds success after an uncertain commit and never retries or changes IDs',async stage=>{
 mock.transaction.mockImplementation(async(work,current)=>{await work(mock.query,current);throw new Error('synthetic uncertain commit');});await expect(factory()[stage](credential,raw(stage),signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN');expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.transaction).toHaveBeenCalledTimes(1);
});
it.each(['formatVersion','stage','requestSha256','extra'])('rejects a mismatched acknowledgment %s before commit',async field=>{
 mock.query.mockImplementation(async(_sql,args)=>({formatVersion:1,stage:'intent',requestSha256:sha(args.at(-1)),[field]:'invalid'}));await expect(factory().intent(credential,raw('intent'),signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN');expect(mock.events).not.toContain('commit');
});
it('refuses stale/unavailable provider and another authenticated actor before a journal transaction',async()=>{
 mock.verify.mockRejectedValueOnce(new Error('private provider failure'));await expect(factory().authorize(credential,raw('authorize'),signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');mock.verify.mockResolvedValueOnce({actorId:randomUUID()});await expect(factory().authorize(credential,raw('authorize'),signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');expect(mock.transaction).not.toHaveBeenCalled();
});
it('requires fresh provider verification on every exact replay and retains no credential hash',async()=>{
 const port=factory(),original=raw('authorize');await port.authorize(credential,original,signal());await port.authorize(credential,original,signal());expect(mock.verify).toHaveBeenCalledTimes(2);expect(mock.query.mock.calls.every(c=>c[1][0].equals(Buffer.alloc(32)))).toBe(true);
});
it('pre-abort sends no provider/SQL work and post-commit abort returns unknown rather than success',async()=>{
 const pre=new AbortController();pre.abort();await expect(factory().ready(credential,raw('ready'),pre.signal)).rejects.toThrow('SOURCE_EXPORT_JOURNAL_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();const late=new AbortController();mock.transaction.mockImplementation(async(work,current)=>{const value=await work(mock.query,current);late.abort();return value;});await expect(factory().ready(credential,raw('ready'),late.signal)).rejects.toThrow('SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN');expect(mock.query).toHaveBeenCalledTimes(1);
});
it('preserves only the fixed recovery fence and redacts all other SQL/provider causes',async()=>{
 mock.transaction.mockRejectedValueOnce(new Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory().ready(credential,raw('ready'),signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');mock.transaction.mockRejectedValueOnce(new Error('private connection credential'));try{await factory().ready(credential,raw('ready'),signal());throw new Error('expected refusal');}catch(e){expect(e).toMatchObject({name:'SourceExportJournalError',message:'SOURCE_EXPORT_JOURNAL_OUTCOME_UNKNOWN'});expect((e as Error).cause).toBeUndefined();}
});
it('an absent original Ready lookup is read-only and does not submit or claim completion',async()=>{
 const result=await factory().lookupReady(credential,raw('ready'),signal());expect(result.forServer()).toEqual({state:'absent'});expect(mock.transaction).not.toHaveBeenCalled();expect(mock.read.mock.calls[0]![1].at(-1)).toBe(operation);expect(()=>JSON.stringify(result)).toThrow('SOURCE_EXPORT_JOURNAL_REVIEW_REQUIRED');
});
it('historical Ready lookup binds the exact retained original operation, consumed lease and request hash',async()=>{
 const original=raw('ready'),command={schemaVersion:1,businessId:claimed.business_id,commandType:'export.ready',reference:{operationId:operation,recoveryEpoch:claimed.recovery_epoch,exportJobId:claimed.id,expectedVersion:'2',leaseId:claimed.lease_id,generationId:generation,requestSha256:sha(original)}},value={state:'committed',operationId:operation,recoveryEpoch:claimed.recovery_epoch,receipt:{schemaVersion:1,command,job:{...claimed,state:'Ready',lease_id:null,lease_until:null,version:'3',operation_id:operation},auditEventId:randomUUID()}};
 mock.read.mockResolvedValue(value);expect((await factory().lookupReady(credential,original,signal())).forServer()).toEqual(value);await expect(factory().lookupReady(credential,' '+original,signal())).rejects.toThrow('SOURCE_EXPORT_JOURNAL_LOOKUP_FAILED');expect(mock.transaction).not.toHaveBeenCalled();
});
it.each(['Queued','Ready','Failed'] as const)('refuses a %s projection as the original claimed Running binding',state=>{
 expect(()=>factory({...claimed,state})).toThrow();expect(mock.verify).not.toHaveBeenCalled();
});
it('refuses reused Ready operation IDs and getters without executing caller accessors',()=>{
 for(const op of [claimed.operation_id,claimed.request_operation_id])expect(()=>factory(claimed,op)).toThrow();let reads=0;const getter={...claimed,get business_id(){reads++;return claimed.business_id;}};expect(()=>factory(getter)).toThrow();expect(reads).toBe(0);
});
