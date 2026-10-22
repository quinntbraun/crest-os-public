import {authentication} from './authentication';
import type {Proof} from './authentication';
import {businessSettings,BusinessSettingsError,legalName} from './business-settings';
import type {Snapshot,RenameResult} from './business-settings';
import {pendingEdit,PendingEditError} from './pending-business-edit';
import type {PendingEdit,createPendingEditStore} from './pending-business-edit';
export type SettingsView=Readonly<{phase:'loading'|'ready'|'review'|'pending'|'unavailable'|'blocked';message:string;busy:boolean;draft:string;currentName:string;canSave:boolean;canRetry:boolean;reference:string}>;
export const initialSettingsView:SettingsView=Object.freeze({phase:'loading',message:'Checking business settings…',busy:true,draft:'',currentName:'',canSave:false,canRetry:false,reference:''});
type Dependencies={store:ReturnType<typeof createPendingEditStore>;change:(view:SettingsView)=>void;api?:typeof businessSettings;session?:typeof authentication.session;id?:()=>string};
export function createBusinessSettingsController(deps:Dependencies){
  const api=deps.api??businessSettings,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
  let alive=true,active:AbortController|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingEdit|null=null;
  let phase:SettingsView['phase']='loading',message=initialSettingsView.message,draft='',reviewDraft:string|undefined,canRetry=false;
  const view=():SettingsView=>Object.freeze({phase,message,busy:!!active,draft:phase==='ready'?draft:'',currentName:phase==='ready'?snapshot?.context.legalName??'':'',
    canSave:!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&legalName(draft)&&draft!==snapshot.context.legalName,canRetry:!active&&canRetry,
    reference:phase==='pending'&&snapshot?.context.businessId===pending?.businessId?pending?.command.operationId??'':''});
  const emit=()=>{if(alive)deps.change(view());};
  const live=(signal:AbortSignal)=>{if(!alive||signal.aborted)throw new Error();};
  async function fresh(signal:AbortSignal){
    const current=await session(signal);live(signal);const next=await api.settings(current,signal);live(signal);proof=current;snapshot=next;
  }
  const eligible=()=>!!pending&&!!snapshot&&snapshot.context.businessId===pending.businessId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.command.recoveryEpoch;
  const retain=(text:string)=>{phase='pending';message=text;canRetry=false;};
  function finish(result:RenameResult,fromLookup=false){
    if(!pending)throw new Error();
    if(result.state==='conflict'&&result.reason==='operation'){retain('This save reference does not match the recorded request. Keep it for review; no replacement will be sent.');return;}
    const committed=result.state==='committed';
    try{deps.store.clear(pending);}catch{retain(committed?'Save confirmed, but its local reference could not be cleared. Check save status before another edit.':'The change was not saved, but its local reference could not be cleared. Check save status before another edit.');return;}
    reviewDraft=committed?undefined:pending.command.legalName;pending=null;proof=null;snapshot=null;phase='review';canRetry=false;
    message=committed?(fromLookup?'Save reference confirmed. Load current settings to review the recorded result.':'Business name saved. Load current settings before another edit.'):'Another change was saved first. Load current settings and review your proposed name before saving again.';
  }
  async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
    if(!alive||active)return;const controller=new AbortController();active=controller;emit();
    try{await work(controller.signal);}catch(error){if(alive)failure(error);}finally{if(active===controller)active=null;emit();}
  }
  const load=()=>run(async signal=>{
    phase='loading';message='Checking business settings…';proof=null;snapshot=null;canRetry=false;emit();pending=deps.store.read();await fresh(signal);
    if(pending){
      if(pending.businessId!==snapshot!.context.businessId){phase='blocked';message='A pending save belongs to a different business. Its record has been kept for review.';return;}
      retain('A pending save was found. Check its status before making another change.');return;
    }
    draft=reviewDraft??snapshot!.context.legalName;reviewDraft=undefined;phase='ready';message=snapshot!.context.writeState==='paused'?'Business changes are paused. You can review the current name.':'Review the current name, then save your change.';
  },error=>{proof=null;snapshot=null;canRetry=false;phase=error instanceof PendingEditError?'blocked':'unavailable';message=error instanceof PendingEditError?'The pending-save record cannot be read. Saving is blocked to keep its reference safe.':'Business settings could not be verified. Sign in or check again; any pending save has been kept.';});
  const check=()=>run(async signal=>{
    pending=deps.store.read();if(!pending)throw new PendingEditError();retain('Checking save status…');emit();await fresh(signal);
    if(snapshot!.context.businessId!==pending.businessId){phase='blocked';message='This pending save belongs to a different business. It will not be sent here.';return;}
    const result=await api.lookup(pending.businessId,pending.command,proof!,signal);live(signal);
    if(result.state==='committed'){finish(result,true);return;}
    canRetry=eligible();phase='pending';message=canRetry?'No completed save was found. That does not prove an earlier request failed. You may explicitly retry the original change.':
      snapshot!.binding!==pending.binding?'No completed save was found for this account. This request belongs to an earlier sign-in and needs review before retry.':
        'No completed save was found. Recovery changed or writes are paused. The original request has been kept for review.';
  },()=>{retain('Save status could not be confirmed. The original request has been kept. Check again before another action.');proof=null;snapshot=null;});
  function writeFailure(error:unknown,first:boolean,dispatched:boolean){
    if(!dispatched){phase='blocked';message='The pending-save record could not be secured. No change was sent.';canRetry=false;return;}
    const kind=error instanceof BusinessSettingsError?error.kind:'unknown';
    if(first&&['input','not_submitted','denied'].includes(kind)&&pending){
      try{deps.store.clear(pending);reviewDraft=pending.command.legalName;pending=null;proof=null;snapshot=null;phase='review';message='This change was not submitted. Load current settings and review before trying again.';canRetry=false;return;}catch{/* retain a reference that cannot be cleared */}
    }
    retain(kind==='recovery'?'Recovery review is required. The original request has been kept; it will not be updated or retried automatically.':
      kind==='limited'?'Requests are temporarily limited. Keep this pending save and check its status later.':'The save could not be confirmed. Check save status before another action.');
  }
  const save=()=>{
    if(!view().canSave||!snapshot||!proof)return Promise.resolve();
    const original=snapshot,currentProof=proof,name=draft;let dispatched=false;
    return run(async signal=>{
      const value=pendingEdit({journalSchema:1,businessId:original.context.businessId,binding:original.binding,command:{schemaVersion:1,operationId:id(),recoveryEpoch:original.context.recoveryEpoch,expectedVersion:original.context.businessVersion,legalName:name}});
      deps.store.write(value);pending=value;retain('Saving business name…');emit();dispatched=true;
      const result=await api.rename(value.businessId,value.command,currentProof,signal);live(signal);finish(result);
    },error=>writeFailure(error,true,dispatched));
  };
  const retry=()=>{
    if(!view().canRetry||!pending)return Promise.resolve();const original=pending;let dispatched=false;
    return run(async signal=>{
      canRetry=false;retain('Rechecking before retrying the original change…');emit();deps.store.require(original);await fresh(signal);
      if(!eligible()){retain('The sign-in or recovery context changed. The original request needs review and was not sent.');return;}
      deps.store.require(original);dispatched=true;const result=await api.rename(original.businessId,original.command,proof!,signal);live(signal);finish(result);
    },error=>{if(!dispatched)retain('The original request could not be reverified. Check save status again; nothing was retried.');else writeFailure(error,false,true);});
  };
  return Object.freeze({load,save,check,retry,
    edit(value:string){if(alive&&!active&&phase==='ready'){draft=value;emit();}},
    reviewOnReturn(){if(alive&&!active&&phase==='ready'){reviewDraft=draft;proof=null;snapshot=null;phase='review';message='Review current settings before continuing after returning to this tab.';emit();}},
    dispose(){alive=false;active?.abort();active=null;proof=null;snapshot=null;},view
  });
}
