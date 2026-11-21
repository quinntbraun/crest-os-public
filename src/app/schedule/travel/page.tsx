import {customerInstant,customerUuid} from '../../../customer/customer-contract';
import {SupportTripScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function TravelPage({searchParams}:{searchParams:Promise<{trip?:string|string[];at?:string|string[]}>}){
 const {trip,at}=await searchParams;
 const initialTrip=customerUuid(trip)&&customerInstant(at)?{legId:trip,departedAt:at}:null;
 return <main className="customers travel-page">
  <a className="record-return-link" href="/schedule">Back to Schedule</a>
  <h1>Standalone travel</h1>
  <SupportTripScreen initialTrip={initialTrip}/>
 </main>;
}
