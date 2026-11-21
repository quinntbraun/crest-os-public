import {FulfillmentModesScreen} from './screen';
import {ScheduleNavigationProvider} from '../navigation';
import {readScheduleNavigation} from '../../../client/schedule-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ServiceArrangementsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 return <ScheduleNavigationProvider context={readScheduleNavigation(await searchParams)}><main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Service arrangements</h1><FulfillmentModesScreen/></main></ScheduleNavigationProvider>;
}
