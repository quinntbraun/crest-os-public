'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createLeadEditorController,initialLeadEditorView,emptyLeadDraft} from '../../client/lead-editor-controller';
import {createPendingLeadStore} from '../../client/pending-lead-edit';
import type {Lead,LeadDraft} from '../../customer/lead-contract';
import {draftFromLead} from '../../customer/lead-contract';
import {NullableText} from '../customers/nullable-text';
import {ReferencePicker} from './reference-picker';
import {LeadStatusPanel} from './status';
import {createPendingLeadStateStore} from '../../client/pending-lead-state-edit';
import {leadDollars,leadCents,leadUtc} from './intake-input';

function EstimateInput({value,change}:{value:string;change:(value:string)=>void}){
 const [text,setText]=useState(()=>leadDollars(value));
 return <><label htmlFor="lead-estimate">Estimated value (USD)</label><input id="lead-estimate" name="estimate" inputMode="decimal" autoComplete="off" maxLength={24} value={text} onChange={event=>{setText(event.target.value);change(leadCents(event.target.value));}} required/><p className="field-help">Enter dollars, such as 125.50. Zero is an explicit estimate; uncheck to leave it unknown. This estimate is not a quote or invoice.</p></>;
}
function FollowUpInput({value,change}:{value:string;change:(value:string)=>void}){
 const [text,setText]=useState(value);
 return <><label htmlFor="lead-follow-up">Follow-up date and time (UTC)</label><input id="lead-follow-up" name="follow-up" autoComplete="off" maxLength={35} placeholder="2026-10-25 14:30" value={text} onChange={event=>{setText(event.target.value);change(leadUtc(event.target.value));}} required/><p className="field-help">Enter a UTC date and time, such as 2026-10-25 14:30. Existing seconds and microseconds are preserved. No device timezone is assumed.</p></>;
}
function LeadDetails({lead}:{lead:Lead}){
 const text=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
 return <dl className="customer-values"><dt>Label</dt><dd>{lead.label}</dd><dt>State</dt><dd>{lead.state.replaceAll('_',' ')}</dd><dt>Linked customer</dt><dd>{lead.customer_id?'Existing customer linked':'Not linked'}</dd><dt>Selected source snapshot</dt><dd>{lead.source_snapshot?lead.source_snapshot.label+' · '+lead.source_snapshot.kind:'Not recorded'}</dd><dt>Referral evidence</dt><dd>{text(lead.referral_text)}</dd><dt>Phone</dt><dd>{text(lead.phone_raw)}</dd><dt>Email</dt><dd>{text(lead.email_raw)}</dd><dt>Requested scope</dt><dd>{text(lead.requested_scope)}</dd><dt>Availability</dt><dd>{text(lead.availability)}</dd><dt>Estimate (USD)</dt><dd>{lead.estimated_cents===null?'Not recorded':leadDollars(lead.estimated_cents)}</dd><dt>Follow-up (UTC)</dt><dd>{text(lead.follow_up_at)}</dd><dt>Notes</dt><dd>{text(lead.notes)}</dd><dt>Lost reason</dt><dd>{text(lead.lost_reason)}</dd></dl>;
}
export function LeadScreen(){
 const [statusLocked,setStatusLocked]=useState(false),[view,setView]=useState(initialLeadEditorView),current=useRef<ReturnType<typeof createLeadEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createLeadEditorController({store:createPendingLeadStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),statusStore:createPendingLeadStateStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;void controller.load();
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[]);
 const statusChanged=useCallback((leadId:string)=>{void current.current?.statusChanged(leadId);},[]);
 const dirty=view.draft!==null&&JSON.stringify(view.draft)!==JSON.stringify(view.selected?draftFromLead(view.selected):emptyLeadDraft);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,view.phase,view.busy]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function edit<K extends keyof LeadDraft>(key:K,value:LeadDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);void current.current?.query(String(data.get('search')??''),data.get('lost')==='on');}
 function submit(event:FormEvent){event.preventDefault();void action('save');}
 const key=(view.selected?.id??'new')+':'+(view.selected?.version??'0'),disabled=view.busy||view.writesPaused||statusLocked;
 return <section aria-label="Lead directory" aria-busy={view.busy}>
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Lead changes are paused. You can review current records and retained history.</p>}
   <form onSubmit={search} aria-label="Search leads"><label htmlFor="lead-search">Lead search</label><input id="lead-search" name="search" type="search" maxLength={400} autoComplete="off" defaultValue={view.search} disabled={view.busy||statusLocked}/><label className="trust"><input name="lost" type="checkbox" defaultChecked={view.includeLost} disabled={view.busy||statusLocked}/>Include lost leads</label><button className="secondary" type="submit" disabled={view.busy||statusLocked}>Search leads</button></form>
   <p className="field-help">Search label, phone or email text. Shared contact details do not merge people. Searching or opening another record discards an unsaved draft.</p>
   <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy||statusLocked} onClick={()=>void current.current?.open(row.id)}>{row.label}</button><p>{row.state.replaceAll('_',' ')}{row.follow_up_at?' · Follow-up (UTC): '+row.follow_up_at:''}</p></li>)}</ul>
   {view.rows.length===0&&<p>No leads found on this page.</p>}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy||statusLocked} onClick={()=>void current.current?.query(view.search,view.includeLost,true)}>Next lead page</button>}
   <button type="button" disabled={disabled} onClick={()=>current.current?.create()}>Add lead</button>
   {view.draft&&<>
    <h2>{view.selected?'Edit lead intake':'New lead'}</h2><p className="field-help">Only a label is required. Unknown details stay unknown. Leaving or hiding this page clears private drafts; closing the tab can also lose its save reference.</p>
    {view.businessId&&<><ReferencePicker key={key+':customer'} businessId={view.businessId} kind="customer" value={view.draft.customerId} disabled={disabled} change={value=>edit('customerId',value)}/><ReferencePicker key={key+':source'} businessId={view.businessId} kind="source" value={view.draft.sourceId} disabled={disabled} change={value=>edit('sourceId',value)}/></>}
    {view.selected?.source_snapshot&&view.draft.sourceId===view.selected.source_id&&<p>Retained source attribution: {view.selected.source_snapshot.label} · {view.selected.source_snapshot.kind}. Later source edits do not replace this snapshot.</p>}
    <form onSubmit={submit} aria-label="Lead editor"><fieldset disabled={disabled}><legend>Inquiry details</legend>
     <label htmlFor="lead-label">Lead label</label><input id="lead-label" name="lead-label" autoComplete="off" maxLength={400} value={view.draft.label} onChange={event=>edit('label',event.target.value)} required/><p className="field-help">{[...view.draft.label].length}/200 characters.</p>
     <NullableText name="phone" label="Phone" limit={512} value={view.draft.phone} disabled={disabled} change={value=>edit('phone',value)}/><NullableText name="email" label="Email" limit={512} value={view.draft.email} disabled={disabled} change={value=>edit('email',value)}/>
     <p className="field-help">Recording contact details does not record permission to send messages.</p>
     <NullableText name="referral" label="Referral evidence" multiline limit={2000} value={view.draft.referralText} disabled={disabled} change={value=>edit('referralText',value)}/><NullableText name="scope" label="Requested scope" multiline limit={4000} value={view.draft.requestedScope} disabled={disabled} change={value=>edit('requestedScope',value)}/><NullableText name="availability" label="Availability" multiline limit={4000} value={view.draft.availability} disabled={disabled} change={value=>edit('availability',value)}/>
     <label className="trust"><input type="checkbox" checked={view.draft.estimatedCents!==null} onChange={event=>edit('estimatedCents',event.target.checked?'':null)}/>Record estimated value</label>{view.draft.estimatedCents!==null&&<EstimateInput key={key+':estimate'} value={view.draft.estimatedCents} change={value=>edit('estimatedCents',value)}/>}
     <label className="trust"><input type="checkbox" checked={view.draft.followUpAt!==null} onChange={event=>edit('followUpAt',event.target.checked?'':null)}/>Record follow-up time</label>{view.draft.followUpAt!==null&&<FollowUpInput key={key+':follow-up'} value={view.draft.followUpAt} change={value=>edit('followUpAt',value)}/>}
     <NullableText name="notes" label="Notes" multiline limit={4000} value={view.draft.notes} disabled={disabled} change={value=>edit('notes',value)}/>
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave||statusLocked}>Save lead</button></form>
   </>}
   {view.selected&&view.businessId&&<LeadStatusPanel key={view.businessId+':'+view.selected.id} businessId={view.businessId} leadId={view.selected.id} disabled={view.busy||dirty} onLock={setStatusLocked} onCommitted={statusChanged}/>}
   {view.history&&<section aria-label="Lead history"><h2>Retained history</h2><p>Current version: {view.history.lead.version}</p>{view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><LeadDetails lead={event.before}/></>}<h3>After</h3><LeadDetails lead={event.after}/></details>)}{view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy||statusLocked} onClick={()=>void action('moreHistory')}>Next lead history page</button>}</section>}
  </>}
  {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy||statusLocked} onClick={()=>void action('check')}>Check lead save status</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy||statusLocked} onClick={()=>void action('retry')}>Retry original lead change</button>}</>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy||statusLocked} onClick={()=>void action('load')}>Load current leads</button>}
  <nav aria-label="Lead navigation"><Link href="/lead-sources">Lead sources</Link><Link href="/customers">Customers</Link><Link href="/vehicles">Vehicles</Link><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav>
  <p className="field-help">Synthetic testing is in progress. Intake and manual status changes are available for synthetic testing; conversion and real-data use remain unavailable.</p>
 </section>;
}
