import 'server-only';
import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {Readable} from 'node:stream';
import type {Socket} from 'node:net';
import {browserFailureResponse} from '../security/browser-http.ts';
import {createAuthenticationHttp,settleAuthenticationResponse} from '../security/authentication-http.ts';
import {transportFromIncomingMessage} from '../security/trusted-transport.ts';

export type AuthenticationConfiguration=Readonly<{
  configuration:Omit<Parameters<typeof createAuthenticationHttp>[0],'origin'|'environment'>;
  provider:Parameters<typeof createAuthenticationHttp>[1];tokens:Parameters<typeof createAuthenticationHttp>[2];
}>;
export type NodeConfiguration=Readonly<{origin:string;environment:'production'|'test';tls?:Readonly<{key:Buffer;cert:Buffer}>;authentication?:AuthenticationConfiguration}>;
export type PageHandler=(request:IncomingMessage,response:ServerResponse)=>Promise<void>;

export function createBoundedNodeServer(tls?:NodeConfiguration['tls']):Server{
  const options={maxHeaderSize:16384,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:5000,connectionsCheckingInterval:1000};
  const server=tls?createTlsServer({...options,key:tls.key,cert:tls.cert,minVersion:'TLSv1.2',handshakeTimeout:5000}):createServer(options);
  // Capture every header inside the byte cap; reject excess instead of silently
  // truncating a late duplicate Origin/cookie/CSRF header.
  const sockets=new Set<Socket>();server.maxHeadersCount=0;server.maxRequestsPerSocket=100;
  server.setTimeout(45000,socket=>socket.destroy());
  server.on('connection',socket=>{
    if(sockets.size>=128){socket.destroy();return;}
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
  });
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('upgrade',(_request,socket)=>socket.destroy());
  return server;
}

export function requestTarget(raw:string|undefined,origin:string):Readonly<{url:URL;authentication:boolean}>{
  if(!raw||raw.length>8192||!raw.startsWith('/')||raw.startsWith('//')||/[\\#]/.test(raw)
    ||Array.from(raw).some(char=>char.charCodeAt(0)<=32||char.charCodeAt(0)===127))throw new Error('REQUEST_TARGET_INVALID');
  const url=new URL(raw,origin);
  if(url.origin!==origin||url.pathname+url.search!==raw)throw new Error('REQUEST_TARGET_INVALID');
  // Reserve encoded aliases as well: they must never fall through to Next.
  const decoded=decodeURIComponent(url.pathname);
  return Object.freeze({url,authentication:decoded==='/api/auth'||decoded.startsWith('/api/auth/')});
}

export async function writeAuthenticationResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  let finished=false;
  try{
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{
      if(reader)while(true){
        const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
          const abort=()=>reject(new Error('AUTHENTICATION_DELIVERY_FAILED'));
          if(bounded.aborted){abort();return;}
          bounded.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>bounded.removeEventListener('abort',abort));
        });
        if(part.done)break;
        if(!part.value.byteLength||(size+=part.value.byteLength)>8192)throw new Error();chunks.push(part.value);
      }
    }finally{if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
    const body=Buffer.concat(chunks);
    if(signal.aborted||outgoing.destroyed)throw new Error();
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(fail,5000);timer.unref();
      function clean(){clearTimeout(timer);outgoing.off('finish',finish);outgoing.off('close',fail);outgoing.off('error',fail);signal.removeEventListener('abort',fail);}
      function finish(){finished=true;clean();resolve();}
      function fail(){clean();reject(new Error('AUTHENTICATION_DELIVERY_FAILED'));}
      outgoing.once('finish',finish);outgoing.once('close',fail);outgoing.once('error',fail);signal.addEventListener('abort',fail,{once:true});
      try{
        if(signal.aborted)throw new Error();
        for(const [key,value]of response.headers)if(key!=='set-cookie')outgoing.setHeader(key,value);
        const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
        outgoing.writeHead(response.status);outgoing.end(body);
      }catch{fail();}
    });
  }finally{
    if(!finished)outgoing.destroy();
    try{await settleAuthenticationResponse(response,finished);}catch{console.error('AUTHENTICATION_DELIVERY_CLEANUP_FAILED');}
  }
}

export function bindApplicationHandler(server:Server,config:NodeConfiguration,pages:PageHandler):void{
  const {origin,environment,authentication}=config;
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||!['http:','https:'].includes(url.protocol)||!['production','test'].includes(environment)
    ||authentication&&environment==='production'&&!config.tls||server.listenerCount('request'))throw new Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatch=authentication?createAuthenticationHttp({...authentication.configuration,origin,environment},authentication.provider,authentication.tokens):undefined;
  let activeAuthentication=0;
  server.on('request',(incoming,outgoing)=>{void (async()=>{
    const controller=new AbortController();
    const abort=()=>controller.abort();incoming.once('aborted',abort);
    outgoing.once('close',()=>{if(!outgoing.writableFinished)abort();});
    let reserved=false;
    try{
      if(incoming.rawHeaders.length>256)throw new Error();
      const target=requestTarget(incoming.url,origin);
      if(!target.authentication){await pages(incoming,outgoing);return;}
      if(!dispatch||activeAuthentication>=32){await writeAuthenticationResponse(outgoing,browserFailureResponse(503),controller.signal);return;}
      activeAuthentication++;reserved=true;
      const peer=transportFromIncomingMessage(incoming),headers=new Headers();
      for(let i=0;i<incoming.rawHeaders.length;i+=2)headers.append(incoming.rawHeaders[i]!,incoming.rawHeaders[i+1]!);
      const request=new Request(target.url,{method:incoming.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method??'')?{body:Readable.toWeb(incoming),duplex:'half'}:{})} as RequestInit);
      const response=await dispatch(request,peer);
      await writeAuthenticationResponse(outgoing,response,controller.signal);
    }catch{
      if(!outgoing.destroyed&&!outgoing.headersSent)try{await writeAuthenticationResponse(outgoing,browserFailureResponse(),controller.signal);}catch{outgoing.destroy();}
      else outgoing.destroy();
    }finally{if(reserved)activeAuthentication--;incoming.off('aborted',abort);}
  })();});
}
