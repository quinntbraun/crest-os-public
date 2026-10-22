import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({query:vi.fn(),verify:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>mock.query}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createTenantContextReader,TenantReadError} from '../../src/security/tenant-read';
const business=randomUUID(),actor=randomUUID(),session=randomUUID(),subject=randomUUID(),providerSession=randomUUID();
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const value=()=>({actorId:actor,businessId:business,currency:'USD',timezone:'UTC'});
const verified=()=>({sessionId:session,actorId:actor,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}});
const read=()=>createTenantContextReader({connectionString:'unused-by-mock',environment:'test'},{} as Parameters<typeof createTenantContextReader>[1],{} as Parameters<typeof createTenantContextReader>[2]);
beforeEach(()=>{vi.clearAllMocks();mock.verify.mockResolvedValue(verified());mock.query.mockImplementation(async()=>value());});
it('always verifies fresh background provider/local evidence before the exact allowlisted database read',async()=>{
  mock.query.mockImplementation(async(_sql,parameters)=>{expect(parameters[0].equals(createHash('sha256').update(credential,'ascii').digest())).toBe(true);return value();});
  const reader=read(),result=await reader(credential,business,signal());
  expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background',false);
  expect(mock.verify.mock.invocationCallOrder[0]).toBeLessThan(mock.query.mock.invocationCallOrder[0]!);
  const [sql,parameters]=mock.query.mock.calls[0]!;expect(sql).toContain('SELECT crest_commands.read_authorized_business_context(');
  expect(parameters.slice(1,6)).toEqual([session,actor,'https://auth.example.com/auth/v1',subject,providerSession]);expect(parameters[7]).toBe(business);
  expect(parameters[0]).toHaveLength(32);expect([...parameters[0]]).toEqual(Array(32).fill(0));
  expect(result.forServer()).toEqual(value());expect(Object.isFrozen(result.forServer())).toBe(true);expect(Object.keys(result)).toEqual([]);expect(()=>JSON.stringify(result)).toThrow(TenantReadError);
  await reader(credential,business,signal());expect(mock.verify).toHaveBeenCalledTimes(2);expect(mock.query).toHaveBeenCalledTimes(2);
});
it('invalid business/credential and cancellation deny before provider or database work',async()=>{
  const controller=new AbortController();controller.abort();
  for(const [cookie,businessId,current] of [[credential,'invalid',signal()],['invalid',business,signal()],[credential,business,controller.signal]] as const)await expect(read()(cookie,businessId,current)).rejects.toThrow('TENANT_READ_FAILED');
  expect(mock.verify).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();
});
it('provider failure prevents the tenant query and hides private causes',async()=>{
  mock.verify.mockRejectedValue(new Error('private provider detail'));const error=await read()(credential,business,signal()).catch((error:unknown)=>error);
  expect(error).toBeInstanceOf(TenantReadError);expect(error).not.toHaveProperty('cause');expect(mock.query).not.toHaveBeenCalled();
});
it('database denial never returns context or exposes SQL/private values',async()=>{
  mock.query.mockRejectedValue(new Error('private SQL detail'));const error=await read()(credential,business,signal()).catch((error:unknown)=>error);
  expect(error).toMatchObject({message:'TENANT_READ_FAILED'});expect(error).not.toHaveProperty('cause');
});
it.each([null,[],{...value(),extra:'private'},{...value(),businessId:randomUUID()},{...value(),actorId:randomUUID()},{...value(),currency:'EUR'},{...value(),timezone:''}])('rejects mismatched or malformed database projections',async current=>{
  mock.query.mockResolvedValue(current);await expect(read()(credential,business,signal())).rejects.toBeInstanceOf(TenantReadError);
});
it('cancellation after DB completion cannot expose a late context',async()=>{
  const controller=new AbortController();mock.query.mockImplementation(async()=>{controller.abort();return value();});
  await expect(read()(credential,business,controller.signal)).rejects.toThrow('TENANT_READ_FAILED');
});
