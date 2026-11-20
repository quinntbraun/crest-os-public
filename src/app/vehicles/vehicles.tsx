'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createVehicleEditorController,initialVehicleEditorView,emptyVehicleDraft} from '../../client/vehicle-editor-controller';
import {createPendingVehicleStore} from '../../client/pending-vehicle-edit';
import {NullableText} from '../customers/nullable-text';
import {DirectoryIntroduction} from '../directory-introduction';
import type {Vehicle} from '../../customer/vehicle-contract';
import type {VehicleDraft} from '../../customer/customer-resource-contract';
import {vehicleYearInput} from './year-input';
import {AssociationPanel} from './associations';
import {customerUuid} from '../../customer/customer-contract';
import {SavedRecordDownload} from '../saved-record-download';
import {draftFromVehicle} from '../../customer/vehicle-contract';
import {draftChanged} from '../../client/draft-changed';
import {RecordJobHistory} from '../schedule/record-job-history';

function YearInput({value,change}:{value:number|null;change:(value:number|null)=>void}){
  const [text,setText]=useState(Number.isFinite(value)?String(value):'');
  return <><label htmlFor="vehicle-year">Year</label><input id="vehicle-year" name="year" type="text" inputMode="numeric" autoComplete="off" maxLength={16} pattern="-?[0-9]+" value={text} onChange={event=>{setText(event.target.value);change(event.target.value.length?vehicleYearInput(event.target.value):null);}}/><p className="field-help">Optional. Enter a whole year, or leave blank. Unusual years are allowed.</p></>;
}
const vehicleKinds={customer_vehicle:'Customer vehicle',business_rig:'Business rig',other:'Other vehicle'};

function vehicleTitle(vehicle:Vehicle){
  const model=[vehicle.make?.trim(),vehicle.model?.trim()].filter(Boolean).join(' ');
  return model?[vehicle.year,model].filter(value=>value!==null).join(' '):vehicle.label;
}

function VehicleSummary({vehicle,heading,onEdit,canEdit}:{vehicle:Vehicle;heading:React.Ref<HTMLHeadingElement>;onEdit:()=>void;canEdit:boolean}){
  const title=vehicleTitle(vehicle);
  const facts=[['Plate',vehicle.plate],['Color',vehicle.color],['VIN',vehicle.vin_raw],['Year',title===vehicle.label?vehicle.year:null]];
  return <header className="vehicle-profile customer-record-header">
    <p className="vehicle-profile-kind">{vehicleKinds[vehicle.kind]}{vehicle.archived_at!==null?' · Archived':''}</p>
    <div className="vehicle-profile-title">
      <div><h2 ref={heading} tabIndex={-1}>{title}</h2>{title!==vehicle.label&&<p>{vehicle.label}</p>}</div>
      {canEdit&&<button className="secondary" type="button" onClick={onEdit}>Edit vehicle</button>}
    </div>
    <dl>{facts.filter(([,value])=>value!==null&&value!=='').map(([field,value])=><div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl>
    {vehicle.notes&&<p className="vehicle-notes">{vehicle.notes}</p>}
    {vehicle.archived_reason&&<p className="vehicle-notes">Archive reason · {vehicle.archived_reason}</p>}
  </header>;
}

function VehicleDetails({vehicle}:{vehicle:Vehicle}){
  const unknown=(value:string|number|null)=>value===null?'Not recorded':value===''?'Recorded as empty':String(value);
  return <dl className="customer-values"><dt>Label</dt><dd>{vehicle.label}</dd><dt>Year</dt><dd>{unknown(vehicle.year)}</dd><dt>Make</dt><dd>{unknown(vehicle.make)}</dd><dt>Model</dt><dd>{unknown(vehicle.model)}</dd><dt>Color</dt><dd>{unknown(vehicle.color)}</dd><dt>VIN</dt><dd>{unknown(vehicle.vin_raw)}</dd><dt>Plate</dt><dd>{unknown(vehicle.plate)}</dd><dt>Kind</dt><dd>{vehicle.kind==='customer_vehicle'?'Customer vehicle':vehicle.kind==='business_rig'?'Business rig':'Other'}</dd><dt>Notes</dt><dd>{unknown(vehicle.notes)}</dd><dt>Status</dt><dd>{vehicle.archived_at===null?'Active':'Archived: '+vehicle.archived_reason}</dd></dl>;
}
export function VehicleScreen({initialVehicleId=null,initialVisits=false,linkCustomerId=null}:{initialVehicleId?:string|null;initialVisits?:boolean;linkCustomerId?:string|null}={}){
  const [view,setView]=useState(initialVehicleEditorView),current=useRef<ReturnType<typeof createVehicleEditorController>|null>(null),status=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const [editing,setEditing]=useState(false),[showRecord,setShowRecord]=useState(initialVehicleId!==null);
  const profileHeading=useRef<HTMLHeadingElement>(null),searchInput=useRef<HTMLInputElement>(null),directoryTrigger=useRef<HTMLButtonElement>(null);
  const dirty=draftChanged(view.draft,view.selected?draftFromVehicle(view.selected):emptyVehicleDraft);
  const focusRequest=useRef<{controller:NonNullable<typeof current.current>;id:string|null;target?:'record'|'directory'}|null>(null),editorVisible=view.draft!==null&&editing,selectedId=view.selected?.id??null;
  useLayoutEffect(()=>{
    const requested=focusRequest.current;if(!requested||view.busy)return;
    if(current.current===requested.controller&&view.phase==='ready'&&selectedId===requested.id){
      const target=requested.target==='directory'?(directoryTrigger.current?.isConnected?directoryTrigger.current:searchInput.current):(editorVisible?heading:profileHeading).current;
      target?.focus();
    }
    focusRequest.current=null;
  },[view,editorVisible,selectedId,showRecord]);
  const linkEdit=useRef<'clean'|'draft'|'pending'>('clean'),reportLinkEdit=useCallback((state:'clean'|'draft'|'pending')=>{linkEdit.current=state;},[]);
  useEffect(()=>{
    const controller=createVehicleEditorController({store:createPendingVehicleStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});current.current=controller;
    void (async()=>{
      await controller.load();
      if(!customerUuid(initialVehicleId)||current.current!==controller||controller.view().phase!=='ready')return;
      if(!initialVisits||!controller.view().recordJobHistoryAvailable)focusRequest.current={controller,id:initialVehicleId};
      await controller.open(initialVehicleId);
    })();
    const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
    return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
  },[initialVehicleId,initialVisits]);
  useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leaving=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',leaving);return ()=>window.removeEventListener('beforeunload',leaving);},[dirty,view.phase,view.busy]);
  function discardAllowed(){
    if(linkEdit.current==='pending'){window.alert('Check the pending customer-link save before changing vehicles. Its original save reference must be kept.');return false;}
    const state=current.current?.view();return (!state||!draftChanged(state.draft,state.selected?draftFromVehicle(state.selected):emptyVehicleDraft))&&linkEdit.current==='clean'||window.confirm('Discard your unsaved vehicle or customer-link changes? Choose Cancel to keep editing.');
  }
  async function open(id:string,trigger:HTMLButtonElement){
    const controller=current.current;
    if(!controller)return;
    if(id===selectedId){
      directoryTrigger.current=trigger;
      focusRequest.current={controller,id};
      setShowRecord(true);
      if(showRecord){
        focusRequest.current=null;
        (editorVisible?heading:profileHeading).current?.focus();
      }
      return;
    }
    if(!discardAllowed())return;
    directoryTrigger.current=trigger;
    setShowRecord(true);
    setEditing(false);
    focusRequest.current={controller,id};
    await controller.open(id);
  }
  function create(){const controller=current.current;if(!controller||!discardAllowed())return;setShowRecord(true);setEditing(true);focusRequest.current={controller,id:null};controller.create();}
  function query(search:string,archived:boolean,more=false){if(discardAllowed()){setEditing(false);void current.current?.query(search,archived,more);}}
  async function action(kind:'load'|'save'|'check'|'retry'|'moreHistory'){const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();}
  function edit<K extends keyof VehicleDraft>(key:K,value:VehicleDraft[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
  function focusOnCommit(target:'record'|'directory'='record'){const controller=current.current;if(controller)focusRequest.current={controller,id:selectedId,target};}
  function backToDirectory(){
    if(!showRecord){focusRequest.current=null;(directoryTrigger.current?.isConnected?directoryTrigger.current:searchInput.current)?.focus();return;}
    focusOnCommit('directory');
    setShowRecord(false);
  }
  function startEditing(){
    focusOnCommit();
    setEditing(true);
  }
  function closeEditor(){
    if(dirty&&!window.confirm('Discard your unsaved vehicle changes?'))return;
    focusOnCommit();
    if(view.selected)current.current?.edit(draftFromVehicle(view.selected));
    setEditing(false);
  }
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  function search(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);query(String(data.get('search')??''),data.get('archived')==='on');}
  return <section className="vehicle-workspace" aria-label="Vehicle directory" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" className="customer-directory-status" aria-label="Vehicle editor status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<>
      {linkCustomerId&&!view.selected&&<p>Choose a vehicle or save a new one, then start its customer link.</p>}
      {view.writesPaused&&<p className="notice">Vehicle changes are paused. You can review current records and history.</p>}
      <div className="vehicle-layout" data-mobile-record={showRecord&&view.draft!==null}>
        <section className="customer-lookup" aria-label="Find a vehicle">
          <button type="button" className="customer-add" disabled={view.busy||view.writesPaused} onClick={create}>Add vehicle</button>
          <form className="customer-search" onSubmit={search} aria-label="Search vehicles"><label htmlFor="vehicle-search">Vehicle search</label><div className="customer-search-row"><input ref={searchInput} id="vehicle-search" name="search" type="search" autoComplete="off" maxLength={400} defaultValue={view.search} disabled={view.busy}/><button className="secondary" type="submit" disabled={view.busy} aria-label="Search vehicles">Search</button></div><label className="trust"><input name="archived" type="checkbox" defaultChecked={view.includeArchived} disabled={view.busy}/>Include archived vehicles</label></form>
      <p className="field-help">Search by label, make, model, VIN or plate.</p>
      <ul className="customer-list customer-directory-list vehicle-results">{view.rows.map(row=>{
            const title=vehicleTitle(row);
            return <li key={row.id}>
              <button type="button" className="secondary" aria-current={row.id===selectedId?'true':undefined} disabled={view.busy} onClick={event=>void open(row.id,event.currentTarget)}>{title}{row.archived_at!==null?' — archived':''}</button>
              {(row.label!==title||row.plate)&&<p className="customer-contact">{[row.label!==title?row.label:null,row.plate].filter(Boolean).join(' · ')}</p>}
            </li>;
          })}</ul>
      {!view.busy&&view.rows.length===0&&<p className="customer-directory-empty">No vehicles match this search.</p>}
      {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>query(view.search,view.includeArchived,true)}>Next vehicle page</button>}
        </section>
        <div className="vehicle-record">
          {!view.draft&&!view.selected&&!view.busy&&<DirectoryIntroduction kind="vehicle" onSearch={()=>searchInput.current?.focus()}/>}
          {view.draft&&<button className="secondary vehicle-directory-back" type="button" onClick={backToDirectory}>Back to vehicle list</button>}
          {view.selected&&<>
            <VehicleSummary vehicle={view.selected} heading={profileHeading} canEdit={!view.busy&&!view.writesPaused&&!editing} onEdit={startEditing}/>
          </>}
      {view.draft&&(editing||!view.selected)&&<form className="customer-record-editor vehicle-editor" onSubmit={submit} aria-label="Vehicle editor"><h2 ref={heading} tabIndex={-1} className="editor-heading">{view.selected?'Edit vehicle':'New vehicle'}</h2>
        <p className="field-help">Only the label is required. Unsaved changes clear when you leave or hide this page.</p>
        <fieldset disabled={view.busy||view.writesPaused}><legend>Vehicle details</legend>
          <label htmlFor="vehicle-label">Vehicle label</label><input id="vehicle-label" name="vehicle-label" autoComplete="off" maxLength={400} value={view.draft.label} onChange={event=>edit('label',event.target.value)} required/><p className="field-help">{[...view.draft.label].length}/200 characters.</p>
          <YearInput key={(view.selected?.id??'new')+':'+(view.selected?.version??'0')} value={view.draft.year} change={value=>edit('year',value)}/>
          <NullableText name="make" label="Make" limit={200} value={view.draft.make} disabled={view.busy} change={value=>edit('make',value)}/>
          <NullableText name="model" label="Model" limit={200} value={view.draft.model} disabled={view.busy} change={value=>edit('model',value)}/>
          <NullableText name="color" label="Color" limit={128} value={view.draft.color} disabled={view.busy} change={value=>edit('color',value)}/>
          <NullableText name="vin" label="VIN" limit={128} value={view.draft.vin} disabled={view.busy} change={value=>edit('vin',value)}/>
          <NullableText name="plate" label="Plate" limit={128} value={view.draft.plate} disabled={view.busy} change={value=>edit('plate',value)}/>
          <label htmlFor="vehicle-kind">Vehicle kind</label><select id="vehicle-kind" value={view.draft.kind} onChange={event=>edit('kind',event.target.value as VehicleDraft['kind'])}><option value="customer_vehicle">Customer vehicle</option><option value="business_rig">Business rig</option><option value="other">Other</option></select>
          <NullableText name="notes" label="Notes" multiline limit={2000} value={view.draft.notes} disabled={view.busy} change={value=>edit('notes',value)}/>
          <label className="trust"><input type="checkbox" checked={view.draft.archived} onChange={event=>current.current?.edit({...view.draft!,archived:event.target.checked,archiveReason:event.target.checked?'':null})}/>Archive vehicle</label>
          {view.draft.archived&&<><label htmlFor="archive-reason">Archive reason</label><textarea id="archive-reason" name="archive-reason" rows={3} maxLength={2000} value={view.draft.archiveReason??''} onChange={event=>edit('archiveReason',event.target.value)} required/><p className="field-help">{[...(view.draft.archiveReason??'')].length}/1000 characters. Archiving retains the record and its history.</p></>}
        </fieldset>{view.draftIssue&&<p className="field-help">{view.draftIssue}</p>}<div className="vehicle-actions"><button type="submit" disabled={!view.canSave}>Save vehicle</button>{view.selected&&<button type="button" className="secondary" disabled={view.busy} onClick={closeEditor}>Close editor</button>}</div>
      </form>}
      {view.selected&&view.recordJobHistoryAvailable&&<RecordJobHistory key={'jobs:'+view.selected.id} businessId={view.selected.business_id} recordId={view.selected.id} kind="vehicle" initiallyOpen={initialVisits&&selectedId===initialVehicleId}/>}
      {view.history&&<details className="home-panel vehicle-history" aria-label="Vehicle history"><summary>Record history and download</summary><p>Current version {view.history.vehicle.version}</p>
        <SavedRecordDownload key={view.history.vehicle.id} kind="vehicle" record={view.history.vehicle} disabled={view.busy}/>
        {view.history.history.map(event=><details key={event.after.version}><summary>Version {event.after.version} · {event.after.updated_at}</summary>{event.before&&<><h3>Before</h3><VehicleDetails vehicle={event.before}/></>}<h3>After</h3><VehicleDetails vehicle={event.after}/></details>)}
        {view.history.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next history page</button>}
      </details>}
      {view.selected&&view.businessId&&<AssociationPanel key={view.businessId+':'+view.selected.id} businessId={view.businessId} vehicleId={view.selected.id} linkCustomerId={linkCustomerId} onEditStateChange={reportLinkEdit}/>}
        </div>
      </div>
    </>}
    {view.phase==='pending'&&<><p className="field-help">Keep the original save reference until the outcome is confirmed. No retry runs automatically.</p><button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check vehicle save status</button>{view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original vehicle change</button>}{view.reference&&<details className="save-review-reference"><summary>Original save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details>}</>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current vehicles</button>}
    {view.phase!=='ready'&&view.phase!=='loading'&&<nav aria-label="Vehicle help"><a href="/save-review">Review interrupted save</a><a href="/sign-in">Device sign-in</a></nav>}

  </section>;
}
