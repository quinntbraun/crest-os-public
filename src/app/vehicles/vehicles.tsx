'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createVehicleEditorController,initialVehicleEditorView} from '../../client/vehicle-editor-controller';
import {createPendingVehicleStore} from '../../client/pending-vehicle-edit';
import {NullableText} from '../customers/nullable-text';
import type {Vehicle} from '../../customer/vehicle-contract';
import type {VehicleDraft} from '../../customer/customer-resource-contract';
import {vehicleYearInput} from './year-input';
import {AssociationPanel} from './associations';

function YearInput({value,change}:{value:number;change:(value:number)=>void}){
  const [text,setText]=useState(Number.isFinite(value)?String(value):'');
  return <><label htmlFor="vehicle-year">Year value</label><input id="vehicle-year" name="year" type="text" autoComplete="off" maxLength={16} pattern="-?[0-9]+" value={text} onChange={event=>{setText(event.target.value);change(vehicleYearInput(event.target.value));}} required/><p className="field-help">Enter a whole year. Unusual years are allowed.</p></>;
}
function VehicleDetails({vehicle}:{vehicle:Vehicle}){
  const unknown=(value:string|number|null)=>value===null?'Not recorded':value===''?'Recorded as empty':String(value);
  return <dl className="customer-values"><dt>Label</dt><dd>{vehicle.label}</dd><dt>Year</dt><dd>{unknown(vehicle.year)}</dd><dt>Make</dt><dd>{unknown(vehicle.make)}</dd><dt>Model</dt><dd>{unknown(vehicle.model)}</dd><dt>Color</dt><dd>{unknown(vehicle.color)}</dd><dt>VIN</dt><dd>{unknown(vehicle.vin_raw)}</dd><dt>Plate</dt><dd>{unknown(vehicle.plate)}</dd><dt>Kind</dt><dd>{vehicle.kind==='customer_vehicle'?'Customer vehicle':vehicle.kind==='business_rig'?'Business rig':'Other'}</dd><dt>Notes</dt><dd>{unknown(vehicle.notes)}</dd><dt>Status</dt><dd>{vehicle.archived_at===null?'Active':'Archived: '+vehicle.archived_reason}</dd></dl>;
}
export function VehicleScreen(){
  const [view,setView]=useState(initialVehicleEditorView),current=useRef<ReturnType<typeof createVehicleEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    const controller=createVehicleEditorController({store:createPendingVehicleStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;void controller.load();
    const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
    return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
  },[]);
  useEffect(()=>{if(!view.canSave&&view.phase!=='pending'&&!view.busy)return;const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[view.canSave,view.phase,view.busy]);
  async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
  function edit<K extends keyof VehicleDraft>(key:K,value:VehicleDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);void current.current?.query(String(data.get('search')??''),data.get('archived')==='on');}
  return <section aria-label="Vehicle directory" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" aria-label="Vehicle editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<>
      {view.writesPaused&&<p className="notice">Vehicle changes are paused. You can review current records and history.</p>}
      <form onSubmit={search} aria-label="Search vehicles"><label htmlFor="vehicle-search">Vehicle search</label><input id="vehicle-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/><label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived vehicles</label><button className="secondary" type="submit" disabled={view.busy}>Search vehicles</button></form>
      <p className="field-help">Search label, make, model, VIN or plate text. Shared VINs and plates do not merge vehicles. Searching or opening another record discards an unsaved draft.</p>
      <ul className="customer-list">{view.rows.map(row=><li key={row.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void current.current?.open(row.id)}>{row.label}{row.archived_at!==null?' — archived':''}</button></li>)}</ul>
      {view.rows.length===0&&<p>No vehicles found on this page.</p>}
      {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void current.current?.query(view.search,view.includeArchived,true)}>Next vehicle page</button>}
      <button type="button" disabled={view.busy||view.writesPaused} onClick={()=>current.current?.create()}>Add vehicle</button>
      {view.draft&&<form onSubmit={submit} aria-label="Vehicle editor"><h2>{view.selected?'Edit vehicle':'New vehicle'}</h2>
        <p className="field-help">Only the label is required. Unknown details stay unknown. Leaving or hiding this page clears private drafts; closing this tab can also lose its save reference.</p>
        <fieldset disabled={view.busy||view.writesPaused}><legend>Vehicle details</legend>
          <label htmlFor="vehicle-label">Vehicle label</label><input id="vehicle-label" name="vehicle-label" autoComplete="off" maxLength={400} value={view.draft.label} onChange={event=>edit('label',event.target.value)} required/><p className="field-help">{[...view.draft.label].length}/200 characters.</p>
          <label className="trust"><input type="checkbox" checked={view.draft.year!==null} onChange={event=>edit('year',event.target.checked?NaN:null)}/>Record year</label>
          {view.draft.year!==null&&<YearInput key={(view.selected?.id??'new')+':'+(view.selected?.version??'0')} value={view.draft.year} change={value=>edit('year',value)}/>}
          <NullableText name="make" label="Make" limit={200} value={view.draft.make} disabled={view.busy} change={value=>edit('make',value)}/>
          <NullableText name="model" label="Model" limit={200} value={view.draft.model} disabled={view.busy} change={value=>edit('model',value)}/>
          <NullableText name="color" label="Color" limit={128} value={view.draft.color} disabled={view.busy} change={value=>edit('color',value)}/>
          <NullableText name="vin" label="VIN" limit={128} value={view.draft.vin} disabled={view.busy} change={value=>edit('vin',value)}/>
          <NullableText name="plate" label="Plate" limit={128} value={view.draft.plate} disabled={view.busy} change={value=>edit('plate',value)}/>
          <label htmlFor="vehicle-kind">Vehicle kind</label><select id="vehicle-kind" value={view.draft.kind} onChange={event=>edit('kind',event.target.value as VehicleDraft['kind'])}><option value="customer_vehicle">Customer vehicle</option><option value="business_rig">Business rig</option><option value="other">Other</option></select>
          <NullableText name="notes" label="Notes" multiline limit={2000} value={view.draft.notes} disabled={view.busy} change={value=>edit('notes',value)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>current.current?.edit({...view.draft!,archived:event.target.checked,archiveReason:event.target.checked?'':null})}/>Archive vehicle</label>
          {view.draft.archived&&<><label htmlFor="archive-reason">Archive reason</label><textarea id="archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)} required/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1000 characters. Archiving retains the record and its history.</p></>}
        </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<button type="submit" disabled={!view.canSave}>Save vehicle</button>
      </form>}
      {view.history&&<section aria-label="Vehicle history"><h2>Retained history</h2><p>Current version: {view.history.vehicle.version}</p>
        {view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><VehicleDetails vehicle={event.before}/></>}<h3>After</h3><VehicleDetails vehicle={event.after}/></details>)}
        {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next history page</button>}
      </section>}
      {view.selected&&view.businessId&&<AssociationPanel key={view.businessId+':'+view.selected.id} businessId={view.businessId} vehicleId={view.selected.id}/>}
    </>}
    {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check vehicle save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original vehicle change</button>}</>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current vehicles</button>}
    <nav aria-label="Vehicle navigation"><Link href="/customers">Customers</Link><Link href="/settings">Business settings</Link><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav>
    <p className="field-help">Setup and synthetic testing are still in progress. This screen does not approve real customer records or production use.</p>
  </section>;
}
