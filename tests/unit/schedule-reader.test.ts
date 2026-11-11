import {it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createScheduleReader,scheduleDateWindow} from '../../src/client/schedule-reader';
import {scheduling} from '../../src/client/scheduling';
import {AuthenticationError} from '../../src/client/authentication';
import {parseJobListPage} from '../../src/operations/confirmed-job-read-contract';
import {parsePendingChangesPage} from '../../src/operations/booking-context-contract';
import {bookingContextFixture} from '../fixtures/booking-context';
import {jobChangeFixture} from '../fixtures/job-change';
function setup(){
 const f=bookingContextFixture(),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000},session=vi.fn(async()=>proof),context={binding:randomBytes(32).toString('base64url'),context:{schemaVersion:1 as const,businessId:f.q.businessId,operatorId:f.q.payload.operatorId,timezone:'UTC',modeVersion:null,writeState:'ready' as const,recoveryEpoch:randomUUID()}};
 const api={...scheduling,workspace:vi.fn(async()=>context),list:vi.fn(async(input:Parameters<typeof scheduling.list>[0])=>parseJobListPage({schemaVersion:1,businessId:f.q.businessId,jobs:[f.summary],hasMore:false},input)),pending:vi.fn(async(input:Parameters<typeof scheduling.pending>[0])=>parsePendingChangesPage(f.pending,input))};
 const reader=createScheduleReader({api,session,change:()=>{},now:()=>new Date('2026-11-01T12:00:00Z')});return {f,reader,api,session,context};
}
it('uses real business-zone midnight boundaries across a daylight-saving change',()=>{
 const w=scheduleDateWindow({fromDate:'2026-11-01',throughDate:'2026-11-01'},'America/Indiana/Indianapolis');expect(w).toEqual({from:'2026-11-01T04:00:00.000000Z',until:'2026-11-02T05:00:00.000000Z'});expect(Date.parse(w.until)-Date.parse(w.from)).toBe(25*3600000);
 for(const dates of [{fromDate:'2026-02-30',throughDate:'2026-03-01'},{fromDate:'2026-02-28',throughDate:'2026-02-30'},{fromDate:'2026-11-02',throughDate:'2026-11-01'},{fromDate:'2026-01-01',throughDate:'2026-12-31'}])expect(()=>scheduleDateWindow(dates,'UTC')).toThrow('SCHEDULE_DATES_REQUIRED');
});
it('loads the selected dates and the independent global proposed-change queue',async()=>{
 const {reader,api}=setup();await reader.load();expect(reader.view()).toMatchObject({phase:'ready',loaded:true,hasMore:false,pendingHasMore:false,dates:{fromDate:'2026-11-01',throughDate:'2026-11-07'}});expect(reader.view().rows).toHaveLength(1);expect(reader.view().pending).toHaveLength(1);expect(reader.view().pending[0]!.head.latestAppointment.start_at).toContain('2027-02-12');expect(api.list.mock.calls[0]![0]).toMatchObject({from:'2026-11-01T00:00:00.000000Z',until:'2026-11-08T00:00:00.000000Z'});reader.dispose();
});
it('does not turn invalid dates into a successful empty schedule',async()=>{
 const {reader,api}=setup();await reader.load({fromDate:'2026-02-30',throughDate:'2026-03-01'});expect(reader.view()).toMatchObject({phase:'ready',loaded:false,rows:[],pending:[]});expect(reader.view().message).toContain('Choose a valid range');expect(api.list).not.toHaveBeenCalled();expect(api.pending).not.toHaveBeenCalled();reader.dispose();
});
it('clears already loaded private records when subsequent sign-in verification fails',async()=>{
 const {reader,session}=setup();await reader.load();expect(reader.view().rows).toHaveLength(1);session.mockRejectedValueOnce(new AuthenticationError('denied'));await reader.open(reader.view().rows[0]!.jobId);expect(reader.view()).toMatchObject({phase:'signed-out',rows:[],pending:[],selected:null,history:[],loaded:false});reader.dispose();
});
it('ignores a late successful private response after the page is hidden',async()=>{
 const {reader,api}=setup();let resolvePage!:(value:Awaited<ReturnType<typeof scheduling.list>>)=>void;api.list.mockImplementationOnce(()=>new Promise(resolve=>{resolvePage=resolve;}));const loading=reader.load();await vi.waitFor(()=>expect(api.list).toHaveBeenCalledOnce());reader.suspend();resolvePage({schemaVersion:1,businessId:setup().f.q.businessId,jobs:[],hasMore:false});await loading;expect(reader.view()).toMatchObject({phase:'unavailable',rows:[],pending:[],selected:null,loaded:false,busy:false});expect(api.list).toHaveBeenCalledTimes(1);reader.dispose();
});
it('refuses to mix loaded records with a changed authenticated workspace binding',async()=>{
 const {reader,api,context}=setup();await reader.load();api.workspace.mockResolvedValueOnce({...context,binding:randomBytes(32).toString('base64url')});await reader.open(reader.view().rows[0]!.jobId);expect(reader.view()).toMatchObject({phase:'unavailable',rows:[],pending:[],selected:null});expect(api.workspace).toHaveBeenCalledTimes(2);reader.dispose();
});
it('loads a saved job deep link and history with the schedule’s one fresh proof',async()=>{
 const {session,context,api:base}=setup(),{q,resources}=jobChangeFixture();
 const api={...base,
  workspace:vi.fn(async()=>({...context,context:{...context.context,businessId:q.businessId}})),
  list:vi.fn(async()=>({schemaVersion:1 as const,businessId:q.businessId,jobs:[],hasMore:false})),
  pending:vi.fn(async()=>({schemaVersion:1 as const,businessId:q.businessId,items:[],hasMore:false})),
  resources:vi.fn<typeof scheduling.resources>().mockResolvedValue(resources),
  history:vi.fn<typeof scheduling.history>().mockResolvedValue({schemaVersion:1,businessId:q.businessId,
   jobId:q.jobId,throughVersion:'1',observedVersion:'1',events:[],hasMore:false})
 };
 const reader=createScheduleReader({api,session,change:()=>{},now:()=>new Date('2026-11-01T12:00:00Z')});
 await reader.load(undefined,q.jobId);
 expect(reader.view()).toMatchObject({phase:'ready',loaded:true,selected:{jobId:q.jobId},historyComplete:true});
 expect(session).toHaveBeenCalledTimes(1);
 expect(api.workspace).toHaveBeenCalledTimes(1);
 const [, ,proof,signal]=api.resources.mock.calls[0]!;
 expect(api.history).toHaveBeenCalledWith(expect.objectContaining({jobId:q.jobId,throughVersion:'1'}),proof,signal);
 await reader.open(q.jobId);
 expect(session).toHaveBeenCalledTimes(2);
 expect(api.workspace).toHaveBeenCalledTimes(2);
 reader.dispose();
});
