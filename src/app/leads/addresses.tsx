'use client';
import {createPendingLeadConversionStore} from '../../client/pending-lead-conversion';
import {Fragment,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createLeadAddressEditorController,initialLeadAddressEditorView,emptyLeadAddressDraft} from '../../client/lead-address-editor-controller';
import {createPendingLeadAddressStore} from '../../client/pending-lead-address-edit';
import {createPendingLeadStore} from '../../client/pending-lead-edit';
import {createPendingLeadStateStore} from '../../client/pending-lead-state-edit';
import {createPendingLeadVehicleStore} from '../../client/pending-lead-vehicle-edit';
import {draftFromLeadAddress} from '../../customer/lead-address-contract';
import type {LeadAddress} from '../../customer/lead-address-contract';
import type {LeadAddressDraft} from '../../customer/lead-resource-contract';
import {NullableText} from '../customers/nullable-text';

const fields=[['line1','Address line 1',512,false],['line2','Address line 2',512,false],['city','City',200,false],['region','State or region',200,false],['postalCode','Postal code',128,false],['country','Country',200,false],['exactLocationText','Exact location description',2000,true],['instructions','Location instructions',2000,true]] as const;
function addressLabel(row:LeadAddress){
 const value=[row.line1,row.exact_location_text,row.city].find(value=>value?.trim());
 if(!value)return 'details not recorded';const points=[...value];return points.slice(0,80).join('')+(points.length>80?'…':'');
}
function AddressDetails({row}:{row:LeadAddress}){
 const text=(value:string|null)=>value===null?'Not recorded':value===''?'Recorded as empty':value;
 const values=[['Address line 1',row.line1],['Address line 2',row.line2],['City',row.city],['State or region',row.region],['Postal code',row.postal_code],['Country',row.country],['Exact location description',row.exact_location_text],['Location instructions',row.instructions],['Latitude',row.latitude],['Longitude',row.longitude],['Geocode source',row.geocode_source],['Geocode accuracy',row.geocode_accuracy],['Verification time (UTC)',row.verified_at],['Archived at (UTC)',row.archived_at],['Archive reason',row.archived_reason]] as const;
 return <dl className="customer-values">{values.map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd style={{whiteSpace:'pre-wrap'}}>{text(value)}</dd></Fragment>)}</dl>;
}
export function LeadAddressPanel({businessId,leadId,disabled,onLock}:{businessId:string;leadId:string;disabled:boolean;onLock:(locked:boolean)=>void}){
 const [view,setView]=useState(initialLeadAddressEditorView),current=useRef<ReturnType<typeof createLeadAddressEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const controller=createLeadAddressEditorController({conversionStore:createPendingLeadConversionStore(storage),businessId,leadId,store:createPendingLeadAddressStore(storage),intakeStore:createPendingLeadStore(storage),statusStore:createPendingLeadStateStore(storage),vehicleStore:createPendingLeadVehicleStore(storage),change:setView});current.current=controller;
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[businessId,leadId]);
 const dirty=view.draft!==null&&(view.draftIssue!==''||JSON.stringify(view.draft)!==JSON.stringify(view.selected?draftFromLeadAddress(view.selected):emptyLeadAddressDraft)),pending=view.phase==='pending',hasDraft=view.draft!==null&&(!view.selected||dirty);
 useEffect(()=>{onLock(view.busy||pending||hasDraft);},[onLock,view.busy,pending,hasDraft]);useEffect(()=>()=>onLock(false),[onLock]);
 useEffect(()=>{if(!pending&&!hasDraft)return;const leave=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[pending,hasDraft]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
 function edit<K extends keyof LeadAddressDraft>(key:K,value:LeadAddressDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function submit(event:FormEvent){event.preventDefault();if(!disabled)void action('save');}
 const writeDisabled=disabled||view.busy||view.writesPaused;
 return <section aria-label="Lead addresses" aria-busy={view.busy}><h2>Lead locations</h2>
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead address editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {disabled&&<p className="field-help">Save or reload the intake, status or vehicle draft before editing locations.</p>}
  {['idle','review','blocked','unavailable'].includes(view.phase)&&<button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void action('load')}>Load lead addresses</button>}
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Lead address changes are paused. Retained history remains available.</p>}
   <label className="trust"><input type="checkbox" checked={view.includeArchived} disabled={disabled||view.busy||hasDraft} onChange={event=>void current.current?.query(event.target.checked)}/>Include archived lead addresses</label>
   <ul className="customer-list">{view.rows.map((row,index)=><li key={row.id}><button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void current.current?.open(row.id)}>Location {index+1}: {addressLabel(row)}{row.archived_at?' — archived':''}</button><p>Location version {row.version}</p></li>)}</ul>
   {view.rows.length===0&&<p>No lead addresses on this page.</p>}{view.hasMore&&<button type="button" className="secondary" disabled={disabled||view.busy||hasDraft} onClick={()=>void current.current?.query(view.includeArchived,true)}>Next lead address page</button>}
   <p className="field-help">Opening another location discards an unsaved draft. Original lead locations stay separate from customer addresses.</p>
   <button type="button" disabled={writeDisabled} onClick={()=>current.current?.create()}>Add lead address</button>
   {view.draft&&<>
    <h3>{view.selected?'Edit lead address':'New lead address'}</h3><p className="field-help">Record what is known. An incomplete location can be saved; this does not confirm a customer job location. Unknown and explicitly empty values remain distinct.</p>
    <form onSubmit={submit} aria-label="Lead address editor"><fieldset disabled={writeDisabled}><legend>Location details</legend>
     {fields.map(([name,label,limit,multiline])=><NullableText key={name} name={'lead-address-'+name} label={label} limit={limit} multiline={multiline} value={view.draft![name]} disabled={writeDisabled} change={value=>edit(name,value)}/>)}
     <details><summary>Location coordinates and verification</summary>
      <label className="trust"><input type="checkbox" checked={view.draft.latitude!==null||view.draft.longitude!==null} onChange={event=>{if(view.draft)current.current?.edit({...view.draft,latitude:event.target.checked?'':null,longitude:event.target.checked?'':null});}}/>Record location coordinates</label>
      {(view.draft.latitude!==null||view.draft.longitude!==null)&&<>
       <label htmlFor="lead-address-latitude">Location latitude</label><input id="lead-address-latitude" type="text" autoComplete="off" maxLength={128} required value={view.draft.latitude??''} onChange={event=>edit('latitude',event.target.value)}/>
       <label htmlFor="lead-address-longitude">Location longitude</label><input id="lead-address-longitude" type="text" autoComplete="off" maxLength={128} required value={view.draft.longitude??''} onChange={event=>edit('longitude',event.target.value)}/>
       <p className="field-help">Record both values: latitude −90 to 90, longitude −180 to 180. Decimal text is retained without rounding.</p>
      </>}
      <NullableText name="lead-address-geocode-source" label="Location geocode source" limit={200} value={view.draft.geocodeSource} disabled={writeDisabled} change={value=>edit('geocodeSource',value)}/>
      <NullableText name="lead-address-geocode-accuracy" label="Location geocode accuracy" limit={200} value={view.draft.geocodeAccuracy} disabled={writeDisabled} change={value=>edit('geocodeAccuracy',value)}/>
      {view.draft.verifiedAt===null&&<button type="button" className="secondary" onClick={()=>edit('verifiedAt',new Date().toISOString().slice(0,-1)+'000Z')}>Mark lead location verified now</button>}
      <NullableText name="lead-address-verified" label="Location verification time (UTC)" limit={27} value={view.draft.verifiedAt} disabled={writeDisabled} change={value=>edit('verifiedAt',value)}/>
      <p className="field-help">Only record verification if it happened. Format: 2026-10-25T12:30:00.123456Z. Coordinates do not automatically verify a location.</p>
     </details>
     <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>{if(view.draft)current.current?.edit({...view.draft,archived:event.target.checked,archiveReason:event.target.checked?view.draft.archiveReason??'':null});}}/>Archive lead address</label>
     {view.draft.archived&&<><label htmlFor="lead-address-archive">Lead address archive reason</label><textarea id="lead-address-archive" required maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)}/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1,000 characters.</p></>}
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={writeDisabled||!view.canSave}>Save lead address</button></form>
    <button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('load')}>Discard lead address draft and reload</button>
   </>}
   {view.history&&<section aria-label="Lead address history"><h3>Retained location history</h3><p>Current location version: {view.history.leadAddress.version}</p>{view.history.history.map(event=><details key={event.eventId}><summary>Location version {event.version} · {event.action}</summary><p>Recorded (UTC): {event.at}</p>{event.before&&<><h4>Before location</h4><AddressDetails row={event.before}/></>}<h4>After location</h4><AddressDetails row={event.after}/></details>)}{view.history.hasMore&&<button type="button" className="secondary" disabled={disabled||view.busy||hasDraft} onClick={()=>void action('moreHistory')}>Next lead address history page</button>}</section>}
  </>}
  {pending&&<><p className="field-help">Keep the original location reference until its outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Lead address reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check lead address outcome</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy||disabled} onClick={()=>void action('retry')}>Retry original lead address</button>}</>}
 </section>;
}
