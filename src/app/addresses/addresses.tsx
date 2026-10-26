'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createAddressEditorController,initialAddressEditorView} from '../../client/address-editor-controller';
import {createPendingAddressStore} from '../../client/pending-address-edit';
import {NullableText} from '../customers/nullable-text';
import type {CustomerAddress} from '../../customer/customer-address-contract';
import type {AddressDraft} from '../../customer/customer-resource-contract';

const optionalFields=[
  ['line1','Street / address line 1',512,false],['line2','Address line 2',512,false],
  ['city','City',200,false],['region','State / region',200,false],['postalCode','Postal code',128,false],['country','Country',200,false],
  ['exactLocationText','Exact location',2000,true],['instructions','Location instructions',2000,true]
] as const;
const unknown=(v:string|null)=>v===null?'Not recorded':v===''?'Recorded as empty':v;
const label=(row:CustomerAddress)=>row.line1||row.exact_location_text||row.city||'Incomplete address · '+row.id.slice(0,8);
function AddressDetails({row}:{row:CustomerAddress}){
 const fields=[['Street / address line 1',row.line1],['Address line 2',row.line2],['City',row.city],['State / region',row.region],['Postal code',row.postal_code],['Country',row.country],['Exact location',row.exact_location_text],['Location instructions',row.instructions],['Latitude',row.latitude],['Longitude',row.longitude],['Geocode source',row.geocode_source],['Geocode accuracy',row.geocode_accuracy],['Verified at UTC',row.verified_at],['Archived at UTC',row.archived_at],['Archive reason',row.archived_reason]] as const;
 return <dl className="customer-values">{fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{unknown(value)}</dd></div>)}</dl>;
}
export function AddressScreen({customerId}:{customerId:string|null}){
 const [view,setView]=useState(initialAddressEditorView),current=useRef<ReturnType<typeof createAddressEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const c=createAddressEditorController({customerId,store:createPendingAddressStore({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)}),change:setView});current.current=c;void c.load();
  const hidden=()=>{if(document.visibilityState==='hidden')c.suspend();},leave=()=>c.suspend(),restore=(e:PageTransitionEvent)=>{if(e.persisted)c.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return ()=>{c.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
 },[customerId]);
 useEffect(()=>{if(!view.canSave&&view.phase!=='pending'&&!view.busy)return;const leaving=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[view.canSave,view.phase,view.busy]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const c=current.current;if(!c)return;await c[kind]();if(current.current===c)status.current?.focus();}
 function edit<K extends keyof AddressDraft>(key:K,value:AddressDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function save(e:FormEvent){e.preventDefault();void action('save');}
 function search(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);void current.current?.query(String(data.get('search')??''),data.get('archived')==='on');}
 return <section aria-label="Customer address directory" aria-busy={view.busy}>
  <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase==='ready'&&<>
   {view.parent&&<p className="current-name">Addresses for <strong>{view.parent.display_name}</strong></p>}
   {view.writesPaused&&<p className="notice">Address changes are paused. Current records and history remain available.</p>}
   <form onSubmit={search} aria-label="Search addresses"><label htmlFor="address-search">Address search</label><input id="address-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/><label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived addresses</label><button className="secondary" type="submit" disabled={view.busy}>Search addresses</button></form>
   <p className="field-help">Search this customer's recorded location text. Searching or opening another record discards an unsaved draft. Shared locations are kept as separate records.</p>
   <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.open(row.id)}>{label(row)}{row.archived_at!==null?' — archived':''}</button></li>)}</ul>
   {view.rows.length===0&&<p>No addresses found on this page.</p>}
   {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void current.current?.query(view.search,view.includeArchived,true)}>Next address page</button>}
   <button type="button" disabled={view.busy||view.writesPaused} onClick={()=>current.current?.create()}>Add address</button>
   {view.draft&&<form onSubmit={save} aria-label="Address editor"><h2>{view.selected?'Edit address':'New address'}</h2>
    <p className="field-help">Record what you know; unknown and explicitly empty values remain distinct. This record does not confirm a job location. Leaving or hiding the page clears private drafts; closing the tab may also lose its save reference.</p>
    <fieldset disabled={view.busy||view.writesPaused}><legend>Location details</legend>
     {optionalFields.map(([name,title,limit,multiline])=><NullableText key={name} name={'address-'+name} label={title} limit={limit} multiline={multiline} value={view.draft![name]} disabled={view.busy} change={v=>edit(name,v)}/>)}
     <details><summary>Coordinates and verification</summary>
      <label className="trust"><input type="checkbox" checked={view.draft.latitude!==null||view.draft.longitude!==null} onChange={e=>current.current?.edit({...view.draft!,latitude:e.target.checked?'':null,longitude:e.target.checked?'':null})}/>Record coordinates</label>
      {(view.draft.latitude!==null||view.draft.longitude!==null)&&<>
       <label htmlFor="address-latitude">Latitude</label><input id="address-latitude" name="latitude" type="text" inputMode="text" autoComplete="off" maxLength={128} value={view.draft.latitude??''} onChange={e=>edit('latitude',e.target.value)}/>
       <label htmlFor="address-longitude">Longitude</label><input id="address-longitude" name="longitude" type="text" inputMode="text" autoComplete="off" maxLength={128} value={view.draft.longitude??''} onChange={e=>edit('longitude',e.target.value)}/>
       <p className="field-help">Both values are required when recorded. Latitude: −90 to 90; longitude: −180 to 180. Decimal text is retained without rounding.</p>
      </>}
      <NullableText name="address-geocode-source" label="Geocode source" limit={200} value={view.draft.geocodeSource} disabled={view.busy} change={v=>edit('geocodeSource',v)}/>
      <NullableText name="address-geocode-accuracy" label="Geocode accuracy" limit={200} value={view.draft.geocodeAccuracy} disabled={view.busy} change={v=>edit('geocodeAccuracy',v)}/>
      {view.draft.verifiedAt===null&&<button className="secondary" type="button" onClick={()=>edit('verifiedAt',new Date().toISOString().slice(0,-1)+'000Z')}>Mark location verified now</button>}
      <NullableText name="address-verified" label="Verified at UTC" limit={27} value={view.draft.verifiedAt} disabled={view.busy} change={v=>edit('verifiedAt',v)}/>
      <p className="field-help">Verification is an explicit record, independent of coordinates. Format: 2026-10-25T12:30:00.123456Z. Leave unknown if it has not been verified.</p>
     </details>
     <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={e=>current.current?.edit({...view.draft!,archived:e.target.checked,archiveReason:e.target.checked?'':null})}/>Archive address</label>
     {view.draft.archived&&<><label htmlFor="address-archive-reason">Address archive reason</label><textarea id="address-archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={e=>edit('archiveReason',e.target.value)} required/><p className="field-help">Archiving retains the address and history. {[...(view.draft.archiveReason??'')].length}/1000 characters.</p></>}
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>Save address</button>
   </form>}
   {view.history&&<section aria-label="Address history"><h2>Retained address history</h2><p>Current version: {view.history.address.version}</p>{view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><AddressDetails row={event.before}/></>}<h3>After</h3><AddressDetails row={event.after}/></details>)}{view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next address history page</button>}</section>}
  </>}
  {view.phase==='pending'&&<><p className="field-help">An earlier address save is awaiting review. Its original customer is used even if you opened a different customer link. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check address save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original address change</button>}</>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current addresses</button>}
<nav aria-label="Address navigation"><Link href="/save-review">Review interrupted save</Link><Link href="/customers">Customer directory</Link><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav>
  <p className="field-help">Setup and synthetic testing are still in progress. This screen does not approve real records or production use.</p>
 </section>;
}
