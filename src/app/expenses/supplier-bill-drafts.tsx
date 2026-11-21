'use client';

import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {financeAccounts} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {parseSupplierBillDraftPayload,supplierBillCategories} from '../../bookkeeping/expenses/supplier-bill-draft-contract';
import type {SupplierBillDraftPayload,SupplierBillDraftReference,SupplierBillDraftRevision} from '../../bookkeeping/expenses/supplier-bill-draft-contract';
import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
import {moneyChannelCents} from '../../bookkeeping/finance-money-channel-contract';
import {SupplierPayableEntryReview} from './supplier-payables';

type Split={key:string;category:string;amount:string};
type Form={incurredOn:string;dueOn:string;unknownDueReason:string;vendor:string;unknownVendorReason:string;
 documentReference:string;gross:string;tax:string;purpose:string;documentStatus:string;changeReason:string;splits:Split[]};
type Pending={reference:SupplierBillDraftReference;payload:SupplierBillDraftPayload};
type Review=Extract<Awaited<ReturnType<typeof financeAccounts.reviewSupplierBillDraft>>,{state:'review_required'}>;
const emptyForm=():Form=>({incurredOn:'',dueOn:'',unknownDueReason:'',vendor:'',unknownVendorReason:'',documentReference:'',
 gross:'',tax:'',purpose:'',documentStatus:'',changeReason:'',splits:[{key:'first',category:'',amount:''}]});
const formSignature=(value:Form)=>JSON.stringify({...value,splits:value.splits.map(({category,amount})=>({category,amount}))});
const dateFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const billDate=(value:string)=>dateFormat.format(new Date(value+'T12:00:00Z'));

function cents(raw:string){
 const value=raw.trim();
 if(!/^(0|[1-9][0-9]{0,16})(\.[0-9]{1,2})?$/.test(value))throw Error('Supplier bill amount required');
 const [whole,fraction='']=value.split('.');
 const amount=(BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'))).toString();
 if(!moneyChannelCents(amount))throw Error('Supplier bill amount required');
 return amount;
}

export function SupplierBillDrafts({context}:{context:FinanceAccountContext}){
 const id=useId(),controller=useRef<AbortController|null>(null);
 const [form,setForm]=useState<Form>(emptyForm);
 const [baseline,setBaseline]=useState(()=>formSignature(emptyForm()));
 const [editorOpen,setEditorOpen]=useState(true);
 const [directoryOpen,setDirectoryOpen]=useState(false);
 const directoryHeading=useRef<HTMLHeadingElement|null>(null),directoryTriggers=useRef(new Map<string,HTMLButtonElement>());
 const listReturn=useRef<string|null>(null),listScroll=useRef(0),focusDirectory=useRef(false);
 const recordHeading=useRef<HTMLHeadingElement|null>(null),focusRecord=useRef(false);
 const incurredInput=useRef<HTMLInputElement|null>(null),focusEditor=useRef(false);
 const [editing,setEditing]=useState<SupplierBillDraftRevision|null>(null);
 const [rows,setRows]=useState<SupplierBillDraftRevision[]|null>(null);
 const [hasMore,setHasMore]=useState(false);
 const [pending,setPending]=useState<Pending|null>(null);
 const [review,setReview]=useState<Review|null>(null);
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[posting,setPosting]=useState(false);
 const dirty=formSignature(form)!==baseline;
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useLayoutEffect(()=>{
  if(focusRecord.current&&editing&&!directoryOpen){focusRecord.current=false;recordHeading.current?.focus();}
  if(focusEditor.current&&editorOpen&&!directoryOpen){focusEditor.current=false;incurredInput.current?.focus();}
  if(focusDirectory.current&&directoryOpen){
   focusDirectory.current=false;
   const target=(listReturn.current?directoryTriggers.current.get(listReturn.current):null)??directoryHeading.current;
   target?.focus({preventScroll:true});window.scrollTo(0,listScroll.current);
  }
 });

 function patch(values:Partial<Form>){setForm(previous=>({...previous,...values}));setReview(null);}
 function edit(row:SupplierBillDraftRevision,showEditor=true){
  const value=row.payload;
  setEditing(row);setReview(null);
  const next={incurredOn:value.incurredOn,dueOn:value.dueOn??'',unknownDueReason:value.unknownDueReason??'',
   vendor:value.vendor??'',unknownVendorReason:value.unknownVendorReason??'',documentReference:value.documentReference??'',
   gross:expenseDollars(value.grossCents),tax:value.purchaseTaxCents===null?'':expenseDollars(value.purchaseTaxCents),
   purpose:value.purpose,documentStatus:value.missingReceiptReason,changeReason:'',
   splits:value.splits.map((split,index)=>({key:'saved-'+index,category:split.category,amount:expenseDollars(split.grossCents)}))};
  setForm(next);setBaseline(formSignature(next));setEditorOpen(showEditor);focusRecord.current=true;
 }
 function select(row:SupplierBillDraftRevision){
  if(busy||posting||pending)return;
  if(editing?.billId===row.billId&&editing.revision===row.revision){
   if(directoryOpen){listReturn.current=row.billId;listScroll.current=window.scrollY;}
   setDirectoryOpen(false);
   if(dirty){focusEditor.current=true;setEditorOpen(true);}
   else{focusRecord.current=true;setEditorOpen(false);}
   return;
  }
  if(dirty&&!window.confirm('Discard unsaved supplier bill edits and open this saved draft?'))return;
  listReturn.current=row.billId;listScroll.current=window.scrollY;setDirectoryOpen(false);
  edit(row,false);
 }
 function openDirectory(){
  if(busy||posting||pending)return;
  if(dirty&&!window.confirm('Discard unsaved supplier bill edits and return to saved drafts?'))return;
  if(dirty){
   if(editing)edit(editing,false);
   else{const next=emptyForm();setForm(next);setBaseline(formSignature(next));}
  }
  focusRecord.current=false;focusEditor.current=false;focusDirectory.current=true;
  setDirectoryOpen(true);setStatus('Choose a saved supplier bill to review.');
 }
 function enterAnother(){
  if(busy||posting||pending)return;
  if(dirty&&!window.confirm('Discard unsaved supplier bill edits and enter another bill?'))return;
  const next=emptyForm();focusEditor.current=true;setDirectoryOpen(false);setEditing(null);setReview(null);setForm(next);setBaseline(formSignature(next));setEditorOpen(true);setStatus('');
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:string){
  if(controller.current)return;
  const request=new AbortController(),{signal}=request;controller.current=request;setBusy(true);
  try{await work(signal);}catch{if(!signal.aborted)setStatus(failure);}
  finally{if(controller.current===request){controller.current=null;setBusy(false);}}
 }
 function saved(row:SupplierBillDraftRevision){
  setDirectoryOpen(false);edit(row,false);setPending(null);
  setRows(previous=>previous?.map(draft=>draft.billId===row.billId?row:draft)??null);
  setStatus('Supplier bill draft saved.');
 }
 async function load(next=false){
  if(pending)return;
  const after=next?rows?.at(-1)?.billId??null:null;
  await run(async signal=>{
   const page=await financeAccounts.listSupplierBillDrafts(context,after,signal);
   if(signal.aborted)return;
   setRows(previous=>next?[...(previous??[]),...page.drafts]:page.drafts);setHasMore(page.hasMore);
   if(!editing&&!dirty)setDirectoryOpen(true);
   setStatus(page.drafts.length?'Saved supplier bills loaded.':'No supplier bill drafts found.');
  },'Saved supplier bills could not be loaded.');
 }
 async function send(original:Pending){
  await run(async signal=>{
   const result=await financeAccounts.saveSupplierBillDraft(context,original.reference,original.payload,signal);
   if(signal.aborted)return;
   if(result.state==='committed'){saved(result.draft);return;}
   setPending(null);
   if(result.state==='conflict')setStatus('The draft changed or this save reference is already in use. Load saved supplier bills to review it.');
   else if(result.state==='refused'&&result.reason==='SUPPLIER_BILL_DRAFT_INCURRED_DATE_REQUIRED')
    setStatus('Enter the date the cost was incurred. It cannot be in the future.');
   else setStatus('The draft could not be saved. Check the dates, amounts, evidence, and access.');
  },'The save could not be confirmed. Check the original save or retry the same request.');
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!context.recoveryEpoch||context.writeState!=='ready'||pending||busy||posting)return;
  try{
   const vendor=form.vendor.trim(),dueOn=form.dueOn||null;
   const payload=parseSupplierBillDraftPayload({incurredOn:form.incurredOn,dueOn,
    unknownDueReason:dueOn?null:form.unknownDueReason.trim(),vendor:vendor||null,unknownVendorReason:vendor?null:form.unknownVendorReason.trim(),
    documentReference:form.documentReference.trim()||null,grossCents:cents(form.gross),purchaseTaxCents:form.tax.trim()?cents(form.tax):null,
    purpose:form.purpose.trim(),missingReceiptReason:form.documentStatus.trim(),changeReason:editing?form.changeReason.trim():null,
    splits:form.splits.map(row=>({category:row.category,grossCents:cents(row.amount)}))});
   const original={reference:{billId:editing?.billId??crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,
    operationId:crypto.randomUUID(),expectedRevision:editing?.revision??'0'},payload};
   setPending(original);await send(original);
  }catch{setStatus('Check the bill evidence. Use each category once and make the splits add up to the bill total.');}
 }
 async function checkSave(){
  if(!pending)return;
  const original=pending.reference;
  await run(async signal=>{
   const result=await financeAccounts.lookupSupplierBillDraft(context,original,signal);
   if(signal.aborted)return;
   if(result.state==='committed')saved(result.draft);
   else if(result.state==='absent')setStatus('The original supplier bill save was not found. You can retry the same request.');
   else {setPending(null);setStatus('This original save reference does not match. Load saved supplier bills to review it.');}
  },'The original supplier bill save could not be checked.');
 }
 async function checkEvidence(){
  if(!editing||pending)return;
  const selected=editing;
  await run(async signal=>{
   const result=await financeAccounts.reviewSupplierBillDraft(context,selected.billId,selected.revision,signal);
   if(signal.aborted)return;
   if(result.state==='review_required'){setReview(result);setStatus('Saved supplier bill evidence reviewed.');}
   else setStatus('Load the latest saved supplier bill to review its evidence.');
  },'Supplier bill evidence could not be reviewed.');
 }
 function changeSplit(key:string,values:Partial<Split>){
  patch({splits:form.splits.map(row=>row.key===key?{...row,...values}:row)});
 }

 return <section className="expense-editor supplier-draft-workspace" aria-label="Unpaid supplier bill drafts">
  <details>
   <summary>Unpaid supplier bills</summary>
   <p>Save details for a bill you still owe. Payable posting requires review of the original bill and its cost treatment.</p>
   <button type="button" className="secondary supplier-bill-load" disabled={busy||posting||!!pending} onClick={()=>void load()}>Load saved supplier bills</button>
   <p role="status">{status}</p>
   {pending&&<div aria-label="Unconfirmed supplier bill save">
    <button type="button" disabled={busy} onClick={()=>void checkSave()}>Check original supplier bill save</button>
    <button type="button" className="secondary" disabled={busy||context.writeState!=='ready'} onClick={()=>void send(pending)}>Retry same supplier bill save</button>
   </div>}
   <div className="supplier-draft-workbench" data-directory={rows!==null} data-view={directoryOpen?'directory':'record'}>
   {rows&&<section className="supplier-draft-directory" aria-label="Saved supplier drafts">
    <h3 ref={directoryHeading} tabIndex={-1}>Saved supplier drafts</h3>
    <p className="field-help">Showing {rows.length} loaded bills · USD. Choose a saved record to review its details.</p>
    <button type="button" className="secondary" disabled={busy||posting||!!pending} onClick={enterAnother}>New supplier draft</button>
    {rows.length===0&&<p>No saved supplier bill drafts found.</p>}
    {rows.map(row=><article key={row.billId} className="supplier-draft-directory-row">
     <h4 id={id+'-supplier-'+row.billId}>{row.payload.vendor??'Supplier unknown'}</h4>
     <p><time dateTime={row.payload.incurredOn}>{billDate(row.payload.incurredOn)}</time><span>${expenseDollars(row.payload.grossCents)}</span></p>
     <p>{row.payload.documentReference??row.payload.purpose}</p>
     <button ref={node=>{if(node)directoryTriggers.current.set(row.billId,node);else directoryTriggers.current.delete(row.billId);}}
      type="button" className="secondary" aria-current={editing?.billId===row.billId?'true':undefined} aria-describedby={id+'-supplier-'+row.billId}
      disabled={busy||posting||!!pending} onClick={()=>select(row)}>Open supplier bill draft</button>
    </article>)}
    {hasMore&&<button type="button" className="secondary" disabled={busy||posting||!!pending} onClick={()=>void load(true)}>Load more supplier bills</button>}
   </section>}
   <div className="supplier-draft-inspector">
   <section className="supplier-draft-introduction" hidden={!directoryOpen} aria-label="Supplier draft selection guidance">
    <h3>Choose a saved bill</h3><p>Open a supplier draft to review its saved details, original document and payable entry.</p>
    <p className="field-help">Selecting a bill does not post it or record a payment.</p>
   </section>
   <div className="supplier-draft-content">
   {rows&&<button type="button" className="secondary supplier-draft-back" disabled={busy||posting||!!pending} onClick={openDirectory}>Back to supplier drafts</button>}
   {editing&&<section className="supplier-bill-selected" aria-label="Selected supplier bill">
    <header><div><p className="supplier-bill-stage">Saved bill record · Revision {editing.revision}</p>
     <h3 ref={recordHeading} tabIndex={-1}>{editing.payload.vendor??'Supplier unknown'}</h3>
     <p>{editing.payload.documentReference??'No bill reference recorded'}</p></div>
     <p className="supplier-bill-total"><span>Saved bill total · USD</span><strong>${expenseDollars(editing.payload.grossCents)}</strong></p>
    </header>
    <dl className="supplier-bill-dates"><div><dt>Incurred</dt><dd><time dateTime={editing.payload.incurredOn}>{billDate(editing.payload.incurredOn)}</time></dd></div>
     <div><dt>Due</dt><dd>{editing.payload.dueOn?<time dateTime={editing.payload.dueOn}>{billDate(editing.payload.dueOn)}</time>:'Date not recorded'}</dd></div></dl>
    <p className="field-help">Payable review checks the original document and cost treatment for this saved revision.</p>
    <details className="supplier-bill-facts"><summary>Saved bill details</summary><dl>
     <dt>Business purpose</dt><dd>{editing.payload.purpose}</dd>
     <dt>Recorded document note</dt><dd>{editing.payload.missingReceiptReason}</dd>
     <dt>Included purchase tax</dt><dd>{editing.payload.purchaseTaxCents===null?'Not recorded':'$'+expenseDollars(editing.payload.purchaseTaxCents)}</dd>
     {editing.payload.unknownVendorReason&&<><dt>Supplier not recorded</dt><dd>{editing.payload.unknownVendorReason}</dd></>}
     {editing.payload.unknownDueReason&&<><dt>Due date not recorded</dt><dd>{editing.payload.unknownDueReason}</dd></>}
    </dl><ul>{editing.payload.splits.map(split=><li key={split.category}>{split.category} · ${expenseDollars(split.grossCents)}</li>)}</ul></details>
   </section>}
   <div className="expense-layout supplier-bill-layout" data-editor-open={editorOpen}>
    <details className="supplier-bill-editor" open={editorOpen} onToggle={event=>{if(event.target===event.currentTarget)setEditorOpen(event.currentTarget.open);}}>
     <summary>{editing?'Edit saved draft':'New supplier bill draft'}</summary>
    <form aria-label="Supplier bill draft" onSubmit={submit}>
     <fieldset className="expense-form" disabled={busy||posting||!!pending||context.writeState!=='ready'}>
      <legend>{editing?'Edit supplier bill draft, revision '+editing.revision:'New supplier bill draft'}</legend>
      <label>Incurred date <input ref={incurredInput} type="date" min="1900-01-01" value={form.incurredOn} required onChange={e=>patch({incurredOn:e.target.value})}/></label>
      <label>Due date <input type="date" value={form.dueOn} onChange={e=>patch({dueOn:e.target.value})}/></label>
      {!form.dueOn&&<label>Reason the due date is unknown <input value={form.unknownDueReason} maxLength={1000} required onChange={e=>patch({unknownDueReason:e.target.value})}/></label>}
      <label>Supplier <input value={form.vendor} maxLength={200} onChange={e=>patch({vendor:e.target.value})}/></label>
      {!form.vendor.trim()&&<label>Reason the supplier is unknown <input value={form.unknownVendorReason} maxLength={1000} required onChange={e=>patch({unknownVendorReason:e.target.value})}/></label>}
      <label>Bill reference (optional) <input value={form.documentReference} maxLength={200} onChange={e=>patch({documentReference:e.target.value})}/></label>
      <label>Bill total (USD) <input inputMode="decimal" value={form.gross} required maxLength={20} onChange={e=>patch({gross:e.target.value})}/></label>
      <label>Purchase tax included in total (USD, if known) <input inputMode="decimal" value={form.tax} maxLength={20} onChange={e=>patch({tax:e.target.value})}/></label>
      <label>Business purpose <input value={form.purpose} maxLength={1000} required onChange={e=>patch({purpose:e.target.value})}/></label>
      <label>Original document status <input value={form.documentStatus} maxLength={1000} required onChange={e=>patch({documentStatus:e.target.value})}/></label>
      {form.splits.map((split,index)=><fieldset key={split.key}>
       <legend>Bill split {index+1}</legend>
       <label htmlFor={id+split.key+'-category'}>Category for split {index+1}</label>
       <select id={id+split.key+'-category'} value={split.category} required onChange={e=>changeSplit(split.key,{category:e.target.value})}>
        <option value="">Choose a category</option>
        {supplierBillCategories.map(category=><option key={category} value={category}>{category[0]!.toUpperCase()+category.slice(1)}</option>)}
       </select>
       <label htmlFor={id+split.key+'-amount'}>Amount for split {index+1} (USD)</label>
       <input id={id+split.key+'-amount'} value={split.amount} inputMode="decimal" maxLength={20} required onChange={e=>changeSplit(split.key,{amount:e.target.value})}/>
       {form.splits.length>1&&<button type="button" className="secondary" onClick={()=>patch({splits:form.splits.filter(row=>row.key!==split.key)})}>Remove split {index+1}</button>}
      </fieldset>)}
      {form.splits.length<supplierBillCategories.length&&<button type="button" className="secondary"
       onClick={()=>patch({splits:[...form.splits,{key:crypto.randomUUID(),category:'',amount:''}]})}>Add bill split</button>}
      {editing&&<label>Reason for this revision <input value={form.changeReason} maxLength={1000} required onChange={e=>patch({changeReason:e.target.value})}/></label>}
      <button type="submit">{editing?'Save supplier bill revision':'Save supplier bill draft'}</button>
      {editing&&dirty&&<button type="button" className="secondary" onClick={()=>{edit(editing);focusRecord.current=false;focusEditor.current=true;setStatus('Unsaved supplier bill edits discarded.');}}>Discard draft edits</button>}
     </fieldset>
    </form>
    </details>
    <div className="expense-records">
     {dirty&&editing&&<p className="notice" id={id+'-draft-state'}>Unsaved edits are separate from the saved bill. Save or discard them before reviewing the payable.</p>}
     {editing&&<div className="supplier-bill-controls">
      <button type="button" className="secondary" disabled={busy||posting||!!pending||dirty} onClick={()=>void checkEvidence()}>Review saved bill evidence</button>
      <button type="button" className="secondary" disabled={busy||posting||!!pending}
       onClick={enterAnother}>Enter another supplier bill</button>
     </div>}
     {review&&<div aria-label="Supplier bill evidence review">
      {!context.supplierPayableReview&&<p>The bill record still needs its original document.</p>}
      {review.vendorUnknown&&<p>The supplier is unknown.</p>}
      {review.dueTermsUnknown&&<p>The due date is unknown.</p>}
      {review.purchaseTaxUnknown&&<p>Purchase tax is unconfirmed.</p>}
      <p>{review.candidates.length===1?'1 possible duplicate supplier bill.':
       review.candidates.length?review.candidates.length+' possible duplicate supplier bills.':'No possible duplicates found in saved supplier bills.'}</p>
      {review.moreCandidates&&<p>More saved records need review.</p>}
     </div>}
     {context.supplierPayableReview&&editing&&!pending&&<SupplierPayableEntryReview
      key={editing.billId+':'+editing.revision} context={context} bill={editing} draftDirty={dirty} draftNoticeId={id+'-draft-state'} lockDraft={setPosting}/>}
    </div>
   </div>
   </div>
   </div>
   </div>
  </details>
 </section>;
}
