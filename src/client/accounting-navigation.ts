import {expenseDate} from '../bookkeeping/expenses/expense-contract';
import {customerUuid} from '../customer/customer-contract';

// Read-only choices and an opaque history pointer. No balances, account names,
// editable account payloads, commands or credentials.
export function readAccountingNavigation(input:Readonly<Record<string,unknown>>){
 const view=input.view==='reports'||input.view==='accounts'||input.view==='setup'?input.view:null;
 const knownView=input.view==null||view!==null;
 const report=knownView&&(input.report==='income'||input.report==='funds'||input.report==='receivables')?input.report:'ledger';
 const date=(name:string)=>knownView&&expenseDate(input[name])?input[name]:'';
 const accountHistory=knownView&&customerUuid(input.accountHistory)?input.accountHistory:'';
 const accountsArchived=knownView&&(input.accountsArchived==='show'||input.accountsArchived===true);
 return {view,report,accountHistory,accountsArchived,ledgerThrough:date('ledgerThrough'),incomeFrom:date('incomeFrom'),
  incomeThrough:date('incomeThrough'),fundsThrough:date('fundsThrough'),receivablesThrough:date('receivablesThrough')} as const;
}
export type AccountingNavigation=ReturnType<typeof readAccountingNavigation>;
export function accountingNavigationHref(input:Readonly<Record<string,unknown>>){
 const current=readAccountingNavigation(input),params=new URLSearchParams();
 if(current.view)params.set('view',current.view);
 if(current.report!=='ledger')params.set('report',current.report);
 if(current.accountHistory)params.set('accountHistory',current.accountHistory);
 if(current.accountsArchived)params.set('accountsArchived','show');
 for(const key of ['ledgerThrough','incomeFrom','incomeThrough','fundsThrough','receivablesThrough'] as const)
  if(current[key])params.set(key,current[key]);
 return '/settings/accounts'+(params.size?'?'+params.toString():'');
}
