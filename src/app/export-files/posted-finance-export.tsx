'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {postedFinanceExportLimit,postedFinanceExportName,postedFinanceExportPath,postedFinanceExportProfile,excessReceiptExportProfile,excessReturnExportProfile,tipReturnExportProfile} from '../../security/posted-finance-owner-export-contract';

type Phase='initial'|'ready'|'preparing'|'prepared'|'requested'|'failed';
const messages:Record<Phase,string>={
 initial:'',
 ready:'',
 preparing:'Preparing and checking the CSV package…',
 prepared:'The package is ready. Save it within one minute.',
 requested:'Save requested. Check your browser’s downloads for the ZIP.',
 failed:'Crest could not prepare this export. Check your sign-in and recovery status, then try again.',
};

async function privateRequest(path:string,signal:AbortSignal){
 const proof=await authentication.session(signal);
 const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
  headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:'{}',signal});
 if(!response.ok||!response.headers.get('cache-control')?.split(',').some(part=>part.trim()==='no-store'))throw Error();
 return response;
}

async function verifiedArchive(response:Response,signal:AbortSignal){
 const declared=response.headers.get('content-length')??'',length=Number(declared),expected=response.headers.get('x-crest-sha256');
 if(response.headers.get('content-type')!=='application/zip'||response.headers.get('content-disposition')!=='attachment; filename="'+postedFinanceExportName+'"'
  ||!/^[1-9][0-9]*$/.test(declared)||!Number.isSafeInteger(length)||length>postedFinanceExportLimit||!/^[a-f0-9]{64}$/.test(expected??'')
  ||!response.body)throw Error();
 const bytes=new Uint8Array(length),reader=response.body.getReader();
 let offset=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   if(!value.length||offset+value.length>length)throw Error();
   bytes.set(value,offset);
   offset+=value.length;
  }
  if(offset!==length||signal.aborted)throw Error();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==expected||signal.aborted)throw Error();
  return new Blob([bytes],{type:'application/zip'});
 }finally{
  bytes.fill(0);
  void reader.cancel().catch(()=>undefined);
  reader.releaseLock();
 }
}

export function PostedFinanceExport(){
 const [available,setAvailable]=useState(false),[phase,setPhase]=useState<Phase>('initial');
 const operation=useRef<AbortController|null>(null),prepared=useRef<{url:string;timer:ReturnType<typeof setTimeout>}|null>(null);
 function discard(){
  operation.current?.abort();
  operation.current=null;
  const previous=prepared.current;
  prepared.current=null;
  if(previous){clearTimeout(previous.timer);URL.revokeObjectURL(previous.url);}
 }
 useEffect(()=>{
  let mounted=true;
  async function check(){
   const current=new AbortController();
   operation.current=current;
   try{
    const response=await privateRequest(postedFinanceExportPath+'/context',AbortSignal.any([current.signal,AbortSignal.timeout(20000)]));
    const result:unknown=await response.json();
    if(mounted&&!current.signal.aborted&&result&&typeof result==='object'&&'profile' in result
      &&(result.profile===postedFinanceExportProfile||result.profile===excessReceiptExportProfile
       ||result.profile===excessReturnExportProfile||result.profile===tipReturnExportProfile)){
     setAvailable(true);
     setPhase('ready');
    }
   }catch{/* The optional download stays hidden when its private route is unavailable. */}
   finally{if(operation.current===current)operation.current=null;}
  }
  function leave(){
   discard();
   setAvailable(false);
   setPhase('initial');
  }
  function visibility(){
   if(document.visibilityState!=='visible')leave();
   else if(!operation.current)void check();
  }
  function restore(event:PageTransitionEvent){if(event.persisted)visibility();}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',leave);
  window.addEventListener('pageshow',restore);
  if(document.visibilityState==='visible')void check();
  return()=>{
   mounted=false;
   discard();
   document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('pagehide',leave);
   window.removeEventListener('pageshow',restore);
  };
 },[]);
 async function prepare(){
  if(operation.current)return;
  discard();
  const current=new AbortController();
  operation.current=current;
  setPhase('preparing');
  const signal=AbortSignal.any([current.signal,AbortSignal.timeout(60000)]);
  try{
   const blob=await verifiedArchive(await privateRequest(postedFinanceExportPath,signal),signal);
   if(current.signal.aborted)return;
   const url=URL.createObjectURL(blob);
   const timer=setTimeout(()=>{discard();setPhase('ready');},60000);
   prepared.current={url,timer};
   setPhase('prepared');
  }catch{if(!current.signal.aborted)setPhase('failed');}
  finally{if(operation.current===current)operation.current=null;}
 }
 function save(){
  const current=prepared.current;
  if(!current||phase!=='prepared')return;
  const anchor=document.createElement('a');
  anchor.href=current.url;
  anchor.download=postedFinanceExportName;
  anchor.rel='noopener noreferrer';
  anchor.hidden=true;
  document.body.append(anchor);
  try{anchor.click();setPhase('requested');}
  catch{discard();setPhase('failed');}
  finally{anchor.remove();}
 }
 if(!available)return null;
 return <section className="export-files" aria-label="Posted finance export" aria-busy={phase==='preparing'}>
  <h2>Posted finance CSV</h2>
  <p>Download a private ZIP with posted invoice, payment, refund and expense records, journal entries and source history. Receipt files, customer and account directories, and a full business backup are outside this package.</p>
  <button type="button" disabled={phase==='preparing'} onClick={()=>void prepare()}>Prepare posted finance CSV</button>
  {phase==='prepared'&&<button type="button" onClick={save}>Save ZIP</button>}
  {phase==='preparing'&&<button className="secondary" type="button" onClick={()=>{discard();setPhase('ready');}}>Cancel preparation</button>}
  <p role="status" aria-live="polite">{messages[phase]}</p>
 </section>;
}
