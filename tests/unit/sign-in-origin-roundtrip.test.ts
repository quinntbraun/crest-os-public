import ExpensesPage from '../../src/app/expenses/page';
import {ExpensesScreen} from '../../src/app/expenses/expenses';
import {isValidElement} from 'react';
import type {ReactNode} from 'react';
import {expect,it} from 'vitest';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';
import SignInPage from '../../src/app/sign-in/page';
import LeadsPage from '../../src/app/leads/page';
import TravelPage from '../../src/app/schedule/travel/page';
import SchedulePage from '../../src/app/schedule/page';
import {SignIn} from '../../src/app/sign-in/sign-in';
import {LeadScreen} from '../../src/app/leads/leads';
import {SupportTripScreen} from '../../src/app/schedule/travel/screen';
import {ScheduleScreen} from '../../src/app/schedule/screen';
import {ScheduleLink} from '../../src/app/schedule/navigation';

const job='11111111-1111-4111-8111-111111111111',vehicle='22222222-2222-4222-8222-222222222222';
const trip='33333333-3333-4333-8333-333333333333',at='2026-11-18T12:00:00.000001Z';
const query=(href:string)=>Object.fromEntries(new URL(href,'https://crest.invalid').searchParams);
function propsOf(node:ReactNode,type:unknown):Record<string,unknown>|null{
 if(Array.isArray(node)){for(const child of node){const found=propsOf(child,type);if(found)return found;}}
 if(isValidElement<Record<string,unknown>&{children?:ReactNode}>(node)){
  if(node.type===type)return node.props;
  return propsOf(node.props.children,type);
 }
 return null;
}
async function resume(path:string,input:Record<string,unknown>){
 const tree=await SignInPage({searchParams:Promise.resolve(query(signInHrefForPath(path,input)))});
 const value=propsOf(tree,SignIn)?.resume as {href:string;label:string}|undefined;
 expect(value).toBeDefined();return value!;
}

it('round-trips a selected lead through the sign-in page into the actual lead page',async()=>{
 const returned=await resume('/leads',{lead:job,password:'private',operationId:trip});
 expect(returned).toEqual({href:'/leads?lead='+job,label:'Return to Leads'});
 const page=await LeadsPage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,LeadScreen)?.initialLeadId).toBe(job);
});

it('round-trips the exact standalone trip identity into its actual page without correction input',async()=>{
 const returned=await resume('/schedule/travel',{trip,at,reason:'private',amount:'99',operationId:job});
 expect(query(returned.href)).toEqual({trip,at});
 const page=await TravelPage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,SupportTripScreen)?.initialTrip).toEqual({legId:trip,departedAt:at});
});

it.each(['customer','vehicle','today'] as const)('keeps the saved job and its %s origin for fresh server-page review',async from=>{
 const input={job,from,...from==='vehicle'?{vehicle}:{}};
 const returned=await resume('/schedule',input);
 expect(query(returned.href)).toEqual(input);
 const page=await SchedulePage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,ScheduleScreen)?.initialJobId).toBe(job);
 if(from==='vehicle')expect(propsOf(page,ScheduleScreen)).toMatchObject({initialJobVehicleId:vehicle,visitsSource:'vehicle'});
 if(from==='customer')expect(propsOf(page,ScheduleScreen)?.visitsSource).toBe('customer');
 if(from==='today')expect(propsOf(page,ScheduleLink)?.href).toBe('/');
});

it('keeps the canonical saved-job vehicle selection when no origin tag was supplied',async()=>{
 const returned=await resume('/schedule',{job,vehicle});
 const page=await SchedulePage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,ScheduleScreen)).toMatchObject({initialJobId:job,initialJobVehicleId:vehicle});
});

it.each([false,true])('restores a mileage return with job scope %s using the actual job-page link',async scoped=>{
 const input={job,from:'mileage',mileageLeg:trip,...scoped?{mileageJob:vehicle,mileageAt:at}:{}};
 const returned=await resume('/schedule',input);
 expect(query(returned.href)).toEqual(input);
 const page=await SchedulePage({searchParams:Promise.resolve(query(returned.href))});
 const href=propsOf(page,ScheduleLink)?.href as string;
 expect(new URL(href,'https://crest.invalid').pathname).toBe('/schedule/mileage');
 expect(query(href)).toEqual(scoped?{job:vehicle,trip,at}:{leg:trip});
});

it.each([{trip:[trip],at},{trip,at:[at]},{trip,at:'2026-11-18T12:00:00Z'},{trip:'invalid',at}])('drops incomplete or duplicated standalone trip identity',input=>{
 expect(readSignInReturn({returnTo:'travel',...input})?.href).toBe('/schedule/travel');
});

it('rejects invalid and duplicated origins without dropping the valid saved job',()=>{
 for(const input of [{from:['today']},{from:'https://elsewhere.invalid'},{from:'vehicle',vehicle:[vehicle]},
  {from:'mileage',mileageLeg:trip,mileageJob:[vehicle],mileageAt:at},
  {from:'mileage',mileageLeg:trip,mileageJob:vehicle,mileageAt:'invalid'}])
  expect(query(readSignInReturn({returnTo:'schedule',job,...input})!.href)).toEqual({job});
 expect(readSignInReturn({returnTo:'leads',lead:[job]})?.href).toBe('/leads');
 expect(readSignInReturn({returnTo:'schedule',job:[job],vehicle,from:'vehicle'})?.href).toBe('/schedule');
});

it('keeps Calendar activity dates through sign-in while dropping OAuth and private fields',async()=>{
 const dates={activityFrom:'2026-11-01',activityThrough:'2026-11-30'};
 const returned=await resume('/settings/google-calendar',{job,...dates,code:'private-oauth-code',state:'private-oauth-state',password:'private',redirect:'https://elsewhere.invalid'});
 expect(new URL(returned.href,'https://crest.invalid').pathname).toBe('/settings/google-calendar');
 expect(query(returned.href)).toEqual({job,...dates});
});

it.each([
 {activityFrom:['2026-11-01'],activityThrough:'2026-11-30'},
 {activityFrom:'2026-11-01',activityThrough:['2026-11-30']},
 {activityFrom:'2026-02-30',activityThrough:'2026-03-10'},
 {activityFrom:'2026-11-30',activityThrough:'2026-11-01'},
 {activityFrom:'2026-11-01'},
 {activityThrough:'2026-11-30'},
])('drops invalid, incomplete or duplicated Calendar activity dates',dates=>{
 expect(query(readSignInReturn({returnTo:'calendar',job,...dates})!.href)).toEqual({job});
});

it('bounds Calendar date navigation while leaving actual business-zone validation to its reader',()=>{
 expect(query(readSignInReturn({returnTo:'calendar',activityFrom:'2026-01-01',activityThrough:'2026-04-03'})!.href))
  .toEqual({activityFrom:'2026-01-01',activityThrough:'2026-04-03'});
 expect(readSignInReturn({returnTo:'calendar',activityFrom:'2026-01-01',activityThrough:'2026-04-04'})?.href)
  .toBe('/settings/google-calendar');
});


it.each(['suppliers','exports'] as const)('restores the %s expense view through the actual sign-in and expense pages',async view=>{
 const returned=await resume('/expenses',{view,vendor:'private',amount:'99',operationId:job});
 expect(query(returned.href)).toEqual({view});
 const page=await ExpensesPage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,ExpensesScreen)?.initialPane).toBe(view);
});

it.each([{view:'unknown'},{view:'//elsewhere.invalid'},{view:['suppliers']}])('ignores an invalid expense view and starts in Purchases',async({view})=>{
 expect(readSignInReturn({returnTo:'expenses',view})?.href).toBe('/expenses');
 const page=await ExpensesPage({searchParams:Promise.resolve({view})});
 expect(propsOf(page,ExpensesScreen)?.initialPane).toBe('purchases');
});

it('restores the supplier register date through the actual sign-in and expense pages',async()=>{
 const returned=await resume('/expenses',{view:'suppliers',payablesThrough:'2024-02-29',vendor:'private',paidCents:'99'});
 expect(query(returned.href)).toEqual({view:'suppliers',payablesThrough:'2024-02-29'});
 const page=await ExpensesPage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,ExpensesScreen)?.initialPane).toBe('suppliers');
 expect(propsOf(page,ExpensesScreen)?.initialPayablesThrough).toBe('2024-02-29');
});

it.each(['exports','purchases'] as const)('retains the inactive supplier date through the actual %s return page',async view=>{
 const returned=await resume('/expenses',{view,payablesThrough:'2024-02-29'});
 const page=await ExpensesPage({searchParams:Promise.resolve(query(returned.href))});
 expect(propsOf(page,ExpensesScreen)?.initialPane).toBe(view);
 expect(propsOf(page,ExpensesScreen)?.initialPayablesThrough).toBe('2024-02-29');
});

it.each(['2026-02-29',['2026-11-22'],'//elsewhere.invalid'])('does not pass an invalid date into the expense workspace %j',async payablesThrough=>{
 const page=await ExpensesPage({searchParams:Promise.resolve({view:'suppliers',payablesThrough})});
 expect(propsOf(page,ExpensesScreen)?.initialPayablesThrough).toBe('');
});
