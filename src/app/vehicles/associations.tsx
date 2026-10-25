'use client';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createAssociationEditorController,initialAssociationEditorView} from '../../client/association-editor-controller';
import type {AssociationDraft} from '../../client/association-editor-controller';
import {createPendingAssociationStore} from '../../client/pending-association-edit';
import type {VehicleAssociationRow} from '../../customer/vehicle-association-contract';
import {NullableText} from '../customers/nullable-text';
import {associationCurrentTime} from './association-time';

function LinkDetails({source}:{source:VehicleAssociationRow}){
 const text=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
 return <dl className="customer-values"><dt>Relationship</dt><dd>{source.relationship==='owner'?'Owner':'Keeper'}</dd><dt>Billing selected</dt><dd>{source.is_billing?'Yes':'No'}</dd><dt>Starts (UTC)</dt><dd>{source.valid_from}</dd><dt>Ends (UTC)</dt><dd>{source.valid_to??'Still open'}</dd><dt>Evidence</dt><dd>{text(source.evidence)}</dd><dt>End reason</dt><dd>{text(source.close_reason)}</dd></dl>;
}
export function AssociationPanel({businessId,vehicleId}:{businessId:string;vehicleId:string}){
 const [view,setView]=useState(initialAssociationEditorView),current=useRef<ReturnType<typeof createAssociationEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createAssociationEditorController({businessId,vehicleId,store:createPendingAssociationStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[businessId,vehicleId]);
 const hasDraft=view.draft!==null,pending=view.phase==='pending';
 useEffect(()=>{if(!hasDraft&&!pending)return;const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leave);return ()=>window.removeEventListener('beforeunload',leave);},[hasDraft,pending]);
 async function action(kind:'load'|'more'|'save'|'check'|'retry'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function edit<K extends keyof AssociationDraft>(key:K,value:AssociationDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);void current.current?.searchCustomers(String(form.get('customer-search')??''));}
 function submit(event:FormEvent){event.preventDefault();void action('save');}
 return <section className="association-panel" aria-label="Customers for this vehicle" aria-busy={view.busy}><h2>Customers for this vehicle</h2>
  <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase!=='pending'&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current customer links</button>}
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Customer-link changes are paused. You can review retained links.</p>}
   <ul className="customer-list">{view.rows.map(({source,customer})=><li key={source.id}><h3>{customer.label}{customer.archived?' (archived customer)':''}</h3><p>{source.relationship==='owner'?'Owner':'Keeper'} · {source.is_billing?'Billing selected':'Billing not selected'} · {source.valid_to===null?'Current link':'Ended link'}</p>
    <button className="secondary" type="button" disabled={view.busy} onClick={()=>void current.current?.inspect(source.id)}>View link history for {customer.label}</button>
    {source.valid_to===null&&<><button className="secondary" type="button" disabled={view.busy||view.writesPaused} onClick={()=>void current.current?.begin('close',source.id)}>End link for {customer.label}</button><button type="button" disabled={view.busy||view.writesPaused} onClick={()=>void current.current?.begin('transfer',source.id)}>Transfer link for {customer.label}</button></>}
   </li>)}</ul>
   {view.rows.length===0&&<p>No retained customer links on this page.</p>}
   {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('more')}>Next customer-link page</button>}
   <button type="button" disabled={view.busy||view.writesPaused} onClick={()=>void current.current?.begin('open')}>Add customer link</button>
   {view.draft&&<>
    <h3>{view.draft.action==='open'?'Add a customer link':view.draft.action==='close'?'End the selected link':'Transfer the selected link'}</h3>
    {view.draft.action!=='close'&&<><form onSubmit={search} aria-label="Find customer for vehicle"><label htmlFor="link-customer-search">Customer name, phone or email</label><input id="link-customer-search" name="customer-search" type="search" maxLength={400} autoComplete="off" defaultValue={view.customerSearch} disabled={view.busy}/><button className="secondary" type="submit" disabled={view.busy}>Find customers</button></form>
     <p className="field-help">Select the exact existing customer. Archived customers remain available for retained history; shared names or contact details do not merge customers.</p>
     <ul className="customer-list">{view.customers.map(customer=><li key={customer.id}><button className="secondary" type="button" disabled={view.busy||view.writesPaused} onClick={()=>current.current?.chooseCustomer(customer.id)}>Use {customer.label}{customer.archived?' (archived)':''}</button></li>)}</ul>
     {view.customerHasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void current.current?.searchCustomers(view.customerSearch,true)}>Next customer search page</button>}
    </>}
    {view.selectedCustomer&&<p>Selected customer: <strong>{view.selectedCustomer.label}</strong>{view.selectedCustomer.archived?' (archived)':''}</p>}
    <form onSubmit={submit} aria-label="Customer link editor"><fieldset disabled={view.busy||view.writesPaused}><legend>Customer relationship and effective time</legend>
     {view.draft.action!=='close'&&<>
      <label htmlFor="link-relationship">Relationship</label><select id="link-relationship" value={view.draft.relationship??''} onChange={event=>edit('relationship',event.target.value===''?null:event.target.value as 'owner'|'keeper')} required><option value="">Choose relationship</option><option value="owner">Owner</option><option value="keeper">Keeper</option></select>
      <label htmlFor="link-billing">Billing selection</label><select id="link-billing" value={view.draft.isBilling===null?'':view.draft.isBilling?'yes':'no'} onChange={event=>edit('isBilling',event.target.value===''?null:event.target.value==='yes')} required><option value="">Choose billing selection</option><option value="yes">Select this customer for billing</option><option value="no">Do not select this customer for billing</option></select>
      <p className="field-help">Billing selection is separate from ownership. It does not change existing jobs, invoices or financial history.</p>
     </>}
     <label htmlFor="link-effective-time">Effective time (UTC)</label><input id="link-effective-time" name="effective-time" type="text" autoComplete="off" maxLength={27} placeholder="2026-10-25T14:30:00.000000Z" value={view.draft.effectiveAt} onChange={event=>edit('effectiveAt',event.target.value)} required/>
     <button className="secondary" type="button" onClick={()=>edit('effectiveAt',associationCurrentTime(new Date()))}>Use current time</button><p className="field-help">Use current time for a change taking effect now. For an earlier or future change, enter the exact UTC time shown above with six digits after the decimal. Ending a link must be at or after its start.</p>
     {view.draft.action!=='close'&&<NullableText name="link-evidence" label="Link evidence" multiline limit={2000} value={view.draft.evidence} disabled={view.busy} change={value=>edit('evidence',value)}/>}
     {view.draft.action!=='open'&&<><label htmlFor="link-end-reason">Reason for ending the earlier link</label><textarea id="link-end-reason" name="end-reason" rows={3} maxLength={2000} value={view.draft.reason??''} onChange={event=>edit('reason',event.target.value)} required/><p className="field-help">{[...(view.draft.reason??'')].length}/1000 characters. The earlier customer, billing selection and evidence stay in retained history.</p></>}
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>{view.draft.action==='open'?'Save customer link':view.draft.action==='close'?'Confirm end of link':'Confirm customer-link transfer'}</button></form>
   </>}
   {view.history&&<section aria-label="Customer link history"><h3>Retained customer-link history</h3><p>{view.selectedCustomer?.label} · Current version: {view.history.association.version}</p>{view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.version==='1'?'Opened':'Ended'} · {event.after.updated_at}</summary>{event.before&&<><h4>Before</h4><LinkDetails source={event.before}/></>}<h4>After</h4><LinkDetails source={event.after}/></details>)}</section>}
  </>}
  {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until its outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check customer-link save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original customer-link change</button>}</>}
 </section>;
}
