'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {customerDate} from '../../../customer/customer-contract';
import type {MileageJobChoices,MileageJobCursor} from '../../../client/mileage-controller';

export type MileageShareDraft=Readonly<{jobId:string;label:string;percent:string}>;
export type FindMileageJobs=(day:string,after:MileageJobCursor|null)=>Promise<MileageJobChoices|undefined>;

export function MileageAttribution({jobId,day,timezone,shares,change,findJobs}:{
 jobId:string;day:string;timezone:string;shares:readonly MileageShareDraft[];
 change:(shares:readonly MileageShareDraft[])=>void;findJobs:FindMileageJobs;
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
  <p>Enter each job’s share as a percentage. The shares must total 100%. Crest counts the physical trip once.</p>
  {jobId&&!isChosen(jobId)&&<button type="button" className="secondary" onClick={()=>add(jobId,'This job')}>Add this job</button>}
  <label htmlFor={id+'-date'}>Job date</label>
  <input type="date" id={id+'-date'} value={date} onChange={event=>{
   setDate(event.target.value);setLoadedDate('');setResults(null);setSelected('');setMessage('');
  }}/>
  <button type="button" className="secondary" onClick={()=>void lookup(null)}>Find saved jobs</button>
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
  {shares.map(share=><div className="mileage-share" key={share.jobId}>
   <label htmlFor={id+'-share-'+share.jobId}>{share.label} share (%)</label>
   <div className="mileage-share-controls">
    <input id={id+'-share-'+share.jobId} inputMode="decimal" value={share.percent} maxLength={10} required onChange={event=>
     change(shares.map(row=>row.jobId===share.jobId?{...row,percent:event.target.value}:row))
    }/>
    <button type="button" className="secondary" aria-label={'Remove '+share.label} onClick={()=>
     change(shares.filter(row=>row.jobId!==share.jobId))
    }>Remove</button>
   </div>
  </div>)}
 </fieldset>;
}
