import {VehicleScreen} from './vehicles';
import {BackToSavedJob} from '../schedule/back-to-saved-job';
import {customerUuid} from '../../customer/customer-contract';
import {ScheduleNavigationProvider} from '../schedule/navigation';
import {readScheduleNavigation} from '../../client/schedule-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function VehiclesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams,{vehicle,job,jobVehicle,view,linkCustomer,customer}=params;
  const navigation=customerUuid(job)?readScheduleNavigation(params):null;
  const vehicleId=customerUuid(vehicle)?vehicle:null;
  const customerId=customerUuid(customer)?customer:customerUuid(linkCustomer)?linkCustomer:null;
  return <ScheduleNavigationProvider context={navigation}><main className="customers vehicle-page">
    {customerId&&<a className="record-return-link" href={'/customers?customer='+encodeURIComponent(customerId)+'&view=vehicles'+(vehicleId?'&focusVehicle='+encodeURIComponent(vehicleId):'')}>Back to customer vehicles</a>}
    {vehicleId&&<BackToSavedJob job={job} jobVehicle={jobVehicle} navigation={navigation}/>}
    <h1>Vehicles</h1><VehicleScreen initialVehicleId={vehicleId} initialVisits={view==='visits'} linkCustomerId={customerUuid(linkCustomer)?linkCustomer:null}/>
  </main></ScheduleNavigationProvider>;
}
