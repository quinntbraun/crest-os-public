'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication} from '../client/authentication';
import {customers} from '../client/customers';
import {vehicles} from '../client/vehicles';
import type {Customer} from '../customer/customer-contract';
import type {Vehicle} from '../customer/vehicle-contract';

// Explicit single-record retrieval through the existing fresh protected reads.
// This is not the complete source-export/backup workflow and grants no access.
export function SavedRecordDownload({kind,record,disabled}:{kind:'customer'|'vehicle';record:Customer|Vehicle;disabled:boolean}){
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),request=useRef<AbortController|null>(null),alive=useRef(false);
  useEffect(()=>{alive.current=true;const hide=()=>{if(document.visibilityState==='hidden')request.current?.abort();};document.addEventListener('visibilitychange',hide);return ()=>{alive.current=false;request.current?.abort();document.removeEventListener('visibilitychange',hide);};},[]);
  async function download(){
    if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('Checking current record access…');
    let url:string|null=null;const anchor=document.createElement('a');
    try{
      const proof=await authentication.session(controller.signal),result=kind==='customer'
        ?await customers.history(record.business_id,{customerId:record.id,afterVersion:'0',pageSize:20},proof,controller.signal)
        :await vehicles.history(record.business_id,{vehicleId:record.id,afterVersion:'0',pageSize:20},proof,controller.signal);
      if(result.state!=='found'||controller.signal.aborted)throw Error();
      const current='customer' in result?result.customer:result.vehicle;
      const contents=JSON.stringify({schemaVersion:1,scope:`saved_${kind}_and_first_history_page`,completeCrestExport:false,completeBackup:false,unsavedDraftIncluded:false,historyHasMore:result.hasMore,record:current,history:result.history},null,2)+'\n';
      url=URL.createObjectURL(new Blob([contents],{type:'application/json;charset=utf-8'}));anchor.href=url;anchor.download=`crest-${kind}-record.json`;document.body.append(anchor);anchor.click();
      setMessage('Download requested. Check your browser’s downloads to confirm the file.');
    }catch{if(!controller.signal.aborted)setMessage('Current record access or the download could not be confirmed. No file was requested. Your saved record has not been changed.');}
    finally{anchor.remove();if(url){const created=url;setTimeout(()=>URL.revokeObjectURL(created),1000);}if(request.current===controller){request.current=null;if(alive.current){setBusy(false);if(controller.signal.aborted)setMessage('Download canceled while away. Check the record again before requesting a new file.');}}}
  }
  return <div className="record-download"><button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void download()}>Download saved {kind} (JSON)</button><p className="field-help">Checks access again, then retrieves the current saved record and its first 20 history entries. Unsaved edits are excluded. The file states whether more history exists. This is not a complete business export or backup.</p>{message&&<p role="status" aria-label="Record download status">{message}</p>}</div>;
}
