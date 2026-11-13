import {ScheduleScreen} from './screen';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function SchedulePage({searchParams}:{searchParams:Promise<{job?:string|string[];vehicle?:string|string[]}>}){
 const input=await searchParams,jobId=customerUuid(input.job)?input.job:undefined;
 const vehicleId=jobId&&customerUuid(input.vehicle)?input.vehicle:undefined;
 return <main className="customers"><h1>Schedule</h1>
  <ScheduleScreen {...jobId?{initialJobId:jobId}:{}} {...vehicleId?{initialJobVehicleId:vehicleId}:{}}/>
 </main>;
}
