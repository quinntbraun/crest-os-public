'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {captureDirectoryOrigin,restoreDirectoryOrigin} from '../../client/directory-origin';
import type {DirectoryOrigin} from '../../client/directory-origin';
import type {FormEvent} from 'react';
import {createLeadSourceEditorController,initialLeadSourceEditorView,emptyLeadSourceDraft} from '../../client/lead-source-editor-controller';
import type {LeadSourceEditorView} from '../../client/lead-source-editor-controller';
import {createPendingLeadSourceStore} from '../../client/pending-lead-source-edit';
import type {LeadSource,LeadSourceDraft} from '../../customer/lead-contract';
import {draftFromLeadSource} from '../../customer/lead-contract';
import {ReferencePicker} from '../leads/reference-picker';
import {DirectoryIntroduction} from '../directory-introduction';
import {leadSourceChanges} from './source-history-presentation';

const eventTime=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'});

function changeLabel(before:LeadSource|null,after:LeadSource){
 if(!before)return 'Source created';
 if((leadSourceChanges(before,after)?.length??0)>1)return 'Source updated';
 if(before.active!==after.active)return after.active?'Source reactivated':'Source deactivated';
 if(before.label!==after.label)return 'Source renamed';
 if(before.kind!==after.kind)return 'Source kind changed';
 if(before.referral_customer_id!==after.referral_customer_id)return 'Referral link changed';
 return 'Source updated';
}

function SourceDetails({source}:{source:LeadSource}){
 return <dl className="customer-values">
  <dt>Label</dt><dd>{source.label}</dd>
  <dt>Kind</dt><dd>{source.kind}</dd>
  <dt>Status</dt><dd>{source.active?'Active':'Inactive'}</dd>
  <dt>Referral customer</dt><dd>{source.referral_customer_id?'Existing customer linked':'No customer linked'}</dd>
  {source.referral_customer_id&&<><dt>Customer reference</dt><dd className="source-history-reference">{source.referral_customer_id}</dd></>}
  <dt>Source reference</dt><dd className="source-history-reference">{source.id}</dd>
  <dt>Recorded (UTC)</dt><dd className="source-history-reference"><time dateTime={source.updated_at}>{source.updated_at}</time></dd>
 </dl>;
}

function ChangedSourceValues({changes,side}:{changes:NonNullable<ReturnType<typeof leadSourceChanges>>;side:'before'|'after'}){
 return <dl className="source-history-change-values">{changes.map(change=><div key={change.key}>
  <dt>{change.label}</dt><dd>{change.key==='active'?(change[side]?'Active':'Inactive'):change.key==='referral_customer_id'?(change[side]===null?'No customer linked':<><a href={'/customers?customer='+encodeURIComponent(String(change[side]))}>Open linked customer</a><span className="source-history-reference">{String(change[side])}</span></>):String(change[side])}</dd>
 </div>)}</dl>;
}

function SourceHistory({history,version,busy,onMore}:{history:LeadSourceEditorView['history'];version:string;busy:boolean;onMore:()=>void}){
 const summary=useRef<HTMLElement>(null);
 return <section aria-labelledby="lead-source-history-heading" className="lead-source-history">
  <h3 id="lead-source-history-heading" className="visually-hidden">Lead source history</h3>
  <details>
   <summary ref={summary}>Source history <span>Current version: {version}</span></summary>
   {!history&&<p className="field-help">Loading the next history page…</p>}
   {history&&<>
    <p className="field-help">{history.history.length?'Loaded versions '+history.history[0]!.after.version+'–'+history.history.at(-1)!.after.version+'.':'No versions on this loaded page.'} {history.hasMore?'Later versions are available.':'No later versions in this loaded history.'} {history.history[0]?.after.version!=='1'&&history.history.length>0?'Reopen this source to return to its first history page.':''}</p>
    <ol>{history.history.map(({before,after})=>{const changes=leadSourceChanges(before,after);return <li key={after.version}>
    <details>
     <summary><strong>{changeLabel(before,after)}</strong><span>Version {after.version} · <time dateTime={after.updated_at}>{eventTime.format(new Date(after.updated_at))} UTC</time></span></summary>
     {!before?<section aria-label="After"><h4>Created source</h4><SourceDetails source={after}/></section>:<>
      {changes?.length?<div className="lead-source-history-values" role="group" aria-label="Changed source facts">
       <section aria-label="Before"><h4>Before</h4><ChangedSourceValues changes={changes} side="before"/></section>
       <section aria-label="After"><h4>After</h4><ChangedSourceValues changes={changes} side="after"/></section>
      </div>:<p className="field-help">{changes===null?'A change summary is unavailable for this retained version.':'No source fields changed in this version.'}</p>}
      <details className="source-history-evidence"><summary>Retained source details at version {after.version}</summary><div className="lead-source-history-values">
       <section aria-label="Retained earlier source"><h4>Before</h4><SourceDetails source={before}/></section>
       <section aria-label="Retained resulting source"><h4>After</h4><SourceDetails source={after}/></section>
      </div></details>
     </>}
    </details>
   </li>;})}</ol></>}
   {history?.hasMore&&<button type="button" className="secondary" disabled={busy} onClick={()=>{
    summary.current?.focus();onMore();
   }}>Next source history page</button>}
  </details>
 </section>;
}

export function LeadSourceScreen(){
 const [view,setView]=useState(initialLeadSourceEditorView);
 const current=useRef<ReturnType<typeof createLeadSourceEditorController>|null>(null);
 const status=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const returnFocus=useRef<HTMLButtonElement|null>(null),add=useRef<HTMLButtonElement>(null);
 const sourceSearch=useRef<HTMLInputElement>(null),restoreDirectoryFocus=useRef(false);
 const directoryOrigin=useRef<DirectoryOrigin|null>(null);
 const clearDirectoryOrigin=useCallback(()=>{directoryOrigin.current=null;returnFocus.current=null;restoreDirectoryFocus.current=false;},[]);
 const editor=view.draft?view.selected?.id??'new':null;
 const {draft,selected}=view;
 const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(selected?draftFromLeadSource(selected):emptyLeadSourceDraft);
 const disabled=view.busy||view.writesPaused;

 useEffect(()=>{
  const controller=createLeadSourceEditorController({store:createPendingLeadSourceStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:next=>{if(next.phase!=='ready')clearDirectoryOrigin();setView(next);}});
  current.current=controller;void controller.load();
  const leave=()=>{restoreDirectoryFocus.current=false;controller.suspend();};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return()=>{controller.dispose();current.current=null;clearDirectoryOrigin();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[clearDirectoryOrigin]);
 useEffect(()=>{
  if(!dirty&&view.phase!=='pending'&&!view.busy)return;
  const leave=(event:BeforeUnloadEvent)=>event.preventDefault();
  window.addEventListener('beforeunload',leave);
  return()=>window.removeEventListener('beforeunload',leave);
 },[dirty,view.phase,view.busy]);
 useLayoutEffect(()=>{if(editor)heading.current?.focus();},[editor]);
 useLayoutEffect(()=>{
  if(editor||view.busy||view.phase!=='ready'||!restoreDirectoryFocus.current)return;
  restoreDirectoryFocus.current=false;
  const target=returnFocus.current;
  restoreDirectoryOrigin(directoryOrigin.current,target?.isConnected&&!target.disabled?target:add.current);
 },[editor,view.busy,view.phase]);

 async function action(kind:'load'|'save'|'check'|'retry'){
  const controller=current.current;if(!controller)return;
  await controller[kind]();
  if(current.current===controller)status.current?.focus();
 }
 function edit<K extends keyof LeadSourceDraft>(key:K,value:LeadSourceDraft[K]){
  if(draft)current.current?.edit({...draft,[key]:value});
 }
 const canLeave=()=>!dirty||window.confirm('Discard the unsaved lead source changes?');
 function search(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!current.current||current.current.view().busy||!canLeave())return;
  const data=new FormData(event.currentTarget);
  clearDirectoryOrigin();
  void current.current?.query(String(data.get('search')??''),data.get('inactive')==='on');
 }
 function close(){
  if(!canLeave())return;
  restoreDirectoryFocus.current=true;
  current.current?.close();
 }

 return <div className="lead-source-screen">
  <p ref={status} tabIndex={-1} role="status" aria-label="Lead source editor status" aria-live="polite" aria-atomic="true" className="lead-source-status">{view.message}</p>
  {view.phase==='loading'&&<div className="lead-source-loading" aria-hidden="true">
   <span className="workspace-skeleton"/><span className="workspace-skeleton"/><span className="workspace-skeleton"/>
  </div>}
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Source changes are paused. You can review current records and retained history.</p>}
   <div className="lead-source-layout" data-editing={Boolean(draft)}>
    <section className="lead-source-directory" aria-label="Lead source directory" aria-busy={view.busy}>
     <div className="lead-source-directory-heading">
      <h2>Sources</h2>
      <button ref={add} type="button" disabled={disabled} onClick={event=>{
       if(!current.current||current.current.view().busy||!canLeave())return;
       returnFocus.current=event.currentTarget;directoryOrigin.current=captureDirectoryOrigin(event.currentTarget);current.current.create();
      }}>Add lead source</button>
     </div>
     <form onSubmit={search} aria-label="Search lead sources" className="lead-source-search">
      <label htmlFor="source-search">Lead source search</label>
      <input ref={sourceSearch} id="source-search" name="search" type="search" maxLength={400} autoComplete="off" defaultValue={view.search} disabled={view.busy}/>
      <button type="submit" className="secondary" aria-label="Search lead sources" disabled={view.busy}>Search</button>
      <label className="checkbox"><input name="inactive" type="checkbox" defaultChecked={view.includeInactive} disabled={view.busy}/>Include inactive sources</label>
     </form>
     <ul className="customer-list crest-record-list" aria-label="Saved lead sources">
      {view.rows.map(row=><li key={row.id} className="crest-lead-row crest-source-row">
       <button type="button" className="secondary crest-record-row lead-source-row" aria-describedby={'source-summary-'+row.id} aria-current={selected?.id===row.id?'true':undefined} disabled={view.busy} onClick={event=>{
        if(!current.current||current.current.view().busy||!canLeave())return;
        returnFocus.current=event.currentTarget;directoryOrigin.current=captureDirectoryOrigin(event.currentTarget);void current.current.open(row.id);
       }}>
        <strong>{row.label}{!row.active&&<span className="visually-hidden"> — inactive</span>}</strong>
       </button>
       <span id={'source-summary-'+row.id} className="crest-record-meta"><span>{row.kind}</span>
        <span className="crest-record-state" data-active={row.active}>{row.active?'Active':'Inactive'}</span>
       </span>
      </li>)}
     </ul>
     {view.rows.length===0&&!view.busy&&<p className="lead-source-empty">{view.search||view.includeInactive?'No sources match this search.':'No active sources yet.'}</p>}
     {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(current.current&&!current.current.view().busy&&canLeave()){clearDirectoryOrigin();void current.current.query(view.search,view.includeInactive,true);}}}>Next lead source page</button>}
    </section>
    {!draft&&!view.busy&&<div className="directory-introduction-slot"><DirectoryIntroduction kind="source" onSearch={()=>sourceSearch.current?.focus()}/></div>}
    {draft&&<section className="lead-source-editor" aria-labelledby="lead-source-edit-heading" aria-busy={view.busy}>
     <button type="button" className="secondary lead-source-back" disabled={view.busy} onClick={close}>Back to sources</button>
     <div className="lead-source-editor-heading">
      <h2 id="lead-source-edit-heading" tabIndex={-1} ref={heading}>{selected?selected.label:'New lead source'}</h2>
      {selected&&<span className="crest-record-state" data-active={selected.active}>{selected.active?'Active':'Inactive'}</span>}
     </div>
     <form key={editor} id="lead-source-editor-form" onSubmit={event=>{event.preventDefault();void action('save');}} aria-label="Lead source editor">
      <fieldset disabled={disabled}>
       <legend className="visually-hidden">Source details</legend>
       <label htmlFor="source-label">Source label</label>
       <input id="source-label" name="source-label" autoComplete="off" maxLength={400} value={draft.label} onChange={event=>edit('label',event.target.value)} aria-describedby="source-label-help" required/>
       <p id="source-label-help" className="field-help">{[...draft.label].length}/200 characters. Use a unique name, such as Google Search or Customer referral.</p>
       <label htmlFor="source-kind">Source kind</label>
       <input id="source-kind" name="source-kind" autoComplete="off" maxLength={400} value={draft.kind} onChange={event=>edit('kind',event.target.value)} aria-describedby="source-kind-help" required/>
       <p id="source-kind-help" className="field-help">{[...draft.kind].length}/200 characters. Use a category that makes sense for your business.</p>
       <label className="checkbox"><input type="checkbox" checked={draft.active} onChange={event=>edit('active',event.target.checked)}/>Source active</label>
       {selected&&<p className="field-help">Leads keep their original source name and kind. Deactivating this source removes it from the active directory. Records and attribution stay in history.</p>}
      </fieldset>
     </form>
     {view.businessId&&<details key={editor+':customer'} className="lead-source-referral">
      <summary>Referring customer <span>{draft.referralCustomerId?'Linked':'Optional'}</span></summary>
      <ReferencePicker businessId={view.businessId} kind="customer" value={draft.referralCustomerId} disabled={disabled} change={value=>edit('referralCustomerId',value)}/>
     </details>}
     {view.draftIssue&&(draft.label||draft.kind)&&<p className="field-help">{view.draftIssue}</p>}
     <button type="submit" form="lead-source-editor-form" disabled={!view.canSave}>Save lead source</button>
     {selected&&<SourceHistory key={editor} history={view.history} version={selected.version} busy={view.busy} onMore={()=>void current.current?.moreHistory()}/>}
    </section>}
   </div>
  </>}
  {view.phase==='pending'&&<section className="lead-source-recovery" aria-label="Pending lead source save">
   <h2>Check the original save</h2>
   <p>Keep this tab open until Crest confirms the result.</p>
   <button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check lead source save status</button>
   {view.canRetry&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('retry')}>Retry original lead source change</button>}
   {view.reference&&<details><summary>Save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details>}
   <a href="/save-review">Review interrupted saves</a>
  </section>}
  {['review','unavailable','blocked'].includes(view.phase)&&<div className="lead-source-recovery">
   <button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current lead sources</button>
   {view.phase==='unavailable'&&<a href="/sign-in">Device sign-in</a>}
   <a href="/save-review">Review interrupted saves</a>
  </div>}
 </div>;
}
