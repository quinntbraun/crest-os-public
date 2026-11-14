'use client';

import {useEffect,useState} from 'react';
import {financeAccounts} from '../../client/finance-accounts';
import {DirectReceipt} from '../schedule/work/direct-receipt';

export function CustomerPayments({businessId,customerId}:{businessId:string;customerId:string}){
  const [available,setAvailable]=useState(false);

  useEffect(()=>{
    let controller:AbortController|undefined;
    function clear(){
      controller?.abort();
      controller=undefined;
      setAvailable(false);
    }
    function inspect(){
      if(document.visibilityState!=='visible'){clear();return;}
      if(controller)return;
      controller=new AbortController();
      const {signal}=controller;
      void financeAccounts.context(signal).then(context=>{
        if(!signal.aborted)setAvailable(context.businessId===businessId&&context.directReceiptTips===true);
      }).catch(()=>{if(!signal.aborted)setAvailable(false);});
    }
    function restore(event:PageTransitionEvent){if(event.persisted)inspect();}
    inspect();
    document.addEventListener('visibilitychange',inspect);
    window.addEventListener('pagehide',clear);
    window.addEventListener('pageshow',restore);
    return ()=>{
      controller?.abort();
      document.removeEventListener('visibilitychange',inspect);
      window.removeEventListener('pagehide',clear);
      window.removeEventListener('pageshow',restore);
    };
  },[businessId]);

  return available?<DirectReceipt businessId={businessId} customerId={customerId}/>:null;
}
