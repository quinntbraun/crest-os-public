'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createSourceExportDownloadController,initialSourceExportDownloadView} from '../../client/source-export-download-controller';
import type {SourceExportDownloadView} from '../../client/source-export-download-controller';

type Actions={load:()=>void;continueLoading:()=>void;prepare:(partId:string)=>void;requestSave:()=>void;compare:(files:readonly File[])=>void;listLogical?:()=>void;prepareLogical?:(name:string)=>void;listOriginals?:()=>void;prepareOriginalBatch?:(ordinal:number)=>void;compareOriginalBatches?:(files:readonly File[])=>void};
export function SourceExportDownloadControls({view,actions,statusRef}:{view:SourceExportDownloadView;actions:Actions;statusRef?:React.Ref<HTMLParagraphElement>}){
 const choice=useId(),size=useId(),local=useId(),logicalChoice=useId(),[selected,setSelected]=useState(''),[logicalSelection,setLogicalSelection]=useState(''),part=view.files.find(file=>file.partId===selected)??view.files[0];
 const logical=view.logicalFiles??[],chosen=logical.find(file=>file.name===logicalSelection)??logical.find(file=>file.name.endsWith('.csv'))??logical[0];
 const originalChoice=useId(),originalCompare=useId(),[originalSelection,setOriginalSelection]=useState(''),originals=view.originals,batch=originals?.batches.find(item=>String(item.ordinal)===originalSelection)??originals?.batches.find(item=>item.comparison!=='matching')??originals?.batches[0];
 const label=(name:string)=>name.replace(/^crest_private_|^crest_/,'').replace(/\.(csv|json)$/,'').replaceAll('_',' ');
 return <section className="export-files export-download" aria-label="Download export files" aria-busy={view.busy}>
  <header className="export-collection-header">
   <h3>Download and compare files</h3>
   <p>{view.currentFormat?'Prepare an Excel workbook or choose the data files you want to save.':'Save every part of this export together. Use Compare files to check the copies on your device.'}</p><p className="export-assurance">Matching these files verifies this package. Complete business portability and a recoverable backup still require the remaining source and original-file components.</p>
  </header>
  <p className="export-status" ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  <div className="export-actions">
   <button className={view.files.length?'secondary':undefined} type="button" disabled={!view.canLoad} onClick={actions.load}>Check sign-in and load file list</button>
   {view.canContinue&&<button type="button" onClick={actions.continueLoading}>Continue loading file list</button>}
  </div>
  {view.packageInfo&&<dl className="export-attributes export-package-meta" aria-label="Verified package metadata"><div><dt>Package completed · UTC</dt><dd><time dateTime={view.packageInfo.completedAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(view.packageInfo.completedAt))}</time></dd></div><div><dt>File availability expires · UTC</dt><dd><time dateTime={view.packageInfo.expiresAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(view.packageInfo.expiresAt))}</time></dd></div><div><dt>Package size</dt><dd>{view.packageInfo.fileCount} parts · {view.packageInfo.totalBytes.toLocaleString('en-US')} bytes</dd></div></dl>}
  {view.total!==null&&<p className="field-help">Checked {view.loaded} of {view.total} export parts.</p>}
  {view.files.length>0&&<>
   {view.currentFormat&&actions.prepareLogical&&<section className="export-file-picker" aria-label="CSV and Excel downloads">
    <div><h4>Business records</h4><p>Choose the Excel workbook, individual CSV records, or package details.</p></div>
    <div className="export-actions"><button type="button" disabled={!view.canPrepare} onClick={()=>actions.prepareLogical?.('business_records.xlsx')}>Prepare Excel workbook</button><button className="secondary" type="button" disabled={!view.canPrepare} onClick={actions.listLogical}>Choose individual files</button></div>
    {logical.length>0&&<><div><label htmlFor={logicalChoice}>Data file</label><select id={logicalChoice} value={chosen?.name??''} disabled={!view.canPrepare} onChange={event=>setLogicalSelection(event.target.value)}><optgroup label="CSV records">{logical.filter(file=>file.name.endsWith('.csv')).map(file=><option key={file.name} value={file.name}>{label(file.name)} · CSV</option>)}</optgroup><optgroup label="Package details">{logical.filter(file=>file.name.endsWith('.json')).map(file=><option key={file.name} value={file.name}>{label(file.name)} · JSON</option>)}</optgroup></select></div><button className="secondary" type="button" disabled={!view.canPrepare||!chosen} onClick={()=>{if(chosen)actions.prepareLogical?.(chosen.name);}}>Prepare selected data file</button></>}
   </section>}
   {originals?.supported&&actions.listOriginals&&<section className="export-file-picker export-originals" aria-label="Original receipts, documents and photos">
    <div><h4>Receipts, documents &amp; photos</h4><p>Save original files in small ZIPs with their folder structure and a checklist. Keep these alongside your business records.</p></div>
    <button className="secondary export-original-load" type="button" disabled={!view.canPrepare} onClick={actions.listOriginals}>{originals.loaded?'Refresh original file list':'Load original file list'}</button>
    {originals.loaded&&<>
     <p className="field-help">{originals.originalCount.toLocaleString('en-US')} available originals · {originals.batches.length.toLocaleString('en-US')} ZIPs · {originals.batches.filter(item=>item.comparison==='matching').length} verified locally.{originals.pendingCount>0&&` ${originals.pendingCount.toLocaleString('en-US')} pending uploads have no confirmed original.`}</p>
     {batch&&<>
      <div><label htmlFor={originalChoice}>Original-file ZIP</label><select id={originalChoice} value={String(batch.ordinal)} disabled={!view.canPrepare} onChange={event=>setOriginalSelection(event.target.value)}>{originals.batches.map(item=><option key={item.ordinal} value={String(item.ordinal)}>ZIP {item.ordinal} of {originals.batches.length} · {item.fileCount} {item.fileCount===1?'file':'files'} · {item.comparison}</option>)}</select></div>
      <button className="secondary" type="button" disabled={!view.canPrepare} onClick={()=>actions.prepareOriginalBatch?.(batch.ordinal)}>Prepare original-file ZIP</button>
      <p className="export-picked-file"><strong>{batch.fileName}</strong><span>{batch.bytes.toLocaleString('en-US')} original bytes</span></p>
      <div className="export-original-compare"><label htmlFor={originalCompare}>Compare downloaded original-file ZIPs</label><input id={originalCompare} type="file" accept=".zip,application/zip" multiple disabled={!view.canCompare} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';actions.compareOriginalBatches?.(files);}}/><p className="field-help">Select your saved ZIPs to check every original on this device. Missing or damaged batches stay available to prepare again. No selected files are uploaded.</p>{originals.extraCount>0&&<p>Unrelated selected files: {originals.extraCount}. Their contents were not read.</p>}</div>
     </>}
    </>}
   </section>}
   <details open={!view.currentFormat}><summary>Original export parts</summary>
   <div className="export-file-picker">
    <div>
     <label htmlFor={choice}>File to prepare</label>
     <select id={choice} aria-describedby={part?size:undefined} value={part?.partId??''} disabled={!view.canPrepare} onChange={event=>setSelected(event.target.value)}>{view.files.map(file=><option key={file.partId} value={file.partId}>{file.fileName}</option>)}</select>
    </div>
    <button className="secondary" type="button" disabled={!view.canPrepare||!part} onClick={()=>{if(part)actions.prepare(part.partId);}}>Prepare selected file</button>
    {part&&<p className="export-picked-file"><strong>{part.fileName}</strong><span id={size}>{part.bytes.toLocaleString('en-US')} bytes</span></p>}
   </div>
   </details>
   <div className="export-save-row" data-prepared={view.canRequestSave}>
    <div>{view.prepared?<><strong>Prepared file: {view.prepared.fileName}</strong><p>{view.prepared.bytes.toLocaleString('en-US')} bytes · {view.prepared.state==='prepared'?'Ready for up to one minute':'Save requested'}</p></>:<p>Prepare one file at a time. Save each prepared copy within one minute.</p>}</div>
    <button type="button" disabled={!view.canRequestSave} onClick={actions.requestSave}>{view.currentFormat?'Save file':'Request browser save'}</button>
   </div>
   <details open={!view.currentFormat}><summary>Compare original export parts</summary><section className="export-compare">
    <h4>Compare files</h4>
    <label htmlFor={local}>Select local copies to compare</label>
    <input id={local} type="file" multiple disabled={!view.canCompare} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';actions.compare(files);}}/>
    <p className="field-help">Crest checks the filename, size and checksum on this device.</p>
    {view.extraCount>0&&<p>Unrelated selected files: {view.extraCount}. Their contents were not read.</p>}
    <details className="export-inventory"><summary>File inventory · {view.files.length} parts · {view.files.filter(file=>file.comparison==='matching').length} matching</summary><ul aria-label="Local file comparison">{view.files.map(file=><li key={file.partId}><span>{file.fileName}</span><span className="export-state">{file.comparison}</span></li>)}</ul></details>
   </section></details>
  </>}
 </section>;
}
// The trusted product/API capability remains independently gated.
function ExportDownloadSession({jobId,onAccessDenied}:{jobId:string;onAccessDenied?:()=>void}){
 const [view,setView]=useState(initialSourceExportDownloadView),current=useRef<ReturnType<typeof createSourceExportDownloadController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createSourceExportDownloadController({jobId,change:setView,...onAccessDenied?{onAccessDenied}:{}});current.current=controller;
  const review=()=>controller.reviewOnReturn(),restore=(event:PageTransitionEvent)=>{if(event.persisted)review();};document.addEventListener('visibilitychange',review);window.addEventListener('pagehide',review);window.addEventListener('pageshow',restore);
  return()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',review);window.removeEventListener('pagehide',review);window.removeEventListener('pageshow',restore);};
 },[jobId,onAccessDenied]);
 async function action(kind:'load'|'continueLoading'|'prepare'|'compare'|'listLogical'|'prepareLogical'|'listOriginals'|'prepareOriginalBatch'|'compareOriginalBatches',value?:string|number|readonly File[]){const controller=current.current;if(!controller)return;if(kind==='prepare')await controller.prepare(value as string);else if(kind==='prepareLogical')await controller.prepareLogical(value as string);else if(kind==='compare')await controller.compare(value as readonly File[]);else if(kind==='prepareOriginalBatch')await controller.prepareOriginalBatch(value as number);else if(kind==='compareOriginalBatches')await controller.compareOriginalBatches(value as readonly File[]);else await controller[kind]();if(current.current===controller)status.current?.focus();}
 return <SourceExportDownloadControls view={view} statusRef={status} actions={{load:()=>{void action('load');},continueLoading:()=>{void action('continueLoading');},prepare:id=>{void action('prepare',id);},listLogical:()=>{void action('listLogical');},prepareLogical:name=>{void action('prepareLogical',name);},compare:files=>{void action('compare',files);},listOriginals:()=>{void action('listOriginals');},prepareOriginalBatch:ordinal=>{void action('prepareOriginalBatch',ordinal);},compareOriginalBatches:files=>{void action('compareOriginalBatches',files);},requestSave:()=>{current.current?.requestSave();status.current?.focus();}}}/>;
}
export function SourceExportDownloadScreen({jobId,onAccessDenied}:{jobId:string;onAccessDenied?:()=>void}){return <ExportDownloadSession key={jobId} jobId={jobId} {...onAccessDenied?{onAccessDenied}:{}}/>;}

