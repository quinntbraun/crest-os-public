import {authentication} from './authentication';
import {businessSettings} from './business-settings';
import type {Snapshot} from './business-settings';
import {originalOperations} from './original-operations';
import {openPendingOriginalOperation} from './pending-original-operation';
import type {PendingOriginalOperation} from './pending-original-operation';
import {parseOriginalOperationRetirement} from '../security/original-operation-reference';
import type {OriginalOperationKind,OriginalOperationOutcome,OriginalOperationRetirement} from '../security/original-operation-reference';

type Phase='idle'|'review'|'confirm'|'pending'|'retired'|'recorded'|'complete'|'blocked';
export type OriginalOperationReviewView=Readonly<{
 phase:Phase;busy:boolean;message:string;reference:string;reason:string;
 canReview:boolean;canRetire:boolean;canLookup:boolean;canReconcile:boolean;canAcknowledge:boolean;
}>;
export const initialOriginalOperationReviewView:OriginalOperationReviewView=Object.freeze({
 phase:'idle',busy:false,message:'Review the interrupted save before deciding how to resolve it.',reference:'',reason:'',
 canReview:false,canRetire:false,canLookup:false,canReconcile:false,canAcknowledge:false
});
type Dependencies={
 kind:OriginalOperationKind;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
 change:(value:OriginalOperationReviewView)=>void;resolved:()=>void;
 session?:typeof authentication.session;settings?:typeof businessSettings.settings;api?:typeof originalOperations;
};
export function createOriginalOperationReviewController(deps:Dependencies){
 const session=deps.session??authentication.session,settings=deps.settings??businessSettings.settings,api=deps.api??originalOperations;
 let alive=true,active:AbortController|null=null,target:PendingOriginalOperation|null=null,snapshot:Snapshot|null=null;
 let phase:Phase='idle',message=initialOriginalOperationReviewView.message,reason='',intent:OriginalOperationRetirement|null=null,outcome:OriginalOperationOutcome|null=null;
 const validReason=()=>{try{if(!target||snapshot?.context.writeState!=='ready')return false;parseOriginalOperationRetirement({schemaVersion:1,original:target.original,recoveryEpoch:snapshot.context.recoveryEpoch,reason});return true;}catch{return false;}};
 const view=():OriginalOperationReviewView=>Object.freeze({
  phase,busy:active!==null,message,reference:target?.original.reference.operationId??'',reason:['review','confirm'].includes(phase)?reason:'',
  canReview:!active&&phase==='review'&&validReason(),canRetire:!active&&phase==='confirm'&&intent!==null,
  canLookup:!active&&target!==null&&!['complete','blocked'].includes(phase),canReconcile:!active&&phase==='recorded',
  canAcknowledge:!active&&phase==='retired'&&outcome?.state==='retired'
 });
 const emit=()=>{if(alive)deps.change(view());};
 const clearPrivate=()=>{reason='';intent=null;outcome=null;snapshot=null;};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw new Error();};
 async function fresh(signal:AbortSignal){
  const proof=await session(signal);live(signal);const next=await settings(proof,signal);live(signal);
  if(target&&next.context.businessId!==target.original.businessId)throw new Error();
  target?.requireCurrent();return {proof,snapshot:next};
 }
 function retained(text:string){clearPrivate();phase='pending';message=text;}
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  if(!alive||active)return;const controller=new AbortController();active=controller;emit();
  try{await work(controller.signal);}
  catch{if(alive&&!controller.signal.aborted&&active===controller)retained('The outcome could not be verified. The original reference has been kept. Check its resolution before another action.');}
  finally{if(active===controller){active=null;emit();}}
 }
 function show(value:Awaited<ReturnType<typeof originalOperations.lookup>>){
  clearPrivate();
  if(value.state==='retired'){outcome=value;phase='retired';message='The original save is retired and cannot run later. Confirm this result to release its local reference.';}
  else if(value.state==='original_recorded'){phase='recorded';message='The original request was recorded. Verify its original save receipt before releasing its reference.';}
  else{phase='pending';message=value.state==='absent'?'No recorded resolution was found. This does not prove the earlier save failed. Keep its reference or explicitly review retirement.':'This reference conflicts with a recorded request. Keep it for review; it has not been released.';}
 }
 const load=()=>run(async signal=>{
  clearPrivate();phase='idle';message='Checking current access and the original save reference…';emit();
  const current=await fresh(signal);live(signal);
  const opened=openPendingOriginalOperation(deps.kind,deps.storage,current.snapshot.context.businessId);
  if(!opened){target=null;phase='complete';message='No pending reference was found. Load the original screen to review current records.';return;}
  // A pinned reference is never replaced while reviewing its resolution.
  if(target&&JSON.stringify(target.original)!==JSON.stringify(opened.original))throw new Error();
  target=opened;snapshot=current.snapshot;phase='review';
  message=snapshot.context.writeState==='ready'?'Retirement keeps an audited reason and prevents this original save from running. It does not undo a completed save. Review the reference and enter a reason.':'Changes are paused. You may check the original resolution or verify a recorded save; retirement is unavailable.';
 });
 const review=()=>{if(!view().canReview||!target||!snapshot)return Promise.resolve();const previous=snapshot;
  return run(async signal=>{
   const current=await fresh(signal);live(signal);
   if(!sameAuthority(previous,current.snapshot)){retained('Access or recovery changed. Load the review again before deciding; nothing was submitted.');return;}
   intent=parseOriginalOperationRetirement({schemaVersion:1,original:target!.original,recoveryEpoch:current.snapshot.context.recoveryEpoch,reason});
   snapshot=current.snapshot;phase='confirm';message='Confirm retirement of this exact original save with the reason shown. A completed original save will require its original receipt instead.';
  });
 };
 const retire=()=>{if(!view().canRetire||!target||!snapshot||!intent)return Promise.resolve();const reviewed=intent,previous=snapshot;
  return run(async signal=>{
   const current=await fresh(signal);live(signal);
   if(!sameAuthority(previous,current.snapshot)){retained('Access or recovery changed after review. Nothing was submitted. Load and review again.');return;}
   target!.requireCurrent();phase='pending';message='Submitting the reviewed retirement…';emit();
   const value=await api.retire(reviewed,current.proof,signal);live(signal);target!.requireCurrent();show(value);
  });
 };
 const lookup=()=>{if(!view().canLookup||!target)return Promise.resolve();
  return run(async signal=>{clearPrivate();phase='pending';message='Checking the original resolution…';emit();const current=await fresh(signal);const value=await api.lookup(target!.original,current.proof,signal);live(signal);target!.requireCurrent();show(value);});
 };
 const reconcile=()=>{if(!view().canReconcile||!target)return Promise.resolve();
  return run(async signal=>{
   clearPrivate();phase='pending';message='Verifying the original save receipt…';emit();const current=await fresh(signal);live(signal);
   const result=await target!.reconcile(current.proof,signal);live(signal);
   if(result==='committed'){target=null;phase='complete';message='The original save receipt is verified and its local reference is released. Load current records to review the saved result.';deps.resolved();}
   else retained('The original receipt could not be found. Its reference has been kept. Check the resolution again before another action.');
  });
 };
 function acknowledge(){
  if(!view().canAcknowledge||!target||!outcome)return;
  const controller=new AbortController();active=controller;
  try{target.releaseRetired(outcome,controller.signal);clearPrivate();target=null;phase='complete';message='The retired save reference is released. Load current records before starting another change.';deps.resolved();}
  catch{retained('Retirement is recorded, but local reference removal could not be confirmed. Keep it and check the resolution again.');}
  finally{active=null;emit();}
 }
 function suspend(){if(!alive)return;active?.abort();active=null;clearPrivate();target=null;phase='pending';message='Private review details were cleared. Load the original save review before continuing.';emit();}
 return Object.freeze({view,load,review,retire,lookup,reconcile,acknowledge,suspend,
  editReason(value:string){if(alive&&!active&&phase==='review'){reason=value.slice(0,4001);intent=null;emit();}},
  back(){if(alive&&!active&&phase==='confirm'){intent=null;phase='review';message='Review the reason before confirming retirement.';emit();}},
  dispose(){alive=false;active?.abort();active=null;clearPrivate();target=null;}
 });
}
function sameAuthority(a:Snapshot,b:Snapshot){
 return a.context.businessId===b.context.businessId&&a.binding===b.binding&&a.context.writeState==='ready'&&b.context.writeState==='ready'&&a.context.recoveryEpoch===b.context.recoveryEpoch;
}
