import {afterEach,expect,it,vi} from 'vitest';
import {financeAccounts} from '../../src/client/finance-accounts';
import type {FinanceAccountContext} from '../../src/client/finance-accounts';
import {normalizeOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-contract';
const auth=vi.hoisted(()=>vi.fn());
vi.mock('../../src/client/authentication',()=>({authentication:{session:auth}}));
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const binding='a'.repeat(43),reference={operationId:id(2),recoveryEpoch:id(3)},worksheetRevisionId=id(4);
const context:FinanceAccountContext={businessId:id(1),binding,recoveryEpoch:id(3),writeState:'ready',fixedMappings:false,taxProfiles:false,categoryMappings:false,moneyChannels:true,openingWorksheet:true,openingFunds:true,invoicePreparation:false,invoiceDrafts:false,invoiceIssueTaxReview:false};
const input={schemaVersion:1 as const,roots:[],reason:'No deposits recorded yet'};
const receipt=()=>({schemaVersion:1,businessId:id(1),scheduleRevisionId:id(5),worksheetRevisionId,revision:'1',operationId:id(2),auditEventId:id(6),recordedBy:id(7),recordedAt:'2026-06-02T12:30:00.123456Z',evidenceSha256:'a'.repeat(64),evidence:normalizeOpeningFundsEvidence(input,'2026-06-01')});
function setup(value:unknown,status=200){
 auth.mockResolvedValue({csrfToken:binding,expiresAt:Date.now()+60000});
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}}));
 vi.stubGlobal('fetch',fetch);return fetch;
}
const signal=()=>new AbortController().signal;
const save=()=>financeAccounts.saveOpeningFundsSchedule(context,reference,worksheetRevisionId,'2026-06-01',{worksheetRevision:'2',expectedRevision:'0',input},signal());
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});
it('reads the requested worksheet privately and keeps an unsaved schedule distinct',async()=>{
 const fetch=setup({schemaVersion:1,businessId:id(1),worksheetRevisionId,schedule:null});
 expect((await financeAccounts.readOpeningFundsSchedule(context,'2',worksheetRevisionId,signal())).schedule).toBeNull();
 expect(fetch.mock.calls[0]![0]).toContain('opening-worksheet-funds-read');
 const options=fetch.mock.calls[0]![1];expect(options.credentials).toBe('same-origin');expect(options.cache).toBe('no-store');
 expect(options.headers['x-crest-edit-binding']).toBe(binding);expect(JSON.parse(options.body)).toEqual({worksheetRevision:'2',reviewEpoch:id(3)});
});
it('keeps uninstalled capabilities closed and does not send old-epoch saves',async()=>{
 const fetch=setup({});
 await expect(financeAccounts.readOpeningFundsSchedule({...context,openingFunds:false},'2',worksheetRevisionId,signal())).rejects.toThrow();
 await expect(financeAccounts.saveOpeningFundsSchedule(context,{...reference,recoveryEpoch:id(99)},worksheetRevisionId,'2026-06-01',{worksheetRevision:'2',expectedRevision:'0',input},signal())).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();
});
it('sends one exact save and accepts only its original committed operation',async()=>{
 const fetch=setup({state:'committed',receipt:receipt()});expect((await save()).state).toBe('committed');expect(fetch).toHaveBeenCalledOnce();
 expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({reference,worksheetRevisionId,cutoverOn:'2026-06-01',draft:{worksheetRevision:'2',expectedRevision:'0',input}});
 setup({state:'committed',receipt:{...receipt(),operationId:id(99)}});await expect(save()).rejects.toThrow();
 setup({state:'committed',receipt:{...receipt(),worksheetRevisionId:id(99)}});await expect(save()).rejects.toThrow();
});
it('preserves known revision conflicts and rejects uncertain responses without retrying',async()=>{
 setup({error:'OPENING_FUNDS_REVISION_CONFLICT'},409);expect(await save()).toEqual({state:'revision_conflict'});
 const fetch=setup({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'},503);await expect(save()).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
});
it('reviews and retires the original reference under the latest epoch without another save',async()=>{
 const recovered={...context,recoveryEpoch:id(99)};let fetch=setup({state:'review_required'});
 expect(await financeAccounts.resolveOpeningFundsSchedule(recovered,reference,null,signal())).toEqual({state:'review_required'});
 expect(fetch.mock.calls[0]![0]).toContain('funds-lookup');expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({reference,reviewEpoch:id(99)});
 fetch=setup({state:'retired'});expect(await financeAccounts.resolveOpeningFundsSchedule(recovered,reference,'Reviewed original absent save',signal())).toEqual({state:'retired'});
 expect(fetch.mock.calls[0]![0]).toContain('funds-retire');expect(fetch).toHaveBeenCalledOnce();
});
