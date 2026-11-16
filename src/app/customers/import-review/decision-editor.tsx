'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {legacyBatches} from '../../../client/customers';
import type {Proof} from '../../../client/authentication';
import {legacyIdentitySourceKey} from '../../../customer/legacy-contact-application-contract';
import {legacySourceNamespacePattern} from '../../../customer/legacy-contact-decision-contract';

type State=Awaited<ReturnType<typeof legacyBatches.readDecision>>;
type TargetPage=Awaited<ReturnType<typeof legacyBatches.targets>>;
type Target=Omit<TargetPage['items'][number],'matched'>&{matched:readonly ('phone'|'email'|'vin'|'source')[]};
type TargetOptions={items:readonly Target[];hasMore:boolean};
type Selection={id:string;version:string};
type CustomerAction='create'|'link'|'skip';
type VehicleAction=CustomerAction|'none';
type Kind='customer'|'vehicle';
const conflicts={
 operation:'This save could not be confirmed. Reload the decision before saving another choice.',
 row:'The CSV row changed. Reopen the draft and check it again.',
 source:'A source key was saved from another row. Reload this decision to use it.',
 target:'A selected record changed or is no longer eligible. Find saved matches again.',
 revision:'This decision changed elsewhere. Reload to see the latest saved choice.',
} as const;

function LinkedTarget({kind,selected,accept,lookup,busy}:{kind:Kind;selected:Selection|null;
 accept:(item:Selection)=>void;lookup:(cursor:string|null)=>Promise<TargetOptions>;busy:boolean}){
 const [page,setPage]=useState<TargetOptions|null>(null),[cursors,setCursors]=useState<(string|null)[]>([null]);
 const [message,setMessage]=useState('');
 async function load(next:(string|null)[]){
  setMessage('');
  try{const result=await lookup(next.at(-1)!);setPage(result);setCursors(next);}
  catch{setMessage('Saved matches could not be loaded. Try again.');}
 }
 const optionLabel=(item:Target)=>[
  item.label,...item.matched.map(hint=>hint==='source'?'Previously imported':hint.toUpperCase()),...(item.suffix?['ending '+item.suffix]:[]),...(item.descriptor?[item.descriptor]:[]),
 ].join(' · ');
 const eligible=page?.items.filter(item=>!item.archived&&(kind==='customer'||item.recordType==='customer_vehicle'))??[];
 return <div className="legacy-choice-target">
  <button type="button" className="secondary" disabled={busy} onClick={()=>void load([null])}>
   {page?'Refresh':'Find'} saved {kind} matches
  </button>
  {message&&<p role="alert">{message}</p>}
  {page&&<>
   {eligible.length>0?<fieldset>
    <legend>Choose a saved {kind}</legend>
    {eligible.map(item=><label key={item.id} className="legacy-choice-radio">
     <input type="radio" name={'legacy-'+kind} checked={item.id===selected?.id&&item.version===selected.version}
      onChange={()=>accept({id:item.id,version:item.version})}/>{optionLabel(item)}
    </label>)}
   </fieldset>:<p>{page.items.some(item=>item.matched.includes('source'))?'This source ID is linked to a record that is unavailable for import. Review that record or skip this choice.':'No eligible matches on this page.'}</p>}
   {(page.hasMore||cursors.length>1)&&<div className="legacy-pagination">
    <button type="button" className="secondary" disabled={busy||cursors.length===1}
     onClick={()=>void load(cursors.slice(0,-1))}>Previous {kind} matches</button>
    <button type="button" className="secondary" disabled={busy||!page.hasMore}
     onClick={()=>void load([...cursors,page.items.at(-1)!.id])}>Next {kind} matches</button>
   </div>}
  </>}
  {selected&&<p className="field-help">{kind==='customer'?'Customer':'Vehicle'} selected.</p>}
 </div>;
}

export function LegacyDecisionEditor({businessId,batchId,rowsSha256,row,recoveryEpoch,authorize,onSaveAttempt,identitiesAvailable}:{
 businessId:string;batchId:string;rowsSha256:string;row:{row:number;customer:string|null;vehicle:string|null};
 recoveryEpoch:string|null;authorize:(signal:AbortSignal)=>Promise<Proof>;onSaveAttempt:()=>void;identitiesAvailable:boolean;
}){
 const [opened,setOpened]=useState(false),[snapshot,setSnapshot]=useState<State|null>(null),[source,setSource]=useState('');
 const [customer,setCustomer]=useState<CustomerAction|''>(''),[vehicle,setVehicle]=useState<VehicleAction|''>('');
 const [contactTarget,setContactTarget]=useState<Selection|null>(null),[vehicleTarget,setVehicleTarget]=useState<Selection|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const key=useId(),active=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
 const openButton=useRef<HTMLButtonElement>(null),restoreFocus=useRef(false);
 const pending=useRef<{signature:string;operationId:string}|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>{
  if(opened)heading.current?.focus();
  else if(restoreFocus.current){openButton.current?.focus();restoreFocus.current=false;}
 },[opened]);

 async function privateRequest<T>(work:(proof:Proof,signal:AbortSignal)=>Promise<T>,verifyRead=true){
  if(active.current)throw Error('A decision request is already running');
  const controller=new AbortController();active.current=controller;setBusy(true);
  try{
   const proof=await authorize(controller.signal);
   const value=await work(proof,controller.signal);
   if(verifyRead)await authorize(controller.signal);
   controller.signal.throwIfAborted();
   return value;
  }finally{
   if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}
  }
 }
 async function read(){
  setMessage('Loading saved decision…');
  try{
   const value=await privateRequest((proof,signal)=>legacyBatches.readDecision(businessId,{batchId,row:row.row},proof,signal));
   const saved=value.decision;
   setSnapshot(value);setSource(value.sourceNamespace??'');pending.current=null;
   setCustomer(saved?.customerAction??(row.customer===null?'skip':''));
   setVehicle(saved?.vehicleAction??(row.vehicle===null?'none':''));
   setContactTarget(saved?.customerId&&saved.customerVersion?{id:saved.customerId,version:saved.customerVersion}:null);
   setVehicleTarget(saved?.vehicleId&&saved.vehicleVersion?{id:saved.vehicleId,version:saved.vehicleVersion}:null);
   setMessage('');
  }catch{setMessage('The saved decision could not be loaded. Try again.');}
 }
 async function lookup(kind:Kind,afterTarget:string|null){
  return privateRequest(async(proof,signal)=>{
   if(identitiesAvailable&&snapshot&&legacyIdentitySourceKey(source)&&afterTarget===null){
    const saved=await legacyBatches.identity(businessId,{batchId,row:row.row,sourceNamespace:source,kind},proof,signal);
    if(saved.state==='absent'||saved.fingerprint!==snapshot.fingerprint)throw Error('Saved draft changed');
    if(saved.target)return {items:[{...saved.target,matched:['source'] as const,suffix:null,descriptor:null}],hasMore:false};
   }
   const page=await legacyBatches.targets(businessId,{batchId,row:row.row,kind,afterTarget},proof,signal);
   if(page.rowsSha256!==rowsSha256)throw Error('Saved draft changed');
   return page;
  });
 }
 const autoAction=customer==='skip'||row.vehicle===null?'none':vehicle;
 const selectedContact=customer==='link'?contactTarget:null,selectedVehicle=autoAction==='link'?vehicleTarget:null;
 const current=snapshot?.decision;
 const unchanged=!!current&&customer===current.customerAction&&autoAction===current.vehicleAction&&
  (selectedContact?.id??null)===current.customerId&&(selectedContact?.version??null)===current.customerVersion&&
  (selectedVehicle?.id??null)===current.vehicleId&&(selectedVehicle?.version??null)===current.vehicleVersion;
 const ready=!!snapshot&&!!recoveryEpoch&&!!source&&!!customer&&!!autoAction&&!unchanged&&
  (customer!=='link'||!!contactTarget)&&(autoAction!=='link'||!!vehicleTarget);
 async function save(event:FormEvent){
  event.preventDefault();
  if(!snapshot||!ready||!recoveryEpoch||!customer||!autoAction||busy)return;
  const request={batchId,row:row.row,sourceNamespace:source,fingerprint:snapshot.fingerprint,
   expectedRevision:snapshot.decision?.revision??0,recoveryEpoch,customerAction:customer,
   customerId:selectedContact?.id??null,customerVersion:selectedContact?.version??null,
   vehicleAction:autoAction,vehicleId:selectedVehicle?.id??null,vehicleVersion:selectedVehicle?.version??null};
  const signature=JSON.stringify(request);
  const operationId=pending.current?.signature===signature?pending.current.operationId:crypto.randomUUID();
  pending.current={signature,operationId};
  onSaveAttempt();
  setMessage('Saving decision…');
  try{
   // The receipt is scoped and checked by the committed mutation. A later
   // session-proof interruption must not turn that receipt into an unknown save.
   const result=await privateRequest((proof,signal)=>legacyBatches.saveDecision(businessId,{...request,operationId},proof,signal),false);
   if(result.state==='conflict'){
    pending.current=null;
    if(result.reason==='target'){setContactTarget(null);setVehicleTarget(null);}
    setMessage(conflicts[result.reason]);return;
   }
   pending.current=null;
   setSnapshot({...snapshot,sourceNamespace:result.receipt.sourceNamespace,decision:result.receipt});
   setMessage('Decision saved. It will be reviewed before import.');
  }catch{setMessage('The save could not be confirmed. Retry this choice or reload the decision.');}
 }
 if(!opened)return <button type="button" ref={openButton} className="secondary"
  aria-label={'Edit decision for record '+row.row} onClick={()=>{setOpened(true);void read();}}>Edit decision</button>;
 return <section className="legacy-decision-editor" aria-label={'Decision for record '+row.row}>
  <div className="legacy-effect-heading">
   <h4 ref={heading} tabIndex={-1}>Decision for record {row.row}</h4>
   <button type="button" className="secondary" disabled={busy} onClick={()=>{restoreFocus.current=true;setOpened(false);setSnapshot(null);}}>Close decision</button>
  </div>
  <p role="status" aria-label={'Decision status for record '+row.row}>{message}</p>
  {snapshot&&<form onSubmit={save}>
   <fieldset disabled={busy||!recoveryEpoch}>
    <legend className="visually-hidden">Import choices</legend>
    <label htmlFor={key+'-source'}>Source key</label>
    <input id={key+'-source'} value={source} onChange={event=>{setSource(event.target.value);setContactTarget(null);setVehicleTarget(null);}} required readOnly={snapshot.sourceNamespace!==null}
     pattern={legacySourceNamespacePattern} maxLength={64} autoComplete="off" aria-describedby={key+'-source-help'}/>
    <p id={key+'-source-help'} className="field-help">{snapshot.sourceNamespace
     ?'This key is saved for all rows in this draft.':'Use lowercase letters, digits, hyphens or underscores, such as previous-crm. Reuse the key for later files from the same source.'}</p>
    <label htmlFor={key+'-contact'}>Customer decision</label>
    <select id={key+'-contact'} value={customer} required disabled={row.customer===null} onChange={event=>setCustomer(event.target.value as CustomerAction)}>
     <option value="" disabled>Choose a decision</option>
     {row.customer!==null&&<><option value="create">Create a customer</option><option value="link">Link a saved customer</option></>}
     <option value="skip">Skip this row</option>
    </select>
    {customer==='link'&&<LinkedTarget key={source} kind="customer" selected={contactTarget} accept={setContactTarget}
     lookup={cursor=>lookup('customer',cursor)} busy={busy}/>}
    {customer!==''&&customer!=='skip'&&row.vehicle!==null&&<>
     <label htmlFor={key+'-vehicle'}>Vehicle decision</label>
     <select id={key+'-vehicle'} value={vehicle==='none'?'':vehicle} required onChange={event=>setVehicle(event.target.value as VehicleAction)}>
      <option value="" disabled>Choose a decision</option>
      <option value="create">Create a vehicle</option><option value="link">Link a saved vehicle</option><option value="skip">Skip the vehicle</option>
     </select>
     {vehicle==='link'&&<LinkedTarget key={source} kind="vehicle" selected={vehicleTarget} accept={setVehicleTarget}
      lookup={cursor=>lookup('vehicle',cursor)} busy={busy}/>}
    </>}
   </fieldset>
   {snapshot.decision&&<p className="field-help">Saved revision {snapshot.decision.revision}</p>}
   {!recoveryEpoch&&<p>Saving is paused while the workspace is in recovery.</p>}
   <button type="submit" disabled={busy||!ready}>Save decision</button>
  </form>}
  <button type="button" className="secondary" disabled={busy} onClick={()=>void read()}>{snapshot?'Reload decision':'Retry loading decision'}</button>
 </section>;
}
