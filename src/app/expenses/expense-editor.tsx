'use client';
import {useState,useRef,useEffect,useId,useCallback,useLayoutEffect} from 'react';
import {expenseCategories,expenseCentsFromDollars,expenseDollars,expenseHistory,parseExpenseSave,expenseDate} from '../../bookkeeping/expenses/expense-contract';
import type {ExpenseRevision,ExpenseSave} from '../../bookkeeping/expenses/expense-contract';
import {ExpenseReceipts} from './expense-receipts';
import {SameDayExpense} from './same-day-expense';
import type {createReceiptClient} from '../../client/expense-receipts';
import {exportExpenses} from '../../bookkeeping/expenses/expense-export';
import type {createExpenseClient,ExpenseContext} from '../../client/expenses';
import {createPendingExpenseStore,pendingExpense} from '../../client/pending-expense';
import type {PendingExpense} from '../../client/pending-expense';
const empty={paidOn:'',amount:'',category:'' as ''|typeof expenseCategories[number],description:'',vendor:'',paymentMethod:'' as ''|'cash'|'card'|'bank'|'other',reference:'',notes:'',changeReason:''};
export type ExpensePane='purchases'|'suppliers'|'exports';
type Pending={context:ExpenseContext|null;request:ExpenseSave|null;record:PendingExpense};
const expenseDay=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium'});
function download(name:string,text:string,type:string){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ExpenseRecordPlaceholder(){
 return <div className="review-card expense-record-placeholder" aria-hidden="true">
  <div className="expense-record-title"><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div>
  <span className="workspace-skeleton expense-record-placeholder-meta"/>
 </div>;
}
// The parent supplies an authenticated client; mounting this component grants no access.
export function ExpenseEditor({client,receiptClient,receiptService,embedded=false,sameDayExpenses=false,pane='purchases'}:{client:ReturnType<typeof createExpenseClient>;receiptClient?:ReturnType<typeof createReceiptClient>;receiptService?:ReturnType<typeof createReceiptClient>;embedded?:boolean;sameDayExpenses?:boolean;pane?:ExpensePane}){
 const choiceId=useId();
 const [formOpen,setFormOpen]=useState(false),[search,setSearch]=useState('');
 const editor=useRef<HTMLLegendElement>(null),add=useRef<HTMLButtonElement>(null),feedback=useRef<HTMLParagraphElement>(null),focusAfter=useRef<'editor'|'add'|null>(null);
 useLayoutEffect(()=>{
  if(!embedded||pane!=='purchases'||!focusAfter.current)return;
  const target=focusAfter.current==='editor'?editor.current:add.current;
  if(target){focusAfter.current=null;target.focus();}
 },[formOpen,pane,embedded]);
 const [posted,setPosted]=useState<ReadonlySet<string>>(()=>new Set());
 function markPosted(id:string){
  setPosted(value=>new Set([...value,id]));
  if(editing?.expenseId===id)clear();
 }
 const [context,setContext]=useState<ExpenseContext|null>(null),[rows,setRows]=useState<readonly ExpenseRevision[]>([]),[draft,setDraft]=useState(empty),[editing,setEditing]=useState<ExpenseRevision|null>(null),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[status,setStatus]=useState('Load expenses to begin.'),[from,setFrom]=useState(''),[through,setThrough]=useState(''),[referenceBlocked,setReferenceBlocked]=useState(false),[retryChecked,setRetryChecked]=useState(false);const lock=useRef(false),active=useRef<AbortController|null>(null),store=useRef<ReturnType<typeof createPendingExpenseStore>|null>(null);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending]);
 const mounted=useRef(false),generation=useRef(0);
 const blockedRef=useRef(false);
 const run=useCallback(async(work:(current:()=>boolean,signal:AbortSignal)=>Promise<void>)=>{
  if(lock.current||!mounted.current||blockedRef.current)return;
  const token=generation.current,controller=new AbortController(),current=()=>mounted.current&&generation.current===token&&!controller.signal.aborted;
  active.current=controller;lock.current=true;setBusy(true);
  try{await work(current,controller.signal);}
  catch{if(current())setStatus('Could not confirm the request. Keep its original reference and check the connection.');}
  finally{if(active.current===controller){active.current=null;lock.current=false;if(mounted.current)setBusy(false);}}
 },[]);
 const loadHistory=useCallback(async()=>run(async(current,signal)=>{
  if(!store.current||store.current.read()!==null)throw Error();
  setStatus('Loading saved expenses…');
  try{
   const c=await client.context(signal);if(!current())return;
   const r=await client.history(c,signal);if(!current())return;
   setContext(c);setRows(r);setDraft(empty);setEditing(null);setDirty(false);setFormOpen(false);
   setStatus(c.writeState==='ready'?'Expenses loaded.':'Recovery review: expenses are available to read; saves are paused.');
  }catch{
   if(!current())return;
   setContext(null);setRows([]);setDraft(empty);setEditing(null);setDirty(false);setPosted(new Set());setSearch('');setFormOpen(false);
   setStatus('Saved expenses could not be loaded. Check the connection and try again.');
  }
 }),[client,run]);
 useEffect(()=>{
  mounted.current=true;const token=++generation.current;
  queueMicrotask(()=>{if(!mounted.current||generation.current!==token)return;setContext(null);setRows([]);setDraft(empty);setEditing(null);setDirty(false);setFrom('');setThrough('');setRetryChecked(false);setPosted(new Set());setSearch('');setFormOpen(false);
   try{
    store.current=createPendingExpenseStore(sessionStorage);const record=store.current.read();blockedRef.current=false;setReferenceBlocked(false);
    setPending(record?{record,context:null,request:null}:null);
    if(record)setStatus('An original expense save needs review. Its private form is no longer available; another expense is blocked.');
    else if(embedded)void loadHistory();
    else setStatus('Load expenses to begin.');
   }catch{blockedRef.current=true;setReferenceBlocked(true);setStatus('The original expense reference could not be read. No expense may be submitted until it is reviewed.');}
  });
  const invalidate=()=>{generation.current++;active.current?.abort();active.current=null;lock.current=false;};
  const erase=()=>{invalidate();focusAfter.current=null;setBusy(false);setContext(null);setRows([]);setDraft(empty);setEditing(null);setDirty(false);setFrom('');setThrough('');setRetryChecked(false);setPosted(new Set());setSearch('');setFormOpen(false);setPending(value=>value?{record:value.record,context:null,request:null}:null);setStatus('Private expense details were cleared. Any original save reference was kept; reload or review it before continuing.');},hidden=()=>{if(document.visibilityState==='hidden')erase();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',erase);
  return()=>{mounted.current=false;invalidate();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',erase);};
 },[client,receiptClient,embedded,loadHistory]);
 const activeReceiptClient=receiptClient??(context?.receiptUploads?receiptService:undefined);
 const latest=context?expenseHistory(rows,context.businessId).latest:[];
 const terms=search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const visible=embedded?[...latest].sort((a,b)=>b.payload.paidOn.localeCompare(a.payload.paidOn)||b.expenseId.localeCompare(a.expenseId))
  .filter(row=>terms.every(term=>[row.payload.description,row.payload.vendor,row.payload.category].join(' ').toLocaleLowerCase().includes(term))):latest;
 function patch(change:Partial<typeof empty>){setDraft(d=>({...d,...change}));setDirty(true);}
 function clear(){setDraft(empty);setEditing(null);setDirty(false);setFormOpen(false);}
 function closeEditor(){if(dirty&&!confirm('Discard this expense draft?'))return;focusAfter.current='add';clear();}
 function begin(){clear();setFormOpen(true);focusAfter.current='editor';setStatus('Enter the details of the paid purchase.');}
 async function reload(){if(pending||dirty&&!confirm('Discard the unsaved expense form and reload?'))return;await loadHistory();}
 function open(row:ExpenseRevision){
  if(pending||dirty&&!confirm('Replace the unsaved expense form?'))return;
  const p=row.payload;setEditing(row);setDraft({paidOn:p.paidOn,amount:expenseDollars(p.amountCents),category:p.category,description:p.description,vendor:p.vendor??'',paymentMethod:p.paymentMethod,reference:p.reference??'',notes:p.notes??'',changeReason:''});setDirty(false);setFormOpen(true);
  if(formOpen)editor.current?.focus();else focusAfter.current='editor';
  setStatus('Editing revision '+row.revision+'. Enter a reason for the correction.');
 }
 async function submit(voided=false){if(!context||context.writeState!=='ready'||pending)return;let request:ExpenseSave;try{request=parseExpenseSave({businessId:context.businessId,recoveryEpoch:context.recoveryEpoch,operationId:crypto.randomUUID(),expenseId:editing?.expenseId??crypto.randomUUID(),expectedRevision:editing?.revision??'0',payload:{paidOn:draft.paidOn,amountCents:expenseCentsFromDollars(voided&&editing?expenseDollars(editing.payload.amountCents):draft.amount),currency:'USD',category:draft.category,description:draft.description,vendor:draft.vendor.trim()?draft.vendor:null,paymentMethod:draft.paymentMethod,reference:draft.reference.trim()?draft.reference:null,notes:draft.notes.trim()?draft.notes:null,...(voided&&editing?editing.payload:{}),voided,changeReason:editing?draft.changeReason:null}});}catch{setStatus('Check the date, positive USD amount, category and description. Corrections and voids require a reason.');return;}
  let attempt:Pending;try{const record=pendingExpense({schemaVersion:1,businessId:context.businessId,binding:context.binding,reference:{operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,expenseId:request.expenseId,expectedRevision:request.expectedRevision}});attempt={context,request,record};setPending(attempt);setRetryChecked(false);if(!store.current)throw Error();store.current.write(record);}catch{setStatus('The original reference could not be secured. No save was sent; review the retained reference before continuing.');return;}await send(attempt);
 }
 async function send(attempt:Pending){if(!attempt.context||!attempt.request)return;const {context:c,request}=attempt;setRetryChecked(false);await run(async(current,signal)=>{try{if(!store.current)throw Error();store.current.require(attempt.record);const result=await client.save(c,request,signal);if(!current())return;store.current.require(attempt.record);if(result.state==='conflict'){setPending({record:attempt.record,context:null,request:null});setContext(null);setRows([]);clear();setStatus('This original expense request conflicts with saved evidence. Its reference was kept for review; another expense is blocked.');return;}store.current.clear(attempt.record);setRows(r=>[...r.filter(row=>row.operationId!==result.expense.operationId),result.expense]);setPending(null);clear();setStatus('Saved expense revision '+result.expense.revision+'.');if(embedded)feedback.current?.focus();}catch{if(current())setStatus('Save outcome is unknown. Check the original save before retrying; do not enter it as another expense.');}});}
 async function resolve(){
  if(!pending)return;const attempt=pending;
  await run(async(current,signal)=>{
   if(!store.current)throw Error();store.current.require(attempt.record);const fresh=await client.context(signal);if(!current())return;
   if(fresh.businessId!==attempt.record.businessId||fresh.binding!==attempt.record.binding){setStatus('The sign-in or business changed. The original reference was kept for recovery review.');return;}
   const result=await client.lookup(fresh,attempt.record.reference,signal);if(!current())return;store.current.require(attempt.record);
   if(result.state==='absent'){
    setRetryChecked(attempt.request!==null&&attempt.context!==null&&fresh.writeState==='ready'&&fresh.recoveryEpoch===attempt.record.reference.recoveryEpoch);
    setStatus(attempt.request?'The original save is not recorded yet. This does not prove failure. Only the same in-memory request may be retried while its access remains current.':'No recorded original save was found. Its private form is gone; open interrupted save review to retire that original request explicitly. The reference and duplicate-prevention lock were kept.');return;
   }
   if(attempt.request&&!Object.entries(attempt.request.payload).every(([key,value])=>result.expense.payload[key as keyof typeof result.expense.payload]===value))throw Error();
   const saved=await client.history(fresh,signal);if(!current())return;store.current.require(attempt.record);
   const match=saved.find(row=>row.operationId===result.expense.operationId);
   if(!match||match.expenseId!==result.expense.expenseId||match.revision!==result.expense.revision||match.actorId!==result.expense.actorId||match.recordedAt!==result.expense.recordedAt||!Object.entries(result.expense.payload).every(([key,value])=>match.payload[key as keyof typeof match.payload]===value))throw Error();
   store.current.clear(attempt.record);setContext(fresh);setRows(saved);setPending(null);clear();setStatus('Original save found: revision '+match.revision+'.');
   if(embedded)feedback.current?.focus();
  });
 }
 function accountantExport(){if(!context||pending)return;if(!expenseDate(from)||!expenseDate(through)||from>through){setStatus('Enter a valid start and end date for the export.');return;}void run(async(current,signal)=>{let saved:readonly ExpenseRevision[];try{saved=await client.history(context,signal);}catch{if(current())setStatus('Could not refresh saved expenses for export. Check the connection and retry.');return;}if(!current())return;const output=exportExpenses({businessId:context.businessId,from,through,history:saved});setRows(saved);download('crest-expenses-'+from+'-'+through+'.csv',output.csv,'text/csv;charset=utf-8');if(!current())return;download('crest-expenses-'+from+'-'+through+'-notes.json',output.metadata,'application/json');if(current())setStatus('Prepared private expense CSV and notes downloads from refreshed records. Receipt files and a full backup are separate.');});}
 return <section className="expense-editor" aria-label="Business expenses">
  {!embedded&&<><p className="eyebrow">Bookkeeping</p><h1>Expenses</h1><p>Record money already paid for your business. Keep corrections visible for your tax preparer.</p></>}
  <div className={embedded?'expense-workbench-toolbar':undefined} hidden={embedded&&pane!=='purchases'}>
   {embedded&&<button ref={add} type="button" disabled={busy||!!pending||context?.writeState!=='ready'||referenceBlocked||formOpen} onClick={begin}>Record expense</button>}
   <button className="secondary" type="button" disabled={busy||!!pending||referenceBlocked} onClick={()=>void reload()}>Load saved expenses</button>
  </div>
  <p ref={feedback} className="expense-workbench-status" tabIndex={embedded?-1:undefined} role="status" aria-live="polite">{status}</p>
  {pending&&<aside aria-label="Unconfirmed expense save"><p>A save needs confirmation. This form stays locked to prevent a duplicate. Only its original identifiers are stored in this browser tab.</p>{pending.context&&pending.request&&<button type="button" disabled={busy||!retryChecked} onClick={()=>void send(pending)}>Retry the same save</button>}<button type="button" className="secondary" disabled={busy||referenceBlocked} onClick={()=>void resolve()}>Check original save</button><a href="/save-review?kind=bookkeeping.expense.save">Review interrupted expense</a></aside>}
  <div className={embedded?'expense-workbench-grid':'expense-layout'} hidden={embedded&&pane!=='purchases'} data-editing={formOpen||undefined}>
   <form aria-label="Paid expense" hidden={embedded&&!formOpen} onSubmit={e=>{e.preventDefault();void submit();}}><fieldset className="expense-form" disabled={busy||!!pending||context?.writeState!=='ready'}>
   <legend ref={editor} tabIndex={-1}>{editing?'Correct an expense':'Record a paid expense'}</legend>
   <label>Payment date<input type="date" value={draft.paidOn} required onChange={e=>patch({paidOn:e.target.value})}/></label>
   <label>Amount paid (USD)<input inputMode="decimal" value={draft.amount} maxLength={13} required placeholder="0.00" onChange={e=>patch({amount:e.target.value})}/></label>
   <div><label htmlFor={choiceId+'-category'}>Category</label><select id={choiceId+'-category'} value={draft.category} required onChange={e=>patch({category:e.target.value as typeof draft.category})}><option value="">Choose a category</option>{expenseCategories.map(c=><option key={c} value={c}>{c[0]!.toUpperCase()+c.slice(1)}</option>)}</select></div>
   <label>Description<input value={draft.description} required maxLength={500} onChange={e=>patch({description:e.target.value})}/></label>
   <div><label htmlFor={choiceId+'-payment'}>Payment method</label><select id={choiceId+'-payment'} value={draft.paymentMethod} required onChange={e=>patch({paymentMethod:e.target.value as typeof draft.paymentMethod})}><option value="">Choose how you paid</option>{['cash','card','bank','other'].map(v=><option key={v} value={v}>{v[0]!.toUpperCase()+v.slice(1)}</option>)}</select></div>
   <details open={!!editing}><summary>Vendor, reference and notes (optional)</summary><div className="optional-field">
   <label>Vendor (optional)<input value={draft.vendor} maxLength={200} onChange={e=>patch({vendor:e.target.value})}/></label>
   <label>Reference (optional)<input value={draft.reference} maxLength={200} onChange={e=>patch({reference:e.target.value})}/></label>
   <label>Notes (optional)<textarea value={draft.notes} maxLength={2000} onChange={e=>patch({notes:e.target.value})}/></label></div></details>
   {editing&&<label>Reason for correction or void<input value={draft.changeReason} required maxLength={500} onChange={e=>patch({changeReason:e.target.value})}/></label>}
   <div className="expense-form-actions">
    <button type="submit">{editing?'Save correction':'Save expense'}</button>
    {editing&&<button type="button" className="secondary" onClick={()=>void submit(true)}>Void this expense</button>}
    {(embedded||editing)&&<button type="button" className="secondary" onClick={embedded?closeEditor:clear}>{editing?'Cancel correction':'Cancel draft'}</button>}
   </div>
  </fieldset></form>
  <div className="expense-records">
   <h2>Saved expenses</h2>
   {embedded&&latest.length>0&&<div className="expense-record-search"><label htmlFor={choiceId+'-search'}>Find an expense</label><input id={choiceId+'-search'} type="search" placeholder="Description, vendor or category" value={search} onChange={event=>setSearch(event.target.value)}/></div>}
   {context&&latest.length===0&&<p>No paid expenses recorded.</p>}
   {context&&latest.length>0&&visible.length===0&&<p>No saved expenses match this search.</p>}
   {embedded&&!context&&busy&&!pending&&<ExpenseRecordPlaceholder/>}
   {visible.map(row=><article key={row.expenseId} className="review-card expense-record">
   <div className="expense-record-title"><h3>{row.payload.description}</h3><strong>${expenseDollars(row.payload.amountCents)}</strong></div>
   <p className="expense-record-meta"><time dateTime={row.payload.paidOn}>{embedded?expenseDay.format(new Date(row.payload.paidOn+'T00:00:00Z')):row.payload.paidOn}</time><span>{row.payload.category}</span>{row.payload.vendor&&<span>{row.payload.vendor}</span>}<span className="expense-record-state" data-void={row.payload.voided}>{row.payload.voided?'Void':posted.has(row.expenseId)?'Posted to ledger':'Recorded'}</span></p>
   {!row.payload.voided&&!posted.has(row.expenseId)&&<button type="button" className="secondary" disabled={busy||!!pending||context?.writeState!=='ready'} onClick={()=>open(row)}>Correct or void</button>}
   <details><summary>History ({row.revision} {row.revision==='1'?'revision':'revisions'})</summary>{rows.filter(r=>r.expenseId===row.expenseId).map(r=><p key={r.revision}>Revision {r.revision}: ${expenseDollars(r.payload.amountCents)} · {r.payload.paidOn} · {r.payload.voided?'Void':'Recorded'} · {r.payload.changeReason??'Initial entry'}</p>)}</details>
   {activeReceiptClient&&context&&<ExpenseReceipts expense={row} context={context} client={activeReceiptClient} visible={!embedded||pane==='purchases'}/>}
   {sameDayExpenses&&context&&!row.payload.voided&&<SameDayExpense businessId={context.businessId} expenseId={row.expenseId} onPosted={markPosted}/>}
  </article>)}
  </div></div>
  <section className="expense-export-panel" hidden={embedded&&pane!=='exports'}>
   <h2>Export expense history</h2><p>Choose payment dates. The download includes corrections, voids and totals for this expense list. {activeReceiptClient?'Receipt files are downloaded separately from the expense CSV.':'Receipt attachments are not available yet.'}</p>
   {embedded&&!context&&!pending&&<button type="button" className="secondary" disabled={busy||referenceBlocked} onClick={()=>void reload()}>Load saved expenses</button>}
   <div className="expense-export-dates"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={through} onChange={e=>setThrough(e.target.value)}/></label></div>
   <button type="button" disabled={!context||busy||!!pending} onClick={accountantExport}>Download private expense CSV and notes</button>
  </section>
 </section>;
}
