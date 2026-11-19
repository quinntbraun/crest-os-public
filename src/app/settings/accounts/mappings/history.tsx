import type {Ref} from 'react';
import type {parseFinanceMappingHistory,FinanceMappingPurpose} from '../../../../bookkeeping/finance-mapping-contract';
import {financeMappingLabels} from '../../../../bookkeeping/finance-mapping-contract';
import {financeMappingPeriods} from '../../../../bookkeeping/finance-mapping-presentation';
type History=ReturnType<typeof parseFinanceMappingHistory>;
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(value:string)=>dateFormat.format(new Date(value+'T00:00:00Z'));

export function MappingApprovalHistory({history,purpose,categories,heading,disabled,download,more,embedded=false}:{history:History;purpose:FinanceMappingPurpose|'';categories:boolean;heading:Ref<HTMLHeadingElement>;disabled:boolean;download:()=>void;more:()=>void;embedded?:boolean}){
 const first=history.rows[0],last=history.rows.at(-1);
 const HistoryHeading=embedded?'h3':'h2';
 return <section className={'mapping-history-panel '+(embedded?'mapping-history-inline':'mapping-summary-card')} aria-label="Saved mapping history">
  <header className="mapping-history-header"><div><HistoryHeading ref={heading} className="editor-heading" tabIndex={-1}>Approval history</HistoryHeading>{purpose&&<p>{financeMappingLabels[purpose]}</p>}</div>{first&&<button type="button" className="secondary" disabled={disabled} onClick={download}>Download loaded approvals (CSV)</button>}</header>
  {categories&&purpose&&!embedded&&<a href={'/settings/accounts/mappings/categories/manage?purpose='+encodeURIComponent(purpose)}>Manage approvals for {financeMappingLabels[purpose]}</a>}
  {!first?<p>No approved versions for this {categories?'category':'purpose'}.</p>:<>
   <p className="mapping-history-coverage">{first.version===last!.version?'Version '+first.version+' loaded.':'Versions '+first.version+' through '+last!.version+' loaded.'} {history.hasMore?'Older approvals have not been loaded.':'This includes the first recorded approval.'} {embedded?'Reload approval settings':'Reload history'} to check for newer versions.</p>
   <ol className="mapping-history-list mapping-period-timeline">{financeMappingPeriods(history.rows).map(({row,effectiveFrom,effectiveUntil})=><li key={row.id} data-closed={row.accountId===null}>
    <details><summary><strong>Version {row.version} · {row.accountCode===null?'Closed':`Account ${row.accountCode}`}</strong><span>From {dateLabel(effectiveFrom)}{effectiveUntil?' · Before '+dateLabel(effectiveUntil):' · Newest loaded version'}</span>{row.accountId===null&&<span className="mapping-period-closed">No posting account assigned by this version</span>}</summary>
     <div className="mapping-period-reason"><h3>Approval reason</h3><p>{row.reason}</p>{effectiveUntil&&<p className="field-help">The next version starts {dateLabel(effectiveUntil)}. This period excludes that date.</p>}</div>
    </details>
   </li>)}</ol>
   <p className="mapping-history-boundary">{history.hasMore?'Earlier periods are not shown. Load older approvals before drawing conclusions about them.':'No earlier mapping approval is recorded before '+dateLabel(last!.effectiveFrom)+' in this loaded history.'}</p>
   {history.hasMore&&<button type="button" className="secondary" disabled={disabled} onClick={more}>Load older approvals</button>}
  </>}
 </section>;
}
