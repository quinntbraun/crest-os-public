import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createAuthenticationRuntime} from '../../src/server/authentication-runtime';
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
