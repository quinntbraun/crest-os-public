import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createAuthenticationRuntime} from '../../src/server/authentication-runtime';
import {createRenderIngress} from '../../src/security/render-ingress';
const config=()=>({database:{connectionString:'postgresql://synthetic:synthetic@127.0.0.1/crest_migrate_0123456789abcdef',environment:'test' as const},
  provider:{issuer:'http://127.0.0.1:54321/auth/v1',publicKey:'sb_publishable_'+'a'.repeat(32),environment:'test' as const},loginKey:randomBytes(32),
  owner:{subject:randomUUID(),factorId:randomUUID()},ingress:{kind:'proxy' as const,peers:['127.0.0.1']},activeKeyId:'synthetic',keys:[{id:'synthetic',key:randomBytes(32)}]});
it('composes only explicit server dependencies without serializing them or retaining caller-owned mutable configuration',async()=>{
  const input=config(),expected=Buffer.from(input.loginKey),owner=input.owner.subject,pending=createAuthenticationRuntime(input);
  input.loginKey.fill(0);input.owner.subject=randomUUID();input.ingress.peers[0]='192.0.2.1';
  const runtime=await pending;
  expect(()=>JSON.stringify(runtime)).toThrow('AUTHENTICATION_RUNTIME_PRIVATE');expect(Object.keys(runtime)).toEqual([]);
  const handed=runtime.forServer();expect(Buffer.from(handed.configuration.loginKey)).toEqual(expected);expect(handed.configuration.owner.subject).toBe(owner);
  expect(handed.configuration.ingress).toEqual({kind:'proxy',peers:['127.0.0.1']});expect(Object.isFrozen(handed.configuration)).toBe(true);
  expect(handed.provider.verifyAccess).toBeTypeOf('function');expect(handed.tokens.encrypt).toBeTypeOf('function');
});
it('preserves a validated managed-ingress instance without accepting a JSON-shaped substitute',async()=>{
 const input=config(),ingress=createRenderIngress({kind:'render',serviceId:'srv-fixture',hostname:'crest-fixture.onrender.com',peers:['10.0.0.5']},{RENDER:'true',RENDER_SERVICE_ID:'srv-fixture',RENDER_EXTERNAL_HOSTNAME:'crest-fixture.onrender.com'});
 const production={...input,database:{environment:'production' as const,connectionString:'postgresql://crest_runtime:fixture-only@database.example.com/crest'},provider:{...input.provider,environment:'production' as const,issuer:'https://identity.example.com/auth/v1'}};
 const runtime=await createAuthenticationRuntime({...production,ingress});expect(runtime.forServer().configuration.ingress).toBe(ingress);
 await expect(createAuthenticationRuntime({...input,ingress})).rejects.toThrow('AUTHENTICATION_RUNTIME_CONFIGURATION_REQUIRED');
 await expect(createAuthenticationRuntime({...production,ingress:{kind:'render',peers:['10.0.0.5']} as never})).rejects.toThrow('AUTHENTICATION_RUNTIME_CONFIGURATION_REQUIRED');
});
it.each(['environment','database','provider','owner','loginKey','keys'])('fails closed on invalid %s with no private cause',async field=>{
  const input=config();
  if(field==='environment')Object.assign(input.provider,{environment:'production'});
  if(field==='database')input.database.connectionString='postgresql://synthetic:private@production.example.com/production';
  if(field==='provider')input.provider.issuer='http://provider.example.com/auth/v1';
  if(field==='owner')Object.assign(input.owner,{factorId:'browser-selected'});
  if(field==='loginKey')input.loginKey=randomBytes(31);
  if(field==='keys')input.keys[0]!.key=randomBytes(31);
  const error=await createAuthenticationRuntime(input).catch((error:unknown)=>error);expect(error).toMatchObject({message:'AUTHENTICATION_RUNTIME_CONFIGURATION_REQUIRED'});expect(error).not.toHaveProperty('cause');
});
