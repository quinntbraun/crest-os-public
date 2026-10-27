import {customerInstant} from '../../customer/customer-contract';
function zonedParts(instant:string,zone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const get=(name:string)=>parts.find(part=>part.type===name)?.value??'';
 return get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute')+':'+get('second');
}
// Presentation only: the stored microseconds stay in the untouched source value.
export function followUpWall(instant:string,zone:string){
 try{return customerInstant(instant)?zonedParts(instant,zone).slice(0,16):'';}catch{return '';}
}
// Enumerate nearby actual offsets, then require exact round-trip equality.
// A gap returns none; a fold returns both. Neither is silently normalized.
export function followUpCandidates(wall:string,zone:string):readonly string[]{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)||!customerInstant(wall+':00.000000Z'))return [];
 try{
  const seed=Date.parse(wall+':00Z'),offsets=new Set<number>();
  for(let hours=-48;hours<=48;hours+=6){const sample=seed+hours*3600000,display=zonedParts(new Date(sample).toISOString(),zone);offsets.add(Date.parse(display+'Z')-sample);}
  const matches=new Set<string>();
  for(const offset of offsets){const candidate=new Date(seed-offset).toISOString().replace('.000Z','.000000Z');if(customerInstant(candidate)&&zonedParts(candidate,zone)===wall+':00')matches.add(candidate);}
  return [...matches].sort();
 }catch{return [];}
}
