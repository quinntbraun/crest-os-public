import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {lookupSchedulingOriginal} from './scheduling-original';
import {addresses} from './customer-addresses';
import type {CustomerAddress} from '../customer/customer-address-contract';
import type {createPendingSchedulingStore,PendingScheduling} from './pending-scheduling';
import {parseBookingPayload} from '../operations/confirmed-booking-contract';
import type {BookingPayload} from '../operations/confirmed-booking-contract';
import {parseBookJobCommand} from '../operations/amended-booking-contract';
import type {BookJobCommand} from '../operations/amended-booking-contract';
import {customerUuid} from '../customer/customer-contract';
import {validateScopeAllocationPlan} from '../operations/scope-allocation-plan';
import {quotes,QuoteClientError} from './quotes';
import {vehicles,VehicleClientError} from './vehicles';
import {combineBookingWork} from './booking-work';
import type {BookingWork,BookingVehicleChoice} from './booking-work';
import type {Vehicle} from '../customer/vehicle-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
export type BookingAgreement=Exclude<Awaited<ReturnType<typeof scheduling.agreement>>,{state:'absent'}>;
type Store=ReturnType<typeof createPendingSchedulingStore>;
type Phase='loading'|'ready'|'pending'|'review'|'signed-out'|'unavailable'|'blocked'|'committed';
type QuoteChoice=Readonly<{familyId:string;title:string;state:string}>;
export type BookJobView=Readonly<{phase:Phase;busy:boolean;message:string;context:Context|null;agreement:BookingAgreement|null;work:BookingWork|null;quoteRows:readonly QuoteChoice[];quotesMore:boolean;vehicleRows:readonly Vehicle[];vehiclesMore:boolean;jobId:string;reference:string;canRetry:boolean;savedJobId:string;addresses:readonly CustomerAddress[];addressesMore:boolean;addressesAvailable:boolean}>;
export const initialBookJobView:BookJobView=Object.freeze({phase:'loading',busy:true,message:'Checking accepted scope and booking access…',context:null,agreement:null,work:null,quoteRows:[],quotesMore:false,vehicleRows:[],vehiclesMore:false,jobId:'',reference:'',canRetry:false,savedJobId:'',addresses:[],addressesMore:false,addressesAvailable:false});
export function createBookJobController(deps:{store:Store;blockers?:readonly Store[];change:(view:BookJobView)=>void;api?:typeof scheduling;session?:typeof authentication.session;lookup?:typeof lookupSchedulingOriginal;addressApi?:typeof addresses;quoteApi?:typeof quotes;vehicleApi?:typeof vehicles;id?:()=>string}){
 const api=deps.api??scheduling,session=deps.session??authentication.session,lookup=deps.lookup??lookupSchedulingOriginal,addressApi=deps.addressApi??addresses,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,phase:Phase='loading',message=initialBookJobView.message,context:Context|null=null,agreement:BookingAgreement|null=null,pending:PendingScheduling|null=null,original:BookJobCommand|null=null,jobId='',savedJobId='',canRetry=false,rows:readonly CustomerAddress[]=[],addressesMore=false,addressesAvailable=false;
 const quoteApi=deps.quoteApi??quotes,vehicleApi=deps.vehicleApi??vehicles;
 let selected:readonly BookingAgreement[]=[],extraVehicles:readonly BookingVehicleChoice[]=[],quoteRows:readonly QuoteChoice[]=[],vehicleRows:readonly Vehicle[]=[],quotesMore=false,vehiclesMore=false,quoteSearch='',vehicleSearch='',quoteCursor:string|null=null,vehicleCursor:string|null=null;
 const work=()=>combineBookingWork(selected,extraVehicles);
 const eligible=()=>!!pending&&!!context&&pending.businessId===context.context.businessId&&pending.binding===context.binding;
 const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&a.amendedSchedulingAvailable===b.amendedSchedulingAvailable&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch;
 const view=():BookJobView=>Object.freeze({phase,busy:!!active,message,context:phase==='ready'?context:null,agreement:phase==='ready'?agreement:null,work:phase==='ready'&&agreement?work():null,quoteRows:phase==='ready'?quoteRows:[],quotesMore:phase==='ready'&&quotesMore,vehicleRows:phase==='ready'?vehicleRows:[],vehiclesMore:phase==='ready'&&vehiclesMore,jobId:phase==='ready'?jobId:'',reference:phase==='pending'&&eligible()?pending!.reference.operationId:'',canRetry:phase==='pending'&&!active&&canRetry,savedJobId:phase==='committed'||phase==='pending'&&eligible()?savedJobId:'',addresses:phase==='ready'?rows:[],addressesMore:phase==='ready'&&addressesMore,addressesAvailable:phase==='ready'&&addressesAvailable});
 const emit=()=>{if(alive)deps.change(view());};
 function clearPrivate(){agreement=null;selected=[];extraVehicles=[];quoteRows=[];vehicleRows=[];quotesMore=false;vehiclesMore=false;quoteSearch='';vehicleSearch='';quoteCursor=null;vehicleCursor=null;original=null;rows=[];addressesMore=false;addressesAvailable=false;jobId='';canRetry=false;savedJobId='';}
 function pendingMessage(text:string){clearPrivate();phase='pending';message=text;}
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 async function fresh(signal:AbortSignal){const proof=await session(signal);live(signal);const next=await api.workspace(proof,signal);live(signal);return {proof,next};}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failed:(error:unknown)=>void){
  if(!alive||active)return;const controller=new AbortController();active=controller;emit();
  try{await work(controller.signal);}catch(error){if(alive&&!controller.signal.aborted&&active===controller)failed(error);}
  finally{if(active===controller){active=null;emit();}}
 }
 function unavailable(error:unknown){clearPrivate();context=null;phase=error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable';message=phase==='signed-out'?'Sign in to book a visit.':'Current booking access could not be verified. Reload before continuing.';}
 function finish(result:Awaited<ReturnType<typeof scheduling.book>>){
  if(!pending)throw Error();
  if(result.state==='conflict'&&result.reason==='operation'){pendingMessage('The original booking conflicts with retained evidence. Keep its reference and review the original request.');return;}
  try{deps.store.clear(pending);}catch{
   const saved=result.state==='committed'?result.receipt.jobId:'';clearPrivate();savedJobId=saved;phase='pending';
   message=saved?'The server confirmed this job was saved. Local reference cleanup could not be verified. Review the saved job and check the original before another booking.':'No booking was saved. Local reference cleanup could not be verified. Review the original request before preparing another booking.';return;
  }
  pending=null;
  if(result.state==='conflict'){clearPrivate();context=null;phase='review';message=result.reason==='review'?'The schedule or travel review changed. No booking was saved. Reload accepted scope and review the schedule before another attempt.':result.reason==='pickup_policy'?'Set a pickup handoff policy in Service arrangements before booking Pickup + Return. No booking was saved.':'The '+result.reason+' facts changed or are unavailable. No booking was saved. Reload current accepted scope.';return;}
  const saved=result.receipt.jobId;clearPrivate();context=null;savedJobId=saved;phase='committed';message='Confirmed job saved. Open its retained visit details in Schedule.';
 }
 async function inspect(proof:Awaited<ReturnType<typeof authentication.session>>,signal:AbortSignal){
  if(!pending||!eligible())throw Error();deps.store.require(pending);
  const result=await lookup({schemaVersion:1,businessId:pending.businessId,commandType:'operations.job.book',reference:pending.reference},proof,signal);live(signal);
  if(result.state!=='absent'){
   // The command-specific parser and client bind the exact original identity.
   if(!('jobId'in result.receipt)||!('version'in result.receipt)||result.receipt.version!=='1')throw Error();
   finish(result as Awaited<ReturnType<typeof api.book>>);return;
  }
  canRetry=!!original&&context?.context.writeState==='ready'&&context.context.recoveryEpoch===pending.reference.recoveryEpoch;
  message=canRetry?'No committed original was found. You may retry only the unchanged original booking.':'No committed original was found. The private draft is unavailable. Keep this reference for original-request review; no new booking has been sent.';
 }
 const load=(familyId:string)=>run(async signal=>{
  clearPrivate();context=null;phase='loading';message='Loading current accepted scope…';pending=deps.store.read();const {proof,next}=await fresh(signal);context=next;
  if(pending){phase='pending';message='Checking the original booking…';if(eligible())await inspect(proof,signal);else message='The original booking belongs to a different authenticated context. Return to that context for review.';return;}
  if(deps.blockers?.some(store=>store.read()!==null)){phase='blocked';message='Review the other interrupted scheduling change before booking a new visit.';return;}
  if(!customerUuid(familyId)){phase='blocked';message='Open an accepted quote and choose “Book a visit” to select its agreed work.';return;}
  const current=await api.agreement(next.context.businessId,familyId,proof,signal);live(signal);
  if('state'in current){phase='blocked';message='No current accepted agreement is available. Reopen the saved quote and check its acceptance.';return;}
  if(current.customer.archived_at!==null){phase='blocked';message='This customer is archived. Review the customer record before booking another visit.';return;}
  if(!current.sources.some(source=>source.parts.some(part=>part.state==='unassigned'))){phase='blocked';message='No unassigned accepted work remains on this agreement. Review the existing jobs before preparing another visit.';return;}
  agreement=current;selected=[current];jobId=id();phase='ready';message=next.context.writeState==='ready'?'Current accepted scope loaded. Review the visit details before confirming the booking.':'Changes are paused. Accepted scope is available for review.';
  try{const page=await addressApi.list(next.context.businessId,{customerId:current.customer.id,search:'',afterId:null,includeArchived:false,pageSize:50},proof,signal);live(signal);rows=page.addresses;addressesMore=page.hasMore;addressesAvailable=true;}
  catch{live(signal);addressesAvailable=false;}
 },error=>{if(pending){clearPrivate();phase='pending';message='The original booking could not be checked. Keep its reference and check again.';}else unavailable(error);});
 const moreAddresses=()=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context||!addressesMore||rows.length===0)return;
  const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();context=next;
  const page=await addressApi.list(next.context.businessId,{customerId:agreement.customer.id,search:'',afterId:rows.at(-1)!.id,includeArchived:false,pageSize:50},proof,signal);live(signal);const combined=[...rows,...page.addresses];if(new Set(combined.map(row=>row.id)).size!==combined.length)throw Error();rows=combined;addressesMore=page.hasMore;
 },unavailable);
 const findAgreements=(search:string,more=false)=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context||more&&(!quotesMore||search!==quoteSearch))return;
  const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();
  if(!more){quoteRows=[];quotesMore=false;quoteCursor=null;quoteSearch=search;}
  let page:Awaited<ReturnType<typeof quotes.list>>|null=null;
  try{page=await quoteApi.list(next.context.businessId,{search,afterId:more?quoteCursor:null,pageSize:10},proof,signal);live(signal);}
  catch(error){live(signal);if(error instanceof QuoteClientError&&['denied','recovery'].includes(error.kind))throw error;}
  const checked=await fresh(signal);if(!same(next,checked.next))throw Error();context=checked.next;
  if(!page){quoteRows=[];quotesMore=false;quoteCursor=null;message='Quote search is unavailable. Your visit draft is unchanged. Search again when ready.';return;}
  const found=page.quotes.filter(row=>row.family.customer_id===agreement!.customer.id).map(row=>({familyId:row.family.id,title:row.revision.customer_safe_snapshot.title,state:row.revision.state}));
  const combined=more?[...quoteRows,...found]:found;if(new Set(combined.map(row=>row.familyId)).size!==combined.length||page.hasMore&&!page.quotes.length)throw Error();
  quoteRows=combined;quoteCursor=page.quotes.at(-1)?.family.id??null;quotesMore=page.hasMore;message=found.length?'Quotes for this customer loaded. Check a quote’s current accepted work before adding it.':page.hasMore?'No matching customer quotes on this page. Load more or refine the search.':'No matching customer quotes found. Your visit draft is unchanged.';
 },unavailable);
 const findVehicles=(search:string,more=false)=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context||more&&(!vehiclesMore||search!==vehicleSearch))return;
  const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();
  if(!more){vehicleRows=[];vehiclesMore=false;vehicleCursor=null;vehicleSearch=search;}
  let page:Awaited<ReturnType<typeof vehicles.list>>|null=null;
  try{page=await vehicleApi.list(next.context.businessId,{search,afterId:more?vehicleCursor:null,includeArchived:false,pageSize:10},proof,signal);live(signal);}
  catch(error){live(signal);if(error instanceof VehicleClientError&&['denied','recovery'].includes(error.kind))throw error;}
  const checked=await fresh(signal);if(!same(next,checked.next))throw Error();context=checked.next;
  if(!page){vehicleRows=[];vehiclesMore=false;vehicleCursor=null;message='Vehicle search is unavailable. Your visit draft is unchanged. Search again when ready.';return;}
  const combined=more?[...vehicleRows,...page.vehicles]:page.vehicles;if(new Set(combined.map(row=>row.id)).size!==combined.length||page.hasMore&&!page.vehicles.length)throw Error();
  vehicleRows=combined;vehicleCursor=page.vehicles.at(-1)?.id??null;vehiclesMore=page.hasMore;message=page.vehicles.length?'Saved vehicles loaded. Adding a vehicle does not change ownership or authorize extra work.':'No matching saved vehicles found. Your visit draft is unchanged.';
 },unavailable);
 const addAgreement=(familyId:string)=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context||!quoteRows.some(row=>row.familyId===familyId))return;
  if(selected.some(row=>row.familyId===familyId)){message='This agreement is already available in this visit draft.';return;}
  const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();
  let current:Awaited<ReturnType<typeof scheduling.agreement>>|null=null;
  try{current=await api.agreement(next.context.businessId,familyId,proof,signal);live(signal);}
  catch(error){live(signal);if(error instanceof SchedulingClientError&&['denied','recovery'].includes(error.kind))throw error;}
  const checked=await fresh(signal);if(!same(next,checked.next))throw Error();context=checked.next;
  if(!current){message='Accepted work could not be checked. Your visit draft is unchanged. Check again when ready.';return;}
  if('state'in current||!current.sources.some(source=>source.parts.some(part=>part.state==='unassigned'))){message='This quote has no current unassigned accepted work. Your visit draft is unchanged.';return;}
  try{combineBookingWork([...selected,current],extraVehicles);}catch{message='The customer or vehicle records changed, or this agreement belongs to another customer. Your visit draft is unchanged. Reload current scope before using it.';return;}
  selected=[...selected,current];message='Accepted work added to the visit draft. Review the included scope and vehicles before saving.';
 },unavailable);
 const addVehicle=(vehicleId:string)=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context)return;const row=vehicleRows.find(row=>row.id===vehicleId&&row.business_id===context!.context.businessId&&row.archived_at===null);if(!row)return;
  const prior=context,{next}=await fresh(signal);if(!same(prior,next))throw Error();context=next;
  if(work().vehicles.some(vehicle=>vehicle.id===row.id)){message='This vehicle is already available in the visit draft.';return;}
  extraVehicles=[...extraVehicles,{id:row.id,label:row.label,version:row.version,archivedAt:row.archived_at}];message='Saved vehicle added to the draft. Ownership is unchanged; only selected accepted work may be performed.';
 },unavailable);
 const removeAgreement=(familyId:string)=>run(async signal=>{
  if(phase!=='ready'||!agreement||!context||familyId===agreement.familyId)return;const prior=context,{next}=await fresh(signal);if(!same(prior,next))throw Error();context=next;
  selected=selected.filter(row=>row.familyId!==familyId);message='Additional agreement removed from this draft. Its saved accepted work is unchanged.';
 },unavailable);
 function failedSave(error:unknown){
  if(error instanceof SchedulingClientError&&['input','not_submitted'].includes(error.kind)&&pending){
   try{deps.store.clear(pending);pending=null;clearPrivate();context=null;phase='review';message='The booking was not submitted. Reload current scope before preparing another request.';return;}catch{/* Retain an identity whose removal could not be verified. */}
  }
  // Preserve the unchanged original in memory for an explicit status-check/retry.
  const retainedOriginal=original;clearPrivate();original=retainedOriginal;phase='pending';message='Booking save outcome is unknown. Keep the original reference and check its status before another change.';
 }
 const save=(payload:BookingPayload)=>{
  if(active||phase!=='ready'||!agreement||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context;let parsed:BookingPayload,request:BookJobCommand;try{parsed=parseBookingPayload(payload,context.context.businessId);if(parsed.customerId!==agreement.customer.id||parsed.expectedCustomerVersion!==agreement.customer.version||parsed.operatorId!==context.context.operatorId)throw Error();const available=work();if(parsed.vehicles.some(row=>!available.vehicles.some(v=>v.id===row.vehicleId&&v.version===row.expectedVersion&&v.archivedAt===null)))throw Error();for(const plan of parsed.allocationPlans){const source=available.sources.find(source=>source.sourceAllocationId===plan.sourceAllocationId&&source.planSequence===plan.expectedSequence);if(!source)throw Error();validateScopeAllocationPlan({id:source.sourceAllocationId,grossInclusiveCents:source.grossInclusiveCents,discountInclusiveCents:source.discountInclusiveCents,amountCents:source.amountCents},plan.parts);}
   const common={businessId:prior.context.businessId,operationId:id(),jobId,recoveryEpoch:prior.context.recoveryEpoch,expectedModeSequence:prior.context.modeVersion?.sequence??'0'};
   const amended=available.agreements.some(row=>row.schemaVersion===2);if(amended&&!prior.amendedSchedulingAvailable)throw Error();
   request=parseBookJobCommand(amended?{...common,schemaVersion:2,payload:{...parsed,allocationPlans:parsed.allocationPlans.map(plan=>({...plan,entitlementVersionId:available.sources.find(source=>source.sourceAllocationId===plan.sourceAllocationId)!.entitlementVersionId}))}}:{...common,schemaVersion:1,payload:parsed});
  }
  catch{message='Review the vehicle, accepted work, location, actual times, travel and customer-confirmation fields. No booking was submitted.';emit();return Promise.resolve();}
  let submitted=false;
  return run(async signal=>{
   const {proof,next}=await fresh(signal);if(!same(prior,next)||deps.store.read()!==null||deps.blockers?.some(store=>store.read()!==null))throw Error();context=next;
   pending={schemaVersion:1,businessId:request.businessId,binding:context.binding,reference:{operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,jobId:request.jobId,expectedModeSequence:request.expectedModeSequence}};original=request;
   deps.store.write(pending);submitted=true;const result=await api.book(request,proof,signal);live(signal);finish(result);
  },error=>{if(submitted)failedSave(error);else if(pending){clearPrivate();context=null;phase='blocked';message='The booking reference could not be stored and verified. No booking was submitted. Review interrupted saves before trying again.';}else unavailable(error);});
 };
 const check=()=>run(async signal=>{
  if(phase!=='pending'||!pending)return;canRetry=false;savedJobId='';const {proof,next}=await fresh(signal);context=next;
  if(!eligible()){message='This original booking belongs to a different authenticated context. Return to that context for review.';return;}await inspect(proof,signal);
 },()=>{canRetry=false;message='The original booking could not be checked. Keep the reference and check again.';});
 const retry=()=>run(async signal=>{
  if(phase!=='pending'||!pending||!original||!canRetry)return;canRetry=false;const request=original,{proof,next}=await fresh(signal);context=next;
  if(!eligible()||next.context.writeState!=='ready'||next.context.recoveryEpoch!==request.recoveryEpoch)throw Error();deps.store.require(pending);
  const found=await lookup({schemaVersion:1,businessId:pending.businessId,commandType:'operations.job.book',reference:pending.reference},proof,signal);live(signal);
  if(found.state!=='absent'){if(!('jobId'in found.receipt)||!('version'in found.receipt)||found.receipt.version!=='1')throw Error();finish(found as Awaited<ReturnType<typeof api.book>>);return;}
  const result=await api.book(request,proof,signal);live(signal);finish(result);
 },failedSave);
 function suspend(){active?.abort();active=null;clearPrivate();context=null;phase=pending?'pending':'review';message=pending?'Private booking details cleared. Load and check the original request before continuing.':'Private booking form cleared. Reload current accepted scope before continuing.';emit();}
 return Object.freeze({view,load,save,check,retry,moreAddresses,findAgreements,findVehicles,addAgreement,addVehicle,removeAgreement,suspend,dispose(){alive=false;active?.abort();active=null;clearPrivate();context=null;}});
}
