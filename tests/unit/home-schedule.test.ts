import {it,expect,vi} from 'vitest';import{randomBytes,randomUUID}from'node:crypto';
import {readHomeSchedule} from '../../src/client/home-schedule';import{scheduling}from'../../src/client/scheduling';
import{confirmedJobRecords}from'../fixtures/confirmed-job-records';
import{parseJobListPage}from'../../src/operations/confirmed-job-read-contract';
function setup(){const f=confirmedJobRecords(),list=parseJobListPage({schemaVersion:1,businessId:f.q.businessId,jobs:[f.summary],hasMore:false},{businessId:f.q.businessId,from:'2026-11-01T00:00:00.000000Z',until:'2026-11-10T00:00:00.000000Z',afterStart:null,afterJob:null,pageSize:20}),epoch=randomUUID(),settings={schemaVersion:1 as const,businessId:f.q.businessId,businessVersion:'1',legalName:'Synthetic Crest',writeState:'ready' as const,recoveryEpoch:epoch},workspace={binding:randomBytes(32).toString('base64url'),context:{schemaVersion:1 as const,businessId:f.q.businessId,operatorId:f.q.payload.operatorId,timezone:'UTC',modeVersion:null,writeState:'ready' as const,recoveryEpoch:epoch}},api={...scheduling,maintenanceList:vi.fn<typeof scheduling.maintenanceList>(),workspace:vi.fn<typeof scheduling.workspace>().mockImplementation(async()=>workspace),list:vi.fn<typeof scheduling.list>().mockResolvedValue(list),pending:vi.fn<typeof scheduling.pending>().mockResolvedValue({schemaVersion:1,businessId:f.q.businessId,items:[],hasMore:false})},proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000},controller=new AbortController(),now=()=>new Date('2026-11-03T12:00:00Z');return {f,list,settings,workspace,api,proof,controller,now,read:()=>readHomeSchedule(settings,proof,controller.signal,{api,now})};}
it('loads actual seven business dates and a separate all-date proposed-change queue',async()=>{const f=setup(),result=await f.read();expect(result.fromDate).toBe('2026-11-03');expect(result.throughDate).toBe('2026-11-09');expect(f.api.list.mock.calls[0]![0]).toEqual({businessId:f.settings.businessId,from:'2026-11-03T00:00:00.000000Z',until:'2026-11-10T00:00:00.000000Z',afterStart:null,afterJob:null,pageSize:20});expect(f.api.pending.mock.calls[0]![0]).toEqual({businessId:f.settings.businessId,afterCreatedAt:null,afterAppointmentId:null,pageSize:5});expect(result.visits?.jobs[0]).toEqual(f.f.summary);expect(f.api.workspace).toHaveBeenCalledTimes(2);});
it.each(['list','pending'] as const)('keeps unavailable %s distinct from empty and preserves independently verified data',async key=>{const f=setup();f.api[key].mockRejectedValueOnce(Error());const r=await f.read();expect(r[key==='list'?'visits':'changes']).toBeNull();expect(r[key==='list'?'changes':'visits']).not.toBeNull();});
it.each(['business','epoch','paused'] as const)('refuses mismatched %s before querying records',async key=>{const f=setup();f.api.workspace.mockResolvedValueOnce({...f.workspace,context:{...f.workspace.context,...key==='business'?{businessId:randomUUID()}:key==='epoch'?{recoveryEpoch:randomUUID()}:{writeState:'paused',recoveryEpoch:null}}} as Awaited<ReturnType<typeof scheduling.workspace>>);await expect(f.read()).rejects.toThrow();expect(f.api.list).not.toHaveBeenCalled();expect(f.api.pending).not.toHaveBeenCalled();});
it.each(['binding','operator','timezone'] as const)('does not expose a mixed %s result after loading',async key=>{const f=setup();f.api.workspace.mockResolvedValueOnce(f.workspace).mockResolvedValueOnce({...f.workspace,...key==='binding'?{binding:randomBytes(32).toString('base64url')}:{context:{...f.workspace.context,...key==='operator'?{operatorId:randomUUID()}:{timezone:'America/Indianapolis'}}}});await expect(f.read()).rejects.toThrow();});
it('uses business midnights across DST rather than assuming a fixed seven-day duration',async()=>{const f=setup();f.workspace.context.timezone='America/Indianapolis';const r=await readHomeSchedule(f.settings,f.proof,f.controller.signal,{api:f.api,now:()=>new Date('2026-11-01T18:00:00Z')});expect(r.fromDate).toBe('2026-11-01');expect(f.api.list.mock.calls[0]![0]).toMatchObject({from:'2026-11-01T04:00:00.000000Z',until:'2026-11-08T05:00:00.000000Z'});});
it('clears aborted snapshots rather than exposing late completed requests',async()=>{const f=setup();f.api.list.mockImplementationOnce(async()=>{f.controller.abort();return f.list;});await expect(f.read()).rejects.toThrow();});

it('uses the next business midnight for maintenance due today and verifies the capability again',async()=>{
 const f=setup(),workspace={...f.workspace,maintenanceFollowUpAvailable:true as const};
 workspace.context.timezone='America/Indianapolis';
 f.api.workspace.mockResolvedValue(workspace);
 const throughAt='2026-11-02T05:00:00.000000Z';
 const empty={schemaVersion:1 as const,businessId:f.settings.businessId,scopeKind:'due' as const,scopeId:null,throughAt,entries:[],next:null};
 f.api.maintenanceList.mockResolvedValue(empty);
 const read=()=>readHomeSchedule(f.settings,f.proof,f.controller.signal,{api:f.api,now:()=>new Date('2026-11-01T18:00:00Z')});
 expect((await read()).maintenance).toEqual(empty);
 expect(f.api.maintenanceList.mock.calls[0]!.slice(0,2)).toEqual([f.settings.businessId,{
  scopeKind:'due',scopeId:null,throughAt,afterDueAt:null,afterTaskId:null,
 }]);
 f.api.maintenanceList.mockRejectedValueOnce(Error());
 const unavailable=await read();
 expect(unavailable.maintenance).toBeNull();
 expect(unavailable.visits).not.toBeNull();
 f.api.workspace.mockResolvedValueOnce(workspace).mockResolvedValueOnce(f.workspace);
 await expect(read()).rejects.toThrow('HOME_SCHEDULE_CONTEXT_CHANGED');
});

it('does not query or present maintenance when the capability is absent',async()=>{
 const f=setup();
 expect(await f.read()).not.toHaveProperty('maintenance');
 expect(f.api.maintenanceList).not.toHaveBeenCalled();
});
