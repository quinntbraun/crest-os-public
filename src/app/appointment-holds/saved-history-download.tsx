'use client';
import {useEffect,useRef,useState} from 'react';
import {requireHold as check} from '../../operations/appointment-hold-contract';
import type {StoredHold} from '../../operations/appointment-hold-contract';
export function SavedHoldHistoryDownload({head,disabled,archive}:{head:StoredHold;disabled:boolean;archive:()=>Promise<Uint8Array<ArrayBuffer>|undefined>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),alive=useRef(false),active=useRef(false),url=useRef<string|null>(null);
 function revoke(){if(url.current){URL.revokeObjectURL(url.current);url.current=null;}}
 useEffect(()=>{alive.current=true;const clear=()=>{revoke();},hidden=()=>{if(document.visibilityState==='hidden')clear();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);return()=>{alive.current=false;clear();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);};},[]);
 async function download(){
  if(disabled||active.current)return;active.current=true;setBusy(true);setMessage('Checking saved proposal history…');let bytes:Uint8Array<ArrayBuffer>|undefined,requested=false;
  const live=()=>check(alive.current&&active.current);
  try{
   bytes=await archive();live();check(bytes);
   revoke();const copy=url.current=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');link.href=copy;link.download='crest-proposal-history.zip';link.hidden=true;document.body.append(link);try{requested=true;link.click();}finally{link.remove();setTimeout(()=>{if(url.current===copy)revoke();},1000);}
   setMessage('Saved history through version '+head.sequence+' requested. Unsaved draft changes are excluded.');
  }catch{if(alive.current&&active.current)setMessage(requested?'Check your browser’s downloads before requesting another file.':'No file was requested. Load the current saved proposal and try again; exports are limited to 1,000 versions and 8 MiB.');}
  finally{bytes?.fill(0);if(!requested)revoke();active.current=false;if(alive.current)setBusy(false);}
 }
 return <section aria-label="Saved proposal export"><button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void download()}>Download saved proposal history</button><p role="status" aria-label="Proposal export status">{message}</p><p className="field-help">CSV, original JSON and decoding metadata for this saved proposal only. This is not a whole-business backup.</p></section>;
}
