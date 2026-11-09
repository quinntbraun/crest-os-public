import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {lookupSchedulingOriginal} from './scheduling-original';
import {vehicles} from './vehicles';
import {parseSupportTripSave,supportTripOriginal} from '../operations/support-trip';
import type {SupportTrip,SupportTripBody} from '../operations/support-trip';
import type {PendingScheduling,createPendingSchedulingStore} from './pending-scheduling';

type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Proof=Awaited<ReturnType<typeof authentication.session>>;
type Store=ReturnType<typeof createPendingSchedulingStore>;
type Vehicle=Awaited<ReturnType<typeof vehicles.list>>['vehicles'][number];
export type SupportTripKind='operations.support_trip.record'|'operations.support_trip.correct';
type Pending=Readonly<{kind:SupportTripKind;value:PendingScheduling}>;
export type SupportTripView=Readonly<{
 phase:'loading'|'ready'|'pending'|'review'|'signed-out'|'unavailable';busy:boolean;message:string;
 timezone:string;canSave:boolean;mileageAvailable:boolean;activeTrip:SupportTrip|null;trips:readonly SupportTrip[];hasMore:boolean;
 vehicles:readonly Vehicle[];moreVehicles:boolean;selected:SupportTrip|null;history:readonly SupportTrip[];
 moreHistory:boolean;saveCount:number;pending:Readonly<{kind:SupportTripKind;reference:string}>|null;
}>;
export const initialSupportTripView:SupportTripView=Object.freeze({
 phase:'loading',busy:true,message:'Checking access to saved trips…',timezone:'',canSave:false,mileageAvailable:false,
 activeTrip:null,trips:[],hasMore:false,vehicles:[],moreVehicles:false,selected:null,history:[],moreHistory:false,saveCount:0,pending:null
});

export function createSupportTripController(deps:{
 stores:Readonly<Record<SupportTripKind,Store>>;blockers:readonly Store[];change:(view:SupportTripView)=>void;
}){
 let alive=true,active:AbortController|null=null,workspace:Context|null=null,pending:Pending|null=null;
 let view=initialSupportTripView;
 const eligible=()=>pending&&workspace&&pending.value.businessId===workspace.context.businessId&&pending.value.binding===workspace.binding;
 function update(patch:Partial<SupportTripView>){
  view=Object.freeze({...view,...patch,busy:active!==null});
  if(alive)deps.change(view);
 }
 function clear(phase:SupportTripView['phase'],message:string){
  update({...initialSupportTripView,phase,message,pending:pending&&eligible()
   ?{kind:pending.kind,reference:pending.value.reference.operationId}:null});
 }
 function live(signal:AbortSignal){if(!alive||signal.aborted||active?.signal!==signal)throw Error();}
 async function run(work:(signal:AbortSignal)=>Promise<void>,fail=unavailable){
  if(!alive||active)return;
  const request=new AbortController();
  active=request;update({});
  try{await work(request.signal);}
  catch(error){if(alive&&active===request&&!request.signal.aborted)fail(error);}
  finally{if(active===request){active=null;update({});}}
 }
 function unavailable(error:unknown){
  if(pending){clear('pending','The original trip save could not be verified. Keep its reference.');return;}
  workspace=null;
  if(error instanceof AuthenticationError&&error.kind==='denied')clear('signed-out','Sign in to view saved travel.');
  else clear('unavailable','Saved travel or access could not be verified. Reload to try again.');
 }
 async function fresh(signal:AbortSignal){
  const proof=await authentication.session(signal);live(signal);
  const next=await scheduling.workspace(proof,signal);live(signal);
  if(!next.supportTripsAvailable){
   clear('unavailable','Standalone travel is unavailable in this workspace.');
   throw new SupportTripUnavailable();
  }
  if(workspace&&(workspace.binding!==next.binding||workspace.context.businessId!==next.context.businessId
   ||workspace.context.operatorId!==next.context.operatorId||workspace.context.timezone!==next.context.timezone
   ||workspace.context.recoveryEpoch!==next.context.recoveryEpoch||workspace.context.writeState!==next.context.writeState))throw Error();
  workspace=next;
  return {proof,context:next.context};
 }
 function readPending(){
  const found=Object.entries(deps.stores).flatMap(([kind,store])=>{
   const value=store.read();
   return value?[{kind:kind as SupportTripKind,value}]:[];
  });
  if(found.length>1)throw Error();
  return found[0]??null;
 }
 async function firstPage(proof:Proof,signal:AbortSignal,message:string){
  const context=workspace!.context;
  const page=await scheduling.supportTrips({businessId:context.businessId,after:null,pageSize:20},proof,signal);
  live(signal);
  const list=context.writeState==='ready'
   ?await vehicles.list(context.businessId,{search:'',afterId:null,includeArchived:false,pageSize:20},proof,signal)
   :null;
  live(signal);
  update({phase:'ready',timezone:context.timezone,canSave:context.writeState==='ready',mileageAvailable:workspace!.jobMileageAvailable===true,activeTrip:page.active,
   trips:page.trips,hasMore:page.hasMore,vehicles:list?.vehicles??[],moreVehicles:list?.hasMore??false,
   selected:null,history:[],moreHistory:false,message});
 }
 const load=()=>run(async signal=>{
  workspace=null;pending=null;
  clear('loading','Checking access to saved trips…');
  try{pending=readPending();}
  catch{clear('review','Open Interrupted saves to review the saved references.');return;}
  const {proof}=await fresh(signal);
  if(pending){clear('pending','Check the original trip save before recording another.');return;}
  await firstPage(proof,signal,'Saved travel loaded.');
 },error=>{if(!(error instanceof SupportTripUnavailable))unavailable(error);});
 const moreTrips=()=>run(async signal=>{
  const last=view.trips.at(-1);
  if(view.phase!=='ready'||!view.hasMore||!last)return;
  const {proof,context}=await fresh(signal),page=await scheduling.supportTrips({businessId:context.businessId,
   after:{departedAt:last.departedAt,legId:last.legId},pageSize:20},proof,signal);
  live(signal);
  const trips=[...view.trips,...page.trips];
  if(new Set(trips.map(trip=>trip.legId)).size!==trips.length)throw Error();
  update({activeTrip:page.active,trips,hasMore:page.hasMore,message:'More saved trips loaded.'});
 });
 const moreVehicles=()=>run(async signal=>{
  const last=view.vehicles.at(-1);
  if(view.phase!=='ready'||!view.moreVehicles||!last)return;
  const {proof,context}=await fresh(signal),page=await vehicles.list(context.businessId,
   {search:'',afterId:last.id,includeArchived:false,pageSize:20},proof,signal);
  live(signal);
  update({vehicles:[...view.vehicles,...page.vehicles],moreVehicles:page.hasMore,message:'More vehicles loaded.'});
 });
 const history=(legId:string,append=false)=>run(async signal=>{
  if(view.phase!=='ready')return;
  const selected=append?view.selected:[view.activeTrip,...view.trips].find(row=>row?.legId===legId);
  if(!selected||selected.legId!==legId||append&&!view.moreHistory)return;
  const {proof,context}=await fresh(signal);
  const earlier=append?view.history:[];
  const page=await scheduling.supportTripHistory({businessId:context.businessId,legId,throughVersion:selected.sequence,
   afterVersion:earlier.at(-1)?.sequence??'0',pageSize:10},proof,signal);
  live(signal);
  if('state'in page||!page.hasMore&&page.trips.at(-1)?.legVersionId!==selected.legVersionId)throw Error();
  update({selected,history:[...earlier,...page.trips],moreHistory:page.hasMore,message:'Saved trip history loaded.'});
 });
 async function historyDownload(){
  let downloaded:Uint8Array<ArrayBuffer>|undefined;
  await run(async signal=>{
   const {selected,history}=view;
   const rows=history.slice(-10),first=rows[0],last=rows.at(-1);
   if(view.phase!=='ready'||!selected||!first||!last)return;
   const {proof,context}=await fresh(signal);
   const saved=await scheduling.supportTripHistory({businessId:context.businessId,legId:selected.legId,
    afterVersion:(BigInt(first.sequence)-1n).toString(),throughVersion:last.sequence,pageSize:rows.length},proof,signal);
   live(signal);
   if('state'in saved||saved.hasMore||JSON.stringify(saved.trips)!==JSON.stringify(rows))throw Error();
   downloaded=new TextEncoder().encode(JSON.stringify({
    schemaVersion:1,scope:'standalone_trip_history_page',completeCrestExport:false,completeBackup:false,
    legId:selected.legId,firstVersion:first.sequence,lastVersion:last.sequence,trips:saved.trips
   },null,2)+'\n');
  });
  return downloaded;
 }
 async function confirmed(proof:Proof,signal:AbortSignal){
  try{await firstPage(proof,signal,'Trip saved.');update({saveCount:view.saveCount+1});}
  catch{if(alive&&!signal.aborted&&active?.signal===signal)clear('review','Trip saved. Reload to see the saved record.');}
 }
 const save=(body:SupportTripBody,legId?:string)=>run(async signal=>{
  if(view.phase!=='ready'||!view.canSave)return;
  const creating=body.action==='depart'||body.action==='record';
  const current=creating?null:[view.activeTrip,...view.trips].find(row=>row?.legId===legId);
  if(!creating&&!current)return;
  const {proof,context}=await fresh(signal);
  if(context.writeState!=='ready'||!workspace)throw Error();
  try{
   if(readPending()||deps.blockers.some(store=>store.read()!==null))throw Error();
  }catch{clear('review','Review interrupted saves before recording another trip.');return;}
  let request;
  try{
   request=parseSupportTripSave({schemaVersion:1,businessId:context.businessId,operationId:crypto.randomUUID(),
    recoveryEpoch:context.recoveryEpoch,legId:current?.legId??crypto.randomUUID(),expectedLegVersionId:current?.legVersionId??null,body});
   const selectedVehicle=body.trip&&'drivenVehicleId'in body.trip?body.trip.drivenVehicleId:null;
   if(selectedVehicle&&selectedVehicle!==current?.drivenVehicleId&&!view.vehicles.some(vehicle=>vehicle.id===selectedVehicle))throw Error();
  }catch{update({message:'Review the required trip fields. No save was submitted.'});return;}
  const original=supportTripOriginal(request),kind=original.commandType as SupportTripKind;
  const store=deps.stores[kind];
  pending={kind,value:{schemaVersion:1,businessId:context.businessId,binding:workspace.binding,reference:original.reference}};
  try{store.write(pending.value);}
  catch{clear('pending','The save reference could not be verified. No save was submitted.');return;}
  let result;
  try{result=await scheduling.saveSupportTrip(request,proof,signal);live(signal);}
  catch(error){
   if(signal.aborted)throw error;
   if(error instanceof SchedulingClientError&&['input','not_submitted'].includes(error.kind)){
    store.clear(pending.value);pending=null;clear('review','The trip was not submitted. Reload before trying again.');return;
   }
   clear('pending','The save outcome is unknown. Check the original trip before continuing.');return;
  }
  if('state'in result&&result.reason==='operation'){clear('pending','The reference conflicts with saved evidence. Open Interrupted saves.');return;}
  const saved='result'in result;
  try{store.clear(pending.value);pending=null;}
  catch{clear('pending',saved?'Trip saved. The local reference still needs review.':'No trip was saved. The local reference still needs review.');return;}
  if(!saved){clear('review','No trip was saved. Check saved travel for an overlapping trip or changed record, then reload.');return;}
  await confirmed(proof,signal);
 });
 const check=()=>run(async signal=>{
  if(!pending)return;
  const {proof}=await fresh(signal);
  if(!eligible()){clear('pending','This reference belongs to a different sign-in. Return there to review it.');return;}
  const {kind,value}=pending;
  deps.stores[kind].require(value);
  const result=await lookupSchedulingOriginal({schemaVersion:1,businessId:value.businessId,commandType:kind,reference:value.reference},proof,signal);
  live(signal);
  if(result.state!=='committed'||!('subjectId'in result.receipt)){
   clear('pending','The trip save could not be confirmed. Open Interrupted saves before recording it again.');return;
  }
  deps.stores[kind].clear(value);pending=null;
  await confirmed(proof,signal);
 });
 function suspend(){
  active?.abort();active=null;workspace=null;
  clear(pending?'pending':'review',pending?'Private details cleared. Check the original trip save.':'Private details cleared. Reload saved travel.');
 }
 return Object.freeze({view:()=>view,load,moreTrips,moreVehicles,history,historyDownload,save,check,suspend,dispose(){alive=false;active?.abort();active=null;workspace=null;}});
}

class SupportTripUnavailable extends Error{}
