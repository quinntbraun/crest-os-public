import {it,expect,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {createCalendarActivitySource,CalendarActivityReadError} from '../../src/client/calendar-activity';
import {bookingContextFixture} from '../fixtures/booking-context';
import type {GoogleCalendarJobStatus} from '../../src/operations/google-calendar-job-status';
import {parseJobListPage} from '../../src/operations/confirmed-job-read-contract';
import {scheduling} from '../../src/client/scheduling';
import {AuthenticationError} from '../../src/client/authentication';
function setup(){
 const f=bookingContextFixture(),epoch=randomUUID(),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000};
 const context={binding:randomBytes(32).toString('base64url'),googleCalendarAvailable:true as const,context:{schemaVersion:1 as const,businessId:f.q.businessId,operatorId:f.q.payload.operatorId,timezone:'America/Indiana/Indianapolis',modeVersion:null,writeState:'ready' as const,recoveryEpoch:epoch}};
 const value:GoogleCalendarJobStatus={schemaVersion:1,jobId:f.summary.jobId,appointmentVersion:f.summary.appointmentSequence,state:'pending',lastConfirmedAt:null,lastConfirmedVersion:null};
 const session=vi.fn(async()=>proof),workspace=vi.fn(async()=>context),list=vi.fn(async(input:Parameters<typeof scheduling.list>[0])=>parseJobListPage({schemaVersion:1,businessId:f.q.businessId,jobs:[f.summary],hasMore:false},input)),status=vi.fn(async(jobId:string)=>({...value,jobId}));
 const read=createCalendarActivitySource({session,workspace,list,status,now:()=>new Date('2026-11-02T01:00:00Z')});return {f,epoch,proof,context,value,session,workspace,list,status,read,signal:()=>new AbortController().signal};
}
it('uses the actual business date, a bounded page and original read APIs, then rechecks authority',async()=>{
 const x=setup(),page=await x.read({epoch:x.epoch},x.signal());
 expect(page.dates).toEqual({fromDate:'2026-10-02',throughDate:'2026-12-01'});
 expect(x.list.mock.calls[0]![0]).toMatchObject({businessId:x.f.q.businessId,pageSize:5,afterStart:null,afterJob:null});
 expect(x.status).toHaveBeenCalledWith(x.f.summary.jobId,x.epoch,expect.any(AbortSignal));
 expect(x.session).toHaveBeenCalledTimes(2);expect(x.workspace).toHaveBeenCalledTimes(2);expect(page.rows[0]).toEqual({job:x.f.summary,status:x.value});expect(page.next).toBeNull();
});
it('rejects a wrong recovery epoch before listing records',async()=>{const x=setup();await expect(x.read({epoch:randomUUID()},x.signal())).rejects.toMatchObject({kind:'unavailable'});expect(x.list).not.toHaveBeenCalled();});
it('does not label a failed row read as a successful or waiting sync',async()=>{const x=setup();x.status.mockRejectedValueOnce(Error('temporary read failure'));const page=await x.read({epoch:x.epoch},x.signal());expect(page.rows[0]!.status).toBeNull();expect(x.workspace).toHaveBeenCalledTimes(2);});
it('propagates ended access before listing any appointments',async()=>{const x=setup(),denied=new AuthenticationError('denied');x.session.mockRejectedValueOnce(denied);await expect(x.read({epoch:x.epoch},x.signal())).rejects.toBe(denied);expect(x.workspace).not.toHaveBeenCalled();expect(x.list).not.toHaveBeenCalled();});
it('stops immediately on definite ended access during a nested sync read',async()=>{const x=setup(),denied=new AuthenticationError('denied');x.status.mockRejectedValueOnce(denied);await expect(x.read({epoch:x.epoch},x.signal())).rejects.toBe(denied);expect(x.session).toHaveBeenCalledTimes(1);expect(x.workspace).toHaveBeenCalledTimes(1);});
it('never returns already read appointments after the final sign-in check is denied',async()=>{const x=setup(),denied=new AuthenticationError('denied');x.session.mockResolvedValueOnce(x.proof).mockRejectedValueOnce(denied);await expect(x.read({epoch:x.epoch},x.signal())).rejects.toBe(denied);expect(x.list).toHaveBeenCalledTimes(1);expect(x.status).toHaveBeenCalledTimes(1);expect(x.workspace).toHaveBeenCalledTimes(1);});
it('does not expose a page when fresh authority verification fails',async()=>{const x=setup();x.workspace.mockResolvedValueOnce(x.context).mockRejectedValueOnce(Error('revoked'));await expect(x.read({epoch:x.epoch},x.signal())).rejects.toThrow();expect(x.list).toHaveBeenCalledTimes(1);expect(x.status).toHaveBeenCalledTimes(1);});
it('rejects changed binding after status reads before returning private rows',async()=>{const x=setup();x.workspace.mockResolvedValueOnce(x.context).mockResolvedValueOnce({...x.context,binding:'different-binding'});await expect(x.read({epoch:x.epoch},x.signal())).rejects.toMatchObject({kind:'changed'});expect(x.status).toHaveBeenCalledTimes(1);});
it('binds confirmation to appointment sequence rather than job version',async()=>{const x=setup();x.status.mockResolvedValueOnce({...x.value,appointmentVersion:String(BigInt(x.f.summary.appointmentSequence)+1n)});await expect(x.read({epoch:x.epoch},x.signal())).rejects.toMatchObject({kind:'changed'});});
it('does not convert cancellation into a partially verified page',async()=>{const x=setup(),abort=new AbortController();x.status.mockImplementationOnce(async()=>{abort.abort();throw Error('aborted');});await expect(x.read({epoch:x.epoch},abort.signal)).rejects.toThrow();expect(x.workspace).toHaveBeenCalledTimes(1);});
it('rejects invalid ranges instead of returning a misleading empty activity list',async()=>{const x=setup();await expect(x.read({epoch:x.epoch,dates:{fromDate:'2026-02-30',throughDate:'2026-03-01'}},x.signal())).rejects.toBeInstanceOf(CalendarActivityReadError);expect(x.list).not.toHaveBeenCalled();});
it('binds the next-page cursor to its actual range, authority and last returned appointment',async()=>{
 const x=setup(),jobs=Array.from({length:5},()=>({...x.f.summary,jobId:randomUUID(),appointmentId:randomUUID()})).sort((a,b)=>a.jobId.localeCompare(b.jobId));
 x.list.mockImplementation(async input=>parseJobListPage({schemaVersion:1,businessId:x.f.q.businessId,jobs,hasMore:true},input));
 const page=await x.read({epoch:x.epoch},x.signal());expect(page.next).toMatchObject({...page.dates,businessId:x.f.q.businessId,operatorId:x.context.context.operatorId,epoch:x.epoch,binding:x.context.binding,timezone:x.context.context.timezone,afterStart:jobs[4]!.startAt,afterJob:jobs[4]!.jobId});expect(x.status).toHaveBeenCalledTimes(5);
 await expect(x.read({epoch:x.epoch,dates:{fromDate:'2026-11-01',throughDate:'2026-11-02'},after:page.next!},x.signal())).rejects.toMatchObject({kind:'changed'});expect(x.list).toHaveBeenCalledTimes(1);
 x.workspace.mockResolvedValueOnce({...x.context,context:{...x.context.context,operatorId:randomUUID()}});
 await expect(x.read({epoch:x.epoch,dates:page.dates,after:page.next!},x.signal())).rejects.toMatchObject({kind:'changed'});expect(x.list).toHaveBeenCalledTimes(1);
});
