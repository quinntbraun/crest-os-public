import {ScheduleLink,ScheduleNavigationProvider} from './navigation';
import {readScheduleNavigation} from '../../client/schedule-navigation';
import {ScheduleScreen} from './screen';
import {customerInstant,customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function SchedulePage({searchParams}:{searchParams:Promise<{job?:string|string[];vehicle?:string|string[];from?:string|string[];mileageJob?:string|string[];mileageLeg?:string|string[];mileageAt?:string|string[]}>}){
 const input=await searchParams,jobId=customerUuid(input.job)?input.job:undefined;
 const vehicleId=jobId&&customerUuid(input.vehicle)?input.vehicle:undefined;
 const visitsSource=jobId&&input.from==='customer'?'customer':vehicleId&&input.from==='vehicle'?'vehicle':undefined;
 const todaySource=jobId&&input.from==='today';
 const mileageSource=jobId&&input.from==='mileage'&&customerUuid(input.mileageLeg)?input.mileageLeg:null;
 const mileageReturn=mileageSource&&customerUuid(input.mileageJob)&&customerInstant(input.mileageAt)?
  '/schedule/mileage?'+new URLSearchParams({job:input.mileageJob,trip:mileageSource,at:input.mileageAt}):
  mileageSource&&input.mileageJob===undefined?'/schedule/mileage?'+new URLSearchParams({leg:mileageSource}):null;
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className={'customers schedule-page'+(jobId?' schedule-job-page':'')}><header className="workflow-heading">
  {jobId&&<nav aria-label="Job navigation"><ScheduleLink href={mileageReturn??(todaySource?'/':'/schedule')}>{mileageReturn?'Back to trip mileage':todaySource?'Back to Today':'Back to Schedule'}</ScheduleLink></nav>}
  <h1>{jobId?'Job':'Schedule'}</h1></header>
  <ScheduleScreen {...jobId?{initialJobId:jobId}:{}} {...vehicleId?{initialJobVehicleId:vehicleId}:{}} {...visitsSource?{visitsSource}:{}}/>
 </main></ScheduleNavigationProvider>;
}
