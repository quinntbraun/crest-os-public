import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import {buildMaintenanceFollowUpArchive} from '../../src/operations/maintenance-follow-up-archive';
import {createMaintenanceReminderController,initialMaintenanceReminderView} from '../../src/client/maintenance-follow-up';
import type {MaintenanceReminderView} from '../../src/client/maintenance-follow-up';
import {scheduling,SchedulingClientError} from '../../src/client/scheduling';
import {maintenanceFollowUpOriginal} from '../../src/operations/maintenance-follow-up-contract';
import {pendingSchedulingKeys} from '../../src/client/pending-scheduling';

const date='2026-11-30T15:30:00.000000Z',key=pendingSchedulingKeys['operations.follow_up.save'];
function setup(){
 const businessId=randomUUID(),customerId=randomUUID(),data=new Map<string,string>();
 const snapshot={binding:randomBytes(32).toString('base64url'),maintenanceFollowUpAvailable:true as const,
  context:{schemaVersion:1 as const,businessId,operatorId:randomUUID(),timezone:'America/Indianapolis',
   modeVersion:null,writeState:'ready' as const,recoveryEpoch:randomUUID()}};
 const api={...scheduling,workspace:vi.fn<typeof scheduling.workspace>().mockResolvedValue(snapshot),
  maintenanceList:vi.fn<typeof scheduling.maintenanceList>().mockResolvedValue({schemaVersion:1,businessId,
   scopeKind:'customer',scopeId:customerId,throughAt:null,entries:[],next:null}),
  maintenanceHistory:vi.fn<typeof scheduling.maintenanceHistory>(),
  saveMaintenance:vi.fn<typeof scheduling.saveMaintenance>()};
 let view:MaintenanceReminderView=initialMaintenanceReminderView;
 const controller=createMaintenanceReminderController({businessId,scope:{kind:'customer',id:customerId,archived:false},
  storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);}},api,
  session:async()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000}),change:next=>{view=next;}});
 return {snapshot,businessId,customerId,data,api,controller,view:()=>view};
}

it('rechecks recovery and sign-in binding before dispatch',async()=>{
 const f=setup();await f.controller.load();expect(f.view().canCreate).toBe(true);
 f.api.workspace.mockResolvedValue({...f.snapshot,binding:randomBytes(32).toString('base64url')});
 await f.controller.create(date,null,'Keep this only in the draft');
 expect(f.api.saveMaintenance).not.toHaveBeenCalled();
 expect(f.data.size).toBe(0);
 expect(f.view().phase).toBe('review');
});

it('retains only an opaque reference on a lost save response and never retries',async()=>{
 const f=setup();await f.controller.load();
 f.api.saveMaintenance.mockRejectedValueOnce(new SchedulingClientError('unknown'));
 await f.controller.create(date,null,'Private fictional maintenance note');
 const wire=f.api.saveMaintenance.mock.calls[0]![0],reference=JSON.parse(f.data.get(key)!);
 expect(reference).toMatchObject({businessId:f.businessId,binding:f.snapshot.binding,reference:maintenanceFollowUpOriginal(wire).reference});
 expect(JSON.stringify(reference)).not.toMatch(/Private|dueAt|customerId|vehicleId|2026-11/);
 expect(f.view().phase).toBe('pending');
 f.controller.suspend();await f.controller.load();
 expect(f.view().phase).toBe('pending');
 expect(f.api.saveMaintenance).toHaveBeenCalledTimes(1);
});

it('clears an exact pre-submission refusal and keeps the editor available',async()=>{
 const f=setup();await f.controller.load();
 f.api.saveMaintenance.mockRejectedValueOnce(new SchedulingClientError('not_submitted'));
 await f.controller.create(date,null,null);
 expect(f.view().message).toBe('The reminder was not submitted.');
 expect(f.view().canCreate).toBe(true);
 expect(f.data.size).toBe(0);
});

it('discards late private reads when the reminder panel closes',async()=>{
 const f=setup();
 let release:((page:Awaited<ReturnType<typeof scheduling.maintenanceList>>)=>void)|undefined;
 const requested=new Promise<void>(resolve=>{
  f.api.maintenanceList.mockImplementationOnce(()=>new Promise(done=>{release=done;resolve();}));
 });
 const loaded=f.controller.load();await requested;
 f.controller.suspend();
 release?.({schemaVersion:1,businessId:f.businessId,scopeKind:'customer',scopeId:f.customerId,throughAt:null,entries:[],next:null});
 await loaded;
 expect(f.view()).toEqual(initialMaintenanceReminderView);
});

it('refuses to download if another save changes the verified history head',async()=>{
 const f=setup(),taskId=randomUUID();
 const opened={schemaVersion:1 as const,taskId,customerId:f.customerId,vehicleId:null,sourceJobId:null,
  dueAt:date,version:'1',eventId:randomUUID(),state:'open' as const,snoozedUntil:null,rebookingJobId:null,
  reason:'Synthetic saved note',recordedAt:date};
 const snoozed={...opened,version:'2',eventId:randomUUID(),state:'snoozed' as const,snoozedUntil:date};
 const ready={state:'found' as const,businessId:f.businessId,taskId,current:opened,entries:[opened],hasMore:false};
 f.api.maintenanceList.mockResolvedValue({schemaVersion:1,businessId:f.businessId,scopeKind:'customer',scopeId:f.customerId,
  throughAt:null,entries:[{record:opened,customerName:'Synthetic customer',vehicleLabel:null,effectiveDueAt:date}],next:null});
 f.api.maintenanceHistory.mockResolvedValueOnce(ready).mockResolvedValueOnce(ready)
  .mockResolvedValueOnce({...ready,current:snoozed,entries:[snoozed]});
 await f.controller.load();await f.controller.showHistory(taskId);
 const download=vi.fn();
 await f.controller.downloadHistory(taskId,download);
 expect(f.api.maintenanceHistory.mock.calls.map(call=>call[1])).toEqual([
  {taskId,afterVersion:'0'},{taskId,afterVersion:'0'},{taskId,afterVersion:'1'},
 ]);
 expect(download).not.toHaveBeenCalled();
 expect(f.view()).toMatchObject({phase:'unavailable',history:null});
});

it('preserves exact note text and maps a formula marker after a control character',async()=>{
 const taskId=randomUUID(),businessId=randomUUID(),eventId=randomUUID();
 const note='\r\n\t=sample\\N';
 const event={schemaVersion:1,taskId,customerId:randomUUID(),vehicleId:null,sourceJobId:null,dueAt:date,
  version:'1',eventId,state:'open',snoozedUntil:null,rebookingJobId:null,reason:note,recordedAt:date};
 const files=unzipSync(await buildMaintenanceFollowUpArchive(businessId,taskId,event,[event]));
 expect(JSON.parse(strFromU8(files['saved_history.json']!)).events[0].reason).toBe(note);
 expect(JSON.parse(strFromU8(files['dictionary.json']!)).escapes).toEqual([{event_id:eventId,column:'reason',apostrophe_prefix:true}]);
 expect(strFromU8(files['maintenance_reminder_history.csv']!)).toContain('"'+String.fromCharCode(39)+'\r\n\t=sample\\\\N"');
});
