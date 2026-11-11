import {customerUuid} from '../../../../customer/customer-contract';
import {FieldSessionScreen} from '../work';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function EndJobPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <main className="customers">
  <p className="eyebrow">Crest Detailing · Job work</p>
  <h1>End job</h1>
  <FieldSessionScreen jobId={jobId} mode="completion"/>
 </main>;
}
