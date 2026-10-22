import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({query:vi.fn(),verify:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>mock.query}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createBusinessSettingsContextReader,BusinessSettingsContextError} from '../../src/security/business-settings-context';
const business=randomUUID(),actor=randomUUID(),session=randomUUID(),subject=randomUUID(),providerSession=randomUUID(),epoch=randomUUID();
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const value=()=>({schemaVersion:1,businessId:business,legalName:' Exact synthetic \u00e9 ',businessVersion:'9007199254740993',writeState:'ready',recoveryEpoch:epoch});
const verified=()=>({sessionId:session,actorId:actor,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}});
const read=()=>createBusinessSettingsContextReader({connectionString:'unused-by-mock',environment:'test'},{} as Parameters<typeof createBusinessSettingsContextReader>[1],{} as Parameters<typeof createBusinessSettingsContextReader>[2]);
beforeEach(()=>{vi.clearAllMocks();mock.verify.mockResolvedValue(verified());mock.query.mockImplementation(async()=>value());});
it('fresh background verification precedes the fixed digest-only query on every read',async()=>{
  mock.query.mockImplementation(async(sql,parameters)=>{expect(sql).toBe('SELECT crest_commands.read_business_settings_context($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid) AS result');expect(parameters[0].equals(createHash('sha256').update(credential,'ascii').digest())).toBe(true);return value();});
  const reader=read();await reader(credential,business,signal());await reader(credential,business,signal());
  expect(mock.verify).toHaveBeenCalledTimes(2);expect(mock.query).toHaveBeenCalledTimes(2);
  expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background',false);
  expect(mock.verify.mock.invocationCallOrder[0]).toBeLessThan(mock.query.mock.invocationCallOrder[0]!);
  const p=mock.query.mock.calls[0]![1];expect(p.slice(1,6)).toEqual([session,actor,'https://auth.example.com/auth/v1',subject,providerSession]);expect(p[6]).toBeInstanceOf(Date);expect(p[7]).toBe(business);
  for(const call of mock.query.mock.calls)expect([...call[1][0]]).toEqual(Array(32).fill(0));
});
it('copies and freezes the private exact snapshot without normalizing Unicode or rounding versions',async()=>{
  const raw=value();mock.query.mockResolvedValue(raw);const result=await read()(credential,business,signal());raw.legalName='changed';
  expect(result.forServer()).toEqual(value());expect(Object.isFrozen(result.forServer())).toBe(true);expect(Object.isFrozen(result)).toBe(true);expect(Object.keys(result)).toEqual([]);expect(()=>JSON.stringify(result)).toThrow(BusinessSettingsContextError);
});
it('paused reads return no active epoch and do not synthesize one',async()=>{
  const paused={...value(),writeState:'paused',recoveryEpoch:null};mock.query.mockResolvedValue(paused);expect((await read()(credential,business,signal())).forServer()).toEqual(paused);
});
it('invalid target, credential and pre-aborted work fail before verification or SQL',async()=>{
  const controller=new AbortController();controller.abort();for(const [cookie,id,s] of [[credential,'bad',signal()],['bad',business,signal()],[credential,business,controller.signal]] as const)await expect(read()(cookie,id,s)).rejects.toThrow('BUSINESS_SETTINGS_CONTEXT_FAILED');
  expect(mock.verify).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();
});
it('SDK failure stops SQL and hides private causes',async()=>{
  mock.verify.mockRejectedValue(new Error('private SDK detail'));const error=await read()(credential,business,signal()).catch((e:unknown)=>e);expect(error).toMatchObject({message:'BUSINESS_SETTINGS_CONTEXT_FAILED'});expect(error).not.toHaveProperty('cause');expect(mock.query).not.toHaveBeenCalled();
});
it('SQL failure hides private causes and clears the credential digest',async()=>{
  mock.query.mockRejectedValue(new Error('private SQL detail'));const error=await read()(credential,business,signal()).catch((e:unknown)=>e);expect(error).toBeInstanceOf(BusinessSettingsContextError);expect(error).not.toHaveProperty('cause');expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));
});
it.each(['provider','database'])('cancellation during %s prevents a late positive snapshot',async phase=>{
  const controller=new AbortController();if(phase==='provider')mock.verify.mockImplementation(async()=>{controller.abort();return verified();});else mock.query.mockImplementation(async()=>{controller.abort();return value();});
  await expect(read()(credential,business,controller.signal)).rejects.toThrow('BUSINESS_SETTINGS_CONTEXT_FAILED');if(phase==='provider')expect(mock.query).not.toHaveBeenCalled();
});
it.each([null,[],{...value(),extra:'secret'},{...value(),schemaVersion:2},{...value(),businessId:randomUUID()},
  {...value(),businessVersion:1},{...value(),businessVersion:'01'},{...value(),businessVersion:'0'},{...value(),businessVersion:'9223372036854775808'},
  {...value(),legalName:' '},{...value(),legalName:'x'.repeat(201)},{...value(),legalName:'\u0000'},{...value(),legalName:'\ud800'},
  {...value(),writeState:'paused'},{...value(),recoveryEpoch:null},{...value(),writeState:'other'},{...value(),recoveryEpoch:'bad'}])('rejects malformed or mismatched projections',async current=>{
  mock.query.mockResolvedValue(current);await expect(read()(credential,business,signal())).rejects.toThrow('BUSINESS_SETTINGS_CONTEXT_FAILED');
});
