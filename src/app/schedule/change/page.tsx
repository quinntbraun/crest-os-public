import {ScheduleLink,ScheduleNavigationProvider} from '../navigation';
import {readScheduleNavigation} from '../../../client/schedule-navigation';
import {JobChangeScreen} from './change';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ChangeJobPage({searchParams}:{searchParams:Promise<{job?:string|string[];kind?:string|string[]}>}){
 const query=await searchParams,jobId=customerUuid(query.job)?query.job:'',kind=query.kind==='cancel'?'cancel':'reschedule';
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers appointment-change-page">
  <header className="workflow-heading">
   <ScheduleLink className="field-back-link" href={jobId?'/schedule?job='+encodeURIComponent(jobId):'/schedule'}>{jobId?'Back to saved job':'Back to Schedule'}</ScheduleLink>
   <h1>{kind==='cancel'?'Cancel scheduled job':'Change appointment'}</h1>
  </header>
  <JobChangeScreen jobId={jobId} kind={kind}/>
 </main></ScheduleNavigationProvider>;
}
