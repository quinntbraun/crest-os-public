import {createElement,isValidElement} from 'react';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';
import {SignInLink} from '../../src/app/sign-in-link';
import SignInPage from '../../src/app/sign-in/page';
import {SignIn} from '../../src/app/sign-in/sign-in';

const job='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222';
const vehicle='33333333-3333-4333-8333-333333333333';
const query=(href:string)=>Object.fromEntries(new URL(href,'https://crest.invalid').searchParams);
const planner={plannerFrom:'2026-11-01',plannerThrough:'2026-11-30',plannerView:'month',plannerCalendar:'open',plannerRange:'open',plannerFocus:job,plannerY:'642',plannerWidth:'390'};

it('preserves the existing six sign-in destinations and saved-job wording',()=>{
 for(const [key,path] of [['schedule','/schedule'],['customers','/customers'],['leads','/leads'],['quotes','/quotes'],['expenses','/expenses'],['contact-import','/customers/import-review']])
  expect(readSignInReturn({returnTo:key})?.href).toBe(path);
 expect(readSignInReturn({returnTo:'schedule',job})).toEqual({href:'/schedule?job='+job,label:'Return to saved job'});
});

it('returns interrupted job tasks to fresh saved-job review with validated planner context',()=>{
 for(const path of ['/schedule/work','/schedule/work/complete','/schedule/work/cancel','/schedule/work/interrupt','/schedule/change']){
  const link=signInHrefForPath(path,{job,...planner,operationId:'private-operation',amount:'99',returnTo:'https://elsewhere.invalid'});
  expect(query(link)).toEqual({returnTo:'schedule',job,...planner});
  const resume=readSignInReturn(query(link));
  expect(new URL(resume!.href,'https://crest.invalid').pathname).toBe('/schedule');
  expect(query(resume!.href)).toEqual({job,...planner});
 }
});

it('restores only known customer/vehicle sections and validated record context',()=>{
 expect(query(readSignInReturn({returnTo:'customers',customer,job,view:'vehicles',focusVehicle:vehicle,...planner})!.href))
  .toEqual({customer,job,view:'vehicles',focusVehicle:vehicle,...planner});
 expect(query(readSignInReturn({returnTo:'vehicles',vehicle,customer,job,view:'visits',linkCustomer:customer,jobVehicle:vehicle})!.href))
  .toEqual({vehicle,customer,linkCustomer:customer,job,jobVehicle:vehicle,view:'visits'});
 expect(readSignInReturn({returnTo:'customers',customer:[customer],job,view:'payments'})!.href).toBe('/customers');
});

it('carries finance lookup context without pre-filling approval dates or exposing private values',()=>{
 const input={purpose:'category_fuel',lookupOn:'2026-11-18',effectiveFrom:'2027-01-01',accountId:job,password:'synthetic-private-text'};
 expect(signInHrefForPath('/settings/accounts/mappings/categories/manage',input))
  .toBe('/sign-in?returnTo=category-approvals&purpose=category_fuel&lookupOn=2026-11-18');
 expect(readSignInReturn({returnTo:'category-approvals',...input})!.href)
  .toBe('/settings/accounts/mappings/categories/manage?purpose=category_fuel&lookupOn=2026-11-18');
 expect(readSignInReturn({returnTo:'mapping-approvals',...input})!.href)
  .toBe('/settings/accounts/mappings/manage?lookupOn=2026-11-18');
 expect(readSignInReturn({returnTo:'accounting',view:'setup',accountId:job})!.href).toBe('/settings/accounts?view=setup');
});

it('preserves mutually exclusive mileage scopes and exact validated trip metadata',()=>{
 const at='2026-11-18T12:00:00.000001Z';
 expect(query(readSignInReturn({returnTo:'mileage',job,trip:vehicle,at})!.href)).toEqual({job,trip:vehicle,at});
 expect(query(readSignInReturn({returnTo:'mileage',leg:vehicle})!.href)).toEqual({leg:vehicle});
 expect(readSignInReturn({returnTo:'mileage',job,leg:vehicle,trip:vehicle,at})!.href).toBe('/schedule/mileage');
 expect(query(readSignInReturn({returnTo:'mileage',job,trip:vehicle,at:'invalid'})!.href)).toEqual({job});
});

it('rejects duplicate, malformed and arbitrary redirect context',()=>{
 for(const returnTo of ['https://elsewhere.invalid','//elsewhere.invalid','/customers',['schedule'],undefined])
  expect(readSignInReturn({returnTo,job})).toBeNull();
 expect(readSignInReturn({returnTo:'category-approvals',purpose:['category_fuel'],lookupOn:'2026-02-30'})!.href)
  .toBe('/settings/accounts/mappings/categories/manage');
 expect(readSignInReturn({returnTo:'accounting',view:['reports']})!.href).toBe('/settings/accounts');
 expect(readSignInReturn({returnTo:'customers',customer,view:Object.create(null)})!.href).toBe('/customers?customer='+customer);
});

it('uses a safe fallback for an unknown host page without copying its query',()=>{
 expect(signInHrefForPath('/unknown',{job,customer,returnTo:'schedule'})).toBe('/sign-in');
 expect(signInHrefForPath('/unknown',{customer},'customers')).toBe('/sign-in?returnTo=customers');
 expect(signInHrefForPath('/',{customer})).toBe('/sign-in');
});

it('renders normal accessible anchors without needing a router or browser during SSR',()=>{
 const markup=renderToStaticMarkup(createElement(SignInLink,{returnTo:'calendar',className:'primary-action'},'Sign in again'));
 expect(markup).toBe('<a class="primary-action" href="/sign-in?returnTo=calendar">Sign in again</a>');
});

it('keeps explicit selected-record metadata out of DOM attributes and uses a safe SSR fallback',()=>{
 const markup=renderToStaticMarkup(createElement(SignInLink,{returnTo:'customers',context:{customer,view:'payments',password:'private-context-value'}},'Sign in again'));
 expect(markup).toBe('<a href="/sign-in?returnTo=customers">Sign in again</a>');
 expect(markup).not.toContain('context=');expect(markup).not.toContain('private-context-value');
});

it('keeps original-operation recovery ahead of an ordinary workspace return',async()=>{
 const tree=await SignInPage({searchParams:Promise.resolve({resumeSave:'bookkeeping.expense.save',returnTo:'schedule',job})});
 function resume(node:ReactNode):unknown{
  if(Array.isArray(node)){for(const item of node){const found=resume(item);if(found)return found;}}
  if(isValidElement<{children?:ReactNode;resume?:unknown}>(node)){
   if(node.type===SignIn)return node.props.resume;
   return resume(node.props.children);
  }
  return null;
 }
 expect(resume(tree)).toEqual({href:'/save-review?kind=bookkeeping.expense.save',label:'Return to interrupted save'});
});
