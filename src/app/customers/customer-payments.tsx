'use client';

import {useEffect,useState} from 'react';
import {financeAccounts} from '../../client/finance-accounts';
import {DirectReceipt} from '../schedule/work/direct-receipt';
import {CollectionFailureRecredit} from './collection-failure-recredit';

export function CustomerPayments({businessId,customerId}:{businessId:string;customerId:string}){
  const [payments,setPayments]=useState(false);
  const [recredits,setRecredits]=useState(false);

  useEffect(()=>{
    let controller:AbortController|undefined;
    function clear(){
      controller?.abort();
      controller=undefined;
      setPayments(false);
      setRecredits(false);
    }
    function inspect(){
      if(document.visibilityState!=='visible'){clear();return;}
      if(controller)return;
      controller=new AbortController();
      const {signal}=controller;
      void financeAccounts.context(signal).then(context=>{
        if(signal.aborted)return;
        setPayments(context.businessId===businessId&&context.directReceiptTips===true);
        setRecredits(context.businessId===businessId&&context.collectionFailureRecredits===true);
      }).catch(()=>{if(!signal.aborted){setPayments(false);setRecredits(false);}});
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

  return <>
    {payments&&<DirectReceipt businessId={businessId} customerId={customerId}/>}
    {recredits&&<CollectionFailureRecredit businessId={businessId} customerId={customerId}/>}
  </>;
}
