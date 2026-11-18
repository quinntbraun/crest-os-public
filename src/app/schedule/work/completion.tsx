'use client';
import {useId,useLayoutEffect,useState} from 'react';
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
class CompletionInputError extends Error{
 readonly field:string;
 constructor(message:string,field='-outcome'){super(message);this.field=field;}
}
function savedAllocation(row:CompletionAssignment,draft:ScopeDraft):CompletionAllocation{
 if(!draft.selection)throw new CompletionInputError('Choose an outcome for every assigned item.');
 let pieces:CompletionPiece[];
 if(draft.selection==='split'){
  pieces=draft.pieces.map((piece,index)=>{
   const field='-portion-'+index;
   if(!piece.outcome)throw new CompletionInputError('Describe and choose an outcome for every portion.',field+'-outcome');
   if(!piece.description.trim())throw new CompletionInputError('Describe and choose an outcome for every portion.',field+'-description');
   if(piece.outcome!=='completed'&&!piece.reason.trim())throw new CompletionInputError('Explain each unfinished or cancelled portion.',field+'-reason');
   let gross:bigint,discount:bigint;
   try{gross=BigInt(quoteDollarsInput(piece.gross));}
   catch{throw new CompletionInputError('Enter a dollar amount for gross and discount on each portion.',field+'-gross');}
   try{discount=BigInt(quoteDollarsInput(piece.discount));}
   catch{throw new CompletionInputError('Enter a dollar amount for gross and discount on each portion.',field+'-discount');}
   if(discount>gross)throw new CompletionInputError('A portion’s discount cannot exceed its gross amount.',field+'-discount');
   return {partitionId:piece.id,outcome:piece.outcome,scopeDescription:piece.description.trim(),
    grossInclusiveCents:gross.toString(),discountInclusiveCents:discount.toString(),amountCents:(gross-discount).toString(),
    reason:piece.outcome==='completed'?null:piece.reason.trim()};
  });
  const total=(key:'grossInclusiveCents'|'discountInclusiveCents')=>pieces.reduce((sum,piece)=>sum+BigInt(piece[key]),0n);
  if(pieces.length<2||total('grossInclusiveCents')!==BigInt(row.grossInclusiveCents)
    ||total('discountInclusiveCents')!==BigInt(row.discountInclusiveCents)){
   throw new CompletionInputError('Portion amounts must add up to the saved gross amount and discount.',
    '-portion-0-'+(total('grossInclusiveCents')!==BigInt(row.grossInclusiveCents)?'gross':'discount'));
  }
 }else{
  if(draft.selection!=='completed'&&!draft.reason.trim())throw new CompletionInputError('Explain each unfinished or cancelled item.','-reason');
  pieces=[{partitionId:row.partitionId,outcome:draft.selection,scopeDescription:row.scopeDescription,
   grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,
   reason:draft.selection==='completed'?null:draft.reason.trim()}];
 }
 return {assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,pieces};
}

function OutcomeOptions({split=false}:{split?:boolean}){
 return <><option value="">Choose an outcome</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}{split&&<option value="split">Divide into portions</option>}</>;
}
function Portion({id,piece,index,change,remove}:{id:string;piece:PieceDraft;index:number;change:(next:PieceDraft)=>void;remove?:(()=>void)|undefined}){
 return <fieldset className="completion-portion">
  <legend>Portion {index+1}</legend>
  <label htmlFor={id+'-outcome'}>Portion outcome</label>
  <select id={id+'-outcome'} value={piece.outcome} required onChange={event=>change({...piece,outcome:event.target.value as OutcomeChoice})}><OutcomeOptions/></select>
  <label htmlFor={id+'-description'}>Work in this portion</label>
  <textarea id={id+'-description'} rows={2} maxLength={2000} required value={piece.description} onChange={event=>change({...piece,description:event.target.value})}/>
  <div className="completion-portion-amounts">
   <div><label htmlFor={id+'-gross'}>Gross amount in dollars</label>
    <input id={id+'-gross'} inputMode="decimal" value={piece.gross} maxLength={22} required onChange={event=>change({...piece,gross:event.target.value})}/></div>
   <div><label htmlFor={id+'-discount'}>Discount in dollars</label>
    <input id={id+'-discount'} inputMode="decimal" value={piece.discount} maxLength={22} required onChange={event=>change({...piece,discount:event.target.value})}/></div>
  </div>
  {piece.outcome&&piece.outcome!=='completed'&&<>
   <label htmlFor={id+'-reason'}>Reason for unfinished portion</label>
   <textarea id={id+'-reason'} rows={2} maxLength={1000} required value={piece.reason} onChange={event=>change({...piece,reason:event.target.value})}/>
  </>}
  {remove&&<button type="button" className="secondary" onClick={remove}>Remove portion {index+1}</button>}
 </fieldset>;
}
function AssignedScope({id,row,index,draft,ready,open,toggle,change}:{id:string;row:CompletionAssignment;index:number;draft:ScopeDraft;ready:boolean;open:boolean;toggle:(open:boolean)=>void;change:(next:ScopeDraft)=>void}){
 const complimentary=row.grossInclusiveCents==='0';
 const state=ready?(draft.selection==='split'?'Portions ready':labels[draft.selection as WorkOutcome]):draft.selection?'Needs details':'Needs outcome';
 return <fieldset className="completion-assignment">
  <legend>Assigned item {index+1}</legend>
  <div className="completion-assignment-heading">
   <p className="completion-text">{row.scopeDescription}</p>
   <span className="completion-item-state" data-ready={ready}>{state}</span>
  </div>
  <details className="completion-item-editor" open={open}>
  <summary onClick={event=>{event.preventDefault();toggle(!open);}}>Item {index+1} outcome details</summary>
  <label htmlFor={id+'-outcome'}>Outcome for item {index+1}</label>
  <select id={id+'-outcome'} value={draft.selection} required onChange={event=>{
   const selection=event.target.value as Selection;
   change({selection,reason:'',pieces:selection==='split'
    ?[pieceDraft(row.partitionId,'completed',complimentary),pieceDraft(crypto.randomUUID(),'unfulfilled',complimentary)]:[]});
  }}><OutcomeOptions split/></select>
  {draft.selection==='split'&&<>
   <p className="field-help">Saved gross {quoteMoney(row.grossInclusiveCents)} and discount {quoteMoney(row.discountInclusiveCents)}. Divide these amounts across the portions. This records fulfillment against the accepted scope.</p>
   {draft.pieces.map((piece,position)=><Portion key={piece.id} id={id+'-portion-'+position} piece={piece} index={position}
    change={next=>change({...draft,pieces:draft.pieces.map(item=>item.id===next.id?next:item)})}
    remove={position>0&&draft.pieces.length>2?()=>change({...draft,pieces:draft.pieces.filter(item=>item.id!==piece.id)}):undefined}/>)}
   <button type="button" className="secondary" onClick={()=>change({...draft,pieces:[...draft.pieces,pieceDraft(crypto.randomUUID(),'',complimentary)]})}>Add a portion</button>
  </>}
  {draft.selection&&draft.selection!=='completed'&&draft.selection!=='split'&&<>
   <label htmlFor={id+'-reason'}>Reason for unfinished item</label>
   <textarea id={id+'-reason'} rows={2} maxLength={1000} required value={draft.reason} onChange={event=>change({...draft,reason:event.target.value})}/>
  </>}
  </details>
 </fieldset>;
}

type VisitIdentity={
 customer:string;
 vehicles:readonly {id:string;label:string}[];
 assignments?:Readonly<Record<string,string|null>>|undefined;
};
function assignmentGroups(assignments:readonly CompletionAssignment[],visit:VisitIdentity|undefined){
 const groups=new Map<string,{label:string;items:number[]}>();
 assignments.forEach((assignment,index)=>{
  const vehicleId=visit?.assignments?.[assignment.assignedPartId];
  const vehicle=visit?.vehicles.find(row=>row.id===vehicleId);
  const key=vehicle?.id??(vehicleId===null?'visit':'other');
  const group=groups.get(key)??{label:vehicle?.label??(key==='visit'?'Entire visit':'Assigned work'),items:[]};
  group.items.push(index);
  groups.set(key,group);
 });
 return [...groups];
}
function reviewAllocation(row:CompletionAssignment,draft:ScopeDraft){
 try{return {allocation:savedAllocation(row,draft),error:null,field:null};}
 catch(problem){return {allocation:null,error:problem instanceof Error?problem.message:'Review the assigned item.',
  field:problem instanceof CompletionInputError?problem.field:'-outcome'};}
}

export function CompletionEditor({context,visit,disabled,save}:{context:CompletionContext;visit:VisitIdentity|undefined;disabled:boolean;save:(body:CompletionBody)=>Promise<void>}){
 const id=useId();
 const [scope,setScope]=useState<Record<string,ScopeDraft>>({});
 const [walkthrough,setWalkthrough]=useState<''|'done'|'unavailable'>('');
 const [reason,setReason]=useState(''),[walkthroughReason,setWalkthroughReason]=useState('');
 const [reviewUrl,setReviewUrl]=useState(''),[skipReason,setSkipReason]=useState('');
 const [additional,setAdditional]=useState(''),[contactReview,setContactReview]=useState('');
 const [error,setError]=useState('');
 const [activeItem,setActiveItem]=useState<number|null>(0);
 const [focusRequest,setFocusRequest]=useState<{field:string}|null>(null);
 useLayoutEffect(()=>{
  if(!focusRequest)return;
  const target=document.getElementById(focusRequest.field);
  if(target){target.focus();target.scrollIntoView({block:'center',behavior:'instant'});}
 },[focusRequest]);
 const unanswered=context.assignments.filter(row=>!scope[row.assignedPartId]?.selection);
 const hasSelectedOutcome=unanswered.length<context.assignments.length;
 const reviewed=context.assignments.map(row=>reviewAllocation(row,scope[row.assignedPartId]??blank));
 const groups=assignmentGroups(context.assignments,visit);
 const displayOrder=groups.flatMap(([,group])=>group.items);
 const firstUnresolved=displayOrder.find(index=>!reviewed[index]!.allocation)??-1;
 const unresolved=reviewed.filter(row=>!row.allocation).length;
 const hasFulfilled=reviewed.some(row=>row.allocation?.pieces.some(piece=>piece.outcome==='completed'));
 const walkthroughReady=walkthrough==='done'||walkthrough==='unavailable'&&walkthroughReason.trim().length>0;
 const itemField=(index:number)=>id+'-assignment-'+index;
 const focusField=(field:string)=>{
  const index=context.assignments.findIndex((_,position)=>field.startsWith(itemField(position)+'-'));
  if(index>=0)setActiveItem(index);
  setFocusRequest({field});
 };
 const nextField=firstUnresolved>=0?itemField(firstUnresolved)+(reviewed[firstUnresolved]!.field??'-outcome'):!hasFulfilled?itemField(displayOrder[0]!)+'-outcome':
  !walkthroughReady?id+(walkthrough==='unavailable'?'-walkthrough-reason':'-walkthrough'):null;
 const requiredMessage=()=>reviewed[firstUnresolved]?.error??(!hasFulfilled?'Record at least one fulfilled portion to end this job.':'Record the walkthrough outcome and any required reason.');
 const reviewedPieces=reviewed.flatMap(row=>row.allocation?.pieces??[]);

 function markRemainingFulfilled(){
  setError('');
  setScope(current=>{
   const next={...current};
   for(const {assignedPartId} of context.assignments){
    if(!current[assignedPartId]?.selection){
     next[assignedPartId]={selection:'completed',reason:'',pieces:[]};
    }
   }
   return next;
  });
 }

 return <form className="field-work-form completion-work-form" onChange={()=>setError('')} onInvalidCapture={event=>{
  if(disabled||!nextField)return;
  event.preventDefault();setError(requiredMessage());focusField(nextField);
 }} onSubmit={event=>{
  event.preventDefault();
  if(disabled)return;
  setError('');
  if(nextField){
   setError(requiredMessage());
   focusField(nextField);
   return;
  }
  if(walkthrough==='')return;
  const allocations=reviewed.flatMap(row=>row.allocation?[row.allocation]:[]);
  const body:CompletionBody={scope:allocations,reason:optional(reason),walkthrough:{state:walkthrough,reason:walkthrough==='done'?null:walkthroughReason.trim()},
    review:{reviewUrl:optional(reviewUrl),skipReason:optional(skipReason),additionalRequestReason:optional(additional),
     expectedDuplicateRequestIds:context.duplicateRequestIds,expectedCustomerVersion:context.customerVersion,contactReviewReason:optional(contactReview)}};
  void save(body);
 }}>
  <header className="completion-visit-heading">
   <p className="completion-visit-state">{context.jobState==='paused'?'Paused':'In progress'} <span>· Saved version {context.jobVersion}</span></p>
   {visit&&<><h2>{visit.customer}</h2><p>{visit.vehicles.map(row=>row.label).join(' · ')}</p></>}
   <p className="field-help">Record what was done. Unfinished work will be flagged for review.</p>
  </header>
  <div className="completion-checklist">
  <fieldset disabled={disabled}>
   <legend>Scope outcomes</legend>
   <p role="status" className="field-help">
    {unanswered.length===0?'Every item has an outcome selected.':
     `${unanswered.length} of ${context.assignments.length} ${context.assignments.length===1?'item':'items'} still ${unanswered.length===1?'needs':'need'} an outcome.`}
   </p>
   <button type="button" className="secondary" disabled={unanswered.length===0} onClick={markRemainingFulfilled}>
    {hasSelectedOutcome?'Mark remaining items fulfilled':'Mark all items fulfilled'}
   </button>
   {groups.map(([key,group])=><div key={key} className="completion-scope-group" role="group" aria-label={group.label}>
    <div className="completion-scope-heading">
     <strong>{group.label}</strong>
     <span>{group.items.filter(index=>reviewed[index]!.allocation!==null).length} of {group.items.length} ready · {group.items.filter(index=>!reviewed[index]!.allocation).length} to review</span>
    </div>
    {group.items.map(index=>{
     const row=context.assignments[index]!;
     return <AssignedScope key={row.assignedPartId} id={itemField(index)} row={row} index={index} draft={scope[row.assignedPartId]??blank} ready={reviewed[index]!.allocation!==null}
      open={activeItem===index} toggle={open=>setActiveItem(current=>open?index:current===index?null:current)}
      change={next=>setScope(current=>({...current,[row.assignedPartId]:next}))}/>;
    })}
   </div>)}
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
  </div>
  <aside className="completion-review" aria-label="Completion review">
   <h2>Completion review</h2>
   <p className="field-help">These outcomes are proposed until End job is saved. Counts include items with complete outcome details.</p>
   <dl className="completion-progress-facts">
    <div><dt>Ready items</dt><dd>{context.assignments.length-unresolved} of {context.assignments.length}</dd></div>
    <div><dt>Fulfilled portions</dt><dd>{reviewedPieces.filter(piece=>piece.outcome==='completed').length}</dd></div>
    <div><dt>Unfinished / cancelled</dt><dd>{reviewedPieces.filter(piece=>piece.outcome!=='completed').length}</dd></div>
    <div><dt>Walkthrough</dt><dd>{walkthroughReady?(walkthrough==='done'?'Done':'Unavailable with reason'):walkthrough==='unavailable'?'Reason needed':'Outcome needed'}</dd></div>
   </dl>
   <p aria-live="polite">{unresolved>0?`${unresolved} ${unresolved===1?'item needs':'items need'} review`:
    !hasFulfilled?'A fulfilled portion is required':!walkthroughReady?'Walkthrough outcome required':'Ready to end the job'}</p>
   {unresolved>0&&<div className="completion-unresolved" role="region" aria-label="Items needing review" tabIndex={0}>
    <ol>{displayOrder.filter(index=>!reviewed[index]!.allocation).map(index=><li key={context.assignments[index]!.assignedPartId}>
     <button type="button" className="secondary" disabled={disabled} onClick={()=>focusField(itemField(index)+(reviewed[index]!.field??'-outcome'))}>
      Item {index+1}: {scope[context.assignments[index]!.assignedPartId]?.selection?'Needs details':'Needs outcome'}
     </button>
     <p>{context.assignments[index]!.scopeDescription}</p>
    </li>)}</ol>
   </div>}
   {nextField&&<button type="button" className="secondary" disabled={disabled} onClick={()=>focusField(nextField)}>Review next required field</button>}
   {error&&<p role="alert">{error}</p>}
   <button type="submit" disabled={disabled}>End job</button>
  </aside>
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

export function SavedCompletion({summary,outcome,outcomeEnabled,historyAvailable,invoicePreparationAvailable,canRecordOutcome,disabled,saveOutcome}:{
 summary:CompletionSummary;outcome:ReviewOutcomeContext|undefined;outcomeEnabled:boolean;canRecordOutcome:boolean;disabled:boolean;
 historyAvailable:boolean;invoicePreparationAvailable:boolean;
 saveOutcome:(body:ReviewOutcomeBody)=>Promise<void>
}){
 const reviewLabel=outcome?reviewLabels[outcome.kind]:outcomeEnabled?'Saved status unavailable':'Prepared';
 return <section className="saved-completion" aria-label="Saved completion">
  <header className="saved-completion-heading">
   <p className="saved-completion-label">Recorded job outcome</p>
   <h2>{summary.completionOutcome==='full'?'Full completion':'Partial completion'}</h2>
   <p className="field-help">Saved version {summary.jobVersion} · <time dateTime={summary.completedAt} title={summary.completedAt}>{new Date(summary.completedAt).toLocaleString()}</time></p>
   <p>Walkthrough {summary.walkthrough.state==='done'?'done':'unavailable'}{summary.walkthrough.reason?': '+summary.walkthrough.reason:''}</p>
   {summary.reason&&<p className="completion-text">{summary.reason}</p>}
  </header>
  <section className="completion-next-steps" aria-label="Completion follow-up tasks">
   <div><h3>Follow-up tasks</h3>
    <ul>{summary.tasks.map(task=><li key={task.kind}>{task.kind==='invoice_finalization'?'Invoice review':'Commercial resolution'} · Open</li>)}</ul>
   </div>
   {invoicePreparationAvailable&&summary.tasks.some(task=>task.kind==='invoice_finalization')&&<button type="button" className="secondary" onClick={()=>document.getElementById('completed-work-invoice-review')?.focus()}>Review completed work</button>}
  </section>
  <div className="saved-completion-body">
  <section className="completion-recorded-scope" aria-label="Recorded completion scope">
   <h3>Recorded scope</h3>
   <ul role="list">{summary.outcomes.map(row=><li key={row.id} data-outcome={row.outcome}>
    <strong className="completion-saved-outcome">{labels[row.outcome]}</strong>
    <p className="completion-text">{row.scopeDescription}</p>
    {row.reason&&<p className="completion-text completion-outcome-reason">{row.reason}</p>}
   </li>)}</ul>
  </section>
  <section className="completion-review-request" aria-label="Completion review request">
  <h3>Review request</h3>
  {summary.review.message?<PreparedReviewMessage key={'draft:'+summary.jobId+':'+(outcome?.eventId??summary.jobVersion)}
   message={summary.review.message} label={reviewLabel} canCopy={outcomeEnabled?!!outcome&&outcome.kind!=='owner_confirmed_sent':true}/>:
   <p>{summary.review.state==='pending'?'Pending':'Skipped'}{summary.review.reason?' · '+summary.review.reason:''}</p>}
  {outcome&&outcome.kind!=='prepared'&&<p>Event time <time dateTime={outcome.effectiveAt} title={outcome.effectiveAt}>{new Date(outcome.effectiveAt).toLocaleString()}</time>{outcome.reason?' · '+outcome.reason:''}</p>}
  {outcome&&canRecordOutcome&&<ReviewOutcomeForm key={outcome.eventId} disabled={disabled} save={saveOutcome}/>}
  {historyAvailable&&<ReviewMessageHistory key={'history:'+summary.jobId+':'+(outcome?.eventId??summary.jobVersion)}
   businessId={summary.businessId} scope={{kind:'job',id:summary.jobId}}/>}
  </section>
  </div>
 </section>;
}
