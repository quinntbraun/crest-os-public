import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {expensePayloadChanges,ExpenseRevisionHistory} from '../../src/app/expenses/expense-revision-history';
import type {ExpenseRevision} from '../../src/bookkeeping/expenses/expense-contract';
const businessId=randomUUID(),expenseId=randomUUID();
const first:ExpenseRevision=Object.freeze({businessId,expenseId,revision:'1',operationId:randomUUID(),actorId:randomUUID(),recordedAt:'2026-11-17T10:00:00.123456Z',payload:Object.freeze({paidOn:'2026-11-01',amountCents:'1299',currency:'USD',category:'supplies',description:'Fictional towels',vendor:null,paymentMethod:'card',reference:null,notes:'Retain original\nsecond line',voided:false,changeReason:null})});
it('compares exact saved values without mutating history or replacing null with a guessed value',()=>{
 const second={...first,revision:'2',payload:{...first.payload,amountCents:'1399',vendor:'Fictional merchant',notes:null,changeReason:'Corrected receipt'}};
 const before=JSON.stringify([first,second]);expect(expensePayloadChanges(first,second)).toEqual([
  {key:'amountCents',label:'Amount',before:'$12.99 USD',after:'$13.99 USD'},
  {key:'vendor',label:'Vendor',before:'Not recorded',after:'Fictional merchant'},
  {key:'notes',label:'Notes',before:'Retain original\nsecond line',after:'Not recorded'},
 ]);expect(JSON.stringify([first,second])).toBe(before);
});
it('does not compare a different expense/business or skip an unavailable revision',()=>{
 for(const previous of [undefined,{...first,expenseId:randomUUID()},{...first,businessId:randomUUID()},{...first,revision:'3'}])expect(expensePayloadChanges(previous,{...first,revision:'2'})).toBeNull();
});
it('shows a void as a state change, preserves the original amount, and orders by revision rather than clock time',()=>{
 const second={...first,revision:'2',recordedAt:'2026-11-16T10:00:00.654321Z',payload:{...first.payload,voided:true,changeReason:'Duplicate fictional purchase'}};
 expect(expensePayloadChanges(first,second)).toEqual([{key:'voided',label:'Record state',before:'Recorded',after:'Void'}]);
 const html=renderToStaticMarkup(createElement(ExpenseRevisionHistory,{revisions:[second,first]}));
 expect(html.indexOf('Revision 2:')).toBeLessThan(html.indexOf('Revision 1:'));expect(html).toContain('Amount retained for history');expect(html).toContain('Duplicate fictional purchase');expect(html).toContain(first.recordedAt);expect(html).toContain(second.recordedAt);expect(html).toContain(first.actorId);expect(html).toContain('$12.99 USD');
});
