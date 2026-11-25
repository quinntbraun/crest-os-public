import {expect,it} from 'vitest';
import {mappingNavigationHref,readMappingAttention,readMappingNavigation} from '../../src/client/mapping-navigation';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';
import {Children,isValidElement} from 'react';
import ExpenseCategoryMappingsPage from '../../src/app/settings/accounts/mappings/categories/page';
import {FinanceMappingsScreen} from '../../src/app/settings/accounts/mappings/screen';

it('round-trips a selected purpose or category and lookup date through known destinations',()=>{
 for(const categories of [false,true]){
  const purpose=categories?'category_fuel':'service_revenue';
  for(const manage of [false,true]){
   const href=mappingNavigationHref(categories,manage,{purpose,lookupOn:'2026-11-18'});
   const url=new URL(href,'https://crest.invalid');
   expect(url.pathname).toBe('/settings/accounts/mappings'+(categories?'/categories':'')+(manage?'/manage':''));
   expect(readMappingNavigation(Object.fromEntries(url.searchParams),categories)).toEqual({purpose,date:'2026-11-18'});
  }
 }
});

it('retains only the finite category attention filter through lookup, management and sign-in',()=>{
 const input={purpose:'category_fuel',lookupOn:'2026-11-18',attention:'only'};
 for(const manage of [false,true]){
  const href=mappingNavigationHref(true,manage,input);
  expect(new URL(href,'https://crest.invalid').searchParams.get('attention')).toBe('only');
  const signIn=signInHrefForPath('/settings/accounts/mappings/categories'+(manage?'/manage':''),input);
  expect(readSignInReturn(Object.fromEntries(new URL(signIn,'https://crest.invalid').searchParams))?.href).toBe(href);
 }
 expect(readMappingAttention({attention:true},true)).toBe(true);
 for(const attention of [['only'],'all','true',1,{},null])expect(readMappingAttention({attention},true)).toBe(false);
 expect(readMappingAttention(input,false)).toBe(false);
 expect(mappingNavigationHref(false,false,{purpose:'service_revenue',attention:'only'}))
  .toBe('/settings/accounts/mappings?purpose=service_revenue');
});

it('passes validated restored filters into the actual category lookup page',async()=>{
 for(const [attention,expected]of [['only',true],[['only'],false]] as const){
  const page=await ExpenseCategoryMappingsPage({searchParams:Promise.resolve({purpose:'category_fuel',lookupOn:'2026-11-18',attention:typeof attention==='string'?attention:[...attention]})});
  const screen=Children.toArray(page.props.children).find(child=>isValidElement(child)&&child.type===FinanceMappingsScreen);
  expect(isValidElement<Record<string,unknown>>(screen)&&screen.props.initialAttention).toBe(expected);
  expect(isValidElement<Record<string,unknown>>(screen)&&screen.props.initialPurpose).toBe('category_fuel');
  expect(isValidElement<Record<string,unknown>>(screen)&&screen.props.initialDate).toBe('2026-11-18');
 }
});

it('rejects purposes from the other mapping family and duplicate parameters',()=>{
 expect(readMappingNavigation({purpose:'service_revenue'},true).purpose).toBe('');
 expect(readMappingNavigation({purpose:'category_fuel'},false).purpose).toBe('');
 for(const categories of [false,true])
  expect(readMappingNavigation({purpose:['service_revenue','category_fuel'],lookupOn:['2026-11-18','2026-11-19']},categories)).toEqual({purpose:'',date:''});
});

it('rejects invalid calendar dates and arbitrary query values',()=>{
 for(const lookupOn of ['2026-02-30','2026-13-01','today',undefined,{},['2026-11-18']])
  expect(readMappingNavigation({purpose:'unknown',lookupOn},false)).toEqual({purpose:'',date:''});
});

it('carries no record identifiers, private text, approval date or redirect destination',()=>{
 expect(mappingNavigationHref(false,true,{purpose:'service_revenue',lookupOn:'2026-11-18',
  accountId:'private-id',reason:'private-text',effectiveFrom:'2027-01-01',returnTo:'https://elsewhere.invalid'}))
  .toBe('/settings/accounts/mappings/manage?purpose=service_revenue&lookupOn=2026-11-18');
 expect(mappingNavigationHref(true,false,{purpose:'https://elsewhere.invalid',lookupOn:'javascript:alert(1)'}))
  .toBe('/settings/accounts/mappings/categories');
});
