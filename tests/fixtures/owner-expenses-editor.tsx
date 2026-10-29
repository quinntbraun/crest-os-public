// Supplemental UI-only adapter. Not an authentication, persistence or backup proof.
import {createRoot} from 'react-dom/client';
import {ExpenseEditor} from '../../src/app/expenses/expense-editor';
import type {createExpenseClient,ExpenseContext} from '../../src/client/expenses';
import type {ExpenseRevision} from '../../src/bookkeeping/expenses/expense-contract';
const businessId='11111111-1111-1111-1111-111111111111',epoch='22222222-2222-2222-2222-222222222222',actorId='33333333-3333-3333-3333-333333333333';
const rows:ExpenseRevision[]=[];let loseReply=true;
const context:ExpenseContext={businessId,recoveryEpoch:epoch,writeState:'ready',binding:'synthetic-layout-only'};
const client:ReturnType<typeof createExpenseClient>={async context(){return context;},async history(){return rows;},async save(_context,request){let row=rows.find(r=>r.operationId===request.operationId);if(!row){row={businessId,expenseId:request.expenseId,revision:(BigInt(request.expectedRevision)+1n).toString(),operationId:request.operationId,actorId,recordedAt:'2026-10-28T23:00:00.000000Z',payload:request.payload};rows.push(row);}if(loseReply){loseReply=false;throw new Error('Synthetic lost response');}return {state:'committed',expense:row};}};
createRoot(document.getElementById('root')!).render(<main><ExpenseEditor client={client}/></main>);
