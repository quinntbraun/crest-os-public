'use client';
import {useState} from 'react';

type Versioned=Readonly<{version:string}>;
export function previousLoadedFinanceVersion<T extends Versioned>(rows:readonly T[],current:T):T|undefined{
 const previous=BigInt(current.version)-1n;
 return previous<1n?undefined:rows.find(row=>BigInt(row.version)===previous);
}
type Field=Readonly<{label:string;before:string;after:string}>;
type Comparison=Readonly<{version:string;previousVersion?:string|undefined;fields:readonly Field[]}>;

export function FinanceHistoryComparisonValues({version,previousVersion,fields}:Comparison){
 return previousVersion?<>
   <p className="financial-history-compare-caption">Previous version {previousVersion} → this version {version}</p>
   <dl className="financial-history-compare-values">{fields.map(field=><div key={field.label} data-changed={field.before!==field.after}>
     <dt>{field.label}{field.before!==field.after&&<span className="financial-history-change">Changed</span>}</dt>
     {(['before','after'] as const).map(side=><dd key={side} data-side={side}>
      <span className="financial-history-compare-side">{side==='before'?'Previous':'This version'}</span>
      <p className="financial-history-compare-value">{field[side]}</p>
     </dd>)}
    </div>)}</dl>
  </>:<p className="field-help">{version==='1'?'This is the first saved version.':'The previous version is not in the loaded history. Load earlier history to compare it.'}</p>;
}

export function FinanceHistoryComparison(props:Comparison){
 const [open,setOpen]=useState(false);
 return <details className="financial-history-comparison" data-version={props.version} data-previous-version={props.previousVersion} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Compare versions</summary>
  {open&&<div className="financial-history-comparison-content"><FinanceHistoryComparisonValues {...props}/></div>}
 </details>;
}
