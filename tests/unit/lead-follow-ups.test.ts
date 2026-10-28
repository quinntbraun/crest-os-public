import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {AuthenticationError,type authentication} from '../../src/client/authentication';
import type {leads} from '../../src/client/leads';
import {createLeadFollowUps,groupLeadFollowUps} from '../../src/client/lead-follow-ups';
import type {LeadFollowUpView} from '../../src/client/lead-follow-ups';
import {leadBusiness,leadFixture} from '../support/lead-fixture';

const at='2026-10-29T18:00:00.000000Z',now=()=>Date.parse(at),epoch=randomUUID(),binding=randomBytes(32).toString('base64url');
const context=()=>({context:{schemaVersion:1 as const,businessId:leadBusiness,writeState:'ready' as const,recoveryEpoch:epoch},binding});
const row=(n:number,date:string|null=at,state:'new'|'lost'='new')=>leadFixture({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,label:'Synthetic lead '+n,follow_up_at:date,state,lost_reason:state==='lost'?'Owner recorded lost':null});
let session:ReturnType<typeof vi.fn<typeof authentication.session>>,readContext:ReturnType<typeof vi.fn<typeof leads.context>>,list:ReturnType<typeof vi.fn<typeof leads.list>>,change:ReturnType<typeof vi.fn<(value:LeadFollowUpView)=>void>>;
const controller=()=>createLeadFollowUps({session,context:readContext,list,change,now});
beforeEach(()=>{
 session=vi.fn<typeof authentication.session>().mockResolvedValue({csrfToken:randomBytes(32).toString('base64url'),expiresAt:now()+60000});
 readContext=vi.fn<typeof leads.context>().mockResolvedValue(context());
 list=vi.fn<typeof leads.list>().mockResolvedValue({leads:[row(1),row(2,null),row(3,at,'lost')],hasMore:false});change=vi.fn();
});

it('loads only after fresh device/context proof and includes explicitly dated lost leads',async()=>{
 const c=controller();await c.load();expect(c.view()).toMatchObject({phase:'ready',busy:false,scanned:3,hasMore:false,checkedAt:now()});
 expect(c.view().rows.map(r=>r.id)).toEqual([row(1).id,row(3).id]);
 expect(session.mock.invocationCallOrder[0]).toBeLessThan(readContext.mock.invocationCallOrder[0]!);
 expect(readContext.mock.invocationCallOrder[0]).toBeLessThan(list.mock.invocationCallOrder[0]!);
 expect(list.mock.calls[0]![1]).toEqual({search:'',afterId:null,includeLost:true,pageSize:50});
 expect(Object.keys(c.view().rows[0]!)).toEqual(['id','label','at','state']);
 expect(JSON.stringify(c.view())).not.toMatch(/csrfToken|recoveryEpoch|phone_raw|notes|source_snapshot/);
 expect(Object.isFrozen(c.view())&&Object.isFrozen(c.view().rows)&&Object.isFrozen(c.view().rows[0])).toBe(true);
});

it('fetches one explicit page per click, pins the last source ID even when its follow-up is absent',async()=>{
 list.mockResolvedValueOnce({leads:[row(1),row(2,null)],hasMore:true}).mockResolvedValueOnce({leads:[row(3,at,'lost')],hasMore:false});
 const c=controller();await c.load();expect(list).toHaveBeenCalledTimes(1);await c.more();
 expect(session).toHaveBeenCalledTimes(2);expect(readContext).toHaveBeenCalledTimes(2);
 expect(list.mock.calls[1]![1]).toEqual({search:'',afterId:row(2).id,includeLost:true,pageSize:50});
 expect(c.view()).toMatchObject({scanned:3,hasMore:false});expect(c.view().rows.map(r=>r.id)).toEqual([row(1).id,row(3).id]);
 await c.more();expect(list).toHaveBeenCalledTimes(2);
});

it('refresh starts at the first page and removes old results rather than merging stale reminders',async()=>{
 const c=controller();await c.load();list.mockResolvedValue({leads:[row(4)],hasMore:false});await c.load();
 expect(c.view().rows.map(r=>r.id)).toEqual([row(4).id]);expect(c.view().scanned).toBe(1);expect(list.mock.calls[1]![1].afterId).toBeNull();
});

it.each(['binding','business','epoch','paused'])('clears prior labels and stops before the next list when %s changes',async kind=>{
 list.mockResolvedValue({leads:[row(1)],hasMore:true});const c=controller();await c.load();
 const current=context();if(kind==='binding')current.binding=randomBytes(32).toString('base64url');if(kind==='business')current.context.businessId=randomUUID();if(kind==='epoch')current.context.recoveryEpoch=randomUUID();
 readContext.mockResolvedValue(kind==='paused'?{...current,context:{...current.context,writeState:'paused',recoveryEpoch:null}}:current);
 await c.more();expect(c.view()).toMatchObject({phase:'unavailable',rows:[],scanned:0,checkedAt:null,hasMore:false});expect(c.view().message).toContain('context changed');expect(list).toHaveBeenCalledTimes(1);
});

it('permits a fresh read-only review while writes are paused',async()=>{
 readContext.mockResolvedValue({...context(),context:{schemaVersion:1,businessId:leadBusiness,writeState:'paused',recoveryEpoch:null}});
 const c=controller();await c.load();expect(c.view().phase).toBe('ready');expect(list).toHaveBeenCalledTimes(1);
});

it.each(['session','context','list'])('a failed %s clears all private data and never reports an empty successful queue',async stage=>{
 list.mockResolvedValue({leads:[row(1)],hasMore:true});const c=controller();await c.load();
 ({session,context:readContext,list}[stage as 'session'|'context'|'list']).mockRejectedValue(new Error('private raw diagnostic'));
 await c.more();expect(c.view()).toMatchObject({phase:'unavailable',rows:[],scanned:0,checkedAt:null});expect(c.view().message).toContain('does not mean there are none');expect(c.view().message).not.toContain('raw diagnostic');
});

it('requires sign-in on a definite denial and does not request business records',async()=>{
 session.mockRejectedValue(new AuthenticationError('denied'));const c=controller();await c.load();expect(c.view()).toMatchObject({phase:'signed-out',rows:[]});expect(readContext).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
});

it.each(['suspend','dispose'])('ignores a late private response after %s and emits no replacement results',async action=>{
 let release!:(value:Awaited<ReturnType<typeof leads.list>>)=>void;list.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const c=controller(),work=c.load();await vi.waitFor(()=>expect(list).toHaveBeenCalledTimes(1));c[action as 'suspend'|'dispose']();const count=change.mock.calls.length;
 release({leads:[row(1)],hasMore:false});await work;expect(c.view().rows).toEqual([]);expect(change).toHaveBeenCalledTimes(count);
});

it('hides old labels while rechecking and prevents concurrent paging/double-clicks',async()=>{
 list.mockResolvedValue({leads:[row(1)],hasMore:true});const c=controller();await c.load();
 let release!:(value:Awaited<ReturnType<typeof authentication.session>>)=>void;session.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const work=c.more();expect(c.view()).toMatchObject({phase:'loading',busy:true,rows:[]});await c.more();
 expect(list).toHaveBeenCalledTimes(1);release({csrfToken:randomBytes(32).toString('base64url'),expiresAt:now()+60000});await work;expect(list).toHaveBeenCalledTimes(2);
});

it('a replacement refresh aborts old work and a late old page cannot overwrite current results',async()=>{
 let release!:(value:Awaited<ReturnType<typeof leads.list>>)=>void;list.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const c=controller(),old=c.load();await vi.waitFor(()=>expect(list).toHaveBeenCalledTimes(1));const oldSignal=list.mock.calls[0]![3];
 list.mockResolvedValue({leads:[row(9)],hasMore:false});await c.load();expect(oldSignal.aborted).toBe(true);release({leads:[row(1)],hasMore:false});await old;expect(c.view().rows.map(r=>r.id)).toEqual([row(9).id]);
});

it('distinguishes a bounded partial scan from complete coverage and stops at 1,000 source rows',async()=>{
 list.mockImplementation(async(_business,input)=>{const start=input.afterId?Number(input.afterId.slice(-12)):0;return {leads:Array.from({length:50},(_,i)=>row(start+i+1)),hasMore:true};});
 const c=controller();await c.load();for(let i=1;i<20;i++)await c.more();
 expect(c.view()).toMatchObject({scanned:1000,hasMore:true,limited:true});await c.more();expect(list).toHaveBeenCalledTimes(20);
});

it('groups overdue and due-now reminders using exact microseconds, with deterministic ties and no source mutation',()=>{
 const reminder=(id:string,date:string)=>({id,label:'Synthetic reminder',at:date,state:'new' as const});
 const rows=[reminder('b',at),reminder('later','2026-10-29T18:00:00.000001Z'),reminder('old','2026-10-28T23:59:59.999999Z'),reminder('a',at)];
 expect(groupLeadFollowUps(rows,now())).toEqual({due:[rows[2],rows[3],rows[0]],upcoming:[rows[1]]});expect(rows.map(r=>r.id)).toEqual(['b','later','old','a']);
});
