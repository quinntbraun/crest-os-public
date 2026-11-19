import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {transportFixture} from '../support/transport';
import {recreditIds as ids,recreditOptionsFixture as fixture} from '../support/grouped-recredit-options';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),verify:vi.fn(),context:vi.fn(),read:vi.fn(),transaction:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:calls.verify})}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/security/session-database.ts',()=>({financePreviewDatabase:()=>Object.assign(calls.read,{commandTransaction:calls.transaction})}));
import {createFinanceAccountHttp,financeAccountPrefix} from '../../src/bookkeeping/finance-account-http';
const origin='https://crest.example.com',sessionId=randomUUID(),actorId=randomUUID();
const config={origin,businessId:ids.business,environment:'test' as const,ingress:{kind:'direct' as const},connectionString:'postgresql://owner@127.0.0.1/fixture'};
const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(ids.business).update('\0').update(sessionId).digest('base64url');
const cookie='__Host-crest_session='+randomBytes(32).toString('base64url');
const dispatch=(tips=false,grouped=true)=>createFinanceAccountHttp(config,'postgresql://finance@127.0.0.1/fixture',{} as never,{} as never,
 {fixedMappings:true,taxProfiles:true,categoryMappings:true,moneyChannels:true,invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,
  invoiceIssue:true,directReceipts:true,sameDayExpenses:true,trialBalance:true,paymentCorrections:true,fundApplications:true,heldTips:true,
  invoiceCredits:true,paidInvoiceCredits:true,serviceRefunds:true,receivableAging:true,customerFundsReport:true,excessReceipts:true,excessReturns:true,
  tipReturns:true,collectionFailures:true,refundTransfers:true,directReceiptTips:true,refundTransferFees:true,collectionFailureRecredits:true,
  collectionFailureGroupedRecredits:grouped,collectionFailureTipReinstatements:tips});
const request=(route='grouped-payment-recredit-options',body:object={customerId:ids.customer,failureId:ids.failure,actualOn:'2026-11-19'},headers:Record<string,string>={})=>new Request(origin+financeAccountPrefix+route,
 {method:'POST',headers:{origin,cookie,'content-type':'application/json','x-crest-edit-binding':binding,...headers},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();calls.csrf.mockResolvedValue(sessionId);calls.admit.mockResolvedValue(true);
 calls.verify.mockResolvedValue({sessionId,actorId,provider:{issuer:'https://provider.example.com/auth/v1',subject:ids.customer,sessionId,expiresAt:Date.now()+60000}});
 calls.context.mockResolvedValue({forServer:()=>({recoveryEpoch:ids.epoch,writeState:'ready'})});calls.read.mockResolvedValue(fixture(true));});
it('keeps grouped recovery and tip-restoration capability gates independent',async()=>{
 expect((await dispatch(false,false)(request(),transportFixture())).status).toBe(404);expect(calls.csrf).not.toHaveBeenCalled();
 expect((await dispatch()(request('context',{}),transportFixture())).headers.get('x-crest-collection-failure-tip-reinstatements')).toBeNull();
 expect((await dispatch(true)(request('context',{}),transportFixture())).headers.get('x-crest-collection-failure-tip-reinstatements')).toBe('1');
});
it.each([false,true])('serves exact base options for reader metadata %s without a posting transaction',async metadata=>{
 calls.read.mockResolvedValue(fixture(metadata));const response=await dispatch()(request(),transportFixture());
 expect(response.status).toBe(200);expect(await response.json()).toEqual(fixture());
 expect(response.headers.get('cache-control')).toContain('no-store');expect(calls.verify).toHaveBeenCalledOnce();
 expect(calls.read.mock.calls[0]?.[0]).toContain('read_fictional_collection_failure_recredit_options');
 expect(calls.read.mock.calls[0]?.[1].slice(7)).toEqual([ids.business,ids.customer,ids.failure,'2026-11-19']);expect(calls.transaction).not.toHaveBeenCalled();
});
it('returns complete validated tip lineage only when the existing capability is enabled',async()=>{
 const value=fixture(true,true);calls.read.mockResolvedValue(value);const response=await dispatch(true)(request(),transportFixture());
 expect(response.status).toBe(200);expect(await response.json()).toEqual(value);
});
it('rejects malformed newer metadata before returning a projected response',async()=>{
 const value=fixture(true,true);calls.read.mockResolvedValue({...value,components:[{...value.components[0],tipReinstatement:{private:'PRIVATE_INVALID_SOURCE'}}]});
 const response=await dispatch()(request(),transportFixture());expect(response.status).toBe(400);
 expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_INVALID_SOURCE');expect(calls.transaction).not.toHaveBeenCalled();
});
it('still refuses a valid tip-write request while the tip capability is disabled',async()=>{
 const body={reference:{operationId:ids.operation,recoveryEpoch:ids.epoch,settlementId:ids.settlement},failureId:ids.failure,customerId:ids.customer,
  channelId:ids.channel,channelVersion:'1',actualOn:'2026-11-19',verifiedCents:'10',confirmation:'Fictional deposit verified',reason:'Fictional recovery',
  externalIdentity:{namespace:'fixture',id:'fixture-deposit',rawReference:'Fictional statement'},
  ranges:[{failureComponentId:ids.component,firstCent:'1',lastCent:'10',disposition:'tip',intentEvidence:'Fictional owner confirmed tip intent'}]};
 const response=await dispatch()(request('grouped-payment-recredit-submit',body),transportFixture());
 expect(response.status).toBe(400);expect(calls.transaction).not.toHaveBeenCalled();
});
it('rejects wrong session binding before reading recovery options',async()=>{
 expect((await dispatch()(request('grouped-payment-recredit-options',{customerId:ids.customer,failureId:ids.failure,actualOn:'2026-11-19'},{'x-crest-edit-binding':'wrong'}),transportFixture())).status).toBe(400);
 expect(calls.read).not.toHaveBeenCalled();
});
