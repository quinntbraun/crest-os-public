import {customerUuid} from '../../../../customer/customer-contract';
import {FieldSessionScreen} from '../work';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function EndJobPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <main className="customers completion-page">
  <header className="workflow-heading">
   <a className="field-back-link" href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>{jobId?'Back to saved job':'Back to Schedule'}</a>
   <h1>End job</h1>
  </header>
  <FieldSessionScreen jobId={jobId} mode="completion"/>
 </main>;
}
