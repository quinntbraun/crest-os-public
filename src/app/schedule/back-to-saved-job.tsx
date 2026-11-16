import {customerUuid} from '../../customer/customer-contract';

export function BackToSavedJob({job,jobVehicle}:{job:unknown;jobVehicle?:unknown}){
  if(!customerUuid(job))return null;
  const params=new URLSearchParams({job});
  if(customerUuid(jobVehicle))params.set('vehicle',jobVehicle);
  return <a className="record-return-link" href={'/schedule?'+params.toString()}>Back to saved job</a>;
}
