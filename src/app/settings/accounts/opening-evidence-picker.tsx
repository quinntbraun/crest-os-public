'use client';
import {useEffect,useRef,useState} from 'react';
import type {OpeningDocument} from '../../../bookkeeping/opening-worksheet-contract';
export function OpeningEvidencePicker({name,label,initial}:{name:string;label:string;initial?:OpeningDocument|null|undefined}){
 const [reference,setReference]=useState(initial?.reference??''),[fingerprint,setFingerprint]=useState(initial?.sha256??''),[reading,setReading]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
 async function identify(file:File|undefined){
  if(!file)return;const current=++generation.current;setMessage('');setReading(true);setFingerprint('');let bytes:ArrayBuffer|undefined;
  try{
   if(file.size<1||file.size>26214400)throw Error('FILE_SIZE_REQUIRED');bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);if(current!==generation.current)return;
   setFingerprint(Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''));setReference(value=>value||Array.from(file.name).slice(0,200).join(''));setMessage('Document identified. Keep the original with your business records.');
  }catch{if(current===generation.current)setMessage('Choose a document under 25 MB, or enter its existing fingerprint below.');}
  finally{if(bytes)new Uint8Array(bytes).fill(0);if(current===generation.current)setReading(false);}
 }
 return <>
  <label htmlFor={name+'-file'}>{label} file</label><input id={name+'-file'} type="file" onChange={event=>{void identify(event.target.files?.[0]);}}/>
  <p>Only the reference and document fingerprint are saved here. The original file stays with you.</p>
  <label htmlFor={name+'-reference'}>Document reference</label><input id={name+'-reference'} name={name+'-reference'} required maxLength={200} value={reference} onChange={event=>setReference(event.target.value)}/>
  <input type="hidden" name={name+'-sha256'} value={fingerprint}/>
  <p role="status">{reading?'Identifying document…':message|| (fingerprint?'Document fingerprint available.':'Choose a document or use an existing fingerprint.')}</p>
  <details><summary>Use an existing document fingerprint</summary><label htmlFor={name+'-fingerprint'}>Document SHA-256 checksum</label><input id={name+'-fingerprint'} maxLength={64} autoCapitalize="none" spellCheck={false} disabled={reading} value={fingerprint} onChange={event=>{setFingerprint(event.target.value.toLowerCase());setMessage('');}}/></details>
 </>;
}
