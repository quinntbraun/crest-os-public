import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
import type {ExpensePayload,ExpenseRevision} from '../../bookkeeping/expenses/expense-contract';

const fields=[['amountCents','Amount'],['paidOn','Payment date'],['category','Category'],['description','Description'],['vendor','Vendor'],['paymentMethod','Payment method'],['reference','Reference'],['notes','Notes'],['voided','Record state']] as const;
const day=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium'});
const instant=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
function value(payload:ExpensePayload,key:typeof fields[number][0]){
 const raw=payload[key];
 if(key==='amountCents')return '$'+expenseDollars(payload.amountCents)+' USD';
 if(key==='paidOn')return day.format(new Date(payload.paidOn+'T00:00:00Z'));
 if(key==='voided')return payload.voided?'Void':'Recorded';
 return raw===null?'Not recorded':String(raw);
}
// Presentation only. Never compare across expenses or infer a missing version.
export function expensePayloadChanges(previous:ExpenseRevision|undefined,current:ExpenseRevision){
 if(!previous||previous.businessId!==current.businessId||previous.expenseId!==current.expenseId||BigInt(previous.revision)+1n!==BigInt(current.revision))return null;
 return fields.filter(([key])=>previous.payload[key]!==current.payload[key]).map(([key,label])=>({key,label,before:value(previous.payload,key),after:value(current.payload,key)}));
}
export function ExpenseRevisionHistory({revisions}:{revisions:readonly ExpenseRevision[]}){
 const ordered=[...revisions].sort((a,b)=>BigInt(a.revision)<BigInt(b.revision)?-1:BigInt(a.revision)>BigInt(b.revision)?1:0);
 return <ol className="expense-revision-history" aria-label="Retained expense revisions">{ordered.map((row,index)=>{
  const changes=expensePayloadChanges(ordered[index-1],row);
  return <li key={row.revision}>
   <header><div><strong>Revision {row.revision}: ${expenseDollars(row.payload.amountCents)} USD</strong><span className="expense-revision-kind">{row.payload.voided?'Voided':row.revision==='1'?'Initial entry':'Correction'}</span></div><p>Recorded <time dateTime={row.recordedAt} title={row.recordedAt}>{instant.format(new Date(row.recordedAt))} UTC</time></p></header>
   <p className="expense-revision-paid">Payment date: <time dateTime={row.payload.paidOn}>{day.format(new Date(row.payload.paidOn+'T00:00:00Z'))}</time>{row.payload.voided?' · Amount retained for history; this revision voids the expense.':''}</p>
   {row.payload.changeReason&&<section className="expense-revision-reason" aria-label={'Reason for revision '+row.revision}><h4>Reason</h4><p>{row.payload.changeReason}</p></section>}
   {changes===null?row.revision!=='1'&&<p>The preceding revision is not available here for comparison.</p>:changes.length>0?<details className="expense-revision-comparison"><summary>What changed in revision {row.revision} ({changes.length} {changes.length===1?'field':'fields'})</summary><dl>{changes.map(change=><div key={change.key}><dt>{change.label}</dt><dd><span>Before</span><p>{change.before}</p></dd><dd><span>This revision</span><p>{change.after}</p></dd></div>)}</dl></details>:<p>No purchase fields changed; the retained reason is shown above.</p>}
   <details className="expense-revision-evidence"><summary>Saved values and exact evidence for revision {row.revision}</summary><dl>{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{value(row.payload,key)}</dd></div>)}<div><dt>Exact recorded time (UTC)</dt><dd><time dateTime={row.recordedAt}>{row.recordedAt}</time></dd></div><div><dt>Actor reference</dt><dd>{row.actorId}</dd></div><div><dt>Operation reference</dt><dd>{row.operationId}</dd></div></dl></details>
  </li>;
 }).reverse()}</ol>;
}
