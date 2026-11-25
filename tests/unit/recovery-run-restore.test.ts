import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseRecoveryJson} from '../../src/tooling/recovery-json.ts';
import {readRecoveryRunCandidate,createRecoveryRunRestore} from '../../src/tooling/recovery-run-restore.ts';
function fixture(){const target={pointId:randomUUID(),businessId:randomUUID(),appReleaseId:'a'.repeat(40),migrationRegistrySha256:'b'.repeat(64),sourceSchemaVersion:138 as const,referenceDirectoryId:randomUUID()},candidate={profile:'crest.verified-recovery-run-candidate.v1',pointId:target.pointId,snapshotId:'00000003-00000001-1',manifest:{key:`recovery/${target.pointId}/artifacts/${randomUUID()}.age`,versionId:'synthetic',byteSize:1000,sha256:'c'.repeat(64),retainUntil:new Date(Date.now()+400*86400000).toISOString()},manifestPlaintext:{byteSize:100,sha256:'d'.repeat(64)},completeBackup:false};return{target,candidate};}
it('keeps frozen exact integer metadata and financial strings without prototype mutation',()=>{
 const value=parseRecoveryJson('{"a":9007199254740991,"money":"90071992547409931234","nested":[true,null,{"__proto__":{"safe":true}}]}') as Record<string,unknown>;expect(value.a).toBe(9007199254740991);expect(value.money).toBe('90071992547409931234');expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.nested)).toBe(true);expect(({} as Record<string,unknown>).safe).toBeUndefined();
});
it('rejects duplicate decoded names, unsafe/rounded numbers and malformed text',()=>{
 for(const source of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"n":9007199254740993}','{"n":1.0000000000000000001}','{"n":1e0}','{"n":-0}','{"n":1e999}','{"n":NaN}','{} trailing','{"x":"\\u0000"}','{"x":"\\ud800"}'])expect(()=>parseRecoveryJson(source)).toThrow('RECOVERY_JSON_REVIEW_REQUIRED');
});
it('enforces recovery-only structural limits without widening existing evidence parsers',()=>{
 expect((parseRecoveryJson(JSON.stringify(Array(10001).fill(0))) as unknown[]).length).toBe(10001);expect(()=>parseRecoveryJson(JSON.stringify(Array(100001).fill(0)))).toThrow('RECOVERY_JSON_REVIEW_REQUIRED');expect(()=>parseRecoveryJson('['.repeat(34)+'0'+']'.repeat(34))).toThrow('RECOVERY_JSON_REVIEW_REQUIRED');expect(()=>parseRecoveryJson('{"text":"too long"}',8)).toThrow('RECOVERY_JSON_REVIEW_REQUIRED');
});
it('requires the exact current candidate and same-point immutable vault descriptor',()=>{
 const {target,candidate}=fixture();expect(readRecoveryRunCandidate(JSON.stringify(candidate),target).binding).toEqual(target);for(const value of [{...candidate,completeBackup:true},{...candidate,pointId:randomUUID()},{...candidate,snapshotId:'unknown'},{...candidate,extra:true},{...candidate,manifest:{...candidate.manifest,key:`recovery/${randomUUID()}/artifacts/${randomUUID()}.age`}},{...candidate,manifest:{...candidate.manifest,versionId:'null'}},{...candidate,manifestPlaintext:{...candidate.manifestPlaintext,byteSize:1048577}}])expect(()=>readRecoveryRunCandidate(JSON.stringify(value),target)).toThrow('RECOVERY_RUN_RESTORE_REVIEW_REQUIRED');
});
it('foreign candidate and cancellation refuse before tools or vault retrieval',async()=>{
 const {target,candidate}=fixture(),launch=vi.fn(),vault={retrieveEncryptedFile:vi.fn()},restore=createRecoveryRunRestore(launch),input={candidateSource:JSON.stringify({...candidate,pointId:randomUUID()}),expected:target,workspace:'/private',identityFile:'/offline/identity'};await expect(restore(input,vault,new AbortController().signal)).rejects.toThrow('RECOVERY_RUN_RESTORE_REVIEW_REQUIRED');const controller=new AbortController();controller.abort();await expect(restore({...input,candidateSource:JSON.stringify(candidate)},vault,controller.signal)).rejects.toThrow('RECOVERY_RUN_RESTORE_REVIEW_REQUIRED');expect(launch).not.toHaveBeenCalled();expect(vault.retrieveEncryptedFile).not.toHaveBeenCalled();
});
