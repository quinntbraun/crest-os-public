import {createBoundedNodeServer,bindApplicationHandler} from '../../src/server/node-server.ts';

// Disposable loopback HTTP adapter, never a production listener or TLS substitute.
export async function authenticationServer(config,provider,tokens){
  const server=createBoundedNodeServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{bindApplicationHandler(server,{origin,environment:'test',authentication:{configuration:{...config,ingress:{kind:'direct'}},provider,tokens}},async(_request,response)=>{response.writeHead(404);response.end();});}
  catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw error;}
  return Object.freeze({origin,server,
    request:(path,body={},headers={},method='POST')=>fetch(origin+'/api/auth/'+path,{method,headers:{origin,'content-type':'application/json',...headers},
      ...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(35000)}),
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}
