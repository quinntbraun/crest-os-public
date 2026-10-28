import type {Proof} from './authentication';
import {businessSettings} from './business-settings';
import {customers} from './customers';
import {addresses} from './customer-addresses';
import {vehicles} from './vehicles';
import {services} from './services';
import {createPendingServiceStore} from './pending-service-edit';
import {associations} from './associations';
import {leadSources} from './lead-sources';
import {leads} from './leads';
import {leadStates} from './lead-states';
import {leadVehicles} from './lead-vehicles';
import {leadAddresses} from './lead-addresses';
import {leadConversions} from './lead-conversions';
import {createPendingEditStore} from './pending-business-edit';
import {createPendingCustomerStore} from './pending-customer-edit';
import {createPendingAddressStore} from './pending-address-edit';
import {createPendingVehicleStore} from './pending-vehicle-edit';
import {createPendingAssociationStore} from './pending-association-edit';
import {createPendingLeadSourceStore} from './pending-lead-source-edit';
import {createPendingLeadStore} from './pending-lead-edit';
import {createPendingLeadStateStore} from './pending-lead-state-edit';
import {createPendingLeadVehicleStore} from './pending-lead-vehicle-edit';
import {createPendingLeadAddressStore} from './pending-lead-address-edit';
import {createPendingLeadConversionStore} from './pending-lead-conversion';
import {parseOriginalOperationReference,parseOriginalOperationOutcome} from '../security/original-operation-reference';
import type {OriginalOperationKind,OriginalOperationReference} from '../security/original-operation-reference';

type StorageAccess=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Store<T>={read:()=>T|null;require:(value:T)=>void;clear:(value:T)=>void};
export class PendingOriginalOperationError extends Error{
 constructor(){super('PENDING_ORIGINAL_OPERATION_REVIEW_REQUIRED');this.name='PendingOriginalOperationError';}
}
export type PendingOriginalOperation=Readonly<{
 original:OriginalOperationReference;binding:string;
 requireCurrent:()=>void;
 releaseRetired:(outcome:unknown,signal:AbortSignal)=>void;
 reconcile:(proof:Proof,signal:AbortSignal)=>Promise<'committed'|'absent'>;
}>;

// Reuse each domain's exact pending store and typed receipt verifier. This
// adapter cannot write an intent, retry a command, or clear an absent lookup.
function target<T extends {businessId:string;binding:string}>(
 store:Store<T>,kind:OriginalOperationKind,businessId:string,
 reference:(value:T)=>unknown,
 lookup:(value:T,proof:Proof,signal:AbortSignal)=>Promise<Readonly<{state:'committed'|'absent'}>>
):PendingOriginalOperation|null{
 try{
  const pinned=store.read();if(pinned===null)return null;
  const original=parseOriginalOperationReference({schemaVersion:1,businessId:pinned.businessId,commandType:kind,reference:reference(pinned)});
  if(original.businessId!==businessId)throw new Error();
  const requireCurrent=()=>{try{store.require(pinned);}catch{throw new PendingOriginalOperationError();}};
  const live=(signal:AbortSignal)=>{if(signal.aborted)throw new PendingOriginalOperationError();requireCurrent();};
  const clear=(signal:AbortSignal)=>{live(signal);store.clear(pinned);if(store.read()!==null)throw new PendingOriginalOperationError();};
  return Object.freeze({original,binding:pinned.binding,requireCurrent,
   releaseRetired(outcome:unknown,signal:AbortSignal){
    try{live(signal);if(parseOriginalOperationOutcome(outcome,original).state!=='retired')throw new Error();clear(signal);}
    catch{throw new PendingOriginalOperationError();}
   },
   async reconcile(proof:Proof,signal:AbortSignal):Promise<'committed'|'absent'>{
    try{
     live(signal);const result=await lookup(pinned,proof,signal);live(signal);
     if(result.state==='committed'){clear(signal);return 'committed';}
     if(result.state!=='absent')throw new Error();return 'absent';
    }catch{throw new PendingOriginalOperationError();}
   }
  });
 }catch{throw new PendingOriginalOperationError();}
}
export function openPendingOriginalOperation(kind:OriginalOperationKind,storage:StorageAccess,businessId:string):PendingOriginalOperation|null{
 switch(kind){
  case 'business.rename':return target(createPendingEditStore(storage),kind,businessId,p=>({operationId:p.command.operationId,recoveryEpoch:p.command.recoveryEpoch,expectedVersion:p.command.expectedVersion}),(p,proof,signal)=>businessSettings.lookup(p.businessId,p.command,proof,signal));
  case 'crm.customer.save':return target(createPendingCustomerStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>customers.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.address.save':return target(createPendingAddressStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>addresses.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.vehicle.save':return target(createPendingVehicleStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>vehicles.lookup(p.businessId,p.reference,proof,signal));
  case 'catalog.service.save':return target(createPendingServiceStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>services.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.vehicle.association':return target(createPendingAssociationStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>associations.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.source.save':return target(createPendingLeadSourceStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leadSources.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.save':return target(createPendingLeadStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leads.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.state':return target(createPendingLeadStateStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leadStates.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.vehicle.save':return target(createPendingLeadVehicleStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leadVehicles.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.address.save':return target(createPendingLeadAddressStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leadAddresses.lookup(p.businessId,p.reference,proof,signal));
  case 'crm.lead.convert':return target(createPendingLeadConversionStore(storage),kind,businessId,p=>p.reference,(p,proof,signal)=>leadConversions.lookup(p.businessId,p.reference,proof,signal));
  default:throw new PendingOriginalOperationError();
 }
}
