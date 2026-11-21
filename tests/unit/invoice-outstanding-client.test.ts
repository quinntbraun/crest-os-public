import {afterEach,expect,it,vi} from 'vitest';
import {financeAccounts} from '../../src/client/finance-accounts';
import {watchFinanceActivity} from '../../src/client/finance-activity';
import type {FinanceAccountContext} from '../../src/client/finance-accounts';
const auth=vi.hoisted(()=>vi.fn());
vi.mock('../../src/client/authentication',()=>({authentication:{session:auth}}));
const businessId='00000000-0000-4000-8000-000000000001',customerId='00000000-0000-4000-8000-000000000002',invoiceId='00000000-0000-4000-8000-000000000003';
const binding='a'.repeat(43);
const context:FinanceAccountContext={businessId,binding,recoveryEpoch:invoiceId,writeState:'ready',fixedMappings:false,taxProfiles:false,categoryMappings:false,moneyChannels:false,
 invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,invoiceOutstanding:true,directReceipts:true};
const value={state:'ready',schemaVersion:1,businessId,customerId,invoiceId,invoiceNumber:'CREST-1',currency:'USD',issuedOn:'2026-11-18',dueOn:'2026-11-25',
 throughOn:'2026-11-19',observedAt:'2026-11-19T15:00:00.000000Z',timeZone:'America/Indiana/Indianapolis',originalCents:'25000',outstandingCents:'15000'};
function setup(result:unknown,status=200){
 auth.mockResolvedValue({csrfToken:binding,expiresAt:Date.now()+60000});
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}}));
 vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});
it('makes one private bound read and retains exact cents, zero and absence without activity recursion',async()=>{
 const counts:number[]=[];const stop=watchFinanceActivity(n=>counts.push(n));
 try{for(const result of [value,{...value,outstandingCents:'0'},{state:'absent'}]){
  const fetch=setup(result);expect(await financeAccounts.invoiceOutstanding(context,customerId,invoiceId,new AbortController().signal)).toEqual(result);
  expect(fetch).toHaveBeenCalledOnce();const [url,options]=fetch.mock.calls[0]!;
  expect(url).toBe('/api/business/finance-accounts/invoice-outstanding');expect(options.cache).toBe('no-store');
  expect(options.headers['x-crest-edit-binding']).toBe(binding);expect(JSON.parse(options.body)).toEqual({customerId,invoiceId});
 }expect(counts).toEqual([0]);}finally{stop();}
});
it('does not read without capability and refuses a different invoice or unsuccessful response',async()=>{
 const fetch=setup(value);
 await expect(financeAccounts.invoiceOutstanding({...context,invoiceOutstanding:false},customerId,invoiceId,new AbortController().signal)).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();setup({...value,invoiceId:customerId});
 await expect(financeAccounts.invoiceOutstanding(context,customerId,invoiceId,new AbortController().signal)).rejects.toThrow();
 setup({state:'absent'},503);await expect(financeAccounts.invoiceOutstanding(context,customerId,invoiceId,new AbortController().signal)).rejects.toThrow();
});
it('invalidates before authentication and keeps financial work active until rejection settles',async()=>{
 const counts:number[]=[];const stop=watchFinanceActivity(n=>counts.push(n));
 let reject:(error:Error)=>void=()=>{};auth.mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
 try{const pending=financeAccounts.directReceiptOptions(context,customerId,null,new AbortController().signal);
  expect(counts).toEqual([0,1]);reject(Error('unavailable'));await expect(pending).rejects.toThrow();expect(counts).toEqual([0,1,0]);
 }finally{stop();}
});
