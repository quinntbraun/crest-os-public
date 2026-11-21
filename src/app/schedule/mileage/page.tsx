import {customerInstant,customerUuid} from '../../../customer/customer-contract';
import {MileageScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function MileagePage({searchParams}:{searchParams:Promise<{job?:string|string[];leg?:string|string[];trip?:string|string[];at?:string|string[]}>}){
 const {job,leg,trip,at}=await searchParams;
 const jobId=leg===undefined&&typeof job==='string'&&customerUuid(job)?job:'';
 const legId=job===undefined&&typeof leg==='string'&&customerUuid(leg)?leg:'';
 const initialTrip=jobId&&customerUuid(trip)&&customerInstant(at)?{legId:trip,departedAt:at}:null;
 return <main className="customers mileage-page">
  <h1>Trip mileage</h1>
  <MileageScreen jobId={jobId} legId={legId} initialTrip={initialTrip}/>
 </main>;
}
