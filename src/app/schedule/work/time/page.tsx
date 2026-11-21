import {customerUuid} from '../../../../customer/customer-contract';
import {WorkTimeScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function WorkTimePage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <main className="customers work-time-page">
  {jobId&&<a className="record-return-link" href={'/schedule?job='+encodeURIComponent(jobId)}>Saved job and history</a>}
  <h1>Recorded work time</h1>
  <WorkTimeScreen jobId={jobId}/>
 </main>;
}
