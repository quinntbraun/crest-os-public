import {describe,expect,it} from 'vitest';
import {workTimeReplyDiagnostic} from '../support/work-time-diagnostic.mjs';
describe('bounded work-time response diagnostics',()=>{
 it('does not read or retain a successful private receipt',async()=>{expect(await workTimeReplyDiagnostic({status:()=>200,json:()=>{throw Error('must not read receipt');}})).toEqual({status:200,code:'success'});});
 it('retains only the known refusal class, omitting private values',async()=>{const value=await workTimeReplyDiagnostic({status:()=>503,json:async()=>({error:'SCHEDULING_SAVE_NOT_SUBMITTED',token:'private token',reason:'private reason'})});expect(value).toEqual({status:503,code:'SCHEDULING_SAVE_NOT_SUBMITTED'});expect(JSON.stringify(value)).not.toContain('private');});
 it('replaces arbitrary errors and invalid JSON with a fixed category',async()=>{for(const json of [async()=>({error:'private credential'}),async()=>{throw Error('private response');}])expect(await workTimeReplyDiagnostic({status:()=>503,json})).toEqual({status:503,code:'other'});});
});
