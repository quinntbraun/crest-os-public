import 'server-only';
import {createBrowserSessionFlow} from './browser-session-flow.ts';
import {browserFailureResponse,createBrowserBodyReader,readBrowserCookies,loginContextResponse,loginResponse,sessionResponse,logoutResponse} from './browser-http.ts';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';

type Flow=ReturnType<typeof createBrowserSessionFlow>;
type Configuration=Parameters<typeof createBrowserSessionFlow>[0]&{ingress:IngressConfiguration};
const paths=new Set(['/api/auth/bootstrap','/api/auth/login','/api/auth/session','/api/auth/logout']);

// Not mounted by Next yet: the hosting adapter must supply real socket evidence.
export function createAuthenticationHttp(config:Configuration,provider:Parameters<typeof createBrowserSessionFlow>[1],tokens:Parameters<typeof createBrowserSessionFlow>[2]){
  const resolve=createTrustedTransport(config),read=createBrowserBodyReader(config),flow=createBrowserSessionFlow(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let issued:Awaited<ReturnType<Flow['login']>>|undefined;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(35000)]);
      if(signal.aborted)throw new Error();
      const address=resolve(request,peer),url=new URL(request.url);
      if(url.search||url.hash||!paths.has(url.pathname))return browserFailureResponse(404);
      if(request.method!=='POST')return browserFailureResponse(405);
      const bounded=new Request(request,{signal}),cookies=readBrowserCookies(bounded.headers);
      let response:Response;
      if(url.pathname==='/api/auth/login'){
        const input=await read(bounded,'login');
        if(!cookies.login)throw new Error();
        issued=await flow.login(bounded,address,cookies.login,input,signal,cookies.session);
        if(signal.aborted)throw new Error();
        response=loginResponse(issued,input.trusted);
      }else{
        await read(bounded,'empty');
        if(url.pathname==='/api/auth/bootstrap')response=loginContextResponse(await flow.beginLogin(bounded,address,signal,cookies.login));
        else{
          if(!cookies.session)throw new Error();
          response=url.pathname==='/api/auth/session'?sessionResponse(await flow.session(bounded,cookies.session,signal))
            :logoutResponse(await flow.logout(bounded,cookies.session,signal));
        }
      }
      if(signal.aborted)throw new Error();
      return response;
    }catch{
      // Only a newly issued login may be discarded. A failed proof response must
      // never revoke an existing device's session. Cleanup has its own deadline.
      if(issued)try{await flow.discardUnexposedLogin(issued);}catch{/* fixed failure, never hand off its credential */}
      return browserFailureResponse();
    }
  };
}
