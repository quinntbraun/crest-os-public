'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {financeAccounts} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {SupplierOriginalPreview,SupplierOriginalUpload} from './supplier-original';
import {SupplierAccrualConfirmation,SupplierSettlementConfirmation} from './supplier-payable-confirmation';
import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
import type {SupplierBillDraftRevision} from '../../bookkeeping/expenses/supplier-bill-draft-contract';
import type {SupplierPayableReviewRequest} from '../../bookkeeping/expenses/supplier-payable-review-contract';

type Register=Awaited<ReturnType<typeof financeAccounts.supplierPayableRegister>>;
type Review=Awaited<ReturnType<typeof financeAccounts.previewSupplierPayable>>;
const reviewMessages={
 SUPPLIER_PAYABLE_DUE_DATE_REQUIRED:'Save the verified due date in the draft.',
 SUPPLIER_PAYABLE_DOCUMENT_REVIEW_REQUIRED:'Review the supplier and original bill reference in the draft.',
 SUPPLIER_PAYABLE_PURCHASE_TAX_REVIEW_REQUIRED:'Confirm the included purchase tax and its treatment.',
 SUPPLIER_PAYABLE_CONTROL_MAPPING_REQUIRED:'Approve the accounts payable mapping for the incurred date.',
 SUPPLIER_PAYABLE_ORDINARY_COST_MAPPING_REQUIRED:'Review the expense account mapping for each bill split.',
 ACCOUNTING_OPEN_PERIOD_REQUIRED:'Open the accounting period for the incurred date before reviewing this bill.',
};
const dollars=(value:string)=>value.startsWith('-')?'−$'+expenseDollars(value.slice(1)):'$'+expenseDollars(value);

export function SupplierPayableEntryReview({context,bill,lockDraft}:{context:FinanceAccountContext;bill:SupplierBillDraftRevision;lockDraft:(locked:boolean)=>void}){
 const active=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false),[reason,setReason]=useState('');
 const [tax,setTax]=useState<SupplierPayableReviewRequest['taxTreatment']|''>('');
 const [original,setOriginal]=useState<string|null>(null),[result,setResult]=useState<Review|null>(null);
 const [choices,setChoices]=useState<Extract<Review,{state:'select_original'}>['originals']>([]);
 const [status,setStatus]=useState(''),[confirming,setConfirming]=useState(false),[uploading,setUploading]=useState(false);
 const [submittedReview,setSubmittedReview]=useState<SupplierPayableReviewRequest|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);

 async function review(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(active.current||confirming||uploading||!tax||!reason.trim())return;
  const request=new AbortController();active.current=request;setBusy(true);setResult(null);setStatus('');
  try{
   const input={billId:bill.billId,revision:bill.revision,originalId:original,taxTreatment:tax,reason:reason.trim()};
   const response=await financeAccounts.previewSupplierPayable(context,input,request.signal);
   if(request.signal.aborted)return;
   setResult(response);setSubmittedReview(response.state==='ready'?input:null);
   if(response.state==='select_original'){setChoices(response.originals);setStatus('Choose the original you reviewed.');}
   if(response.state==='original_required'){setChoices([]);setOriginal(null);setStatus('A verified original is required for this revision.');}
   if(response.state==='ready')setStatus('Entry preview prepared for the saved draft.');
   if(response.state==='stale')setStatus('Load the latest saved draft before reviewing this bill.');
   if(response.state==='posted')setStatus('This bill appears in Recorded supplier payables.');
   if(response.state==='refused')setStatus(reviewMessages[response.reason]);
  }catch{if(!request.signal.aborted)setStatus('The entry preview could not be prepared. Check access and try again.');}
  finally{if(active.current===request){active.current=null;setBusy(false);}}
 }

 return <details>
  <summary>Preview the payable entry</summary>
  {context.supplierOriginalUploads&&bill.payload.documentReference&&result?.state!=='posted'&&
   <SupplierOriginalUpload context={context} bill={bill} disabled={busy||confirming}
    lockDraft={locked=>{setUploading(locked);lockDraft(locked);}}
    onAvailable={id=>{setOriginal(id);setChoices([]);setResult(null);setStatus('The verified document is ready for entry review.');}}/>}
  <form aria-label="Supplier payable entry preview" onSubmit={review}>
   <fieldset className="expense-form" disabled={busy||confirming||uploading}>
    <legend>Saved draft revision {bill.revision}</legend>
    <label>Purchase tax treatment <select value={tax} required onChange={event=>{
     const value=event.target.value;setTax(value==='none'||value==='verified_nonrecoverable'?value:'');setResult(null);setStatus('');
    }}>
     <option value="">Choose the verified treatment</option>
     <option value="none">No purchase tax</option>
     <option value="verified_nonrecoverable">Included tax is nonrecoverable</option>
    </select></label>
    <label>Reason for the review <input value={reason} required maxLength={1000} onChange={event=>{setReason(event.target.value);setResult(null);setStatus('');}}/></label>
    {choices.length>0&&<label>Verified original <select value={original??''} required onChange={event=>{setOriginal(event.target.value||null);setResult(null);setStatus('');}}>
     <option value="">Choose the original</option>
     {choices.map((choice,index)=><option value={choice.originalId} key={choice.originalId}>
      Document {index+1} · {choice.mediaType} · checksum {choice.fileSha256.slice(0,12)}
     </option>)}
    </select></label>}
    <button type="submit">Review expense and payable amounts</button>
   </fieldset>
  </form>
  <p role="status">{status}</p>
  {result?.state==='ready'&&<div className="review-card">
   <h4>Proposed entry for {result.plan.vendor}</h4>
   <p>{result.plan.documentReference} · incurred {result.plan.incurredOn} · due {result.plan.dueOn}</p>
   <ul>{result.plan.lines.map(line=><li key={line.category??'payable'}>{line.category===null?
    'Credit accounts payable '+dollars(line.creditCents):'Debit '+line.category+' '+dollars(line.debitCents)}</li>)}</ul>
   {context.supplierOriginalUploads&&<SupplierOriginalPreview key={result.originalId} id={result.originalId}/>}
   <p>Total {dollars(result.plan.totalCents)} · included purchase tax {dollars(result.plan.taxCents)}</p>
   {result.candidates.length>0&&<><p>Possible duplicate payables</p><ul>{result.candidates.map(candidate=><li key={candidate.payableId}>
    {candidate.incurredOn} · {dollars(candidate.grossCents)} · {candidate.sameOriginalSha256?'Matching original document':'Matching supplier reference'}
   </li>)}</ul></>}
   {context.supplierPayablePosting&&submittedReview&&!uploading&&<SupplierAccrualConfirmation key={result.plan.sha256}
    context={context} review={submittedReview} result={result}
    lockReview={locked=>{setConfirming(locked);lockDraft(locked);}}
    onRefresh={()=>{setResult(null);setStatus('Review the bill again before posting.');}}
    onPosted={()=>{setConfirming(false);lockDraft(false);setResult(null);setStatus('Supplier bill posted. Reload Recorded supplier payables.');}}/>}
  </div>}
 </details>;
}

export function SupplierPayableRegister({context}:{context:FinanceAccountContext}){
 const active=useRef<AbortController|null>(null);
 const [report,setReport]=useState<Register|null>(null),[throughOn,setThroughOn]=useState('');
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const [lockedPayable,setLockedPayable]=useState<string|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function load(next=false,notice=''){
  if(active.current||(next&&!report?.hasMore))return;
  const previous=next?report:null;
  const request=new AbortController();active.current=request;setBusy(true);setStatus('');
  if(!next)setReport(null);
  try{
   const value=await financeAccounts.supplierPayableRegister(context,previous?.throughOn??(throughOn||null),
    previous?.rows.at(-1)?.payableId??null,request.signal);
   if(request.signal.aborted)return;
   if(previous&&previous.sourceSha256!==value.sourceSha256){setReport(null);setStatus('Balances changed. Reload the register.');return;}
   setReport({...value,rows:[...(previous?.rows??[]),...value.rows]});
   setStatus(notice||(value.rowCount?'Supplier payables loaded.':'No supplier payables were recorded through that date.'));
  }catch{if(!request.signal.aborted)setStatus('The supplier payable register could not be loaded.');}
  finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 return <section className="expense-editor" aria-label="Recorded supplier payables">
  <details>
   <summary>Recorded supplier payables</summary>
   <form onSubmit={event=>{event.preventDefault();if(!lockedPayable)void load();}}>
    <fieldset className="expense-form" disabled={busy}>
     <legend>Payables balance</legend>
     <label>Through date (optional) <input type="date" min="1900-01-01" value={throughOn} onChange={event=>{
      setThroughOn(event.target.value);setReport(null);setStatus('');
     }}/></label>
     <button type="submit">Load supplier payables</button>
    </fieldset>
   </form>
   <p role="status">{status}</p>
   {report&&<>
    <p>Through {report.throughOn} · {report.openCount} open · {dollars(report.outstandingCents)} outstanding</p>
    <p>{report.ledgerAgrees?'The register agrees with the ledger.':'Review the difference against the ledger balance of '+dollars(report.ledgerPayableCents)+'.'}</p>
    {report.rows.map(row=><article key={row.payableId} className="review-card">
     <h4>{row.vendor}</h4><p>Incurred {row.incurredOn} · due {row.dueOn}{row.overdueDays>0?' · '+row.overdueDays+' days overdue':''}</p>
     <p>{dollars(row.grossCents)} bill · {dollars(row.paidCents)} paid · {dollars(row.remainingCents)} outstanding</p>
     {context.supplierPayablePosting&&row.remainingCents!=='0'&&(!lockedPayable||lockedPayable===row.payableId)&&
      <SupplierSettlementConfirmation key={report.sourceSha256+':'+row.payableId} context={context} row={row} throughOn={report.throughOn}
       lockRegister={locked=>setLockedPayable(locked?row.payableId:null)} onRefresh={()=>void load()}
       onPosted={()=>{setLockedPayable(null);void load(false,'Verified supplier payment recorded.');}}/>}
    </article>)}
    {report.hasMore&&<button type="button" className="secondary" disabled={busy||!!lockedPayable} onClick={()=>void load(true)}>Load more payables</button>}
   </>}
  </details>
 </section>;
}
