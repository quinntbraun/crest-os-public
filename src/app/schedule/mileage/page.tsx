import {customerUuid} from '../../../customer/customer-contract';
import {MileageScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function MileagePage({searchParams}:{searchParams:Promise<{job?:string|string[];leg?:string|string[]}>}){
 const {job,leg}=await searchParams;
 const jobId=leg===undefined&&typeof job==='string'&&customerUuid(job)?job:'';
 const legId=job===undefined&&typeof leg==='string'&&customerUuid(leg)?leg:'';
 return <main className="customers">
  <p className="eyebrow">Crest Detailing · Field work</p>
  <h1>Trip mileage</h1>
  <MileageScreen jobId={jobId} legId={legId}/>
 </main>;
}
