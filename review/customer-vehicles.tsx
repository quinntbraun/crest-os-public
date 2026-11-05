import {useEffect,useState} from 'react';
import {customerUuid} from '../src/customer/customer-contract';
type Link={associationId:string;vehicleId:string;label:string;relationship:'owner'|'keeper';isBilling:boolean;validFrom:string;validTo:string|null;status:'Current'|'Scheduled'|'Historical'};
export function CustomerVehicles({customerId}:{customerId:string}){
 const [view,setView]=useState<{customerId:string;links:Link[];message:string}>({customerId:'',links:[],message:'Loading customer vehicles…'});
 useEffect(()=>{
  const controller=new AbortController();
  void(async()=>{try{
   const proof=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();});
   const result=await fetch('/_review/customer-vehicles',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify({customerId}),signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();});
   if(result.reviewOnly!==true||result.customerId!==customerId||!Array.isArray(result.links)||result.links.length>200||result.links.some((link:Link)=>!customerUuid(link.vehicleId)||!customerUuid(link.associationId)||typeof link.label!=='string'||!['owner','keeper'].includes(link.relationship)||!['Current','Scheduled','Historical'].includes(link.status)))throw Error();
   if(!controller.signal.aborted)setView({customerId,links:result.links,message:result.links.length?'Current and retained vehicle links.':'No vehicles linked yet. Open a vehicle to add its customer relationship.'});
  }catch{if(!controller.signal.aborted)setView({customerId,links:[],message:'Vehicle links could not be loaded. Reopen this customer to try again.'});}})();
  return()=>controller.abort();
 },[customerId]);
 return <section aria-label="Vehicles for this customer" className="customer-vehicles"><h2>Vehicles for this customer</h2><p role="status" aria-label="Customer vehicle list status">{view.customerId===customerId?view.message:'Loading customer vehicles…'}</p><ul className="customer-list">{view.customerId===customerId&&view.links.map(link=><li key={link.associationId}><a href={'/vehicles?vehicle='+encodeURIComponent(link.vehicleId)}>{link.label}</a><p>{link.relationship==='owner'?'Owner':'Keeper'} · {link.status} · {link.isBilling?'Billing selected':'Billing not selected'}</p><p className="field-help">From <time dateTime={link.validFrom}>{new Date(link.validFrom).toLocaleString()}</time>{link.validTo&&<> to <time dateTime={link.validTo}>{new Date(link.validTo).toLocaleString()}</time></>}</p></li>)}</ul><a href="/vehicles">Open the vehicle directory</a></section>;
}
