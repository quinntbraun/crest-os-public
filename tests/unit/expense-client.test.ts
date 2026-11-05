// Response-binding/lifecycle unit doubles; no genuine authentication claim.
import {randomUUID} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {createExpenseClient} from '../../src/client/expenses';
import {parseExpenseSave} from '../../src/bookkeeping/expenses/expense-contract';
import type {ExpensePayload} from '../../src/bookkeeping/expenses/expense-contract';
const proof=async()=>({csrfToken:'b'.repeat(43),expiresAt:Date.now()+60000});
function fixture(){
 const request=parseExpenseSave({businessId:randomUUID(),recoveryEpoch:randomUUID(),operationId:randomUUID(),expenseId:randomUUID(),expectedRevision:'1',payload:{paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic wash soap',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:'Synthetic correction'}});
 const context={businessId:request.businessId,recoveryEpoch:request.recoveryEpoch,writeState:'ready' as const,binding:'a'.repeat(43)},expense={businessId:request.businessId,expenseId:request.expenseId,operationId:request.operationId,revision:'2',actorId:randomUUID(),recordedAt:'2026-10-29T03:00:00.000000Z',payload:{...request.payload}};
 return {request,context,expense};
}
const response=(expense:unknown)=>new Response(JSON.stringify({state:'committed',expense}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
afterEach(()=>vi.unstubAllGlobals());
it('acknowledges only the sealed expense facts at the exact requested next revision',async()=>{
 const f=fixture(),fetch=vi.fn<typeof globalThis.fetch>(async()=>response(f.expense));vi.stubGlobal('fetch',fetch);const saved=await createExpenseClient(proof).save(f.context,f.request);expect(saved).toEqual({state:'committed',expense:f.expense});expect(fetch).toHaveBeenCalledOnce();
});
it.each([
 {paidOn:'2026-10-27'},{amountCents:'1399'},{category:'equipment'},
 {description:'Different synthetic work'},{vendor:'Different synthetic vendor'},
 {paymentMethod:'cash'},{reference:'Different synthetic reference'},
 {notes:'Different synthetic notes'},{voided:true},{changeReason:'Different synthetic reason'},
] satisfies Partial<ExpensePayload>[])('does not acknowledge substituted valid financial facts %j',async change=>{
 const f=fixture(),fetch=vi.fn<typeof globalThis.fetch>(async()=>response({...f.expense,payload:{...f.expense.payload,...change}}));vi.stubGlobal('fetch',fetch);await expect(createExpenseClient(proof).save(f.context,f.request)).rejects.toThrow('EXPENSE_REVIEW_REQUIRED');expect(fetch).toHaveBeenCalledOnce();
});
it('binds the result to the copied request rather than caller edits during authorization',async()=>{
 const f=fixture(),raw=structuredClone(f.request);let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;}),getProof=async()=>{await ready;return proof();},fetch=vi.fn<typeof globalThis.fetch>(async()=>response(f.expense));vi.stubGlobal('fetch',fetch);
 const pending=createExpenseClient(getProof).save(f.context,raw);(raw.payload as {amountCents:string}).amountCents='9999';release();const result=await pending;if(result.state!=='committed')throw Error('EXPECTED_COMMITTED_EXPENSE');expect(result.expense.payload.amountCents).toBe('1299');const options=fetch.mock.calls[0]![1] as RequestInit;expect(JSON.parse(options.body as string).amountCents).toBe('1299');expect(fetch).toHaveBeenCalledOnce();
});
it.each(['context','history','save'] as const)('never dispatches %s after the caller leaves during authorization',async route=>{
 const f=fixture(),controller=new AbortController();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),fetch=vi.fn<typeof globalThis.fetch>();vi.stubGlobal('fetch',fetch);
 const client=createExpenseClient(async signal=>{await gate;expect(signal.aborted).toBe(true);return proof();}),work=route==='context'?client.context(controller.signal):route==='history'?client.history(f.context,controller.signal):client.save(f.context,f.request,controller.signal),refused=expect(work).rejects.toThrow('EXPENSE_REVIEW_REQUIRED');controller.abort();release();await refused;expect(fetch).not.toHaveBeenCalled();
});
it('refuses an otherwise valid committed response delivered after cancellation without replaying the write',async()=>{
 const f=fixture(),controller=new AbortController(),fetch=vi.fn<typeof globalThis.fetch>(async()=>{controller.abort();return response(f.expense);});vi.stubGlobal('fetch',fetch);await expect(createExpenseClient(proof).save(f.context,f.request,controller.signal)).rejects.toThrow('EXPENSE_REVIEW_REQUIRED');expect(fetch).toHaveBeenCalledOnce();
});

it('looks up only the exact original expense identity without financial intent or a second save',async()=>{const f=fixture(),reference={operationId:f.request.operationId,recoveryEpoch:f.request.recoveryEpoch,expenseId:f.request.expenseId,expectedRevision:f.request.expectedRevision},fetch=vi.fn<typeof globalThis.fetch>(async()=>response(f.expense));vi.stubGlobal('fetch',fetch);expect(await createExpenseClient(proof).lookup(f.context,reference)).toEqual({state:'committed',expense:f.expense});expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0]![0]).toBe('/api/business/expenses/operation');expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual(reference);});
it.each(['expenseId','operationId','businessId','revision'] as const)('refuses an original lookup with a substituted %s',async key=>{const f=fixture(),reference={operationId:f.request.operationId,recoveryEpoch:f.request.recoveryEpoch,expenseId:f.request.expenseId,expectedRevision:f.request.expectedRevision},fetch=vi.fn<typeof globalThis.fetch>(async()=>response({...f.expense,[key]:key==='revision'?'3':randomUUID()}));vi.stubGlobal('fetch',fetch);await expect(createExpenseClient(proof).lookup(f.context,reference)).rejects.toThrow('EXPENSE_REVIEW_REQUIRED');expect(fetch).toHaveBeenCalledOnce();});
