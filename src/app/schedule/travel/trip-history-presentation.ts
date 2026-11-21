import type {SupportTrip} from '../../../operations/support-trip';

const fields:readonly {key:string;label:string;value:(trip:SupportTrip)=>string|null}[]=[
 {key:'purpose',label:'Purpose',value:trip=>trip.purpose},
 {key:'state',label:'Outcome',value:trip=>trip.state},
 {key:'origin',label:'Departure location',value:trip=>trip.origin.locationText},
 {key:'originInstructions',label:'Departure instructions',value:trip=>trip.origin.instructions},
 {key:'destination',label:'Destination / actual stop',value:trip=>trip.destination.locationText},
 {key:'destinationInstructions',label:'Destination instructions',value:trip=>trip.destination.instructions},
 {key:'departedAt',label:'Actual departure',value:trip=>trip.departedAt},
 {key:'arrivedAt',label:'Actual stop time',value:trip=>trip.arrivedAt},
 {key:'drivenVehicleId',label:'Driven vehicle reference',value:trip=>trip.drivenVehicleId},
 {key:'jobId',label:'Related job reference',value:trip=>trip.jobId},
 {key:'notes',label:'Notes',value:trip=>trip.notes},
];
// Presentation only: retained versions do not identify the command that created them.
// Compare exact facts only when the immediately preceding version is available.
export function tripRevisionChanges(previous:SupportTrip|undefined,current:SupportTrip){
 if(!previous||previous.legId!==current.legId||BigInt(previous.sequence)+1n!==BigInt(current.sequence))return null;
 return fields.flatMap(field=>{
  const before=field.value(previous),after=field.value(current);
  return before===after?[]:[{key:field.key,label:field.label,before,after}];
 });
}
