'use client';
import {useState} from 'react';
import {createCatalogService,reviseCatalogService,setCatalogServiceActive,serviceDurationInput,ServiceCatalogError} from '../../commercial/service-catalog';
import type {CatalogService,ServiceDefinition} from '../../commercial/service-catalog';
import {quoteDollarsInput,quoteMoney} from '../../commercial/quote-pricing';
const blank={name:'',inclusions:'',exclusions:'',internal:'',low:'',high:'',minutes:'',seconds:''};
const dollars=(cents:string|null)=>cents===null?'':(BigInt(cents)/100n)+'.'+(BigInt(cents)%100n).toString().padStart(2,'0');
const messages:Record<string,string>={definition:'Enter a service name and included work. Check the text lengths and remove unsupported control characters.',range:'Enter valid starting amounts; an upper amount needs a lower amount and cannot be smaller.',duration:'Enter whole minutes and 0–59 additional seconds, with a total greater than zero.',stale:'This service changed. Reopen its latest version before editing.',duplicate:'Use a different service code.',service:'Use a code with lowercase letters, numbers, hyphens or underscores (up to 80 characters).',capacity:'This review service has reached its version limit.'};
export function ServiceEditor({services,change,onApply,markDirty}:{services:readonly CatalogService[];change:(rows:readonly CatalogService[])=>void;onApply:(service:CatalogService)=>void;markDirty:()=>void}){
 const [draft,setDraft]=useState(blank),[code,setCode]=useState(''),[editing,setEditing]=useState<CatalogService|null>(null),[active,setActive]=useState(true),[error,setError]=useState(''),[status,setStatus]=useState('');
 const edit=(patch:Partial<typeof blank>)=>setDraft(d=>({...d,...patch}));
 function open(service:CatalogService){const d=service.versions.at(-1)!.definition;if((Object.values(draft).some(Boolean)||code)&&!confirm('Replace the current unsaved service form?'))return;setEditing(service);setCode(service.code);setActive(service.active);setDraft({name:d.name,inclusions:d.inclusions,exclusions:d.exclusions,internal:d.internalGuidance??'',low:dollars(d.rangeLowCents),high:dollars(d.rangeHighCents),minutes:d.estimatedSeconds===null?'':String(BigInt(d.estimatedSeconds)/60n),seconds:d.estimatedSeconds===null?'':String(BigInt(d.estimatedSeconds)%60n)});setError('');setStatus('');}
 function clear(){setEditing(null);setCode('');setDraft(blank);setActive(true);setError('');}
 function commit(){
  try{
   let low:string|null=null,high:string|null=null;try{low=draft.low.trim()?quoteDollarsInput(draft.low):null;high=draft.high.trim()?quoteDollarsInput(draft.high):null;}catch{throw new ServiceCatalogError('range');}
   const definition:ServiceDefinition={name:draft.name,inclusions:draft.inclusions,exclusions:draft.exclusions,internalGuidance:draft.internal.trim()?draft.internal:null,rangeLowCents:low,rangeHighCents:high,estimatedSeconds:serviceDurationInput(draft.minutes,draft.seconds)};
   if(!editing&&services.some(s=>s.code===code))throw new ServiceCatalogError('duplicate');
   const current=editing?services.find(s=>s.id===editing.id):null;
   if(editing&&(!current||current.revision!==editing.revision))throw new ServiceCatalogError('stale');
   let saved=current?reviseCatalogService(current,editing!.revision,definition):createCatalogService(crypto.randomUUID(),code,active,definition);
   if(current)saved=setCatalogServiceActive(saved,saved.revision,active);
   change(current?services.map(s=>s.id===saved.id?saved:s):[...services,saved]);clear();setStatus('Service version '+saved.versions.at(-1)!.sequence+' retained in this unsaved review page.');
  }catch(e){setError(messages[e instanceof ServiceCatalogError?e.code:'definition']??'Review this service before continuing.');}
 }
 return <details className="service-editor"><summary>Service library · {services.length} {services.length===1?'service':'services'} in this page</summary>
  <p className="notice"><strong>Unsaved service review.</strong> This library clears when you leave or refresh. It is not part of the sample download. No live services or prices are preloaded.</p>
  <p>Define your scope once, then copy it into a quote line. Editing or archiving a service keeps its earlier versions and the lines already copied from them.</p>
  {services.map(s=>{const v=s.versions.at(-1)!,d=v.definition;return <section key={s.id} className="review-card" aria-label={'Service '+s.code}><h3>{d.name}</h3><p>{s.code} · Version {v.sequence} · {s.active?'Active':'Archived'}</p><p className="service-text">{d.inclusions}</p>{d.exclusions&&<p className="service-text">Exclusions: {d.exclusions}</p>}{d.rangeLowCents!==null&&<p>Starting guidance: {quoteMoney(d.rangeLowCents)}{d.rangeHighCents!==null?' – '+quoteMoney(d.rangeHighCents):' and up'} · You enter the offered amount separately.</p>}<button type="button" disabled={!s.active} onClick={()=>onApply(s)}>Add {d.name} to quote</button><button type="button" className="secondary" onClick={()=>open(s)}>Edit {s.code}</button><details><summary>Earlier service versions ({s.versions.length})</summary>{s.versions.map(prior=><div key={prior.sequence}><strong>Version {prior.sequence}: {prior.definition.name}</strong><p className="service-text">{prior.definition.inclusions}</p><p className="service-text">Exclusions: {prior.definition.exclusions||'None recorded'}</p></div>)}</details></section>;})}
  <form aria-label="Service definition" onSubmit={e=>{e.preventDefault();commit();}} onChange={()=>{setStatus('');markDirty();}}>
   <h3>{editing?'Edit service':'Define a service'}</h3>
   <label>Service code<input aria-label="Service code" disabled={!!editing} value={code} maxLength={80} placeholder="interior-detail" onChange={e=>setCode(e.target.value)}/></label>
   <label>Service name<input aria-label="Service name" value={draft.name} maxLength={200} onChange={e=>edit({name:e.target.value})}/></label>
   <label>Included work<textarea aria-label="Service included work" value={draft.inclusions} maxLength={4000} rows={3} onChange={e=>edit({inclusions:e.target.value})}/></label>
   <label>Exclusions<textarea aria-label="Service exclusions" value={draft.exclusions} maxLength={4000} rows={2} onChange={e=>edit({exclusions:e.target.value})}/></label>
   <details><summary>Internal guidance and starting estimates (optional)</summary>
    <label>Internal guidance<textarea aria-label="Service internal guidance" value={draft.internal} maxLength={4000} rows={2} onChange={e=>edit({internal:e.target.value})}/></label>
    <p className="field-help">Internal guidance stays out of the customer quote preview. Starting amounts are guidance, never an automatic charge.</p>
    <label>Starting amount (USD)<input aria-label="Service starting amount (USD)" inputMode="decimal" value={draft.low} maxLength={24} onChange={e=>edit({low:e.target.value})}/></label>
    <label>Upper starting estimate (USD)<input aria-label="Service upper estimate (USD)" inputMode="decimal" value={draft.high} maxLength={24} onChange={e=>edit({high:e.target.value})}/></label>
    <label>Estimated minutes<input aria-label="Service estimated minutes" inputMode="numeric" value={draft.minutes} maxLength={18} onChange={e=>edit({minutes:e.target.value})}/></label>
    <label>Additional seconds<input aria-label="Service additional seconds" inputMode="numeric" value={draft.seconds} maxLength={2} onChange={e=>edit({seconds:e.target.value})}/></label>
   </details>
   <label className="trust"><input type="checkbox" aria-label="Service active" checked={active} onChange={e=>setActive(e.target.checked)}/>Active: available for new quote lines</label>
   {error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
   <button type="submit">{editing?'Keep edited version in this page':'Keep service in this page'}</button>{editing&&<button type="button" className="secondary" onClick={clear}>Cancel service edit</button>}
  </form>
 </details>;
}
