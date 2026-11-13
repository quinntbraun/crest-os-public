import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {transportFixture} from '../support/transport';

vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({
  csrf:vi.fn(),admit:vi.fn(),verify:vi.fn(),context:vi.fn(),read:vi.fn(),write:vi.fn(),transaction:vi.fn(),
}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:calls.verify})}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/security/session-database.ts',()=>({
  financePreviewDatabase:()=>Object.assign(calls.read,{commandTransaction:calls.transaction}),
}));

import {createFinanceAccountHttp,financeAccountPrefix} from '../../src/bookkeeping/finance-account-http.ts';

const origin='https://crest.example.com',businessId=randomUUID(),sessionId=randomUUID();
const customerId=randomUUID(),invoiceId=randomUUID(),invoiceItemId=randomUUID(),receivableId=randomUUID(),returnsMappingId=randomUUID();
const reference={operationId:randomUUID(),recoveryEpoch:randomUUID(),invoiceCreditId:randomUUID()};
const effectiveOn='2026-11-13';
const config={origin,businessId,environment:'test' as const,ingress:{kind:'direct' as const},connectionString:'postgresql://owner@127.0.0.1/fixture'};
const flags={fixedMappings:true,taxProfiles:true,categoryMappings:true,moneyChannels:true,invoicePreparation:true,
  invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,directReceipts:true,sameDayExpenses:true,trialBalance:true,
  paymentCorrections:true,fundApplications:true,heldTips:true};
const dispatch=(enabled:boolean)=>createFinanceAccountHttp(config,'postgresql://finance@127.0.0.1/fixture',{} as never,{} as never,
  {...flags,invoiceCredits:enabled});
const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url');
const cookie='__Host-crest_session='+randomBytes(32).toString('base64url');
const input={reference,customerId,invoiceItemId,effectiveOn,firstCent:'1',lastCent:'3',returnsMappingId,reason:'Fictional concession'};
const committed={
  state:'committed',receipt:{schemaVersion:1,businessId,operationId:reference.operationId,invoiceCreditId:reference.invoiceCreditId,
    eventId:randomUUID(),invoiceId,invoiceItemId,receivableId,customerId,arAccountId:randomUUID(),returnsAccountId:randomUUID(),
    returnsMappingId,taxAccountId:null,originalTaxMovementId:null,discountAccountId:null,discountMappingId:null,effectiveOn,
    firstCent:'1',lastCent:'3',inclusiveCents:'3',netCents:'3',taxCents:'0',discountCents:'0',returnsCents:'3',reason:input.reason},
};
const request=(route:string,body:object,headers:Record<string,string>={})=>new Request(origin+financeAccountPrefix+route,{
  method:'POST',headers:{origin,'content-type':'application/json',cookie,'X-Crest-Edit-Binding':binding,...headers},body:JSON.stringify(body),
});

beforeEach(()=>{
  vi.resetAllMocks();
  calls.csrf.mockResolvedValue(sessionId);
  calls.admit.mockResolvedValue(true);
  calls.verify.mockResolvedValue({sessionId,actorId:randomUUID(),provider:{
    issuer:'https://provider.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60_000,
  }});
  calls.context.mockResolvedValue({forServer:()=>({recoveryEpoch:reference.recoveryEpoch,writeState:'ready'})});
  calls.read.mockResolvedValue({state:'absent'});
  calls.write.mockResolvedValue(committed);
  calls.transaction.mockImplementation(run=>run(calls.write));
});

it('does not advertise or call credit SQL without explicit fictional capability',async()=>{
  const run=dispatch(false);
  const unavailable=await run(request('invoice-credit-lookup',reference),transportFixture());
  expect(unavailable.status).toBe(404);
  expect(calls.csrf).not.toHaveBeenCalled();
  const context=await run(request('context',{}),transportFixture());
  expect(context.headers.get('x-crest-invoice-credits')).toBeNull();
  expect((await dispatch(true)(request('context',{}),transportFixture())).headers.get('x-crest-invoice-credits')).toBe('1');
  expect(calls.read).not.toHaveBeenCalled();
});

it('binds review and lookup to the signed session and selected business before SQL',async()=>{
  const run=dispatch(true);
  const invalid=await run(request('invoice-credit-options',{customerId,invoiceId,effectiveOn},{'X-Crest-Edit-Binding':'unbound'}),transportFixture());
  expect(invalid.status).toBe(400);
  expect(calls.read).not.toHaveBeenCalled();
  const review=await run(request('invoice-credit-options',{customerId,invoiceId,effectiveOn}),transportFixture());
  expect(review.status).toBe(200);
  expect(review.headers.get('cache-control')).toContain('no-store');
  expect(await review.json()).toEqual({state:'absent'});
  expect(calls.read.mock.calls[0]?.[0]).toContain('crest_commands.read_fictional_invoice_credit_options');
  expect(calls.read.mock.calls[0]?.[1].slice(7)).toEqual([businessId,customerId,invoiceId,effectiveOn]);
  expect(await (await run(request('invoice-credit-lookup',reference),transportFixture())).json()).toEqual({state:'absent'});
  expect(calls.read.mock.calls[1]?.[1].slice(7)).toEqual([businessId,reference.recoveryEpoch,reference.operationId,reference.invoiceCreditId]);
  expect(calls.transaction).not.toHaveBeenCalled();
});

it('returns a checked original receipt or a clear conflict without another write',async()=>{
  const run=dispatch(true);
  const saved=await run(request('invoice-credit-submit',input),transportFixture());
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual(committed);
  expect(calls.write.mock.calls[0]?.[0]).toContain('crest_commands.credit_fictional_open_invoice_line');
  expect(calls.write.mock.calls[0]?.[1].slice(7)).toEqual([businessId,reference.recoveryEpoch,reference.operationId,
    reference.invoiceCreditId,invoiceItemId,customerId,effectiveOn,'1','3',returnsMappingId,input.reason]);
  calls.write.mockResolvedValueOnce({state:'conflict',reason:'operation'});
  expect((await run(request('invoice-credit-submit',input),transportFixture())).status).toBe(409);
  expect(calls.write).toHaveBeenCalledTimes(2);
  expect(calls.read).not.toHaveBeenCalled();
});

it('distinguishes a known refusal from an interrupted or mismatched receipt and allows explicit retirement',async()=>{
  const run=dispatch(true),reason='Fictional reviewed absence';
  calls.write.mockRejectedValueOnce(new Error('INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED'));
  const refusal=await run(request('invoice-credit-submit',input),transportFixture());
  expect(refusal.status).toBe(409);
  expect(await refusal.json()).toEqual({error:'INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED'});
  calls.write.mockResolvedValueOnce({...committed,receipt:{...committed.receipt,customerId:randomUUID()}});
  const uncertain=await run(request('invoice-credit-submit',input),transportFixture());
  expect(uncertain.status).toBe(503);
  expect(await uncertain.json()).toEqual({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'});
  expect(calls.read).not.toHaveBeenCalled();
  const retired={state:'retired',receipt:{schemaVersion:1,businessId,operationId:reference.operationId,invoiceCreditId:reference.invoiceCreditId,
    originalEpoch:reference.recoveryEpoch,reviewEpoch:reference.recoveryEpoch,reason}};
  calls.write.mockResolvedValueOnce(retired);
  const response=await run(request('invoice-credit-retire',{reference,reviewEpoch:reference.recoveryEpoch,reason}),transportFixture());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(retired);
  expect(calls.write.mock.calls[2]?.[0]).toContain('crest_commands.retire_fictional_invoice_credit');
  expect(calls.write.mock.calls[2]?.[1].slice(7)).toEqual([businessId,reference.recoveryEpoch,reference.operationId,
    reference.recoveryEpoch,reference.invoiceCreditId,reason]);
});
