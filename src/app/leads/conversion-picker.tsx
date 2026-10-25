'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication} from '../../client/authentication';
import {customers} from '../../client/customers';
import {vehicles} from '../../client/vehicles';
import {addresses} from '../../client/customer-addresses';
import type {Customer} from '../../customer/customer-contract';
import type {Vehicle} from '../../customer/vehicle-contract';
import type {CustomerAddress} from '../../customer/customer-address-contract';
type Props={businessId:string;disabled:boolean}&({kind:'customer';choose:(row:Customer)=>void}|{kind:'vehicle';choose:(row:Vehicle)=>void}|{kind:'address';customerId:string;choose:(row:CustomerAddress)=>void});
type Item={id:string;label:string;detail:string;choose:()=>void};
const empty={items:[] as Item[],busy:false,search:'',query:'',more:false,message:'Search and explicitly choose a current destination. Shared names do not merge records.'};
export function ConversionPicker(props:Props){return <DestinationPicker key={props.businessId+':'+props.kind+':'+(props.kind==='address'?props.customerId:'')} {...props}/>;}
function DestinationPicker(props:Props){
 const [view,setView]=useState(empty),active=useRef<AbortController|null>(null),alive=useRef(false),input=useId(),label=props.kind==='address'?'Customer location':props.kind==='customer'?'Customer':'Vehicle',scope=props.kind==='address'?props.customerId:'';
 useEffect(()=>{alive.current=true;const clear=()=>{active.current?.abort();active.current=null;setView(empty);},hide=()=>{if(document.visibilityState==='hidden')clear();},restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restore);return()=>{alive.current=false;active.current?.abort();active.current=null;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);};},[props.businessId,props.kind,scope]);
 async function search(more=false){
  const text=view.query;if(props.disabled||active.current||[...text].length>200||more&&(!view.more||text!==view.search))return;
  const work=new AbortController(),signal=AbortSignal.any([work.signal,AbortSignal.timeout(45000)]),afterId=more?view.items.at(-1)?.id??null:null;active.current=work;setView(v=>({...v,items:[],busy:true,more:false,message:'Checking current destination records…'}));
  try{
   const proof=await authentication.session(signal);let items:Item[],hasMore:boolean;
   if(props.kind==='customer'){const r=await customers.list(props.businessId,{search:text,afterId,includeArchived:false,pageSize:10},proof,signal);hasMore=r.hasMore;items=r.customers.map(row=>({id:row.id,label:row.display_name,detail:'Customer version '+row.version+' · '+row.id,choose:()=>props.choose(row)}));}
   else if(props.kind==='vehicle'){const r=await vehicles.list(props.businessId,{search:text,afterId,includeArchived:false,pageSize:10},proof,signal);hasMore=r.hasMore;items=r.vehicles.map(row=>({id:row.id,label:row.label,detail:[row.year,row.make,row.model,'Vehicle version '+row.version,row.id].filter(v=>v!==null).join(' · '),choose:()=>props.choose(row)}));}
   else{const r=await addresses.list(props.businessId,{customerId:props.customerId,search:text,afterId,includeArchived:false,pageSize:10},proof,signal);hasMore=r.hasMore;items=r.addresses.map(row=>({id:row.id,label:[row.line1,row.exact_location_text,row.city].find(v=>v?.trim())??'Location details not recorded',detail:'Location version '+row.version+' · '+row.id,choose:()=>props.choose(row)}));}
   if(alive.current&&!signal.aborted&&active.current===work)setView(v=>({...v,items,busy:false,search:text,more:hasMore,message:items.length?'Choose the exact destination. Existing records will remain unchanged.':'No matching destinations on this page.'}));
  }catch{if(alive.current&&!work.signal.aborted&&active.current===work)setView(v=>({...v,items:[],busy:false,more:false,message:'Destination records could not be verified. Search again before choosing.'}));}
  finally{if(active.current===work)active.current=null;}
 }
 function submit(event:FormEvent){event.preventDefault();void search();}
 return <section aria-label={'Conversion '+label.toLowerCase()+' search'} aria-busy={view.busy}><form onSubmit={submit}><label htmlFor={input}>{label} destination search</label><input id={input} type="search" autoComplete="off" maxLength={400} value={view.query} disabled={props.disabled||view.busy} onChange={event=>setView(v=>({...v,query:event.target.value}))}/><button type="submit" className="secondary" disabled={props.disabled||view.busy}>Find destination {props.kind==='customer'?'customers':props.kind==='vehicle'?'vehicles':'locations'}</button></form><p role="status">{view.message}</p><ul className="customer-list">{view.items.map(row=><li key={row.id}><p>{row.detail}</p><button type="button" className="secondary" disabled={props.disabled||view.busy} onClick={()=>{row.choose();setView(empty);}}>Choose {row.label}</button></li>)}</ul>{view.more&&<button type="button" className="secondary" disabled={props.disabled||view.busy||view.query!==view.search} onClick={()=>void search(true)}>Next destination {props.kind} page</button>}</section>;
}
