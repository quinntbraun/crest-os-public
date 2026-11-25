'use client';
import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {normalizeOpeningPayablesEvidence} from '../../../bookkeeping/opening-payables-contract';
import type {OpeningPayablesInput} from '../../../bookkeeping/opening-payables-contract';
import {DollarField,Note,dollars,readEvidence,value} from './opening-worksheet-fields';
import {OpeningEvidencePicker} from './opening-evidence-picker';
import styles from './screen.module.css';
export type PayableBill=OpeningPayablesInput['bills'][number];
const amount=(input:string)=>{const parts=/^(-?)(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(input);if(!parts)throw Error('AMOUNT_REQUIRED');const absolute=BigInt(parts[2]!)*100n+BigInt((parts[3]??'').padEnd(2,'0'));return(parts[1]?-absolute:absolute).toString();};
type Reduction={id:string;initial:PayableBill['reductions'][number]|undefined};
export function OpeningPayablesSourceForm({initial,identityLocked,cutoverOn,busy,onSave,onCancel,onError}:{initial:PayableBill|null;identityLocked:boolean;cutoverOn:string;busy:boolean;onSave:(bill:PayableBill)=>void;onCancel:()=>void;onError:(message:string)=>void}){
 const [billId]=useState(()=>initial?.billId??crypto.randomUUID()),[unknownDue,setUnknownDue]=useState(initial?.originalDueOn===null),[taxKnown,setTaxKnown]=useState(!!initial?.taxEvidence);
 const [reductions,setReductions]=useState<Reduction[]>(()=>initial?.reductions.map(reduction=>({id:crypto.randomUUID(),initial:reduction}))??[]),[remaining,setRemaining]=useState<string|null>(initial?.remainingCents??null);
 const form=useRef<HTMLFormElement|null>(null);
 function calculate(){try{if(!form.current)return;const data=new FormData(form.current),original=BigInt(amount(value(data,'payable-original'))),removed=reductions.reduce((sum,row)=>sum+BigInt(amount(value(data,row.id+'-amount'))),0n);setRemaining((original-removed).toString());}catch{setRemaining(null);}}
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();try{
   const data=new FormData(event.currentTarget),originalCents=amount(value(data,'payable-original'));
   const history=reductions.map(({id})=>({kind:value(data,id+'-kind') as 'payment'|'supplier_credit',reference:value(data,id+'-reference'),appliedOn:value(data,id+'-on'),amountCents:amount(value(data,id+'-amount')),evidence:readEvidence(data,id+'-evidence')}));
   const bill:PayableBill={billId,sourceNamespace:identityLocked&&initial?initial.sourceNamespace:value(data,'payable-source'),externalId:identityLocked&&initial?initial.externalId:value(data,'payable-reference'),vendor:identityLocked&&initial?initial.vendor:value(data,'payable-vendor'),purpose:value(data,'payable-purpose'),incurredOn:value(data,'payable-incurred'),originalDueOn:unknownDue?null:value(data,'payable-due'),unknownDueReason:unknownDue?value(data,'payable-due-reason'):null,originalCents,remainingCents:(BigInt(originalCents)-history.reduce((sum,row)=>sum+BigInt(row.amountCents),0n)).toString(),billEvidence:readEvidence(data,'payable-document'),reductions:history,taxEvidence:taxKnown?readEvidence(data,'payable-tax'):null};
   normalizeOpeningPayablesEvidence({schemaVersion:1,bills:[bill],reason:'Review historical unpaid supplier bill'},cutoverOn);onSave(bill);
  }catch{onError('Check the bill, dates and supporting documents. Earlier payments and credits must leave a positive amount still owed.');}
 }
 return <form ref={form} onSubmit={submit} onChange={calculate}>
  <fieldset className={styles.openingGroup} disabled={busy}><legend>{initial?'Review saved supplier bill':'Add an unpaid supplier bill'}</legend>
   <label htmlFor="payable-vendor">Supplier</label><input id="payable-vendor" name="payable-vendor" required maxLength={200} defaultValue={initial?.vendor} readOnly={identityLocked}/>
   <label htmlFor="payable-reference">Original bill reference</label><input id="payable-reference" name="payable-reference" required maxLength={200} defaultValue={initial?.externalId} readOnly={identityLocked}/>
   <label htmlFor="payable-source">Original records label</label><input id="payable-source" name="payable-source" required maxLength={100} pattern="[a-z][a-z0-9_.-]{0,99}" defaultValue={initial?.sourceNamespace??'legacy.supplier_bills'} readOnly={identityLocked}/>
   <p>Use a consistent lowercase label for the prior records. If bill numbers repeat by supplier, use a distinct records label for each supplier.</p>
   {identityLocked&&<p>The saved supplier and original record identity are retained.</p>}
   <Note name="payable-purpose" label="What was this bill for?" initial={initial?.purpose}/>
   <label htmlFor="payable-incurred">Original bill date</label><input id="payable-incurred" name="payable-incurred" type="date" required defaultValue={initial?.incurredOn}/>
   <label><input type="checkbox" checked={unknownDue} onChange={event=>setUnknownDue(event.target.checked)}/> Original due date is not available</label>
   {unknownDue?<Note name="payable-due-reason" label="What is missing from the due-date evidence?" initial={initial?.unknownDueReason??undefined}/>:<><label htmlFor="payable-due">Original due date</label><input id="payable-due" name="payable-due" type="date" required defaultValue={initial?.originalDueOn??undefined}/></>}
   <DollarField name="payable-original" label="Original bill amount (USD)" initial={initial?.originalCents}/>
   <fieldset className={styles.openingGroup}><legend>Original bill document</legend><OpeningEvidencePicker name="payable-document" label="Original bill" initial={initial?.billEvidence}/></fieldset>
   <h4>Earlier payments and supplier credits</h4><p>Include only activity before {cutoverOn}. These records reduce what is carried forward.</p>
   {reductions.map(({id,initial:row},index)=><fieldset key={id} className={styles.openingGroup}><legend>Earlier reduction {index+1}</legend>
    <label htmlFor={id+'-kind'}>Type</label><select id={id+'-kind'} name={id+'-kind'} defaultValue={row?.kind??'payment'}><option value="payment">Previously paid</option><option value="supplier_credit">Supplier credit</option></select>
    <Note name={id+'-reference'} label="Original payment or credit reference" initial={row?.reference}/>
    <label htmlFor={id+'-on'}>Date</label><input id={id+'-on'} name={id+'-on'} type="date" required defaultValue={row?.appliedOn}/>
    <DollarField name={id+'-amount'} label="Amount (USD)" initial={row?.amountCents}/><OpeningEvidencePicker name={id+'-evidence'} label={'Earlier reduction '+(index+1)} initial={row?.evidence}/>
    <button type="button" className="secondary" onClick={()=>{setReductions(current=>current.filter(row=>row.id!==id));setRemaining(null);}}>Remove this reduction</button>
   </fieldset>)}
   <button type="button" className="secondary" disabled={reductions.length>=100} onClick={()=>{setReductions(current=>[...current,{id:crypto.randomUUID(),initial:undefined}]);setRemaining(null);}}>Add earlier payment or credit</button>
   <dl className={styles.openingGroup}><dt>Amount still owed</dt><dd>{remaining===null?'Calculated from the original bill less earlier reductions':`$${dollars(remaining)} USD`}</dd></dl>
   <label><input type="checkbox" checked={taxKnown} onChange={event=>setTaxKnown(event.target.checked)}/> Original tax information is documented</label>
   {taxKnown?<fieldset className={styles.openingGroup}><legend>Original tax evidence</legend><OpeningEvidencePicker name="payable-tax" label="Original tax" initial={initial?.taxEvidence}/></fieldset>:<p>Original tax information stays marked as unknown.</p>}
   <p>Adding this bill to the review creates no expense or payment.</p><button type="submit">{initial?'Keep bill changes':'Add bill to review'}</button><button type="button" className="secondary" onClick={onCancel}>Cancel bill changes</button>
  </fieldset>
 </form>;
}
