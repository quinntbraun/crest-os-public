'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {services} from '../../client/services';
import type {StoredService,StoredServiceContent} from '../../commercial/service-storage-contract';

export function ServiceRecordDownload({row,disabled}:{row:Readonly<{service:StoredService;content:StoredServiceContent}>;disabled:boolean}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),request=useRef<AbortController|null>(null),alive=useRef(false);
 useEffect(()=>{alive.current=true;const hide=()=>{if(document.visibilityState==='hidden')request.current?.abort();};document.addEventListener('visibilitychange',hide);return ()=>{alive.current=false;request.current?.abort();document.removeEventListener('visibilitychange',hide);};},[]);
 async function download(){
  if(request.current)return;const c=new AbortController();request.current=c;setBusy(true);setMessage('Checking current service access…');let url:string|null=null,attempted=false;const a=document.createElement('a');
  try{
   const proof=await authentication.session(c.signal),result=await services.history(row.service.business_id,{serviceId:row.service.id,afterRevision:'0',pageSize:20},proof,c.signal);
   if('state' in result||c.signal.aborted||result.service.version!==row.service.version||result.service.current_version_id!==row.content.id)throw Error();
   const contents=JSON.stringify({schemaVersion:1,scope:'saved_service_and_first_history_page',completeCrestExport:false,completeBackup:false,unsavedDraftIncluded:false,historyHasMore:result.hasMore,record:result.service,content:row.content,history:result.history},null,2)+'\n';
   url=URL.createObjectURL(new Blob([contents],{type:'application/json;charset=utf-8'}));a.href=url;a.download='crest-service-record.json';document.body.append(a);attempted=true;a.click();if(alive.current)setMessage('Download requested. Check your browser’s downloads to confirm the file.');
  }catch{if(alive.current&&!c.signal.aborted)setMessage(attempted?'The download could not be confirmed. Check your browser’s downloads before trying again.':'Access or the current revision could not be confirmed. Reload saved services before requesting a file. No file was requested.');}
  finally{a.remove();if(url){const created=url;setTimeout(()=>URL.revokeObjectURL(created),1000);}if(request.current===c){request.current=null;if(alive.current){setBusy(false);if(c.signal.aborted)setMessage('Download canceled while away. Reload the service before requesting a file.');}}}
 }
 return <div className="record-download"><button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void download()}>Download saved service (JSON)</button><p className="field-help">Checks access and revision again. Includes the saved definition and first 20 history entries; unsaved edits are excluded. The file states whether more history exists. This is not a complete business export or backup.</p>{message&&<p role="status" aria-label="Service download status">{message}</p>}</div>;
}
