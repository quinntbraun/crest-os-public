'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createAddressCustomerLookup,initialAddressCustomerLookup} from '../../client/address-customer-lookup';
export function AddressCustomerChooser(){
 const [view,setView]=useState(initialAddressCustomerLookup),[query,setQuery]=useState(''),[archived,setArchived]=useState(false);
 const controller=useRef<ReturnType<typeof createAddressCustomerLookup>|null>(null),inputId=useId();
 useEffect(()=>{
  const current=createAddressCustomerLookup({change:setView});controller.current=current;
  function clear(){setQuery('');setArchived(false);current.suspend();}
  const hidden=()=>{if(document.visibilityState==='hidden')clear();},restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restore);
  if(document.visibilityState==='hidden')clear();
  return()=>{current.dispose();controller.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);};
 },[]);
 return <section className="address-customer-chooser" aria-label="Choose an address customer" aria-busy={view.busy}>
  <div className="address-chooser-intro"><h2>Choose a customer</h2><p>Search by name, phone or email to open saved locations and arrival instructions.</p></div>
  <div className="address-chooser-search">
   <form aria-label="Find an address customer" onSubmit={event=>{event.preventDefault();void controller.current?.search(query,archived);}}>
    <label htmlFor={inputId}>Customer name, phone or email</label>
    <div className="address-chooser-query"><input id={inputId} type="search" value={query} autoComplete="off" maxLength={400} disabled={view.busy} onChange={event=>setQuery(event.target.value)}/><button type="submit" disabled={view.busy}>Find customers</button></div>
    <label className="address-chooser-archived"><input type="checkbox" checked={archived} disabled={view.busy} onChange={event=>setArchived(event.target.checked)}/>Include archived customers</label>
   </form>
   <p role="status" aria-label="Address customer search status">{view.message}</p>
   {view.items.length>0&&<ul className="address-chooser-results">{view.items.map(item=><li key={item.id}><a href={'/addresses?customer='+encodeURIComponent(item.id)} aria-label={'Open addresses for '+item.name}><span><strong>{item.name}</strong><small>{item.contact||'Contact details not recorded'}</small>{item.archived&&<small>Archived customer</small>}</span><span aria-hidden="true">→</span></a></li>)}</ul>}
   {view.hasMore&&<button type="button" className="secondary" disabled={view.busy||query!==view.search||archived!==view.includeArchived} onClick={()=>void controller.current?.search(query,archived,true)}>Next customer results</button>}
   <a className="text-action" href="/customers">Open Customers</a>
  </div>
 </section>;
}
