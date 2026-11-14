'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {scheduling} from '../../client/scheduling';
import {postScheduling} from '../../client/scheduling-transport';
import {parseCollectionPage,parsePickupReturnPage} from '../../operations/dropoff-collection-contract';
import type {CollectionPage,CustodyQueueState} from '../../operations/dropoff-collection-contract';

type Loaded=Readonly<{businessId:string;binding:string;rows:CollectionPage<CustodyQueueState>['rows'];hasMore:boolean}>;
type View=Readonly<{loaded:Loaded|null;busy:boolean;signedOut:boolean;message:string}>;

const initialViews:Readonly<Record<'pickup'|'dropoff',View>>={
 pickup:{loaded:null,busy:false,signedOut:false,message:'Load vehicles still in Crest custody after completed or cancelled work.'},
 dropoff:{loaded:null,busy:false,signedOut:false,message:'Load vehicles awaiting collection or return across all dates.'},
};

const states:Readonly<Record<CustodyQueueState,string>>={
 awaiting_collection:'Awaiting collection',
 return_required:'Return required',
 awaiting_return:'Ready to plan return travel',
 returning:'Return trip in progress',
 ready_for_handoff:'Arrived · Ready for handoff',
 return_stopped:'Return trip stopped · Arrange another trip',
 return_failed:'Handoff unsuccessful · Arrange another trip',
};
export function VehicleCustodyQueue({timezone,kind}:{timezone:string;kind:'pickup'|'dropoff'}){
 const pickup=kind==='pickup',title=pickup?'Vehicles awaiting return':'Vehicle collections';
 const action=pickup?'vehicles awaiting return':'vehicle collections';
 const initial=initialViews[kind];
 const [view,setView]=useState(initial),request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const dates=new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
 const clear=useCallback(()=>{request.current?.abort();request.current=null;setView(initial);},[initial]);
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{
   request.current?.abort();request.current=null;
   document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[clear]);
 async function load(more=false){
  if(request.current)return;
  const previous=more?view.loaded:null,last=previous?.rows.at(-1);
  if(more&&(!last||!previous?.hasMore))return;
  const active=new AbortController();request.current=active;
  setView({loaded:previous,busy:true,signedOut:false,message:'Loading '+action+'…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   if((pickup?workspace.pickupReturnsAvailable:workspace.dropoffCustodyAvailable)!==true||previous&&
    (previous.businessId!==workspace.context.businessId||previous.binding!==workspace.binding))throw Error();
   const cursor={afterReceivedAt:last?.receivedAt??null,afterCaseId:last?.caseId??null};
   const response=await postScheduling(pickup?'pickup-returns':'custody-collections',cursor,proof,active.signal);
   if(response.status!==200)throw Error();
   const parse=pickup?parsePickupReturnPage:parseCollectionPage;
   const page=parse(response.value,workspace.context.businessId,cursor);
   const rows=[...(previous?.rows??[]),...page.rows];
   if(new Set(rows.map(row=>row.caseId)).size!==rows.length)throw Error();
   if(!active.signal.aborted)setView({busy:false,signedOut:false,message:rows.length?(pickup?'Saved vehicles awaiting return loaded.':'Saved vehicle collections loaded.'):
    (pickup?'No pickup vehicles are awaiting return.':'No vehicles are awaiting collection or return.'),
    loaded:{businessId:page.businessId,binding:workspace.binding,rows,hasMore:page.hasMore}});
  }catch(error){
   if(!active.signal.aborted){
    const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
    setView({...initial,signedOut,message:signedOut?'Sign in again to review '+action+'.':title+' could not be verified. Reload to try again.'});
   }
  }finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>{title}</summary>
  <section aria-label={title} aria-busy={view.busy}>
   <p className="field-help">{pickup?'All dates · Vehicles remain here until a handoff is saved.':
    'All dates · Completed work awaiting collection and cancelled jobs requiring return.'}</p>
   <p role="status" tabIndex={-1} ref={status}>{view.message}</p>
   {view.signedOut?<a href="/sign-in">Sign in</a>:<button type="button" className={pickup?'secondary':undefined} disabled={view.busy} onClick={()=>void load()}>
    {(view.loaded?'Reload ':'Load ')+action}</button>}
   {view.loaded&&view.loaded.rows.length>0&&<ul className="customer-list">{view.loaded.rows.map(row=><li key={row.caseId}>
    <p><strong>{row.customerName}</strong> · {row.vehicleLabel}</p>

    <p>{states[row.state]}</p>
    <p className="field-help">{pickup?'Picked up':'Received'} <time dateTime={row.receivedAt}>{dates.format(new Date(row.receivedAt))}</time></p>
    <a className={pickup?'primary-action':undefined} href={'/schedule?job='+encodeURIComponent(row.jobId)+(pickup?'&vehicle='+encodeURIComponent(row.jobVehicleId):'')}
     aria-label={pickup?'Open return for '+row.vehicleLabel:undefined}>{pickup?'Open return':'Open saved job and handoff'}</a>
   </li>)}</ul>}
   {view.loaded?.hasMore&&<button type="button" disabled={view.busy} onClick={()=>void load(true)}>Load more {action}</button>}
  </section>
 </details>;
}
