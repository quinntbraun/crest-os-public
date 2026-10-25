'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createCustomerEditorController,initialCustomerEditorView} from '../../client/customer-editor-controller';
import {createPendingCustomerStore} from '../../client/pending-customer-edit';
import type {Customer,CustomerDraft} from '../../customer/customer-contract';

type NullableProps={label:string;name:string;value:string|null;limit:number;multiline?:boolean;disabled:boolean;change:(value:string|null)=>void};
function NullableText({label,name,value,limit,multiline=false,disabled,change}:NullableProps){
  return <fieldset disabled={disabled}><legend>{label}</legend><label className="trust"><input type="checkbox" checked={value!==null} onChange={event=>change(event.target.checked?'':null)}/>Record {label.toLowerCase()}</label>
    {value!==null&&<><label className="visually-hidden" htmlFor={name}>{label} value</label>{multiline?<textarea id={name} name={name} rows={3} maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>:<input id={name} name={name} type="text" autoComplete="off" maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>}
      <p className="field-help">{[...value].length}/{limit} characters.{(name==='phone'||name==='email')&&' Enter a value or uncheck to leave it unknown.'}</p></>}
    {value===null&&<p className="field-help">Unknown / not recorded.</p>}
  </fieldset>;
}
function CustomerDetails({customer}:{customer:Customer}){
  const unknown=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
  return <dl className="customer-values"><dt>Name</dt><dd>{customer.display_name}</dd><dt>Phone</dt><dd>{unknown(customer.phone_raw)}</dd><dt>Email</dt><dd>{unknown(customer.email_raw)}</dd><dt>Contact preference</dt><dd>{unknown(customer.contact_preference)}</dd><dt>Outreach</dt><dd>{customer.outreach_opt_out?'Opted out':'Not opted out'}</dd><dt>Customer since</dt><dd>{unknown(customer.customer_since)}</dd><dt>Notes</dt><dd>{unknown(customer.notes)}</dd><dt>Status</dt><dd>{customer.archived_at===null?'Active':'Archived: '+customer.archived_reason}</dd></dl>;
}
export function CustomerScreen(){
  const [view,setView]=useState(initialCustomerEditorView),current=useRef<ReturnType<typeof createCustomerEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    const controller=createCustomerEditorController({store:createPendingCustomerStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;void controller.load();
    const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
    return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
  },[]);
  useEffect(()=>{if(!view.canSave&&view.phase!=='pending'&&!view.busy)return;const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[view.canSave,view.phase,view.busy]);
  async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory') {const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
  function edit<K extends keyof CustomerDraft>(key:K,value:CustomerDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);void current.current?.query(String(data.get('search')??''),data.get('archived')==='on');}
  return <section aria-label="Customer directory" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<>
      {view.writesPaused&&<p className="notice">Customer changes are paused. You can review current records and history.</p>}
      <form onSubmit={search} aria-label="Search customers"><label htmlFor="customer-search">Customer search</label><input id="customer-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/><label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived customers</label><button className="secondary" type="submit" disabled={view.busy}>Search customers</button></form>
      <p className="field-help">Search names, email or phone text. Shared contact details do not merge customers. Searching or opening another record discards an unsaved draft.</p>
      <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.open(row.id)}>{row.display_name}{row.archived_at!==null?' — archived':''}</button></li>)}</ul>
      {view.rows.length===0&&<p>No customers found on this page.</p>}
      {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void current.current?.query(view.search,view.includeArchived,true)}>Next customer page</button>}
      <button type="button" disabled={view.busy||view.writesPaused} onClick={()=>current.current?.create()}>Add customer</button>
      {view.draft&&<form onSubmit={submit} aria-label="Customer editor"><h2>{view.selected?'Edit customer':'New customer'}</h2>
        <p className="field-help">Only the name is required. Unknown details stay unknown. Leaving or hiding this page clears private drafts; closing this tab can also lose its save reference.</p>
        <fieldset disabled={view.busy||view.writesPaused}><legend>Customer details</legend><label htmlFor="customer-name">Customer name</label><input id="customer-name" name="customer-name" autoComplete="off" maxLength={400} value={view.draft.displayName} onChange={event=>edit('displayName',event.target.value)} required/><p className="field-help">{[...view.draft.displayName].length}/200 characters.</p>
          <NullableText name="phone" label="Phone" limit={512} value={view.draft.phone} disabled={view.busy} change={value=>edit('phone',value)}/>
          <NullableText name="email" label="Email" limit={512} value={view.draft.email} disabled={view.busy} change={value=>edit('email',value)}/>
          <NullableText name="preference" label="Contact preference" limit={200} value={view.draft.contactPreference} disabled={view.busy} change={value=>edit('contactPreference',value)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.outreachOptOut} onChange={event=>edit('outreachOptOut',event.target.checked)}/>Customer has opted out of outreach</label><p className="field-help">A missing opt-out flag does not establish permission to send messages. This editor sends no outreach.</p>
          <NullableText name="notes" label="Notes" multiline limit={2000} value={view.draft.notes} disabled={view.busy} change={value=>edit('notes',value)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.customerSince!==null} onChange={event=>edit('customerSince',event.target.checked?'':null)}/>Record customer-since date</label>
          {view.draft.customerSince!==null&&<><label htmlFor="customer-since">Customer-since date</label><input id="customer-since" name="customer-since" type="date" min="0001-01-01" max="9999-12-31" value={view.draft.customerSince} onChange={event=>edit('customerSince',event.target.value)} required/></>}
          <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>current.current?.edit({...view.draft!,archived:event.target.checked,archiveReason:event.target.checked?'':null})}/>Archive customer</label>
          {view.draft.archived&&<><label htmlFor="archive-reason">Archive reason</label><textarea id="archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)} required/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1000 characters. Archiving retains the record and its history.</p></>}
        </fieldset><button type="submit" disabled={!view.canSave}>Save customer</button>
      </form>}
      {view.history&&<section aria-label="Customer history"><h2>Retained history</h2><p>Current version: {view.history.customer.version}</p>
        {view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><CustomerDetails customer={event.before}/></>}<h3>After</h3><CustomerDetails customer={event.after}/></details>)}
        {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next history page</button>}
      </section>}
    </>}
    {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check customer save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original customer change</button>}</>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current customers</button>}
    <nav aria-label="Customer navigation"><Link href="/settings">Business settings</Link><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav>
    <p className="field-help">Setup and synthetic testing are still in progress. This screen does not approve real customer records or production use.</p>
  </section>;
}
