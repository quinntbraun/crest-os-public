import {expect,it} from 'vitest';
import {mappingNavigationHref,readMappingNavigation} from '../../src/client/mapping-navigation';

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
