import 'server-only';
import {normalizeClientAddress} from './client-address.ts';

export type RenderIngressConfiguration=Readonly<{kind:'render';serviceId:string;hostname:string;peers:readonly string[]}>;
type Environment=Readonly<Record<string,string|undefined>>;
function require(value:unknown):asserts value{if(!value)throw new Error('RENDER_INGRESS_CONFIGURATION_REQUIRED');}
export function parseRenderIngressConfiguration(value:unknown):RenderIngressConfiguration{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 const input=value as Record<string,unknown>,names=['kind','serviceId','hostname','peers'];
 require(Object.keys(input).length===names.length&&names.every(name=>Object.hasOwn(input,name))&&input.kind==='render');
 require(typeof input.serviceId==='string'&&/^srv-[a-z0-9-]{1,100}$/.test(input.serviceId));
 require(typeof input.hostname==='string'&&input.hostname.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+onrender\.com$/.test(input.hostname));
 require(Array.isArray(input.peers)&&input.peers.length>0&&input.peers.length<=16&&input.peers.every(value=>typeof value==='string'));
 const peers=input.peers.map(value=>normalizeClientAddress(value));require(new Set(peers).size===peers.length);
 return Object.freeze({kind:'render',serviceId:input.serviceId,hostname:input.hostname,peers:Object.freeze(peers)});
}
class ManagedRenderIngress{
 readonly kind='render' as const;
 readonly serviceId:string;readonly hostname:string;readonly peers:readonly string[];
 constructor(config:RenderIngressConfiguration){this.serviceId=config.serviceId;this.hostname=config.hostname;this.peers=config.peers;Object.freeze(this);}
 toJSON():never{throw new Error('RENDER_INGRESS_PRIVATE');}
}
export type RenderIngress=ManagedRenderIngress;
// The operator verifies these literal peer addresses on the owned Render
// service. Environment identity is trusted process configuration, not proof
// supplied by an HTTP header. Unknown/rotated peers continue to fail closed.
export function createRenderIngress(input:unknown,environment:Environment=process.env):RenderIngress{
 const config=parseRenderIngressConfiguration(input);
 require(environment.RENDER==='true'&&environment.RENDER_SERVICE_ID===config.serviceId&&environment.RENDER_EXTERNAL_HOSTNAME===config.hostname);
 return new ManagedRenderIngress(config);
}
export function isRenderIngress(value:unknown):value is RenderIngress{return value instanceof ManagedRenderIngress;}
