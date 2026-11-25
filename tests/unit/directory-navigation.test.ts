import {isValidElement} from 'react';
import type {ReactNode} from 'react';
import {expect,it} from 'vitest';
import {directoryDestinations,readDirectoryInclude,readLeadNavigation} from '../../src/client/directory-navigation';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';
import CustomersPage from '../../src/app/customers/page';
import VehiclesPage from '../../src/app/vehicles/page';
import LeadsPage from '../../src/app/leads/page';
import ServicesPage from '../../src/app/services/page';
import {CustomerScreen} from '../../src/app/customers/customers';
import {VehicleScreen} from '../../src/app/vehicles/vehicles';
import {LeadScreen} from '../../src/app/leads/leads';
import {ServiceScreen} from '../../src/app/services/services';
const id='11111111-1111-4111-8111-111111111111';
function propsOf(node:ReactNode,type:unknown):Record<string,unknown>|null{
 if(Array.isArray(node)){for(const child of node){const found=propsOf(child,type);if(found)return found;}}
 if(isValidElement<Record<string,unknown>&{children?:ReactNode}>(node)){
  if(node.type===type)return node.props;
  return propsOf(node.props.children,type);
 }
 return null;
}
it('round-trips each finite inclusion flag and opaque record into its actual directory page',async()=>{
 const cases=[['customers',CustomersPage,CustomerScreen,'initialCustomerId'],['vehicles',VehiclesPage,VehicleScreen,'initialVehicleId'],
  ['leads',LeadsPage,LeadScreen,'initialLeadId'],['services',ServicesPage,ServiceScreen,'initialServiceId']] as const;
 for(const [kind,Page,Screen,property]of cases){
  const config=directoryDestinations[kind],input={[config.parameter]:id,include:config.include};
  const link=signInHrefForPath(config.path,{...input,search:'private name',draft:'private',notes:'private',operationId:id});
  const returned=readSignInReturn(Object.fromEntries(new URL(link,'https://crest.invalid').searchParams));
  expect(returned?.href).toBe(config.path+'?include='+config.include+'&'+config.parameter+'='+id);
  const page=await Page({searchParams:Promise.resolve(Object.fromEntries(new URL(returned!.href,'https://crest.invalid').searchParams))});
  expect(propsOf(page,Screen)?.[property]).toBe(id);
  expect(propsOf(page,Screen)?.initialIncludeAll).toBe(true);
  for(const invalid of [[config.include],'true','other',{},null])expect(readDirectoryInclude(kind,{include:invalid})).toBe(false);
  const invalid=await Page({searchParams:Promise.resolve({[config.parameter]:[id],include:[config.include]})});
  expect(propsOf(invalid,Screen)?.[property]).toBeNull();
  expect(propsOf(invalid,Screen)?.initialIncludeAll).toBe(false);
 }
});

it('round-trips the lead directory mode and finite reminder filter into the actual page',async()=>{
 for(const directory of [false,true])for(const reminders of ['all','due','upcoming'] as const){
  const input={lead:id,include:'lost',view:directory?'directory':'follow-ups',reminders,search:'private'};
  const link=signInHrefForPath('/leads',input),returned=readSignInReturn(Object.fromEntries(new URL(link,'https://crest.invalid').searchParams));
  const params=Object.fromEntries(new URL(returned!.href,'https://crest.invalid').searchParams);
  expect(params).toEqual({lead:id,include:'lost',...(directory?{view:'directory'}:{}),...(reminders!=='all'?{reminders}:{})});
  const page=await LeadsPage({searchParams:Promise.resolve(params)});
  expect(propsOf(page,LeadScreen)?.initialDirectory).toBe(directory);
  expect(propsOf(page,LeadScreen)?.initialFollowUpFilter).toBe(reminders);
 }
 for(const value of [['due'],'unknown',{},null])expect(readLeadNavigation({view:value,reminders:value})).toEqual({directory:false,reminders:'all'});
 expect(readSignInReturn({returnTo:'customers',customer:id,view:'directory',reminders:'due'})?.href).toBe('/customers?customer='+id);
});
