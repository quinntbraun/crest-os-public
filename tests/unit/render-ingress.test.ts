import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createRenderIngress,isRenderIngress,parseRenderIngressConfiguration} from '../../src/security/render-ingress';
import {createTrustedTransport} from '../../src/security/trusted-transport';
import {transportFixture} from '../support/transport';

const input=()=>({kind:'render',serviceId:'srv-fixture',hostname:'crest-fixture.onrender.com',peers:['10.0.0.5']});
const environment={RENDER:'true',RENDER_SERVICE_ID:'srv-fixture',RENDER_EXTERNAL_HOSTNAME:'crest-fixture.onrender.com'};
const origin='https://crest.example.com',request=()=>new Request(origin+'/api/auth/session');
const headers=['Host','crest.example.com','X-Forwarded-Proto','https','X-Forwarded-For','198.51.100.99, 203.0.113.7'];
it('requires explicit matching platform identity and privately constructed ingress',()=>{
 expect(isRenderIngress(createRenderIngress(input(),environment))).toBe(true);
 expect(isRenderIngress(input())).toBe(false);
 for(const env of [{},{...environment,RENDER:'false'},{...environment,RENDER_SERVICE_ID:'srv-other'},{...environment,RENDER_EXTERNAL_HOSTNAME:'other.onrender.com'}])expect(()=>createRenderIngress(input(),env)).toThrow('RENDER_INGRESS_CONFIGURATION_REQUIRED');
});
it('seals literal peer configuration and refuses wildcards, ranges, duplicates and extra input',()=>{
 const value=input(),ingress=createRenderIngress(value,environment);value.peers[0]='203.0.113.44';
 expect(ingress.peers).toEqual(['10.0.0.5']);expect(Object.isFrozen(ingress)).toBe(true);expect(Object.isFrozen(ingress.peers)).toBe(true);
 expect(()=>JSON.stringify(ingress)).toThrow('RENDER_INGRESS_PRIVATE');
 for(const value of [{...input(),peers:[]},{...input(),peers:['*']},{...input(),peers:['10.0.0.0/8']},{...input(),peers:['10.0.0.5','::ffff:10.0.0.5']},{...input(),allowPlaintext:true}])expect(()=>parseRenderIngressConfiguration(value)).toThrow();
});
it('accepts managed-edge HTTP only from the configured peer and selects the trusted right-hand client boundary',()=>{
 const ingress=createRenderIngress(input(),environment),resolve=createTrustedTransport({origin,environment:'production',ingress});
 expect(resolve(request(),transportFixture({address:'10.0.0.5',encrypted:false,headers}))).toBe('203.0.113.7');
 expect(()=>resolve(request(),transportFixture({address:'10.0.0.6',encrypted:false,headers}))).toThrow('TRUSTED_TRANSPORT_FAILED');
 for(const raw of [headers.filter((_,index)=>index<2),['Host','crest.example.com','X-Forwarded-Proto','http','X-Forwarded-For','203.0.113.7'],[...headers,'X-Forwarded-For','198.51.100.1'],[...headers,'X-Forwarded-Proto','https'],['Host','evil.example.com',...headers.slice(2)]])expect(()=>resolve(request(),transportFixture({address:'10.0.0.5',encrypted:false,headers:raw}))).toThrow('TRUSTED_TRANSPORT_FAILED');
});
it('keeps direct/generic-proxy TLS requirements and rejects forged or test-mode managed ingress',()=>{
 for(const ingress of [{kind:'direct' as const},{kind:'proxy' as const,peers:['10.0.0.5']}]){
  const resolve=createTrustedTransport({origin,environment:'production',ingress});
  expect(()=>resolve(request(),transportFixture({address:'10.0.0.5',encrypted:false,headers}))).toThrow('TRUSTED_TRANSPORT_FAILED');
 }
 expect(()=>createTrustedTransport({origin,environment:'production',ingress:input() as never})).toThrow('INGRESS_CONFIGURATION_REQUIRED');
 expect(()=>createTrustedTransport({origin,environment:'test',ingress:createRenderIngress(input(),environment)})).toThrow('INGRESS_CONFIGURATION_REQUIRED');
});
