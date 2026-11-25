import {ScheduleLink,ScheduleNavigationProvider} from '../navigation';
import {readScheduleNavigation} from '../../../client/schedule-navigation';
import {BookJobScreen} from './booking';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function BookJobPage({searchParams}:{searchParams:Promise<{agreement?:string|string[]}>}){
 const input=await searchParams,familyId=customerUuid(input.agreement)?input.agreement:'';
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers booking-page">
  <header className="workflow-heading"><ScheduleLink className="field-back-link" href="/schedule">Back to Schedule</ScheduleLink><h1>Book a visit</h1></header>
  <BookJobScreen familyId={familyId}/>
 </main></ScheduleNavigationProvider>;
}
