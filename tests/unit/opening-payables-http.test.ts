import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {transportFixture} from '../support/transport';
import {normalizeOpeningPayablesEvidence} from '../../src/bookkeeping/opening-payables-contract';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),verify:vi.fn(),context:vi.fn(),read:vi.fn(),transaction:vi.fn(),query:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:calls.verify})}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/security/session-database.ts',()=>({financePreviewDatabase:()=>Object.assign(calls.read,{commandTransaction:calls.transaction})}));
import {createFinanceAccountHttp,financeAccountPrefix} from '../../src/bookkeeping/finance-account-http';
const origin='https://crest.example.com',businessId=randomUUID(),sessionId=randomUUID(),actorId=randomUUID(),epoch=randomUUID(),operationId=randomUUID(),worksheetRevisionId=randomUUID();
const config={origin,businessId,environment:'test' as const,ingress:{kind:'direct' as const},connectionString:'postgresql://owner@127.0.0.1/fixture'};
const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url');
const cookie='__Host-crest_session='+randomBytes(32).toString('base64url');
const dispatch=(openingPayables=true)=>createFinanceAccountHttp(config,'postgresql://finance@127.0.0.1/fixture',{} as never,{} as never,{moneyChannels:true,openingWorksheet:true,openingPayables});
const request=(route:string,body:object,headers:Record<string,string>={})=>new Request(origin+financeAccountPrefix+'opening-worksheet-payables-'+route,
 {method:'POST',headers:{origin,cookie,'content-type':'application/json','x-crest-edit-binding':binding,...headers},body:JSON.stringify(body)});
const document={reference:'Synthetic retained source',sha256:'a'.repeat(64)};
const raw={schemaVersion:1 as const,reason:'Preserve original supplier obligation',bills:[{billId:randomUUID(),sourceNamespace:'legacy.bills',externalId:'BILL-001',vendor:'Synthetic supplier',purpose:'Prior supplies',incurredOn:'2026-05-01',originalDueOn:'2026-06-15',unknownDueReason:null,originalCents:'15000',remainingCents:'10000',billEvidence:document,reductions:[{kind:'payment' as const,reference:'PAY-001',appliedOn:'2026-05-20',amountCents:'5000',evidence:document}],taxEvidence:null}]};
const receipt=()=>({schemaVersion:1,businessId,scheduleRevisionId:randomUUID(),worksheetRevisionId,revision:'1',operationId,auditEventId:randomUUID(),recordedBy:actorId,recordedAt:'2026-06-02T12:30:00.000001Z',evidenceSha256:'b'.repeat(64),evidence:normalizeOpeningPayablesEvidence(raw,'2026-06-01')});
const reference={operationId,recoveryEpoch:epoch};
const body=()=>({reference,worksheetRevisionId,cutoverOn:'2026-06-01',draft:{worksheetRevision:'2',expectedRevision:'0',input:structuredClone(raw)}});
beforeEach(()=>{
 vi.resetAllMocks();calls.csrf.mockResolvedValue(sessionId);calls.admit.mockResolvedValue(true);
 calls.verify.mockResolvedValue({sessionId,actorId,provider:{issuer:'https://provider.example.com/auth/v1',subject:actorId,sessionId,expiresAt:Date.now()+60000}});
 calls.context.mockResolvedValue({forServer:()=>({recoveryEpoch:epoch,writeState:'ready'})});
 calls.transaction.mockImplementation(async action=>action(calls.query));calls.query.mockResolvedValue({state:'committed',receipt:receipt()});
 calls.read.mockResolvedValue({schemaVersion:1,businessId,worksheetRevisionId,schedule:receipt()});
});
it('keeps every new route unavailable until explicitly enabled',async()=>{
 for(const route of ['read','save','lookup','retire'])expect((await dispatch(false)(request(route,{}),transportFixture())).status).toBe(404);
 expect(calls.csrf).not.toHaveBeenCalled();expect(calls.query).not.toHaveBeenCalled();
});
it('reads only a freshly authenticated business and requested worksheet',async()=>{
 const response=await dispatch()(request('read',{reviewEpoch:epoch,worksheetRevision:'2'}),transportFixture());
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(calls.verify).toHaveBeenCalledOnce();expect(calls.read.mock.calls[0]![0]).toContain('read_fictional_opening_payables_schedule');
 expect(calls.read.mock.calls[0]![1].slice(7)).toEqual([businessId,epoch,'2']);expect(calls.transaction).not.toHaveBeenCalled();
});
it('saves raw historical sources in a transaction and checks the exact committed evidence',async()=>{
 const response=await dispatch()(request('save',body()),transportFixture());expect(response.status).toBe(200);
 expect(calls.transaction).toHaveBeenCalledOnce();expect(calls.query.mock.calls[0]![0]).toContain('save_fictional_opening_payables_schedule');
 expect(calls.query.mock.calls[0]![1].slice(7)).toEqual([businessId,epoch,operationId,'2','0',JSON.stringify(raw.bills),raw.reason]);
 const saved=await response.json();expect(saved.receipt.evidence.totals.remainingCents).toBe('10000');expect(saved.receipt.evidence.posted).toBe(false);
});
it.each(['binding','origin','csrf','session','admission'])('refuses invalid %s before business SQL',async fault=>{
 if(fault==='csrf')calls.csrf.mockRejectedValue(Error('NO_CSRF'));
 if(fault==='session')calls.verify.mockRejectedValue(Error('NO_SESSION'));
 if(fault==='admission')calls.admit.mockResolvedValue(false);
 const headers=fault==='binding'?{'x-crest-edit-binding':'wrong'}:fault==='origin'?{origin:'https://foreign.example.com'}:{};
 const response=await dispatch()(request('save',body(),headers),transportFixture());expect(response.status).toBeGreaterThanOrEqual(400);
 expect(calls.query).not.toHaveBeenCalled();expect(calls.read).not.toHaveBeenCalled();
});
it('refuses caller-selected authority and malformed deposits before starting a transaction',async()=>{
 const invalid=body();invalid.draft.input.bills[0]!.remainingCents='9999';
 for(const value of [{...body(),businessId:randomUUID()},invalid]){
  expect((await dispatch()(request('save',value),transportFixture())).status).toBeGreaterThanOrEqual(400);
 }
 expect(calls.transaction).not.toHaveBeenCalled();
});
it.each(['business','worksheet','actor','revision','operation','evidence'])('does not acknowledge a committed response with mismatched %s',async fault=>{
 const value=structuredClone(receipt());
 if(fault==='business')value.businessId=randomUUID();if(fault==='worksheet')value.worksheetRevisionId=randomUUID();
 if(fault==='actor')value.recordedBy=randomUUID();if(fault==='revision')value.revision='2';
 if(fault==='operation')value.operationId=randomUUID();if(fault==='evidence')value.evidence.totals.remainingCents='9999';
 calls.query.mockResolvedValue({state:'committed',receipt:value});
 const response=await dispatch()(request('save',body()),transportFixture());expect(response.status).toBe(503);
 expect(await response.json()).toEqual({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'});
});
it('looks up the original operation under fresh review authority and preserves uncertainty',async()=>{
 const reviewEpoch=randomUUID();calls.read.mockResolvedValue({state:'review_required'});
 const response=await dispatch()(request('lookup',{reference,reviewEpoch}),transportFixture());
 expect(await response.json()).toEqual({state:'review_required'});
 expect(calls.read.mock.calls[0]![1].slice(7)).toEqual([businessId,reviewEpoch,operationId,epoch]);expect(calls.transaction).not.toHaveBeenCalled();
});
it('retires an explicitly reviewed attempt transactionally without resubmitting a deposit',async()=>{
 calls.query.mockResolvedValue({state:'retired'});const reviewEpoch=randomUUID(),reason='Reviewed absent original save';
 const response=await dispatch()(request('retire',{reference,reviewEpoch,reason}),transportFixture());
 expect(await response.json()).toEqual({state:'retired'});expect(calls.query.mock.calls[0]![0]).toContain('retire_fictional_opening_payables_save');
 expect(calls.query.mock.calls[0]![1].slice(7)).toEqual([businessId,reviewEpoch,operationId,epoch,reason]);
});
it('reports an audited operation conflict and a known revision conflict without leaking failures',async()=>{
 calls.query.mockResolvedValueOnce({state:'conflict',reason:'operation'});
 expect((await dispatch()(request('save',body()),transportFixture())).status).toBe(409);
 calls.query.mockRejectedValueOnce(Error('OPENING_PAYABLES_REVISION_CONFLICT'));
 expect(await(await dispatch()(request('save',body()),transportFixture())).json()).toEqual({error:'OPENING_PAYABLES_REVISION_CONFLICT'});
 calls.query.mockRejectedValueOnce(Error('PRIVATE_DATABASE_DETAILS'));
 expect(await(await dispatch()(request('save',body()),transportFixture())).json()).toEqual({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'});
});
