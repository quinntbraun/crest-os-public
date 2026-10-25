import {authentication} from './authentication';
import type {Proof} from './authentication';
import {leads} from './leads';
import {leadVehicles} from './lead-vehicles';
import {leadAddresses} from './lead-addresses';
import {leadConversions,LeadConversionClientError} from './lead-conversions';
import {customerUuid as uuid,requireCustomer as checkValue,parseCustomer} from '../customer/customer-contract';
import type {Customer,CustomerDraft} from '../customer/customer-contract';
import {parseVehicle} from '../customer/vehicle-contract';
import type {Vehicle} from '../customer/vehicle-contract';
import {parseCustomerAddress} from '../customer/customer-address-contract';
import type {CustomerAddress} from '../customer/customer-address-contract';
import type {AddressDraft,VehicleDraft} from '../customer/customer-resource-contract';
import type {Lead} from '../customer/lead-contract';
import type {LeadVehicle} from '../customer/lead-vehicle-contract';
import type {LeadAddress} from '../customer/lead-address-contract';
import {newConversionVehicle,newConversionAddress} from '../customer/lead-conversion-contract';
import type {LeadConversion,ConversionTarget} from '../customer/lead-conversion-contract';
import {prepareLeadConversionReview} from '../customer/lead-conversion-preview';
import {leadConversionToWire} from '../customer/lead-conversion-command-contract';
import {pendingLeadConversion,PendingLeadConversionError} from './pending-lead-conversion';
import type {PendingLeadConversion,createPendingLeadConversionStore} from './pending-lead-conversion';
import type {LeadConversionRecord,ConversionLink} from '../customer/lead-conversion-record';
type Snapshot=Awaited<ReturnType<typeof leads.context>>;
type VehicleChoice=Readonly<{source:LeadVehicle;linkId:string;target:ConversionTarget<VehicleDraft>|null;destination:Vehicle|null}>;
type AddressChoice=Readonly<{source:LeadAddress;linkId:string;target:ConversionTarget<AddressDraft>|null;destination:CustomerAddress|null}>;
export type LeadConversionEditorView=Readonly<{
 phase:'idle'|'loading'|'ready'|'recorded'|'pending'|'review'|'blocked'|'unavailable';busy:boolean;message:string;locked:boolean;
 lead:Lead|null;customer:ConversionTarget<CustomerDraft>|null;customerImage:Customer|null;
 vehicleRows:readonly LeadVehicle[];vehicleMore:boolean;addressRows:readonly LeadAddress[];addressMore:boolean;
 vehicles:readonly VehicleChoice[];addresses:readonly AddressChoice[];reviewed:LeadConversion|null;issue:string;
 canSave:boolean;canRetry:boolean;writesPaused:boolean;reference:string;record:LeadConversionRecord|null;links:readonly ConversionLink[];linksMore:boolean;
}>;
export const initialLeadConversionEditorView:LeadConversionEditorView=Object.freeze({phase:'idle',busy:false,message:'Load conversion details to review this lead. Conversion alone does not mark it Won.',locked:false,lead:null,customer:null,customerImage:null,vehicleRows:[],vehicleMore:false,addressRows:[],addressMore:false,vehicles:[],addresses:[],reviewed:null,issue:'',canSave:false,canRetry:false,writesPaused:true,reference:'',record:null,links:[],linksMore:false});
type ReadStore={read:()=>unknown};
type Dependencies={businessId:string;leadId:string|null;store:ReturnType<typeof createPendingLeadConversionStore>;intakeStore:ReadStore;statusStore:ReadStore;vehicleStore:ReadStore;addressStore:ReadStore;change:(view:LeadConversionEditorView)=>void;committed?:(leadId:string)=>void;api?:typeof leadConversions;leadApi?:Pick<typeof leads,'context'|'history'>;vehiclesApi?:Pick<typeof leadVehicles,'list'>;addressesApi?:Pick<typeof leadAddresses,'list'>;session?:typeof authentication.session;id?:()=>string};
export function createLeadConversionEditorController(deps:Dependencies){
 checkValue(uuid(deps.businessId)&&(deps.leadId===null||uuid(deps.leadId)));
 const businessId=deps.businessId,leadId=deps.leadId,api=deps.api??leadConversions,leadApi=deps.leadApi??leads,vApi=deps.vehiclesApi??leadVehicles,aApi=deps.addressesApi??leadAddresses,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,activeSignal:AbortSignal|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingLeadConversion|null=null,original:LeadConversion|null=null;
 let phase:LeadConversionEditorView['phase']='idle',message=initialLeadConversionEditorView.message,lead:Lead|null=null,customer:ConversionTarget<CustomerDraft>|null=null,customerImage:Customer|null=null,vehicleRows:readonly LeadVehicle[]=[],addressRows:readonly LeadAddress[]=[],vehicleMore=false,addressMore=false,vehicles:readonly VehicleChoice[]=[],addresses:readonly AddressChoice[]=[],reviewed:LeadConversion|null=null,issue='',canRetry=false,record:LeadConversionRecord|null=null,links:readonly ConversionLink[]=[],linksMore=false;
 const siblingsClear=()=>{try{return [deps.intakeStore,deps.statusStore,deps.vehicleStore,deps.addressStore].every(s=>s.read()===null);}catch{return false;}};
 const hasDraft=()=>customer!==null||vehicles.length>0||addresses.length>0;
 function clearPrivate(){proof=null;snapshot=null;lead=null;customer=null;customerImage=null;vehicleRows=[];addressRows=[];vehicles=[];addresses=[];vehicleMore=false;addressMore=false;reviewed=null;original=null;issue='';canRetry=false;record=null;links=[];linksMore=false;}
 const view=():LeadConversionEditorView=>Object.freeze({phase,busy:!!active,message,locked:!!active||!!pending||hasDraft()||phase==='blocked'||phase==='pending',lead,customer,customerImage,vehicleRows,vehicleMore,addressRows,addressMore,vehicles,addresses,reviewed,issue,canSave:!active&&phase==='ready'&&reviewed!==null&&snapshot?.context.writeState==='ready'&&siblingsClear(),canRetry:!active&&canRetry,writesPaused:snapshot?.context.writeState!=='ready',reference:pending?.businessId===businessId?pending.reference.operationId:'',record,links,linksMore});
 const emit=()=>{if(alive)deps.change(view());};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||activeSignal!==signal)throw new Error();};
 async function fresh(signal:AbortSignal){const p=await session(signal);live(signal);const next=await leadApi.context(p,signal);live(signal);checkValue(next.context.businessId===businessId);proof=p;snapshot=next;}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
  if(!alive||active)return;const c=new AbortController(),signal=AbortSignal.any([c.signal,AbortSignal.timeout(45000)]);active=c;activeSignal=signal;emit();
  try{await work(signal);}catch(error){if(alive&&active===c&&!c.signal.aborted)failure(error);}finally{if(active===c){active=null;activeSignal=null;emit();}}
 }
 function retain(text:string){phase='pending';message=text;lead=null;customer=null;customerImage=null;vehicleRows=[];addressRows=[];vehicles=[];addresses=[];reviewed=null;record=null;links=[];linksMore=false;canRetry=false;}
 function eligible(){return siblingsClear()&&!!pending&&!!original&&!!snapshot&&pending.businessId===businessId&&pending.reference.leadId===leadId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&original.operationId===pending.reference.operationId&&original.conversionId===pending.reference.conversionId&&original.leadId===pending.reference.leadId&&original.expectedLeadVersion===pending.reference.expectedLeadVersion&&original.customer.id===pending.reference.customerId&&original.recoveryEpoch===pending.reference.recoveryEpoch;}
 try{pending=deps.store.read();if(pending){phase=pending.businessId===businessId?'pending':'blocked';message=pending.businessId===businessId?'An original conversion is pending. Check its outcome before another edit.':'A conversion reference belongs to another business. It has been kept for review.';}}catch{phase='blocked';message='The conversion reference cannot be read. Editing is blocked to protect it.';}
 const load=()=>run(async signal=>{
  clearPrivate();phase='loading';pending=deps.store.read();emit();await fresh(signal);
  if(pending){retain('An original conversion is pending. Check its outcome before another edit.');if(pending.businessId!==businessId){phase='blocked';message='This reference belongs to another business. It will not be checked or sent here.';}return;}
  if(!siblingsClear()){phase='blocked';message='Resolve the original intake, status, vehicle or address change before preparing a conversion.';return;}
  if(!leadId){phase='review';message='Choose an existing lead before preparing a conversion.';return;}
  const history=await leadApi.history(businessId,{leadId,afterVersion:'0',pageSize:5},proof!,signal);live(signal);if(history.state==='absent'){phase='review';message='This lead was not found. Load current leads.';return;}lead=history.lead;
  const prior=await api.read(businessId,leadId,proof!,signal);live(signal);if(prior.state==='found'){record=prior.conversion;phase='recorded';message='This lead was already converted. Its original customer and mappings are retained.';const page=await api.links(businessId,{leadId,conversionId:record.id,afterId:null,pageSize:10},proof!,signal);live(signal);checkValue(page.state==='found'&&page.conversion.id===record.id);links=page.links;linksMore=page.hasMore;return;}
  const pages=await Promise.all([vApi.list(businessId,{leadId,afterId:null,includeArchived:false,pageSize:10},proof!,signal),aApi.list(businessId,{leadId,afterId:null,includeArchived:false,pageSize:10},proof!,signal)]);live(signal);checkValue(pages.every(p=>p.state==='found'&&p.leadVersion===lead!.version));const [v,a]=pages;checkValue(v.state==='found'&&a.state==='found');vehicleRows=v.leadVehicles;vehicleMore=v.hasMore;addressRows=a.leadAddresses;addressMore=a.hasMore;phase='ready';message=snapshot!.context.writeState==='ready'?'Explicitly choose the customer and any reported vehicles or locations to convert. Unselected evidence stays on the lead.':'Conversions are paused. You can review retained intake.';
 },error=>{clearPrivate();phase=error instanceof PendingLeadConversionError?'blocked':'unavailable';message=error instanceof PendingLeadConversionError?'The original conversion reference cannot be read. Editing remains blocked to protect it.':'Conversion details could not be verified. Reload them; any original reference has been kept.';});
 const moreVehicles=()=>sourcePage('vehicle'),moreAddresses=()=>sourcePage('address');
 function sourcePage(kind:'vehicle'|'address'){
  if(active||phase!=='ready'||!leadId||!lead||!proof||!(kind==='vehicle'?vehicleMore:addressMore))return Promise.resolve();const version=lead.version,authorization=proof;
  return run(async signal=>{const afterId=(kind==='vehicle'?vehicleRows:addressRows).at(-1)?.id??null;const page=kind==='vehicle'?await vApi.list(businessId,{leadId,afterId,includeArchived:false,pageSize:10},authorization,signal):await aApi.list(businessId,{leadId,afterId,includeArchived:false,pageSize:10},authorization,signal);live(signal);checkValue(page.state==='found'&&page.leadVersion===version);if('leadVehicles' in page){vehicleRows=page.leadVehicles;vehicleMore=page.hasMore;}else{addressRows=page.leadAddresses;addressMore=page.hasMore;}message='Source page loaded. Earlier explicit selections remain in your review.';},()=>{clearPrivate();phase='review';message='The lead or source pages changed. Reload before preparing a new conversion.';});
 }
 const editable=()=>alive&&!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&siblingsClear();
 function changed(){reviewed=null;issue='';message='Review the complete selection before converting.';emit();}
 function selectCustomer(target:ConversionTarget<CustomerDraft>,image:Customer|null){
  if(!editable()||!lead)return;if(lead.customer_id!==null&&(target.kind!=='existing'||target.id!==lead.customer_id)){message='This lead already links to a customer. Choose that same customer; repair intake separately before changing the link.';emit();return;}
  if(addresses.some(a=>a.target?.kind==='existing'&&(target.kind!=='existing'||a.destination?.customer_id!==target.id))){message='Remove or remap the existing customer addresses before choosing another customer.';emit();return;}customer=target;customerImage=image;changed();
 }
 function choiceError(){issue='Review the explicit target fields, matching customer and current source before selecting it.';emit();}
 function toggle(kind:'vehicle'|'address',sourceId:string,selected:boolean){
  if(!editable())return;if(selected&&vehicles.length+addresses.length>=1000){issue='This complete selection exceeds the supported request size. Nothing has been converted.';emit();return;}
  if(kind==='vehicle'){const row=vehicleRows.find(r=>r.id===sourceId);if(selected){if(!row||vehicles.some(v=>v.source.id===sourceId))return;vehicles=Object.freeze([...vehicles,Object.freeze({source:row,linkId:id(),target:null,destination:null})]);}else vehicles=Object.freeze(vehicles.filter(v=>v.source.id!==sourceId));}
  else{const row=addressRows.find(r=>r.id===sourceId);if(selected){if(!row||addresses.some(a=>a.source.id===sourceId))return;addresses=Object.freeze([...addresses,Object.freeze({source:row,linkId:id(),target:null,destination:null})]);}else addresses=Object.freeze(addresses.filter(a=>a.source.id!==sourceId));}changed();
 }
 function review(){
  if(!editable()||!lead||!snapshot||reviewed)return;
  try{
   checkValue(customer!==null&&vehicles.every(v=>v.target!==null)&&addresses.every(a=>a.target!==null));
   const command:LeadConversion={schemaVersion:1,businessId,operationId:id(),conversionId:id(),leadId:lead.id,expectedLeadVersion:lead.version,recoveryEpoch:snapshot.context.recoveryEpoch!,customer,vehicles:vehicles.map(v=>({linkId:v.linkId,leadVehicleId:v.source.id,expectedLeadVehicleVersion:v.source.version,target:v.target!})),addresses:addresses.map(a=>({linkId:a.linkId,leadAddressId:a.source.id,expectedLeadAddressVersion:a.source.version,target:a.target!}))};
   const unique=<T extends {id:string}>(rows:readonly T[])=>Array.from(new Map(rows.map(r=>[r.id,r])).values());
   reviewed=prepareLeadConversionReview(command,lead,vehicles.map(v=>v.source),addresses.map(a=>a.source),{customer:customerImage,vehicles:unique(vehicles.flatMap(v=>v.destination?[v.destination]:[])),addresses:unique(addresses.flatMap(a=>a.destination?[a.destination]:[]))}).command;leadConversionToWire(reviewed);issue='';message='Review every selected source, destination and version. Confirming creates this complete conversion together; it does not mark Won or establish ownership.';
  }catch{reviewed=null;issue='Choose a valid customer and destination for every selected report/location. Review field lengths, exact values and complete request size. Nothing has been sent.';}emit();
 }
 function finish(result:Awaited<ReturnType<typeof leadConversions.convert>>,lookup=false){
  if(!pending)throw new Error();if(result.state==='conflict'&&result.reason==='operation'){original=null;retain('The original conversion reference conflicts with a recorded request. Keep it for review; a replacement is blocked.');return;}
  const convertedLead=pending.reference.leadId;
  try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Conversion confirmed, but its reference could not be cleared. Check the original outcome again.':'No conversion was saved, but its reference could not be cleared. Keep it for review.');return;}
  pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original conversion is confirmed. Load current conversion details to review it.':'Conversion confirmed. Load current details to review the retained customer and mappings.'):'The lead, selected source or destination changed. Load current details and make a new explicit selection.';
  if(result.state==='committed')deps.committed?.(convertedLead);
 }
 function failed(error:unknown,first:boolean,dispatched:boolean){
 if(!dispatched){try{pending=deps.store.read();}catch{/* Keep the unreadable-reference block. */}clearPrivate();phase='blocked';message='The original conversion reference could not be secured. No conversion was sent.';return;}
  const kind=error instanceof LeadConversionClientError?error.kind:'unknown';
  if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The conversion was not submitted. Load current details before trying again.';return;}catch{/* Unconfirmed removal must retain the original reference. */}}
  retain(kind==='recovery'?'Recovery review is required. The original conversion reference and epoch have been kept.':'The conversion could not be confirmed. Check the original outcome before another edit.');
 }
 const save=()=>{
  if(!view().canSave||!reviewed||!snapshot)return Promise.resolve();const command=reviewed,before=snapshot;let checked=false,dispatched=false;
  return run(async signal=>{await fresh(signal);checked=true;if(snapshot!.binding!==before.binding||snapshot!.context.recoveryEpoch!==command.recoveryEpoch||snapshot!.context.writeState!=='ready'){clearPrivate();phase='review';message='Sign-in or recovery changed. No conversion was sent. Reload and review.';return;}if(!siblingsClear()){clearPrivate();phase='blocked';message='Another original change needs review. No conversion was sent.';return;}
   const record=pendingLeadConversion({schemaVersion:1,businessId,binding:before.binding,reference:{operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,conversionId:command.conversionId,leadId:command.leadId,expectedLeadVersion:command.expectedLeadVersion,customerId:command.customer.id}});deps.store.write(record);pending=record;original=command;retain('Converting the complete selection…');emit();deps.store.require(record);checkValue(siblingsClear());dispatched=true;const {businessId:unused,...input}=command;void unused;const result=await api.convert(businessId,input,proof!,signal);live(signal);finish(result);
  },error=>{if(!checked){clearPrivate();phase='unavailable';message='Conversion access could not be reverified. No conversion was sent.';}else failed(error,true,dispatched);});
 };
 const check=()=>run(async signal=>{
  pending=deps.store.read();if(!pending)throw new PendingLeadConversionError();retain('Checking the original conversion outcome…');emit();if(pending.businessId!==businessId){original=null;phase='blocked';message='This original reference belongs to another business. It will not be checked here.';return;}await fresh(signal);const result=await api.lookup(businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);if(result.state==='committed'){finish(result,true);return;}canRetry=eligible();message=canRetry?'No completed conversion was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original selection.':!original?'No completed conversion was found. The original draft is no longer in memory. Its reference is kept for review; replacement is blocked.':'The original sign-in, recovery, lead or another pending change prevents retry. Keep the original reference for review.';
 },()=>{retain('The original conversion outcome could not be verified. Keep its reference and check again.');proof=null;snapshot=null;});
 const retry=()=>{
  if(!view().canRetry||!pending||!original)return Promise.resolve();const reference=pending,command=original;let dispatched=false;
  return run(async signal=>{retain('Rechecking the unchanged original conversion…');emit();deps.store.require(reference);await fresh(signal);if(!eligible()){retain('The original conversion context is no longer eligible. Nothing was retried.');return;}deps.store.require(reference);dispatched=true;const {businessId:unused,...input}=command;void unused;const result=await api.convert(businessId,input,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failed(error,false,true);else retain('The original conversion reference could not be verified. Nothing was retried.');});
 };
 const moreLinks=()=>{
  if(active||phase!=='recorded'||!record||!linksMore||!proof)return Promise.resolve();const parent=record,authorization=proof,afterId=links.at(-1)?.id??null;
  return run(async signal=>{const page=await api.links(businessId,{leadId:parent.lead_id,conversionId:parent.id,afterId,pageSize:10},authorization,signal);live(signal);checkValue(page.state==='found'&&page.conversion.id===parent.id);links=page.links;linksMore=page.hasMore;message='Showing the next original mapping page.';},()=>{clearPrivate();phase='unavailable';message='Original mappings could not be verified. Load current conversion details again.';});
 };
 function suspend(){if(!alive)return;active?.abort();active=null;activeSignal=null;clearPrivate();phase=pending?'pending':'review';message='Private conversion details were cleared. Any original reference has been kept; load or check it before continuing.';emit();}
 return Object.freeze({load,moreVehicles,moreAddresses,review,save,check,retry,moreLinks,view,suspend,initialize:emit,
  chooseNewCustomer(){if(!editable()||!lead)return;selectCustomer(Object.freeze({kind:'new',id:id(),draft:Object.freeze({displayName:lead.label,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null})}),null);},
  chooseCustomer(image:Customer){if(!editable())return;try{const row=parseCustomer(image,businessId);checkValue(row.archived_at===null);selectCustomer({kind:'existing',id:row.id,expectedVersion:row.version},row);}catch{choiceError();}},
  editCustomer(draft:CustomerDraft){if(editable()&&customer?.kind==='new'){customer=Object.freeze({...customer,draft:Object.freeze({...draft})});changed();}},
  selectVehicle(sourceId:string,selected:boolean){toggle('vehicle',sourceId,selected);},selectAddress(sourceId:string,selected:boolean){toggle('address',sourceId,selected);},
  newVehicle(sourceId:string,kind:VehicleDraft['kind']){if(!editable()||!leadId)return;try{const choice=vehicles.find(v=>v.source.id===sourceId);checkValue(choice);const mapping=newConversionVehicle(choice.source,businessId,leadId,choice.linkId,id(),kind);vehicles=Object.freeze(vehicles.map(v=>v===choice?Object.freeze({...v,target:mapping.target,destination:null}):v));changed();}catch{choiceError();}},
  chooseVehicle(sourceId:string,image:Vehicle){if(!editable())return;try{const row=parseVehicle(image,businessId),choice=vehicles.find(v=>v.source.id===sourceId);checkValue(choice&&row.archived_at===null);vehicles=Object.freeze(vehicles.map(v=>v===choice?Object.freeze({...v,target:{kind:'existing' as const,id:row.id,expectedVersion:row.version},destination:row}):v));changed();}catch{choiceError();}},
  editVehicle(sourceId:string,draft:VehicleDraft){if(editable()){vehicles=Object.freeze(vehicles.map(v=>v.source.id===sourceId&&v.target?.kind==='new'?Object.freeze({...v,target:{...v.target,draft:Object.freeze({...draft})}}):v));changed();}},
  newAddress(sourceId:string){if(!editable()||!leadId)return;try{const choice=addresses.find(a=>a.source.id===sourceId);checkValue(choice);const mapping=newConversionAddress(choice.source,businessId,leadId,choice.linkId,id());addresses=Object.freeze(addresses.map(a=>a===choice?Object.freeze({...a,target:mapping.target,destination:null}):a));changed();}catch{choiceError();}},
  chooseAddress(sourceId:string,image:CustomerAddress){if(!editable()||customer?.kind!=='existing'){choiceError();return;}try{const row=parseCustomerAddress(image,businessId,customer.id),choice=addresses.find(a=>a.source.id===sourceId);checkValue(choice&&row.archived_at===null);addresses=Object.freeze(addresses.map(a=>a===choice?Object.freeze({...a,target:{kind:'existing' as const,id:row.id,expectedVersion:row.version},destination:row}):a));changed();}catch{choiceError();}},
  editAddress(sourceId:string,draft:AddressDraft){if(editable()){addresses=Object.freeze(addresses.map(a=>a.source.id===sourceId&&a.target?.kind==='new'?Object.freeze({...a,target:{...a.target,draft:Object.freeze({...draft})}}):a));changed();}},
  cancel(){if(alive&&!active&&!pending){try{if(deps.store.read()!==null)throw new Error();}catch{phase='blocked';message='An original reference needs review. It cannot be discarded here.';emit();return;}clearPrivate();phase='review';message='The unsubmitted conversion draft was cleared. No conversion was sent.';emit();}},
  dispose(){alive=false;active?.abort();active=null;activeSignal=null;clearPrivate();pending=null;}
 });
}
