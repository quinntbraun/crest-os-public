import {CustomerScreen} from './customers';
import {BackToSavedJob} from '../schedule/back-to-saved-job';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function CustomersPage({searchParams}:{searchParams:Promise<{customer?:string|string[];job?:string|string[];view?:string|string[];focusVehicle?:string|string[]}>}){
  const {customer,job,view,focusVehicle}=await searchParams;
  const customerId=customerUuid(customer)?customer:null;
  const section=view==='vehicles'||view==='visits'||view==='payments'||view==='history'?view:'overview';
  return <main className="customers customer-directory-page">
    {customerId&&<BackToSavedJob job={job}/>}
    <h1>Customers</h1><CustomerScreen key={customerId} initialCustomerId={customerId} initialSection={section} initialVehicleFocus={section==='vehicles'&&customerUuid(focusVehicle)?focusVehicle:null}/>
  </main>;
}
