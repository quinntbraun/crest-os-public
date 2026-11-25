import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {transportFixture} from '../support/transport';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),verify:vi.fn(),context:vi.fn(),read:vi.fn(),transaction:vi.fn()}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:calls.verify})}));
vi.mock('../../src/security/business-settings-context.ts',()=>({createBusinessSettingsContextReader:()=>calls.context}));
vi.mock('../../src/security/session-database.ts',()=>({financePreviewDatabase:()=>Object.assign(calls.read,{commandTransaction:calls.transaction})}));
import {createFinanceAccountHttp,financeAccountPrefix} from '../../src/bookkeeping/finance-account-http';
const origin='https://crest.example.com',businessId=randomUUID(),customerId=randomUUID(),invoiceId=randomUUID(),sessionId=randomUUID(),actorId=randomUUID();
const config={origin,businessId,environment:'test' as const,ingress:{kind:'direct' as const},connectionString:'postgresql://owner@127.0.0.1/fixture'};
const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url');
const cookie='__Host-crest_session='+randomBytes(32).toString('base64url');
const dispatch=(invoiceOutstanding=false)=>createFinanceAccountHttp(config,'postgresql://finance@127.0.0.1/fixture',{} as never,{} as never,
 {fixedMappings:true,taxProfiles:true,invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,invoiceOutstanding});
const request=(route='invoice-outstanding',body:object={customerId,invoiceId},headers:Record<string,string>={})=>new Request(origin+financeAccountPrefix+route,
 {method:'POST',headers:{origin,cookie,'content-type':'application/json','x-crest-edit-binding':binding,...headers},body:JSON.stringify(body)});
const ready={state:'ready',schemaVersion:1,businessId,customerId,invoiceId,invoiceNumber:'CREST-1',currency:'USD',issuedOn:'2026-11-18',dueOn:'2026-11-25',
 throughOn:'2026-11-19',observedAt:'2026-11-19T15:00:00.000000Z',timeZone:'America/Indiana/Indianapolis',originalCents:'25000',outstandingCents:'15000'};
beforeEach(()=>{vi.resetAllMocks();calls.csrf.mockResolvedValue(sessionId);calls.admit.mockResolvedValue(true);
 calls.verify.mockResolvedValue({sessionId,actorId,provider:{issuer:'https://provider.example.com/auth/v1',subject:customerId,sessionId,expiresAt:Date.now()+60000}});
 calls.context.mockResolvedValue({forServer:()=>({recoveryEpoch:invoiceId,writeState:'ready'})});calls.read.mockResolvedValue(ready);});
it('requires the explicit reader capability and advertises it only when enabled',async()=>{
 expect((await dispatch()(request(),transportFixture())).status).toBe(404);expect(calls.csrf).not.toHaveBeenCalled();
 expect((await dispatch()(request('context',{}),transportFixture())).headers.get('x-crest-invoice-outstanding')).toBeNull();
 expect((await dispatch(true)(request('context',{}),transportFixture())).headers.get('x-crest-invoice-outstanding')).toBe('1');
 expect(calls.read).not.toHaveBeenCalled();expect(calls.transaction).not.toHaveBeenCalled();
});
it('uses fresh bound authority and a private parameterized read without a posting transaction',async()=>{
 const response=await dispatch(true)(request(),transportFixture());expect(response.status).toBe(200);expect(await response.json()).toEqual(ready);
 expect(response.headers.get('cache-control')).toContain('no-store');expect(calls.verify).toHaveBeenCalledOnce();
 expect(calls.read.mock.calls[0]?.[0]).toContain('read_fictional_invoice_outstanding');
 expect(calls.read.mock.calls[0]?.[1].slice(1,3)).toEqual([sessionId,actorId]);
 expect(calls.read.mock.calls[0]?.[1].slice(7)).toEqual([businessId,customerId,invoiceId]);expect(calls.transaction).not.toHaveBeenCalled();
});
it.each([{customerId,invoiceId,extra:'private'},{customerId,invoiceId:'bad'},{customerId},{businessId,customerId,invoiceId}])('rejects malformed or caller-selected authority before SQL',async body=>{
 expect((await dispatch(true)(request('invoice-outstanding',body),transportFixture())).status).toBe(400);expect(calls.read).not.toHaveBeenCalled();
});
it('rejects cross-session bindings and refuses mismatched result identities instead of returning a balance',async()=>{
 expect((await dispatch(true)(request('invoice-outstanding',{customerId,invoiceId},{'x-crest-edit-binding':'wrong'}),transportFixture())).status).toBe(400);
 expect(calls.read).not.toHaveBeenCalled();calls.read.mockResolvedValue({...ready,invoiceId:randomUUID()});
 const refused=await dispatch(true)(request(),transportFixture());expect(refused.status).toBe(400);expect(JSON.stringify(await refused.json())).not.toContain('15000');
});
it('preserves absence and zero and never exposes database failure details',async()=>{
 for(const value of [{state:'absent'},{...ready,outstandingCents:'0'}]){calls.read.mockResolvedValueOnce(value);expect(await(await dispatch(true)(request(),transportFixture())).json()).toEqual(value);}
 calls.read.mockRejectedValueOnce(Error('PRIVATE_DATABASE_VALUE'));const refused=await dispatch(true)(request(),transportFixture());
 expect(refused.status).toBe(400);expect(JSON.stringify(await refused.json())).not.toContain('PRIVATE_DATABASE_VALUE');
});
