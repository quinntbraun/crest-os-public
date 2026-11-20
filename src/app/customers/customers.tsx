'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent,ComponentType} from 'react';
import {createCustomerEditorController,initialCustomerEditorView,emptyCustomerDraft} from '../../client/customer-editor-controller';
import {createPendingCustomerStore} from '../../client/pending-customer-edit';
import {NullableText} from './nullable-text';
import {DirectoryIntroduction} from '../directory-introduction';
import {phonePresentation} from '../../client/phone-presentation';
import type {Customer,CustomerDraft} from '../../customer/customer-contract';
import {SavedRecordDownload} from '../saved-record-download';
import {ReviewMessageHistory} from '../review-message-history';
import {MaintenanceReminders} from '../maintenance-reminders';
import {draftFromCustomer} from '../../customer/customer-contract';
import {draftChanged} from '../../client/draft-changed';
import {CustomerPayments} from './customer-payments';
import {RecordJobHistory} from '../schedule/record-job-history';
import {useCustomerProfile} from './use-customer-profile';

function CustomerDetails({customer}:{customer:Customer}){
  const unknown=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
  return <dl className="customer-values"><dt>Name</dt><dd>{customer.display_name}</dd><dt>Phone</dt><dd>{unknown(customer.phone_raw)}</dd><dt>Email</dt><dd>{unknown(customer.email_raw)}</dd><dt>Contact preference</dt><dd>{unknown(customer.contact_preference)}</dd><dt>Outreach</dt><dd>{customer.outreach_opt_out?'Opted out':'Not opted out'}</dd><dt>Customer since</dt><dd>{unknown(customer.customer_since)}</dd><dt>Notes</dt><dd>{unknown(customer.notes)}</dd><dt>Status</dt><dd>{customer.archived_at===null?'Active':'Archived: '+customer.archived_reason}</dd></dl>;
}
const sectionLabels={overview:'Overview',vehicles:'Vehicles',visits:'Visits',payments:'Payments',history:'History'} as const;
type CustomerSection=keyof typeof sectionLabels;

function VisitLink({visit}:{visit:{jobId:string;at:string;timezone:string}}){
  const formatted=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:visit.timezone}).format(new Date(visit.at));
  return <a href={'/schedule?'+new URLSearchParams({job:visit.jobId,from:'customer'})}><time dateTime={visit.at}>{formatted}</time></a>;
}

export function CustomerScreen({related:Related,initialCustomerId=null,initialSection='overview',initialVehicleFocus=null}:{
  related?:ComponentType<{customerId:string}>;
  initialCustomerId?:string|null;
  initialSection?:CustomerSection;
  initialVehicleFocus?:string|null;
}={}){
  const [section,setSection]=useState<CustomerSection>(initialSection);
  const [showRecord,setShowRecord]=useState(Boolean(initialCustomerId));
  const directoryTrigger=useRef<HTMLElement|null>(null);
  const returnFocus=useRef(false);
  const panelHeading=useRef<HTMLHeadingElement>(null);
  const vehicleFocus=useRef(initialVehicleFocus),relatedVehicle=useRef<HTMLAnchorElement>(null);
  const [view,setView]=useState(initialCustomerEditorView),current=useRef<ReturnType<typeof createCustomerEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const dirty=draftChanged(view.draft,view.selected?draftFromCustomer(view.selected):emptyCustomerDraft);
  const focusRequest=useRef<{controller:NonNullable<typeof current.current>;id:string|null}|null>(null),editorVisible=view.draft!==null,selectedId=view.selected?.id??null;
  const profileAvailable=view.customerProfileAvailable===true;
  const customerProfile=useCustomerProfile(profileAvailable?view.selected?.business_id??null:null,profileAvailable?selectedId:null);
  const {profile}=customerProfile;
  const sections:CustomerSection[]=['overview','vehicles'];
  if(view.recordJobHistoryAvailable)sections.push('visits');
  if(view.selected?.archived_at===null)sections.push('payments');
  sections.push('history');
  const activeSection=selectedId&&sections.includes(section)?section:'overview';
  useLayoutEffect(()=>{
    if(returnFocus.current&&!showRecord){
      returnFocus.current=false;
      const target=directoryTrigger.current;
      (target?.isConnected?target:document.getElementById('customer-search'))?.focus();
    }
    const requested=focusRequest.current;
    if(!requested||view.busy)return;
    if(current.current===requested.controller&&view.phase==='ready'&&editorVisible&&selectedId===requested.id){
      if(activeSection==='overview')heading.current?.focus();
      else if(activeSection!=='visits')panelHeading.current?.focus();
    }
    focusRequest.current=null;
  },[activeSection,editorVisible,selectedId,showRecord,view]);
  useEffect(()=>{
    if(selectedId===initialCustomerId&&showRecord&&activeSection==='vehicles'&&relatedVehicle.current&&vehicleFocus.current){
      relatedVehicle.current.focus();
      vehicleFocus.current=null;
    }
  },[activeSection,initialCustomerId,profile,selectedId,showRecord]);
  useEffect(()=>{
    const controller=createCustomerEditorController({store:createPendingCustomerStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;
    void (async()=>{
      await controller.load();
      if(!initialCustomerId||current.current!==controller||controller.view().phase!=='ready')return;
      focusRequest.current={controller,id:initialCustomerId};
      await controller.open(initialCustomerId);
    })();
    const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
    return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
  },[initialCustomerId]);
  useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[dirty,view.phase,view.busy]);
  function discardAllowed(){const state=current.current?.view();return !state||!draftChanged(state.draft,state.selected?draftFromCustomer(state.selected):emptyCustomerDraft)||window.confirm('Discard your unsaved customer changes? Choose Cancel to keep editing.');}
  async function open(id:string,trigger:HTMLElement){
    const controller=current.current;
    if(!controller)return;
    directoryTrigger.current=trigger;
    if(!showRecord&&selectedId===id&&editorVisible){
      setShowRecord(true);
      focusRequest.current={controller,id};
      return;
    }
    if(!discardAllowed())return;
    setSection('overview');
    setShowRecord(true);
    focusRequest.current={controller,id};
    await controller.open(id);
  }
  function create(trigger:HTMLElement){
    const controller=current.current;
    if(!controller||!discardAllowed())return;
    directoryTrigger.current=trigger;
    setSection('overview');
    setShowRecord(true);
    focusRequest.current={controller,id:null};
    controller.create();
  }
  function backToDirectory(){
    returnFocus.current=true;
    setShowRecord(false);
  }
  function query(search:string,archived:boolean,more=false){if(discardAllowed())void current.current?.query(search,archived,more);}
  async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory') {const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
  function edit<K extends keyof CustomerDraft>(key:K,value:CustomerDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);query(String(data.get('search')??''),data.get('archived')==='on');}
  return <section className="customer-directory" aria-label="Customer directory" aria-busy={view.busy}>
    <p className="customer-directory-status" ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<>
      {view.writesPaused&&<p className="notice">Customer changes are paused. You can review current records and history.</p>}
      <div className="customer-directory-layout" data-mobile-record={showRecord&&editorVisible}>
      <section className="customer-lookup" aria-label="Customer lookup">
      <button className={'customer-add'+(view.selected?' secondary':'')} type="button" disabled={view.busy||view.writesPaused} onClick={event=>create(event.currentTarget)}>Add customer</button>
      <form className="customer-search" onSubmit={search} aria-label="Search customers">
        <label htmlFor="customer-search">Customer search</label>
        <div className="customer-search-row">
          <input id="customer-search" name="search" type="search" placeholder="Name, phone or email" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/>
          <button className="secondary" type="submit" aria-label="Search customers" disabled={view.busy}>Search</button>
        </div>
        <label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived customers</label>
      </form>
      {view.rows.length>0?<ul className="customer-list customer-directory-list">{view.rows.map(row=><li key={row.id}>
        <button type="button" className="secondary" aria-current={selectedId===row.id?'true':undefined} aria-describedby={'customer-contact-'+row.id} disabled={view.busy} onClick={event=>void open(row.id,event.currentTarget)}>
          {row.display_name}{row.archived_at!==null?' — archived':''}
        </button>
        <p className="customer-contact" id={'customer-contact-'+row.id}>{[row.phone_raw?phonePresentation(row.phone_raw):null,row.email_raw].filter(Boolean).join(' · ')||'Contact details not recorded'}</p>
      </li>)}</ul>:<p className="customer-directory-empty">{view.search||view.includeArchived?'No customers match this search.':'No customers yet. Use Add customer to create a record.'}</p>}
      {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>query(view.search,view.includeArchived,true)}>Next customer page</button>}
      </section>
      <div className="customer-record">
      {!view.draft&&!view.selected&&!view.busy&&<DirectoryIntroduction kind="customer" onSearch={()=>document.getElementById('customer-search')?.focus()}/>}
      {editorVisible&&<button type="button" className="secondary customer-directory-back" onClick={backToDirectory}>← Back to customers</button>}
      {view.selected&&<header className="customer-record-header customer-profile-identity" data-split-identity={profileAvailable&&!!(view.selected.phone_raw||view.selected.email_raw||view.selected.contact_preference)}>
        <div className="customer-record-title">
          <h2>{view.selected.display_name}</h2>
          {view.selected.archived_at===null&&!view.writesPaused&&<a className="record-return-link" href={'/quotes?customer='+encodeURIComponent(view.selected.id)}>Start a quote</a>}
        </div>
        {(view.selected.phone_raw||view.selected.email_raw||view.selected.contact_preference)&&<dl className="customer-profile-contact">
          {view.selected.phone_raw&&<div><dt>Phone</dt><dd>{phonePresentation(view.selected.phone_raw)}</dd></div>}
          {view.selected.email_raw&&<div><dt>Email</dt><dd>{view.selected.email_raw}</dd></div>}
          {view.selected.contact_preference&&<div><dt>Prefers</dt><dd>{view.selected.contact_preference}</dd></div>}
        </dl>}
        {(view.selected.archived_at!==null||view.selected.outreach_opt_out)&&<p className="customer-record-flags">
          {view.selected.archived_at!==null&&<span>Archived</span>}
          {view.selected.outreach_opt_out&&<span>Outreach opted out</span>}
        </p>}
        {profileAvailable&&<section className="customer-visit-summary" aria-label="Visit summary">
          {profile?<dl>
            <div><dt>Last completed visit</dt><dd>{profile.lastVisit?<VisitLink visit={profile.lastVisit}/>: 'No completed visit'}</dd></div>
            <div><dt>Next scheduled visit</dt><dd>{profile.nextVisit?<VisitLink visit={profile.nextVisit}/>: 'No upcoming visit'}</dd></div>
          </dl>:customerProfile.phase==='loading'?<p>Checking visits and vehicle links…</p>:<div>
            <p>Visits and vehicle links couldn’t be verified.</p>
            <button type="button" className="secondary" onClick={customerProfile.loadMore}>Retry customer summary</button>
          </div>}
        </section>}
      </header>}
      {view.selected&&<nav className="customer-record-sections" aria-label="Customer record sections">
        {sections.map(value=><button key={value} className="secondary" type="button" aria-current={activeSection===value?'true':undefined}
          aria-controls={'customer-panel-'+value} onClick={()=>setSection(value)}>{sectionLabels[value]}</button>)}
      </nav>}
      <div id="customer-panel-overview" className="customer-record-panel" hidden={activeSection!=='overview'||!editorVisible}>
      {view.draft&&<form className="customer-record-editor" onSubmit={submit} aria-label="Customer editor"><h2 ref={heading} tabIndex={-1} className="editor-heading">{view.selected?'Edit customer':'New customer'}</h2>
        <p className="field-help">Unsaved changes clear when you leave or hide this page.</p>
        <fieldset disabled={view.busy||view.writesPaused}><legend className="visually-hidden">Customer details</legend><label htmlFor="customer-name">Customer name</label><input id="customer-name" name="customer-name" autoComplete="off" maxLength={400} value={view.draft.displayName} onChange={event=>edit('displayName',event.target.value)} required/>
          {[...view.draft.displayName].length>160&&<p className="field-help">{[...view.draft.displayName].length}/200 characters.</p>}
          <NullableText name="phone" label="Phone" limit={512} value={view.draft.phone} disabled={view.busy} change={value=>edit('phone',value)}/>
          <NullableText name="email" label="Email" limit={512} value={view.draft.email} disabled={view.busy} change={value=>edit('email',value)}/>
          {view.draft.outreachOptOut&&<p className="notice">This customer has opted out of outreach.</p>}
          <details key={view.selected?.id??'new'} className="customer-extra"><summary>Notes and more customer details</summary>
          <NullableText name="preference" label="Contact preference" limit={200} value={view.draft.contactPreference} disabled={view.busy} change={value=>edit('contactPreference',value)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.outreachOptOut} onChange={event=>edit('outreachOptOut',event.target.checked)}/>Customer has opted out of outreach</label><p className="field-help">A missing opt-out flag does not establish permission to send messages. This editor sends no outreach.</p>
          <NullableText name="notes" label="Notes" multiline limit={2000} value={view.draft.notes} disabled={view.busy} change={value=>edit('notes',value)}/>
          <label htmlFor="customer-since">Customer-since date</label><input id="customer-since" name="customer-since" type="date" min="0001-01-01" max="9999-12-31" value={view.draft.customerSince??''} onChange={event=>edit('customerSince',event.target.value||null)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>current.current?.edit({...view.draft!,archived:event.target.checked,archiveReason:event.target.checked?'':null})}/>Archive customer</label>
          {view.draft.archived&&<><label htmlFor="archive-reason">Archive reason</label><textarea id="archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)} required/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1000 characters. Archiving retains the record and its history.</p></>}
          </details>
        </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>Save customer</button>
      </form>}
      {view.selected&&view.reviewHistoryAvailable&&<ReviewMessageHistory key={view.selected.id}
       businessId={view.selected.business_id} scope={{kind:'customer',id:view.selected.id}}/>}
      {view.selected&&view.maintenanceFollowUpAvailable&&<MaintenanceReminders key={view.selected.id}
       businessId={view.selected.business_id} scope={{kind:'customer',id:view.selected.id,archived:view.selected.archived_at!==null}}/>}
      </div>
      {view.selected&&<section id="customer-panel-vehicles" className="home-panel customer-record-panel" hidden={activeSection!=='vehicles'}>
        <h2 ref={activeSection==='vehicles'?panelHeading:undefined} tabIndex={-1}>Vehicles and addresses</h2>
        {profile&&<section aria-label="Linked vehicles">
          {profile.vehicles.length===0?<p>No current vehicle links.</p>:<ul className="customer-linked-vehicles">
            {profile.vehicles.map(vehicle=><li key={vehicle.associationId}>
              <a ref={selectedId===initialCustomerId&&vehicle.vehicleId===initialVehicleFocus?relatedVehicle:undefined} href={'/vehicles?vehicle='+encodeURIComponent(vehicle.vehicleId)+'&customer='+encodeURIComponent(view.selected!.id)}>{vehicle.label}</a>
              <span>{vehicle.relationship==='owner'?'Owner':'Keeper'}{vehicle.billing?' · Billing contact':''}{vehicle.archived?' · Vehicle archived':''}</span>
            </li>)}
          </ul>}
          {profile.hasMore&&<button type="button" className="secondary" disabled={customerProfile.phase==='loading'} onClick={customerProfile.loadMore}>{customerProfile.phase==='loading'?'Loading vehicle links…':'Load more vehicles'}</button>}
        </section>}
        <a className="primary-action" href={view.selected.archived_at===null&&!view.writesPaused?'/vehicles?linkCustomer='+encodeURIComponent(view.selected.id):'/vehicles'}>{view.selected.archived_at===null&&!view.writesPaused?'Link a vehicle':'Manage vehicles'}</a>
        <a className="text-action" href={'/addresses?customer='+view.selected.id}>Manage customer addresses</a>
        {Related&&<Related key={view.selected.id} customerId={view.selected.id}/>}
      </section>}
      {view.selected&&view.recordJobHistoryAvailable&&<section id="customer-panel-visits" className="customer-record-panel" hidden={activeSection!=='visits'}>
        <RecordJobHistory key={'jobs:'+view.selected.id} businessId={view.selected.business_id} recordId={view.selected.id} kind="customer" initiallyOpen={activeSection==='visits'&&showRecord}/>
      </section>}
      {view.selected?.archived_at===null&&<section id="customer-panel-payments" className="home-panel customer-record-panel" hidden={activeSection!=='payments'}>
        <h2 ref={activeSection==='payments'?panelHeading:undefined} tabIndex={-1}>Payments</h2>
        <CustomerPayments key={'payments:'+view.selected.id} businessId={view.selected.business_id} customerId={view.selected.id}/>
      </section>}
      {view.selected&&<section id="customer-panel-history" className="home-panel customer-record-panel" aria-label="Customer history" hidden={activeSection!=='history'}>
        <h2 ref={activeSection==='history'?panelHeading:undefined} tabIndex={-1}>Retained history</h2>
        {view.history&&<><p>Current version: {view.history.customer.version}</p>
        <SavedRecordDownload key={view.history.customer.id} kind="customer" record={view.history.customer} disabled={view.busy}/>
        {view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><CustomerDetails customer={event.before}/></>}<h3>After</h3><CustomerDetails customer={event.after}/></details>)}
        {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next history page</button>}</>}
      </section>}
      </div>
      </div>
    </>}
    {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check customer save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original customer change</button>}</>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current customers</button>}
<nav aria-label="Customer tools" className="customer-directory-tools">
 {view.phase==='ready'&&<a href="/customers/import-review">Review a contact CSV</a>}
 <a href="/addresses">Address save review</a>
 <a href="/save-review">Review interrupted save</a>
</nav>
  </section>;
}
