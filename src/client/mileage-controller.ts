import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {lookupSchedulingOriginal} from './scheduling-original';
import {mileageOriginal,parseMileageSave} from '../operations/mileage';
import type {MileageBody,MileageTrip} from '../operations/mileage';
import type {MileageHistoryPage} from '../operations/mileage-history';
import {buildMileageHistoryArchive} from '../operations/mileage-history-archive';
import type {PendingScheduling,createPendingSchedulingStore} from './pending-scheduling';
import {customerUuid} from '../customer/customer-contract';
import {scheduleDateWindow} from './schedule-reader';
import type {JobSummary} from '../operations/confirmed-job-read-contract';

type Store=ReturnType<typeof createPendingSchedulingStore>;
type Workspace=Awaited<ReturnType<typeof scheduling.workspace>>;
type Proof=Awaited<ReturnType<typeof authentication.session>>;
export type MileageJobChoice=Pick<JobSummary,'jobId'|'customerName'|'startAt'|'vehicleLabels'|'state'>;
export type MileageJobCursor=Readonly<{startAt:string;jobId:string}>;
export type MileageJobChoices=Readonly<{jobs:readonly MileageJobChoice[];next:MileageJobCursor|null}>;
export type MileageView=Readonly<{
 phase:'loading'|'ready'|'pending'|'review'|'signed-out'|'unavailable';busy:boolean;message:string;
 trips:readonly MileageTrip[];hasMore:boolean;selected:MileageTrip|null;history:MileageHistoryPage|null;
 canSave:boolean;timezone:string;reference:string;
}>;
export const initialMileageView: MileageView=Object.freeze({
 phase:'loading',busy:true,message:'Checking access to saved trips…',trips:[],hasMore:false,selected:null,
 history:null,canSave:false,timezone:'',reference:''
});

export function createMileageController(deps:{jobId:string;store:Store;blockers:readonly Store[];change:(view:MileageView)=>void}){
 let alive=true,active:AbortController|null=null,workspace:Workspace|null=null,pending:PendingScheduling|null=null;
 let state:MileageView=initialMileageView;
 const update=(patch:Partial<MileageView>)=>{
  state=Object.freeze({...state,...patch,busy:active!==null});
  if(alive)deps.change(state);
 };
 const clear=(phase:MileageView['phase'],message:string)=>{
  const reference=pending&&workspace&&pending.businessId===workspace.context.businessId&&pending.binding===workspace.binding
   ?pending.reference.operationId:'';
  update({...initialMileageView,phase,message,reference});
 };
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 async function run(work:(signal:AbortSignal)=>Promise<void>,failed:(error:unknown)=>void){
  if(!alive||active)return;
  const request=new AbortController();
  active=request;update({});
  try{await work(request.signal);}
  catch(error){if(alive&&active===request&&!request.signal.aborted)failed(error);}
  finally{if(active===request){active=null;update({});}}
 }
 function unavailable(error:unknown){
  workspace=null;
  if(pending){clear('pending','Keep the original mileage reference. Its result could not be verified.');return;}
  if(error instanceof AuthenticationError&&error.kind==='denied'){
   clear('signed-out','Sign in to view mileage for this job.');return;
  }
  clear('unavailable','Saved trips or access could not be verified. Reload to try again.');
 }
 async function fresh(signal:AbortSignal,requireSame=true){
  const proof=await authentication.session(signal);live(signal);
  const next=await scheduling.workspace(proof,signal);live(signal);
  if(next.jobMileageAvailable!==true)throw Error();
  if(requireSame&&workspace&&(workspace.binding!==next.binding
   ||workspace.context.businessId!==next.context.businessId||workspace.context.recoveryEpoch!==next.context.recoveryEpoch
   ||workspace.context.writeState!==next.context.writeState))throw Error();
  workspace=next;
  return {proof,context:next.context};
 }
 async function loadTrips(businessId:string,proof:Proof,signal:AbortSignal,selection?:string){
  const result=await scheduling.mileageTrips({businessId,jobId:deps.jobId,after:null,pageSize:20},proof,signal);
  live(signal);
  if(result.state!=='loaded')throw Error();
  update({phase:'ready',trips:result.trips,hasMore:result.hasMore,selected:null,history:null,
   timezone:workspace!.context.timezone,canSave:workspace!.context.writeState==='ready',
   message:result.trips.length?'Choose a saved trip.':'No trips are recorded for this job.'});
  const selected=selection&&result.trips.find(trip=>trip.legId===selection);
  if(selected)await readHistory(selected,businessId,proof,signal);
 }
 async function readHistory(trip:MileageTrip,businessId:string,proof:Proof,signal:AbortSignal,through=trip.evidenceVersion){
  const version=BigInt(through),after=version>5n?(version-5n).toString():'0';
  const result=await scheduling.mileageHistory({businessId,legId:trip.legId,afterVersion:after,throughVersion:through,pageSize:5},proof,signal);
  live(signal);
  if(result.state!=='loaded'||result.observedLegVersionId!==trip.legVersionId)throw Error();
  update({selected:trip,history:result,message:'Saved mileage history loaded.'});
 }
 const load=()=>run(async signal=>{
  workspace=null;pending=deps.store.read();
  clear('loading','Checking access to saved trips…');
  const {proof,context}=await fresh(signal,false);
  if(pending){clear('pending','Check the original mileage save before recording another.');return;}
  if(!customerUuid(deps.jobId))throw Error();
  await loadTrips(context.businessId,proof,signal);
 },unavailable);
 const moreTrips=()=>run(async signal=>{
  const last=state.trips.at(-1);if(state.phase!=='ready'||!state.hasMore||!last)return;
  const {proof,context}=await fresh(signal);
  const {departedAt,legId}=last;
  const result=await scheduling.mileageTrips({businessId:context.businessId,jobId:deps.jobId,after:{departedAt,legId},pageSize:20},proof,signal);
  live(signal);if(result.state!=='loaded')throw Error();
  const trips=[...state.trips,...result.trips];
  if(new Set(trips.map(row=>row.legId)).size!==trips.length)throw Error();
  update({trips,hasMore:result.hasMore,message:'More saved trips loaded.'});
 },unavailable);
 const select=(id:string)=>run(async signal=>{
  const trip=state.trips.find(row=>row.legId===id);
  if(state.phase!=='ready'||!trip)return;
  const {proof,context}=await fresh(signal);
  await readHistory(trip,context.businessId,proof,signal);
 },unavailable);
 const older=()=>run(async signal=>{
  const {selected,history}=state;
  if(state.phase!=='ready'||!selected||!history||history.afterVersion==='0')return;
  const {proof,context}=await fresh(signal);
  await readHistory(selected,context.businessId,proof,signal,history.afterVersion);
 },unavailable);
 async function findJobs(day:string,after: MileageJobCursor|null){
  let choices:MileageJobChoices|undefined;
  await run(async signal=>{
   if(state.phase!=='ready'||!state.selected||!state.canSave)return;
   const {proof,context}=await fresh(signal);
   const dates=scheduleDateWindow({fromDate:day,throughDate:day},context.timezone);
   const page=await scheduling.list({businessId:context.businessId,...dates,
    afterStart:after?.startAt??null,afterJob:after?.jobId??null,pageSize:20},proof,signal);
   live(signal);
   const last=page.jobs.at(-1);
   choices={jobs:page.jobs.map(({jobId,customerName,startAt,vehicleLabels,state})=>({jobId,customerName,startAt,vehicleLabels,state})),
    next:page.hasMore&&last?{startAt:last.startAt,jobId:last.jobId}:null};
  },unavailable);
  return choices;
 }
 async function archive(){
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  await run(async signal=>{
   const {selected,history}=state;
   if(state.phase!=='ready'||!selected||!history?.evidence.length)return;
   const {proof,context}=await fresh(signal);
   const binding={businessId:context.businessId,legId:selected.legId,
    afterVersion:history.afterVersion,throughVersion:history.throughVersion};
   const saved=await scheduling.mileageHistory({...binding,pageSize:5},proof,signal);
   live(signal);
   if(saved.state!=='loaded'||saved.observedLegVersionId!==selected.legVersionId
    ||JSON.stringify(saved)!==JSON.stringify(history))throw Error();
   let prepared:Uint8Array<ArrayBuffer>;
   try{prepared=await buildMileageHistoryArchive(saved,binding);}
   catch{return;}
   if(signal.aborted){prepared.fill(0);return;}
   live(signal);
   bytes=prepared;
  },unavailable);
  return bytes;
 }
 async function confirmed(legId:string,proof:Proof,signal:AbortSignal){
  try{
   await loadTrips(workspace!.context.businessId,proof,signal,legId);
   update({message:'Mileage saved.'});
  }catch{
   if(alive&&!signal.aborted&&active?.signal===signal)
    clear('review','Mileage saved. Reload to see the saved trip and history.');
  }
 }
 const save=(body:MileageBody)=>run(async signal=>{
  const trip=state.selected,history=state.history;
  if(state.phase!=='ready'||!trip||!history||history.throughVersion!==trip.evidenceVersion||!state.canSave)return;
  const {proof,context}=await fresh(signal);
  if(context.writeState!=='ready'||!context.recoveryEpoch||!workspace)throw Error();
  if(deps.store.read()!==null||deps.blockers.some(store=>store.read()!==null)){
   clear('review','Review interrupted saves before recording mileage.');return;
  }
  let request;
  try{
   request=parseMileageSave({schemaVersion:1,businessId:context.businessId,recoveryEpoch:context.recoveryEpoch,
    operationId:crypto.randomUUID(),legId:trip.legId,expectedLegVersionId:trip.legVersionId,
    expectedEvidenceVersion:trip.evidenceVersion,body});
  }catch{update({message:'Review the mileage fields. No request was submitted.'});return;}
  const original=mileageOriginal(request);
  pending={schemaVersion:1,businessId:context.businessId,binding:workspace.binding,reference:original.reference};
  try{deps.store.write(pending);}
  catch{clear('pending','The original reference could not be stored and verified. No request was submitted.');return;}
  let result;
  try{result=await scheduling.saveMileage(request,proof,signal);live(signal);}
  catch(error){
   if(signal.aborted)throw error;
   if(error instanceof SchedulingClientError&&(error.kind==='input'||error.kind==='not_submitted')){
    deps.store.clear(pending);pending=null;clear('review','Mileage was not submitted. Reload before trying again.');return;
   }
   clear('pending','The save outcome is unknown. Check the original mileage before continuing.');return;
  }
  if('state'in result&&result.reason==='operation'){
   clear('pending','This reference conflicts with retained evidence. Check Save review.');return;
  }
  const saved='result'in result;
  try{deps.store.clear(pending);pending=null;}
  catch{clear('pending',saved?'Mileage saved. Local reference cleanup could not be verified.':'No mileage was saved. Local reference cleanup could not be verified.');return;}
  if(!saved){clear('review','The trip or its mileage changed. No mileage was saved. Reload before continuing.');return;}
  await confirmed(trip.legId,proof,signal);
 },unavailable);
 const check=()=>run(async signal=>{
  if(!pending)return;
  const {proof}=await fresh(signal,false);
  if(pending.binding!==workspace!.binding||pending.businessId!==workspace!.context.businessId){
   clear('pending','This reference belongs to a different signed-in context. Return there for Save review.');return;
  }
  deps.store.require(pending);
  const result=await lookupSchedulingOriginal({schemaVersion:1,businessId:pending.businessId,commandType:'operations.mileage.record',
   reference:pending.reference},proof,signal);live(signal);
  if(result.state!=='committed'||!('subjectId'in result.receipt)){
   clear('pending','The original mileage could not be confirmed. Open Save review before entering it again.');return;
  }
  deps.store.clear(pending);pending=null;
  await confirmed(result.receipt.subjectId,proof,signal);
 },unavailable);
 function suspend(){
  active?.abort();active=null;workspace=null;
  clear(pending?'pending':'review',pending?'Private details cleared. Check the original mileage save.':'Private details cleared. Reload saved trips.');
 }
 return Object.freeze({view:()=>state,load,moreTrips,select,older,findJobs,archive,save,check,suspend,dispose(){alive=false;active?.abort();active=null;workspace=null;}});
}
