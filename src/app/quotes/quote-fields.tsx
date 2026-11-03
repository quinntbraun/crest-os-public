'use client';
import {useId,useState} from 'react';
import type {QuoteDiscountKind} from '../../client/quote-draft';
import {followUpCandidates,followUpWall} from '../leads/follow-up-time';
import {leadUtc} from '../leads/intake-input';

export function SearchSaved({label,busy,find}:{label:string;busy:boolean;find:(value:string)=>void}){
 const [value,setValue]=useState(''),field=useId();
 return <div className="service-search"><label htmlFor={field}>{label}<input id={field} type="search" maxLength={200} value={value} disabled={busy} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();find(value);}}}/></label><button type="button" className="secondary" disabled={busy} onClick={()=>find(value)}>Find saved records</button></div>;
}
export function DiscountFields({label,kind,value,change}:{label:string;kind:QuoteDiscountKind;value:string;change:(kind:QuoteDiscountKind,value:string)=>void}){
 return <div className="service-pair"><label>{label}<select value={kind} onChange={event=>change(event.target.value as QuoteDiscountKind,'')}><option value="none">No discount</option><option value="fixed">Fixed amount (USD)</option><option value="percent">Percentage</option></select></label>{kind!=='none'&&<label>{label} value<input inputMode="decimal" maxLength={24} value={value} onChange={event=>change(kind,event.target.value)} placeholder={kind==='fixed'?'0.00':'0'}/></label>}</div>;
}
export function QuoteExpiry({value,zone,change}:{value:string;zone:string;change:(value:string)=>void}){
 const [wall,setWall]=useState(()=>followUpWall(value,zone)),[exact,setExact]=useState(value),[candidates,setCandidates]=useState<readonly string[]>([]),[message,setMessage]=useState('');
 function choose(instant:string){setExact(instant);change(instant);setMessage('');}
 function entered(next:string){setWall(next);if(!next){setCandidates([]);choose('');return;}const matches=followUpCandidates(next,zone);setCandidates(matches);if(matches.length===1)choose(matches[0]!);else{setExact('');change('invalid:'+next);setMessage(matches.length>1?'This clock time occurs twice. Choose the occurrence below.':'This date or time does not exist in the selected time zone. Choose another time.');}}
 return <div><label>Optional expiry date and time<input type="datetime-local" step="60" value={wall} onChange={event=>entered(event.target.value)}/></label><p className="field-help">Time zone: {zone}. Leave blank for no expiry. Changing this time records minute precision; existing seconds and microseconds stay intact until edited.</p>
  {message&&<p role="alert">{message}</p>}{candidates.length>1&&<label>Expiry occurrence<select value={candidates.includes(value)?value:''} required onChange={event=>{if(candidates.includes(event.target.value))choose(event.target.value);}}><option value="">Choose the occurrence</option>{candidates.map((instant,index)=><option key={instant} value={instant}>{index===0?'First':'Later'} occurrence · {instant} (UTC)</option>)}</select></label>}
  <details><summary>Precise expiry entry (UTC)</summary><label>Exact expiry in UTC<input value={exact} maxLength={35} placeholder="2026-10-29 21:00:00.000000" onChange={event=>{const next=event.target.value,instant=next.length?leadUtc(next):'';setExact(next);change(instant);setWall(followUpWall(instant,zone));setCandidates([]);setMessage('');}}/></label><p className="field-help">An exact UTC value preserves six fractional digits. Leave blank for no expiry.</p></details>
 </div>;
}
