import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createAuthenticationHttp} from '../../src/security/authentication-http.ts';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';

// Disposable loopback HTTP adapter, never a production listener or TLS substitute.
export async function authenticationServer(config,provider,tokens){
  let dispatch,origin;
  const server=createServer({maxHeaderSize:16384,requestTimeout:10000,headersTimeout:5000},async(incoming,outgoing)=>{
    const controller=new AbortController();
    incoming.once('aborted',()=>controller.abort());
    outgoing.once('close',()=>{if(!outgoing.writableFinished)controller.abort();});
    try{
      const peer=transportFromIncomingMessage(incoming),headers=new Headers();
      for(const [key,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
      const request=new Request(new URL(incoming.url,origin),{method:incoming.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
      const response=await dispatch(request,peer),body=await response.text();
      if(controller.signal.aborted)return;
      for(const [key,value]of response.headers)if(key!=='set-cookie')outgoing.setHeader(key,value);
      const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
      outgoing.writeHead(response.status);outgoing.end(body);
    }catch{if(!outgoing.headersSent)outgoing.writeHead(400,{'Cache-Control':'no-store'});outgoing.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  try{dispatch=createAuthenticationHttp({...config,origin,environment:'test',ingress:{kind:'direct'}},provider,tokens);}
  catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw error;}
  return Object.freeze({origin,
    request:(path,body={},headers={},method='POST')=>fetch(origin+'/api/auth/'+path,{method,headers:{origin,'content-type':'application/json',...headers},
      ...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(35000)}),
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}
