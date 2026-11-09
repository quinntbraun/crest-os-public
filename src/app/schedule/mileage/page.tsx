import {customerUuid} from '../../../customer/customer-contract';
import {MileageScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function MileagePage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 return <main className="customers">
  <p className="eyebrow">Crest Detailing · Field work</p>
  <h1>Trip mileage</h1>
  <MileageScreen jobId={typeof job==='string'&&customerUuid(job)?job:''}/>
 </main>;
}
