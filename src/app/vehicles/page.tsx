import {VehicleScreen} from './vehicles';
import {BackToSavedJob} from '../schedule/back-to-saved-job';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function VehiclesPage({searchParams}:{searchParams:Promise<{vehicle?:string|string[];job?:string|string[];jobVehicle?:string|string[];view?:string|string[];linkCustomer?:string|string[]}>}){
  const {vehicle,job,jobVehicle,view,linkCustomer}=await searchParams;
  const vehicleId=customerUuid(vehicle)?vehicle:null;
  return <main className="customers">
    {vehicleId&&<BackToSavedJob job={job} jobVehicle={jobVehicle}/>}
    <p className="eyebrow">Crest Detailing</p><h1>Vehicles</h1><VehicleScreen initialVehicleId={vehicleId} initialVisits={view==='visits'} linkCustomerId={customerUuid(linkCustomer)?linkCustomer:null}/>
  </main>;
}
