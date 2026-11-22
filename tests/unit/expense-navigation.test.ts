import {describe,it,expect} from 'vitest';
import {expenseNavigationHref,readExpenseNavigation} from '../../src/client/expense-navigation';
import {readSignInReturn,signInHrefForPath} from '../../src/client/sign-in-navigation';

describe('safe supplier register date context',()=>{
 it('keeps the selected date on its actual supplier view and sign-in return',()=>{
  const input={view:'suppliers',payablesThrough:'2024-02-29',vendor:'private',paidCents:'999',operationId:'private'};
  expect(readExpenseNavigation(input)).toEqual({view:'suppliers',payablesThrough:'2024-02-29'});
  expect(expenseNavigationHref(input.view,input.payablesThrough)).toBe('/expenses?view=suppliers&payablesThrough=2024-02-29');
  expect(signInHrefForPath('/expenses',input)).toBe('/sign-in?returnTo=expenses&view=suppliers&payablesThrough=2024-02-29');
  expect(readSignInReturn({returnTo:'expenses',...input})?.href).toBe('/expenses?view=suppliers&payablesThrough=2024-02-29');
 });
 it.each(['2026-02-29','2026-13-01','2026-01-32','1899-12-31','//elsewhere.invalid','2026-01-01?paidCents=99',['2026-01-01'],null])('drops an invalid or nonscalar register date %j',payablesThrough=>{
  expect(readExpenseNavigation({view:'suppliers',payablesThrough})).toEqual({view:'suppliers',payablesThrough:''});
  expect(readSignInReturn({returnTo:'expenses',view:'suppliers',payablesThrough})?.href).toBe('/expenses?view=suppliers');
 });
 it.each(['unknown','//elsewhere.invalid',['suppliers']])('drops filters from an invalid expense view %j',view=>{
  const result=readExpenseNavigation({view,payablesThrough:'2026-11-22'});
  expect(result.payablesThrough).toBe('');expect(expenseNavigationHref(view,'2026-11-22')).toBe('/expenses');
 });
 it.each(['purchases','suppliers','exports'] as const)('keeps the inactive supplier date when switching to %s in the same workspace',view=>{
  const href=expenseNavigationHref(view,'2026-11-22');
  expect(new URL(href,'https://crest.invalid').searchParams.get('payablesThrough')).toBe('2026-11-22');
  expect(readSignInReturn({returnTo:'expenses',view,payablesThrough:'2026-11-22'})?.href).toBe(href);
 });
 it('does not carry this expense-only filter to an unrelated destination',()=>{
  expect(readSignInReturn({returnTo:'accounting',view:'reports',payablesThrough:'2026-11-22'})?.href).toBe('/settings/accounts?view=reports');
 });
 it('clears the optional date without losing the selected Suppliers view',()=>{
  expect(expenseNavigationHref('suppliers','')).toBe('/expenses?view=suppliers');
 });
});
