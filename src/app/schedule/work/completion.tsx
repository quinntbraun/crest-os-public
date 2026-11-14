'use client';
import {useId,useState} from 'react';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import type {CompletionAssignment,CompletionBody,CompletionContext,CompletionSummary} from '../../../operations/work-completion-contract';
import type {CompletionAllocation,CompletionPiece,WorkOutcome} from '../../../operations/work-completion';
import {isReviewOutcomeAction} from '../../../security/original-operation-reference';
import type {ReviewOutcomeAction} from '../../../security/original-operation-reference';
import type {ReviewOutcomeBody,ReviewOutcomeContext} from '../../../operations/review-message-contract';
import {ReviewMessageHistory} from '../../review-message-history';

type OutcomeChoice=''|WorkOutcome;
type Selection=OutcomeChoice|'split';
type PieceDraft={id:string;outcome:OutcomeChoice;description:string;gross:string;discount:string;reason:string};
type ScopeDraft={selection:Selection;reason:string;pieces:PieceDraft[]};
const blank:ScopeDraft={selection:'',reason:'',pieces:[]};
const labels={completed:'Fulfilled',unfulfilled:'Unfulfilled',cancelled:'Cancelled'} satisfies Record<WorkOutcome,string>;
const optional=(value:string)=>value.trim()||null;
function pieceDraft(id:string,outcome:OutcomeChoice='',complimentary=false):PieceDraft{
 return {id,outcome,description:'',gross:complimentary?'0.00':'',discount:complimentary?'0.00':'',reason:''};
}
function savedAllocation(row:CompletionAssignment,draft:ScopeDraft):CompletionAllocation{
 if(!draft.selection)throw Error('Choose an outcome for every assigned item.');
 let pieces:CompletionPiece[];
 if(draft.selection==='split'){
  pieces=draft.pieces.map(piece=>{
   if(!piece.outcome||!piece.description.trim())throw Error('Describe and choose an outcome for every portion.');
   if(piece.outcome!=='completed'&&!piece.reason.trim())throw Error('Explain each unfinished or cancelled portion.');
   let gross:bigint,discount:bigint;
   try{gross=BigInt(quoteDollarsInput(piece.gross));discount=BigInt(quoteDollarsInput(piece.discount));}
   catch{throw Error('Enter a dollar amount for gross and discount on each portion.');}
   if(discount>gross)throw Error('A portion’s discount cannot exceed its gross amount.');
   return {partitionId:piece.id,outcome:piece.outcome,scopeDescription:piece.description.trim(),
    grossInclusiveCents:gross.toString(),discountInclusiveCents:discount.toString(),amountCents:(gross-discount).toString(),
    reason:piece.outcome==='completed'?null:piece.reason.trim()};
  });
  const total=(key:'grossInclusiveCents'|'discountInclusiveCents')=>pieces.reduce((sum,piece)=>sum+BigInt(piece[key]),0n);
  if(pieces.length<2||total('grossInclusiveCents')!==BigInt(row.grossInclusiveCents)
    ||total('discountInclusiveCents')!==BigInt(row.discountInclusiveCents)){
   throw Error('Portion amounts must add up to the saved gross amount and discount.');
  }
 }else{
  if(draft.selection!=='completed'&&!draft.reason.trim())throw Error('Explain each unfinished or cancelled item.');
  pieces=[{partitionId:row.partitionId,outcome:draft.selection,scopeDescription:row.scopeDescription,
   grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,
   reason:draft.selection==='completed'?null:draft.reason.trim()}];
 }
 return {assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,pieces};
}

function OutcomeOptions({split=false}:{split?:boolean}){
 return <><option value="">Choose an outcome</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}{split&&<option value="split">Divide into portions</option>}</>;
}
function Portion({piece,index,change,remove}:{piece:PieceDraft;index:number;change:(next:PieceDraft)=>void;remove?:(()=>void)|undefined}){
 const id=useId();
 return <fieldset>
  <legend>Portion {index+1}</legend>
  <label htmlFor={id+'-outcome'}>Portion outcome</label>
  <select id={id+'-outcome'} value={piece.outcome} required onChange={event=>change({...piece,outcome:event.target.value as OutcomeChoice})}><OutcomeOptions/></select>
  <label htmlFor={id+'-description'}>Work in this portion</label>
  <textarea id={id+'-description'} rows={2} maxLength={2000} required value={piece.description} onChange={event=>change({...piece,description:event.target.value})}/>
  <label htmlFor={id+'-gross'}>Gross amount in dollars</label>
  <input id={id+'-gross'} inputMode="decimal" value={piece.gross} maxLength={22} required onChange={event=>change({...piece,gross:event.target.value})}/>
  <label htmlFor={id+'-discount'}>Discount in dollars</label>
  <input id={id+'-discount'} inputMode="decimal" value={piece.discount} maxLength={22} required onChange={event=>change({...piece,discount:event.target.value})}/>
  {piece.outcome&&piece.outcome!=='completed'&&<>
   <label htmlFor={id+'-reason'}>Reason for unfinished portion</label>
   <textarea id={id+'-reason'} rows={2} maxLength={1000} required value={piece.reason} onChange={event=>change({...piece,reason:event.target.value})}/>
  </>}
  {remove&&<button type="button" className="secondary" onClick={remove}>Remove portion {index+1}</button>}
 </fieldset>;
}
function AssignedScope({row,index,draft,change}:{row:CompletionAssignment;index:number;draft:ScopeDraft;change:(next:ScopeDraft)=>void}){
 const id=useId(),complimentary=row.grossInclusiveCents==='0';
 return <fieldset>
  <legend>Assigned item {index+1}</legend>
  <p className="completion-text">{row.scopeDescription}</p>
  <label htmlFor={id+'-outcome'}>Outcome for item {index+1}</label>
  <select id={id+'-outcome'} value={draft.selection} required onChange={event=>{
   const selection=event.target.value as Selection;
   change({selection,reason:'',pieces:selection==='split'
    ?[pieceDraft(row.partitionId,'completed',complimentary),pieceDraft(crypto.randomUUID(),'unfulfilled',complimentary)]:[]});
  }}><OutcomeOptions split/></select>
  {draft.selection==='split'&&<>
   <p className="field-help">Saved gross {quoteMoney(row.grossInclusiveCents)} and discount {quoteMoney(row.discountInclusiveCents)}. Divide these amounts across the portions. This records fulfillment against the accepted scope.</p>
   {draft.pieces.map((piece,position)=><Portion key={piece.id} piece={piece} index={position}
    change={next=>change({...draft,pieces:draft.pieces.map(item=>item.id===next.id?next:item)})}
    remove={position>0&&draft.pieces.length>2?()=>change({...draft,pieces:draft.pieces.filter(item=>item.id!==piece.id)}):undefined}/>)}
   <button type="button" className="secondary" onClick={()=>change({...draft,pieces:[...draft.pieces,pieceDraft(crypto.randomUUID(),'',complimentary)]})}>Add a portion</button>
  </>}
  {draft.selection&&draft.selection!=='completed'&&draft.selection!=='split'&&<>
   <label htmlFor={id+'-reason'}>Reason for unfinished item</label>
   <textarea id={id+'-reason'} rows={2} maxLength={1000} required value={draft.reason} onChange={event=>change({...draft,reason:event.target.value})}/>
  </>}
 </fieldset>;
}

export function CompletionEditor({context,disabled,save}:{context:CompletionContext;disabled:boolean;save:(body:CompletionBody)=>Promise<void>}){
 const id=useId();
 const [scope,setScope]=useState<Record<string,ScopeDraft>>({});
 const [walkthrough,setWalkthrough]=useState<''|'done'|'unavailable'>('');
 const [reason,setReason]=useState(''),[walkthroughReason,setWalkthroughReason]=useState('');
 const [reviewUrl,setReviewUrl]=useState(''),[skipReason,setSkipReason]=useState('');
 const [additional,setAdditional]=useState(''),[contactReview,setContactReview]=useState('');
 const [error,setError]=useState('');
 return <form className="field-work-form completion-work-form" onSubmit={event=>{
  event.preventDefault();
  if(disabled)return;
  setError('');
  let body:CompletionBody;
  try{
   const allocations=context.assignments.map(row=>savedAllocation(row,scope[row.assignedPartId]??blank));
   if(!allocations.some(row=>row.pieces.some(piece=>piece.outcome==='completed')))throw Error('Record at least one fulfilled portion to end this job.');
   if(!walkthrough||walkthrough==='unavailable'&&!walkthroughReason.trim())throw Error('Record the walkthrough outcome and any required reason.');
   body={scope:allocations,reason:optional(reason),walkthrough:{state:walkthrough,reason:walkthrough==='done'?null:walkthroughReason.trim()},
    review:{reviewUrl:optional(reviewUrl),skipReason:optional(skipReason),additionalRequestReason:optional(additional),
     expectedDuplicateRequestIds:context.duplicateRequestIds,expectedCustomerVersion:context.customerVersion,contactReviewReason:optional(contactReview)}};
  }catch(problem){setError(problem instanceof Error?problem.message:'Review the completion details.');return;}
  void save(body);
 }}>
  <p className="eyebrow">{context.jobState==='paused'?'Paused':'In progress'} · Saved version {context.jobVersion}</p>
  <p>End the current work interval and record what was done. Unfinished work will be flagged for review.</p>
  <fieldset disabled={disabled}>
   <legend>Scope outcomes</legend>
   <button type="button" className="secondary" onClick={()=>setScope(Object.fromEntries(context.assignments.map(row=>[row.assignedPartId,{selection:'completed',reason:'',pieces:[]}])))}>Mark all items fulfilled</button>
   {context.assignments.map((row,index)=><AssignedScope key={row.assignedPartId} row={row} index={index} draft={scope[row.assignedPartId]??blank}
    change={next=>setScope(current=>({...current,[row.assignedPartId]:next}))}/>)}
  </fieldset>
  <fieldset disabled={disabled}>
   <legend>Walkthrough</legend>
   <label htmlFor={id+'-walkthrough'}>Walkthrough outcome</label>
   <select id={id+'-walkthrough'} value={walkthrough} required onChange={event=>setWalkthrough(event.target.value as typeof walkthrough)}>
    <option value="">Choose an outcome</option><option value="done">Done</option><option value="unavailable">Unavailable</option>
   </select>
   {walkthrough==='unavailable'&&<>
    <label htmlFor={id+'-walkthrough-reason'}>Why was the walkthrough unavailable?</label>
    <textarea id={id+'-walkthrough-reason'} rows={2} maxLength={1000} required value={walkthroughReason} onChange={event=>setWalkthroughReason(event.target.value)}/>
   </>}
  </fieldset>
  <fieldset disabled={disabled}>
   <legend>Optional details</legend>
   <details><summary>Completion note and review request</summary>
    <label htmlFor={id+'-reason'}>Completion note</label><textarea id={id+'-reason'} rows={2} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
    <label htmlFor={id+'-url'}>HTTPS review link</label><input id={id+'-url'} inputMode="url" maxLength={2048} value={reviewUrl} onChange={event=>setReviewUrl(event.target.value)}/>
    <p className="field-help">Leave the link blank to keep the review request pending. An eligible message is saved as a draft.</p>
    <label htmlFor={id+'-skip'}>Reason to skip the review request</label><textarea id={id+'-skip'} rows={2} maxLength={1000} value={skipReason} onChange={event=>setSkipReason(event.target.value)}/>
    {context.contactReviewRequired&&<><label htmlFor={id+'-contact'}>Contact preference review note</label><textarea id={id+'-contact'} rows={2} maxLength={1000} value={contactReview} onChange={event=>setContactReview(event.target.value)}/></>}
    {context.duplicateRequestIds.length>0&&<>
     <p>A linked visit already has a review request.</p>
     <label htmlFor={id+'-additional'}>Reason for an additional request</label>
     <textarea id={id+'-additional'} rows={2} maxLength={1000} value={additional} onChange={event=>setAdditional(event.target.value)}/>
    </>}
   </details>
  </fieldset>
  {error&&<p role="alert">{error}</p>}
  <button type="submit" disabled={disabled}>End job</button>
 </form>;
}

function PreparedReviewMessage({message,label,canCopy}:{message:NonNullable<CompletionSummary['review']['message']>;label:string;canCopy:boolean}){
 const [copyStatus,setCopyStatus]=useState('');
 async function copyMessage(){
  try{
   await navigator.clipboard.writeText(message.text);
   setCopyStatus('Review draft copied.');
  }catch{
   setCopyStatus('Copy is unavailable. Select the draft text to copy it manually.');
  }
 }
 return <>
  <p>{message.channel==='text'?'Text':'Email'} draft · {label}</p>
  <textarea aria-label="Prepared review draft" readOnly rows={4} value={message.text}/>
  {canCopy&&<button type="button" className="secondary" onClick={()=>void copyMessage()}>Copy review draft</button>}
  <p role="status" aria-live="polite">{copyStatus}</p>
 </>;
}

const reviewLabels={prepared:'Prepared',opened:'Opened',owner_confirmed_sent:'Owner-confirmed Sent',failed:'Failed',skipped:'Skipped'} as const;
function ReviewOutcomeForm({disabled,save}:{disabled:boolean;save:(body:ReviewOutcomeBody)=>Promise<void>}){
 const id=useId();
 const [action,setAction]=useState<ReviewOutcomeAction|''>(''),[reason,setReason]=useState('');
 const requiresReason=action==='failed'||action==='skipped';
 return <details>
  <summary>Record message outcome</summary>
  <form onSubmit={event=>{event.preventDefault();if(disabled||!action)return;void save({kind:action,reason:optional(reason)});}}>
   <fieldset disabled={disabled}>
    <legend>What happened with this message?</legend>
    <label htmlFor={id+'-action'}>Message outcome</label>
    <select id={id+'-action'} required value={action} onChange={event=>{
     const selected=event.target.value;
     setAction(isReviewOutcomeAction(selected)?selected:'');
    }}>
     <option value="">Choose an outcome</option>
     <option value="opened">Opened in my messaging app</option>
     <option value="owner_confirmed_sent">I sent this message</option>
     <option value="failed">Sending failed</option>
     <option value="skipped">Skipped</option>
    </select>
    <label htmlFor={id+'-reason'}>{requiresReason?'Reason':'Note (optional)'}</label>
    <textarea id={id+'-reason'} required={requiresReason} rows={2} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
    <p className="field-help">Record what already happened. Use your messaging app to send the draft.</p>
    <button type="submit" disabled={!action||requiresReason&&!reason.trim()}>Save message outcome</button>
   </fieldset>
  </form>
 </details>;
}

export function SavedCompletion({summary,outcome,outcomeEnabled,historyAvailable,canRecordOutcome,disabled,saveOutcome}:{
 summary:CompletionSummary;outcome:ReviewOutcomeContext|undefined;outcomeEnabled:boolean;canRecordOutcome:boolean;disabled:boolean;
 historyAvailable:boolean;
 saveOutcome:(body:ReviewOutcomeBody)=>Promise<void>
}){
 const reviewLabel=outcome?reviewLabels[outcome.kind]:outcomeEnabled?'Saved status unavailable':'Prepared';
 return <section aria-label="Saved completion">
  <h2>{summary.completionOutcome==='full'?'Full completion':'Partial completion'}</h2>
  <p>Saved version {summary.jobVersion} · <time dateTime={summary.completedAt}>{new Date(summary.completedAt).toLocaleString()}</time></p>
  <p>Walkthrough {summary.walkthrough.state==='done'?'done':'unavailable'}{summary.walkthrough.reason?': '+summary.walkthrough.reason:''}</p>
  {summary.reason&&<p className="completion-text">{summary.reason}</p>}
  <h3>Recorded scope</h3>
  <ul>{summary.outcomes.map(row=><li key={row.id} className="completion-text"><strong>{labels[row.outcome]}</strong> · {row.scopeDescription}{row.reason?' · '+row.reason:''}</li>)}</ul>
  <h3>Review request</h3>
  {summary.review.message?<PreparedReviewMessage key={'draft:'+summary.jobId+':'+(outcome?.eventId??summary.jobVersion)}
   message={summary.review.message} label={reviewLabel} canCopy={outcomeEnabled?!!outcome&&outcome.kind!=='owner_confirmed_sent':true}/>:
   <p>{summary.review.state==='pending'?'Pending':'Skipped'}{summary.review.reason?' · '+summary.review.reason:''}</p>}
  {outcome&&outcome.kind!=='prepared'&&<p>Recorded <time dateTime={outcome.effectiveAt}>{new Date(outcome.effectiveAt).toLocaleString()}</time>{outcome.reason?' · '+outcome.reason:''}</p>}
  {outcome&&canRecordOutcome&&<ReviewOutcomeForm key={outcome.eventId} disabled={disabled} save={saveOutcome}/>}
  {historyAvailable&&<ReviewMessageHistory key={'history:'+summary.jobId+':'+(outcome?.eventId??summary.jobVersion)}
   businessId={summary.businessId} scope={{kind:'job',id:summary.jobId}}/>}
  <h3>Follow-up tasks</h3>
  <ul>{summary.tasks.map(task=><li key={task.kind}>{task.kind==='invoice_finalization'?'Invoice review':'Commercial resolution'} · Open</li>)}</ul>
 </section>;
}
