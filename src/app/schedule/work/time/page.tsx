import {customerUuid} from '../../../../customer/customer-contract';
import {WorkTimeScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function WorkTimePage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 return <main className="customers">
  <p className="eyebrow">Crest Detailing · Mobile work</p>
  <h1>Recorded work time</h1>
  <WorkTimeScreen jobId={typeof job==='string'&&customerUuid(job)?job:''}/>
 </main>;
}
