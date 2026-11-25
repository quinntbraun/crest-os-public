'use client';

import {useState} from 'react';
import type {FormEvent} from 'react';
import {normalizeOpeningFundsEvidence} from '../../../bookkeeping/opening-funds-contract';
import type {OpeningFundsInput} from '../../../bookkeeping/opening-funds-contract';
import {DollarField,EvidenceFields,Note,amount,readEvidence,value} from './opening-worksheet-fields';
import styles from './screen.module.css';

export type FundOrigin=OpeningFundsInput['roots'][number];
export type FundCustomer={id:string;label:string};
type FundItem=FundOrigin['items'][number];
type ItemDraft={id:string;customerId:string;label:string;initial:FundItem|undefined};
type ReductionDraft={id:string;initial:FundOrigin['reductions'][number]|undefined};
const reductionKinds={application:'Applied to earlier work',refund:'Previously refunded',tip_conversion:'Previously converted to a tip',collection_failure:'Payment failed',noncustomer_reclassification:'Previously reclassified'} as const;

function AllocationFields({id,customer,initial,onRemove}:{id:string;customer:string;initial:FundItem|undefined;onRemove:()=>void}){
 const [known,setKnown]=useState(initial?.refundableCeilingCents!==null&&initial?.refundableCeilingCents!==undefined);
 return <fieldset className={styles.openingGroup}>
  <legend>{customer}</legend>
  <DollarField name={id+'-held'} label="Still held for this customer (USD)" initial={initial?.heldCents}/>
  <fieldset className={styles.openingGroup}><legend>Customer obligation evidence</legend><EvidenceFields name={id+'-obligation'} initial={initial?.obligationEvidence}/></fieldset>
  <label htmlFor={id+'-refund-state'}>Is the refundable amount documented?</label>
  <select id={id+'-refund-state'} name={id+'-refund-state'} value={known?'documented':'unknown'} onChange={event=>setKnown(event.target.value==='documented')}>
   <option value="unknown">Unknown — needs review</option><option value="documented">Documented amount, including zero</option>
  </select>
  {known&&<>
   <DollarField name={id+'-refundable'} label="Documented refundable ceiling (USD)" initial={initial?.refundableCeilingCents}/>
   <EvidenceFields name={id+'-refund'} initial={initial?.refundEvidence}/>
  </>}
  <button type="button" className="secondary" onClick={onRemove}>Remove this allocation</button>
 </fieldset>;
}

export function OpeningFundsSourceForm({initial,identityLocked,choices,labels,cutoverOn,busy,onSave,onCancel,onError}:{
 initial:FundOrigin|null;identityLocked:boolean;choices:readonly FundCustomer[];labels:ReadonlyMap<string,string>;cutoverOn:string;busy:boolean;
 onSave:(root:FundOrigin)=>void;onCancel:()=>void;onError:(message:string)=>void;
}){
 const [rootId]=useState(()=>initial?.rootId??crypto.randomUUID());
 const [items,setItems]=useState<ItemDraft[]>(()=>initial?.items.map((item,index)=>({id:item.itemId,customerId:item.customerId,label:labels.get(item.customerId)??`Saved customer allocation ${index+1}`,initial:item}))??[]);
 const [reductions,setReductions]=useState<ReductionDraft[]>(()=>initial?.reductions.map(item=>({id:crypto.randomUUID(),initial:item}))??[]);
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  try{
   const form=new FormData(event.currentTarget);
   const root:FundOrigin={rootId,sourceNamespace:identityLocked&&initial?initial.sourceNamespace:value(form,'fund-origin-system'),externalId:identityLocked&&initial?initial.externalId:value(form,'fund-origin-reference'),
    receivedOn:value(form,'fund-received-on'),receivedCents:amount(value(form,'fund-received')),receiptEvidence:readEvidence(form,'fund-receipt'),
    reductions:reductions.map(({id})=>({kind:value(form,id+'-kind') as keyof typeof reductionKinds,reference:value(form,id+'-reference'),occurredOn:value(form,id+'-on'),amountCents:amount(value(form,id+'-amount')),evidence:readEvidence(form,id+'-evidence')})),
    items:items.map(({id,customerId})=>{const known=value(form,id+'-refund-state')==='documented';return {itemId:id,customerId,heldCents:amount(value(form,id+'-held')),obligationEvidence:readEvidence(form,id+'-obligation'),refundableCeilingCents:known?amount(value(form,id+'-refundable')):null,refundEvidence:known?readEvidence(form,id+'-refund'):null};}),
   };
   normalizeOpeningFundsEvidence({schemaVersion:1,reason:'Review retained customer deposit',roots:[root]},cutoverOn);onSave(root);
  }catch{onError('Check the dates, evidence and amounts. The original receipt less earlier reductions must equal the total still held for customers.');}
 }
 return <form onSubmit={submit}>
  <fieldset className={styles.openingGroup} disabled={busy}>
   <legend>{initial?'Edit deposit evidence':'Add a pre-cutover deposit'}</legend>
   <p>Enter the original receipt once, then account for earlier uses and the amount still owed to each customer.</p>
   <label htmlFor="fund-origin-system">Original system reference</label>
   <input id="fund-origin-system" name="fund-origin-system" required maxLength={100} pattern="[a-z][a-z0-9_.\-]*" defaultValue={initial?.sourceNamespace??'legacy.receipts'} readOnly={identityLocked} autoCapitalize="none" spellCheck={false}/>
   <label htmlFor="fund-origin-reference">Original receipt reference</label>
   <input id="fund-origin-reference" name="fund-origin-reference" required maxLength={200} defaultValue={initial?.externalId} readOnly={identityLocked}/>
   <label htmlFor="fund-received-on">Original receipt date (before {cutoverOn})</label>
   <input id="fund-received-on" name="fund-received-on" type="date" required defaultValue={initial?.receivedOn}/>
   <DollarField name="fund-received" label="Original amount received (USD)" initial={initial?.receivedCents}/>
   <fieldset className={styles.openingGroup}><legend>Original receipt evidence</legend><EvidenceFields name="fund-receipt" initial={initial?.receiptEvidence}/></fieldset>
   {reductions.map(({id,initial:item},index)=><fieldset className={styles.openingGroup} key={id}>
    <legend>Earlier reduction {index+1}</legend>
    <label htmlFor={id+'-kind'}>What happened?</label><select id={id+'-kind'} name={id+'-kind'} defaultValue={item?.kind??'application'}>{Object.entries(reductionKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    <Note name={id+'-reference'} initial={item?.reference} label="Earlier transaction reference"/>
    <label htmlFor={id+'-on'}>Date of earlier transaction</label><input id={id+'-on'} name={id+'-on'} type="date" required defaultValue={item?.occurredOn}/>
    <DollarField name={id+'-amount'} label="Amount no longer held (USD)" initial={item?.amountCents}/>
    <EvidenceFields name={id+'-evidence'} initial={item?.evidence}/>
    <button type="button" className="secondary" onClick={()=>setReductions(rows=>rows.filter(row=>row.id!==id))}>Remove reduction {index+1}</button>
   </fieldset>)}
   <button type="button" className="secondary" disabled={reductions.length>=100} onClick={()=>setReductions(rows=>[...rows,{id:crypto.randomUUID(),initial:undefined}])}>Add earlier use, refund or other reduction</button>
   <h4>Who is the remaining money held for?</h4>
   <p>Use the customer search above to add an allocation. One receipt can cover more than one customer.</p>
   {choices.map(customer=><button type="button" className="secondary" key={customer.id} disabled={items.length>=200} onClick={()=>setItems(rows=>[...rows,{id:crypto.randomUUID(),customerId:customer.id,label:customer.label,initial:undefined}])}>Allocate to {customer.label}</button>)}
   {items.map(item=><AllocationFields key={item.id} id={item.id} customer={item.label} initial={item.initial} onRemove={()=>setItems(rows=>rows.filter(row=>row.id!==item.id))}/>)}
   {items.length===0&&<p>Add at least one customer allocation before reviewing this deposit.</p>}
   <button type="submit" disabled={items.length===0}>Review this deposit</button>
   <button type="button" className="secondary" onClick={onCancel}>Cancel deposit edits</button>
  </fieldset>
 </form>;
}
