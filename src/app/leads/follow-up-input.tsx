'use client';
import {useState} from 'react';
import {leadUtc} from './intake-input';
import {followUpWall,followUpCandidates} from './follow-up-time';
export function FollowUpInput({value,change}:{value:string;change:(value:string)=>void}){
 const [zone,setZone]=useState('UTC'),[deviceZone]=useState(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}}),[wall,setWall]=useState(()=>followUpWall(value,'UTC')),[exact,setExact]=useState(value),[candidates,setCandidates]=useState<readonly string[]>([]),[message,setMessage]=useState('');
 function choose(instant:string){setExact(instant);change(instant);setMessage('');}
 function entered(next:string){
  setWall(next);const matches=followUpCandidates(next,zone);setCandidates(matches);
  if(matches.length===1)choose(matches[0]!);
  else{setExact('');change('invalid:'+next);setMessage(matches.length>1?'This clock time occurs twice. Choose the occurrence below.':next?'This time does not exist in the selected zone, or the date is invalid. Choose another time.':'Choose a follow-up date and time.');}
 }
 return <div className="lead-follow-up">
  <label htmlFor="lead-follow-zone">Follow-up time zone</label><select id="lead-follow-zone" value={zone} onChange={event=>{const next=event.target.value;setZone(next);setWall(followUpWall(value,next));setCandidates([]);setMessage('');}}><option value="UTC">UTC</option>{deviceZone!=='UTC'&&<option value={deviceZone}>This device: {deviceZone}</option>}</select>
  <label htmlFor="lead-follow-calendar">Follow-up date and time</label><input id="lead-follow-calendar" type="datetime-local" step="60" value={wall} required onInput={event=>entered(event.currentTarget.value)} onChange={event=>entered(event.target.value)}/>
  <p className="field-help">Time zone: {zone}. Changing the zone changes the display only. A changed time is saved to the minute; existing seconds and microseconds stay unchanged until you edit the time.</p>
  {message&&<p role="alert">{message}</p>}
  {candidates.length>1&&<><label htmlFor="lead-follow-occurrence">Which occurrence?</label><select id="lead-follow-occurrence" value={candidates.includes(value)?value:''} required onChange={event=>{if(candidates.includes(event.target.value))choose(event.target.value);}}><option value="">Choose an occurrence</option>{candidates.map((instant,i)=><option key={instant} value={instant}>{i===0?'First':'Later'} occurrence · {instant} (UTC)</option>)}</select></>}
  <details><summary>Precise UTC entry</summary><label htmlFor="lead-follow-up">Follow-up date and time (UTC)</label><input id="lead-follow-up" name="follow-up" autoComplete="off" maxLength={35} placeholder="2026-10-25 14:30:00.123456" value={exact} onChange={event=>{const next=event.target.value,instant=leadUtc(next);setExact(next);change(instant);setWall(followUpWall(instant,zone));setCandidates([]);setMessage('');}}/><p className="field-help">Optional exact UTC entry, including six fractional digits. This keeps the existing storage format.</p></details>
 </div>;
}
