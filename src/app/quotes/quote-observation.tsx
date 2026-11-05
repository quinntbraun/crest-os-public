'use client';
import type {QuoteLineDraft,QuoteObservationDraft} from '../../client/quote-draft';
import {initialConditionClasses,initialVehicleCategories} from '../../commercial/catalog-options';
import {followUpCandidates,followUpWall} from '../leads/follow-up-time';
import {leadUtc} from '../leads/intake-input';

export function QuoteObservationFields({line,zone,change}:{line:QuoteLineDraft;zone:string;change:(patch:Partial<QuoteLineDraft>)=>void}){
 const saved=line.assessment,raw:QuoteObservationDraft=line.assessmentDraft??{id:saved?.id??'',source:saved?.source??'',wall:followUpWall(saved?.assessedAt??'',zone),instant:saved?.assessedAt??'',exact:saved?.assessedAt??'',notes:saved?.notes??''};
 const matches=raw.wall?followUpCandidates(raw.wall,zone):[];
 function entered(patch:Partial<QuoteObservationDraft>,condition=line.condition){change({condition,assessmentDraft:{...raw,...patch,id:crypto.randomUUID()}});}
 return <details><summary>Vehicle category and condition assessment</summary>
  <label>Vehicle category<select value={line.category??''} onChange={event=>change({category:(event.target.value||null) as Exclude<QuoteLineDraft['category'],undefined>})}><option value="">Not classified</option>{initialVehicleCategories.map(category=><option key={category}>{category}</option>)}</select></label>
  <label>Condition<select value={line.condition} onChange={event=>entered({},event.target.value as QuoteLineDraft['condition'])}><option value="">Not assessed</option>{initialConditionClasses.map(condition=><option key={condition}>{condition}</option>)}</select></label>
  <label>Observation source<select value={raw.source} onChange={event=>entered({source:event.target.value as QuoteObservationDraft['source']})}><option value="">Choose how this was assessed</option><option value="reported">Reported by the customer</option><option value="photo">Assessed from photos</option><option value="on_site">Observed on site</option></select></label>
  <label>Assessment date and time<input type="datetime-local" step="60" value={raw.wall} onChange={event=>{const wall=event.target.value,found=wall?followUpCandidates(wall,zone):[],instant=wall?(found.length===1?found[0]!:'invalid:'+wall):'';entered({wall,instant,exact:instant.startsWith('invalid:')?'':instant});}}/></label>
  <p className="field-help">Time zone: {zone}. Enter when this condition was observed. Existing precise timestamps stay intact until you change the time.</p>
  {raw.wall&&matches.length===0&&<p role="alert">This date or time does not exist in the selected time zone.</p>}
  {matches.length>1&&(raw.instant.startsWith('invalid:')||matches.includes(raw.instant))&&<label>Assessment time occurrence<select value={matches.includes(raw.instant)?raw.instant:''} onChange={event=>{if(matches.includes(event.target.value))entered({instant:event.target.value,exact:event.target.value});}}><option value="">Choose the occurrence</option>{matches.map((instant,index)=><option key={instant} value={instant}>{index===0?'First':'Later'} occurrence · {instant} UTC</option>)}</select></label>}
  {line.condition==='Extreme'&&<p className="notice">Extreme condition requires your explicit acknowledgement before approval. It never adds a surcharge.</p>}
  <label>Assessment notes (private, optional)<textarea rows={2} maxLength={8000} value={raw.notes} onChange={event=>entered({notes:event.target.value})}/></label>
  <label>Category override reason (private, if applicable)<textarea rows={2} maxLength={8000} value={line.categoryOverrideNote??''} onChange={event=>change({categoryOverrideNote:event.target.value})}/></label>
  <details><summary>Precise assessment time (UTC)</summary><label>Exact assessment time in UTC<input value={raw.exact} maxLength={35} placeholder="2026-10-29 15:30:00.000000" onChange={event=>{const instant=event.target.value?leadUtc(event.target.value):'';entered({instant,exact:event.target.value,wall:followUpWall(instant,zone)});}}/></label></details>
  <p className="field-help">Category and condition appear on the quote. Observation details and override reasons stay private. Complete the assessment before requesting approval.</p>
 </details>;
}
