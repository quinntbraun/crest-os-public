'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent,ComponentType} from 'react';
import {createCustomerEditorController,initialCustomerEditorView,emptyCustomerDraft} from '../../client/customer-editor-controller';
import {createPendingCustomerStore} from '../../client/pending-customer-edit';
import {NullableText} from './nullable-text';
import {phonePresentation} from '../../client/phone-presentation';
import type {Customer,CustomerDraft} from '../../customer/customer-contract';
import {SavedRecordDownload} from '../saved-record-download';
import {draftFromCustomer} from '../../customer/customer-contract';
import {draftChanged} from '../../client/draft-changed';

function CustomerDetails({customer}:{customer:Customer}){
  const unknown=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
  return <dl className="customer-values"><dt>Name</dt><dd>{customer.display_name}</dd><dt>Phone</dt><dd>{unknown(customer.phone_raw)}</dd><dt>Email</dt><dd>{unknown(customer.email_raw)}</dd><dt>Contact preference</dt><dd>{unknown(customer.contact_preference)}</dd><dt>Outreach</dt><dd>{customer.outreach_opt_out?'Opted out':'Not opted out'}</dd><dt>Customer since</dt><dd>{unknown(customer.customer_since)}</dd><dt>Notes</dt><dd>{unknown(customer.notes)}</dd><dt>Status</dt><dd>{customer.archived_at===null?'Active':'Archived: '+customer.archived_reason}</dd></dl>;
}
export function CustomerScreen({related:Related}:{related?:ComponentType<{customerId:string}>}={}){
  const [view,setView]=useState(initialCustomerEditorView),current=useRef<ReturnType<typeof createCustomerEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const dirty=draftChanged(view.draft,view.selected?draftFromCustomer(view.selected):emptyCustomerDraft);
  const focusRequest=useRef<{controller:NonNullable<typeof current.current>;id:string|null}|null>(null),editorVisible=view.draft!==null,selectedId=view.selected?.id??null;
  useLayoutEffect(()=>{const requested=focusRequest.current;if(!requested||view.busy)return;if(current.current===requested.controller&&view.phase==='ready'&&editorVisible&&selectedId===requested.id)heading.current?.focus();focusRequest.current=null;},[view,editorVisible,selectedId]);
  useEffect(()=>{
    const controller=createCustomerEditorController({store:createPendingCustomerStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;void controller.load();
    const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
    return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
  },[]);
  useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[dirty,view.phase,view.busy]);
  function discardAllowed(){const state=current.current?.view();return !state||!draftChanged(state.draft,state.selected?draftFromCustomer(state.selected):emptyCustomerDraft)||window.confirm('Discard your unsaved customer changes? Choose Cancel to keep editing.');}
  async function open(id:string){const controller=current.current;if(!controller||!discardAllowed())return;focusRequest.current={controller,id};await controller.open(id);}
  function create(){const controller=current.current;if(!controller||!discardAllowed())return;focusRequest.current={controller,id:null};controller.create();}
  function query(search:string,archived:boolean,more=false){if(discardAllowed())void current.current?.query(search,archived,more);}
  async function action(kind:'load'|'save'|'confirmSeparate'|'check'|'retry'|'moreHistory') {const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
  function edit<K extends keyof CustomerDraft>(key:K,value:CustomerDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);query(String(data.get('search')??''),data.get('archived')==='on');}
  return <section aria-label="Customer directory" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<>
      {view.writesPaused&&<p className="notice">Customer changes are paused. You can review current records and history.</p>}
      <form onSubmit={search} aria-label="Search customers"><label htmlFor="customer-search">Customer search</label><input id="customer-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/><label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived customers</label><button className="secondary" type="submit" disabled={view.busy}>Search customers</button></form>
      <p className="field-help">Search names, email or phone text. Shared contact details do not merge customers. You’ll be asked before a search or record change discards unsaved edits.</p>
      <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void open(row.id)}>{row.display_name}{row.archived_at!==null?' — archived':''}</button><p className="contact-summary">{[row.phone_raw===null?null:phonePresentation(row.phone_raw),row.email_raw].filter(value=>value!==null).join(' · ')||'Contact details not recorded'}</p></li>)}</ul>
      {view.rows.length===0&&<p>No customers found on this page.</p>}
      {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>query(view.search,view.includeArchived,true)}>Next customer page</button>}
      <button type="button" disabled={view.busy||view.writesPaused} onClick={create}>Add customer</button>
      {view.draft&&<form onSubmit={submit} aria-label="Customer editor"><h2 ref={heading} tabIndex={-1} className="editor-heading">{view.selected?'Edit customer':'New customer'}</h2>
        <p className="field-help">Name is required. Phone and email are optional. Unsaved changes clear when you leave or hide this page.</p>
        <fieldset disabled={view.busy||view.writesPaused}><legend>Customer details</legend><label htmlFor="customer-name">Customer name</label><input id="customer-name" name="customer-name" autoComplete="off" maxLength={400} value={view.draft.displayName} onChange={event=>edit('displayName',event.target.value)} required/><p className="field-help">{[...view.draft.displayName].length}/200 characters.</p>
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
        </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}{view.contactReview&&<section className="notice" aria-label="Shared contact review"><h3>Review possible matches</h3><p>Shared contact details can belong to different people. Nothing is merged or changed by this review.</p><ul className="customer-list">{view.contactReview.matches.map(match=><li key={match.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void open(match.id)}>Review {match.name}{match.archived?' — archived':''}</button><p>{[match.phone?'Phone matches':null,match.emailSearch?'Email search result':null].filter(Boolean).join(' · ')}</p></li>)}</ul>{view.contactReview.limited&&<p>More search results remain. This review is limited to the first 50 results for each contact field.</p>}<p>Search results are possible matches, not proof these are the same person or that no other record exists.</p><button type="button" className="secondary" disabled={!view.canConfirmSeparate} onClick={()=>void action('confirmSeparate')}>{view.selected?'Keep shared contact details':'Save as separate customer'}</button></section>}<button type="submit" disabled={!view.canSave}>Save customer</button>
      </form>}
      {view.selected&&<section className="home-panel"><h2>Vehicles and addresses</h2><p>Save vehicles in the vehicle directory, then add a customer link to record their relationship and billing selection.</p><a className="primary-action" href="/vehicles">Manage vehicles</a><a className="text-action" href={"/addresses?customer="+view.selected.id}>Manage customer addresses</a></section>}
      {view.selected&&Related&&<Related key={view.selected.id} customerId={view.selected.id}/>}
      {view.history&&<section aria-label="Customer history"><h2>Retained history</h2><p>Current version: {view.history.customer.version}</p>
        <SavedRecordDownload key={view.history.customer.id} kind="customer" record={view.history.customer} disabled={view.busy}/>
        {view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><CustomerDetails customer={event.before}/></>}<h3>After</h3><CustomerDetails customer={event.after}/></details>)}
        {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next history page</button>}
      </section>}
    </>}
    {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check customer save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original customer change</button>}</>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current customers</button>}
<nav aria-label="Customer navigation"><a href="/save-review">Review interrupted save</a><a href="/vehicles">Vehicles</a><a href="/leads">Leads</a><a href="/addresses">Address save review</a><a href="/settings">Business settings</a><a href="/export-files">Business data exports</a><a href="/sign-in">Device sign-in and sign-out</a><a href="/">Crest OS home</a></nav>
    <p className="field-help">Setup and synthetic testing are still in progress. This screen does not approve real customer records or production use.</p>
  </section>;
}
