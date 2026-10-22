import 'server-only';
import {IncomingMessage} from 'node:http';
import type {TLSSocket} from 'node:tls';
import {normalizeClientAddress} from './client-address.ts';
import {createRequestProtection} from './request-protection.ts';

export type IngressConfiguration={kind:'direct'}|{kind:'proxy';peers:readonly string[]};
type Snapshot=Readonly<{address:string;encrypted:boolean;hosts:readonly string[];forwarded:readonly string[];protocols:readonly string[]}>;
const snapshots=new WeakMap<TransportPeer,Snapshot>();
export class TransportError extends Error{
  constructor(){super('TRUSTED_TRANSPORT_FAILED');this.name='TransportError';}
}
class TransportPeer{
  toJSON():never{throw new TransportError();}
}

// Server adapter only: a Request/JSON/header cannot provide socket evidence.
export function transportFromIncomingMessage(message:IncomingMessage):TransportPeer{
  try{
    if(!(message instanceof IncomingMessage)||!message.socket.remoteAddress)throw new TransportError();
    const values=(name:string)=>{
      const result:string[]=[];
      for(let i=0;i<message.rawHeaders.length;i+=2)if(message.rawHeaders[i]!.toLowerCase()===name)result.push(message.rawHeaders[i+1]!);
      return Object.freeze(result);
    };
    const peer=Object.freeze(new TransportPeer());
    snapshots.set(peer,Object.freeze({address:normalizeClientAddress(message.socket.remoteAddress),encrypted:(message.socket as TLSSocket).encrypted===true,
      hosts:values('host'),forwarded:values('x-forwarded-for'),protocols:values('x-forwarded-proto')}));
    return peer;
  }catch{throw new TransportError();}
}

export function createTrustedTransport(config:{origin:string;environment:'production'|'test';ingress:IngressConfiguration}){
  createRequestProtection(config);
  const origin=new URL(config.origin),kind=config.ingress?.kind,environment=config.environment;
  let peers:Set<string>;
  try{
    if(kind!=='direct'&&kind!=='proxy')throw new Error();
    const values=kind==='proxy'?(config.ingress as Extract<IngressConfiguration,{kind:'proxy'}>).peers:[];
    if(kind==='proxy'&&(!Array.isArray(values)||values.length<1||values.length>16))throw new Error();
    peers=new Set(values.map(normalizeClientAddress));
    if(peers.size!==values.length)throw new Error();
  }catch{throw new Error('INGRESS_CONFIGURATION_REQUIRED');}
  return (request:Request,peer:TransportPeer):string=>{
    try{
      const state=snapshots.get(peer),url=new URL(request.url);
      if(!state||url.origin!==origin.origin||url.username||url.password||state.hosts.length!==1
        ||state.hosts[0]!.toLowerCase()!==origin.host||environment==='production'&&!state.encrypted)throw new TransportError();
      if(kind==='direct')return state.address; // Forwarding headers have no authority here.
      if(!peers.has(state.address)||state.protocols.length!==1||state.protocols[0]!=='https'||state.forwarded.length!==1)throw new TransportError();
      const raw=state.forwarded[0]!;
      if(Buffer.byteLength(raw)>1024)throw new TransportError();
      const parts=raw.split(',');if(parts.length>8)throw new TransportError();
      const addresses=parts.map(value=>normalizeClientAddress(value.trim()));
      // The first untrusted hop from the socket side is the client boundary.
      // Any attacker-controlled prefix to its left cannot select the budget key.
      for(let i=addresses.length-1;i>=0;i--)if(!peers.has(addresses[i]!))return addresses[i]!;
      throw new TransportError();
    }catch{throw new TransportError();}
  };
}
