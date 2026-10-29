'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {quotes} from '../../client/quotes';
import type {StoredQuoteFamily,StoredQuoteRevision} from '../../commercial/quote-storage-contract';

// Explicit private record retrieval through genuine current authorization.
// The customer document is separate; this file includes internal retained data.
export function QuoteRecordDownload({row,disabled}:{row:Readonly<{family:StoredQuoteFamily;revision:StoredQuoteRevision}>;disabled:boolean}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),request=useRef<AbortController|null>(null),alive=useRef(false);
 useEffect(()=>{alive.current=true;const hide=()=>{if(document.visibilityState==='hidden')request.current?.abort();};document.addEventListener('visibilitychange',hide);return ()=>{alive.current=false;request.current?.abort();document.removeEventListener('visibilitychange',hide);};},[]);
 async function download(){
  if(request.current)return;const c=new AbortController();request.current=c;setBusy(true);setMessage('Checking current quote access…');let url:string|null=null,attempted=false;const a=document.createElement('a');
  try{
   const proof=await authentication.session(c.signal),result=await quotes.history(row.family.business_id,{familyId:row.family.id,revisionId:row.revision.id,afterVersion:'0',pageSize:5},proof,c.signal);
   if('state'in result||c.signal.aborted||result.family.version!==row.family.version||result.revision.version!==row.revision.version||result.family.current_revision_id!==row.revision.id)throw Error();
   const contents=JSON.stringify({schemaVersion:1,scope:'saved_quote_draft_and_first_history_page',privateInternalDataIncluded:true,completeCrestExport:false,completeBackup:false,unsavedDraftIncluded:false,historyHasMore:result.hasMore,family:result.family,revision:result.revision,items:result.items,history:result.history},null,2)+'\n';
   url=URL.createObjectURL(new Blob([contents],{type:'application/json;charset=utf-8'}));a.href=url;a.download='crest-private-quote-draft.json';document.body.append(a);attempted=true;a.click();if(alive.current)setMessage('Download requested. Check your browser’s downloads to confirm the file.');
  }catch{if(alive.current&&!c.signal.aborted)setMessage(attempted?'The download could not be confirmed. Check your browser’s downloads before trying again.':'Access or the current version could not be confirmed. Reload saved quotes before requesting a file. No file was requested.');}
  finally{a.remove();if(url){const created=url;setTimeout(()=>URL.revokeObjectURL(created),1000);}if(request.current===c){request.current=null;if(alive.current){setBusy(false);if(c.signal.aborted)setMessage('Download canceled while away. Reload the quote before requesting a file.');}}}
 }
 return <div className="record-download"><button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void download()}>Download saved draft (private JSON)</button><p className="field-help">Includes internal notes, saved source records and the first five history entries. Keep this file private. Unsaved edits are excluded; the file states whether more history exists. This is not a complete business export or backup.</p>{message&&<p role="status" aria-label="Quote download status">{message}</p>}</div>;
}
