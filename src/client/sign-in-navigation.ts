import {customerDate,customerInstant,customerUuid} from '../customer/customer-contract';
import {mappingNavigationHref} from './mapping-navigation';
import {readScheduleNavigation,scheduleNavigationHref} from './schedule-navigation';

const destinations=[
 ['home','/','Return to Today'],
 ['schedule','/schedule','Return to Schedule'],
 ['customers','/customers','Return to Customers'],
 ['vehicles','/vehicles','Return to Vehicles'],
 ['leads','/leads','Return to Leads'],
 ['quotes','/quotes','Return to Quotes'],
 ['expenses','/expenses','Return to Expenses'],
 ['contact-import','/customers/import-review','Return to contact import'],
 ['addresses','/addresses','Return to addresses'],
 ['lead-sources','/lead-sources','Return to lead sources'],
 ['services','/services','Return to Services'],
 ['appointment-proposals','/appointment-holds','Return to appointment proposals'],
 ['exports','/export-files','Return to data exports'],
 ['settings','/settings','Return to business settings'],
 ['accounting','/settings/accounts','Return to Accounting'],
 ['money-channels','/settings/accounts/channels','Return to money channels'],
 ['account-mappings','/settings/accounts/mappings','Return to account mappings'],
 ['category-mappings','/settings/accounts/mappings/categories','Return to category mappings'],
 ['mapping-approvals','/settings/accounts/mappings/manage','Return to mapping approvals'],
 ['category-approvals','/settings/accounts/mappings/categories/manage','Return to category approvals'],
 ['tax-profiles','/settings/accounts/tax','Return to tax profiles'],
 ['calendar','/settings/google-calendar','Return to Calendar setup'],
 ['arrangements','/schedule/modes','Return to service arrangements'],
 ['travel','/schedule/travel','Return to travel'],
 ['mileage','/schedule/mileage','Return to trip mileage'],
 ['work-time','/schedule/work/time','Return to recorded work time'],
] as const;
export type SignInDestination=typeof destinations[number][0];
const jobTasks=new Set(['/schedule/change','/schedule/new','/schedule/work','/schedule/work/complete','/schedule/work/cancel','/schedule/work/interrupt']);

// Return context is navigation metadata, never an authorization or a save request.
export function readSignInReturn(input:Readonly<Record<string,unknown>>):{href:string;label:string}|null{
 const destination=destinations.find(([key])=>key===input.returnTo);
 if(!destination)return null;
 const [key,path,label]=destination;
 if(['account-mappings','category-mappings','mapping-approvals','category-approvals'].includes(key))
  return {href:mappingNavigationHref(key==='category-mappings'||key==='category-approvals',
   key==='mapping-approvals'||key==='category-approvals',input),label};
 const url=new URL(path,'https://crest.invalid'),params=url.searchParams;
 const uuid=(name:string)=>{if(customerUuid(input[name]))params.set(name,input[name]);};
 if(key==='schedule'||key==='work-time'||key==='calendar')uuid('job');
 if(key==='leads')uuid('lead');
 if(key==='calendar'&&customerDate(input.activityFrom)&&customerDate(input.activityThrough)
  &&input.activityThrough>=input.activityFrom
  &&(Date.parse(input.activityThrough+'T12:00:00Z')-Date.parse(input.activityFrom+'T12:00:00Z'))/86400000<=92){
  params.set('activityFrom',input.activityFrom);params.set('activityThrough',input.activityThrough);
 }
 if(key==='travel'&&customerUuid(input.trip)&&customerInstant(input.at)){uuid('trip');params.set('at',input.at);}
 if(key==='schedule'&&params.has('job')){
  uuid('vehicle');
  if(input.from==='customer'||input.from==='today')params.set('from',input.from);
  else if(input.from==='vehicle'&&customerUuid(input.vehicle))params.set('from','vehicle');
  else if(input.from==='mileage'&&customerUuid(input.mileageLeg)){
   if(input.mileageJob===undefined){params.set('from','mileage');uuid('mileageLeg');}
   else if(customerUuid(input.mileageJob)&&customerInstant(input.mileageAt)){
    params.set('from','mileage');uuid('mileageLeg');uuid('mileageJob');params.set('mileageAt',input.mileageAt);
   }
  }
 }
 if(key==='customers'&&customerUuid(input.customer)){
  uuid('customer');uuid('job');
  if(typeof input.view==='string'&&['vehicles','visits','payments','history'].includes(input.view))params.set('view',input.view);
  if(input.view==='vehicles')uuid('focusVehicle');
 }
 if(key==='vehicles'){
  uuid('vehicle');uuid('customer');uuid('linkCustomer');
  if(customerUuid(input.vehicle)){
   uuid('job');if(customerUuid(input.job))uuid('jobVehicle');
   if(input.view==='visits')params.set('view','visits');
  }
 }
 if(key==='quotes'||key==='addresses')uuid('customer');
 if(key==='mileage'){
  if(input.leg===undefined&&customerUuid(input.job)){
   uuid('job');
   if(customerUuid(input.trip)&&customerInstant(input.at)){uuid('trip');params.set('at',input.at);}
  }else if(input.job===undefined)uuid('leg');
 }
 if(key==='accounting'&&typeof input.view==='string'&&['reports','accounts','setup'].includes(input.view))params.set('view',input.view);
 const href=scheduleNavigationHref(url.pathname+url.search,readScheduleNavigation(input));
 return {href,label:key==='schedule'&&params.has('job')?'Return to saved job':label};
}

export function signInHrefForPath(pathname:string,input:Readonly<Record<string,unknown>>,fallback?:SignInDestination):string{
 const current=destinations.find(([,path])=>path===pathname)?.[0]??(jobTasks.has(pathname)?'schedule':null);
 const key=current??fallback;
 if(!key||key==='home')return '/sign-in';
 const resume=readSignInReturn({...(current?input:{}),returnTo:key});
 if(!resume)return '/sign-in';
 const result=new URLSearchParams({returnTo:key});
 for(const [name,value] of new URL(resume.href,'https://crest.invalid').searchParams)result.set(name,value);
 return '/sign-in?'+result.toString();
}
