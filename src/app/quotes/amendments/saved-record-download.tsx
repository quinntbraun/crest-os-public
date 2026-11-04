'use client';
import {useEffect,useRef,useState} from 'react';
export function SavedAmendmentDownload({disabled,archive}:{disabled:boolean;archive:()=>Promise<Uint8Array<ArrayBuffer>|undefined>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),alive=useRef(false),active=useRef(false),url=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function release(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;if(url.current){URL.revokeObjectURL(url.current);url.current=null;}}
 useEffect(()=>{alive.current=true;const hidden=()=>{if(document.visibilityState==='hidden')release();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',release);return()=>{alive.current=false;release();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',release);};},[]);
 async function download(){
  if(disabled||active.current)return;active.current=true;setBusy(true);setMessage('Checking the complete saved revision history…');let bytes:Uint8Array<ArrayBuffer>|undefined,requested=false;
  try{bytes=await archive();if(!alive.current||!bytes)throw Error();release();url.current=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const link=document.createElement('a');link.href=url.current;link.download='crest-amendment-record.zip';link.hidden=true;document.body.append(link);try{requested=true;link.click();}finally{link.remove();}timer.current=setTimeout(release,1000);setMessage('Download requested. Check your browser’s downloads to confirm the file.');}
  catch{if(alive.current){release();setMessage(requested?'The file request could not be confirmed. Check browser downloads before requesting another copy.':'No file was requested. Reload the saved amendment and check its current history before trying again.');}}
  finally{bytes?.fill(0);active.current=false;if(alive.current)setBusy(false);}
 }
 return <section aria-label="Private amendment record"><details><summary>Download a private saved record</summary><button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void download()}>Download saved amendment record</button><p className="field-help">Private CSV, original JSON and checksums, including all retained revision events through this saved version. Unsaved changes are excluded. Includes internal notes and contact data; keep the file private. This selected-record copy excludes other source tables and is not a complete business export or recoverable backup. Limited to 1,000 versions and 8 MiB.</p>{message&&<p aria-live="polite">{message}</p>}</details></section>;
}
