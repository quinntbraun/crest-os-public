import type {QuoteAmendmentCustomerComparison} from '../../../commercial/quote-amendment-comparison';
import type {prepareQuoteCancellationComparison} from '../../../commercial/quote-cancellation-comparison';
import {quoteMoney} from '../../../commercial/quote-pricing';
import {QuoteDocument} from '../quote-document';
import type {QuoteDocumentContent} from '../quote-document';

type Comparison=QuoteAmendmentCustomerComparison|Awaited<ReturnType<typeof prepareQuoteCancellationComparison>>['customer'];
type CustomerLine=Readonly<{description:string;vehicle:string|null;finalCents:string}>;
function ScopeRow({line,label}:{line:CustomerLine;label:string}){
 return <li><div className="amendment-scope-identity"><strong>{line.description}</strong><span>{line.vehicle??'Job-wide scope'}</span></div><span className="amendment-scope-label">{label}</span><span className="amendment-scope-amount">{quoteMoney(line.finalCents)}</span></li>;
}

// The parsed saved read binds these customer-safe snapshots and positional
// changes to the amendment's own parent, including historical parents. Never
// read the unsaved editor or substitute the family's latest accepted parent.
export function AmendmentScopeOverview({comparison,original,after,accepted}:{comparison:Comparison;original:QuoteDocumentContent;after:readonly CustomerLine[];accepted:boolean}){
 const before=original.lines;
 const earlier=new Map(comparison.lineChanges.filter(change=>change.beforePosition!==null).map(change=>[change.beforePosition,change.kind]));
 const later=new Map(comparison.lineChanges.filter(change=>change.afterPosition!==null).map(change=>[change.afterPosition,change.kind]));
 const count=(kind:string)=>comparison.lineChanges.filter(change=>change.kind===kind).length;
 const labels={added:'Added',removed:comparison.schemaVersion===1?'Removed':accepted?'Authorization withdrawn':'Proposed withdrawal',changed:'Changed',moved:'Reordered'};
 const retained=before.length-earlier.size;
 return <section className="amendment-scope-overview" aria-label="Saved scope comparison">
  <header><h3>Scope at a glance</h3><p>Saved work only. {accepted?'The earlier agreement stays in history.':'Your original agreement remains in effect until this proposal is separately accepted.'}</p></header>
  <dl className="amendment-scope-counts" aria-label="Saved work changes">{[['Retained',retained],['Changed',count('changed')],['Added',count('added')],[labels.removed,count('removed')],['Reordered',count('moved')]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <div className="amendment-scope-columns">
   <section aria-label="Original scope"><h4>Original <span>Agreement {comparison.previousAgreementVersion}</span></h4>{before.length>0?<ul role="list">{before.map((line,index)=><ScopeRow key={index} line={line} label={earlier.has(index+1)?labels[earlier.get(index+1)!]:'Retained'}/>)}</ul>:<p>No work in this agreement.</p>}</section>
   <section aria-label={accepted?'Accepted changed scope':'Proposed scope'}><h4>{accepted?'Accepted change':'Proposed'} <span>Agreement {comparison.proposedAgreementVersion}</span></h4>{after.length>0?<ul role="list">{after.map((line,index)=><ScopeRow key={index} line={line} label={later.has(index+1)?labels[later.get(index+1)!]:'Retained'}/>)}</ul>:<p>No work remains in this {accepted?'accepted change':'proposal'}.</p>}</section>
  </div>
  <p className="field-help">Full inclusions, exclusions and terms are preserved in the saved comparison and agreement documents.</p>
  <details className="amendment-original-document"><summary>Read original agreement · version {comparison.previousAgreementVersion}</summary><QuoteDocument quote={original} stage="accepted" contextLabel={'Original agreement '+comparison.previousAgreementVersion}/></details>
 </section>;
}
