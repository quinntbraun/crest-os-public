import {expenseDate} from '../bookkeeping/expenses/expense-contract';

// Harmless view/filter metadata only. Never retain a bill, payment payload,
// amount, original reference or authorization in the URL.
export function readExpenseNavigation(input:Readonly<Record<string,unknown>>){
 const view=input.view==='suppliers'||input.view==='exports'?input.view:'purchases';
 const knownView=input.view===undefined||input.view==='purchases'||input.view==='suppliers'||input.view==='exports';
 const payablesThrough=knownView&&expenseDate(input.payablesThrough)?input.payablesThrough:'';
 return {view,payablesThrough} as const;
}
export function expenseNavigationHref(view:unknown,payablesThrough:unknown=''){
 const current=readExpenseNavigation({view,payablesThrough}),params=new URLSearchParams();
 if(current.view!=='purchases')params.set('view',current.view);
 if(current.payablesThrough)params.set('payablesThrough',current.payablesThrough);
 return '/expenses'+(params.size?'?'+params.toString():'');
}
