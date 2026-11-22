'use client';
import {DirectoryLoading} from '../directory-loading';
import {captureDirectoryOrigin,restoreDirectoryOrigin} from '../../client/directory-origin';
import type {DirectoryOrigin} from '../../client/directory-origin';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent,ComponentType} from 'react';
import {createAddressEditorController,emptyAddressDraft,initialAddressEditorView} from '../../client/address-editor-controller';
import {createPendingAddressStore} from '../../client/pending-address-edit';
import {AddressCustomerChooser} from './customer-chooser';
import {NullableText} from '../customers/nullable-text';
import {draftFromAddress} from '../../customer/customer-address-contract';
import type {CustomerAddress} from '../../customer/customer-address-contract';
import {draftChanged} from '../../client/draft-changed';
import {parseAddressDraft} from '../../customer/customer-resource-contract';
import type {AddressDraft} from '../../customer/customer-resource-contract';

const optionalFields=[
  ['line1','Street / address line 1',512,false],['line2','Address line 2',512,false],
  ['city','City',200,false],['region','State / region',200,false],['postalCode','Postal code',128,false],['country','Country',200,false],
  ['exactLocationText','Exact location',2000,true],['instructions','Location instructions',2000,true]
] as const;
const unknown=(v:string|null)=>v===null?'Not recorded':v===''?'Recorded as empty':v;
const label=(row:CustomerAddress)=>row.line1?.trim()||row.exact_location_text?.trim()||row.city?.trim()||'Incomplete address · '+row.id.slice(0,8);
const locality=(row:CustomerAddress)=>[[row.city,row.region].filter(Boolean).join(', '),row.postal_code,row.country].filter(Boolean).join(' ');
const reviewFields=[
  ...optionalFields.map(([field,title])=>[field,title] as const),
  ['latitude','Latitude'],['longitude','Longitude'],['geocodeSource','Geocode source'],
  ['geocodeAccuracy','Geocode accuracy'],['verifiedAt','Verified at UTC'],
  ['archived','Record status'],['archiveReason','Archive reason'],
] as const;

function AddressProfile({row,canEdit,onEdit,heading}:{row:CustomerAddress;canEdit:boolean;onEdit:()=>void;heading:React.Ref<HTMLHeadingElement>}){
 const [copyStatus,setCopyStatus]=useState('');
 const destination=row.archived_at===null&&row.verified_at!==null&&row.latitude!==null&&row.longitude!==null
   ?row.latitude+', '+row.longitude
   :row.archived_at===null&&row.verified_at!==null&&row.line1?.trim()&&row.city?.trim()&&row.country?.trim()
     ?[row.line1,row.line2,locality(row)].filter(Boolean).join(', '):null;
 async function copyDestination(){
  if(!destination)return;
  try{
   await navigator.clipboard.writeText(destination);
   setCopyStatus('Destination copied. Paste it into your maps app.');
  }catch{setCopyStatus('Couldn’t copy. Select and copy the destination below.');}
 }
 return <section className="customer-record-header address-profile" aria-label="Saved address">
  <div className="address-profile-title">
   <div>
    <p className="address-state">{row.archived_at!==null?'Archived':row.verified_at!==null?'Location verified':'Verification not recorded'}</p>
    <h2 ref={heading} tabIndex={-1}>{label(row)}</h2>
   </div>
   {canEdit&&<button className="secondary" type="button" onClick={onEdit}>Edit address</button>}
  </div>
  {(row.line2||locality(row))&&<p className="address-postal">{[row.line2,locality(row)].filter(Boolean).join('\n')}</p>}
  {row.exact_location_text&&label(row)!==row.exact_location_text.trim()&&<p className="address-postal">{row.exact_location_text}</p>}
  {row.instructions&&<div className="address-instructions"><h3>Location instructions</h3><p>{row.instructions}</p></div>}
  {destination&&<div className="address-destination">
   <button type="button" className="secondary" onClick={()=>void copyDestination()}>Copy destination</button>
   {copyStatus&&<p className="field-help" role="status" aria-label="Copy destination status">{copyStatus}</p>}
   {copyStatus.startsWith('Couldn’t')&&<p className="address-postal">{destination}</p>}
  </div>}
 </section>;
}

function AddressReview({draft,saved,onBack,onSave,heading,disabled}:{draft:AddressDraft;saved:CustomerAddress|null;onBack:()=>void;onSave:()=>void;heading:React.Ref<HTMLHeadingElement>;disabled:boolean}){
 const next=parseAddressDraft(draft),prior=saved?draftFromAddress(saved):null;
 const changes=reviewFields.filter(([field])=>prior?prior[field]!==next[field]:next[field]!==null&&next[field]!==false);
 const show=(value:string|boolean|null)=>typeof value==='boolean'?value?'Archived':'Active':unknown(value);
 return <section className="home-panel address-review" aria-label="Address change review">
  <h2 ref={heading} tabIndex={-1}>Review address</h2>
  {changes.length===0&&<p>{prior?'There are no changes to the saved values.':'This address will be saved with location details unknown.'}</p>}
  {changes.length>0&&<dl className="address-differences">{changes.map(([field,title])=><div key={field}>
   <dt>{title}</dt>
   <dd>
    {prior&&<div><span>Saved</span><p>{show(prior[field])}</p></div>}
    <div><span>{prior?'Proposed':'New'}</span><p>{show(next[field])}</p></div>
   </dd>
  </div>)}</dl>}
  <div className="address-actions">
   <button type="button" disabled={disabled||!!prior&&changes.length===0} onClick={onSave}>Save address</button>
   <button type="button" className="secondary" onClick={onBack} disabled={disabled}>Back to address details</button>
  </div>
 </section>;
}
function AddressDetails({row}:{row:CustomerAddress}){
 const fields=[['Street / address line 1',row.line1],['Address line 2',row.line2],['City',row.city],['State / region',row.region],['Postal code',row.postal_code],['Country',row.country],['Exact location',row.exact_location_text],['Location instructions',row.instructions],['Latitude',row.latitude],['Longitude',row.longitude],['Geocode source',row.geocode_source],['Geocode accuracy',row.geocode_accuracy],['Verified at UTC',row.verified_at],['Archived at UTC',row.archived_at],['Archive reason',row.archived_reason]] as const;
 return <dl className="customer-values">{fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{unknown(value)}</dd></div>)}</dl>;
}
export function AddressScreen({customerId,assist:Assist}:{customerId:string|null;assist?:ComponentType<{draft:AddressDraft;change:(draft:AddressDraft)=>void}>}){
 const [saving,setSaving]=useState(false);
 const [view,setView]=useState(initialAddressEditorView),current=useRef<ReturnType<typeof createAddressEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const [mode,setMode]=useState<'profile'|'edit'|'review'>('profile'),[showRecord,setShowRecord]=useState(false);
 const profileHeading=useRef<HTMLHeadingElement>(null),reviewHeading=useRef<HTMLHeadingElement>(null),reviewButton=useRef<HTMLButtonElement>(null);
 const searchInput=useRef<HTMLInputElement>(null),listTrigger=useRef<HTMLButtonElement>(null);
 const selectedId=view.selected?.id??null,dirty=draftChanged(view.draft,view.selected?draftFromAddress(view.selected):emptyAddressDraft);
 const focusRequest=useRef<{controller:NonNullable<typeof current.current>;id:string|null;target?:'record'|'directory'|'review-button'}|null>(null);
 const directoryOrigin=useRef<DirectoryOrigin|null>(null);
 const clearDirectoryOrigin=useCallback(()=>{directoryOrigin.current=null;listTrigger.current=null;focusRequest.current=null;},[]);
 useLayoutEffect(()=>{
  const requested=focusRequest.current;if(!requested||view.busy)return;
  if(current.current===requested.controller&&view.phase==='ready'&&view.draft&&requested.id===selectedId){
   if(requested.target==='directory')restoreDirectoryOrigin(directoryOrigin.current,listTrigger.current?.isConnected?listTrigger.current:searchInput.current);
   else (requested.target==='review-button'?reviewButton.current:(mode==='profile'?profileHeading:mode==='review'?reviewHeading:heading).current)?.focus();
  }
  focusRequest.current=null;
 },[view,selectedId,mode,showRecord]);
 useEffect(()=>{
  const c=createAddressEditorController({customerId,store:createPendingAddressStore({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)}),change:next=>{if(next.phase!=='ready')clearDirectoryOrigin();setView(next);}});current.current=c;void c.load();
  function suspend(){setMode('profile');setShowRecord(false);c.suspend();}
  const hidden=()=>{if(document.visibilityState==='hidden')suspend();},leave=()=>suspend(),restore=(e:PageTransitionEvent)=>{if(e.persisted)suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  return ()=>{c.dispose();current.current=null;clearDirectoryOrigin();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
 },[customerId,clearDirectoryOrigin]);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!saving)return;const leaving=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[dirty,view.phase,saving]);
 async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const c=current.current;if(!c)return;if(kind==='save')setSaving(true);try{await c[kind]();if(current.current===c)status.current?.focus();}finally{if(kind==='save')setSaving(false);}}
 function edit<K extends keyof AddressDraft>(key:K,value:AddressDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function focusOnCommit(target:'record'|'directory'|'review-button'='record'){const controller=current.current;if(controller)focusRequest.current={controller,id:selectedId,target};}
 function review(e:FormEvent){
  e.preventDefault();
  if(!current.current?.view().canSave)return;
  focusOnCommit();
  setMode('review');
 }
 function backToEdit(){
  focusOnCommit('review-button');
  setMode('edit');
 }
 function save(){
  if(mode!=='review'||!current.current?.view().canSave)return;
  setMode('profile');setShowRecord(false);void action('save');
 }
 function discardAllowed(){
  const state=current.current?.view();
  return !state||!draftChanged(state.draft,state.selected?draftFromAddress(state.selected):emptyAddressDraft)||window.confirm('Discard your unsaved address changes? Choose Cancel to keep editing.');
 }
 async function open(id:string,trigger:HTMLButtonElement){
  const controller=current.current;
  if(!controller||controller.view().busy||!discardAllowed())return;
  listTrigger.current=trigger;directoryOrigin.current=captureDirectoryOrigin(trigger);
  setMode('profile');setShowRecord(true);
  focusRequest.current={controller,id};await controller.open(id);
 }
 function create(trigger:HTMLButtonElement){
  const controller=current.current;
  if(!controller||controller.view().busy||!discardAllowed())return;
  listTrigger.current=trigger;directoryOrigin.current=captureDirectoryOrigin(trigger);
  setMode('edit');setShowRecord(true);
  focusRequest.current={controller,id:null};controller.create();
 }
 function startEdit(){focusOnCommit();setMode('edit');}
 function closeEditor(){
  if(!view.selected||!discardAllowed())return;
  focusOnCommit();
  current.current?.edit(draftFromAddress(view.selected));
  setMode('profile');
 }
 function backToList(){
  if(!showRecord){focusRequest.current=null;restoreDirectoryOrigin(directoryOrigin.current,listTrigger.current?.isConnected?listTrigger.current:searchInput.current);return;}
  focusOnCommit('directory');
  setShowRecord(false);
 }
 function returnToRecord(){
  focusOnCommit();
  setShowRecord(true);
 }
 function query(text:string,archived:boolean,more=false){if(current.current&&!current.current.view().busy&&discardAllowed()){clearDirectoryOrigin();setMode('profile');setShowRecord(false);void current.current.query(text,archived,more);}}
 function search(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);query(String(data.get('search')??''),data.get('archived')==='on');}
 return <section aria-label="Customer address directory" aria-busy={view.busy}>
  <p className={view.phase==='choose-customer'&&view.message==='Choose a customer to view or manage their saved addresses.'?'visually-hidden':'customer-directory-status'} ref={status} tabIndex={-1} role="status" aria-label="Address editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.phase==='loading'&&<DirectoryLoading/>}
  {view.phase==='ready'&&<>
   {view.parent&&<header className="address-customer">
    <h2>{view.parent.display_name}</h2>
    <a className="record-return-link" href={'/customers?customer='+encodeURIComponent(view.parent.id)+'&view=vehicles'}>Back to customer record</a>
   </header>}
   {view.writesPaused&&<p className="notice">Address changes are paused. Current records and history remain available.</p>}
   <div className="address-layout" data-mobile-record={showRecord&&view.draft!==null}>
    <section className="customer-lookup address-lookup" aria-label="Find an address">
     <button type="button" className="customer-add" disabled={view.busy||view.writesPaused} onClick={e=>create(e.currentTarget)}>Add address</button>
     {view.draft&&!showRecord&&<button type="button" className="secondary address-mobile-control" onClick={returnToRecord}>Return to open address</button>}
     <form className="customer-search" onSubmit={search} aria-label="Search addresses">
      <label htmlFor="address-search">Address search</label>
      <div className="customer-search-row">
       <input ref={searchInput} id="address-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/>
       <button className="secondary" type="submit" aria-label="Search addresses" disabled={view.busy}>Search</button>
      </div>
      <label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived addresses</label>
     </form>
     <p className="field-help">Choose a saved location. Confirm its use when booking or billing.</p>
     <ul className="customer-list customer-directory-list">{view.rows.map(row=><li key={row.id}>
      <button type="button" className="secondary" disabled={view.busy} aria-current={row.id===selectedId?'true':undefined} onClick={e=>void open(row.id,e.currentTarget)}>{label(row)}{row.archived_at!==null?' — archived':''}</button>
      <p className="customer-contact">{[row.line2,locality(row),row.verified_at!==null&&row.archived_at===null?'Location verified':null].filter(Boolean).join(' · ')}</p>
     </li>)}</ul>
   {!view.busy&&view.rows.length===0&&<p className="customer-directory-empty">{view.search?'No addresses match this search.':'No saved addresses on this page.'}</p>}
   {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>query(view.search,view.includeArchived,true)}>Next address page</button>}
    </section>
    <div className="address-record">
     {view.draft&&<button type="button" className="secondary address-mobile-control" onClick={backToList}>Back to addresses</button>}
     {view.selected&&<AddressProfile key={view.selected.id+':'+view.selected.version} row={view.selected} heading={profileHeading} canEdit={mode==='profile'&&!view.writesPaused&&!view.busy} onEdit={startEdit}/>}
   {view.draft&&mode!=='profile'&&<form className="customer-record-editor address-editor" hidden={mode==='review'} onSubmit={review} aria-label="Address editor"><h2 ref={heading} tabIndex={-1}>{view.selected?'Edit address':'New address'}</h2>
    <p className="field-help">Leave unknown fields blank. Unsaved changes clear when you leave or hide the page.</p>
    <fieldset disabled={view.busy||view.writesPaused}><legend>Location details</legend>
     {Assist&&<Assist draft={view.draft} change={next=>current.current?.edit(next)}/>}
     <div className="address-fields">{optionalFields.map(([name,title,limit,multiline])=><NullableText key={name} name={'address-'+name} label={title} limit={limit} multiline={multiline} value={view.draft![name]} disabled={view.busy} change={v=>edit(name,v)}/>)}</div>
     <details><summary>Coordinates and verification</summary>
       <div className="address-coordinate-fields"><div><label htmlFor="address-latitude">Latitude</label><input id="address-latitude" name="latitude" type="text" inputMode="text" autoComplete="off" maxLength={128} value={view.draft.latitude??''} onChange={e=>edit('latitude',e.target.value||null)}/>
       </div><div><label htmlFor="address-longitude">Longitude</label><input id="address-longitude" name="longitude" type="text" inputMode="text" autoComplete="off" maxLength={128} value={view.draft.longitude??''} onChange={e=>edit('longitude',e.target.value||null)}/></div></div>
       <p className="field-help">Both values are required when recorded. Latitude: −90 to 90; longitude: −180 to 180. Decimal text is retained without rounding.</p>
      <NullableText name="address-geocode-source" label="Geocode source" limit={200} value={view.draft.geocodeSource} disabled={view.busy} change={v=>edit('geocodeSource',v)}/>
      <NullableText name="address-geocode-accuracy" label="Geocode accuracy" limit={200} value={view.draft.geocodeAccuracy} disabled={view.busy} change={v=>edit('geocodeAccuracy',v)}/>
      {view.draft.verifiedAt===null&&<button className="secondary" type="button" onClick={()=>edit('verifiedAt',new Date().toISOString().slice(0,-1)+'000Z')}>Mark location verified now</button>}
      <NullableText name="address-verified" label="Verified at UTC" limit={27} value={view.draft.verifiedAt} disabled={view.busy} change={v=>edit('verifiedAt',v)}/>
      <p className="field-help">Verification is an explicit record, independent of coordinates. Format: 2026-10-25T12:30:00.123456Z. Leave unknown if it has not been verified.</p>
     </details>
     <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={e=>current.current?.edit({...view.draft!,archived:e.target.checked,archiveReason:e.target.checked?'':null})}/>Archive address</label>
     {view.draft.archived&&<><label htmlFor="address-archive-reason">Address archive reason</label><textarea id="address-archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={e=>edit('archiveReason',e.target.value)} required/><p className="field-help">Archiving retains the address and history. {[...(view.draft.archiveReason??'')].length}/1000 characters.</p></>}
    </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<div className="address-actions">
     <button ref={reviewButton} type="submit" disabled={!view.canSave}>Review address</button>
     {view.selected&&<button type="button" className="secondary" disabled={view.busy} onClick={closeEditor}>Close editor</button>}
    </div>
   </form>}
     {mode==='review'&&view.draft&&view.canSave&&<AddressReview draft={view.draft} saved={view.selected} heading={reviewHeading} onBack={backToEdit} onSave={save} disabled={view.busy}/>}
     {view.history&&<details className="home-panel address-history" aria-label="Address history">
      <summary>Retained address history</summary>
      <p>Current version {view.history.address.version}</p>
      {view.history.history.map(event=><details key={event.after.version}>
       <summary>Version {event.after.version} · {event.after.updated_at}</summary>
       {event.before&&<><h3>Before</h3><AddressDetails row={event.before}/></>}
       <h3>After</h3><AddressDetails row={event.after}/>
      </details>)}
      {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy||mode!=='profile'} onClick={()=>void action('moreHistory')}>Next address history page</button>}
     </details>}
    </div>
   </div>
  </>}
  {view.phase==='pending'&&<><p className="field-help">An earlier address save is awaiting review. Its original customer is used even if you opened a different customer link. No retry runs automatically.</p><button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check address save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original address change</button>}{view.reference&&<details className="save-review-reference"><summary>Original save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details>}</>}
  {view.phase==='choose-customer'&&<AddressCustomerChooser/>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current addresses</button>}
  {view.phase!=='ready'&&view.phase!=='loading'&&<nav aria-label="Address help">{view.phase!=='choose-customer'&&<a href="/customers">Customer directory</a>}<a href="/save-review">Review interrupted save</a><a href="/sign-in">Device sign-in</a></nav>}
 </section>;
}
