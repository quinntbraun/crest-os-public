'use client';
import {useEffect,useRef,useState} from 'react';
import type {OpeningDocument} from '../../../bookkeeping/opening-worksheet-contract';
import {parseOpeningDocumentReserve} from '../../../bookkeeping/opening-document-contract';
import type {OpeningDocumentReserve,OpeningDocumentStatus} from '../../../bookkeeping/opening-document-contract';
import {fileTypes} from '../../../files/validation-contract';
import type {FileType} from '../../../files/validation-contract';
import {authentication} from '../../../client/authentication';
import {financeAccounts} from '../../../client/finance-accounts';
import {openingDocuments} from '../../../client/opening-documents';
import styles from './screen.module.css';
type Pending=Readonly<{businessId:string;input:OpeningDocumentReserve;verifyId:string}>;
type Stored=Readonly<{businessId:string;record:OpeningDocumentStatus}>;
export function OpeningEvidencePicker({name,label,initial}:{name:string;label:string;initial?:OpeningDocument|null|undefined}){
 const [reference,setReference]=useState(initial?.reference??''),[fingerprint,setFingerprint]=useState(initial?.sha256??''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[file,setFile]=useState<File|null>(null),[enabled,setEnabled]=useState<boolean|null>(null),[writeReady,setWriteReady]=useState(false),[stored,setStored]=useState<Stored|null>(null),[pending,setPending]=useState<Pending|null>(null),[download,setDownload]=useState<{url:string;name:string}|null>(null);
 const generation=useRef(0),request=useRef<AbortController|null>(null),pendingSave=useRef<Pending|null>(null),fileInput=useRef<HTMLInputElement|null>(null),url=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function clearDownload(){if(timer.current)clearTimeout(timer.current);if(url.current)URL.revokeObjectURL(url.current);timer.current=null;url.current=null;setDownload(null);}
 useEffect(()=>{const release=()=>{if(timer.current)clearTimeout(timer.current);if(url.current)URL.revokeObjectURL(url.current);timer.current=null;url.current=null;},hide=()=>{release();setDownload(null);};window.addEventListener('pagehide',hide);return()=>{request.current?.abort();release();window.removeEventListener('pagehide',hide);};},[]);
 async function scope(signal:AbortSignal){const proof=await authentication.session(signal),context=await financeAccounts.context(signal,proof);signal.throwIfAborted();setEnabled(context.openingDocumentUploads===true);setWriteReady(context.writeState==='ready');return {proof,context};}
 function begin(){if(request.current)return null;const controller=new AbortController();request.current=controller;setBusy(true);clearDownload();return controller;}
 function finish(controller:AbortController){if(request.current===controller){request.current=null;setBusy(false);}}
 function available(businessId:string,record:OpeningDocumentStatus){pendingSave.current=null;setPending(null);setStored({businessId,record});setFile(null);if(fileInput.current)fileInput.current.value='';setMessage('Original stored in Crest. Your reference and fingerprint are retained.');}
 async function identify(selected:File|undefined){
  if(!selected||pendingSave.current)return;const controller=begin();if(!controller)return;const current=++generation.current;let bytes:ArrayBuffer|undefined;setMessage('Identifying document…');setFingerprint('');setStored(null);setFile(null);
  try{
   if(selected.size<1||selected.size>26214400)throw Error();bytes=await selected.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);if(current!==generation.current||controller.signal.aborted)return;
   const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''),nextReference=reference||Array.from(selected.name).slice(0,200).join('');setFingerprint(sha256);setReference(nextReference);setFile(selected);setMessage('Document identified. Keep the original with your business records.');
   try{const {proof,context}=await scope(controller.signal);if(!context.openingDocumentUploads)return;const found=await openingDocuments.find({reference:nextReference,sha256},proof,controller.signal);if(found)available(context.businessId,found);else setMessage(fileTypes.includes(selected.type as FileType)?'Document identified. Save its original in Crest or keep it with your business records.':'Document identified. This file type can be referenced; Crest stores PDF, JPEG, PNG and HEIC originals.');}catch{/* Identification remains useful when storage/sign-in is unavailable. */}
  }catch{if(!controller.signal.aborted)setMessage('Choose a document under 25 MB, or enter its existing fingerprint below.');}
  finally{if(bytes)new Uint8Array(bytes).fill(0);finish(controller);}
 }
 async function checkStored(){const controller=begin();if(!controller)return;setMessage('Checking for a stored original…');try{const {proof,context}=await scope(controller.signal);if(!context.openingDocumentUploads){setMessage('This workspace saves the reference and fingerprint only. Keep the original with your business records.');return;}const found=await openingDocuments.find({reference,sha256:fingerprint},proof,controller.signal);if(found)available(context.businessId,found);else{setStored(null);setMessage('No published original matches this reference and fingerprint. Keep your original file.');}}catch{if(!controller.signal.aborted)setMessage('The original could not be checked. Check sign-in and try again.');}finally{finish(controller);}}
 async function save(){
  const controller=begin();if(!controller)return;setMessage('Checking original save…');try{
   const {proof,context}=await scope(controller.signal);if(!context.openingDocumentUploads)throw Error();let plan=pendingSave.current;
   if(plan){if(plan.businessId!==context.businessId)throw Error();try{const status=await openingDocuments.status(plan.input,proof,controller.signal);if(status.state==='available'){available(context.businessId,status);return;}}catch{controller.signal.throwIfAborted();}}
   else{const found=await openingDocuments.find({reference,sha256:fingerprint},proof,controller.signal);if(found){available(context.businessId,found);return;}}
   if(context.writeState!=='ready'||!context.recoveryEpoch||!file)throw Error();
   if(!plan){plan=Object.freeze({businessId:context.businessId,input:parseOpeningDocumentReserve({documentId:crypto.randomUUID(),operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,reference,sha256:fingerprint,contentType:file.type,byteSize:file.size}),verifyId:crypto.randomUUID()});pendingSave.current=plan;setPending(plan);}
   if(plan.input.recoveryEpoch!==context.recoveryEpoch)throw Error();const reserved=await openingDocuments.reserve(plan.input,proof,controller.signal);if(reserved.state==='available'){available(context.businessId,reserved);return;}
   setMessage('Uploading original…');await openingDocuments.upload(plan.input,file,proof,controller.signal);setMessage('Checking and storing original…');const result=await openingDocuments.verify(plan.input,plan.verifyId,proof,controller.signal);available(context.businessId,result);
  }catch{if(!controller.signal.aborted)setMessage(pendingSave.current?'The save could not be confirmed. Keep this tab and original file, then retry this same save.':'The original could not be saved. Keep your file and check sign-in or whether saving is paused.');}finally{finish(controller);}
 }
 async function prepareDownload(){if(!stored)return;const controller=begin();if(!controller)return;let bytes:Uint8Array<ArrayBuffer>|undefined;setMessage('Preparing original download…');try{const {proof,context}=await scope(controller.signal);if(!context.openingDocumentUploads||context.businessId!==stored.businessId)throw Error();const original=await openingDocuments.original(stored.record,proof,controller.signal);bytes=original.bytes;controller.signal.throwIfAborted();const href=URL.createObjectURL(new Blob([bytes],{type:original.mediaType}));url.current=href;setDownload({url:href,name:original.fileName});timer.current=setTimeout(()=>{URL.revokeObjectURL(href);if(url.current===href){url.current=null;setDownload(null);}},60000);setMessage('Original checked. Use Download original to save it on this device.');}catch{if(!controller.signal.aborted)setMessage('The original could not be downloaded. Check sign-in and try again.');}finally{bytes?.fill(0);finish(controller);}}
 function changed(){generation.current++;setStored(null);setMessage('Reference changed. Check for a stored original or keep your file with your business records.');clearDownload();}
 const valid=/^[a-f0-9]{64}$/.test(fingerprint)&&reference.trim().length>0,canUpload=!!file&&fileTypes.includes(file.type as FileType);
 return <>
  <label htmlFor={name+'-file'}>{label} file</label><input ref={fileInput} id={name+'-file'} type="file" disabled={busy||!!pending} onChange={event=>{void identify(event.target.files?.[0]);}}/>
  <p>{stored?'The original is stored in Crest. Saving this form retains its reference and fingerprint.':'The reference and fingerprint can be saved here. The original stays with you until Crest confirms it is stored.'}</p>
  <label htmlFor={name+'-reference'}>Document reference</label><input id={name+'-reference'} name={name+'-reference'} required maxLength={200} value={reference} readOnly={busy||!!pending} onChange={event=>{setReference(event.target.value);changed();}}/>
  <input type="hidden" name={name+'-sha256'} value={fingerprint}/>
  <p role="status">{message||(fingerprint?'Document fingerprint available.':'Choose a document or use an existing fingerprint.')}</p>
  <div className={styles.openingDocumentActions}>
   {enabled===true&&canUpload&&!stored&&<button type="button" disabled={busy||(!pending&&!writeReady)} onClick={()=>{void save();}}>{pending?'Check and retry original save':'Save original in Crest'}</button>}
   {!pending&&valid&&enabled!==false&&!stored&&<button type="button" className="secondary" disabled={busy} onClick={()=>{void checkStored();}}>Check stored original</button>}
   {stored&&<button type="button" className="secondary" disabled={busy} onClick={()=>{void prepareDownload();}}>Prepare original download</button>}
   {download&&<a href={download.url} download={download.name} rel="noopener noreferrer">Download original</a>}
  </div>
  <details><summary>Use an existing document fingerprint</summary><label htmlFor={name+'-fingerprint'}>Document SHA-256 checksum</label><input id={name+'-fingerprint'} maxLength={64} autoCapitalize="none" spellCheck={false} readOnly={busy||!!pending} value={fingerprint} onChange={event=>{setFingerprint(event.target.value.toLowerCase());setFile(null);changed();}}/></details>
 </>;
}
