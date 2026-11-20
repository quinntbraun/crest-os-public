'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication} from '../../client/authentication';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {fileTypes} from '../../files/validation-contract';
import {exactCustomerObject as exact} from '../../customer/customer-contract';
import type {SupplierBillDraftRevision} from '../../bookkeeping/expenses/supplier-bill-draft-contract';

type Intent={originalId:string;reserveId:string;verifyId:string;file:File;type:string;retryUpload:boolean};
const prefix='/api/business/supplier-original/';
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function fileRequest(action:string,value:Record<string,unknown>|File,signal:AbortSignal,originalId?:string,type?:string){
 const {csrfToken}=await authentication.session(signal);
 const file=value instanceof File;
 const response=await fetch(prefix+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  referrerPolicy:'no-referrer',headers:{'x-crest-csrf':csrfToken,'content-type':file?type!:'application/json',
   ...(file?{'x-crest-supplier-original':originalId!}:{})},
  body:file?value:JSON.stringify(value),signal:AbortSignal.any([signal,AbortSignal.timeout(105000)])});
 if(!response.ok||!response.headers.get('cache-control')?.includes('no-store'))throw Error('SUPPLIER_ORIGINAL_UNCONFIRMED');
 return response;
}

export function SupplierOriginalUpload({context,bill,lockDraft,onAvailable,disabled}:{
 context:FinanceAccountContext;bill:SupplierBillDraftRevision;disabled:boolean;lockDraft:(locked:boolean)=>void;onAvailable:(id:string)=>void;
}){
 const active=useRef<AbortController|null>(null);
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const [pending,setPending]=useState<Intent|null>(null),[selection,resetSelection]=useState(0);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function attempt(input:Intent,onlyCheck=false){
  if(active.current||!context.recoveryEpoch)return;
  const request=new AbortController(),{signal}=request;active.current=request;
  setPending(input);setBusy(true);setStatus('Checking the original bill…');lockDraft(true);
  try{
   const {originalId}=input;
   const statusResponse=await fileRequest('status',{originalId},signal);
   const current:unknown=await statusResponse.json();
   const accept=(value:unknown)=>{
    if(!exact(value,['originalId','billId','billRevision','state','fileSha256'])||value.originalId!==originalId
     ||value.billId!==bill.billId||value.billRevision!==bill.revision)throw Error();
    if(value.state==='available'&&sha(value.fileSha256)){
     setPending(null);setFile(null);resetSelection(value=>value+1);setStatus('Original bill verified.');lockDraft(false);onAvailable(originalId);
     return true;
    }
    if(value.state!=='reserved'||value.fileSha256!==null)throw Error();
    return false;
   };
   const absent=exact(current,['originalId','state'])&&current.originalId===originalId&&current.state==='absent';
   if(!absent&&accept(current))return;
   if(onlyCheck){setStatus('The original is awaiting verification. Retry this upload to finish it.');return;}
   if(absent){
    const reserved=await fileRequest('reserve',{originalId,billId:bill.billId,billRevision:bill.revision,
     recoveryEpoch:context.recoveryEpoch,operationId:input.reserveId,contentType:input.type,byteSize:input.file.size},signal);
    if(accept(await reserved.json()))return;
   }
   if(input.retryUpload){
    setStatus('Uploading the original bill…');
    const uploaded=await fileRequest('upload',input.file,signal,originalId,input.type);
    const result:unknown=await uploaded.json();
    if(!exact(result,['originalId','state'])||result.originalId!==originalId||result.state!=='uploaded')throw Error();
    setPending({...input,retryUpload:false});
   }
   setStatus('Verifying the original and preparing its preview…');
   const verified=await fileRequest('verify',{originalId,operationId:input.verifyId},signal);
   if(!accept(await verified.json()))throw Error();
  }catch{if(!signal.aborted)setStatus('Verification could not be confirmed. Check this same upload or retry it.');}
  finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(disabled||pending||!file||context.writeState!=='ready')return;
  const type=file.type||(/\.heic$/i.test(file.name)?'image/heic':'');
  if(!fileTypes.some(allowed=>allowed===type)||file.size===0||file.size>25*1024*1024){
   setStatus('Choose a PDF, JPEG, PNG, or HEIC file up to 25 MB.');return;
  }
  void attempt({originalId:crypto.randomUUID(),reserveId:crypto.randomUUID(),verifyId:crypto.randomUUID(),file,type,retryUpload:true});
 }
 return <>
  <form aria-label="Verify supplier bill original" onSubmit={submit}>
   <fieldset className="expense-form" disabled={disabled||busy||!!pending||context.writeState!=='ready'}>
    <legend>Original supplier bill</legend>
    <label>Original bill file <input key={selection} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
     aria-describedby="supplier-original-formats" required onChange={event=>setFile(event.target.files?.[0]??null)}/></label>
    <p id="supplier-original-formats" className="field-help">PDF, JPEG, PNG, or HEIC, up to 25 MB.</p>
    <button type="submit" disabled={!file}>Upload and verify original</button>
   </fieldset>
  </form>
  <p role="status">{status}</p>
  {pending&&<>
   <button type="button" disabled={busy} onClick={()=>void attempt(pending,true)}>Check original upload</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>void attempt(pending)}>Retry original upload</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>{
    setPending(null);setFile(null);resetSelection(value=>value+1);lockDraft(false);setStatus('Choose another original bill file.');
   }}>Choose another file</button>
  </>}
 </>;
}

export function SupplierOriginalPreview({id}:{id:string}){
 const active=useRef<AbortController|null>(null),resource=useRef<string|null>(null);
 const [url,setUrl]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>{
  active.current?.abort();
  if(resource.current)URL.revokeObjectURL(resource.current);
 },[]);
 async function load(){
  if(active.current)return;
  const request=new AbortController(),{signal}=request;active.current=request;setBusy(true);setStatus('Loading the verified preview…');
  try{
   const response=await fileRequest('preview',{originalId:id},signal);
   const size=Number(response.headers.get('content-length')),expected=response.headers.get('x-crest-sha256');
   if(response.headers.get('content-type')!=='image/jpeg'||!Number.isSafeInteger(size)||size<1||size>8*1024*1024||!sha(expected))throw Error();
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength!==size)throw Error();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
   signal.throwIfAborted();
   if(digest!==expected)throw Error();
   const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
   if(resource.current)URL.revokeObjectURL(resource.current);
   resource.current=objectUrl;setUrl(objectUrl);setStatus('Verified preview loaded.');
  }catch{if(!signal.aborted)setStatus('The verified preview could not be opened.');}
  finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 return <div>
  <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>View verified bill preview</button>
  <p role="status">{status}</p>
  {url&&<img src={url} alt="Verified supplier bill preview" className="supplier-original-preview"/>}
 </div>;
}
