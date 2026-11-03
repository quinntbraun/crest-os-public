import {authentication} from './authentication';
import {quotes} from './quotes';
import {quoteAmendments} from './quote-amendments';
import {createPendingQuoteAmendmentStore,pendingQuoteAmendment} from './pending-quote-amendment';
import {openPendingOriginalOperation} from './pending-original-operation';
import type {PendingOriginalOperation} from './pending-original-operation';
import {parseQuoteAmendmentTargets} from '../commercial/quote-amendment-targets';
import type {QuoteAmendmentTarget} from '../commercial/quote-amendment-targets';
import {parseQuoteAmendmentRead} from '../commercial/quote-amendment-read';
import type {QuoteAmendmentRead} from '../commercial/quote-amendment-read';
import {parseQuoteAmendmentDraft,quoteAmendmentDraftReference,bindQuoteAmendmentDraftReceipt} from '../commercial/quote-amendment-contract';
import {quoteInputFromSnapshots} from '../commercial/quote-storage-contract';
import {prepareQuoteReviewContent,quoteReviewReadiness} from '../commercial/quote-review-content';
import {parseQuoteSave,parseQuoteCommitted,quoteBodyLimit} from '../commercial/quote-storage-contract';
import {quoteDraftAuditBytes,quoteDraftAuditLimit} from '../commercial/quote-draft-budget';
import {copyQuoteDraft,quoteDraftFromContent,parseQuoteDraft,quoteDraftChanged,quoteDraftIssue,emptyQuoteLine,quoteLocationFromAddress} from './quote-draft';
import type {QuoteDraft} from './quote-draft';
import {createPendingQuoteStore,pendingQuote} from './pending-quote-edit';
import {vehicles} from './vehicles';
import {services} from './services';
import {addresses} from './customer-addresses';
import {quoteReview} from './quote-review';
import {createPendingQuoteReviewStore,pendingQuoteReview} from './pending-quote-review';
import {parseQuoteReviewSubmit,parseQuoteReviewApprove,parseQuoteReviewCommitted} from '../commercial/quote-review-contract';
import {parseQuoteAmendmentSend,quoteAmendmentSendReference,bindQuoteAmendmentSendReceipt} from '../commercial/quote-amendment-sharing-contract';
import type {QuoteManualSendBody} from '../commercial/quote-commercial-contract';
import {checkedAmendmentHistoryPage,sameAmendmentSource,collectAmendmentHistory} from '../commercial/quote-amendment-history';
import {buildAmendmentRecord} from '../commercial/quote-amendment-record';

type StorageAccess=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Saved=Exclude<QuoteAmendmentRead,{state:'absent'}>;
type Choices=Readonly<{vehicles:Awaited<ReturnType<typeof vehicles.list>>['vehicles'];services:Awaited<ReturnType<typeof services.list>>['services'];addresses:Awaited<ReturnType<typeof addresses.list>>['addresses'];vehicleSearch:string;serviceSearch:string;moreVehicles:boolean;moreServices:boolean;moreAddresses:boolean;addressesLoaded:boolean}>;
const emptyChoices=():Choices=>({vehicles:[],services:[],addresses:[],vehicleSearch:'',serviceSearch:'',moreVehicles:false,moreServices:false,moreAddresses:false,addressesLoaded:false});
export type QuoteAmendmentWorkspaceView=Readonly<{
 phase:'loading'|'ready'|'review'|'pending'|'blocked'|'unavailable';status:string;busy:boolean;
 rows:readonly QuoteAmendmentTarget[];selected:QuoteAmendmentTarget|null;amendment:Saved|null;
 search:string;hasMore:boolean;canCreate:boolean;canLookup:boolean;writesPaused:boolean;
 draft:QuoteDraft|null;dirty:boolean;draftIssue:string;canEdit:boolean;canSave:boolean;
 choices:Choices;
 canSubmit:boolean;canApprove:boolean;canSend:boolean;hasExtreme:boolean;reviewIssue:string;
 canReadHistory:boolean;
}>;
export const initialQuoteAmendmentWorkspaceView:QuoteAmendmentWorkspaceView=Object.freeze({phase:'loading',status:'Checking accepted quote access…',busy:false,rows:[],selected:null,amendment:null,search:'',hasMore:false,canCreate:false,canLookup:false,writesPaused:true,draft:null,dirty:false,draftIssue:'',canEdit:false,canSave:false,choices:emptyChoices(),canSubmit:false,canApprove:false,canSend:false,hasExtreme:false,reviewIssue:'',canReadHistory:false});
type Dependencies={storage:StorageAccess;change:(view:QuoteAmendmentWorkspaceView)=>void;api?:typeof quoteAmendments;save?:typeof quotes.save;reviewApi?:typeof quoteReview;session?:typeof authentication.session;context?:typeof quotes.context;vehicleApi?:typeof vehicles;serviceApi?:typeof services;addressApi?:typeof addresses;id?:()=>string};
const pendingKinds=['quote.amendment.create','quote.amendment.send','quote.draft.save','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept','quote.replacement.create'] as const;
export function createQuoteAmendmentWorkspace(deps:Dependencies){
 const api=deps.api??quoteAmendments,saveDraft=deps.save??quotes.save,session=deps.session??authentication.session,getContext=deps.context??quotes.context,id=deps.id??(()=>crypto.randomUUID()),store=createPendingQuoteAmendmentStore(deps.storage,'quote.amendment.create'),editStore=createPendingQuoteStore(deps.storage);
 let alive=true,active:AbortController|null=null,context:Awaited<ReturnType<typeof quotes.context>>|null=null,proof:Awaited<ReturnType<typeof authentication.session>>|null=null,pending:PendingOriginalOperation|null=null;
 let phase:QuoteAmendmentWorkspaceView['phase']='loading',status=initialQuoteAmendmentWorkspaceView.status,rows:readonly QuoteAmendmentTarget[]=[],selected:QuoteAmendmentTarget|null=null,amendment:Saved|null=null,search='',hasMore=false;
 let draft:QuoteDraft|null=null;
 let choices=emptyChoices();
 const reviewApi=deps.reviewApi??quoteReview,reviewStore=createPendingQuoteReviewStore(deps.storage),sendStore=createPendingQuoteAmendmentStore(deps.storage,'quote.amendment.send');
 const originalDraft=()=>amendment?quoteDraftFromContent(quoteInputFromSnapshots(amendment.revision.customer_safe_snapshot,amendment.revision.internal_snapshot)):null;
 const erase=()=>{context=null;proof=null;rows=[];selected=null;amendment=null;draft=null;choices=emptyChoices();search='';hasMore=false;};
 const eligible=(target:QuoteAmendmentTarget)=>!['Draft','Ready for Review'].includes(target.revision.state)&&target.parent.revision.customer_safe_snapshot.schemaVersion===2;
 const editable=()=>phase==='ready'&&!active&&!pending&&!!amendment&&amendment.parentIsCurrent&&['Draft','Ready for Review'].includes(amendment.revision.state)&&context?.context.writeState==='ready'&&context.reviewAvailable===true&&context.commercialAvailable===true;
 function draftIssue(){
  if(!draft||!amendment)return '';const issue=quoteDraftIssue(draft);if(issue)return issue;
  const sources=new Map(amendment.parent.revision.internal_snapshot.sources.map(source=>[source.stableLineKey,source]));
  if(draft.lines.some(line=>{const source=sources.get(line.id);return source&&(source.vehicleId!==line.vehicleId||source.jobWide!==(line.scope==='job-wide'));}))return 'Accepted work keeps its vehicle and scope identity. Remove the old line and add a new line to propose different scope.';
  const content=parseQuoteDraft(draft),placeholder='00000000-0000-0000-0000-000000000000',body={schemaVersion:1,operationId:placeholder,recoveryEpoch:placeholder,familyId:amendment.family.id,revisionId:amendment.revision.id,expectedFamilyVersion:amendment.family.version,expectedRevisionVersion:amendment.revision.version,content};
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>quoteBodyLimit)return 'This amendment is too large to send. Shorten its scope before saving.';
  return quoteDraftAuditBytes(prepareQuoteReviewContent(content),amendment.revision)>quoteDraftAuditLimit?'This amendment exceeds the supported retained-history size. Shorten its scope before saving.':'';
 }
 const view=():QuoteAmendmentWorkspaceView=>{const original=originalDraft(),dirty=draft!==null&&original!==null&&quoteDraftChanged(draft,original),issue=phase==='ready'?draftIssue():'',reviewIssue=phase==='ready'&&amendment?quoteReviewReadiness(quoteInputFromSnapshots(amendment.revision.customer_safe_snapshot,amendment.revision.internal_snapshot))??'':'';return Object.freeze({phase,status,busy:!!active,rows:phase==='ready'?rows:[],selected:phase==='ready'?selected:null,amendment:phase==='ready'?amendment:null,search:phase==='ready'?search:'',hasMore:phase==='ready'&&hasMore,canCreate:phase==='ready'&&!active&&pending===null&&selected!==null&&eligible(selected)&&context?.context.writeState==='ready'&&context.reviewAvailable===true&&context.commercialAvailable===true,canLookup:phase==='pending'&&!active&&pending!==null,writesPaused:context?.context.writeState!=='ready',draft:phase==='ready'?draft:null,dirty:phase==='ready'&&dirty,draftIssue:issue,canEdit:editable(),canSave:editable()&&dirty&&!issue,choices:phase==='ready'?choices:emptyChoices(),canSubmit:editable()&&!dirty&&!reviewIssue&&amendment?.revision.state==='Draft',canApprove:editable()&&!dirty&&!reviewIssue&&amendment?.revision.state==='Ready for Review'&&amendment.approval===null,canSend:editable()&&!dirty&&amendment?.revision.state==='Ready for Review'&&amendment.approval!==null,hasExtreme:phase==='ready'&&!!amendment&&amendment.revision.customer_safe_snapshot.lines.some(line=>line.condition==='Extreme'),reviewIssue,canReadHistory:phase==='ready'&&!active&&!pending&&!dirty&&amendment!==null});};
 const emit=()=>{if(alive)deps.change(view());},live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 function pendingCheck(businessId:string){
  const found=pendingKinds.map(kind=>openPendingOriginalOperation(kind,deps.storage,businessId)).filter((value):value is PendingOriginalOperation=>value!==null);pending=found[0]??null;
  if(found.length>1){erase();phase='blocked';status='Several quote actions need review. Open Save review before preparing another change.';return false;}
  if(pending){erase();phase='pending';status='A quote action has an unresolved original reference. Check its result or open Save review; nothing retries.';return false;}return true;
 }
 async function fresh(signal:AbortSignal){proof=await session(signal);live(signal);context=await getContext(proof,signal);live(signal);}
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  if(!alive||active)return;const controller=new AbortController();active=controller;emit();
  try{await work(controller.signal);}catch{if(alive&&active===controller&&!controller.signal.aborted){erase();phase=pending?'pending':'unavailable';status=pending?'The original result is uncertain. Keep its reference for Save review; no automatic retry.':'Accepted quote details could not be verified. Load saved work again.';}}
  finally{if(active===controller){active=null;emit();}}
 }
 async function selection(familyId:string,signal:AbortSignal){
  const request={businessId:context!.context.businessId,familyId,search:'',afterId:null,pageSize:1},page=await parseQuoteAmendmentTargets(await api.targets(request,proof!,signal),request);live(signal);selected=page.targets[0]??null;amendment=null;draft=null;
  if(!selected){status='This accepted family was not found. Reload accepted work.';return;}
  if(selected.revision.kind==='amendment'&&selected.revision.state!=='Accepted'){
   const request={businessId:context!.context.businessId,familyId,revisionId:selected.revision.id,afterVersion:'0',pageSize:5},value=await api.read(request,proof!,signal);live(signal);
   // Real clients already return a revalidated derived read. Revalidate its
   // source again for controller dependencies without treating derived flags
   // as authority or accepting them on the wire.
   const raw='state'in value?value:{schemaVersion:value.schemaVersion,businessId:value.businessId,family:value.family,revision:value.revision,parent:value.parent,control:value.control,items:value.items,approval:value.approval,latestSend:value.latestSend,history:value.history,hasMore:value.hasMore};
   const parsed=await parseQuoteAmendmentRead(raw,request);live(signal);if('state'in parsed||parsed.family.version!==selected.family.version||parsed.revision.version!==selected.revision.version||parsed.revision.content_hash!==selected.revision.content_hash)throw Error();amendment=parsed;draft=originalDraft();
  }
  status='Saved accepted work loaded. Proposed changes do not alter the accepted agreement.';
 }
 const load=(value='',more=false)=>run(async signal=>{
  const after=more?rows.at(-1)?.family.id??null:null;if(more&&(!hasMore||value!==search))return;erase();phase='loading';status='Loading accepted quotes…';emit();await fresh(signal);if(!pendingCheck(context!.context.businessId))return;
  const request={businessId:context!.context.businessId,familyId:null,search:value,afterId:after,pageSize:10},page=await parseQuoteAmendmentTargets(await api.targets(request,proof!,signal),request);live(signal);rows=page.targets;search=value;hasMore=page.hasMore;phase='ready';status=rows.length?'Saved accepted quotes loaded.':'No accepted quotes match this search.';
 });
 const open=(familyId:string)=>run(async signal=>{erase();phase='loading';status='Loading the exact saved agreement and current change…';emit();await fresh(signal);if(!pendingCheck(context!.context.businessId))return;await selection(familyId,signal);phase='ready';});
 const create=()=>{
  if(!view().canCreate||!selected||!context)return Promise.resolve();const before=selected,previous=context;
  return run(async signal=>{
   erase();phase='loading';status='Rechecking the accepted agreement before saving a new Draft…';emit();await fresh(signal);if(context!.context.businessId!==before.family.business_id||context!.binding!==previous.binding||context!.context.recoveryEpoch!==previous.context.recoveryEpoch||context!.context.writeState!=='ready'||!context!.reviewAvailable||!context!.commercialAvailable){erase();phase='review';status='Access or recovery changed. Reload accepted work before saving.';return;}
   if(!pendingCheck(context!.context.businessId))return;await selection(before.family.id,signal);if(!selected||!eligible(selected)||selected.family.version!==before.family.version||selected.revision.id!==before.revision.id||selected.revision.version!==before.revision.version||selected.parent.agreementId!==before.parent.agreementId||selected.parent.versionNo!==before.parent.versionNo||selected.parent.revision.content_hash!==before.parent.revision.content_hash){erase();phase='review';status='The saved quote changed. Reload and review its current terms before preparing a Draft.';return;}
   const target=selected,content=quoteInputFromSnapshots(target.parent.revision.customer_safe_snapshot,target.parent.revision.internal_snapshot),command=parseQuoteAmendmentDraft({schemaVersion:1,businessId:context!.context.businessId,operationId:id(),recoveryEpoch:context!.context.recoveryEpoch,familyId:target.family.id,revisionId:id(),expectedFamilyVersion:target.family.version,expectedParentAgreementId:target.parent.agreementId,expectedParentAgreementVersion:target.parent.versionNo,expectedParentAcceptedHash:target.parent.revision.content_hash,content:{...content,recipient:{...content.recipient,customerId:target.parent.customerId}}});
   const prepared=prepareQuoteReviewContent(command.content),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepared.canonical)),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');live(signal);if(!pendingCheck(command.businessId))return;
   const record=pendingQuoteAmendment('quote.amendment.create',{schemaVersion:1,businessId:command.businessId,binding:context!.binding,reference:quoteAmendmentDraftReference(command)});store.write(record);store.require(record);pending=openPendingOriginalOperation('quote.amendment.create',deps.storage,command.businessId);if(!pending)throw Error();const authorization=proof!;erase();phase='pending';status='Saving the amendment Draft…';emit();
   const result=await api.create(command,authorization,signal);live(signal);store.require(record);if(result.state!=='committed'){status='The Draft was not confirmed. Keep its original reference for Save review before another attempt.';return;}
   const confirmed=bindQuoteAmendmentDraftReceipt(result,command.businessId,record.reference,command.expectedParentAcceptedHash);if(confirmed.receipt.contentHash!==hash||confirmed.receipt.itemAuditEventIds.length!==command.content.lines.length)throw Error();store.clear(record);pending=null;
   try{await fresh(signal);if(context!.context.businessId!==command.businessId)throw Error();await selection(command.familyId,signal);if(selected?.revision.id!==command.revisionId)throw Error();phase='ready';status='Amendment Draft saved and reloaded. The accepted agreement is unchanged.';}catch{live(signal);erase();phase='review';status='The amendment Draft is confirmed saved. Reload accepted work to verify its current details.';}
  });
 };
 const save=()=>{
  if(!view().canSave||!amendment||!context||!draft)return Promise.resolve();
  // Seal the intended content and expected source before any asynchronous
  // access/read check. Never silently rebase an edit onto a newer agreement.
  const before=amendment,previous=context,content=parseQuoteDraft(draft);
  return run(async signal=>{
   erase();phase='loading';status='Rechecking the saved amendment before saving changes…';emit();await fresh(signal);
   if(context!.context.businessId!==before.businessId||context!.binding!==previous.binding||context!.context.recoveryEpoch!==previous.context.recoveryEpoch||context!.context.writeState!=='ready'||!context!.reviewAvailable||!context!.commercialAvailable){erase();phase='review';status='Access or recovery changed. No edit was sent. Reload accepted work.';return;}
   if(!pendingCheck(context!.context.businessId))return;await selection(before.family.id,signal);
   if(!amendment||!amendment.parentIsCurrent||!['Draft','Ready for Review'].includes(amendment.revision.state)||amendment.family.version!==before.family.version||amendment.revision.id!==before.revision.id||amendment.revision.version!==before.revision.version||amendment.revision.content_hash!==before.revision.content_hash||amendment.parent.agreementId!==before.parent.agreementId||amendment.parent.versionNo!==before.parent.versionNo||amendment.parent.revision.content_hash!==before.parent.revision.content_hash||amendment.control.version!==before.control.version){erase();phase='review';status='The saved amendment or accepted agreement changed. No edit was sent. Reload and review the current terms.';return;}
   const command=parseQuoteSave({schemaVersion:1,businessId:before.businessId,operationId:id(),recoveryEpoch:context!.context.recoveryEpoch,familyId:before.family.id,revisionId:before.revision.id,expectedFamilyVersion:before.family.version,expectedRevisionVersion:before.revision.version,content}),prepared=prepareQuoteReviewContent(command.content),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prepared.canonical)),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');live(signal);
   if(!pendingCheck(command.businessId))return;
   const record=pendingQuote({schemaVersion:1,businessId:command.businessId,binding:context!.binding,reference:{operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,familyId:command.familyId,revisionId:command.revisionId,expectedFamilyVersion:command.expectedFamilyVersion,expectedRevisionVersion:command.expectedRevisionVersion}});
   try{editStore.write(record);editStore.require(record);}catch{erase();phase='blocked';status='The original save reference could not be secured. No edit was sent; open Save review before another change.';return;}
   pending=openPendingOriginalOperation('quote.draft.save',deps.storage,command.businessId);if(!pending)throw Error();const authorization=proof!;erase();phase='pending';status='Saving amendment changes…';emit();
   const result=await saveDraft(command,authorization,signal);live(signal);editStore.require(record);
   if(result.state!=='committed'){status='The edit has no confirmed operation receipt. Keep its original reference for Save review before another action.';return;}
   const confirmed=parseQuoteCommitted(result,command.businessId,command.operationId),r=confirmed.receipt;
   if(confirmed.recoveryEpoch!==command.recoveryEpoch||r.schemaVersion!==2||r.familyId!==command.familyId||r.revisionId!==command.revisionId||BigInt(r.familyVersion)!==BigInt(command.expectedFamilyVersion)+1n||BigInt(r.revisionVersion)!==BigInt(command.expectedRevisionVersion)+1n||BigInt(r.contentVersion)!==BigInt(before.revision.content_version)+1n||r.contentHash!==hash)throw Error();
   editStore.clear(record);pending=null;
   try{await fresh(signal);if(context!.context.businessId!==command.businessId)throw Error();await selection(command.familyId,signal);if(!amendment||amendment.revision.id!==command.revisionId||amendment.family.version!==r.familyVersion||amendment.revision.version!==r.revisionVersion||amendment.revision.content_hash!==hash||amendment.revision.state!=='Draft')throw Error();phase='ready';status='Amendment changes saved and reloaded. The accepted agreement is unchanged.';}catch{live(signal);erase();phase='review';status='The amendment edit is confirmed saved. Reload accepted work to verify its current details.';}
  });
 };
 async function recheck(before:Saved,previous:Awaited<ReturnType<typeof quotes.context>>,signal:AbortSignal){
  erase();phase='loading';status='Rechecking the exact amendment and accepted terms…';emit();await fresh(signal);
  if(context!.context.businessId!==before.businessId||context!.binding!==previous.binding||context!.context.recoveryEpoch!==previous.context.recoveryEpoch||context!.context.writeState!=='ready'||!context!.reviewAvailable||!context!.commercialAvailable){erase();phase='review';status='Access or recovery changed. No action was sent. Reload accepted work.';return false;}
  if(!pendingCheck(before.businessId))return false;await selection(before.family.id,signal);
  if(!amendment||!amendment.parentIsCurrent||amendment.family.version!==before.family.version||amendment.revision.id!==before.revision.id||amendment.revision.version!==before.revision.version||amendment.revision.content_hash!==before.revision.content_hash||amendment.revision.content_version!==before.revision.content_version||amendment.revision.state!==before.revision.state||amendment.parent.agreementId!==before.parent.agreementId||amendment.parent.versionNo!==before.parent.versionNo||amendment.parent.revision.content_hash!==before.parent.revision.content_hash||amendment.control.version!==before.control.version||amendment.control.activeOfferId!==before.control.activeOfferId||amendment.approval?.id!==before.approval?.id||amendment.approval?.presentationHash!==before.approval?.presentationHash){erase();phase='review';status='The saved amendment, approval or accepted agreement changed. No action was sent. Reload current terms.';return false;}return true;
 }
 const review=(action:'submit'|'approve',extremeAcknowledged=false)=>{
  const state=view();if(!context||!amendment||(action==='submit'?!state.canSubmit:!state.canApprove||state.hasExtreme&&!extremeAcknowledged))return Promise.resolve();
  const before=amendment,previous=context,base={schemaVersion:1,businessId:before.businessId,operationId:id(),recoveryEpoch:context.context.recoveryEpoch,familyId:before.family.id,revisionId:before.revision.id,expectedFamilyVersion:before.family.version,expectedRevisionVersion:before.revision.version,expectedContentVersion:before.revision.content_version,expectedHash:before.revision.content_hash},command=action==='submit'?parseQuoteReviewSubmit(base):parseQuoteReviewApprove({...base,approvalId:id(),extremeAcknowledged});
  return run(async signal=>{
   if(!await recheck(before,previous,signal))return;
   const approvalId='approvalId'in command?command.approvalId:null,record=pendingQuoteReview({schemaVersion:1,businessId:command.businessId,binding:context!.binding,reference:{action,operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,familyId:command.familyId,revisionId:command.revisionId,expectedFamilyVersion:command.expectedFamilyVersion,expectedRevisionVersion:command.expectedRevisionVersion,expectedContentVersion:command.expectedContentVersion,approvalId}});
   reviewStore.write(record);reviewStore.require(record);pending=openPendingOriginalOperation(action==='submit'?'quote.review.submit':'quote.review.approve',deps.storage,command.businessId);if(!pending)throw Error();const authorization=proof!;erase();phase='pending';status='Recording amendment '+(action==='submit'?'review request':'approval')+'…';emit();
   const result='approvalId'in command?await reviewApi.approve(parseQuoteReviewApprove(command),authorization,signal):await reviewApi.submit(command,authorization,signal);live(signal);reviewStore.require(record);
   if(result.state!=='committed'){status='This review action has no confirmed operation receipt. Keep its original reference for Save review.';return;}
   const confirmed=parseQuoteReviewCommitted(result,command.businessId,command.operationId),r=confirmed.receipt;
   if(confirmed.recoveryEpoch!==command.recoveryEpoch||r.action!==action||r.familyId!==command.familyId||r.revisionId!==command.revisionId||BigInt(r.familyVersion)!==BigInt(command.expectedFamilyVersion)+1n||BigInt(r.revisionVersion)!==BigInt(command.expectedRevisionVersion)+1n||r.contentVersion!==command.expectedContentVersion||r.contentHash!==command.expectedHash||r.approvalId!==approvalId)throw Error();reviewStore.clear(record);pending=null;
   try{await fresh(signal);if(context!.context.businessId!==command.businessId)throw Error();await selection(command.familyId,signal);if(!amendment||amendment.family.version!==r.familyVersion||amendment.revision.version!==r.revisionVersion||amendment.revision.state!=='Ready for Review'||amendment.revision.content_hash!==r.contentHash||amendment.approval?.id!== (r.approvalId??undefined)||amendment.approval?.presentationHash!==(r.presentationHash??undefined))throw Error();phase='ready';status=action==='submit'?'Amendment review requested and reloaded. It is not approved or shared.':'Amendment approval recorded and reloaded. Actual sharing and customer acceptance are separate.';}catch{live(signal);erase();phase='review';status='The amendment review action is confirmed recorded. Reload accepted work to verify its current details.';}
  });
 };
 const send=(body:Omit<QuoteManualSendBody,'presentationHash'|'replacesRevisionId'>)=>{
  if(!view().canSend||!amendment?.approval||!context)return Promise.resolve();const before=amendment,previous=context;
  let command:ReturnType<typeof parseQuoteAmendmentSend>;
  try{command=parseQuoteAmendmentSend({schemaVersion:1,businessId:before.businessId,operationId:id(),recoveryEpoch:context.context.recoveryEpoch,familyId:before.family.id,revisionId:before.revision.id,expectedFamilyVersion:before.family.version,expectedRevisionVersion:before.revision.version,expectedContentVersion:before.revision.content_version,expectedHash:before.revision.content_hash,sendId:id(),approvalId:before.approval!.id,expectedParentAgreementId:before.parent.agreementId,expectedParentAgreementVersion:before.parent.versionNo,expectedParentAcceptedHash:before.parent.revision.content_hash,body:{...body,presentationHash:before.approval!.presentationHash,replacesRevisionId:before.control.activeOfferId}});}catch{status='Enter the actual sharing channel and recipient before recording sharing.';emit();return Promise.resolve();}
  return run(async signal=>{
   if(!await recheck(before,previous,signal))return;const record=pendingQuoteAmendment('quote.amendment.send',{schemaVersion:1,businessId:command.businessId,binding:context!.binding,reference:quoteAmendmentSendReference(command)});sendStore.write(record);sendStore.require(record);pending=openPendingOriginalOperation('quote.amendment.send',deps.storage,command.businessId);if(!pending)throw Error();const authorization=proof!;erase();phase='pending';status='Recording actual amendment sharing…';emit();
   const result=await api.send(command,authorization,signal);live(signal);sendStore.require(record);if(result.state!=='committed'){status='Sharing has no confirmed operation receipt. Keep its original reference for Save review.';return;}
   const confirmed=bindQuoteAmendmentSendReceipt(result,command.businessId,record.reference,{contentHash:command.expectedHash,parentAcceptedHash:command.expectedParentAcceptedHash,presentationHash:command.body.presentationHash}),r=confirmed.receipt;sendStore.clear(record);pending=null;
   try{await fresh(signal);if(context!.context.businessId!==command.businessId)throw Error();await selection(command.familyId,signal);if(!amendment||amendment.family.version!==r.familyVersion||amendment.revision.version!==r.revisionVersion||amendment.revision.content_hash!==r.contentHash||amendment.revision.state!=='Sent'||amendment.latestSend?.id!==r.sendId||amendment.control.activeOfferId!==r.revisionId)throw Error();phase='ready';status='Actual amendment sharing recorded and reloaded. The accepted agreement is unchanged until separate customer acceptance.';}catch{live(signal);erase();phase='review';status='Amendment sharing is confirmed recorded. Reload accepted work to verify its current details.';}
  });
 };
 const lookup=()=>run(async signal=>{erase();phase='loading';status='Checking the exact original quote result…';emit();await fresh(signal);const businessId=context!.context.businessId;pendingCheck(businessId);if(view().phase==='blocked')return;if(!pending){phase='review';status='No unresolved quote reference was found. Reload accepted work.';return;}const original=pending;const result=await original.reconcile(await session(signal),signal);live(signal);erase();if(result==='committed'){pending=null;phase='review';status='The original quote save is confirmed. Reload accepted work.';}else{phase='pending';status='No completed original was found. This does not prove failure. Keep its reference and open Save review.';}});
 function sameAccess(previous:Awaited<ReturnType<typeof quotes.context>>){return context?.context.businessId===previous.context.businessId&&context.binding===previous.binding&&context.context.recoveryEpoch===previous.context.recoveryEpoch&&context.context.writeState===previous.context.writeState;}
 const historyPage=(first=false)=>{
  if(!view().canReadHistory||!amendment||!context||!first&&!amendment.hasMore)return Promise.resolve();const before=amendment,previous=context,last=before.history.at(-1)??null,afterVersion=first?'0':last?.revision;if(afterVersion===undefined)return Promise.resolve();
  return run(async signal=>{
   try{status='Loading retained amendment history…';emit();await fresh(signal);if(!sameAccess(previous))throw Error();if(!pendingCheck(before.businessId))return;const request={businessId:before.businessId,familyId:before.family.id,revisionId:before.revision.id,afterVersion,pageSize:5},page=await checkedAmendmentHistoryPage(await api.read(request,proof!,signal),request,before,first?null:last);live(signal);amendment=page;status=first?'Showing the first retained amendment history page.':'Showing the next retained amendment history page.';}
   catch{live(signal);erase();phase='unavailable';status='Saved history or access changed or could not be verified. Load current accepted work before continuing.';}
  });
 };
 const archive=async()=>{
  if(!view().canReadHistory||!amendment||!context)return undefined;const before=amendment,previous=context;let result:Uint8Array<ArrayBuffer>|undefined;
  await run(async signal=>{
   let bytes:Uint8Array<ArrayBuffer>|undefined;
   try{
    status='Preparing the complete retained amendment record…';emit();await fresh(signal);if(!sameAccess(previous))throw Error();if(!pendingCheck(before.businessId))return;
    let lastRead=0;const history=await collectAmendmentHistory(before,async request=>{
     // Pace successful sequential reads under the unchanged ordinary admission
     // cap. A refusal stops collection; it never triggers an automatic retry.
     const remaining=Math.max(0,lastRead+750-Date.now());if(remaining)await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error());},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},remaining);if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});});live(signal);lastRead=Date.now();return api.read(request,proof!,signal);
    },signal);live(signal);bytes=await buildAmendmentRecord(before,history);live(signal);await fresh(signal);if(!sameAccess(previous))throw Error();
    const request={businessId:before.businessId,familyId:before.family.id,revisionId:before.revision.id,afterVersion:'0',pageSize:5},final=await checkedAmendmentHistoryPage(await api.read(request,proof!,signal),request,before);live(signal);if(!sameAmendmentSource(final,before)||!pendingCheck(before.businessId)){bytes.fill(0);return;}result=bytes;bytes=undefined;status='Complete saved amendment record prepared. Check your browser to confirm the download.';
   }catch{live(signal);erase();phase='unavailable';status='No file was requested. The saved record or access changed, or it exceeds the 1,000-version / 8 MiB record limit. Load current accepted work before trying again.';}
   finally{bytes?.fill(0);}
  });return result;
 };
 function edit(value:QuoteDraft){if(!alive||!editable()||!draft||value.customerId!==draft.customerId||value.leadId!==draft.leadId||value.contentSchemaVersion!==2)return;draft=copyQuoteDraft(value);emit();}
 const find=(kind:'vehicles'|'services'|'addresses',value='',more=false)=>{
  if(!editable()||!context||!draft||[...value].length>200)return Promise.resolve();const previous=context,customerId=draft.customerId;
  if(kind==='addresses'&&!customerId)return Promise.resolve();
  const cursor=kind==='vehicles'?choices.vehicles.at(-1)?.id:kind==='services'?choices.services.at(-1)?.service.id:choices.addresses.at(-1)?.id;
  if(more&&(kind==='vehicles'?!choices.moreVehicles||value!==choices.vehicleSearch:kind==='services'?!choices.moreServices||value!==choices.serviceSearch:!choices.moreAddresses))return Promise.resolve();
  return run(async signal=>{
   await fresh(signal);if(context!.binding!==previous.binding||context!.context.businessId!==previous.context.businessId||context!.context.recoveryEpoch!==previous.context.recoveryEpoch||context!.context.writeState!=='ready')throw Error();
   const businessId=context!.context.businessId,afterId=more?cursor??null:null;
   if(kind==='vehicles'){const result=await (deps.vehicleApi??vehicles).list(businessId,{search:value,afterId,includeArchived:false,pageSize:25},proof!,signal);live(signal);choices={...choices,vehicles:result.vehicles,vehicleSearch:value,moreVehicles:result.hasMore};}
   else if(kind==='services'){const result=await (deps.serviceApi??services).list(businessId,{search:value,afterId,includeInactive:false,pageSize:25},proof!,signal);live(signal);choices={...choices,services:result.services,serviceSearch:value,moreServices:result.hasMore};}
   else{const result=await (deps.addressApi??addresses).list(businessId,{customerId:customerId!,search:'',afterId,includeArchived:false,pageSize:25},proof!,signal);live(signal);choices={...choices,addresses:result.addresses,moreAddresses:result.hasMore,addressesLoaded:true};}
   status='Saved '+kind+' loaded. Select a record to copy it into this unsaved amendment.';
  });
 };
 function clearPrivate(){active?.abort();active=null;erase();phase='review';status='Private quote details cleared. Any original reference was kept.';emit();}
 return Object.freeze({view,load,open,create,save,edit,review,send,lookup,historyPage,archive,clearPrivate,
  addLine(){if(draft&&draft.lines.length<1000)edit({...draft,lines:[...draft.lines,emptyQuoteLine(id())]});},
  removeLine(lineId:string){if(draft)edit({...draft,lines:draft.lines.filter(line=>line.id!==lineId)});},
  findVehicles:(value:string,more=false)=>find('vehicles',value,more),findServices:(value:string,more=false)=>find('services',value,more),loadAddresses:(more=false)=>find('addresses','',more),
  chooseVehicle(lineId:string,vehicleId:string){if(!draft)return;const vehicle=choices.vehicles.find(row=>row.id===vehicleId&&row.business_id===context?.context.businessId&&row.archived_at===null);if(vehicle)edit({...draft,lines:draft.lines.map(line=>line.id===lineId?{...line,scope:'vehicle',vehicleId:vehicle.id,vehicleLabel:vehicle.label,...line.vehicleId!==vehicle.id?{category:null,condition:'',assessment:null,assessmentDraft:undefined,categoryOverrideNote:null}:{}}:line)});},
  copyService(lineId:string,serviceId:string){if(!draft)return;const service=choices.services.find(row=>row.service.id===serviceId&&row.service.business_id===context?.context.businessId&&row.service.active);if(service)edit({...draft,lines:draft.lines.map(line=>line.id===lineId?{...line,serviceVersionId:service.content.id,description:service.content.name,inclusions:service.content.inclusions,exclusions:service.content.exclusions}:line)});},
  chooseAddress(addressId:string){if(!draft)return;const address=choices.addresses.find(row=>row.id===addressId&&row.business_id===context?.context.businessId&&row.customer_id===draft!.customerId&&row.archived_at===null);if(address){const workLocation=quoteLocationFromAddress(address);if(workLocation)edit({...draft,workLocation});}},
  dispose(){alive=false;active?.abort();active=null;erase();pending=null;}});
}
