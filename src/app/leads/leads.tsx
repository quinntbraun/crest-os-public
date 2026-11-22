'use client';
import {SignInLink} from '../sign-in-link';
import {DirectoryRecall} from '../directory-recall';
import {useDirectoryReturn} from '../../client/use-directory-return';
import {DirectoryLoading} from '../directory-loading';
import {captureDirectoryOrigin,restoreDirectoryOrigin} from '../../client/directory-origin';
import type {DirectoryOrigin} from '../../client/directory-origin';
import {createPendingLeadConversionStore} from '../../client/pending-lead-conversion';
import {createPendingLeadAddressStore} from '../../client/pending-lead-address-edit';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent,ComponentType} from 'react';
import type {LeadAddressDraft} from '../../customer/lead-resource-contract';
import {createLeadEditorController,initialLeadEditorView,emptyLeadDraft} from '../../client/lead-editor-controller';
import {createPendingLeadStore} from '../../client/pending-lead-edit';
import type {LeadDraft} from '../../customer/lead-contract';
import {draftFromLead} from '../../customer/lead-contract';
import {NullableText} from '../customers/nullable-text';
import {ReferencePicker} from './reference-picker';
import {LeadStatusPanel} from './status';
import {LeadVehiclePanel} from './vehicles';
import {LeadAddressPanel} from './addresses';
import {LeadConversionPanel} from './conversion';
import {createPendingLeadVehicleStore} from '../../client/pending-lead-vehicle-edit';
import {createPendingLeadStateStore} from '../../client/pending-lead-state-edit';
import {leadDollars,leadCents} from './intake-input';
import {FollowUpInput} from './follow-up-input';
import {LeadMatchNotice,useLeadMatchReview} from './match-review';
import {leadMatchReview} from '../../client/leads';
import type {Proof} from '../../client/authentication';
import {loadedFollowUpGroups} from './follow-up-presentation';
import type {FollowUpFilter} from './follow-up-presentation';
import {LeadHistory} from './history';

const followUpDisplay=new Intl.DateTimeFormat('en-US',{
 month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',
});
function FollowUpTime({instant}:{instant:string}){
 return <time dateTime={instant} title={instant}>{followUpDisplay.format(new Date(instant))}</time>;
}
function EstimateInput({value,change}:{value:string|null;change:(value:string|null)=>void}){
 const [text,setText]=useState(()=>value===null?'':leadDollars(value));
 return <><label htmlFor="lead-estimate">Estimated value (USD)</label><input id="lead-estimate" name="estimate" inputMode="decimal" autoComplete="off" maxLength={24} value={text} onChange={event=>{setText(event.target.value);change(event.target.value.length?leadCents(event.target.value):null);}}/><p className="field-help">Optional. Enter dollars, such as 125.50, or leave blank. Zero is an explicit estimate. This is not a quote or invoice.</p></>;
}
export function LeadScreen({addressAssist,initialLeadId=null,initialIncludeAll=false,initialDirectory=false,initialFollowUpFilter='all'}:{addressAssist?:ComponentType<{draft:LeadAddressDraft;change:(draft:LeadAddressDraft)=>void}>;initialLeadId?:string|null;initialIncludeAll?:boolean;initialDirectory?:boolean;initialFollowUpFilter?:FollowUpFilter}={}){
 const {selection,includeAll,remember,rememberFilter,rememberNavigation}=useDirectoryReturn('leads',initialLeadId,initialIncludeAll);
 const [saving,setSaving]=useState(false);
 const [conversionLocked,setConversionLocked]=useState(false),[conversionGeneration,setConversionGeneration]=useState(0),[statusLocked,setStatusLocked]=useState(false),[vehicleLocked,setVehicleLocked]=useState(false),[addressLocked,setAddressLocked]=useState(false),[view,setView]=useState(initialLeadEditorView),current=useRef<ReturnType<typeof createLeadEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null),editHeading=useRef<HTMLHeadingElement>(null);
 const [directory,setDirectory]=useState(initialDirectory),queueHeading=useRef<HTMLHeadingElement>(null);
 const [initialRecord,setInitialRecord]=useState({leadId:initialLeadId,ready:!initialLeadId});
 if(initialRecord.leadId!==initialLeadId)setInitialRecord({leadId:initialLeadId,ready:!initialLeadId});
 const initialRecordReady=initialRecord.leadId===initialLeadId&&initialRecord.ready;
 const [followUpFilter,setFollowUpFilter]=useState<FollowUpFilter>(initialFollowUpFilter),[recordDismissed,setRecordDismissed]=useState(false);
 const [focusRequest,setFocusRequest]=useState<{target:'record';leadId:string|null}|{target:'directory'}|null>(null);
 const handledFocus=useRef<typeof focusRequest>(null),record=useRef<HTMLElement>(null),directoryHeading=useRef<HTMLHeadingElement>(null);
 const rowOrigin=useRef<HTMLButtonElement|null>(null),addLead=useRef<HTMLButtonElement>(null);
 const directoryOrigin=useRef<DirectoryOrigin|null>(null);
 const showingRecord=view.draft!==null&&!recordDismissed;
 useLayoutEffect(()=>{
  if(!focusRequest||handledFocus.current===focusRequest||view.busy||view.phase!=='ready')return;
  if(focusRequest.target==='record'){
   if(!showingRecord||(view.selected?.id??null)!==focusRequest.leadId)return;
   editHeading.current?.focus({preventScroll:true});record.current?.scrollIntoView({block:'start',behavior:'instant'});
  }else{
   if(showingRecord)return;
   const origin=rowOrigin.current;
   if(origin?.isConnected&&!origin.disabled&&origin.getClientRects().length)restoreDirectoryOrigin(directoryOrigin.current,origin);
   else (queueHeading.current??directoryHeading.current??addLead.current)?.focus();
  }
  handledFocus.current=focusRequest;
 },[focusRequest,showingRecord,view.busy,view.phase,view.selected]);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const controller=createLeadEditorController({conversionStore:createPendingLeadConversionStore(storage),addressStore:createPendingLeadAddressStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),store:createPendingLeadStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),statusStore:createPendingLeadStateStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),vehicleStore:createPendingLeadVehicleStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:next=>{if(next.phase!=='ready'){directoryOrigin.current=null;rowOrigin.current=null;handledFocus.current=null;}setView(next);}});current.current=controller;
  void (async()=>{try{
   await controller.load(includeAll.current);
   if(!initialLeadId||current.current!==controller||controller.view().phase!=='ready')return;
   const intent={target:'record' as const,leadId:initialLeadId};setRecordDismissed(false);setFocusRequest(intent);
   await controller.open(initialLeadId);
   if(current.current===controller&&controller.view().selected?.id!==initialLeadId)setFocusRequest(previous=>previous===intent?null:previous);
  }finally{if(current.current===controller)setInitialRecord({leadId:initialLeadId,ready:true});}})();
  const leave=()=>{directoryOrigin.current=null;rowOrigin.current=null;handledFocus.current=null;setFocusRequest(null);setRecordDismissed(false);controller.suspend();};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();},restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{directoryOrigin.current=null;rowOrigin.current=null;handledFocus.current=null;controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[initialLeadId,includeAll]);
 const statusChanged=useCallback((leadId:string)=>{void current.current?.statusChanged(leadId);},[]);
 const conversionCommitted=useCallback((leadId:string)=>{setConversionGeneration(v=>v+1);void current.current?.conversionChanged(leadId);},[]);
 const dirty=view.draft!==null&&JSON.stringify(view.draft)!==JSON.stringify(view.selected?draftFromLead(view.selected):emptyLeadDraft);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!saving)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,view.phase,saving]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller||kind==='moreHistory'&&dirty&&!window.confirm('If the saved lead has changed, loading more history clears this unsaved intake. Continue?'))return;if(kind==='load')setFocusRequest(null);if(kind==='save')setSaving(true);try{if(kind==='load')await controller.load(includeAll.current);else await controller[kind]();if(current.current===controller)status.current?.focus();}finally{if(kind==='save')setSaving(false);}}
 function edit<K extends keyof LeadDraft>(key:K,value:LeadDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function query(text:string,lost:boolean,more=false){const controller=current.current;if(!controller||controller.view().busy||!mayReplaceIntake())return;remember(null);rememberFilter(lost);rememberNavigation({view:'directory'});setDirectory(true);directoryOrigin.current=null;rowOrigin.current=null;setFocusRequest(null);void controller.query(text,lost,more);}
 function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);query(String(data.get('search')??''),data.get('lost')==='on');}

 const key=(view.selected?.id??'new')+':'+(view.selected?.version??'0'),disabled=view.busy||view.writesPaused||statusLocked||vehicleLocked||addressLocked||conversionLocked;
 const readLocked=view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked;
 const queue=view.followUps,showQueue=!!queue&&!directory;
 const page=queue?.page,reminders=page?.followUps??[];
 const reminderGroups=loadedFollowUpGroups(page);
 const visibleRows=showQueue?(reminderGroups?.[followUpFilter]??reminders):view.rows.map(row=>({id:row.id,label:row.label,state:row.state,followUpAt:row.follow_up_at}));
 const review=useLeadMatchReview(view.draft);
 const canSave=view.canSave&&!disabled;
 function reviewAndSave(){
  const controller=current.current,draft=view.draft,businessId=view.businessId,selected=view.selected;
  if(!canSave||!controller||!draft||!businessId)return;
  const changed=!selected||draft.customerId!==selected.customer_id||draft.phone!==selected.phone_raw||draft.email!==selected.email_raw;
  const lookup=view.matchReview&&changed&&(draft.phone?.trim()||draft.email?.trim())?async(proof:Proof,signal:AbortSignal)=>{
   const matches=await leadMatchReview.contact(businessId,{leadId:selected?.id??null,customerId:draft.customerId,phone:draft.phone||null,email:draft.email||null},proof,signal);
   return {rows:matches?[
    ...matches.customers.map(row=>({id:row.id,label:row.label,kind:'Customer' as const,matches:{phone:row.phone,email:row.email},detail:row.archived?'Archived':undefined})),
    ...matches.leads.map(row=>({id:row.id,label:row.label,kind:'Lead' as const,matches:{phone:row.phone,email:row.email},detail:row.state.replaceAll('_',' ')})),
   ]:[],more:!!(matches?.moreCustomers||matches?.moreLeads)};
  }:null;
  void review.run({lookup,stillCurrent:()=>current.current===controller&&controller.view().draft===draft&&controller.view().canSave,save:()=>void action('save')});
 }
 function submit(event:FormEvent){event.preventDefault();if(!review.active)reviewAndSave();}
 function mayReplaceIntake(){return !dirty||window.confirm('Discard the unsaved lead intake changes before replacing this record?');}
 function selectDirectory(all:boolean){remember(null);rememberNavigation({view:all?'directory':'follow-ups'});directoryOrigin.current=null;rowOrigin.current=null;setDirectory(all);setRecordDismissed(true);setFocusRequest({target:'directory'});}
 function startLead(origin:HTMLButtonElement){if(!current.current||current.current.view().busy||!mayReplaceIntake())return;remember(null);rowOrigin.current=origin;directoryOrigin.current=captureDirectoryOrigin(origin);setRecordDismissed(false);setFocusRequest({target:'record',leadId:null});current.current.create();}
 function backToDirectory(){remember(null);setRecordDismissed(true);setFocusRequest({target:'directory'});}
 function resumeRecord(){remember(view.selected?.id??null);setRecordDismissed(false);setFocusRequest({target:'record',leadId:view.selected?.id??null});}
 async function openLead(id:string,origin:HTMLButtonElement){
  const controller=current.current;
  if(!controller||controller.view().busy||!mayReplaceIntake())return;
  rowOrigin.current=origin;directoryOrigin.current=captureDirectoryOrigin(origin);setRecordDismissed(false);
  const intent={target:'record' as const,leadId:id};setFocusRequest(intent);
  await controller.open(id);
  if(current.current===controller&&controller.view().selected?.id===id)remember(id);
  if(current.current===controller&&controller.view().selected?.id!==id)setFocusRequest(previous=>previous===intent?null:previous);
 }
 async function pageQueue(next=false){
  const controller=current.current;
  if(!controller||controller.view().busy)return;
  directoryOrigin.current=null;rowOrigin.current=null;
  await controller.pageFollowUps(next);
  if(current.current===controller)queueHeading.current?.focus();
 }
 function saveAsEntered(){
  if(canSave&&current.current?.view().draft===view.draft){review.dismiss();void action('save');}
 }

 return <section aria-label="Lead directory" aria-busy={view.busy} data-record-open={showingRecord}>
  {view.phase==='ready'&&!view.selected&&!view.draft&&selection&&<DirectoryRecall label="lead" disabled={readLocked}
   onReopen={button=>void openLead(selection,button)}/>}
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase==='loading'&&<DirectoryLoading/>}
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Lead changes are paused. You can review current records and retained history.</p>}
   <div className="lead-directory-toolbar">
    {queue&&<nav aria-label="Lead views" className="lead-view-switch">
     <button type="button" className="secondary" aria-current={showQueue?'true':undefined} disabled={readLocked} onClick={()=>selectDirectory(false)}>Follow-ups</button>
     <button type="button" className="secondary" aria-current={showQueue?undefined:'true'} disabled={readLocked} onClick={()=>selectDirectory(true)}>All leads</button>
    </nav>}
    <button ref={addLead} type="button" disabled={disabled} onClick={event=>startLead(event.currentTarget)}>Add lead</button>
   </div>
   {view.draft&&!showingRecord&&<aside className="lead-record-resume" aria-label="Open lead record"><p>{dirty?'Your unsaved intake changes are still open.':'Your lead record and its unfinished tasks are still open.'}</p><button type="button" className="secondary" disabled={view.busy} onClick={resumeRecord}>Return to lead record</button></aside>}
   <div className="lead-workspace-grid" data-selected={showingRecord}>
   <section className="lead-workspace-directory" aria-label="Browse leads">
   {!showQueue&&<h2 ref={directoryHeading} tabIndex={-1}>Saved leads</h2>}
   {!showQueue&&<>
   <form className="service-search lead-directory-search" onSubmit={search} aria-label="Search leads">
    <label htmlFor="lead-search">Lead search<input id="lead-search" name="search" type="search" maxLength={400} autoComplete="off" defaultValue={view.search} disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked}/></label>
    <button className="secondary" type="submit" disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked}>Search leads</button>
    <label className="trust"><input name="lost" type="checkbox" defaultChecked={view.includeLost} disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked}/>Include lost leads</label>
   </form>
   <p className="field-help">{dirty?'Unsaved intake changes stay open. Crest will ask before replacing them.':'Search by name, phone or email.'}</p>
   </>}
   {showQueue&&<div className="lead-queue-heading">
    <h2 tabIndex={-1} ref={queueHeading}>Scheduled follow-ups</h2>
    <p className="field-help">{dirty?'Unsaved intake changes stay open. Crest will ask before replacing them.':'Earliest reminders first. Lead status and reminder urgency are shown separately.'}</p>
   </div>}
   {showQueue&&page&&reminderGroups&&<section className="lead-reminder-scope" aria-label="Loaded follow-up views">
    <div className="lead-reminder-filters" role="group" aria-label="Filter this reminder page">{(['all','due','upcoming'] as const).map(filter=><button type="button" className="secondary" key={filter} aria-pressed={followUpFilter===filter} disabled={readLocked} onClick={()=>{directoryOrigin.current=null;rowOrigin.current=null;setFollowUpFilter(filter);rememberNavigation({reminders:filter});}}>{({all:'All',due:'Due',upcoming:'Upcoming'} as const)[filter]} ({reminderGroups[filter].length})</button>)}</div>
    <p className="field-help" role="status">Showing {visibleRows.length} of {reminders.length} reminders on this loaded page.</p>
    <p className="field-help">Due status at the last read: <FollowUpTime instant={page.observedAt}/>. Times use your device's time zone.</p>
    {followUpFilter!=='all'&&reminders.length>0&&visibleRows.length===0&&<p>No {followUpFilter==='due'?'due':'upcoming'} reminders on this loaded page.</p>}
   </section>}
   {visibleRows.length>0&&<ul className={"customer-list crest-record-list"+(showQueue?" lead-followup-list":"")} aria-label={showQueue?'Lead follow-up queue':'Saved leads'}>{visibleRows.map(row=><li key={row.id} className="crest-lead-row">
    <button type="button" className="secondary crest-record-row" aria-current={view.selected?.id===row.id?'true':undefined}
     aria-describedby={'lead-summary-'+row.id}
     disabled={readLocked} onClick={event=>void openLead(row.id,event.currentTarget)}>
     <strong>{row.label}</strong>
    </button><span id={'lead-summary-'+row.id} className="crest-record-meta">
      {row.followUpAt&&<span className="lead-followup-time">Follow-up <FollowUpTime instant={row.followUpAt}/>{showQueue&&page&&row.followUpAt<=page.observedAt&&<span className="follow-up-overdue">Overdue</span>}</span>}
      <span className="crest-record-state">{row.state.replaceAll('_',' ')}</span>
     </span>
   </li>)}</ul>}
   {showQueue?<div className="lead-follow-up-pagination">
    {page===null&&<><p>Follow-ups could not be verified.</p><button type="button" className="secondary" disabled={readLocked} onClick={()=>void pageQueue()}>Check follow-ups</button></>}
    {page&&reminders.length===0&&<p>{queue?.later?'No later follow-ups.':'No follow-up dates recorded.'}</p>}
    {queue?.later&&<button type="button" className="secondary" disabled={readLocked} onClick={()=>void pageQueue()}>First reminders</button>}
    {page?.hasMore&&<button type="button" className="secondary" disabled={readLocked} onClick={()=>void pageQueue(true)}>More follow-ups</button>}
   </div>:<>
    {view.rows.length===0&&<p>No leads found on this page.</p>}
    {view.hasMore&&<button type="button" className="secondary" disabled={readLocked} onClick={()=>query(view.search,view.includeLost,true)}>Next lead page</button>}
   </>}
   </section>
   <section ref={record} className="lead-workspace-record" aria-label="Lead record" hidden={!showingRecord}>
    <button type="button" className="secondary lead-record-back" disabled={view.busy} onClick={backToDirectory}>{showQueue?'Back to follow-ups':'Back to leads'}</button>
    {view.selected&&<header className="lead-record-summary"><p className="eyebrow">Lead record · Version {view.selected.version}</p><p className="lead-record-name">{view.selected.label}</p><p><span className="crest-record-state">{view.selected.state.replaceAll('_',' ')}</span>{view.selected.follow_up_at&&<> · Follow-up <FollowUpTime instant={view.selected.follow_up_at}/></>}</p></header>}
    {view.selected&&<nav className="lead-record-jumps" aria-label="Lead record sections"><a href="#lead-intake">Intake</a><a href="#lead-status">Status</a><a href="#lead-vehicles">Vehicles</a><a href="#lead-addresses">Locations</a><a href="#lead-conversion">Conversion</a>{view.history&&<a href="#lead-history">History</a>}</nav>}
   {view.draft&&<div id="lead-intake" tabIndex={-1} className="lead-intake-panel">
    <h2 ref={editHeading} tabIndex={-1}>{view.selected?'Edit lead intake':'New lead'}</h2><p className="field-help">Only a label is required. Unknown details stay unknown. Leaving or hiding this page clears private drafts; closing the tab can also lose its save reference.</p>
    <form onSubmit={submit} aria-label="Lead editor"><fieldset disabled={disabled}><legend>Inquiry details</legend>
     <label htmlFor="lead-label">Lead label</label><input id="lead-label" name="lead-label" autoComplete="off" maxLength={400} value={view.draft.label} onChange={event=>edit('label',event.target.value)} required/><p className="field-help">{[...view.draft.label].length}/200 characters.</p>
     <NullableText name="phone" label="Phone" limit={512} value={view.draft.phone} disabled={disabled} change={value=>edit('phone',value)}/><NullableText name="email" label="Email" limit={512} value={view.draft.email} disabled={disabled} change={value=>edit('email',value)}/>
     <p className="field-help">Recording contact details does not record permission to send messages.</p>
     <NullableText name="referral" label="Referral evidence" multiline limit={2000} value={view.draft.referralText} disabled={disabled} change={value=>edit('referralText',value)}/><NullableText name="scope" label="Requested scope" multiline limit={4000} value={view.draft.requestedScope} disabled={disabled} change={value=>edit('requestedScope',value)}/><NullableText name="availability" label="Availability" multiline limit={4000} value={view.draft.availability} disabled={disabled} change={value=>edit('availability',value)}/>
     <EstimateInput key={key+':estimate'} value={view.draft.estimatedCents} change={value=>edit('estimatedCents',value)}/>
     <FollowUpInput key={key+':follow-up'} value={view.draft.followUpAt} change={value=>edit('followUpAt',value)}/>
     <NullableText name="notes" label="Notes" multiline limit={4000} value={view.draft.notes} disabled={disabled} change={value=>edit('notes',value)}/>
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}{review.active&&<LeadMatchNotice review={review.active}
     fields={[...(view.draft.phone?.trim()?['phone' as const]:[]),...(view.draft.email?.trim()?['email' as const]:[])]} canSave={canSave} retry={reviewAndSave} edit={()=>{review.dismiss();document.getElementById('phone')?.focus();}} save={saveAsEntered}/>}
    {(!review.active||review.active.state==='checking')&&<button type="submit" disabled={!canSave||!!review.active}>Save lead</button>}</form>
    <details className="lead-reference-links" key={key+':links'} open={Boolean(view.selected?.customer_id||view.selected?.source_id)}>
     <summary>Customer and source links <span className="field-help">{view.draft.customerId||view.draft.sourceId?'Linked records':'Optional'}</span></summary>
    {view.businessId&&<><ReferencePicker key={key+':customer'} businessId={view.businessId} kind="customer" value={view.draft.customerId} disabled={disabled} change={value=>edit('customerId',value)}/><ReferencePicker key={key+':source'} businessId={view.businessId} kind="source" value={view.draft.sourceId} disabled={disabled} change={value=>edit('sourceId',value)}/></>}
    {view.selected?.source_snapshot&&view.draft.sourceId===view.selected.source_id&&<p>Retained source attribution: {view.selected.source_snapshot.label} · {view.selected.source_snapshot.kind}. Later source edits do not replace this snapshot.</p>}
    </details>
   </div>}
   {view.selected&&view.businessId&&<div id="lead-status" tabIndex={-1} className="lead-record-task"><LeadStatusPanel key={'status:'+view.businessId+':'+view.selected.id+':'+conversionGeneration} businessId={view.businessId} leadId={view.selected.id} disabled={view.busy||dirty||vehicleLocked||addressLocked||conversionLocked} onLock={setStatusLocked} onCommitted={statusChanged}/></div>}
   {view.selected&&view.businessId&&<div id="lead-vehicles" tabIndex={-1} className="lead-record-task"><LeadVehiclePanel key={'vehicles:'+view.businessId+':'+view.selected.id+':'+conversionGeneration} businessId={view.businessId} leadId={view.selected.id} disabled={view.busy||dirty||statusLocked||addressLocked||conversionLocked} onLock={setVehicleLocked}/></div>}
   {view.selected&&view.businessId&&<div id="lead-addresses" tabIndex={-1} className="lead-record-task"><LeadAddressPanel key={'addresses:'+view.businessId+':'+view.selected.id+':'+conversionGeneration} businessId={view.businessId} leadId={view.selected.id} disabled={view.busy||dirty||statusLocked||vehicleLocked||conversionLocked} onLock={setAddressLocked} {...addressAssist?{assist:addressAssist}:{}}/></div>}
   {view.history&&<LeadHistory history={view.history} busy={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked} onMore={()=>void action('moreHistory')}/>}
   </section>
   {view.businessId&&initialRecordReady&&<div id="lead-conversion" tabIndex={-1} className="lead-record-task lead-conversion-outlet" hidden={view.draft!==null&&!showingRecord}><LeadConversionPanel key={'conversion:'+view.businessId+':'+(view.selected?.id??'none')} businessId={view.businessId} leadId={view.selected?.id??null} disabled={view.busy||dirty||statusLocked||vehicleLocked||addressLocked} onLock={setConversionLocked} onCommitted={conversionCommitted}/></div>}
   </div>
  </>}
  {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p><button type="button" disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked} onClick={()=>void action('check')}>Check lead save status</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked} onClick={()=>void action('retry')}>Retry original lead change</button>}{view.reference&&<details className="save-review-reference"><summary>Original save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details>}</>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy||statusLocked||vehicleLocked||addressLocked||conversionLocked} onClick={()=>void action('load')}>Load current leads</button>}
<nav aria-label="Lead navigation"><a href="/save-review">Review interrupted save</a><a href="/lead-sources">Lead sources</a><a href="/customers">Customers</a><a href="/vehicles">Vehicles</a><SignInLink returnTo="leads">Device sign-in and sign-out</SignInLink><a href="/">Crest OS home</a></nav>
  <p className="field-help">Synthetic testing is in progress. Intake, manual status changes and explicitly enabled conversion are under synthetic testing. Real-data use remains unavailable.</p>
 </section>;
}
