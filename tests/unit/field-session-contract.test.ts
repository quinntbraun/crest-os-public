import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseFieldSessionSave,fieldSessionOriginal,parseFieldSessionCommitted} from '../../src/operations/field-session-contract';
const fixture=()=>({schemaVersion:1,businessId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID(),jobId:randomUUID(),expectedJobVersion:'1',body:{action:'depart',reason:null,trip:{drivenVehicleId:randomUUID(),origin:{schemaVersion:1,kind:'manual',locationText:'Synthetic origin',instructions:null},etaAt:null,notes:null}}});
it.each(['depart','arrive','direct_arrive','pause','resume'])('seals the supported %s action and its reference without private draft content',action=>{
 const input=fixture(),body=action==='depart'?input.body:{action,reason:['pause','direct_arrive'].includes(action)?'Synthetic reason':null},parsed=parseFieldSessionSave({...input,body});
 expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.body)).toBe(true);const original=fieldSessionOriginal(parsed);expect(original.reference).toEqual({operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,jobId:input.jobId,expectedJobVersion:'1',action});expect(JSON.stringify(original)).not.toContain('Synthetic origin');
});
it('keeps exact large versions and rejects an increment beyond signed64',()=>{
 const input=fixture();input.expectedJobVersion='9007199254740993';expect(parseFieldSessionSave(input).expectedJobVersion).toBe('9007199254740993');input.expectedJobVersion='9223372036854775806';expect(parseFieldSessionSave(input).expectedJobVersion).toBe(input.expectedJobVersion);input.expectedJobVersion='9223372036854775807';expect(()=>parseFieldSessionSave(input)).toThrow();
});
it.each([
 (v:ReturnType<typeof fixture>)=>({...v,businessId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}),
 (v:ReturnType<typeof fixture>)=>({...v,expectedJobVersion:'0'}),
 (v:ReturnType<typeof fixture>)=>({...v,expectedJobVersion:1}),
 (v:ReturnType<typeof fixture>)=>({...v,unexpected:true}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{action:'pause',reason:null}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{action:'direct_arrive',reason:' \t\n'}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{action:'resume',reason:null,trip:v.body.trip}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,reason:'A'.repeat(1001)}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,action:'complete'}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,trip:{...v.body.trip,etaAt:'2026-11-03T10:00:00.123Z'}}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,trip:{...v.body.trip,origin:{...v.body.trip.origin,locationText:'A'.repeat(2001)}}}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,trip:{...v.body.trip,origin:{...v.body.trip.origin,locationText:'x\u0000y'}}}}),
 (v:ReturnType<typeof fixture>)=>({...v,body:{...v.body,trip:{...v.body.trip,origin:{...v.body.trip.origin,toJSON(){throw Error();}}}}}),
])('refuses malformed or unsupported command data before submission %#',mutate=>expect(()=>parseFieldSessionSave(mutate(fixture()))).toThrow('FIELD_SESSION_DATA_REQUIRED'));
it('does not invoke input accessors or accept hidden and symbol fields',()=>{
 for(const scope of ['root','body','origin']){const input=fixture();const target=scope==='root'?input:scope==='body'?input.body:input.body.trip.origin;const key=scope==='root'?'jobId':scope==='body'?'action':'locationText';let reads=0;Object.defineProperty(target,key,{get(){reads++;return 'unexpected';},enumerable:true});expect(()=>parseFieldSessionSave(input)).toThrow();expect(reads).toBe(0);}
 for(const symbol of [false,true]){const input=fixture();Object.defineProperty(input,symbol?Symbol('private'):'private',{value:'not allowed',enumerable:false});expect(()=>parseFieldSessionSave(input)).toThrow();}
});
it('rejects an action object without invoking its conversion hooks',()=>{
 let calls=0;const action={toString(){calls++;return 'resume';},[Symbol.toPrimitive](){calls++;return 'resume';}};expect(()=>parseFieldSessionSave({...fixture(),body:{action,reason:null}})).toThrow('FIELD_SESSION_DATA_REQUIRED');expect(calls).toBe(0);
});
it('retains immutable target and nested location values if the caller later mutates its draft',()=>{
 const input=fixture(),parsed=parseFieldSessionSave(input),job=parsed.jobId;input.jobId=randomUUID();input.body.trip.origin.locationText='changed';input.body.action='resume';expect(parsed.jobId).toBe(job);expect(parsed.body.action).toBe('depart');if(parsed.body.action==='depart')expect(parsed.body.trip.origin.locationText).toBe('Synthetic origin');
});
it('binds only the exact typed-original receipt and refuses absent observations or changed identities',()=>{
 const input=parseFieldSessionSave(fixture()),original=fieldSessionOriginal(input),actorId=randomUUID(),wire={schemaVersion:1,original,result:{state:'committed',receipt:{schemaVersion:1,commandType:'operations.job.field',businessId:input.businessId,actorId,operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,subjectId:input.jobId,sourceRecordId:input.jobId,sourceVersion:'2',sourceAuditIds:[randomUUID()]}}};
 expect(parseFieldSessionCommitted(wire,input).result.receipt.actorId).toBe(actorId);expect(()=>parseFieldSessionCommitted({state:'absent'},input)).toThrow();const wrong=structuredClone(wire);wrong.result.receipt.sourceVersion='3';expect(()=>parseFieldSessionCommitted(wrong,input)).toThrow();
});
