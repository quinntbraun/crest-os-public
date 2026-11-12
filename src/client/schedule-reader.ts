import {authentication,AuthenticationError} from './authentication';
import {scheduling} from './scheduling';
import {buildConfirmedJobArchive} from '../operations/confirmed-job-archive';
import {followUpCandidates} from '../app/leads/follow-up-time';
import type {JobSummary,JobHistoryEvent} from '../operations/confirmed-job-read-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Resources=Exclude<Awaited<ReturnType<typeof scheduling.resources>>,{state:'absent'}>;
type Pending=Awaited<ReturnType<typeof scheduling.pending>>['items'];
type Dates=Readonly<{fromDate:string;throughDate:string}>;
export type ScheduleReadView=Readonly<{phase:'loading'|'ready'|'signed-out'|'unavailable';busy:boolean;loaded:boolean;writesPaused:boolean;fieldSessionAvailable?:boolean;jobCompletionAvailable?:true;jobMileageAvailable?:true;supportTripsAvailable?:true;pickupTripsAvailable?:true;pickupCollectionAvailable?:true;pickupPhotosAvailable?:true;workTimeAvailable?:true;dropoffCustodyAvailable?:true;message:string;timezone:string;dates:Dates|null;rows:readonly JobSummary[];hasMore:boolean;pending:Pending;pendingHasMore:boolean;selected:Resources|null;history:readonly JobHistoryEvent[];historyComplete:boolean}>;
export const initialScheduleReadView:ScheduleReadView=Object.freeze({phase:'loading',busy:true,loaded:false,writesPaused:true,fieldSessionAvailable:false,message:'Checking schedule access…',timezone:'',dates:null,rows:[],hasMore:false,pending:[],pendingHasMore:false,selected:null,history:[],historyComplete:false});
function dayAfter(day:string,offset=1){return new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
export function scheduleDateWindow(dates:Dates,timezone:string){
 const valid=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
 if(!valid(dates.fromDate)||!valid(dates.throughDate)||dates.throughDate<dates.fromDate)throw Error('SCHEDULE_DATES_REQUIRED');
 const starts=followUpCandidates(dates.fromDate+'T00:00',timezone),ends=followUpCandidates(dayAfter(dates.throughDate)+'T00:00',timezone);
 if(starts.length!==1||ends.length!==1||Date.parse(ends[0]!)-Date.parse(starts[0]!)>93*86400000)throw Error('SCHEDULE_DATES_REQUIRED');
 return {from:starts[0]!,until:ends[0]!};
}
export function createScheduleReader(deps:{change:(view:ScheduleReadView)=>void;api?:typeof scheduling;session?:typeof authentication.session;now?:()=>Date}){
 const api=deps.api??scheduling,session=deps.session??authentication.session;
 let view:ScheduleReadView={...initialScheduleReadView},context:Context|null=null,active:AbortController|null=null,alive=true;
 const emit=(patch:Partial<ScheduleReadView>)=>{view=Object.freeze({...view,...patch,busy:!!active});if(alive)deps.change(view);};
 const clear=()=>{context=null;view={...initialScheduleReadView,phase:'unavailable',busy:!!active,message:'Check access to reload private schedule records.'};};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 async function fresh(signal:AbortSignal){
  const proof=await session(signal);live(signal);const next=await api.workspace(proof,signal);live(signal);
  if(context&&(context.binding!==next.binding||context.context.businessId!==next.context.businessId||context.context.recoveryEpoch!==next.context.recoveryEpoch||context.context.writeState!==next.context.writeState||context.fieldSessionAvailable!==next.fieldSessionAvailable||context.jobCompletionAvailable!==next.jobCompletionAvailable||context.jobMileageAvailable!==next.jobMileageAvailable||context.pickupPhotosAvailable!==next.pickupPhotosAvailable||context.pickupCollectionAvailable!==next.pickupCollectionAvailable||context.pickupTripsAvailable!==next.pickupTripsAvailable||context.supportTripsAvailable!==next.supportTripsAvailable||context.workTimeAvailable!==next.workTimeAvailable||context.dropoffCustodyAvailable!==next.dropoffCustodyAvailable))throw Error('SCHEDULE_CONTEXT_CHANGED');
  context=next;return {proof,businessId:next.context.businessId};
 }
 async function run<T>(work:(signal:AbortSignal)=>Promise<T>){
  if(!alive||active)return;const controller=new AbortController();active=controller;emit({});
  try{return await work(controller.signal);}catch(error){if(alive&&!controller.signal.aborted&&active===controller){clear();emit({phase:error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable',message:error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to view your schedule.':'The schedule could not be verified. Check the connection and reload.'});}}
  finally{if(active===controller){active=null;emit({});}}
 }
 async function readJob(jobId:string,{proof,businessId}:Awaited<ReturnType<typeof fresh>>,signal:AbortSignal){
  const resources=await api.resources(businessId,jobId,proof,signal);live(signal);
  if('state'in resources){emit({message:'This job is no longer available in your current workspace.'});return;}
  const history=await api.history({businessId,jobId,throughVersion:resources.head.job.version,afterVersion:'0',pageSize:20},proof,signal);live(signal);if('state'in history)throw Error();
  emit({selected:resources,history:history.events,historyComplete:!history.hasMore,message:'Saved job loaded at version '+resources.head.job.version+'.'});
 }
 const load=(dates?:Dates,initialJobId?:string)=>run(async signal=>{
  clear();emit({phase:'loading',message:'Loading saved jobs and proposed changes…'});
  const scope=await fresh(signal),{proof,businessId}=scope,timezone=context!.context.timezone;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format((deps.now??(()=>new Date()))());
  const selectedDates=dates??{fromDate:today,throughDate:dayAfter(today,6)};let window;
  try{window=scheduleDateWindow(selectedDates,timezone);}catch{emit({phase:'ready',timezone,dates:selectedDates,message:'Choose a valid range of at most 92 days. Date boundaries must identify one actual midnight in the business time zone.'});return;}
  const [jobs,pending]=await Promise.all([api.list({businessId,...window,afterStart:null,afterJob:null,pageSize:20},proof,signal),api.pending({businessId,afterCreatedAt:null,afterAppointmentId:null,pageSize:10},proof,signal)]);live(signal);
  emit({phase:'ready',loaded:true,writesPaused:context!.context.writeState!=="ready",fieldSessionAvailable:context!.fieldSessionAvailable===true,...context!.jobCompletionAvailable?{jobCompletionAvailable:true as const}:{},...context!.jobMileageAvailable?{jobMileageAvailable:true as const}:{},...context!.pickupPhotosAvailable?{pickupPhotosAvailable:true as const}:{},...context!.pickupCollectionAvailable?{pickupCollectionAvailable:true as const}:{},...context!.pickupTripsAvailable?{pickupTripsAvailable:true as const}:{},...context!.supportTripsAvailable?{supportTripsAvailable:true as const}:{},...context!.workTimeAvailable?{workTimeAvailable:true as const}:{},...context!.dropoffCustodyAvailable?{dropoffCustodyAvailable:true as const}:{},timezone,dates:selectedDates,rows:jobs.jobs,hasMore:jobs.hasMore,pending:pending.items,pendingHasMore:pending.hasMore,message:'Saved schedule loaded. Proposed changes reserve no new time.'});
  // The link and its schedule are one read. Every endpoint still verifies
  // the request against the current server session and business.
  if(initialJobId)await readJob(initialJobId,scope,signal);
 });
 const more=()=>run(async signal=>{
  if(view.phase!=='ready'||!view.hasMore||!view.dates||!view.rows.length)return;
  const {proof,businessId}=await fresh(signal),last=view.rows.at(-1)!,page=await api.list({businessId,...scheduleDateWindow(view.dates,view.timezone),afterStart:last.startAt,afterJob:last.jobId,pageSize:20},proof,signal);live(signal);
  const rows=[...view.rows,...page.jobs];if(new Set(rows.map(row=>row.jobId)).size!==rows.length)throw Error();emit({rows,hasMore:page.hasMore,message:'More saved jobs loaded. Reload to include changes made while browsing.'});
 });
 const morePending=()=>run(async signal=>{
  if(view.phase!=='ready'||!view.pendingHasMore||!view.pending.length)return;
  const {proof,businessId}=await fresh(signal),last=view.pending.at(-1)!,page=await api.pending({businessId,afterCreatedAt:last.proposedAt,afterAppointmentId:last.head.latestAppointment.id,pageSize:10},proof,signal);live(signal);
  const pending=[...view.pending,...page.items];if(new Set(pending.map(row=>row.head.job.id)).size!==pending.length)throw Error();emit({pending,pendingHasMore:page.hasMore,message:'More proposed changes loaded. This queue includes all dates.'});
 });
 const open=(jobId:string)=>run(async signal=>{
  if(view.phase!=='ready')return;emit({selected:null,history:[],historyComplete:false,message:'Loading saved job…'});
  await readJob(jobId,await fresh(signal),signal);
 });
 const moreHistory=()=>run(async signal=>{
  if(view.phase!=='ready'||!view.selected||view.historyComplete)return;
  const selected=view.selected,{proof,businessId}=await fresh(signal),page=await api.history({businessId,jobId:selected.jobId,throughVersion:selected.head.job.version,afterVersion:view.history.at(-1)?.sequence??'0',pageSize:20},proof,signal);live(signal);if('state'in page)throw Error();
  emit({history:[...view.history,...page.events],historyComplete:!page.hasMore,message:'More retained job history loaded.'});
 });
 const archive=()=>run(async signal=>{
  if(view.phase!=='ready'||!view.selected)return;const selected=view.selected,{proof,businessId}=await fresh(signal);if(BigInt(selected.head.job.version)>1000n)throw Error();
  const events:JobHistoryEvent[]=[];let hasMore=true;
  while(hasMore){const page=await api.history({businessId,jobId:selected.jobId,throughVersion:selected.head.job.version,afterVersion:events.at(-1)?.sequence??'0',pageSize:20},proof,signal);live(signal);if('state'in page||page.events.length===0&&page.hasMore)throw Error();events.push(...page.events);hasMore=page.hasMore;}
  const bytes=await buildConfirmedJobArchive({head:selected.head,events});try{live(signal);}catch(error){bytes.fill(0);throw error;}emit({message:'Saved job history prepared. This is not a complete business export or backup.'});return bytes;
 });
 function suspend(){active?.abort();active=null;clear();emit({});}
 return Object.freeze({load,more,morePending,open,moreHistory,archive,suspend,view:()=>view,dispose(){alive=false;suspend();}});
}
