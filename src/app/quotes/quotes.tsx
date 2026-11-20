'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createQuoteEditorController,initialQuoteEditorView} from '../../client/quote-editor-controller';
import {createPendingQuoteStore} from '../../client/pending-quote-edit';
import {createPendingQuoteReviewStore} from '../../client/pending-quote-review';
import {createPendingQuoteCommercialStore} from '../../client/pending-quote-commercial';
import {createPendingQuoteAmendmentStore} from '../../client/pending-quote-amendment';
import {createPendingQuoteReplacementStore} from '../../client/pending-quote-replacement';
import type {QuoteCommercialCommitted} from '../../commercial/quote-commercial-contract';
import {QuoteCommercialPanel} from './quote-commercial-panel';
import {QuoteHistoryEvents} from './quote-history-events';
import {QuoteReplacementPanel} from './quote-replacement-panel';
import type {QuoteCommitted} from '../../commercial/quote-storage-contract';
import type {QuoteReviewCommitted} from '../../commercial/quote-review-contract';
import {QuoteReviewPanel} from './quote-review-panel';
import {QuoteObservationFields} from './quote-observation';
import {enableQuoteReviewDraft,parseQuoteDraft,quoteLocationFromAddress} from '../../client/quote-draft';
import type {QuoteDraft,QuoteLineDraft} from '../../client/quote-draft';
import {prepareVersionedQuoteContent as prepareQuoteContent} from '../../commercial/quote-review-content';
import {quoteMoney} from '../../commercial/quote-pricing';
import {initialConditionClasses} from '../../commercial/catalog-options';
import {PhoneInput} from '../customers/phone-input';
import {SearchSaved,DiscountFields,QuoteExpiry} from './quote-fields';
import {QuoteDocument} from './quote-document';
import {QuoteRecordDownload} from './saved-quote-download';

export function QuoteScreen({initialCustomerId=null}:{initialCustomerId?:string|null}={}){
 const [view,setView]=useState(initialQuoteEditorView),current=useRef<ReturnType<typeof createQuoteEditorController>|null>(null),heading=useRef<HTMLHeadingElement>(null),focus=useRef<string|null|undefined>(undefined),[formSequence,setFormSequence]=useState(0);
 const [mode,setMode]=useState<'edit'|'preview'>('edit');
 const [showRecord,setShowRecord]=useState(Boolean(initialCustomerId));
 const [directoryCollapsed,setDirectoryCollapsed]=useState(false),revealDirectory=useRef(false);
 const directoryTrigger=useRef<HTMLElement|null>(null),directoryHeading=useRef<HTMLHeadingElement>(null),returnToDirectory=useRef(false);
 const directoryScroll=useRef<number|null>(null),resumeTrigger=useRef<HTMLButtonElement>(null),returnToResume=useRef(false);
 const toolbar=useRef<HTMLDivElement>(null),compose=useRef<HTMLDivElement>(null);
 const reviewBusy=useRef(false),[reviewWorking,setReviewWorking]=useState(false),commercialBusy=useRef(false),[commercialWorking,setCommercialWorking]=useState(false),[pendingNotice,setPendingNotice]=useState(''),replacementBusy=useRef(false),[replacementWorking,setReplacementWorking]=useState(false),acceptedFamilies=useRef(new Set<string>()),verifiedCommercial=useRef<string|null>(null),selectedIdentity=useRef<Readonly<{key:string;familyId:string}>|null>(null),commercialRequired=useRef(false),[commercialAccess,setCommercialAccess]=useState<Readonly<{key:string|null;acceptedIds:readonly string[]}>>({key:null,acceptedIds:[]});
 const quoteNavigationBlocked=reviewWorking||commercialWorking||replacementWorking;
 const quoteWorking=quoteNavigationBlocked||pendingNotice.length>0;
 const refreshPendingNotice=useCallback(()=>{try{const pending=createPendingQuoteCommercialStore(sessionStorage).read()??createPendingQuoteReviewStore(sessionStorage).read()??createPendingQuoteReplacementStore(sessionStorage).read()??createPendingQuoteAmendmentStore(sessionStorage,'quote.amendment.create').read()??createPendingQuoteAmendmentStore(sessionStorage,'quote.amendment.send').read();setPendingNotice(pending?'A quote action is awaiting verification in this tab. Open its saved quote or use interrupted save review.':'');}catch{setPendingNotice('An interrupted quote reference could not be read. Review it before recording another action.');}},[]);
 const onReviewLock=useCallback((locked:boolean)=>{reviewBusy.current=locked;setReviewWorking(locked);refreshPendingNotice();},[refreshPendingNotice]);
 const onCommercialLock=useCallback((locked:boolean)=>{commercialBusy.current=locked;setCommercialWorking(locked);refreshPendingNotice();},[refreshPendingNotice]);
 const onReplacementLock=useCallback((locked:boolean)=>{replacementBusy.current=locked;setReplacementWorking(locked);refreshPendingNotice();},[refreshPendingNotice]);
 const onFamilyAccepted=useCallback((accepted:boolean|null)=>{const selected=selectedIdentity.current;if(accepted===null){verifiedCommercial.current=null;}else if(selected){verifiedCommercial.current=selected.key;if(accepted)acceptedFamilies.current.add(selected.familyId);}setCommercialAccess({key:verifiedCommercial.current,acceptedIds:[...acceptedFamilies.current]});},[]);
 const onReplacementCommitted=useCallback(async(result:QuoteCommitted)=>{await current.current?.openAfterReplacement(result);},[]);
 const onCommercialCommitted=useCallback(async(result:QuoteCommercialCommitted)=>{await current.current?.openAfterCommercial(result);},[]);
 const onOpenRevision=useCallback(async(familyId:string,revisionId:string)=>{await current.current?.openRevision(familyId,revisionId);},[]);
 const onReviewCommitted=useCallback(async(result:QuoteReviewCommitted)=>{await current.current?.openAfterReview(result);},[]);
 const {dirty}=view;
 useEffect(()=>{const controller=createQuoteEditorController({store:createPendingQuoteStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:value=>{commercialRequired.current=value.commercialAvailable;const selected=value.selected;selectedIdentity.current=selected?{key:[selected.family.id,selected.family.version,selected.revision.id,selected.revision.version].join(':'),familyId:selected.family.id}:null;setView(value);},readOnly:()=>{const selected=selectedIdentity.current;return selected!==null&&commercialRequired.current&&(acceptedFamilies.current.has(selected.familyId)||verifiedCommercial.current!==selected.key);},blocked:()=>{try{return reviewBusy.current||commercialBusy.current||replacementBusy.current||createPendingQuoteReviewStore(sessionStorage).read()!==null||createPendingQuoteCommercialStore(sessionStorage).read()!==null||createPendingQuoteReplacementStore(sessionStorage).read()!==null||createPendingQuoteAmendmentStore(sessionStorage,'quote.amendment.create').read()!==null||createPendingQuoteAmendmentStore(sessionStorage,'quote.amendment.send').read()!==null;}catch{return true;}}});current.current=controller;queueMicrotask(()=>{if(current.current===controller)refreshPendingNotice();});if(initialCustomerId)focus.current=null;void controller.load(initialCustomerId??undefined);const clearFamilyFacts=()=>{directoryTrigger.current=null;directoryScroll.current=null;returnToResume.current=false;returnToDirectory.current=false;acceptedFamilies.current.clear();verifiedCommercial.current=null;setCommercialAccess({key:null,acceptedIds:[]});},hidden=()=>{if(document.visibilityState==='hidden'){clearFamilyFacts();controller.suspend();}},leave=()=>{clearFamilyFacts();controller.suspend();},restore=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);return ()=>{current.current=null;controller.dispose();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};},[initialCustomerId,refreshPendingNotice]);
 useLayoutEffect(()=>{
  if(revealDirectory.current&&!directoryCollapsed&&view.phase==='ready'){
   revealDirectory.current=false;directoryHeading.current?.focus();directoryHeading.current?.scrollIntoView({block:'nearest'});
  }
  if(returnToDirectory.current&&!showRecord&&view.phase==='ready'){
   returnToDirectory.current=false;
   const trigger=returnToResume.current?resumeTrigger.current:directoryTrigger.current;
   const target=trigger?.isConnected&&!trigger.matches(':disabled')?trigger:directoryHeading.current;
   if(directoryScroll.current===null)target?.focus();
   else{target?.focus({preventScroll:true});window.scrollTo({top:directoryScroll.current,behavior:'instant'});}
  }
  if(focus.current===undefined||view.busy)return;
  if(showRecord&&view.phase==='ready'&&view.draft&&(view.selected?.family.id??null)===focus.current)heading.current?.focus();
  focus.current=undefined;
 },[showRecord,view,directoryCollapsed]);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return ()=>window.removeEventListener('beforeunload',leave);},[dirty,view.phase,view.busy]);
 function discard(){if(reviewBusy.current||commercialBusy.current||replacementBusy.current)return false;return !current.current?.view().dirty||window.confirm('Discard your unsaved quote changes? Choose Cancel to keep editing.');}
 function rememberDirectory(trigger:HTMLElement){returnToResume.current=false;directoryTrigger.current=trigger;directoryScroll.current=window.scrollY;}
 function create(trigger:HTMLElement){if(discard()){rememberDirectory(trigger);setShowRecord(true);setMode('edit');focus.current=null;setFormSequence(value=>value+1);current.current?.create();}}
 function resume(fromResume=false){if(!showRecord){returnToResume.current=fromResume;directoryScroll.current=window.scrollY;}focus.current=view.selected?.family.id??null;setShowRecord(true);}
 function backToDirectory(){revealDirectory.current=false;setDirectoryCollapsed(false);returnToDirectory.current=true;setShowRecord(false);}
 function toggleDirectory(){if(directoryCollapsed)revealDirectory.current=true;setDirectoryCollapsed(value=>!value);}
 async function open(familyId:string,trigger:HTMLElement){
  if(!showRecord&&view.selected?.family.id===familyId&&view.draft&&view.dirty){rememberDirectory(trigger);resume();return;}
  if(discard()){rememberDirectory(trigger);setShowRecord(true);setMode('edit');focus.current=familyId;await current.current?.open(familyId);}
 }
 function switchMode(next:typeof mode){
  if(next===mode)return;
  setMode(next);
  if(compose.current&&toolbar.current&&compose.current.getBoundingClientRect().top<toolbar.current.getBoundingClientRect().bottom){
   compose.current.scrollIntoView({block:'start'});
  }
 }
 const selectedKey=view.selected?[view.selected.family.id,view.selected.family.version,view.selected.revision.id,view.selected.revision.version].join(':'):null;
 const commercialUnverified=view.commercialAvailable&&selectedKey!==null&&commercialAccess.key!==selectedKey;
 const acceptedDraft=!!view.selected&&commercialAccess.acceptedIds.includes(view.selected.family.id)&&['Draft','Ready for Review'].includes(view.selected.revision.state);
 const retained=!!view.selected&&!['Draft','Ready for Review'].includes(view.selected.revision.state);
 const DraftFields=retained?'details':'div';
 const draft=view.draft,edit=(patch:Partial<QuoteDraft>)=>{if(draft)current.current?.edit({...draft,...patch});},editLine=(id:string,patch:Partial<QuoteLineDraft>)=>{if(draft)edit({lines:draft.lines.map(line=>line.id===id?{...line,...patch}:line)});};
 const saved=view.selected?.revision;
 const unsaved=dirty||!saved;
 const state=saved?.state==='Sent'?'Shared':saved?.state??'Draft';
 const stage=unsaved?'draft':saved.state==='Sent'?'sent':saved.state==='Accepted'?'accepted':saved.state==='Superseded'?'superseded':saved.state==='Ready for Review'?'review':'draft';
 let preview:ReturnType<typeof prepareQuoteContent>['customer']|null=null;
 if(!unsaved)preview=saved.customer_safe_snapshot;
 else if(draft)try{preview=prepareQuoteContent(parseQuoteDraft(draft)).customer;}catch{/* The preview requires complete, valid content. */}
 const reviewAvailable=view.reviewAvailable&&!retained&&!acceptedDraft&&!commercialUnverified&&view.selected;
 const commercialAvailable=view.commercialAvailable&&view.selected;
 return <>
  <p role="status" aria-label="Quote status" className={view.phase==='ready'?'quote-directory-status':'notice'}>{view.message}</p>
  {pendingNotice&&<p role="status" className="notice">{pendingNotice} <a href="/save-review">Review interrupted quote actions</a></p>}
  {view.phase==='unavailable'&&<p><a href="/sign-in?returnTo=quotes">Sign in to view quotes</a></p>}
  {view.phase!=='ready'&&view.phase!=='loading'&&<div className="actions">{view.phase==='pending'?<><button type="button" disabled={view.busy||quoteWorking} onClick={()=>void current.current?.check()}>Check original quote save</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy||quoteWorking} onClick={()=>void current.current?.retry()}>Retry unchanged original quote</button>}<a href="/save-review">Review interrupted saves</a>{view.reference&&<p className="field-help">Original operation: <span className="record-reference">{view.reference}</span></p>}</>:<button type="button" disabled={view.busy||quoteNavigationBlocked} onClick={()=>{const customerId=view.phase==='unavailable'?initialCustomerId:null;if(customerId)focus.current=null;void current.current?.load(customerId??undefined);}}>Load saved quotes</button>}</div>}
  {view.phase==='ready'&&<div className="service-layout quote-layout" data-mobile-record={showRecord&&draft!==null} data-directory-collapsed={directoryCollapsed&&showRecord&&draft!==null}><section id="quote-saved-directory" className="service-directory-panel" aria-labelledby="quote-directory-heading"><h2 id="quote-directory-heading" ref={directoryHeading} tabIndex={-1}>Saved quotes</h2>
   {draft&&!showRecord&&<button type="button" className="secondary quote-resume" ref={resumeTrigger} onClick={()=>resume(true)}>{dirty||!view.selected?'Continue unsaved quote':'Return to open quote'}</button>}
   <div className="service-toolbar"><button type="button" className="quote-add" disabled={view.busy||view.writesPaused||quoteWorking} onClick={event=>create(event.currentTarget)}>New quote</button><button type="button" className="secondary" disabled={view.busy||quoteNavigationBlocked} onClick={()=>{if(discard())void current.current?.load();}}>Reload saved quotes</button></div>
   <form className="service-search" onSubmit={event=>{event.preventDefault();if(discard())void current.current?.query(String(new FormData(event.currentTarget).get('search')??''));}}><label>Find a quote<input name="search" type="search" maxLength={200} defaultValue={view.search} key={view.search} disabled={view.busy||quoteNavigationBlocked}/></label><button type="submit" className="secondary" disabled={view.busy||quoteNavigationBlocked}>Search quotes</button></form>
   <ul className="customer-list" aria-label="Saved quotes">{view.rows.map(row=><li key={row.family.id}>{row.revision.kind==='amendment'?<><strong>{row.revision.customer_safe_snapshot.title}</strong><p>{row.revision.customer_safe_snapshot.recipient.displayName} · Amendment {row.revision.state} · {quoteMoney(row.revision.total_cents)}</p><a href="/quotes/amendments">Open amendment workspace</a></>:<button type="button" className="secondary" aria-current={view.selected?.family.id===row.family.id?'true':undefined} disabled={view.busy||quoteNavigationBlocked} onClick={event=>void open(row.family.id,event.currentTarget)}><strong>{row.revision.customer_safe_snapshot.title}</strong><span>{row.revision.customer_safe_snapshot.recipient.displayName} · {quoteMoney(row.revision.total_cents)} · {row.revision.state==='Ready for Review'?'Review':row.revision.state} version {row.revision.version}</span></button>}</li>)}</ul>
   {!view.rows.length&&<p>No saved quotes match this search. Start a quote or change the search.</p>}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy||quoteNavigationBlocked} onClick={()=>{if(discard())void current.current?.query(view.search,true);}}>Next quote page</button>}
  </section>{draft?<section id="quote-current-record" className="service-definition-panel quote-record" aria-labelledby="quote-editor-heading">
   <header className="quote-record-header">
    <div className="quote-record-heading">
     <h2 id="quote-editor-heading" ref={heading} tabIndex={-1}>{retained?'Retained quote':saved?'Edit saved draft':'New quote'}</h2>
     <button type="button" className="secondary quote-directory-back" onClick={backToDirectory}>Back to saved quotes</button>
    </div>
    {saved&&<p className="quote-record-title">{saved.customer_safe_snapshot.title}</p>}
    {(saved||draft.recipientName.trim())&&<p className="quote-record-recipient">{saved?saved.customer_safe_snapshot.recipient.displayName:draft.recipientName}</p>}
    <p className="quote-record-state"><strong>{state}</strong>{saved&&<> · Version {saved.version}</>}{dirty&&<> · Unsaved changes</>}</p>
    {saved&&<p className="quote-record-date">Saved <time dateTime={saved.updated_at}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:saved.timezone}).format(new Date(saved.updated_at))}</time></p>}
   </header>
   <div className="quote-record-toolbar" ref={toolbar}>
     <button type="button" className="secondary quote-directory-toggle" aria-expanded={!directoryCollapsed} aria-controls="quote-saved-directory" onClick={toggleDirectory}>{directoryCollapsed?'Show saved quotes':'Hide saved quotes'}</button>
    <div className="quote-record-total"><span>{unsaved?'Draft total':'Saved quote total'}</span><strong>{preview?quoteMoney(preview.totalCents):'Pending'}</strong></div>
    <div className="quote-mode-controls" role="group" aria-label="Quote view">
     <button type="button" className="secondary" aria-pressed={mode==='edit'} aria-controls="quote-edit" onClick={()=>switchMode('edit')}>{retained?'Details':'Edit'}</button>
     <button type="button" className="secondary" aria-pressed={mode==='preview'} aria-controls="quote-preview" onClick={()=>switchMode('preview')}>Preview</button>
    </div>
    {!retained&&<button className="quote-save" type="submit" form="quote-draft-form" disabled={!view.canSave||quoteWorking||acceptedDraft||commercialUnverified}>Save quote draft</button>}
   </div>
   {(reviewAvailable||commercialAvailable||view.history)&&<nav className="quote-record-links" aria-label="Quote actions">
    {reviewAvailable&&<a href="#quote-review-heading">Review &amp; approval</a>}
    {commercialAvailable&&<a href="#quote-commercial-heading">Sharing &amp; acceptance</a>}
    {commercialAvailable&&saved?.state==='Sent'&&<a href="#quote-replacement">Replacement</a>}
    {view.history&&<a href="#quote-history-heading">History</a>}
   </nav>}
   {commercialUnverified&&<p role="status" className="notice">Saved sharing and acceptance facts must be verified before editing. Reload sharing status below if the check fails.</p>}
   {acceptedDraft&&<p className="notice">An earlier offer in this quote family was accepted. This remaining draft is retained for history and cannot change that agreement. Open the accepted quote below.</p>}
   <div id="quote-compose" className="quote-compose" data-mode={mode} data-retained={retained} ref={compose}>
   <div id="quote-edit" className="quote-edit">
   {!retained&&<p className="field-help">Unsaved changes clear when you leave or hide this page.</p>}
   <DraftFields key={retained?selectedKey:undefined}>
   {retained&&<summary>Saved draft fields</summary>}
   <form id="quote-draft-form" aria-label="Quote draft" onSubmit={event=>{event.preventDefault();void current.current?.save();}}><fieldset disabled={view.busy||view.writesPaused||quoteWorking||retained||acceptedDraft||commercialUnverified}>
    <label>Quote title<input value={draft.title} maxLength={200} onChange={event=>edit({title:event.target.value})} required/></label>
    <section aria-label="Quote recipient selection"><h3>Customer or lead</h3>{!view.selected&&<details open={draft.customerId===null&&draft.leadId===null}><summary>{draft.customerId===null?'Choose a saved customer':'Choose a different customer'}</summary><SearchSaved label="Find saved customers" busy={view.busy} find={value=>void current.current?.findCustomers(value)}/><ul className="customer-list">{view.customerRows.map(customer=><li key={customer.id}><button type="button" className="secondary" onClick={()=>current.current?.chooseCustomer(customer.id)}>{customer.display_name}{customer.phone_raw?' · '+customer.phone_raw:''}</button></li>)}</ul>{view.moreCustomers&&<button type="button" className="secondary" onClick={()=>void current.current?.findCustomers(view.customerSearch,true)}>Next customer page</button>}<p className="field-help">Only saved active customers appear. <a href="/customers">Manage customers</a> before starting a quote if needed.</p></details>}
     {!view.selected&&<details open={draft.leadId!==null}><summary>{draft.leadId===null?'Choose a saved lead instead':'Choose a different lead'}</summary><SearchSaved label="Find saved leads" busy={view.busy} find={value=>void current.current?.findLeads(value)}/><ul className="customer-list">{view.leadRows.map(lead=><li key={lead.id}><button type="button" className="secondary" onClick={()=>current.current?.chooseLead(lead.id)}>{lead.label}{lead.phone_raw?' · '+lead.phone_raw:''}<span>{lead.state.replaceAll('_',' ')}{lead.customer_id!==null?' · Already linked to a customer':''}</span></button></li>)}</ul>{view.moreLeads&&<button type="button" className="secondary" onClick={()=>void current.current?.findLeads(view.leadSearch,true)}>Next lead page</button>}<p className="field-help">Choose a saved lead to copy its name and contact details. Its existing customer link is kept; this does not convert the lead. Lost leads are excluded. <a href="/leads">Manage leads</a>.</p></details>}
     {(draft.leadId!==null||draft.customerId!==null)&&<p className="field-help">{draft.leadId!==null?'Linked to the selected lead'+(draft.customerId!==null?' and its existing customer.':'.'):'Linked to the selected customer.'}</p>}
     <label>Recipient name<input value={draft.recipientName} maxLength={200} onChange={event=>edit({recipientName:event.target.value})} required/></label><p className="field-help">Contact details are copied for this quote. Editing them here does not change the customer or lead record.{view.selected?' This draft keeps its original linked customer or lead.':''}</p>
     <details><summary>Contact details (optional)</summary><fieldset><legend>Phone (optional)</legend><PhoneInput name="quote-recipient-phone" value={draft.phone} limit={512} change={phone=>edit({phone})}/></fieldset><label>Email<input inputMode="email" autoComplete="email" value={draft.email} maxLength={512} onChange={event=>edit({email:event.target.value})}/></label></details>
    </section>
    {draft.customerId!==null&&<details><summary>Use a saved customer address</summary><button type="button" className="secondary" onClick={()=>void current.current?.loadAddresses()}>Load saved customer addresses</button><ul className="customer-list">{view.addressRows.map(address=>{const location=quoteLocationFromAddress(address);return <li key={address.id}><button type="button" className="secondary service-scope" disabled={!location.length} onClick={()=>{if(draft.workLocation&&draft.workLocation!==location&&!window.confirm('Replace the current work location with this saved address?'))return;current.current?.chooseAddress(address.id);}}>{location||'No written location or coordinates recorded'}</button></li>;})}</ul>{view.moreAddresses&&<button type="button" className="secondary" onClick={()=>void current.current?.loadAddresses(true)}>Next address page</button>}{view.addressesLoaded&&view.addressRows.length===0&&<p>No active saved addresses were found. Enter the work location below.</p>}<p className="field-help">Selecting an address copies its recorded location only. Instructions and private notes are excluded. No address is selected or changed automatically.</p></details>}
    <label>Work location<textarea value={draft.workLocation} maxLength={4000} rows={3} onChange={event=>edit({workLocation:event.target.value})} required/></label>
    {draft.lines.map((line,index)=><fieldset key={line.id}><legend>Line {index+1}</legend><label>Work description<input value={line.description} maxLength={200} onChange={event=>editLine(line.id,{description:event.target.value})} required/></label>
     <details><summary>Copy a saved service scope</summary><SearchSaved label={'Find saved services for line '+(index+1)} busy={view.busy} find={value=>void current.current?.findServices(value)}/><ul className="customer-list">{view.serviceRows.map(service=><li key={service.service.id}><button type="button" className="secondary" onClick={()=>{if((line.description||line.inclusions||line.exclusions)&&!window.confirm('Replace this line’s description, included work and exclusions with the selected saved service? Your entered amount stays unchanged.'))return;current.current?.copyService(line.id,service.service.id);}}>Copy {service.content.name}</button></li>)}</ul>{view.moreServices&&<button type="button" className="secondary" onClick={()=>void current.current?.findServices(view.serviceSearch,true)}>Next service page</button>}<p className="field-help">Scope is copied from the selected saved version. Later catalog edits do not replace this line, and guidance never fills an offered amount.</p></details>
     <label>Scope<select value={line.scope==='unselected'?'':line.scope} onChange={event=>editLine(line.id,{scope:(event.target.value||'unselected') as QuoteLineDraft['scope'],vehicleId:null,vehicleLabel:null,...draft.contentSchemaVersion===2?{category:null,condition:'',assessment:null,assessmentDraft:undefined,categoryOverrideNote:null}:{}})} required><option value="">Choose the scope</option><option value="vehicle">A saved vehicle</option><option value="job-wide">Explicit job-wide work</option></select></label>
     {line.scope==='vehicle'&&<details open={line.vehicleId===null}><summary>{line.vehicleLabel??'Choose a saved vehicle'}</summary><SearchSaved label={'Find saved vehicles for line '+(index+1)} busy={view.busy} find={value=>void current.current?.findVehicles(value)}/><ul className="customer-list">{view.vehicleRows.map(vehicle=><li key={vehicle.id}><button type="button" className="secondary" onClick={()=>current.current?.chooseVehicle(line.id,vehicle.id)}>{vehicle.label}<span>{[vehicle.year,vehicle.make,vehicle.model,vehicle.plate].filter(value=>value!==null).join(' · ')}</span></button></li>)}</ul>{view.moreVehicles&&<button type="button" className="secondary" onClick={()=>void current.current?.findVehicles(view.vehicleSearch,true)}>Next vehicle page</button>}</details>}
     {draft.contentSchemaVersion===2&&line.scope==='vehicle'&&<QuoteObservationFields line={line} zone={draft.timezone} change={patch=>editLine(line.id,patch)}/>}
     {draft.contentSchemaVersion===2&&line.scope==='job-wide'&&line.condition!==''&&<p className="notice">This older draft has a vehicle condition on job-wide work. <button type="button" className="secondary" onClick={()=>editLine(line.id,{condition:''})}>Remove the condition from job-wide work</button></p>}
     <label>Included work<textarea value={line.inclusions} rows={3} maxLength={8000} onChange={event=>editLine(line.id,{inclusions:event.target.value})}/></label>
     <label>All-in amount (USD)<input inputMode="decimal" maxLength={24} value={line.amount} onChange={event=>editLine(line.id,{amount:event.target.value})} required/></label>
     <details><summary>{draft.contentSchemaVersion===2?'Exclusions and discounts (optional)':'Condition, exclusions and discounts (optional)'}</summary>{draft.contentSchemaVersion!==2&&<><label>Condition<select value={line.condition} onChange={event=>editLine(line.id,{condition:event.target.value as QuoteLineDraft['condition']})}><option value="">Not assessed</option>{initialConditionClasses.map(condition=><option key={condition}>{condition}</option>)}</select></label>{line.condition==='Extreme'&&<p className="notice">Extreme condition will need explicit owner review before approval. It never adds a surcharge.</p>}</>}<label>Exclusions<textarea value={line.exclusions} rows={2} maxLength={8000} onChange={event=>editLine(line.id,{exclusions:event.target.value})}/></label><DiscountFields label={'Line '+(index+1)+' discount'} kind={line.discountKind} value={line.discount} change={(discountKind,discount)=>editLine(line.id,{discountKind,discount})}/><label className="checkbox"><input type="checkbox" checked={line.discountEligible} onChange={event=>editLine(line.id,{discountEligible:event.target.checked})}/>Eligible for the quote-wide discount</label></details>
     {(line.complimentaryReason.length>0||/^0(?:\.00?)?$/.test(line.amount.trim())||view.draftIssue.includes('complimentary-work reason'))&&<div><label htmlFor={'quote-complimentary-'+line.id}>Complimentary-work reason</label><textarea id={'quote-complimentary-'+line.id} aria-describedby={'quote-complimentary-help-'+line.id} value={line.complimentaryReason} rows={2} maxLength={1000} onChange={event=>editLine(line.id,{complimentaryReason:event.target.value})}/><p id={'quote-complimentary-help-'+line.id} className="field-help">Required when this line is reduced to zero; otherwise leave blank.</p></div>}
     <button type="button" className="secondary" onClick={()=>current.current?.removeLine(line.id)}>Remove line {index+1}</button>
    </fieldset>)}
    <button type="button" className="secondary" disabled={draft.lines.length>=1000} onClick={()=>current.current?.addLine()}>Add quote line</button>
    <details><summary>Quote-wide discount (optional)</summary><DiscountFields label="Quote-wide discount" kind={draft.discountKind} value={draft.discount} change={(discountKind,discount)=>edit({discountKind,discount})}/></details>
    <details><summary>Terms, proposed timing and expiry (optional)</summary><label>Terms<textarea value={draft.terms} rows={3} maxLength={8000} onChange={event=>edit({terms:event.target.value})}/></label><label>Proposed timing<textarea value={draft.proposedSchedule} rows={2} maxLength={2000} onChange={event=>edit({proposedSchedule:event.target.value})}/></label><p className="field-help">A proposal is not a confirmed appointment.</p><label>Quote time zone<input value={draft.timezone} maxLength={100} onChange={event=>edit({timezone:event.target.value})}/></label><p className="field-help">Initially uses this device’s named time zone. Review it before setting an expiry.</p><QuoteExpiry key={(view.selected?.revision.id??'new')+':'+formSequence+':'+draft.timezone} value={draft.expiryAt} zone={draft.timezone} change={expiryAt=>edit({expiryAt})}/></details>
    <details><summary>Internal notes (never in the customer preview)</summary><label>Internal notes<textarea value={draft.internalNotes} rows={3} maxLength={8000} onChange={event=>edit({internalNotes:event.target.value})}/></label></details>
    {view.draftIssue&&<p role="alert">{view.draftIssue}</p>}
   </fieldset></form>
   </DraftFields>
   </div>
   <section id="quote-preview" className="quote-preview" aria-labelledby="quote-preview-heading">
    <h3 id="quote-preview-heading">Customer preview</h3>
    {preview?<QuoteDocument quote={preview} stage={stage}/>:<p className="field-help">Complete the required quote fields to see the customer document and calculated total.</p>}
   </section>
   </div>
   <div className="quote-record-flow" data-retained={retained}>
    {reviewAvailable&&<QuoteReviewPanel key={reviewAvailable.revision.id+':'+reviewAvailable.revision.version} row={reviewAvailable} dirty={dirty} blocked={commercialWorking||replacementWorking} commercialAvailable={view.commercialAvailable} onLock={onReviewLock} onCommitted={onReviewCommitted} onPrepare={()=>edit(enableQuoteReviewDraft(draft))}/>}
    {commercialAvailable&&<QuoteCommercialPanel key={'commercial:'+commercialAvailable.revision.id+':'+commercialAvailable.revision.version} row={commercialAvailable} dirty={dirty} blocked={reviewWorking||replacementWorking} onFamilyAccepted={onFamilyAccepted} onLock={onCommercialLock} onCommitted={onCommercialCommitted} onOpenRevision={onOpenRevision}/>}
    {commercialAvailable&&<div id="quote-replacement"><QuoteReplacementPanel key={'replacement:'+commercialAvailable.revision.id+':'+commercialAvailable.revision.version} row={commercialAvailable} dirty={dirty} blocked={reviewWorking||commercialWorking} onLock={onReplacementLock} onCommitted={onReplacementCommitted}/></div>}
    {view.history&&<section aria-labelledby="quote-history-heading"><h3 id="quote-history-heading">Saved quote history</h3>
     {view.selected&&<QuoteRecordDownload row={view.selected} disabled={view.busy||dirty||quoteWorking}/>}
     <QuoteHistoryEvents events={view.history.history}/>{view.history.hasMore&&<button type="button" className="secondary" disabled={view.busy||quoteWorking} onClick={()=>void current.current?.moreHistory()}>Next quote history page</button>}</section>}
    {!view.history&&view.selected&&<QuoteRecordDownload row={view.selected} disabled={view.busy||dirty||quoteWorking}/>}
   </div>
  </section>:<section className="service-choice quote-unselected"><h2>Open a quote</h2><p>Choose a saved quote to review its price, status and history.</p></section>}</div>}
  {view.phase==='ready'&&!view.commercialAvailable&&<p className="field-help">{view.reviewAvailable?'This workspace supports draft review and owner approval.':'This workspace supports draft preparation.'}</p>}
 </>;
}
