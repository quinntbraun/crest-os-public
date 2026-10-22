import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({query:vi.fn(),verify:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>mock.query}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createBusinessOperationLookup,BusinessOperationLookupError} from '../../src/security/business-operation-lookup';
const actor=randomUUID(),business=randomUUID(),operation=randomUUID(),epoch=randomUUID(),session=randomUUID(),subject=randomUUID(),providerSession=randomUUID(),audit=randomUUID();
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal,input=()=>({businessId:business,operationId:operation});
const receipt=()=>({schemaVersion:1,businessId:business,businessVersion:'9007199254740993',auditEventId:audit});
const found=()=>({state:'committed',operationId:operation,recoveryEpoch:epoch,receipt:receipt()});
const config={connectionString:'unused-by-mock',environment:'test' as const},provider={} as Parameters<typeof createBusinessOperationLookup>[1],tokens={} as Parameters<typeof createBusinessOperationLookup>[2];
const create=()=>createBusinessOperationLookup(config,provider,tokens);
beforeEach(()=>{vi.clearAllMocks();mock.events.length=0;mock.verify.mockImplementation(async()=>{mock.events.push('verify');return {actorId:actor,sessionId:session,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}};});mock.query.mockImplementation(async()=>{mock.events.push('query');return found();});});
it('freshly verifies before exact typed SQL and returns immutable private historical evidence',async()=>{
  const lookup=create(),result=await lookup(credential,input(),signal());expect(mock.events).toEqual(['verify','query']);expect(result.forServer()).toEqual(found());expect(Object.isFrozen(result.forServer())).toBe(true);expect(()=>JSON.stringify(result)).toThrow(BusinessOperationLookupError);
  const value=result.forServer();if(value.state!=='committed')throw new Error('fixture');expect(Object.isFrozen(value.receipt)).toBe(true);
  expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background',false);const [sql,values]=mock.query.mock.calls[0]!;expect(sql).toContain('lookup_business_name_operation');expect(values.slice(1,6)).toEqual([session,actor,'https://auth.example.com/auth/v1',subject,providerSession]);expect(values.slice(7)).toEqual([business,operation]);expect([...values[0]]).toEqual(Array(32).fill(0));
});
it('returns absence as point-in-time evidence without a new epoch or retry',async()=>{mock.query.mockResolvedValue({state:'absent'});const value=await create()(credential,input(),signal());expect(value.forServer()).toEqual({state:'absent'});expect(mock.query).toHaveBeenCalledTimes(1);expect(()=>JSON.stringify(value)).toThrow(BusinessOperationLookupError);});
it('pins operation and business before awaits and never caches authorization',async()=>{const request=input(),lookup=create();mock.verify.mockImplementationOnce(async()=>{request.businessId=randomUUID();request.operationId=randomUUID();return {actorId:actor,sessionId:session,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}};});await lookup(credential,request,signal());expect(mock.query.mock.calls[0]![1].slice(7)).toEqual([business,operation]);await lookup(credential,input(),signal());expect(mock.verify).toHaveBeenCalledTimes(2);});
it('rejects invalid/extra authority inputs and cancellation before IO',async()=>{for(const value of [null,{businessId:business},{...input(),recoveryEpoch:epoch},{...input(),operationId:'invalid'},{...input(),businessId:'invalid'}])await expect(create()(credential,value as ReturnType<typeof input>,signal())).rejects.toThrow(BusinessOperationLookupError);const c=new AbortController();c.abort();await expect(create()(credential,input(),c.signal)).rejects.toThrow(BusinessOperationLookupError);expect(mock.query).not.toHaveBeenCalled();expect(mock.verify).not.toHaveBeenCalled();});
it.each([null,{state:'absent',extra:true},{...found(),operationId:randomUUID()},{...found(),recoveryEpoch:'invalid'},
  {...found(),receipt:{...receipt(),businessId:randomUUID()}},{...found(),receipt:{...receipt(),businessVersion:1}},
  {...found(),receipt:{...receipt(),businessVersion:'0'}},{...found(),receipt:{...receipt(),businessVersion:'9223372036854775808'}},
  {...found(),receipt:{...receipt(),schemaVersion:2}},{...found(),receipt:{...receipt(),auditEventId:'invalid'}},
  {...found(),receipt:{...receipt(),extra:true}}])('rejects malformed, mismatched or unsafe receipt projections',async value=>{mock.query.mockResolvedValue(value);await expect(create()(credential,input(),signal())).rejects.toThrow(BusinessOperationLookupError);});
it('sanitizes provider/DB failures and does not retry or expose causes',async()=>{for(const target of [mock.verify,mock.query]){target.mockRejectedValueOnce(new Error('private credential or SQL detail'));const error=await create()(credential,input(),signal()).catch((e:unknown)=>e);expect(error).toMatchObject({message:'BUSINESS_OPERATION_LOOKUP_FAILED'});expect(error).not.toHaveProperty('cause');}});
