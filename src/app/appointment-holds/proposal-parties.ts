'use client';
import {useEffect,useState} from 'react';
import {authentication} from '../../client/authentication';
import {appointmentHolds} from '../../client/appointment-holds';
import {customers} from '../../client/customers';
import {leads} from '../../client/leads';
import {readProposalParties} from '../../client/proposal-party-read';
import type {ProposalPartyRow,ProposalPartyResult} from '../../client/proposal-party-read';
import type {StoredHold} from '../../operations/appointment-hold-contract';
const readers={session:authentication.session,context:appointmentHolds.context,party:async(businessId:string,row:ProposalPartyRow,proof:Parameters<typeof customers.history>[2],signal:AbortSignal)=>{
 if(row.customer_id!==null){const result=await customers.history(businessId,{customerId:row.customer_id,afterVersion:'0',pageSize:1},proof,signal);return result.state==='found'?{kind:'customer' as const,label:result.customer.display_name}:null;}
 const result=await leads.history(businessId,{leadId:row.lead_id!,afterVersion:'0',pageSize:1},proof,signal);return result.state==='found'?{kind:'lead' as const,label:result.lead.label}:null;
}};
type Snapshot=Readonly<{businessId:string;binding:string;rows:readonly StoredHold[];items:readonly ProposalPartyResult[]}>;
export function useProposalParties({businessId,binding,rows}:{businessId:string|null;binding:string|null;rows:readonly StoredHold[]}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 useEffect(()=>{
  if(!businessId||!binding||rows.length===0)return;
  const request=new AbortController();let alive=true;
  const clear=()=>{request.abort();setSnapshot(null);};
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);
  void readProposalParties({businessId,binding,rows},request.signal,readers).then(items=>{
   if(alive&&!request.signal.aborted)setSnapshot({businessId,binding,rows,items});
  }).catch(()=>{if(alive&&!request.signal.aborted){
   const items:ProposalPartyResult[]=rows.map(row=>({holdId:row.id,kind:row.customer_id===null?'lead':'customer',state:'unavailable'}));
   setSnapshot({businessId,binding,rows,items});
  }});
  return()=>{alive=false;request.abort();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);};
 },[businessId,binding,rows]);
 return new Map(snapshot&&snapshot.businessId===businessId&&snapshot.binding===binding&&snapshot.rows===rows?snapshot.items.map(item=>[item.holdId,item] as const):[]);
}
