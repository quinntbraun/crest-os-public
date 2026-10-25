import {customerInstant} from '../../customer/customer-contract';
// Only the explicit current-time button samples a Date. Existing effective
// times remain untouched strings with all six UTC microsecond digits.
export function associationCurrentTime(value:Date):string{
 let text:string;try{text=value.toISOString().replace(/\.([0-9]{3})Z$/,(_whole,millis:string)=>'.'+millis+'000Z');}catch{throw new Error('ASSOCIATION_TIME_INVALID');}
 if(!customerInstant(text))throw new Error('ASSOCIATION_TIME_INVALID');return text;
}
