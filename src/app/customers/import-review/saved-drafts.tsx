'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent,ReactNode,RefObject} from 'react';
import {legacyBatches} from '../../../client/customers';
import type {Proof} from '../../../client/authentication';
import type {LegacyContactColumnMap} from '../../../customer/legacy-contact-import-preview';
import {LegacyDecisionEditor} from './decision-editor';
import {LegacyApprovalPanel} from './approval-panel';

type Access=(signal:AbortSignal)=>Promise<Proof>;
type Batch=Awaited<ReturnType<typeof legacyBatches.read>>;
type List=Awaited<ReturnType<typeof legacyBatches.list>>;
type Effects=Awaited<ReturnType<typeof legacyBatches.effects>>;
type TargetKind='customer'|'vehicle';
type DecisionRow={row:number;customer:string|null;vehicle:string|null};
type Targets=Awaited<ReturnType<typeof legacyBatches.targets>>&{kind:TargetKind;row:number;cursors:(string|null)[]};
const formatCount=new Intl.NumberFormat('en-US');
const findingText:Record<Effects['findings'][number]['reasons'][number],string>={
 customer_source_conflict:'Customer ID has conflicting details in this draft',
 vehicle_source_conflict:'Vehicle ID has conflicting details or owners in this draft',
 shared_phone:'Phone is shared by customers in this draft',
 shared_email:'Email is shared by customers in this draft',
 shared_vin:'VIN is shared by vehicles in this draft',
 saved_phone:'Phone matches a saved customer',
 saved_email:'Email matches a saved customer',
 saved_vin:'VIN matches a saved vehicle',
};
const matchLabels={phone:'Same phone',email:'Same email',vin:'Same VIN'} as const;

function TargetComparison({targets,busy,head,show}:{
 targets:Targets;busy:boolean;head:RefObject<HTMLHeadingElement|null>;show:(cursors:(string|null)[])=>void;
}){
 const customer=targets.kind==='customer';
 return <section className="legacy-target-comparison" aria-label={customer?'Saved customer matches':'Saved vehicle matches'}>
  <h5 tabIndex={-1} ref={head}>{customer?'Saved customer matches':'Saved vehicle matches'}</h5>
  {targets.items.length>0?<ul className="legacy-target-list">
   {targets.items.map(target=><li key={target.id}>
    <div className="legacy-target-heading"><strong>{target.label}</strong>{target.archived&&<span>Archived</span>}</div>
    {!customer&&target.recordType!=='customer_vehicle'&&<p>{target.recordType==='business_rig'?'Business vehicle':'Other vehicle'}</p>}
    <p>{target.matched.map(reason=>matchLabels[reason]).join(' · ')}</p>
    {target.suffix&&<p>{customer?'Phone ending':'Plate ending'} {target.suffix}</p>}
    {target.descriptor&&<p>{customer?'Email domain '+target.descriptor:target.descriptor}</p>}
   </li>)}
  </ul>:<p>No matching records on this page. Check the draft again to refresh its findings.</p>}
  {(targets.cursors.length>1||targets.hasMore)&&<nav className="legacy-pagination" aria-label="Saved match pages">
   <button className="secondary" type="button" disabled={busy||targets.cursors.length===1}
    onClick={()=>show(targets.cursors.slice(0,-1))}>Previous matches</button>
   <button className="secondary" type="button" disabled={busy||!targets.hasMore}
    onClick={()=>show([...targets.cursors,targets.items.at(-1)!.id])}>Next matches</button>
  </nav>}
 </section>;
}

function DraftEffects({effects,issueText,busy,cursors,show,findingsHeading,targetsAvailable,targets,compare,hideTargets,targetHeading,decisionFor}:{
 effects:Effects;issueText:(issue:string)=>string;busy:boolean;cursors:number[];
 show:(cursors:number[])=>void;findingsHeading:RefObject<HTMLHeadingElement|null>;
 targetsAvailable:boolean;targets:Targets|null;compare:(row:number,kind:TargetKind,cursors?:(string|null)[])=>void;
 hideTargets:()=>void;targetHeading:RefObject<HTMLHeadingElement|null>;
 decisionFor:(row:DecisionRow)=>ReactNode;
}){
 const details=[
  ['Conflicting source records',effects.sourceConflictRows],
  ['Shared phone, email or VIN in this draft',effects.sharedHintRows],
  ['Possible saved customer matches',effects.savedContactRows],
  ['Possible saved vehicle matches',effects.savedVehicleRows],
 ] as const;
 return <>
  <dl className="legacy-effect-counts">
   <div><dt>Customers</dt><dd>{formatCount.format(effects.candidateCustomers)}</dd></div>
   <div><dt>Vehicles</dt><dd>{formatCount.format(effects.candidateVehicles)}</dd></div>
   <div><dt>Vehicle links</dt><dd>{formatCount.format(effects.candidateLinks)}</dd></div>
  </dl>
  <p><strong>{formatCount.format(effects.reviewRows)}</strong> rows need review · <strong>{formatCount.format(effects.rejectedRows)}</strong> rejected</p>
  {effects.reviewRows>0&&<ul className="legacy-effect-findings">
   {details.filter(([,count])=>count>0).map(([label,count])=><li key={label}>{label}<strong>{formatCount.format(count)}</strong></li>)}
  </ul>}
  <p className="field-help">Findings can overlap. Checking a draft makes no changes to customer, vehicle or financial records.</p>
  {(effects.findings.length>0||cursors.length>1)&&<section aria-label="Rows to review">
   <h4 ref={findingsHeading} tabIndex={-1}>Rows to review</h4>
   {effects.findings.length>0?<ul className="legacy-records">
    {effects.findings.map(row=>{
     const comparison=targets?.row===row.row?targets:null;
     const options:TargetKind[]=[];
     if(targetsAvailable){
      if(row.reasons.includes('saved_phone')||row.reasons.includes('saved_email'))options.push('customer');
      if(row.reasons.includes('saved_vin'))options.push('vehicle');
     }
     return <li key={row.row}>
     <span className="legacy-record-number">Record {formatCount.format(row.row)}</span>
     <div>
      <strong>{row.customer??'Rejected record'}</strong>
      {row.vehicle&&<p>{row.vehicle}</p>}
      <ul className="legacy-record-reasons">
       {row.issues.map(issue=><li key={issue}>{issueText(issue)}</li>)}
       {row.reasons.map(reason=><li key={reason}>{findingText[reason]}</li>)}
      </ul>
     </div>
     {options.length>0&&<div className="legacy-target-actions">
      {options.map(kind=>{
       const expanded=comparison?.kind===kind;
       const noun=kind==='customer'?'customers':'vehicles';
       return <button className="secondary" type="button" key={kind} disabled={busy} aria-expanded={expanded}
        onClick={()=>expanded?hideTargets():compare(row.row,kind)}>{expanded?'Hide':'Compare'} saved {noun}</button>;
      })}
     </div>}
     {comparison&&<TargetComparison targets={comparison} busy={busy} head={targetHeading}
      show={cursors=>compare(row.row,comparison.kind,cursors)}/>}
     {decisionFor(row)}
    </li>;
    })}
   </ul>:<p>There are no findings on this page.</p>}
   {(cursors.length>1||effects.hasMoreFindings)&&<nav className="legacy-pagination" aria-label="Finding pages">
    <button className="secondary" type="button" disabled={busy||cursors.length===1}
     onClick={()=>show(cursors.slice(0,-1))}>Previous findings</button>
    <button className="secondary" type="button" disabled={busy||!effects.hasMoreFindings}
     onClick={()=>show([...cursors,effects.findings.at(-1)!.row])}>Next findings</button>
   </nav>}
  </section>}
 </>;
}

export function SaveLegacyDraft({businessId,recoveryEpoch,sourceSha256,headers,mapping,file,authorize}:{
 businessId:string;recoveryEpoch:string|null;sourceSha256:string;headers:readonly string[];
 mapping:LegacyContactColumnMap;file:()=>File|undefined;authorize:Access;
}){
 const [source,setSource]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const sourceId=useId(),active=useRef<AbortController|null>(null);
 const pending=useRef<{sourceLabel:string;batchId:string;operationId:string}|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function save(event:FormEvent){
  event.preventDefault();
  const selected=file(),sourceLabel=source.trim();
  if(active.current||!selected||!sourceLabel||!recoveryEpoch)return;
  const request=new AbortController();active.current=request;setBusy(true);setMessage('Verifying and saving this draft…');
  const reference=pending.current?.sourceLabel===sourceLabel?pending.current:
   {sourceLabel,batchId:crypto.randomUUID(),operationId:crypto.randomUUID()};
  pending.current=reference;
  try{
   const proof=await authorize(request.signal);
   const columns=Object.fromEntries(Object.entries(mapping).map(([key,heading])=>[key,headers.indexOf(heading)]));
   const result=await legacyBatches.stage(businessId,{...reference,recoveryEpoch,sourceSha256,columns},selected,proof,request.signal);
   if(request.signal.aborted)return;
   if(result.state==='conflict'){setMessage('This source is already saved with different review details. Open the saved drafts to inspect it.');return;}
   await authorize(request.signal);
   if(request.signal.aborted)return;
   setSaved(true);setMessage(result.state==='already_staged'?'This draft is already saved.':'Import draft saved.');
  }catch{
   if(!request.signal.aborted)setMessage('The save could not be confirmed. Check your saved drafts or retry with this file.');
  }finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 return <form className="legacy-panel legacy-save-draft" aria-label="Save import draft" onSubmit={save}>
  <h2>Save this review for later</h2>
  <p>Saving sends the CSV to Crest OS for verification. The draft keeps mapped contacts, vehicles, and row issues.</p>
  {recoveryEpoch===null?<p>Saving is paused while the workspace is in recovery.</p>:<>
   <label htmlFor={sourceId}>Source name</label>
   <input id={sourceId} value={source} required maxLength={160} disabled={busy||saved}
    onChange={event=>setSource(event.target.value)}/>
   <button type="submit" disabled={busy||saved}>{busy?'Saving draft…':'Save import draft'}</button>
  </>}
  <p aria-live="polite">{message}</p>
 </form>;
}

export function SavedLegacyDrafts({businessId,authorize,issueText,effectsAvailable,targetsAvailable,decisionsAvailable,approvalsAvailable,applicationsAvailable,backgroundApplications,downloadsAvailable,recoveryEpoch}:{
 businessId:string;authorize:Access;issueText:(issue:string)=>string;effectsAvailable:boolean;targetsAvailable:boolean;
 decisionsAvailable:boolean;approvalsAvailable:boolean;applicationsAvailable:boolean;backgroundApplications:boolean;downloadsAvailable:boolean;recoveryEpoch:string|null;
}){
 const [list,setList]=useState<List|null>(null),[batch,setBatch]=useState<Batch|null>(null),[after,setAfter]=useState(1);
 const [effects,setEffects]=useState<Effects|null>(null),[decisionRevision,setDecisionRevision]=useState(0);
 const [appliedBatch,setAppliedBatch]=useState<string|null>(null);
 const [findingCursors,setFindingCursors]=useState<number[]>([1]);
 const [targets,setTargets]=useState<Targets|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 const summary=useRef<HTMLElement>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const findingsHeading=useRef<HTMLHeadingElement>(null);
 const targetHeading=useRef<HTMLHeadingElement>(null);
 const focusFindings=useRef(false);
 const draftButtons=useRef(new Map<string,HTMLButtonElement>());
 const returnTo=useRef<string|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>{
  if(batch)heading.current?.focus();
  else if(returnTo.current){
   (draftButtons.current.get(returnTo.current)??summary.current)?.focus();
   returnTo.current=null;
  }
 },[batch]);
 useEffect(()=>{
  if(focusFindings.current){findingsHeading.current?.focus();focusFindings.current=false;}
 },[effects]);
 useEffect(()=>{if(targets)targetHeading.current?.focus();},[targets]);
 async function run<T>(read:(proof:Proof,signal:AbortSignal)=>Promise<T>,show:(result:T)=>void,loading:string,failure:string,success=''){
  if(active.current)return;
  const request=new AbortController();active.current=request;setBusy(true);setMessage(loading);
  try{
   const proof=await authorize(request.signal);
   const data=await read(proof,request.signal);
   await authorize(request.signal);
   if(!request.signal.aborted){show(data);setMessage(success);}
  }catch{if(!request.signal.aborted)setMessage(failure);}
  finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 function load(before:string|null){
  void run((proof,signal)=>legacyBatches.list(businessId,before,proof,signal),setList,
   'Loading saved drafts…','Saved drafts could not be loaded. Try again.');
 }
 function open(id:string,row=1){
  void run((proof,signal)=>legacyBatches.read(businessId,id,row,proof,signal),value=>{setBatch(value);setAfter(row);},
   'Opening draft records…','Draft records could not be loaded. Try again.');
 }
 function review(current:Batch,cursors=[1],moveFocus=false){
  void run(async(proof,signal)=>{
   const result=await legacyBatches.effects(businessId,current.batch.batchId,cursors.at(-1)!,proof,signal);
   if(result.rowsSha256!==current.batch.rowsSha256||result.totalRows!==current.batch.rowCount||
    result.rejectedRows!==current.batch.rejectedCount)throw new Error('Draft review changed');
   return result;
  },result=>{
   focusFindings.current=moveFocus;
   setFindingCursors(cursors);
   setTargets(null);
   setEffects(result);
  },'Checking the saved draft…','The draft could not be checked. Try again.','Draft check complete.');
 }
 function compare(current:Batch,row:number,kind:TargetKind,cursors:(string|null)[]=[null]){
  void run(async(proof,signal)=>{
   const result=await legacyBatches.targets(businessId,{batchId:current.batch.batchId,row,kind,afterTarget:cursors.at(-1)!},proof,signal);
   if(result.rowsSha256!==current.batch.rowsSha256)throw new Error('Draft review changed');
   return {...result,row,kind,cursors};
  },setTargets,'Looking up saved matches…','Saved matches could not be loaded. Try again.');
 }
 function decisionFor(row:DecisionRow){
  return decisionsAvailable&&batch&&appliedBatch!==batch.batch.batchId?<div className="legacy-decision-cell">
   <LegacyDecisionEditor key={batch.batch.batchId+'-'+row.row} businessId={businessId} batchId={batch.batch.batchId}
    rowsSha256={batch.batch.rowsSha256} row={row} recoveryEpoch={recoveryEpoch} authorize={authorize} identitiesAvailable={applicationsAvailable}
    onSaveAttempt={()=>setDecisionRevision(value=>value+1)}/>
  </div>:null;
 }
 return <details className="legacy-panel legacy-saved-drafts" onToggle={event=>{
  if(event.currentTarget.open&&!list)load(null);
 }}>
  <summary ref={summary}>Saved import drafts</summary>
  <p className="legacy-draft-status" role="status" aria-label="Saved drafts status">{message}</p>
  <section aria-label="Saved import drafts" aria-busy={busy}>
   {!list&&!busy&&message&&<button className="secondary" type="button" onClick={()=>load(null)}>Retry loading drafts</button>}
   {list&&!batch&&(list.batches.length?<ul className="legacy-records legacy-draft-list">
    {list.batches.map(item=><li key={item.batchId}>
     <div><strong>{item.sourceLabel}</strong><p>{item.rowCount.toLocaleString('en-US')} CSV records · {item.rejectedCount.toLocaleString('en-US')} rejected</p></div>
     <button className="secondary" type="button" disabled={busy} onClick={()=>open(item.batchId)}
      aria-label={'Open draft: '+item.sourceLabel} ref={button=>{
       if(button)draftButtons.current.set(item.batchId,button);
       else draftButtons.current.delete(item.batchId);
      }}>Open draft</button>
    </li>)}
   </ul>:<p>No saved import drafts.</p>)}
   {list&&!batch&&<div className="legacy-pagination">
    <button className="secondary" type="button" disabled={busy} onClick={()=>load(null)}>Reload saved drafts</button>
    {list.hasMore&&<button className="secondary" type="button" disabled={busy}
     onClick={()=>load(list.batches.at(-1)!.batchId)}>Older drafts</button>}
   </div>}
   {batch&&<>
    <button className="secondary" type="button" onClick={()=>{
     returnTo.current=batch.batch.batchId;setBatch(null);setEffects(null);setTargets(null);setMessage('');
    }} disabled={busy}>Back to saved drafts</button>
    <h2 tabIndex={-1} ref={heading}>{batch.batch.sourceLabel}</h2>
    <p>{batch.batch.rowCount.toLocaleString('en-US')} CSV records · {batch.batch.rejectedCount.toLocaleString('en-US')} rejected</p>
    {approvalsAvailable&&<LegacyApprovalPanel key={batch.batch.batchId} businessId={businessId} batch={batch.batch}
     recoveryEpoch={recoveryEpoch} revision={decisionRevision} authorize={authorize} applicationsAvailable={applicationsAvailable} backgroundApplications={backgroundApplications} downloadsAvailable={downloadsAvailable}
     onApplied={()=>setAppliedBatch(batch.batch.batchId)}/>}
    {effectsAvailable&&<section className="legacy-effect-review" aria-label="Import effect review">
     <div className="legacy-effect-heading">
      <h3>Import effect review</h3>
      <button className="secondary" type="button" disabled={busy} onClick={()=>review(batch)}>
       {effects?'Check again':'Check this draft'}
      </button>
     </div>
     {effects?<DraftEffects effects={effects} issueText={issueText} busy={busy} cursors={findingCursors}
      show={cursors=>review(batch,cursors,true)} findingsHeading={findingsHeading} targetsAvailable={targetsAvailable}
      targets={targets} targetHeading={targetHeading} hideTargets={()=>setTargets(null)} compare={(row,kind,cursors)=>compare(batch,row,kind,cursors)}
      decisionFor={decisionFor}/>
      :<p className="field-help">Check the entire draft for conflicting records and possible matches in Crest OS.</p>}
    </section>}
    <ul className="legacy-records">{batch.rows.map(row=><li key={row.row}>
     <span className="legacy-record-number">Record {row.row}</span>
     <div><strong>{row.customer??'Check the mapped values'}</strong>{row.vehicle&&<p>{row.vehicle}</p>}
      {row.issues.map(issue=><p className="legacy-flag" key={issue}>{issueText(issue)}</p>)}</div>
     {!effects?.findings.some(finding=>finding.row===row.row)&&decisionFor(row)}
    </li>)}</ul>
    {(after>1||batch.hasMore)&&<nav className="legacy-pagination" aria-label="Saved draft pages">
     <button className="secondary" type="button" disabled={busy||after<=1}
      onClick={()=>open(batch.batch.batchId,Math.max(1,after-25))}>Previous</button>
     <button className="secondary" type="button" disabled={busy||!batch.hasMore}
      onClick={()=>open(batch.batch.batchId,after+batch.rows.length)}>Next</button>
    </nav>}
   </>}
  </section>
 </details>;
}
