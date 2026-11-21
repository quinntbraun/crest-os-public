'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {customerDate} from '../../../customer/customer-contract';
import {mileageShareFraction} from '../../../operations/mileage';
import type {MileageJobChoices,MileageJobCursor} from '../../../client/mileage-controller';

export type MileageShareDraft=Readonly<{jobId:string;label:string;percent:string}>;
export type FindMileageJobs=(day:string,after:MileageJobCursor|null)=>Promise<MileageJobChoices|undefined>;

const fullShare=100000000n;
const scaled=(value:bigint,places:number)=>{
 const unit=10n**BigInt(places),fraction=(value%unit).toString().padStart(places,'0').replace(/0+$/,'');
 return (value/unit).toString()+(fraction?'.'+fraction:'');
};
function shareUnits(percent:string){
 if(!percent.trim())return 0n;
 try{return BigInt(mileageShareFraction(percent).replace('.',''));}
 catch{return null;}
}
export function mileageDisplay(units:bigint){return scaled(units,4)+' mi';}
function shareMiles(distance:bigint,share:bigint){
 const numerator=distance*share;
 const miles=mileageDisplay((numerator+fullShare/2n)/fullShare);
 return numerator%fullShare===0n?miles:'≈ '+miles;
}
export function MileageAllocationTotals({shares,distance}:{shares:readonly string[];distance:bigint|null}){
 let allocated=0n,invalid=false;
 for(const share of shares){
  const units=shareUnits(share);
  if(units===null)invalid=true;
  else allocated+=units;
 }
 const remaining=fullShare-allocated,over=remaining<0n;
 return <section className="mileage-allocation-totals" aria-label="Allocation totals">
  <dl>
   <div><dt>Assigned</dt><dd>{scaled(allocated,6)}%{distance!==null&&<small>{shareMiles(distance,allocated)}</small>}</dd></div>
   <div><dt>{over?'Over allocated':'Remaining'}</dt><dd>{scaled(over?-remaining:remaining,6)}%{distance!==null&&<small>{shareMiles(distance,over?-remaining:remaining)}</small>}</dd></div>
  </dl>
  {invalid&&<p className="field-help">One or more shares need a valid percentage.</p>}
 </section>;
}
export function MileageAttribution({jobId,day,timezone,shares,distance,change,findJobs}:{
 jobId:string;day:string;timezone:string;shares:readonly MileageShareDraft[];
 distance:bigint|null;change:(shares:readonly MileageShareDraft[])=>void;findJobs:FindMileageJobs;
}){
 const id=useId();
 const [date,setDate]=useState(day),[loadedDate,setLoadedDate]=useState('');
 const [results,setResults]=useState<MileageJobChoices|null>(null);
 const [selected,setSelected]=useState(''),[message,setMessage]=useState('');
 const pendingFocus=useRef('');
 useEffect(()=>{
  if(!pendingFocus.current)return;
  document.getElementById(id+'-share-'+pendingFocus.current)?.focus();
  pendingFocus.current='';
 },[id,shares.length]);
 const isChosen=(id:string)=>shares.some(share=>share.jobId===id);
 const choices=results?.jobs.filter(job=>!isChosen(job.jobId))??[];
 const format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 function add(id:string,label:string){
  if(isChosen(id))return;
  pendingFocus.current=id;
  change([...shares,{jobId:id,label,percent:''}]);
  setSelected('');setMessage('');
 }
 async function lookup(after:MileageJobCursor|null){
  if(!customerDate(date)){setMessage('Choose a date to find saved jobs.');return;}
  setMessage('Loading saved jobs…');setSelected('');
  const page=await findJobs(date,after);
  if(!page){setMessage('Saved jobs could not be loaded.');return;}
  setLoadedDate(date);
  setResults(page);
  setMessage(page.jobs.length?'Saved jobs loaded.':'No saved jobs were found for this date.');
 }
 return <fieldset className="mileage-split">
  <legend>{jobId?'Split this trip across jobs':'Allocate this trip to saved jobs'}</legend>
  <p className="field-help">Assign 100% across the saved jobs.</p>
  {jobId&&!isChosen(jobId)&&<button type="button" className="secondary" onClick={()=>add(jobId,'This job')}>Add this job</button>}
  <div className="mileage-job-search"><div><label htmlFor={id+'-date'}>Job date</label>
  <input type="date" id={id+'-date'} value={date} onChange={event=>{
   setDate(event.target.value);setLoadedDate('');setResults(null);setSelected('');setMessage('');
  }}/></div>
   <button type="button" className="secondary" onClick={()=>void lookup(null)}>Find saved jobs</button>
  </div>
  {results&&loadedDate===date&&<>
   {choices.length>0&&<>
    <label htmlFor={id+'-job'}>Saved job to add</label>
    <select id={id+'-job'} value={selected} onChange={event=>setSelected(event.target.value)}>
     <option value="">Choose a saved job</option>
     {choices.map(job=><option key={job.jobId} value={job.jobId}>
      {format.format(new Date(job.startAt))} · {job.customerName}{job.vehicleLabels[0]?' · '+job.vehicleLabels[0]:''}{job.state==='cancelled'?' · Cancelled':''}
     </option>)}
    </select>
    <button type="button" className="secondary" disabled={!selected} onClick={()=>{
     const job=choices.find(choice=>choice.jobId===selected);
     if(job)add(job.jobId,job.jobId===jobId?'This job':job.customerName+' · '+format.format(new Date(job.startAt)));
    }}>Add selected job</button>
   </>}
   {results.next&&<button type="button" className="secondary" onClick={()=>void lookup(results.next)}>Show more jobs for this date</button>}
   {results.jobs.length>0&&!choices.length&&<p>{jobId?'These jobs are already in the split.':'These jobs are already in the allocation.'}</p>}
  </>}
  {message&&<p role="status">{message}</p>}
  <MileageAllocationTotals shares={shares.map(share=>share.percent)} distance={distance}/>
  {shares.map(share=>{
   const units=shareUnits(share.percent);
   return <div className="mileage-share" key={share.jobId}>
   <label htmlFor={id+'-share-'+share.jobId}>{share.label} share (%)</label>
   <div className="mileage-share-controls">
    <input id={id+'-share-'+share.jobId} inputMode="decimal" value={share.percent} maxLength={10} required onChange={event=>
     change(shares.map(row=>row.jobId===share.jobId?{...row,percent:event.target.value}:row))
    }/>
    <button type="button" className="secondary" aria-label={'Remove '+share.label} onClick={()=>
     change(shares.filter(row=>row.jobId!==share.jobId))
    }>Remove</button>
   </div>
    {distance!==null&&units!==null&&share.percent.trim()&&<p className="mileage-row-distance">{shareMiles(distance,units)}</p>}
   </div>;
  })}
 </fieldset>;
}
