'use client';

import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError,authentication} from '../../../client/authentication';
import {customers} from '../../../client/customers';
import {SaveLegacyDraft,SavedLegacyDrafts} from './saved-drafts';
import {ImportStages} from './stages';
import {businessSettings} from '../../../client/business-settings';
import {findSavedLegacyMatches,legacyRowsHaveSavedMatchHints} from '../../../client/legacy-contact-matches';
import {LegacyContactImportError,maximumLegacyCsvBytes} from '../../../customer/legacy-contact-import-preview';
import {askCsvWorker} from './csv-worker-client';
import type {LegacyCsvReview,LegacyCsvSource} from './csv-review-protocol';
import type {LegacyContactColumnMap} from '../../../customer/legacy-contact-import-preview';

type Access=Awaited<ReturnType<typeof businessSettings.settings>>;
type SavedMatches=Awaited<ReturnType<typeof findSavedLegacyMatches>>;
type Field=keyof LegacyContactColumnMap;
const labels:Record<Field,string>={
 customerSourceId:'Customer ID',displayName:'Customer name',phone:'Phone',email:'Email',
 customerSince:'Customer since',outreachOptOut:'Outreach opt-out',customerNotes:'Customer notes',
 vehicleSourceId:'Vehicle ID',vehicleLabel:'Vehicle label',vehicleYear:'Vehicle year',vehicleMake:'Make',
 vehicleModel:'Model',vehicleColor:'Color',vehicleVin:'VIN',vehiclePlate:'License plate',
};
const optionalContacts=['phone','email','customerSince','outreachOptOut','customerNotes'] as const;
const vehicles=['vehicleSourceId','vehicleLabel','vehicleYear','vehicleMake','vehicleModel','vehicleColor','vehicleVin','vehiclePlate'] as const;
const issueMessage:Record<string,string>={
 LEGACY_CSV_SIZE_REQUIRED:'Choose a CSV file between 1 byte and 25 MiB.',
 LEGACY_CSV_UTF8_REQUIRED:'Save the CSV with UTF-8 encoding, then choose it again.',
 LEGACY_CSV_ROW_LIMIT:'The CSV can contain up to 100,000 records.',
 LEGACY_CSV_ROW_WIDTH_REQUIRED:'Every record must have the same number of columns as the header.',
 LEGACY_CSV_LINE_ENDING_REQUIRED:'Save the CSV with standard Windows or Unix line breaks.',
 LEGACY_CSV_QUOTE_REQUIRED:'Check the quoting around cells that contain commas, quotation marks, or line breaks.',
 LEGACY_CSV_READ_FAILED:'The file review could not finish. Choose the CSV again to retry.',
 LEGACY_CSV_HEADER_REQUIRED:'The first row needs a distinct, nonempty header for each column.',
 LEGACY_IMPORT_MAPPING_REQUIRED:'Choose a different CSV column for each mapped field.',
 LEGACY_IMPORT_CONTACT_MAPPING_REQUIRED:'Map both Customer ID and Customer name.',
 LEGACY_IMPORT_VEHICLE_MAPPING_REQUIRED:'Map Vehicle ID and Vehicle label when reviewing vehicle details.',
 LEGACY_IMPORT_ROW_REVIEW_REQUIRED:'Check the contact or vehicle values against the mapped fields.',
 LEGACY_SOURCE_ID_REQUIRED:'A customer or vehicle ID is missing or invalid.',
 LEGACY_OUTREACH_VALUE_REQUIRED:'Use true, false, or an empty value for outreach opt-out.',
 LEGACY_VEHICLE_YEAR_REQUIRED:'Use a four-digit vehicle year.',
 LEGACY_CONTACT_SOURCE_CONFLICT:'This customer ID has conflicting details.',
 LEGACY_VEHICLE_SOURCE_CONFLICT:'This vehicle ID has conflicting details.',
};
const pageSize=25;
const countFormat=new Intl.NumberFormat('en-US');
async function verifyAccess(signal:AbortSignal){
 const proof=await authentication.session(signal);
 return businessSettings.settings(proof,signal);
}
function sameAccess(first:Access,second:Access){
 return first.binding===second.binding&&first.context.businessId===second.context.businessId&&
  first.context.businessVersion===second.context.businessVersion&&first.context.recoveryEpoch===second.context.recoveryEpoch;
}
function reviewRows(review:LegacyCsvReview,saved:SavedMatches|null){
 const rows=new Map<number,{number:number;customer:string|null;vehicle:string|null;phone:string|null;email:string|null;vin:string|null;issues:string[];matches:string[]}>();
 for(const record of review.rows){
  const matches=[...record.warnings];
  for(const {kind,count} of saved?.get(record.row)??[]){
   const field=kind==='vin'?'VIN':kind;
   const recordType=kind==='vin'?'vehicle':'customer';
   matches.push(count+' saved '+recordType+(count===1?'':'s')+' with this '+field);
  }
  rows.set(record.row,{number:record.row,customer:record.customer,vehicle:record.vehicle,phone:record.phone,email:record.email,vin:record.vin,issues:[],matches});
 }
 for(const issue of review.issues){
  const row=rows.get(issue.row)??{number:issue.row,customer:null,vehicle:null,phone:null,email:null,vin:null,issues:[],matches:[]};
  row.issues.push(issueMessage[issue.reason]??'Review this record.');
  rows.set(issue.row,row);
 }
 return [...rows.values()].sort((a,b)=>a.number-b.number);
}
function ReviewResults({review,saved,busy,checkSaved}:{review:LegacyCsvReview;saved:SavedMatches|null;busy:boolean;checkSaved:()=>void}){
 const [filter,setFilter]=useState('all'),[page,setPage]=useState(0),filterId=useId();
 const [requestedRecord,setRequestedRecord]=useState(''),[jumpTarget,setJumpTarget]=useState<{record:number}|null>(null);
 const [jumpMessage,setJumpMessage]=useState('');
 const preview=useRef<HTMLTableElement>(null),jumpId=useId();
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 const {rows,flagged}=useMemo(()=>{
  const rows=reviewRows(review,saved);
  return {rows,flagged:rows.filter(row=>row.issues.length>0||row.matches.length>0)};
 },[review,saved]);
 const hasSavedHints=useMemo(()=>legacyRowsHaveSavedMatchHints(review.rows),[review]);
 const shown=filter==='flagged'?flagged:rows;
 const currentPage=Math.min(page,Math.max(0,Math.ceil(shown.length/pageSize)-1));
 const start=currentPage*pageSize,visible=shown.slice(start,start+pageSize);
 useLayoutEffect(()=>{
  if(jumpTarget===null||document.visibilityState==='hidden')return;
  const row=preview.current?.querySelector<HTMLElement>('[data-record="'+jumpTarget.record+'"] th');
  if(row){row.focus({preventScroll:true});row.scrollIntoView({block:'center',behavior:'instant'});}
 },[jumpTarget,currentPage]);
 function jump(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const record=Number(requestedRecord),index=rows.findIndex(row=>row.number===record);
  if(!Number.isInteger(record)||index<0){setJumpMessage('This source record has no preview values. Check the record number in your CSV.');return;}
  setFilter('all');setPage(Math.floor(index/pageSize));setJumpTarget({record});
  setJumpMessage('Showing source record '+record+'.');
 }
 return <section className="legacy-panel" aria-label="CSV review results">
  <div className="legacy-review-summary">
   <h2 ref={heading} tabIndex={-1}>Review results</h2>
   <p>{countFormat.format(review.sourceRowCount)} CSV records · {countFormat.format(flagged.length)} to review</p>
  </div>
  {hasSavedHints&&<div className="legacy-saved-check">
   <div><h3>Saved-record matches</h3>
    <p>Check for matching phone numbers, emails or VINs in Crest OS. Only those mapped values are sent.</p>
    {saved&&<p aria-live="polite">{saved.size?saved.size+" CSV records have a possible saved match.":"No matching saved records found."}</p>}</div>
   <button type="button" className="secondary" disabled={busy} onClick={checkSaved}>
    {busy?"Checking saved records…":saved?"Check saved records again":"Check saved records"}
   </button>
  </div>}
  {review.unmappedHeaders.length>0&&<details className="legacy-fields">
   <summary>Unmapped columns ({review.unmappedHeaders.length})</summary>
   <ul>{review.unmappedHeaders.map(header=><li key={header}>{header}</li>)}</ul>
  </details>}
  <div className="legacy-filter">
   <label htmlFor={filterId}>Show records</label>
   <select id={filterId} value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);setJumpTarget(null);setJumpMessage('');}}>
    <option value="all">All records</option><option value="flagged">Needs review</option>
   </select>
  </div>
  {rows.length>0&&<form className="legacy-record-jump" aria-label="Find a source record" onSubmit={jump}>
   <label htmlFor={jumpId}>Source record number<input id={jumpId} type="number" inputMode="numeric" min="2" max={review.sourceRowCount+1} step="1" required value={requestedRecord} onChange={event=>setRequestedRecord(event.target.value)}/></label>
   <button className="secondary" type="submit">Go to record</button>
   <p className="field-help">The header is record 1. Contact records start at record 2.</p>
   <p role="status" aria-label="Source record navigation">{jumpMessage}</p>
  </form>}
  {visible.length>0?<table ref={preview} className="legacy-preview-table">
   <caption>Mapped CSV records · {start+1}–{start+visible.length} of {shown.length}</caption>
   <thead><tr><th scope="col">Source record</th><th scope="col">Contact and vehicle</th><th scope="col">Review</th></tr></thead>
   <tbody>{visible.map(row=><tr key={row.number} data-record={row.number} data-severity={row.issues.length?'rejected':row.matches.length?'match':'clear'}>
    <th scope="row" tabIndex={-1}>Record {row.number}</th>
    <td><strong>{row.customer??'Check the mapped values'}</strong>{row.vehicle&&<p>{row.vehicle}</p>}
     <details className="legacy-record-detail"><summary>Inspect record {row.number}</summary>
      {row.customer?<dl><dt>Customer</dt><dd>{row.customer}</dd><dt>Vehicle</dt><dd>{row.vehicle??'Not available'}</dd>
       <dt>Phone</dt><dd>{row.phone??'Not available'}</dd><dt>Email</dt><dd>{row.email??'Not available'}</dd><dt>VIN</dt><dd>{row.vin??'Not available'}</dd></dl>:
       <p>No validated contact values are available. Check this source record in your CSV using the review flags.</p>}
     </details>
    </td>
    <td><span className="legacy-row-state">{row.issues.length?'Check values':row.matches.length?'Possible match':'No flags in this preview'}</span>
     {[...row.issues,...row.matches].map((reason,index)=><p className="legacy-flag" key={index+'-'+reason}>{reason}</p>)}</td>
   </tr>)}</tbody>
  </table>:<p>{filter==='flagged'?'No records have review flags.':'The CSV contains no contact records.'}</p>}
  {shown.length>pageSize&&<nav className="legacy-pagination" aria-label="CSV review pages">
   <button type="button" className="secondary" disabled={!currentPage} onClick={()=>{setPage(currentPage-1);setJumpTarget(null);setJumpMessage('');}}>Previous</button>
   <span aria-live="polite">{start+1}–{start+visible.length} of {shown.length}</span>
   <button type="button" className="secondary" disabled={start+visible.length>=shown.length} onClick={()=>{setPage(currentPage+1);setJumpTarget(null);setJumpMessage('');}}>Next</button>
  </nav>}
 </section>;
}
export function LegacyContactReview(){
 const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(true),[signedOut,setSignedOut]=useState(false);
 const [draftsAvailable,setDraftsAvailable]=useState(false);
 const [effectsAvailable,setEffectsAvailable]=useState(false);
 const [targetsAvailable,setTargetsAvailable]=useState(false);
 const [decisionsAvailable,setDecisionsAvailable]=useState(false);
 const [approvalsAvailable,setApprovalsAvailable]=useState(false),[applicationsAvailable,setApplicationsAvailable]=useState(false);
 const [backgroundApplications,setBackgroundApplications]=useState(false);
 const [downloadsAvailable,setDownloadsAvailable]=useState(false);
 const [source,setSource]=useState<LegacyCsvSource|null>(null),[mapping,setMapping]=useState<LegacyContactColumnMap>({});
 const [review,setReview]=useState<LegacyCsvReview|null>(null),[saved,setSaved]=useState<SavedMatches|null>(null);
 const [message,setMessage]=useState('Checking workspace access…');
 const csvWorker=useRef<Worker|null>(null);
 const fileInput=useRef<HTMLInputElement>(null),active=useRef<AbortController|null>(null),fileId=useId(),mappingId=useId();
 const mappingLegend=useRef<HTMLLegendElement>(null);
 useLayoutEffect(()=>{
  if(source&&document.visibilityState!=='hidden'){
   mappingLegend.current?.focus({preventScroll:true});mappingLegend.current?.scrollIntoView({block:'start',behavior:'instant'});
  }
 },[source]);
 const clear=useCallback(()=>{
  active.current?.abort();active.current=null;
  csvWorker.current?.terminate();csvWorker.current=null;
  if(fileInput.current)fileInput.current.value='';
  setSource(null);setMapping({});setReview(null);setSaved(null);
 },[]);
 const checkAccess=useCallback(async()=>{
  const request=new AbortController();active.current=request;
  try{
   const proof=await authentication.session(request.signal);
   const [next,crm]=await Promise.all([businessSettings.settings(proof,request.signal),customers.context(proof,request.signal).catch(()=>null)]);
   if(request.signal.aborted)return;
   setDraftsAvailable(crm?.legacyContactBatchesAvailable===true&&crm.context.businessId===next.context.businessId);
   setEffectsAvailable(crm?.legacyContactEffectsAvailable===true&&crm.context.businessId===next.context.businessId);
   setTargetsAvailable(crm?.legacyContactTargetsAvailable===true&&crm.context.businessId===next.context.businessId);
   setDecisionsAvailable(crm?.legacyContactDecisionsAvailable===true&&crm.context.businessId===next.context.businessId);
   setApprovalsAvailable(crm?.legacyContactApprovalsAvailable===true&&crm.context.businessId===next.context.businessId);
   setApplicationsAvailable(crm?.legacyContactApplicationsAvailable===true&&crm.context.businessId===next.context.businessId);
   setBackgroundApplications(crm?.legacyContactBackgroundApplications===true&&crm.context.businessId===next.context.businessId);
   setDownloadsAvailable(crm?.legacyContactDownloadsAvailable===true&&crm.context.businessId===next.context.businessId);
   setAccess(next);setMessage('Choose a CSV to inspect.');
  }catch(error){
   if(request.signal.aborted)return;
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   setSignedOut(denied);setMessage(denied?'Sign in to review a contact file.':'Workspace access could not be verified.');
  }finally{if(active.current===request){active.current=null;setBusy(false);}}
 },[]);
 function recheckAccess(){
  clear();setAccess(null);setSignedOut(false);setBusy(true);setMessage('Checking workspace access…');
  void checkAccess();
 }
 useEffect(()=>{
  let activeEffect=true;
  queueMicrotask(()=>{
   if(!activeEffect)return;
   if(document.visibilityState==='hidden')hide();else void checkAccess();
  });
  function hide(){
   clear();setAccess(null);setBusy(false);setMessage('The file review was cleared while away.');
  }
  function onVisibility(){if(document.visibilityState==='hidden')hide();}
  document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',hide);
  return ()=>{
   activeEffect=false;active.current?.abort();
   csvWorker.current?.terminate();csvWorker.current=null;
   document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',hide);
  };
 },[checkAccess,clear]);
 async function selectFile(file:File|undefined){
  if(!file||!access||active.current)return;
  csvWorker.current?.terminate();csvWorker.current=null;
  setSource(null);setMapping({});setReview(null);setSaved(null);
  const request=new AbortController();active.current=request;setBusy(true);setMessage('Reading CSV columns…');
  try{
   if(file.size<1||file.size>maximumLegacyCsvBytes)throw new LegacyContactImportError('LEGACY_CSV_SIZE_REQUIRED');
   const worker=new Worker(new URL('./csv-review.worker.ts',import.meta.url));
   csvWorker.current=worker;
   const result=await askCsvWorker(worker,{kind:'open',file},request.signal);
   if(result.kind!=='open')throw new LegacyContactImportError('LEGACY_CSV_READ_FAILED');
   if(request.signal.aborted)return;
   setSource(result.source);setMessage('Select the matching columns.');
  }catch(error){
   if(!request.signal.aborted){
    csvWorker.current?.terminate();csvWorker.current=null;
    if(fileInput.current)fileInput.current.value='';
    setMessage(error instanceof LegacyContactImportError?issueMessage[error.message]??'The CSV could not be read.':'The CSV could not be read.');
   }
  }finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const worker=csvWorker.current;
  if(!source||!access||!worker||active.current)return;
  const request=new AbortController();active.current=request;setBusy(true);setReview(null);setSaved(null);setMessage('Reviewing mapped records…');
  try{
   const fresh=await verifyAccess(request.signal);
   if(request.signal.aborted)return;
   if(!sameAccess(access,fresh)){
    clear();setAccess(null);setBusy(false);setMessage('Workspace access changed. Check access again before reviewing the file.');return;
   }
   const result=await askCsvWorker(worker,{kind:'review',mapping,businessId:fresh.context.businessId},request.signal);
   if(result.kind!=='review')throw new LegacyContactImportError('LEGACY_CSV_READ_FAILED');
   if(request.signal.aborted)return;
   setReview(result.review);setMessage('CSV review is ready.');
  }catch(error){
   if(request.signal.aborted)return;
   if(error instanceof LegacyContactImportError){
    if(error.message==='LEGACY_CSV_READ_FAILED'){clear();setBusy(false);}
    setMessage(issueMessage[error.message]??'Review the selected mappings.');return;
   }
   clear();setAccess(null);setBusy(false);setMessage('Workspace access could not be verified. Check access again.');
  }finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 async function checkSaved(){
  if(!access||!review||active.current)return;
  const request=new AbortController();active.current=request;setBusy(true);setSaved(null);setMessage('Checking saved customer and vehicle records…');
  let checkingAccess=true;
  try{
   const proof=await authentication.session(request.signal);
   const fresh=await businessSettings.settings(proof,request.signal);
   if(request.signal.aborted)return;
   if(!sameAccess(access,fresh))throw new Error();
   checkingAccess=false;
   const matches=await findSavedLegacyMatches(review.rows,access.context.businessId,proof,request.signal);
   checkingAccess=true;
   const confirmed=await verifyAccess(request.signal);
   if(request.signal.aborted)return;
   if(!sameAccess(access,confirmed))throw new Error();
   setSaved(matches);setMessage('Saved-record check complete.');
  }catch{
   if(request.signal.aborted)return;
   if(checkingAccess){
    clear();setAccess(null);setBusy(false);setMessage('Workspace access changed. Check access again before reviewing the file.');
   }else{setMessage('Saved records could not be checked. The file review is still available.');}
  }finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 async function authorizeDraft(signal:AbortSignal){
  const proof=await authentication.session(signal);
  const current=await businessSettings.settings(proof,signal);
  if(!access||!sameAccess(access,current)){clear();setAccess(null);throw new Error('Workspace access changed');}
  return proof;
 }
 function column(field:Field,required=false){
  const id=mappingId+'-'+field;
  return <div className="legacy-column" key={field}>
   <label htmlFor={id}>{labels[field]}</label>
   <select id={id} required={required} value={mapping[field]??''} onChange={event=>{
    const header=event.target.value,next={...mapping};
    if(header)next[field]=header;else delete next[field];
    setMapping(next);setReview(null);setSaved(null);setMessage('Review the updated mapping when ready.');
   }}>
    <option value="">{required?'Choose a column':'Leave unmapped'}</option>
    {source?.headers.map(header=><option key={header} value={header}
     disabled={legacyMappedElsewhere(mapping,field,header)}>{header}</option>)}
   </select>
  </div>;
 }
 return <div aria-busy={busy}>
  <p className="notice" role="status" aria-label="CSV review status">{message}</p>
  {!access&&!busy&&(signedOut?<a href="/sign-in?returnTo=contact-import">Sign in to Crest OS</a>:
   <button className="secondary" type="button" onClick={recheckAccess}>Check workspace access</button>)}
  {access&&<>
   {draftsAvailable&&<SavedLegacyDrafts businessId={access.context.businessId} authorize={authorizeDraft} effectsAvailable={effectsAvailable} targetsAvailable={targetsAvailable}
    decisionsAvailable={decisionsAvailable} approvalsAvailable={approvalsAvailable} applicationsAvailable={applicationsAvailable} backgroundApplications={backgroundApplications} downloadsAvailable={downloadsAvailable} recoveryEpoch={access.context.recoveryEpoch}
    issueText={issue=>issueMessage[issue]??'Check the mapped data.'}/>}
   <div className="legacy-source-workspace">
   <ImportStages stage={review?'review':'source'}/>
   <div className="legacy-source-step" data-loaded={source!==null}>
   <section className="legacy-panel" aria-label="Choose a CSV">
    <h2>Choose your contact list</h2>
    <p>Match the columns, then review the records. Saving a draft and approving an import are separate steps.</p>
    <div className="legacy-file-chooser"><label htmlFor={fileId}>Contact CSV</label>
    <input id={fileId} ref={fileInput} type="file" accept=".csv,text/csv" disabled={busy} aria-describedby={fileId+'-help'}
     onChange={event=>void selectFile(event.currentTarget.files?.[0])}/>
    <p id={fileId+'-help'} className="field-help">UTF-8 CSV, up to 25 MiB and 100,000 records. Use fictional records in this workspace.</p></div>
    {source&&<div className="legacy-file"><p>{countFormat.format(source.sourceRowCount)} CSV records</p>
     <button className="secondary" type="button" disabled={busy} onClick={()=>{clear();setMessage('Choose a CSV to inspect.');}}>Clear file</button></div>}
   </section>
   {!source&&<aside className="legacy-source-guide" aria-label="CSV format guide">
    <h3>A simple starting format</h3><p>Your headers can have different names. In the next step, choose which columns contain the customer ID and name.</p>
    <table><caption>Example columns · fictional records</caption><thead><tr><th scope="col">Customer ID</th><th scope="col">Customer name</th></tr></thead>
     <tbody><tr><td>contact-001</td><td>Example customer</td></tr></tbody></table>
    <p className="field-help">Vehicle details need both a vehicle ID and label. Balances, payments and invoices are outside this contact import.</p>
    <h3>Next: match your columns</h3><p>You will see the required fields first, with optional contact and vehicle details available when needed.</p>
   </aside>}
   </div>
   {source&&<div className="legacy-mapping-workspace">
   <div className="legacy-mapping-main">
   <form className="legacy-panel" onSubmit={submit} aria-label="Map CSV columns">
    <fieldset disabled={busy}>
     <legend ref={mappingLegend} tabIndex={-1}>Map CSV columns</legend>
     <p className="field-help">Customer ID and name are required. If you map a vehicle, include its ID and label.</p>
     <div className="legacy-columns">{column('customerSourceId',true)}{column('displayName',true)}</div>
     <details className="legacy-fields"><summary>Additional customer details</summary>
      <div className="legacy-columns">{optionalContacts.map(field=>column(field))}</div>
     </details>
     <details className="legacy-fields"><summary>Vehicle details</summary>
      <div className="legacy-columns">{vehicles.map(field=>column(field))}</div>
     </details>
     <button type="submit" className="legacy-review-action" disabled={!mapping.customerSourceId||!mapping.displayName}>Review file</button>
    </fieldset>
   </form>
   {review&&<ReviewResults key={review.previewSha256} review={review} saved={saved} busy={busy} checkSaved={()=>void checkSaved()}/>}
   {draftsAvailable&&review&&<SaveLegacyDraft key={review.previewSha256} businessId={access.context.businessId}
    recoveryEpoch={access.context.recoveryEpoch} sourceSha256={review.sourceSha256} headers={source.headers} mapping={mapping}
    file={()=>fileInput.current?.files?.[0]} authorize={authorizeDraft}/>}
   </div>
    <aside className="legacy-mapping-summary" aria-label="Mapped column summary">
     <h3>Mapped columns</h3><p>{countFormat.format(source.sourceRowCount)} source records · {Object.keys(mapping).length} columns selected</p>
     <p className="field-help">Customer ID and name are required. Each source column can be used once.</p>
     {Object.keys(mapping).length>0?<dl>{Object.entries(mapping).map(([field,header])=><div key={field}><dt>{labels[field as Field]}</dt><dd>{header}</dd></div>)}</dl>:
      <p>Choose the matching ID and name columns to begin.</p>}
    </aside>
   </div>}
   </div>
  </>}
 </div>;
}
function legacyMappedElsewhere(mapping:LegacyContactColumnMap,field:Field,header:string){
 return Object.entries(mapping).some(([mapped,selected])=>mapped!==field&&selected===header);
}
