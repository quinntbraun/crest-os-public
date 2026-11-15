import {scheduling} from './scheduling';
import type {Proof} from './authentication';
import type {Settings} from './business-settings';
import {scheduleDateWindow} from './schedule-reader';
export async function readHomeSchedule(settings:Settings,proof:Proof,signal:AbortSignal,deps:{api?:typeof scheduling;now?:()=>Date}={}){
 const api=deps.api??scheduling;if(signal.aborted)throw Error('HOME_SCHEDULE_UNAVAILABLE');const before=await api.workspace(proof,signal),ctx=before.context;
 if(ctx.businessId!==settings.businessId||ctx.writeState!==settings.writeState||ctx.recoveryEpoch!==settings.recoveryEpoch)throw Error('HOME_SCHEDULE_CONTEXT_CHANGED');
 const fromDate=new Intl.DateTimeFormat('en-CA',{timeZone:ctx.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format((deps.now??(()=>new Date()))()),throughDate=new Date(Date.parse(fromDate+'T12:00:00Z')+6*86400000).toISOString().slice(0,10),window=scheduleDateWindow({fromDate,throughDate},ctx.timezone);
 const maintenanceAvailable=before.maintenanceFollowUpAvailable===true;
 const maintenance=async()=>maintenanceAvailable?api.maintenanceList(settings.businessId,{
  scopeKind:'due',scopeId:null,throughAt:scheduleDateWindow({fromDate,throughDate:fromDate},ctx.timezone).until,
  afterDueAt:null,afterTaskId:null,
 },proof,signal):null;
 const [visits,changes,reminders]=await Promise.allSettled([
  api.list({businessId:settings.businessId,...window,afterStart:null,afterJob:null,pageSize:20},proof,signal),
  api.pending({businessId:settings.businessId,afterCreatedAt:null,afterAppointmentId:null,pageSize:5},proof,signal),
  maintenance(),
 ]);
 const after=await api.workspace(proof,signal),next=after.context;
 if(signal.aborted||before.binding!==after.binding||ctx.businessId!==next.businessId||ctx.operatorId!==next.operatorId||ctx.timezone!==next.timezone||ctx.writeState!==next.writeState||ctx.recoveryEpoch!==next.recoveryEpoch||maintenanceAvailable!==(after.maintenanceFollowUpAvailable===true))throw Error('HOME_SCHEDULE_CONTEXT_CHANGED');
 return Object.freeze({timezone:ctx.timezone,fromDate,throughDate,visits:visits.status==='fulfilled'?visits.value:null,
  changes:changes.status==='fulfilled'?changes.value:null,
  ...maintenanceAvailable?{maintenance:reminders.status==='fulfilled'?reminders.value:null}:{},
 });
}
export type HomeSchedule=Awaited<ReturnType<typeof readHomeSchedule>>;
