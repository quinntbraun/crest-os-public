import {it,expect,vi,afterEach} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {scheduling} from '../../src/client/scheduling';
import {fieldSessionOriginal,parseFieldSessionSave} from '../../src/operations/field-session-contract';
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const request=()=>parseFieldSessionSave({schemaVersion:1,businessId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID(),jobId:randomUUID(),expectedJobVersion:'1',body:{action:'direct_arrive',reason:'Synthetic omitted travel reason'}});
const envelope=(q:ReturnType<typeof request>)=>({schemaVersion:1,original:fieldSessionOriginal(q),result:{state:'committed',receipt:{schemaVersion:1,commandType:'operations.job.field',businessId:q.businessId,actorId:randomUUID(),operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,subjectId:q.jobId,sourceRecordId:q.jobId,sourceVersion:'2',sourceAuditIds:[randomUUID()]}}});
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
afterEach(()=>vi.unstubAllGlobals());
it('sends the sealed field request through the fixed private path and binds its exact typed original',async()=>{
 const q=request(),expected=envelope(q),fetcher=vi.fn<typeof fetch>().mockResolvedValue(response(expected));vi.stubGlobal('fetch',fetcher);expect(await scheduling.saveFieldSession(q,proof(),signal())).toEqual(expected);const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe('/api/business/scheduling/field-save');expect(JSON.parse(options!.body as string)).toEqual(Object.fromEntries(Object.entries(q).filter(([key])=>key!=='businessId')));expect(options).toMatchObject({cache:'no-store',redirect:'error',credentials:'same-origin'});
});
it('makes no automatic retry after a lost acknowledgement and distinguishes pre-submission failure',async()=>{
 const q=request(),fetcher=vi.fn<typeof fetch>().mockRejectedValue(Error('Synthetic network loss'));vi.stubGlobal('fetch',fetcher);await expect(scheduling.saveFieldSession(q,proof(),signal())).rejects.toMatchObject({kind:'unknown'});expect(fetcher).toHaveBeenCalledTimes(1);fetcher.mockClear();await expect(scheduling.saveFieldSession(q,{...proof(),expiresAt:Date.now()-1},signal())).rejects.toMatchObject({kind:'not_submitted'});expect(fetcher).not.toHaveBeenCalled();
});
it('refuses malformed field data before fetch',async()=>{
 const fetcher=vi.fn<typeof fetch>();vi.stubGlobal('fetch',fetcher);await expect(scheduling.saveFieldSession({...request(),expectedJobVersion:'0'},proof(),signal())).rejects.toMatchObject({kind:'input'});expect(fetcher).not.toHaveBeenCalled();
});
it.each(['operation','job','version','state','travel','vehicle','occupancy'])('returns known %s conflict without announcing a save',async reason=>{
 vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockResolvedValue(response({state:'conflict',reason},409)));expect(await scheduling.saveFieldSession(request(),proof(),signal())).toEqual({state:'conflict',reason});
});
it.each(['business','actor','version','action','absent','generic-observation'])('does not report success for a mismatched %s receipt',async kind=>{
 const q=request(),v=envelope(q),receipt={...v.result.receipt,...kind==='business'?{businessId:randomUUID()}:kind==='actor'?{actorId:'invalid'}:kind==='version'?{sourceVersion:'3'}:{}},original=kind==='action'?{...v.original,reference:{...v.original.reference,action:'pause'}}:v.original;
 vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockResolvedValue(response(kind==='absent'?{state:'absent'}:kind==='generic-observation'?{state:'original_recorded'}:{...v,original,result:{...v.result,receipt}})));await expect(scheduling.saveFieldSession(q,proof(),signal())).rejects.toMatchObject({kind:'unknown'});
});
it('keeps recovery fencing and explicit server pre-submission refusal distinct from uncertainty',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({error:'RECOVERY_REVIEW_REQUIRED'},409)).mockResolvedValueOnce(response({error:'SCHEDULING_SAVE_NOT_SUBMITTED'},503)).mockResolvedValueOnce(response({error:'SCHEDULING_SAVE_OUTCOME_UNKNOWN'},503));vi.stubGlobal('fetch',fetcher);for(const kind of ['recovery','not_submitted','unknown'])await expect(scheduling.saveFieldSession(request(),proof(),signal())).rejects.toMatchObject({kind});
});
