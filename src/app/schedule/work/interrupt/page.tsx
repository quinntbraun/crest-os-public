import {customerUuid} from '../../../../customer/customer-contract';
import {FieldSessionScreen} from '../work';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function InterruptTripPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <main className="customers">
  <p className="eyebrow">Crest Detailing · Mobile work</p>
  <h1>Interrupt trip</h1>
  <FieldSessionScreen jobId={jobId} mode="interruption"/>
 </main>;
}
