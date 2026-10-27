import {useEffect,useId,useRef,useState} from 'react';
import type {AddressDraft} from '../src/customer/customer-resource-contract';
type Candidate={label:string;line1:string;city:string|null;region:string|null;postalCode:string|null;country:string|null;latitude:string;longitude:string};
export function AddressSearch({draft,change}:{draft:AddressDraft;change:(draft:AddressDraft)=>void}){
 const [enabled,setEnabled]=useState(false),[query,setQuery]=useState(''),[area,setArea]=useState(''),[near,setNear]=useState<{lat:number;lon:number}|null>(null),[finding,setFinding]=useState(false),[result,setResult]=useState<{key:string;items:Candidate[];message:string}>({key:'',items:[],message:''});
 const alive=useRef(true),consent=useRef(false),listId=useId(),key=JSON.stringify([query,area,near,enabled]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!enabled||query.trim().length<4)return;const controller=new AbortController();
  const timer=setTimeout(()=>{void(async()=>{
   setResult({key,items:[],message:'Finding matching addresses…'});
   try{
    const proof=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();});
    const response=await fetch('/_review/address-suggestions',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify({query,area,near}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(9000)])});
    if(!response.ok)throw Error();const value=await response.json();if(!Array.isArray(value.suggestions)||value.suggestions.length>5)throw Error();
    if(!controller.signal.aborted)setResult({key,items:value.suggestions,message:value.suggestions.length?'Choose an address to fill the fields below.':'No matching address found. Add a city or enter it manually below.'});
   }catch{if(!controller.signal.aborted)setResult({key,items:[],message:'Suggestions are unavailable. Add more location detail or enter the address manually below.'});}
  })();},900);
  return()=>{clearTimeout(timer);controller.abort();};
 },[enabled,query,area,near,key]);
 function locate(){
  if(!enabled||!navigator.geolocation)return;setFinding(true);
  navigator.geolocation.getCurrentPosition(position=>{if(alive.current&&consent.current){setNear({lat:Math.round(position.coords.latitude*100)/100,lon:Math.round(position.coords.longitude*100)/100});setFinding(false);}},()=>{if(alive.current&&consent.current){setFinding(false);setResult({key,items:[],message:'Location was not available. You can enter a city or ZIP instead.'});}},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
 }
 function choose(candidate:Candidate){
  change({...draft,line1:candidate.line1,city:candidate.city,region:candidate.region,postalCode:candidate.postalCode,country:candidate.country,latitude:candidate.latitude,longitude:candidate.longitude,geocodeSource:'Photon / OpenStreetMap',geocodeAccuracy:'Map suggestion; postal delivery not verified',verifiedAt:null});
  setEnabled(false);consent.current=false;setNear(null);setResult({key:'',items:[],message:''});setQuery('');
 }
 return <section className="review-address-assist" aria-label="Find a real address"><h3>Find an address</h3><label className="trust"><input type="checkbox" checked={enabled} onChange={event=>{consent.current=event.target.checked;setEnabled(event.target.checked);setNear(null);setFinding(false);setResult({key:'',items:[],message:''});}}/>Enable live address suggestions</label><p className="field-help">Search text goes to Photon (Komoot). If you choose location access, only an approximate area is sent. Use public example addresses in this sample workspace.</p>
 {enabled&&<><label htmlFor="address-find">Street address or place</label><input id="address-find" type="search" autoComplete="off" placeholder="Start typing a street address…" maxLength={200} value={query} aria-controls={listId} onChange={event=>setQuery(event.target.value)}/><label htmlFor="address-area">City or ZIP to search near (optional)</label><input id="address-area" autoComplete="address-level2" maxLength={100} value={area} onChange={event=>setArea(event.target.value)} placeholder="City, state or ZIP"/><button type="button" className="secondary" disabled={finding} onClick={locate}>{finding?'Finding your area…':near?'Update my approximate location':'Use my approximate location'}</button>{near&&<button type="button" className="secondary" onClick={()=>setNear(null)}>Stop using my location</button>}<p role="status" aria-live="polite">{result.key===key?result.message:query.trim().length<4?'Type at least four characters.':'Waiting for you to finish typing…'}</p><ul id={listId} className="customer-list">{result.key===key&&result.items.map((candidate,i)=><li key={i}><button type="button" className="secondary" onClick={()=>choose(candidate)}>Use {candidate.label}</button></li>)}</ul></>}
 <p className="field-help">Suggestions are map matches, not proof of postal delivery. Nothing fills or saves until you choose it. Unit and location instructions are kept.</p><small>Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></small></section>;
}
