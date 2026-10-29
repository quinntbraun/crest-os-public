import {request as httpRequest} from 'node:http';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const flow=vi.hoisted(()=>({beginLogin:vi.fn(),business:vi.fn(),customers:vi.fn(),addresses:vi.fn(),vehicles:vi.fn(),associations:vi.fn(),leads:vi.fn(),leadSources:vi.fn(),originalOperations:vi.fn(),services:vi.fn(),quotes:vi.fn(),quoteReview:vi.fn()}));
vi.mock('../../src/security/browser-session-flow.ts',()=>({createBrowserSessionFlow:()=>flow}));
vi.mock('../../src/security/business-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/security/business-http.ts')>(),createBusinessHttp:()=>flow.business}));
vi.mock('../../src/customer/customer-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/customer-http.ts')>(),createCustomerHttp:()=>flow.customers}));
vi.mock('../../src/customer/customer-address-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/customer-address-http.ts')>(),createCustomerAddressHttp:()=>flow.addresses}));
vi.mock('../../src/customer/vehicle-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/vehicle-http.ts')>(),createVehicleHttp:()=>flow.vehicles}));
vi.mock('../../src/customer/association-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/association-http.ts')>(),createAssociationHttp:()=>flow.associations}));
vi.mock('../../src/customer/lead-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/lead-http.ts')>(),createLeadHttp:()=>flow.leads}));
vi.mock('../../src/customer/lead-source-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/customer/lead-source-http.ts')>(),createLeadSourceHttp:()=>flow.leadSources}));
vi.mock('../../src/security/original-operation-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/security/original-operation-http.ts')>(),createOriginalOperationHttp:()=>flow.originalOperations}));
vi.mock('../../src/commercial/service-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/commercial/service-http.ts')>(),createServiceHttp:()=>flow.services}));
vi.mock('../../src/commercial/quote-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/commercial/quote-http.ts')>(),createQuoteHttp:()=>flow.quotes}));
vi.mock('../../src/commercial/quote-review-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/commercial/quote-review-http.ts')>(),createQuoteReviewHttp:()=>flow.quoteReview}));
import {createBoundedNodeServer,bindApplicationHandler,requestTarget} from '../../src/server/node-server.ts';
import type {NodeConfiguration} from '../../src/server/node-server.ts';

const origin='https://crest.example.com';
it('review construction requires its own explicit synthetic quote/auth/business configuration',()=>{
 for(const config of [{origin,environment:'test',syntheticQuoteReview:true},{origin,environment:'test',syntheticQuoteReview:'yes'},{origin,environment:'production',syntheticQuotes:true,syntheticQuoteReview:true},{origin,environment:'test',syntheticQuotes:false,syntheticQuoteReview:true,business:{businessId:'synthetic'},authentication:{}}]){
  const server=createBoundedNodeServer();expect(()=>bindApplicationHandler(server,config as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');expect(server.listenerCount('request')).toBe(0);server.close();
 }
});
it.each([undefined,false,true])('review routes remain separate from draft activation: %s',async enabled=>{
 const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();
 const local=`http://127.0.0.1:${address.port}`,pages=vi.fn();flow.quotes.mockReset();flow.quoteReview.mockReset();
 flow.quotes.mockImplementation(async()=>new Response('{}',{headers:{'cache-control':'private, no-store'}}));flow.quoteReview.mockImplementation(async()=>new Response('{}',{headers:{'cache-control':'private, no-store'}}));
 bindApplicationHandler(server,{origin:local,environment:'test',syntheticQuotes:true,...enabled===undefined?{}:{syntheticQuoteReview:enabled},business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
 try{const draft=await fetch(local+'/api/business/quotes/list',{method:'POST',body:'{}'});expect(draft.status).toBe(200);await draft.text();const review=await fetch(local+'/api/business/quotes/review/read',{method:'POST',body:'{}'});expect(review.status).toBe(enabled?200:404);expect(review.headers.get('cache-control')).toContain('no-store');await review.text();expect(flow.quotes).toHaveBeenCalledTimes(1);expect(flow.quoteReview).toHaveBeenCalledTimes(enabled?1:0);expect(pages).not.toHaveBeenCalled();}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('catalog construction cannot be enabled in production or without genuine authentication and business configuration',()=>{
  for(const config of [{origin,environment:'production',syntheticCatalog:true},{origin,environment:'test',syntheticCatalog:true},{origin,environment:'test',syntheticCatalog:'yes'},{origin,environment:'test',syntheticCatalog:true,business:{businessId:'synthetic'}}]){
    const server=createBoundedNodeServer();expect(()=>bindApplicationHandler(server,config as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');expect(server.listenerCount('request')).toBe(0);server.close();
  }
});
it.each([false,true])('reserves catalog and encoded aliases with explicit synthetic enablement=%s',async enabled=>{
 const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(),handler=vi.fn(async()=>new Response(JSON.stringify({synthetic:'protected service response'}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}}));flow.services.mockImplementation(handler);
 bindApplicationHandler(server,{origin:local,environment:'test',syntheticCatalog:enabled,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
 try{for(const path of ['/api/business/services/list','/api/business/%73ervices/history']){const r=await fetch(local+path,{method:'POST',body:'{}'});expect(r.status).toBe(enabled?200:503);expect(r.headers.get('cache-control')).toContain('no-store');}expect(pages).not.toHaveBeenCalled();expect(handler).toHaveBeenCalledTimes(enabled?2:0);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('quote construction requires explicit test-only authentication and business composition',()=>{
 for(const config of [{origin,environment:'production',syntheticQuotes:true},{origin,environment:'test',syntheticQuotes:true},{origin,environment:'test',syntheticQuotes:'yes'},{origin,environment:'test',syntheticQuotes:true,business:{businessId:'synthetic'}}]){
  const server=createBoundedNodeServer();expect(()=>bindApplicationHandler(server,config as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');expect(server.listenerCount('request')).toBe(0);server.close();
 }
});
it.each([false,true])('reserves quote aliases and keeps its4MiB response limit independent: %s',async enabled=>{
 const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();
 const local=`http://127.0.0.1:${address.port}`,pages=vi.fn();flow.quotes.mockReset();flow.quotes.mockImplementation(async request=>new Response(request.url.endsWith('/oversize')?'x'.repeat(4194305):request.url.endsWith('/large')?'x'.repeat(4194304):JSON.stringify({synthetic:'private quote boundary'}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}}));
 bindApplicationHandler(server,{origin:local,environment:'test',syntheticQuotes:enabled,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
 try{
  for(const path of ['/api/business/quotes/list','/api/business/%71uotes/history']){const r=await fetch(local+path,{method:'POST',body:'{}'});expect(r.status).toBe(enabled?200:503);expect(r.headers.get('cache-control')).toContain('no-store');await r.text();}
  if(enabled){const large=await fetch(local+'/api/business/quotes/large',{method:'POST',body:'{}'});expect((await large.text()).length).toBe(4194304);await expect(fetch(local+'/api/business/quotes/oversize',{method:'POST',body:'{}'})).rejects.toThrow();}
  expect(pages).not.toHaveBeenCalled();expect(flow.quotes).toHaveBeenCalledTimes(enabled?4:0);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
async function withVehicleServer(enabled:boolean,work:(local:string,pages:ReturnType<typeof vi.fn>)=>Promise<void>){
  const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error();
  const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(async()=>{});
  flow.vehicles.mockImplementation(async()=>new Response(JSON.stringify({synthetic:'vehicle'}),{headers:{'cache-control':'private, no-store'}}));
  bindApplicationHandler(server,{origin:local,environment:'test',customers:true,vehicles:enabled,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
  try{await work(local,pages);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));flow.vehicles.mockReset();}
}
describe('Node hosting boundary',()=>{
  it.each([{operationResolution:true},{operationResolution:true,authentication:{}},{operationResolution:'yes'},{operationResolution:null}])('requires explicit boolean recovery composition with authentication and business: %o',patch=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'test',...patch} as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each([undefined,false,true])('original-operation routing independently opts in with a bounded private response: %s',async enabled=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const local='http://127.0.0.1:'+address.port,pages=vi.fn(async()=>{});
    flow.originalOperations.mockImplementation(async request=>new Response(request.url.endsWith('/large')?'x'.repeat(16384):request.url.endsWith('/oversize')?'x'.repeat(16385):JSON.stringify({synthetic:'original-operation'}),{headers:{'cache-control':'private, no-store'}}));
    bindApplicationHandler(server,{origin:local,environment:'test',...(enabled===undefined?{}:{operationResolution:enabled}),business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
    const before=flow.originalOperations.mock.calls.length,businessBefore=flow.business.mock.calls.length;
    try{
      const paths=['/api/business/original-operations','/api/business/original-operations/retire','/api/business/original-operations/resolution','/api/%62usiness/%6friginal-operations/retire','/api%2fbusiness/original-operations/resolution'];
      for(const path of paths){const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(enabled?200:503);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual(enabled?{synthetic:'original-operation'}:{error:'ORIGINAL_OPERATION_REQUEST_FAILED'});}
      expect(flow.originalOperations.mock.calls.length-before).toBe(enabled?paths.length:0);expect(flow.business.mock.calls.length).toBe(businessBefore);expect(pages).not.toHaveBeenCalled();
      if(enabled){expect((await(await fetch(local+'/api/business/original-operations/large',{method:'POST',body:'{}'})).text()).length).toBe(16384);await expect(fetch(local+'/api/business/original-operations/oversize',{method:'POST',body:'{}'})).rejects.toThrow();}
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));flow.originalOperations.mockReset();}
  });
  it.each(['/api/business','/api/business/settings','/api/%62usiness/rename','/%61pi/business/operation','/api%2fbusiness/settings'])('reserves the business namespace including encoded aliases: %s',path=>expect(requestTarget(path,origin).business).toBe(true));
  it('requires explicit authentication composition before enabling a business target',()=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'test',business:{businessId:'untrusted'}},async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each([{customers:true},{customers:true,authentication:{}},{customers:'yes'},{vehicles:true},{vehicles:true,authentication:{}},{vehicles:'yes'},{associations:true},{associations:true,authentication:{}},{associations:'yes'},{leads:true},{leads:true,authentication:{}},{leads:'yes'},{leadConversions:true},{leadConversions:true,leads:false},{leadConversions:'yes'}])('requires explicit boolean directory composition with authentication and business: %o',patch=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'test',...patch} as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each([false,true])('lead/source routing needs independent opt-in and retains bounded private delivery: %s',async enabled=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const local='http://127.0.0.1:'+address.port,pages=vi.fn(async()=>{});
    for(const handler of [flow.leads,flow.leadSources])handler.mockImplementation(async request=>new Response(request.url.endsWith('/large')?'x'.repeat(20000):request.url.endsWith('/oversize')?'x'.repeat(1048577):JSON.stringify({synthetic:'lead'})));
    bindApplicationHandler(server,{origin:local,environment:'test',customers:true,vehicles:true,associations:true,leads:enabled,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
    const before=[flow.leads.mock.calls.length,flow.leadSources.mock.calls.length],businessBefore=flow.business.mock.calls.length;
    try{
      for(const [index,stem] of ['leads','lead-sources'].entries()){
        const paths=['/api/business/'+stem,'/api/business/'+stem+'/context','/api/%62usiness/%6c'+stem.slice(1)+'/save',...(stem==='leads'?['/api/business/leads/vehicle-save','/api/%62usiness/leads/%76ehicle-operation','/api/business/leads/address-save','/api/%62usiness/leads/%61ddress-operation']:[])];
        for(const path of paths){
          const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(enabled?200:503);expect(await response.json()).toEqual(enabled?{synthetic:'lead'}:{error:stem==='leads'?'LEAD_REQUEST_FAILED':'LEAD_SOURCE_REQUEST_FAILED'});
        }
        expect([flow.leads,flow.leadSources][index]!.mock.calls.length-before[index]!).toBe(enabled?paths.length:0);
        if(enabled){expect((await(await fetch(local+'/api/business/'+stem+'/large',{method:'POST',body:'{}'})).text()).length).toBe(20000);await expect(fetch(local+'/api/business/'+stem+'/oversize',{method:'POST',body:'{}'})).rejects.toThrow();}
      }
      expect(flow.business.mock.calls.length).toBe(businessBefore);expect(pages).not.toHaveBeenCalled();
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));flow.leads.mockReset();flow.leadSources.mockReset();}
  });
  it('customer routing stays closed without opt-in and never falls through to business or Next',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(async()=>{});
    bindApplicationHandler(server,{origin:local,environment:'test',business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
    const previousBusiness=flow.business.mock.calls.length,previousCustomer=flow.customers.mock.calls.length;
    try{for(const path of ['/api/business/customers','/api/business/customers/context','/api/%62usiness/%63ustomers/save','/api/business/customers/addresses','/api/business/customers/addresses/context','/api/%62usiness/%63ustomers/%61ddresses/save']){const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(await response.json()).toEqual({error:path.includes('addresses')||path.includes('%61ddresses')?'ADDRESS_REQUEST_FAILED':'CUSTOMER_REQUEST_FAILED'});expect(response.headers.get('cache-control')).toContain('no-store');}expect(flow.business.mock.calls.length).toBe(previousBusiness);expect(flow.customers.mock.calls.length).toBe(previousCustomer);expect(flow.addresses).not.toHaveBeenCalled();expect(pages).not.toHaveBeenCalled();}
    finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each([false,true])('vehicle routing requires its own opt-in even with customers enabled: %s',enabled=>withVehicleServer(enabled,async(local,pages)=>{
    const before=flow.vehicles.mock.calls.length;
    for(const path of ['/api/business/vehicles','/api/business/vehicles/context','/api/%62usiness/%76ehicles/save']){
      const response=await fetch(local+path,{method:'POST',body:'{}'});
      expect(response.status).toBe(enabled?200:503);
      expect(await response.json()).toEqual(enabled?{synthetic:'vehicle'}:{error:'VEHICLE_REQUEST_FAILED'});
    }
    expect(flow.vehicles.mock.calls.length-before).toBe(enabled?3:0);expect(pages).not.toHaveBeenCalled();
  }));
  it('vehicle responses support bounded directory history and cancel oversized delivery',()=>withVehicleServer(true,async local=>{
    flow.vehicles.mockImplementation(async request=>new Response(request.url.endsWith('/oversize')?'x'.repeat(1048577):'x'.repeat(20000)));
    expect((await(await fetch(local+'/api/business/vehicles/history',{method:'POST',body:'{}'})).text()).length).toBe(20000);
    await expect(fetch(local+'/api/business/vehicles/oversize',{method:'POST',body:'{}'})).rejects.toThrow();
  }));
  it.each([false,true])('association routing needs its own opt-in independently of customer/vehicle routes: %s',async enabled=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const local='http://127.0.0.1:'+address.port,pages=vi.fn(async()=>{});
    flow.associations.mockImplementation(async request=>new Response(request.url.endsWith('/large')?'x'.repeat(20000):request.url.endsWith('/oversize')?'x'.repeat(1048577):JSON.stringify({synthetic:'association'})));
    bindApplicationHandler(server,{origin:local,environment:'test',customers:true,vehicles:true,associations:enabled,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
    const before=flow.associations.mock.calls.length,businessBefore=flow.business.mock.calls.length,vehiclesBefore=flow.vehicles.mock.calls.length;
    try{
      for(const path of ['/api/business/vehicle-associations','/api/business/vehicle-associations/context','/api/%62usiness/%76ehicle-associations/save']){
        const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(enabled?200:503);expect(await response.json()).toEqual(enabled?{synthetic:'association'}:{error:'ASSOCIATION_REQUEST_FAILED'});
      }
      expect(flow.associations.mock.calls.length-before).toBe(enabled?3:0);expect(flow.business.mock.calls.length).toBe(businessBefore);expect(flow.vehicles.mock.calls.length).toBe(vehiclesBefore);expect(pages).not.toHaveBeenCalled();
      if(enabled){expect((await(await fetch(local+'/api/business/vehicle-associations/large',{method:'POST',body:'{}'})).text()).length).toBe(20000);await expect(fetch(local+'/api/business/vehicle-associations/oversize',{method:'POST',body:'{}'})).rejects.toThrow();}
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));flow.associations.mockReset();}
  });
  it('customer pages have their own1MiB delivery bound while authentication/settings retain8KiB',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(async()=>{}),privateBody=JSON.stringify({synthetic:'é'.repeat(12000)});
    flow.customers.mockImplementation(async request=>new Response(request.url.endsWith('/oversize')?'x'.repeat(1048577):privateBody,{headers:{'cache-control':'private, no-store'}}));flow.addresses.mockImplementation(async request=>new Response(request.url.endsWith('/oversize')?'x'.repeat(1048577):privateBody,{headers:{'cache-control':'private, no-store'}}));flow.business.mockResolvedValue(new Response(privateBody));
    bindApplicationHandler(server,{origin:local,environment:'test',customers:true,business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},pages);
    try{const response=await fetch(local+'/api/business/customers/list',{method:'POST',body:'{}'});expect(response.status).toBe(200);expect(await response.text()).toBe(privateBody);expect(response.headers.get('cache-control')).toContain('no-store');await expect(fetch(local+'/api/business/customers/oversize',{method:'POST',body:'{}'})).rejects.toThrow();expect(await(await fetch(local+'/api/business/customers/addresses/list',{method:'POST',body:'{}'})).text()).toBe(privateBody);await expect(fetch(local+'/api/business/customers/addresses/oversize',{method:'POST',body:'{}'})).rejects.toThrow();await expect(fetch(local+'/api/business/settings',{method:'POST',body:'{}'})).rejects.toThrow();expect(pages).not.toHaveBeenCalled();}
    finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));flow.customers.mockReset();flow.addresses.mockReset();flow.business.mockReset();}
  });
  it.each(['/api/auth/login','/api/auth','/api/%61uth/login','/%61pi/auth/login','/api%2fauth/login'])('reserves the authentication namespace including encoded aliases: %s',path=>{
    expect(requestTarget(path,origin).authentication).toBe(true);
  });
  it.each(['/','/api/health','/api/author','/_next/static/app.js','/?_rsc=synthetic'])('retains canonical Next targets: %s',path=>expect(requestTarget(path,origin).authentication).toBe(false));
  it.each([undefined,'','http://evil.example.com/api/auth/login','//evil.example.com/api/auth/login','/api/../api/auth/login','/api/auth#secret','/api\\auth','/api/auth login','/api/%ZZ','/'+ 'x'.repeat(8192)])('denies ambiguous or unbounded raw targets %#',path=>{
    expect(()=>requestTarget(path,origin)).toThrow();
  });
  it('rejects a second request listener and production authentication without actual TLS',()=>{
    const server=createBoundedNodeServer(),pages=async()=>{};
    bindApplicationHandler(server,{origin,environment:'production'},pages);
    expect(()=>bindApplicationHandler(server,{origin,environment:'production'},pages)).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
    const another=createBoundedNodeServer();expect(()=>bindApplicationHandler(another,{origin,environment:'production',authentication:{} as never},pages)).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each([{origin:origin+'/'},{origin:'https://user:secret@crest.example.com'},{origin:'file:///tmp'},{environment:'development'}])('rejects invalid server configuration %#',patch=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'production',...patch} as NodeConfiguration,async()=>{})).toThrow();
  });
  it('serves private closed-auth JSON before Next and preserves page ownership',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(async(_request,response)=>{response.end('synthetic page');});
    bindApplicationHandler(server,{origin:local,environment:'test'},pages);
    try{
      for(const path of ['bootstrap','login','session','logout']){
        const response=await fetch(`${local}/api/auth/${path}`,{method:'POST',body:'{}',headers:{'content-type':'application/json',origin:local}});
        expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.has('set-cookie')).toBe(false);
      }
      for(const path of ['/api/business/settings','/api/business/rename','/api/%62usiness/operation']){
        const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'BUSINESS_REQUEST_FAILED'});expect(response.headers.get('cache-control')).toContain('no-store');
      }
      expect(pages).not.toHaveBeenCalled();expect(await(await fetch(local+'/')).text()).toBe('synthetic page');expect(pages).toHaveBeenCalledTimes(1);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('rejects excess headers instead of truncating a late security header',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`;
    bindApplicationHandler(server,{origin:local,environment:'test'},async()=>{throw new Error('must not reach Next');});
    try{
      const status=await new Promise<number|undefined>((resolve,reject)=>{const request=httpRequest(local+'/api/auth/bootstrap',{method:'POST',headers:Object.fromEntries(Array.from({length:129},(_,i)=>['x-synthetic-'+i,'value']))},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end('{}');});
      expect(status).toBe(400);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('bounds concurrent authentication work before flow IO and restores capacity after completion',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`;
    let release:()=>void=()=>{},entered:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});let count=0;
    flow.beginLogin.mockImplementation(async()=>{if(++count===32)entered();await gate;throw new Error('synthetic completion');});
    bindApplicationHandler(server,{origin:local,environment:'test',business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},async()=>{});
    const send=()=>fetch(local+'/api/auth/bootstrap',{method:'POST',body:'{}',headers:{origin:local,'content-type':'application/json'},signal:AbortSignal.timeout(10000)});
    const pending=Array.from({length:32},send);
    try{
      await ready;const excess=await send();expect(excess.status).toBe(503);await excess.text();expect(count).toBe(32);
      const business=await fetch(local+'/api/business/settings',{method:'POST',body:'{}'});expect(business.status).toBe(503);await business.text();expect(flow.business).not.toHaveBeenCalled();
      release();for(const response of await Promise.all(pending)){expect(response.status).toBe(400);await response.text();}
      const next=await send();expect(next.status).toBe(400);await next.text();expect(count).toBe(33);
    }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
