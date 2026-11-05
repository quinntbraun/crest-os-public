import {beforeEach,it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),query:vi.fn(),transaction:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>Object.assign(vi.fn(),{commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createSourceExportExecutionAccess,consumeSourceExportExecutionAdmission} from '../../src/security/source-export-execution-access';
import {sourceExportOwnerFixture} from '../support/source-export-owner-fixture';
const signal=()=>new AbortController().signal,credential=randomBytes(32).toString('base64url');
let f:ReturnType<typeof sourceExportOwnerFixture>;
const factory=()=>createSourceExportExecutionAccess({connectionString:'unused-by-unit-fixture',environment:'test'},{} as never,{} as never,f.businessId,f.original.reference.appReleaseId);
beforeEach(()=>{
 f=sourceExportOwnerFixture();mock.events.length=0;mock.verify.mockReset();mock.query.mockReset();mock.transaction.mockReset();
 mock.verify.mockImplementation(async()=>{mock.events.push('provider');return{sessionId:randomUUID(),actorId:f.actorId,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});
 mock.query.mockImplementation(async()=>{mock.events.push('query');return{state:'created',result:f.committed};});
 mock.transaction.mockImplementation(async(work,signal)=>{mock.events.push('begin');try{const value=await work(mock.query,signal);mock.events.push('commit');return value;}catch(error){mock.events.push('rollback');throw error;}});
});
it('mints one private scheduling attempt only after the new request transaction commits',async()=>{
 const value=await factory().request(credential,f.original,signal());expect(value.state).toBe('created');expect(value.forServer()).toEqual(f.committed);expect(mock.events).toEqual(['provider','begin','query','commit']);
 expect(consumeSourceExportExecutionAdmission(value,signal())).toEqual({command:f.original,job:f.job});expect(()=>consumeSourceExportExecutionAdmission(value,signal())).toThrow('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');expect(()=>JSON.stringify(value)).toThrow('SOURCE_EXPORT_EXECUTION_PRIVATE');
 const args=mock.query.mock.calls[0]![1];expect(args.slice(7)).toEqual([f.businessId,f.original.reference.recoveryEpoch,f.original.reference.operationId,f.original.reference.exportJobId,f.original.reference.appReleaseId]);expect(args[0]).toEqual(Buffer.alloc(32));expect(mock.verify.mock.calls[0]!.slice(0,1)).toEqual([credential]);expect(mock.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);expect(mock.query.mock.calls[0]![0]).toContain('request_source_export_for_execution');
});
it.each(['recorded','conflict'])('never schedules a task from a %s result',async state=>{
 mock.query.mockResolvedValueOnce(state==='recorded'?{state,result:f.committed}:{state,reason:'operation'});
 const value=await factory().request(credential,f.original,signal());expect(value.state).toBe(state);expect(()=>consumeSourceExportExecutionAdmission(value,signal())).toThrow('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');expect(()=>JSON.stringify(value)).toThrow('SOURCE_EXPORT_EXECUTION_PRIVATE');
});
it('cannot recreate scheduling permission from a copied object or an original receipt',async()=>{
 const value=await factory().request(credential,f.original,signal());for(const copy of [{...value},value.forServer(),{state:'created',result:value.forServer()}])expect(()=>consumeSourceExportExecutionAdmission(copy,signal())).toThrow('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');
 expect(consumeSourceExportExecutionAdmission(value,signal()).job.id).toBe(f.job.id);
});
it('consumes an aborted scheduling observation without leaving it reusable',async()=>{
 const value=await factory().request(credential,f.original,signal()),controller=new AbortController();controller.abort();
 expect(()=>consumeSourceExportExecutionAdmission(value,controller.signal)).toThrow('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');expect(()=>consumeSourceExportExecutionAdmission(value,signal())).toThrow('SOURCE_EXPORT_EXECUTION_ADMISSION_CONSUMED');
});
it.each(['business','release','actorField','wrongCommand','extra'])('rejects malformed or changed %s before provider or database work',async change=>{
 const command=structuredClone(f.original) as Record<string,unknown>&{reference:Record<string,unknown>};
 if(change==='business')command.businessId=randomUUID();if(change==='release')command.reference.appReleaseId='b'.repeat(40);if(change==='actorField')command.actorId=f.actorId;if(change==='wrongCommand')command.commandType='export.claim';if(change==='extra')command.reference.extra=true;
 await expect(factory().request(credential,command,signal())).rejects.toThrow('SOURCE_EXPORT_EXECUTION_INPUT_REQUIRED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
});
it('copies the original before provider I/O so a caller cannot rebind the committed request',async()=>{
 const command=structuredClone(f.original),old=command.reference.operationId;mock.verify.mockImplementationOnce(async()=>{command.reference.operationId=randomUUID();return{sessionId:randomUUID(),actorId:f.actorId,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});
 const value=await factory().request(credential,command,signal());expect(consumeSourceExportExecutionAdmission(value,signal()).command.reference.operationId).toBe(old);expect(mock.query.mock.calls[0]![1][9]).toBe(old);
});
it('does not mint scheduling permission when COMMIT acknowledgement is lost',async()=>{
 mock.transaction.mockImplementationOnce(async(work,current)=>{await work(mock.query,current);throw Error('PRIVATE_COMMIT_TRANSPORT');});
 await expect(factory().request(credential,f.original,signal())).rejects.toThrow('SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');
});
it('rolls back a malformed created receipt before any scheduling permission exists',async()=>{
 mock.query.mockResolvedValueOnce({state:'created',result:{...f.committed,operationId:randomUUID()}});
 await expect(factory().request(credential,f.original,signal())).rejects.toThrow('SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');expect(mock.events).toEqual(['provider','begin','rollback']);expect(mock.query.mock.calls[0]![1][0]).toEqual(Buffer.alloc(32));
});
it('refuses a changed provider principal before accepting the SQL receipt',async()=>{
 mock.verify.mockResolvedValueOnce({sessionId:randomUUID(),actorId:randomUUID(),provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}});
 await expect(factory().request(credential,f.original,signal())).rejects.toThrow('SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');expect(mock.events.at(-1)).toBe('rollback');
});
it('keeps a pre-submission provider failure distinct and private',async()=>{
 mock.verify.mockRejectedValueOnce(Error('PRIVATE_PROVIDER_DETAILS'));await expect(factory().request(credential,f.original,signal())).rejects.toThrow('SOURCE_EXPORT_EXECUTION_NOT_SUBMITTED');expect(mock.transaction).not.toHaveBeenCalled();expect(()=>JSON.stringify(factory())).toThrow('SOURCE_EXPORT_EXECUTION_PRIVATE');
});
it('does not mint scheduling permission after an abort following COMMIT',async()=>{
 const controller=new AbortController();mock.transaction.mockImplementationOnce(async(work,current)=>{const value=await work(mock.query,current);controller.abort();return value;});
 await expect(factory().request(credential,f.original,controller.signal)).rejects.toThrow('SOURCE_EXPORT_EXECUTION_OUTCOME_UNKNOWN');
});
it('refuses an already aborted request before obtaining credentials or starting a transaction',async()=>{
 const controller=new AbortController();controller.abort();await expect(factory().request(credential,f.original,controller.signal)).rejects.toThrow('SOURCE_EXPORT_EXECUTION_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
});
it('preserves the explicit recovery fence without exposing SQL error detail',async()=>{
 mock.query.mockRejectedValueOnce(Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory().request(credential,f.original,signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');expect(mock.query.mock.calls[0]![1][0]).toEqual(Buffer.alloc(32));
});
