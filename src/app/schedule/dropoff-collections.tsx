'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {scheduling} from '../../client/scheduling';
import {postScheduling} from '../../client/scheduling-transport';
import {parseCollectionPage} from '../../operations/dropoff-collection-contract';
import type {CollectionPage} from '../../operations/dropoff-collection-contract';

type Loaded=Readonly<{businessId:string;binding:string;rows:CollectionPage['rows'];hasMore:boolean}>;
type View=Readonly<{loaded:Loaded|null;busy:boolean;signedOut:boolean;message:string}>;
const initial:View={loaded:null,busy:false,signedOut:false,message:'Load vehicles awaiting collection or return across all dates.'};
export function DropoffCollections({timezone}:{timezone:string}){
 const [view,setView]=useState(initial),request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const clear=()=>{request.current?.abort();request.current=null;setView(initial);};
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{
   request.current?.abort();request.current=null;
   document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);
 async function load(more=false){
  if(request.current)return;
  const previous=more?view.loaded:null,last=previous?.rows.at(-1);
  if(more&&(!last||!previous?.hasMore))return;
  const active=new AbortController();request.current=active;
  setView({loaded:previous,busy:true,signedOut:false,message:'Loading vehicle collections…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   if(workspace.dropoffCustodyAvailable!==true||previous&&
    (previous.businessId!==workspace.context.businessId||previous.binding!==workspace.binding))throw Error();
   const cursor={afterReceivedAt:last?.receivedAt??null,afterCaseId:last?.caseId??null};
   const response=await postScheduling('custody-collections',cursor,proof,active.signal);
   if(response.status!==200)throw Error();
   const page=parseCollectionPage(response.value,workspace.context.businessId,cursor);
   const rows=[...(previous?.rows??[]),...page.rows];
   if(new Set(rows.map(row=>row.caseId)).size!==rows.length)throw Error();
   if(!active.signal.aborted)setView({busy:false,signedOut:false,message:rows.length?'Saved vehicle collections loaded.':'No vehicles are awaiting collection or return.',
    loaded:{businessId:page.businessId,binding:workspace.binding,rows,hasMore:page.hasMore}});
  }catch(error){
   if(!active.signal.aborted){
    const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
    setView({...initial,signedOut,message:signedOut?'Sign in again to review vehicle collections.':'Vehicle collections could not be verified. Reload to try again.'});
   }
  }finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Vehicle collections</summary>
  <section aria-label="Vehicle collections" aria-busy={view.busy}>
   <p className="field-help">All dates · Completed work awaiting collection and cancelled jobs requiring return.</p>
   <p role="status" tabIndex={-1} ref={status}>{view.message}</p>
   {view.signedOut?<a href="/sign-in">Sign in</a>:<button type="button" disabled={view.busy} onClick={()=>void load()}>
    {view.loaded?'Reload vehicle collections':'Load vehicle collections'}</button>}
   {view.loaded&&view.loaded.rows.length>0&&<ul className="customer-list">{view.loaded.rows.map(row=><li key={row.caseId}>
    <p><strong>{row.customerName}</strong> · {row.vehicleLabel}</p>
    <p>{row.state==='return_required'?'Return required':'Awaiting collection'}</p>
    <p className="field-help">Received <time dateTime={row.receivedAt}>{new Intl.DateTimeFormat('en-US',{
     timeZone:timezone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'
    }).format(new Date(row.receivedAt))}</time></p>
    <a href={'/schedule?job='+encodeURIComponent(row.jobId)}>Open saved job and handoff</a>
   </li>)}</ul>}
   {view.loaded?.hasMore&&<button type="button" disabled={view.busy} onClick={()=>void load(true)}>Load more vehicle collections</button>}
  </section>
 </details>;
}
