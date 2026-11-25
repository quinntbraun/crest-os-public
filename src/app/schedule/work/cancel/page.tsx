import {ScheduleLink,ScheduleNavigationProvider} from '../../navigation';
import {readScheduleNavigation} from '../../../../client/schedule-navigation';
import {customerUuid} from '../../../../customer/customer-contract';
import {FieldSessionScreen} from '../work';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function CancelStartedJobPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers field-work-page">
  <header className="workflow-heading">
   <ScheduleLink className="field-back-link" href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>{jobId?'Back to saved job':'Back to Schedule'}</ScheduleLink>
   <h1>Cancel started job</h1>
  </header>
  <FieldSessionScreen jobId={jobId} mode="cancellation"/>
 </main></ScheduleNavigationProvider>;
}
