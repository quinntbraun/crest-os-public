import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseSourceExportAdmission} from '../../src/security/source-export-admission';
import {sourceExportOwnerFixture} from '../support/source-export-owner-fixture';
const error='SOURCE_EXPORT_EXECUTION_REVIEW_REQUIRED';
it.each(['created','recorded'])('binds the %s observation to the exact unchanged request receipt and actor',state=>{
 const f=sourceExportOwnerFixture(),value=parseSourceExportAdmission({state,result:f.committed},f.original,f.actorId);expect(value.state).toBe(state);expect(Object.isFrozen(value)).toBe(true);
 if(value.state==='conflict')throw Error();expect(value.result).toEqual(f.committed);expect(Object.isFrozen(value.result.receipt.job)).toBe(true);
});
it.each(['operation','active_or_identity'])('retains a closed non-executing conflict: %s',reason=>{
 const f=sourceExportOwnerFixture();expect(parseSourceExportAdmission({state:'conflict',reason},f.original,f.actorId)).toEqual({state:'conflict',reason});
});
it.each([null,[],{}, {state:'created'}, {state:'recorded'}, {state:'conflict',reason:'busy'}, {state:'created',result:{},extra:true}, {state:'pending',result:{}}, {state:'conflict',reason:'operation',result:{}}, {state:'created',result:{},reason:'operation'}])('rejects malformed or ambiguous scheduling metadata: %o',value=>{
 const f=sourceExportOwnerFixture();expect(()=>parseSourceExportAdmission(value,f.original,f.actorId)).toThrow(error);
});
it('does not evaluate accessors or accept symbols or inherited scheduling observations',()=>{
 const f=sourceExportOwnerFixture();let invoked=false;const getter={get state(){invoked=true;return'created';},result:f.committed};
 for(const value of [getter,{state:'created',result:f.committed,[Symbol('extra')]:true},Object.create({state:'created',result:f.committed})])expect(()=>parseSourceExportAdmission(value,f.original,f.actorId)).toThrow(error);
 expect(invoked).toBe(false);
});
it.each(['actor','operation','epoch','job','release','command','receipt'])('refuses a changed %s in an otherwise plausible created observation',change=>{
 const f=sourceExportOwnerFixture(),value=structuredClone(f.committed);
 if(change==='actor')value.receipt.job.actor_id=randomUUID();if(change==='operation')value.operationId=randomUUID();if(change==='epoch')value.recoveryEpoch=randomUUID();if(change==='job')value.receipt.job.id=randomUUID();if(change==='release')value.receipt.job.app_release_id='b'.repeat(40);if(change==='command')value.receipt.command.reference.exportJobId=randomUUID();if(change==='receipt')value.receipt.schemaVersion=2;
 expect(()=>parseSourceExportAdmission({state:'created',result:value},f.original,f.actorId)).toThrow(error);
});
it('requires a genuine request original and valid actor even for a non-executing conflict',()=>{
 const f=sourceExportOwnerFixture();for(const original of [{...f.original,commandType:'export.stop'}, {...f.original,actorId:f.actorId},null])expect(()=>parseSourceExportAdmission({state:'conflict',reason:'operation'},original,f.actorId)).toThrow(error);
 expect(()=>parseSourceExportAdmission({state:'conflict',reason:'operation'},f.original,'invalid')).toThrow(error);
});
