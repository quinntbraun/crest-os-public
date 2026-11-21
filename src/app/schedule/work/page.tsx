import {ScheduleLink,ScheduleNavigationProvider} from '../navigation';
import {readScheduleNavigation} from '../../../client/schedule-navigation';
import {FieldSessionScreen} from './work';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function FieldWorkPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams,jobId=customerUuid(job)?job:'';
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers field-work-page">
  <header className="workflow-heading">
   <ScheduleLink className="field-back-link" href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>{jobId?'Back to saved job':'Back to Schedule'}</ScheduleLink>
   <h1>Work status</h1>
  </header>
  <FieldSessionScreen jobId={jobId}/>
 </main></ScheduleNavigationProvider>;
}
