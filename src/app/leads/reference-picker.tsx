'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication} from '../../client/authentication';
import {customers} from '../../client/customers';
import {leadSources} from '../../client/lead-sources';
import {vehicles} from '../../client/vehicles';
type Item=Readonly<{id:string;label:string;detail:string}>;
type View={items:readonly Item[];busy:boolean;search:string;more:boolean;message:string;chosen:Item|null};
const empty:View={items:[],busy:false,search:'',more:false,message:'Search and explicitly choose an existing record, or leave it unlinked.',chosen:null};
export function ReferencePicker({businessId,kind,value,disabled,change}:{businessId:string;kind:'customer'|'source'|'vehicle';value:string|null;disabled:boolean;change:(id:string|null)=>void}){
 const [view,setView]=useState<View>(empty),active=useRef<AbortController|null>(null),alive=useRef(false),input=useId(),label=kind==='customer'?'Customer':kind==='vehicle'?'Vehicle':'Source';
 useEffect(()=>{alive.current=true;const hide=()=>{if(document.visibilityState==='hidden'){active.current?.abort();active.current=null;setView(empty);}};document.addEventListener('visibilitychange',hide);return()=>{alive.current=false;active.current?.abort();active.current=null;document.removeEventListener('visibilitychange',hide);};},[businessId,kind]);
 async function search(text:string,more=false){
  if(disabled||active.current||[...text].length>200||more&&(!view.more||text!==view.search))return;
  const work=new AbortController();active.current=work;const afterId=more?view.items.at(-1)?.id??null:null;
  setView(v=>({...v,items:[],busy:true,more:false,message:'Checking existing '+label.toLowerCase()+' records…'}));
  try{
   const proof=await authentication.session(work.signal);
   const result=kind==='customer'?await customers.list(businessId,{search:text,afterId,includeArchived:true,pageSize:10},proof,work.signal):kind==='vehicle'?await vehicles.list(businessId,{search:text,afterId,includeArchived:true,pageSize:10},proof,work.signal):await leadSources.list(businessId,{search:text,afterId,includeInactive:true,pageSize:10},proof,work.signal);
   const items:Item[]='customers'in result?result.customers.map(row=>({id:row.id,label:row.display_name,detail:[row.phone_raw,row.email_raw,row.archived_at?'Archived customer':null].filter(Boolean).join(' · ')})):'vehicles'in result?result.vehicles.map(row=>({id:row.id,label:row.label,detail:[row.year,row.make,row.model,row.archived_at?'Archived vehicle':null].filter(value=>value!==null).join(' · ')})):result.leadSources.map(row=>({id:row.id,label:row.label,detail:row.kind+(row.active?'':' · Inactive source')}));
   if(!alive.current||work.signal.aborted||active.current!==work)return;
   setView(v=>({...v,items,busy:false,search:text,more:result.hasMore,message:items.length?'Choose the exact existing record. Shared names or contact details do not merge records.':'No matching records on this page.'}));
  }catch{if(alive.current&&!work.signal.aborted&&active.current===work)setView(v=>({...v,items:[],busy:false,more:false,message:label+' lookup could not be verified. The current link has been kept.'}));}
  finally{if(active.current===work)active.current=null;}
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();void search(String(new FormData(event.currentTarget).get('reference-search')??''));}
 return <section aria-label={'Choose '+label.toLowerCase()} aria-busy={view.busy}>
  <p>{value===null?'No '+label.toLowerCase()+' linked.':view.chosen?.id===value?'Selected '+label.toLowerCase()+': '+view.chosen.label:'An existing '+label.toLowerCase()+' is linked. Search to review or replace the link.'}</p>
  <form onSubmit={submit} aria-label={'Find '+label.toLowerCase()}><label htmlFor={input}>{label} search</label><input id={input} name="reference-search" type="search" autoComplete="off" maxLength={400} disabled={disabled||view.busy}/><button type="submit" className="secondary" disabled={disabled||view.busy}>Find {kind==='customer'?'customers':kind==='vehicle'?'vehicles':'sources'}</button></form>
  <p role="status" aria-label={label+' search status'}>{view.message}</p>
  <ul className="customer-list">{view.items.map(item=><li key={item.id}><p>{item.detail}</p><button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>{change(item.id);setView(v=>({...v,chosen:item}));}}>Use {item.label}</button></li>)}</ul>
  {view.more&&<button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void search(view.search,true)}>Next {label.toLowerCase()} search page</button>}
  {value!==null&&<button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>{change(null);setView(v=>({...v,chosen:null}));}}>Leave {label.toLowerCase()} unlinked</button>}
 </section>;
}
