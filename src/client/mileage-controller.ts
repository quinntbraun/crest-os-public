import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {lookupSchedulingOriginal} from './scheduling-original';
import {mileageOriginal,parseMileageSave} from '../operations/mileage';
import type {MileageBody,MileageTrip} from '../operations/mileage';
import {mobileDepartureKind,mobileDepartureOriginal,parseMobileDepartureSave} from '../operations/mobile-departure-contract';
import type {LoadedMobileDeparture,MobileDepartureSave} from '../operations/mobile-departure-contract';
import type {MileageHistoryPage} from '../operations/mileage-history';
import {buildMileageHistoryArchive} from '../operations/mileage-history-archive';
import type {PendingScheduling,createPendingSchedulingStore} from './pending-scheduling';
import {customerUuid} from '../customer/customer-contract';
import {scheduleDateWindow} from './schedule-reader';
import type {JobSummary} from '../operations/confirmed-job-read-contract';

type Store=ReturnType<typeof createPendingSchedulingStore>;
type Workspace=Awaited<ReturnType<typeof scheduling.workspace>>;
type Proof=Awaited<ReturnType<typeof authentication.session>>;
const mileageKind='operations.mileage.record';
type SaveKind=typeof mileageKind|typeof mobileDepartureKind;
export type MileageJobChoice=Pick<JobSummary,'jobId'|'customerName'|'startAt'|'vehicleLabels'|'state'>;
export type MileageJobCursor=Readonly<{startAt:string;jobId:string}>;
export type MileageJobChoices=Readonly<{jobs:readonly MileageJobChoice[];next:MileageJobCursor|null}>;
export type MileageView=Readonly<{
 phase:'loading'|'ready'|'pending'|'review'|'signed-out'|'unavailable';busy:boolean;message:string;
 trips:readonly MileageTrip[];hasMore:boolean;selected:MileageTrip|null;history:MileageHistoryPage|null;
 canSave:boolean;timezone:string;reference:string;departure:LoadedMobileDeparture|null;pendingKind:SaveKind|null;
}>;
export const initialMileageView: MileageView=Object.freeze({
 phase:'loading',busy:true,message:'Checking access to saved trips…',trips:[],hasMore:false,selected:null,
 history:null,canSave:false,timezone:'',reference:'',departure:null,pendingKind:null
});

export function createMileageController(deps:{jobId:string;legId?:string;store:Store;departureStore:Store;blockers:readonly Store[];change:(view:MileageView)=>void}){
 let alive=true,active:AbortController|null=null,workspace:Workspace|null=null;
 let pending:{kind:SaveKind;entry:PendingScheduling}|null=null;
 let state:MileageView=initialMileageView;
 const storeFor=(kind:SaveKind)=>kind===mobileDepartureKind?deps.departureStore:deps.store;
 const subject=(kind:SaveKind)=>kind===mobileDepartureKind?'departure correction':'mileage';
 const update=(patch:Partial<MileageView>)=>{
  state=Object.freeze({...state,...patch,busy:active!==null});
  if(alive)deps.change(state);
 };
 const clear=(phase:MileageView['phase'],message:string)=>{
  const entry=pending?.entry;
  const reference=entry&&workspace&&entry.businessId===workspace.context.businessId&&entry.binding===workspace.binding
   ?entry.reference.operationId:'';
  update({...initialMileageView,phase,message,reference,pendingKind:pending?.kind??null});
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
  if(pending){clear('pending','Keep the original '+subject(pending.kind)+' reference. Its result could not be verified.');return;}
  if(error instanceof AuthenticationError&&error.kind==='denied'){
   clear('signed-out',deps.legId?'Sign in to view mileage for this trip.':'Sign in to view mileage for this job.');return;
  }
  clear('unavailable','Saved trips or access could not be verified. Reload to try again.');
 }
 async function fresh(signal:AbortSignal,requireSame=true){
  const proof=await authentication.session(signal);live(signal);
  const next=await scheduling.workspace(proof,signal);live(signal);
  if(next.jobMileageAvailable!==true||deps.legId&&next.supportTripsAvailable!==true)throw Error();
  if(requireSame&&workspace&&(workspace.binding!==next.binding
   ||workspace.context.businessId!==next.context.businessId||workspace.context.recoveryEpoch!==next.context.recoveryEpoch
   ||workspace.context.writeState!==next.context.writeState))throw Error();
  workspace=next;
  return {proof,context:next.context};
 }
 async function loadTrips(businessId:string,proof:Proof,signal:AbortSignal,selection?:string){
  if(deps.legId){
   const result=await scheduling.supportTripMileage(businessId,deps.legId,proof,signal);
   live(signal);
   if('state'in result)throw Error();
   update({phase:'ready',trips:[result.trip],hasMore:false,selected:null,history:null,departure:null,
    timezone:workspace!.context.timezone,canSave:workspace!.context.writeState==='ready'});
   await readHistory(result.trip,businessId,proof,signal);
   return;
  }
  const result=await scheduling.mileageTrips({businessId,jobId:deps.jobId,after:null,pageSize:20},proof,signal);
  live(signal);
  if(result.state!=='loaded')throw Error();
  update({phase:'ready',trips:result.trips,hasMore:result.hasMore,selected:null,history:null,departure:null,
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
  let departure:LoadedMobileDeparture|null=null,message='Saved mileage history loaded.';
  if(deps.jobId&&trip.purpose==='mobile_work_site'&&workspace?.mobileDepartureAvailable&&workspace.context.writeState==='ready'){
   try{
    const context=await scheduling.mobileDeparture(businessId,deps.jobId,trip.legId,proof,signal);
    live(signal);
    if('state'in context||context.legVersionId!==trip.legVersionId||context.departedAt!==trip.departedAt||
      context.arrivedAt!==trip.arrivedAt||context.legState!==trip.state)throw Error();
    departure=context;
   }catch{
    live(signal);
    message='Saved mileage history loaded. Reload before correcting the departure time.';
   }
  }
  update({selected:trip,history:result,departure,message});
 }
 const load=()=>run(async signal=>{
  workspace=null;pending=null;
  const mileage=deps.store.read(),departure=deps.departureStore.read();
  if(mileage)pending={kind:mileageKind,entry:mileage};
  else if(departure)pending={kind:mobileDepartureKind,entry:departure};
  clear('loading','Checking access to saved trips…');
  const {proof,context}=await fresh(signal,false);
  if(pending){clear('pending','Check the original '+subject(pending.kind)+' save before recording another.');return;}
  if(deps.legId?(!customerUuid(deps.legId)||deps.jobId!==''):!customerUuid(deps.jobId))throw Error();
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
 async function confirmed(legId:string,kind:SaveKind,proof:Proof,signal:AbortSignal){
  const message=kind===mobileDepartureKind?'Departure time corrected.':'Mileage saved.';
  try{
   await loadTrips(workspace!.context.businessId,proof,signal,legId);
   update({message});
  }catch{
   if(alive&&!signal.aborted&&active?.signal===signal)
    clear('review',message+' Reload to see the saved trip and history.');
  }
 }
 function hasPending(){return deps.store.read()!==null||deps.departureStore.read()!==null||deps.blockers.some(store=>store.read()!==null);}
 async function persist(kind:SaveKind,reference:PendingScheduling['reference'],legId:string,proof:Proof,signal:AbortSignal,
  submit:()=>Promise<Readonly<{state:'conflict';reason:string}>|Readonly<{result:unknown}>>){
  if(!workspace)throw Error();
  const store=storeFor(kind),departure=kind===mobileDepartureKind;
  const entry:PendingScheduling={schemaVersion:1,businessId:workspace.context.businessId,binding:workspace.binding,reference};
  pending={kind,entry};
  try{store.write(entry);}
  catch{clear('pending','The original reference could not be stored and verified. No request was submitted.');return;}
  let result;
  try{result=await submit();live(signal);}
  catch(error){
   if(signal.aborted)throw error;
   if(error instanceof SchedulingClientError&&(error.kind==='input'||error.kind==='not_submitted')){
    store.clear(entry);pending=null;clear('review',departure?'The departure correction was not submitted. Reload before trying again.':'Mileage was not submitted. Reload before trying again.');return;
   }
   clear('pending','The save outcome is unknown. Check the original '+subject(kind)+' before continuing.');return;
  }
  if('state'in result&&result.reason==='operation'){
   clear('pending','This reference conflicts with retained evidence. Check Save review.');return;
  }
  const saved='result'in result;
  try{store.clear(entry);pending=null;}
  catch{
   const message=departure?(saved?'Departure time corrected.':'No departure correction was saved.'):(saved?'Mileage saved.':'No mileage was saved.');
   clear('pending',message+' Local reference cleanup could not be verified.');return;
  }
  if(!saved){
   clear('review',departure
    ?'state'in result&&result.reason==='occupancy'?'That time overlaps recorded work or travel. No departure correction was saved. Reload before continuing.'
     :'The trip or its saved times changed. No departure correction was saved. Reload before continuing.'
    :'The trip or its mileage changed. No mileage was saved. Reload before continuing.');return;
  }
  await confirmed(legId,kind,proof,signal);
 }
 const save=(body:MileageBody)=>run(async signal=>{
  const trip=state.selected,history=state.history;
  if(state.phase!=='ready'||!trip||!history||history.throughVersion!==trip.evidenceVersion||!state.canSave)return;
  const {proof,context}=await fresh(signal);
  if(context.writeState!=='ready'||!context.recoveryEpoch||!workspace)throw Error();
  if(hasPending()){
   clear('review','Review interrupted saves before recording mileage.');return;
  }
  let request;
  try{
   request=parseMileageSave({schemaVersion:1,businessId:context.businessId,recoveryEpoch:context.recoveryEpoch,
    operationId:crypto.randomUUID(),legId:trip.legId,expectedLegVersionId:trip.legVersionId,
    expectedEvidenceVersion:trip.evidenceVersion,body});
  }catch{update({message:'Review the mileage fields. No request was submitted.'});return;}
  await persist(mileageKind,mileageOriginal(request).reference,trip.legId,proof,signal,()=>scheduling.saveMileage(request,proof,signal));
 },unavailable);
 const correctDeparture=(body:MobileDepartureSave['body'])=>run(async signal=>{
  const departure=state.departure;
  if(state.phase!=='ready'||!state.canSave||!departure)return;
  const {proof,context}=await fresh(signal);
  if(!workspace?.mobileDepartureAvailable||context.writeState!=='ready'||!context.recoveryEpoch)throw Error();
  if(hasPending()){clear('review','Review interrupted saves before correcting the departure time.');return;}
  let request:MobileDepartureSave;
  try{
   request=parseMobileDepartureSave({schemaVersion:1,businessId:context.businessId,recoveryEpoch:context.recoveryEpoch,
    operationId:crypto.randomUUID(),jobId:departure.jobId,expectedJobVersion:departure.jobVersion,
    legId:departure.legId,legVersionId:departure.legVersionId,departureEventId:departure.departureEventId,body});
  }catch{update({message:'Review the departure time and reason. No request was submitted.'});return;}
  await persist(mobileDepartureKind,mobileDepartureOriginal(request).reference,departure.legId,proof,signal,
   ()=>scheduling.correctMobileDeparture(request,proof,signal));
 },unavailable);
 const check=()=>run(async signal=>{
  if(!pending)return;
  const {kind,entry}=pending,store=storeFor(kind);
  const {proof}=await fresh(signal,false);
  if(entry.binding!==workspace!.binding||entry.businessId!==workspace!.context.businessId){
   clear('pending','This reference belongs to a different signed-in context. Return there for Save review.');return;
  }
  store.require(entry);
  const result=await lookupSchedulingOriginal({schemaVersion:1,businessId:entry.businessId,commandType:kind,
   reference:entry.reference},proof,signal);live(signal);
  if(result.state!=='committed'||!('subjectId'in result.receipt)){
   clear('pending','The original '+subject(kind)+' could not be confirmed. Open Save review before entering it again.');return;
  }
  store.clear(entry);pending=null;
  await confirmed(result.receipt.subjectId,kind,proof,signal);
 },unavailable);
 function suspend(){
  active?.abort();active=null;workspace=null;
  clear(pending?'pending':'review',pending?'Private details cleared. Check the original '+subject(pending.kind)+' save.':'Private details cleared. Reload saved trips.');
 }
 return Object.freeze({view:()=>state,load,moreTrips,select,older,findJobs,archive,save,correctDeparture,check,suspend,dispose(){alive=false;active?.abort();active=null;workspace=null;}});
}
