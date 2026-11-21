import {VehicleScreen} from './vehicles';
import {BackToSavedJob} from '../schedule/back-to-saved-job';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function VehiclesPage({searchParams}:{searchParams:Promise<{vehicle?:string|string[];job?:string|string[];jobVehicle?:string|string[];view?:string|string[];linkCustomer?:string|string[];customer?:string|string[]}>}){
  const {vehicle,job,jobVehicle,view,linkCustomer,customer}=await searchParams;
  const vehicleId=customerUuid(vehicle)?vehicle:null;
  const customerId=customerUuid(customer)?customer:customerUuid(linkCustomer)?linkCustomer:null;
  return <main className="customers vehicle-page">
    {customerId&&<a className="record-return-link" href={'/customers?customer='+encodeURIComponent(customerId)+'&view=vehicles'+(vehicleId?'&focusVehicle='+encodeURIComponent(vehicleId):'')}>Back to customer vehicles</a>}
    {vehicleId&&<BackToSavedJob job={job} jobVehicle={jobVehicle}/>}
    <h1>Vehicles</h1><VehicleScreen initialVehicleId={vehicleId} initialVisits={view==='visits'} linkCustomerId={customerUuid(linkCustomer)?linkCustomer:null}/>
  </main>;
}
