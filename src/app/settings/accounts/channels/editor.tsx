'use client';

import {useEffect,useRef} from 'react';
import type {FormEvent} from 'react';
import {moneyChannelKinds,moneyChannelScopes,moneyChannelScope,moneyChannelOpeningStates} from '../../../../bookkeeping/finance-money-channel-contract';
import type {MoneyChannel,MoneyChannelKind,MoneyChannelScope} from '../../../../bookkeeping/finance-money-channel-contract';
import styles from '../screen.module.css';

export type ChannelEditorFields={
 kind:MoneyChannelKind|'';scope:MoneyChannelScope|'';accountId:string;provider:string;suffix:string;label:string;date:string;
 ownership:string;openingState:MoneyChannel['openingState'];openingOn:string;openingAmount:string;openingEvidence:string;
 active:boolean;reason:string;
};
type Choices={rows:readonly {id:string;code:string;name:string}[];hasMore:boolean};

export function MoneyChannelEditor({record,fields,choices,busy,canSave,change,findAccounts,save,cancel}:{
 record:MoneyChannel|null;fields:ChannelEditorFields;choices:Choices|null;busy:boolean;canSave:boolean;
 change:(fields:Partial<ChannelEditorFields>)=>void;findAccounts:(more:boolean)=>void;save:(event:FormEvent)=>void;cancel:()=>void;
}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 const kind=fields.kind,external=kind==='bank'||kind==='wallet',knownOpening=fields.openingState!=='unknown';
 return <form onSubmit={save}>
  <h2 ref={heading} className="editor-heading" tabIndex={-1}>{record?'Review '+record.label:'Add money channel'}</h2>
  {!record&&<>
   <div className={styles.lookupFields}>
    <div>
     <label htmlFor="channel-kind">Channel type</label>
     <select id="channel-kind" value={kind} required disabled={busy}
      onChange={event=>change({kind:event.target.value as ChannelEditorFields['kind'],scope:'',accountId:'',provider:'',suffix:''})}>
      <option value="">Choose a type</option>
      {Object.entries(moneyChannelKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select>
    </div>
    <div>
     <label htmlFor="channel-scope">Ownership</label>
     <select id="channel-scope" value={fields.scope} required disabled={busy||!kind}
      onChange={event=>change({scope:event.target.value as ChannelEditorFields['scope'],accountId:''})}>
      <option value="">Choose ownership</option>
      {kind&&Object.entries(moneyChannelScopes).filter(([value])=>moneyChannelScope(kind,value))
       .map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select>
    </div>
   </div>
   <div className={styles.actions}>
    <button type="button" className="secondary" disabled={busy||!kind||!fields.scope} onClick={()=>findAccounts(false)}>
     Find eligible accounts
    </button>
   </div>
   {choices&&<>
    <label htmlFor="channel-account">Linked account</label>
    <select id="channel-account" value={fields.accountId} required disabled={busy} onChange={event=>change({accountId:event.target.value})}>
     <option value="">Choose an account</option>
     {choices.rows.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
    </select>
    {choices.hasMore&&<div className={styles.actions}>
     <button type="button" className="secondary" disabled={busy} onClick={()=>findAccounts(true)}>More accounts</button>
    </div>}
    {!choices.rows.length&&<p className="field-help">Add an eligible control account in the chart of accounts first.</p>}
   </>}
   {external&&<div className={styles.lookupFields}>
    <div>
     <label htmlFor="channel-provider">Provider code</label>
     <input id="channel-provider" value={fields.provider} disabled={busy} required maxLength={64} autoCapitalize="none" spellCheck={false}
      aria-describedby="channel-provider-help" onChange={event=>change({provider:event.target.value})}/>
     <p id="channel-provider-help" className="field-help">Use letters, numbers, hyphens or underscores. Start with a letter.</p>
    </div>
    <div>
     <label htmlFor="channel-suffix">Last four characters</label>
     <input id="channel-suffix" value={fields.suffix} disabled={busy} required maxLength={4} autoCapitalize="characters"
      onChange={event=>change({suffix:event.target.value})}/>
    </div>
   </div>}
  </>}
  <label htmlFor="channel-label">Channel name</label>
  <input id="channel-label" value={fields.label} required disabled={busy} maxLength={200}
   onChange={event=>change({label:event.target.value})}/>
  <label htmlFor="channel-date">Effective from</label>
  <input id="channel-date" type="date" value={fields.date} required disabled={busy}
   onChange={event=>change({date:event.target.value})}/>
  <details open={knownOpening?true:undefined}>
   <summary>Ownership and opening evidence</summary>
   {fields.scope==='mixed_personal'&&<p className="field-help">Record only Crest’s share of funds held by the owner.</p>}
   <label htmlFor="channel-ownership">Ownership evidence {knownOpening?'':'(optional)'}</label>
   <textarea id="channel-ownership" rows={2} maxLength={1000} value={fields.ownership} disabled={busy} required={knownOpening}
    aria-describedby="channel-evidence-help" onChange={event=>change({ownership:event.target.value})}/>
   <p id="channel-evidence-help" className="field-help">Use a private reference to your review evidence. Keep credentials and full account numbers outside Crest.</p>
   <label htmlFor="channel-opening-state">Opening status</label>
   <select id="channel-opening-state" value={fields.openingState} disabled={busy}
    onChange={event=>change({openingState:event.target.value as ChannelEditorFields['openingState'],
     openingOn:'',openingAmount:'',openingEvidence:''})}>
    {Object.entries(moneyChannelOpeningStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </select>
   {knownOpening&&<>
    <label htmlFor="channel-opening-on">Opening date</label>
    <input id="channel-opening-on" type="date" value={fields.openingOn} required disabled={busy}
     onChange={event=>change({openingOn:event.target.value})}/>
    {fields.openingState==='verified'&&<>
     <label htmlFor="channel-opening-amount">Opening amount ($)</label>
     <input id="channel-opening-amount" value={fields.openingAmount} inputMode="decimal" required disabled={busy} maxLength={24}
      onChange={event=>change({openingAmount:event.target.value})}/>
    </>}
    <label htmlFor="channel-opening-evidence">Opening evidence</label>
    <textarea id="channel-opening-evidence" rows={2} maxLength={1000} value={fields.openingEvidence} required disabled={busy}
     onChange={event=>change({openingEvidence:event.target.value})}/>
   </>}
  </details>
  {record&&<>
   <label htmlFor="channel-availability">Review record status</label>
   <select id="channel-availability" value={fields.active?'open':'closed'} disabled={busy}
    onChange={event=>change({active:event.target.value==='open'})}>
    <option value="open">Open</option><option value="closed">Closed</option>
   </select>
  </>}
  <label htmlFor="channel-reason">Reason for review</label>
  <textarea id="channel-reason" rows={2} maxLength={1000} value={fields.reason} required disabled={busy}
   onChange={event=>change({reason:event.target.value})}/>
  <div className={styles.actions}>
   <button type="submit" disabled={busy||!canSave}>Save channel review</button>
   <button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button>
  </div>
 </form>;
}
