import {ScheduleLink,ScheduleNavigationProvider} from '../../navigation';
import {readScheduleNavigation} from '../../../../client/schedule-navigation';
import {customerUuid} from '../../../../customer/customer-contract';
import {WorkTimeScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function WorkTimePage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){
 const {job}=await searchParams;
 const jobId=typeof job==='string'&&customerUuid(job)?job:'';
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers work-time-page">
  {jobId&&<ScheduleLink className="record-return-link" href={'/schedule?job='+encodeURIComponent(jobId)}>Saved job and history</ScheduleLink>}
  <h1>Recorded work time</h1>
  <WorkTimeScreen jobId={jobId}/>
 </main></ScheduleNavigationProvider>;
}
