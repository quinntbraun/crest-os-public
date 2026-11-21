import {CustomerScreen} from './customers';
import {BackToSavedJob} from '../schedule/back-to-saved-job';
import {customerUuid} from '../../customer/customer-contract';
import {ScheduleNavigationProvider} from '../schedule/navigation';
import {readScheduleNavigation} from '../../client/schedule-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function CustomersPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams,{customer,job,view,focusVehicle}=params;
  const navigation=customerUuid(job)?readScheduleNavigation(params):null;
  const customerId=customerUuid(customer)?customer:null;
  const section=view==='vehicles'||view==='visits'||view==='payments'||view==='history'?view:'overview';
  return <ScheduleNavigationProvider context={navigation}><main className="customers customer-directory-page">
    {customerId&&<BackToSavedJob job={job} navigation={navigation}/>}
    <h1>Customers</h1><CustomerScreen key={customerId} initialCustomerId={customerId} initialSection={section} initialVehicleFocus={section==='vehicles'&&customerUuid(focusVehicle)?focusVehicle:null}/>
  </main></ScheduleNavigationProvider>;
}
