import {customerUuid} from '../../customer/customer-contract';
import {scheduleNavigationHref} from '../../client/schedule-navigation';
import type {ScheduleNavigation} from '../../client/schedule-navigation';

export function BackToSavedJob({job,jobVehicle,navigation=null}:{job:unknown;jobVehicle?:unknown;navigation?:ScheduleNavigation|null}){
  if(!customerUuid(job))return null;
  const params=new URLSearchParams({job});
  if(customerUuid(jobVehicle))params.set('vehicle',jobVehicle);
  return <a className="record-return-link" href={scheduleNavigationHref('/schedule?'+params.toString(),navigation)}>Back to saved job</a>;
}
