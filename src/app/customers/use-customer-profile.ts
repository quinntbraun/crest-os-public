'use client';

import {useEffect,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {customers} from '../../client/customers';

type Profile=Awaited<ReturnType<typeof customers.profile>>;
type State={customerId:string;businessId:string;phase:'loading'|'ready'|'unavailable';profile:Profile|null};

export function useCustomerProfile(businessId:string|null,customerId:string|null){
  const [state,setState]=useState<State|null>(null);
  const active=useRef<AbortController|null>(null);
  const current=state&&state.customerId===customerId&&state.businessId===businessId?state:null;
  if(state&&!current)setState(null);

  async function load(business:string,customer:string,prior:Profile|null){
    if(active.current)return;
    const controller=new AbortController();
    active.current=controller;
    try{
      const proof=await authentication.session(controller.signal);
      const page=await customers.profile(business,{customerId:customer,afterAssociationId:prior?.vehicles.at(-1)?.associationId??null,pageSize:10},proof,controller.signal);
      if(active.current!==controller||controller.signal.aborted)return;
      const profile=prior?{...page,vehicles:[...prior.vehicles,...page.vehicles]}:page;
      setState({businessId:business,customerId:customer,phase:'ready',profile});
    }catch{
      if(active.current===controller&&!controller.signal.aborted)setState({businessId:business,customerId:customer,phase:'unavailable',profile:null});
    }finally{
      if(active.current===controller)active.current=null;
    }
  }

  useEffect(()=>{
    if(!businessId||!customerId)return;
    let currentSelection=true;
    queueMicrotask(()=>{
      if(currentSelection)void load(businessId,customerId,null);
    });
    return ()=>{
      currentSelection=false;
      active.current?.abort();
      active.current=null;
    };
  },[businessId,customerId]);

  const profile=current?.profile??null;
  return {
    profile,
    phase:current?.phase??'loading',
    loadMore(){
      if(!businessId||!customerId||active.current||profile&&!profile.hasMore)return;
      setState({businessId,customerId,phase:'loading',profile});
      void load(businessId,customerId,profile);
    },
  };
}
