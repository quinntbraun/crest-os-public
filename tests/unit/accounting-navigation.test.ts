import {expect,it} from 'vitest';
import {accountingNavigationHref,readAccountingNavigation} from '../../src/client/accounting-navigation';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';

const filters={report:'income',ledgerThrough:'2026-11-01',incomeFrom:'2026-10-01',incomeThrough:'2026-10-31',
 fundsThrough:'2026-10-15',receivablesThrough:'2026-10-20'};
const query=(href:string)=>Object.fromEntries(new URL(href,'https://crest.invalid').searchParams);

it.each(['reports','accounts','setup'])('retains each report filter across the %s section and sign-in',view=>{
 const input={view,...filters};
 const link=signInHrefForPath('/settings/accounts',{...input,amount:'private',accountName:'private',operationId:'private',csrf:'private'});
 expect(query(link)).toEqual({returnTo:'accounting',...input});
 const returned=readSignInReturn(query(link));
 expect(returned).toEqual({href:accountingNavigationHref(input),label:'Return to Accounting'});
 expect(readAccountingNavigation(query(returned!.href))).toEqual({...input,accountHistory:'',accountsArchived:false});
});

it.each(['ledgerThrough','incomeFrom','incomeThrough','fundsThrough','receivablesThrough'])('rejects invalid and duplicated %s without changing other valid filters',key=>{
 for(const invalid of ['2026-02-30','2026-13-01','1899-12-31','2026-1-01',['2026-11-01'],{},'https://outside.invalid']){
  const result=readAccountingNavigation({...filters,[key]:invalid});
  expect(result[key as keyof typeof result]).toBe('');
  expect(query(accountingNavigationHref({...filters,[key]:invalid}))).not.toHaveProperty(key);
 }
});

it('keeps only finite known sections and report choices',()=>{
 for(const view of ['other',['reports'],{}]){
  expect(accountingNavigationHref({view,...filters})).toBe('/settings/accounts');
 }
 for(const report of ['other',['income'],{}])expect(readAccountingNavigation({report}).report).toBe('ledger');
 expect(accountingNavigationHref({})).toBe('/settings/accounts');
 expect(accountingNavigationHref({view:'reports',report:'ledger',ledgerThrough:'2026-11-01'}))
  .toBe('/settings/accounts?view=reports&ledgerThrough=2026-11-01');
 expect(readAccountingNavigation(readAccountingNavigation(filters))).toEqual(readAccountingNavigation(filters));
});

it('does not carry report criteria to another destination or reinterpret them as a command',()=>{
 expect(query(signInHrefForPath('/settings/accounts/channels',filters))).toEqual({returnTo:'money-channels'});
 expect(query(signInHrefForPath('/customers',filters))).toEqual({returnTo:'customers'});
 expect(accountingNavigationHref({...filters,view:'reports',returnTo:'https://outside.invalid',command:'post',throughOn:'2026-12-01'}))
  .toBe(accountingNavigationHref({...filters,view:'reports'}));
});

const account='11111111-1111-4111-8111-111111111111';
it.each(['reports','accounts','setup'])('preserves only an opaque history selection and archived filter through %s and sign-in',view=>{
 const input={view,accountHistory:account,accountsArchived:'show',...filters};
 const href=accountingNavigationHref({...input,accountName:'private',expectedVersion:'3',reason:'private',accountType:'asset'});
 expect(query(href)).toEqual(input);
 const link=signInHrefForPath('/settings/accounts',query(href));
 expect(readSignInReturn(query(link))?.href).toBe(href);
 expect(readAccountingNavigation(query(href))).toEqual({...input,accountsArchived:true});
 expect(accountingNavigationHref(readAccountingNavigation(query(href)))).toBe(href);
 expect(query(signInHrefForPath('/settings/accounts/channels',input))).toEqual({returnTo:'money-channels'});
});

it('rejects duplicate, malformed and foreign navigation fields without treating them as account edits',()=>{
 for(const value of [[account],{},'bad-id','https://elsewhere.invalid',null]){
  expect(readAccountingNavigation({view:'accounts',accountHistory:value}).accountHistory).toBe('');
  expect(query(accountingNavigationHref({view:'accounts',accountHistory:value}))).not.toHaveProperty('accountHistory');
 }
 for(const value of [['show'],'true',1,{},'hide'])expect(readAccountingNavigation({accountsArchived:value}).accountsArchived).toBe(false);
 expect(accountingNavigationHref({view:['accounts'],accountHistory:account,accountsArchived:'show'})).toBe('/settings/accounts');
 expect(accountingNavigationHref({view:'accounts',accountHistory:account,accountsArchived:false}))
  .toBe('/settings/accounts?view=accounts&accountHistory='+account);
});
