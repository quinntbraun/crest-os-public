import {FieldSessionScreen} from './work';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function FieldWorkPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams,jobId=customerUuid(job)?job:'';
 return <main className="customers field-work-page">
  <header className="workflow-heading">
   <a className="field-back-link" href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>{jobId?'Back to saved job':'Back to Schedule'}</a>
   <h1>Work status</h1>
  </header>
  <FieldSessionScreen jobId={jobId}/>
 </main>;
}
