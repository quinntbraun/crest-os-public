'use client';

import {useEffect,useEffectEvent,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {legacyBatches} from '../../../client/customers';
import {downloadLegacyContactImport} from '../../../client/legacy-contact-download';
import type {Proof} from '../../../client/authentication';
import {ApplicationResults} from './application-results';
import type {ApplicationPage,ApplicationReceipt} from './application-results';

type Evidence=Exclude<Awaited<ReturnType<typeof legacyBatches.reviewApproval>>,{state:'absent'}>;
type Request=Parameters<typeof legacyBatches.approve>[1];
const number=new Intl.NumberFormat('en-US');
const queueMessages={
 queued:'Import requested. You can leave this page and come back for the results.',
 committed:'Import completed. Check import status to load the results.',
 already_applied:'This import already completed. Check import status to load the results.',
 approval:'The saved decisions changed. Review them before starting another import.',
 applied:'A different approval was already applied. Check the saved import results.',
 operation:'This request could not be used. Review the saved decisions and start the import again.',
 authority:'Workspace access or recovery changed. Check the current decisions and workspace access before starting again.',
 review:'The import stopped after repeated attempts. Your decisions are saved. Review them before starting a new import.',
};


export function LegacyApprovalPanel({businessId,batch,recoveryEpoch,revision,authorize,applicationsAvailable,backgroundApplications,downloadsAvailable,onApplied}:{
 businessId:string;batch:{batchId:string;rowCount:number;rowsSha256:string};recoveryEpoch:string|null;revision:number;
 authorize:(signal:AbortSignal)=>Promise<Proof>;applicationsAvailable:boolean;backgroundApplications:boolean;downloadsAvailable:boolean;onApplied:()=>void;
}){
 const [review,setReview]=useState<{evidence:Evidence;revision:number}|null>(null);
 const [confirmation,setConfirmation]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [failed,setFailed]=useState(false);
 const [receipt,setReceipt]=useState<ApplicationReceipt|null>(null),[resultPage,setResultPage]=useState<ApplicationPage|null>(null);
 const [focusResults,setFocusResults]=useState(true);
 const [afterRow,setAfterRow]=useState(1),[applyConfirmation,setApplyConfirmation]=useState<string|null>(null);
 const [applyUnknown,setApplyUnknown]=useState(false),[queued,setQueued]=useState(false);
 const checkBackground=useEffectEvent(()=>{if(!receipt&&!active.current&&document.visibilityState==='visible')void refreshBackground();});
 useEffect(()=>{
  if(!backgroundApplications)return;
  const check=()=>checkBackground();
  const initial=window.setTimeout(check,0);
  document.addEventListener('visibilitychange',check);
  return ()=>{window.clearTimeout(initial);document.removeEventListener('visibilitychange',check);};
 },[backgroundApplications]);
 useEffect(()=>{
  if(!backgroundApplications||!queued||receipt)return;
  const poll=window.setInterval(()=>checkBackground(),20000);
  return ()=>window.clearInterval(poll);
 },[backgroundApplications,queued,receipt]);
 const applying=useRef<Request|null>(null);
 const headingId=useId(),active=useRef<AbortController|null>(null),pending=useRef<Request|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);

 const current=review?.revision===revision?review.evidence:null;
 const evidenceKey=current?current.evidenceSha256+':'+revision:null;
 const {batchId,rowCount,rowsSha256}=batch;
 async function latest(proof:Proof,signal:AbortSignal){
  const value=await legacyBatches.reviewApproval(businessId,batchId,proof,signal);
  await authorize(signal);
  signal.throwIfAborted();
  if(value.state==='absent'||value.rowsSha256!==rowsSha256||value.rowCount!==rowCount)throw Error('Draft evidence changed');
  return value;
 }
 async function run(action:(proof:Proof,signal:AbortSignal)=>Promise<void>,loading:string,failure:string){
  if(active.current)return;
  const controller=new AbortController();active.current=controller;
  setBusy(true);setFailed(false);setMessage(loading);
  try{await action(await authorize(controller.signal),controller.signal);}
  catch{if(!controller.signal.aborted){setFailed(true);setMessage(failure);}}
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 function load(){
  setConfirmation(null);setApplyConfirmation(null);setReview(null);
  void run(async(proof,signal)=>{
   if(applicationsAvailable){
    const result=await readApplication(proof,signal,1);
    if(result.state==='present'){storeResult(result,1);setMessage('Saved import verified.');return;}
   }
   const status=backgroundApplications?await readQueue(proof,signal):null;
   if(status?.state==='queued')return;
   const value=await latest(proof,signal);
   setReview({evidence:value,revision});
   setMessage(status?queueMessages[status.state]:value.approval?'Current approval verified.':'Saved decisions checked.');
  },'Checking saved decisions…','Saved decisions could not be checked. Try again.');
 }
 async function readQueue(proof:Proof,signal:AbortSignal){
  const result=await legacyBatches.applyStatus(batchId,proof,signal);
  await authorize(signal);
  signal.throwIfAborted();
  setQueued(result.state==='queued');
  if(result.state==='absent')return null;
  setApplyUnknown(false);
  if(result.state==='queued')setMessage(queueMessages.queued);
  return result;
 }
 async function refreshBackground(){
  const controller=new AbortController();
  active.current=controller;
  setBusy(true);
  try{
   const proof=await authorize(controller.signal);
   if(!queued){
    const saved=await readApplication(proof,controller.signal,1);
    if(saved.state==='present'){storeResult(saved,1,false);setMessage('Import completed.');return;}
   }
   const status=await readQueue(proof,controller.signal);
   if(queued&&status&&(status.state==='committed'||status.state==='already_applied'||status.state==='applied')){
    const saved=await readApplication(proof,controller.signal,1);
    if(saved.state==='present'){storeResult(saved,1,false);setMessage('Import completed.');return;}
   }
   if(status)setMessage(queueMessages[status.state]);
  }catch{
   if(!controller.signal.aborted)setMessage(previous=>previous||'Check import status to view the saved request.');
  }
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 async function readApplication(proof:Proof,signal:AbortSignal,after:number){
  const result=await legacyBatches.application(businessId,batchId,after,proof,signal);
  await authorize(signal);
  signal.throwIfAborted();
  if(result.state==='present'&&result.receipt.rowCount!==rowCount)throw Error('Import result changed');
  return result;
 }
 function storeResult(result:ApplicationPage,after:number,focus=true){
  setFocusResults(focus);
  setReceipt(result.receipt);setResultPage(result);setAfterRow(after);setApplyUnknown(false);setQueued(false);onApplied();
 }
 function download(){
  if(!receipt||!recoveryEpoch)return;
  void run(async(proof,signal)=>{
   await downloadLegacyContactImport({batchId,applicationOperationId:receipt.operationId,recoveryEpoch},proof,signal);
   setMessage('Download started.');
  },'Preparing import history…','Import history could not be downloaded. Check your sign-in and try again.');
 }
 function loadResult(after:number){
  void run(async(proof,signal)=>{
   const result=await readApplication(proof,signal,after);
   if(result.state==='absent'||receipt?.operationId!==result.receipt.operationId)throw Error('Import result changed');
   storeResult(result,after);setMessage('');
  },'Loading import results…','Row results could not be loaded. Try again.');
 }
 function apply(event:FormEvent){
  event.preventDefault();
  const approval=current?.approval;
  if(active.current||!applicationsAvailable||!approval||applyConfirmation!==evidenceKey||!recoveryEpoch||receipt||queued)return;
  const {evidenceSha256}=approval;
  const request=applying.current?.evidenceSha256===evidenceSha256&&applying.current.recoveryEpoch===recoveryEpoch
   ?applying.current:{batchId,evidenceSha256,recoveryEpoch,operationId:crypto.randomUUID()};
  applying.current=request;
  void run(async(proof,signal)=>{
   if(backgroundApplications){
    let status;
    try{status=await legacyBatches.requestApplication(request,proof,signal);}
    catch(error){if(!signal.aborted)setApplyUnknown(true);throw error;}
    signal.throwIfAborted();
    applying.current=null;setApplyUnknown(false);setApplyConfirmation(null);
    if(status.state==='conflict'){setReview(null);setMessage('Check the saved decisions before requesting this import again.');return;}
    if(status.state==='queued')setQueued(true);
    if(status.state==='committed'||status.state==='already_applied'){
     const page=await readApplication(proof,signal,1);
     if(page.state==='present'){storeResult(page,1);setMessage('Import completed.');return;}
    }
    setMessage(queueMessages[status.state]);return;
   }
   // Keep the exact request on an uncertain reply. A committed receipt is
   // already verified by the mutation, even if a later read is interrupted.
   let result;
   try{result=await legacyBatches.apply(businessId,request,proof,signal);}
   catch(error){if(!signal.aborted)setApplyUnknown(true);throw error;}
   signal.throwIfAborted();
   if(result.state==='conflict'){
    applying.current=null;setApplyUnknown(false);setApplyConfirmation(null);setReview(null);setMessage('The import could not use this approval. Check import status before continuing.');return;
   }
   if(result.receipt.approvalId!==approval.approvalId||result.receipt.rowCount!==rowCount||
    result.receipt.sourceNamespace!==approval.sourceNamespace||result.receipt.skippedRows!==approval.skippedRows){
    setApplyUnknown(true);throw Error('Unexpected import receipt');
   }
   applying.current=null;setApplyUnknown(false);setApplyConfirmation(null);
   setReceipt(result.receipt);onApplied();setMessage('Import recorded. Loading row results…');
   const page=await readApplication(proof,signal,1).catch(()=>null);
   if(signal.aborted)return;
   if(page?.state==='present'&&page.receipt.operationId===result.receipt.operationId){storeResult(page,1);setMessage('Import recorded.');}
   else setMessage('Import recorded. Load row results to review each record.');
  },backgroundApplications?'Requesting import…':'Applying approved decisions…','The import outcome could not be confirmed. Check import status or retry this import. A recent sign-in is required.');
 }
 function approve(event:FormEvent){
  event.preventDefault();
  if(active.current||current?.state!=='ready'||current.approval||confirmation!==evidenceKey||!recoveryEpoch)return;
  const {evidenceSha256}=current;
  const request=pending.current?.evidenceSha256===evidenceSha256&&pending.current.recoveryEpoch===recoveryEpoch
   ?pending.current:{batchId,evidenceSha256,recoveryEpoch,operationId:crypto.randomUUID()};
  pending.current=request;
  void run(async(proof,signal)=>{
   const result=await legacyBatches.approve(businessId,request,proof,signal);
   signal.throwIfAborted();
   pending.current=null;
   setConfirmation(null);
   if(result.state==='conflict'){
    setReview(null);setMessage('This approval could not be saved for the reviewed decisions. Check saved decisions again.');return;
   }
   setReview(null);
   setMessage('Approval recorded. Checking the current decisions…');
   const fresh=await latest(proof,signal).catch(()=>null);
   if(signal.aborted)return;
   if(fresh)setReview({evidence:fresh,revision});
   setMessage(!fresh?'Approval recorded. Check saved decisions to verify whether it is current.':
    fresh.approval?.approvalId===result.receipt.approvalId?'Approval recorded.':
    'The approval receipt was recorded for an earlier version. Review the current decisions.');
  },'Recording approval…','Approval could not be confirmed. Retry this approval or check the current decisions. Approval requires a recent sign-in.');
 }
 return <section className="legacy-effect-review legacy-approval" aria-labelledby={headingId} aria-busy={busy}>
  <div className="legacy-effect-heading">
   <h3 id={headingId}>Review and approve import</h3>
   {!receipt&&<button className="secondary" type="button" disabled={busy} onClick={load}>{applicationsAvailable?'Check import status':review?'Check decisions again':'Check saved decisions'}</button>}
  </div>
  {!receipt&&!queued&&<p className="field-help">Review the planned changes, then approve the saved decisions. Applying them is a separate action.</p>}
  <p role="status" aria-label="Import approval status">{message}</p>
  {!receipt&&review&&!current&&<p className="notice">A row decision may have changed. Check saved decisions again.</p>}
  {!receipt&&failed&&current&&<a href="/sign-in">Open sign-in</a>}
  {receipt&&<ApplicationResults receipt={receipt} page={resultPage} busy={busy} focusOnLoad={focusResults} retry={()=>loadResult(1)}
   download={downloadsAvailable&&recoveryEpoch?download:undefined}
   previous={afterRow>1?()=>loadResult(Math.max(1,afterRow-25)):undefined}
   next={resultPage?.hasMore?()=>loadResult(resultPage.rows.at(-1)!.row):undefined}/>}
  {!receipt&&!queued&&current&&<>
   {current.state==='blocked'&&<ul className="legacy-effect-findings">
    {current.undecidedRows>0&&<li>Rows awaiting a saved decision<strong>{number.format(current.undecidedRows)}</strong></li>}
    {current.staleRows>0&&<li>Rows with changed or archived matches<strong>{number.format(current.staleRows)}</strong></li>}
    {current.conflictingGroups>0&&<li>Source IDs with conflicting choices<strong>{number.format(current.conflictingGroups)}</strong></li>}
   </ul>}
   <table className="legacy-approval-counts">
    <caption className="visually-hidden">Planned import changes</caption>
    <thead><tr><th scope="col">Records</th><th scope="col">Create</th><th scope="col">Link</th></tr></thead>
    <tbody>
     <tr><th scope="row">Customers</th><td>{number.format(current.customerCreates)}</td><td>{number.format(current.customerLinks)}</td></tr>
     <tr><th scope="row">Vehicles</th><td>{number.format(current.vehicleCreates)}</td><td>{number.format(current.vehicleLinks)}</td></tr>
    </tbody>
   </table>
   <p className="field-help">Rows to skip <strong>{number.format(current.skippedRows)}</strong></p>
   {current.approval?<><p className="legacy-approval-receipt"><strong>Approved</strong> <span>Receipt {current.approval.approvalId}</span></p>
    {applicationsAvailable&&(recoveryEpoch?<form onSubmit={apply}>
     <p className="field-help">Apply the approved customer and vehicle decisions. Review any vehicle relationships in Vehicles after import.</p>
     <label className="trust"><input type="checkbox" checked={applyConfirmation===evidenceKey} disabled={busy}
      onChange={event=>setApplyConfirmation(event.target.checked?evidenceKey:null)}/>I’m ready to apply this approved import.</label>
     <button type="submit" disabled={busy||applyConfirmation!==evidenceKey}>{applyUnknown?'Retry import':backgroundApplications?'Start import':'Apply approved import'}</button>
    </form>:<p className="notice">Applying imports is paused during recovery.</p>)}
   </>:
    current.state==='ready'&&(recoveryEpoch?<form onSubmit={approve}>
     <label className="trust"><input type="checkbox" checked={confirmation===evidenceKey} disabled={busy}
      onChange={event=>setConfirmation(event.target.checked?evidenceKey:null)}/>I reviewed these saved decisions.</label>
     <button type="submit" disabled={busy||confirmation!==evidenceKey}>{failed?'Retry approval':'Approve saved decisions'}</button>
    </form>:<p className="notice">Approval is paused while the workspace is in recovery.</p>)}
  </>}
 </section>;
}
