import {createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const flow=vi.hoisted(()=>({owner:vi.fn<(request:Request)=>Promise<Response>>(),downloads:vi.fn<(request:Request)=>Promise<Response>>(),auth:vi.fn<(request:Request)=>Promise<Response>>(),business:vi.fn<(request:Request)=>Promise<Response>>(),ownerFactory:vi.fn(),downloadFactory:vi.fn()}));
vi.mock('../../src/security/authentication-http.ts',()=>({createAuthenticationHttp:()=>flow.auth,settleAuthenticationResponse:async()=>{}}));
vi.mock('../../src/security/business-http.ts',async original=>({...await original<typeof import('../../src/security/business-http.ts')>(),createBusinessHttp:()=>flow.business}));
vi.mock('../../src/security/source-export-http.ts',async original=>({...await original<typeof import('../../src/security/source-export-http.ts')>(),createSourceExportHttp:(...args:unknown[])=>{flow.ownerFactory(...args);return flow.owner;}}));
vi.mock('../../src/security/source-export-download-http.ts',async original=>({...await original<typeof import('../../src/security/source-export-download-http.ts')>(),createSourceExportDownloadHttp:(...args:unknown[])=>{flow.downloadFactory(...args);return flow.downloads;}}));
import {bindApplicationHandler,createBoundedNodeServer} from '../../src/server/node-server.ts';
import type {NodeConfiguration} from '../../src/server/node-server.ts';
import {sourceExportDownloadResponse} from '../../src/server/source-export-download-response.ts';
import {sourceExportDeliveryFixture} from '../support/source-export-delivery-fixture.ts';
const release='a'.repeat(40),businessId='11111111-1111-4111-8111-111111111111';
const auth={configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never};
const store={readVerified:vi.fn()} as NonNullable<NodeConfiguration['sourceExports']>['store'];
const privateResponse=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'cache-control':'private, no-store'}});
beforeEach(()=>{
 for(const mock of Object.values(flow))mock.mockReset();
 flow.owner.mockImplementation(async()=>privateResponse({kind:'owner'}));flow.downloads.mockImplementation(async()=>privateResponse({kind:'downloads'}));flow.auth.mockImplementation(async()=>privateResponse({kind:'auth'}));flow.business.mockImplementation(async()=>privateResponse({kind:'business'}));
});
async function serve(patch:Partial<NodeConfiguration>,work:(origin:string,pages:ReturnType<typeof vi.fn>)=>Promise<void>){
 const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();
 const origin='http://127.0.0.1:'+address.port,pages=vi.fn(async()=>{throw Error('private API must not reach Next');});
 try{bindApplicationHandler(server,{origin,environment:'test',...patch},pages);await work(origin,pages);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const enabled={authentication:auth,business:{businessId},sourceExports:{appReleaseId:release,store}};
it.each([null,false,true,[],{}, {appReleaseId:'short',store},{appReleaseId:'A'.repeat(40),store},{appReleaseId:release},{appReleaseId:release,store:{}},{appReleaseId:release,store:{readVerified:true}}])('refuses incomplete trusted export configuration before installing a listener: %o',sourceExports=>{
 const server=createBoundedNodeServer();
 expect(()=>bindApplicationHandler(server,{origin:'http://127.0.0.1:3000',environment:'test',authentication:auth,business:{businessId},sourceExports} as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
 expect(server.listenerCount('request')).toBe(0);expect(flow.ownerFactory).not.toHaveBeenCalled();expect(flow.downloadFactory).not.toHaveBeenCalled();
});
it.each([{sourceExports:enabled.sourceExports},{authentication:auth,sourceExports:enabled.sourceExports}])('requires both authentication and a server-selected business: %o',patch=>{
 expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin:'http://127.0.0.1:3000',environment:'test',...patch},async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
});
it.each([{}, {authentication:auth}, {authentication:auth,business:{businessId}}])('keeps every export namespace private and disabled by default: %o',async patch=>{
 await serve(patch,async(origin,pages)=>{
  for(const path of ['/api/business/exports','/api/business/exports/context','/api/%62usiness/%65xports/request','/api%2fbusiness/exports/original','/api/business/exports/downloads','/api/business/exports/%66ile','/api/business/exports/file/unknown']){
   const response=await fetch(origin+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual({error:path.includes('downloads')||path.includes('%66ile')||path.includes('file/')?'SOURCE_EXPORT_DOWNLOAD_UNAVAILABLE':'SOURCE_EXPORT_REQUEST_FAILED'});
  }
  expect(pages).not.toHaveBeenCalled();expect(flow.ownerFactory).not.toHaveBeenCalled();expect(flow.downloadFactory).not.toHaveBeenCalled();expect(flow.business).not.toHaveBeenCalled();
 });
});
it('routes only exports to the explicit factories with the pinned server business, release, provider and private store',async()=>{
 await serve(enabled,async(origin,pages)=>{
  for(const path of ['/api/business/exports','/api/business/exports/context','/api/business/exports/list','/api/business/exports/request','/api/business/exports/status','/api/business/exports/original','/api/business/exports/retire','/api/business/exports/resolution','/api/%62usiness/%65xports/list','/api%2fbusiness/exports/context']){
   expect(await(await fetch(origin+path,{method:'POST',body:'{}'})).json()).toEqual({kind:'owner'});
  }
  for(const path of ['/api/business/exports/downloads','/api/business/exports/file','/api/business/exports/%66ile','/api/business/exports/downloads/unknown'])expect(await(await fetch(origin+path,{method:'POST',body:'{}'})).json()).toEqual({kind:'downloads'});
  expect(flow.ownerFactory).toHaveBeenCalledExactlyOnceWith({ingress:{kind:'direct'},origin,environment:'test',businessId,appReleaseId:release},auth.provider,auth.tokens,true);
  expect(flow.downloadFactory).toHaveBeenCalledExactlyOnceWith({ingress:{kind:'direct'},origin,environment:'test',businessId},auth.provider,auth.tokens,store,true);
  expect(flow.owner).toHaveBeenCalledTimes(10);expect(flow.downloads).toHaveBeenCalledTimes(4);expect(flow.auth).not.toHaveBeenCalled();expect(flow.business).not.toHaveBeenCalled();expect(pages).not.toHaveBeenCalled();
 });
});
it.each(['context','downloads','file'])('keeps unbranded %s responses under the16KiB metadata cap regardless of attachment headers',async path=>{
 const handler=path==='context'?flow.owner:flow.downloads;
 handler.mockImplementation(async request=>new Response('x'.repeat(request.headers.get('x-test-size')==='large'?16385:16384),{headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fake.csv"','cache-control':'private, no-store'}}));
 await serve(enabled,async origin=>{
  const target=origin+'/api/business/exports/'+path;
  expect((await(await fetch(target,{method:'POST',body:'{}'})).text()).length).toBe(16384);
  await expect(fetch(target,{method:'POST',headers:{'x-test-size':'large'},body:'{}'})).rejects.toThrow();
 });
});
it.each(['file','downloads','context'])('uses the one-use verified binary handoff only at the file endpoint, rejecting it at %s otherwise',async path=>{
 const f=sourceExportDeliveryFixture(),bytes=Buffer.alloc(20000,97),digest=createHash('sha256').update(bytes).digest('hex');
 const handoff=sourceExportDownloadResponse({header:{...f.p.header,totalBytes:20000+(f.files.length-1)*32},file:{...f.p.file,bytes:20000,sha256:digest},bytes},new AbortController().signal);
 (path==='context'?flow.owner:flow.downloads).mockResolvedValue(handoff.response);
 await serve(enabled,async origin=>{
  if(path==='file'){
   const response=await fetch(origin+'/api/business/exports/file',{method:'POST',body:'{}'});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('x-crest-sha256')).toBe(digest);expect(response.headers.get('content-disposition')).toContain(f.files[0]!.fileName);await handoff.completion;
   // A used branded response can never fall back to the JSON writer.
   await expect(fetch(origin+'/api/business/exports/file',{method:'POST',body:'{}'})).rejects.toThrow();
  }else{
   await expect(fetch(origin+'/api/business/exports/'+path,{method:'POST',body:'{}'})).rejects.toThrow();await expect(handoff.completion).rejects.toThrow();
  }
 });
 bytes.fill(0);
});
it.each(['context','file'])('returns a private fixed failure for %s without exposing thrown private material',async path=>{
 (path==='context'?flow.owner:flow.downloads).mockRejectedValue(Error('PRIVATE_CONNECTION_OR_STORAGE_MATERIAL'));
 await serve(enabled,async(origin,pages)=>{
  const response=await fetch(origin+'/api/business/exports/'+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual({error:path==='file'?'SOURCE_EXPORT_DOWNLOAD_UNAVAILABLE':'SOURCE_EXPORT_REQUEST_FAILED'});expect(pages).not.toHaveBeenCalled();
 });
});
it('shares the existing32-request admission ceiling across export metadata and files and releases it after completion',async()=>{
 const releases:Array<()=>void>=[];
 const hold=()=>new Promise<Response>(resolve=>releases.push(()=>resolve(privateResponse({finished:true}))));
 flow.owner.mockImplementation(hold);flow.downloads.mockImplementation(hold);
 await serve(enabled,async origin=>{
  const requests=Array.from({length:32},(_,i)=>fetch(origin+'/api/business/exports/'+(i%2?'context':'file'),{method:'POST',body:'{}'}));
  try{
   await vi.waitFor(()=>expect(releases).toHaveLength(32));
   const blocked=await fetch(origin+'/api/auth/session',{method:'POST',body:'{}'});expect(blocked.status).toBe(503);expect(flow.auth).not.toHaveBeenCalled();
  }finally{for(const release of releases)release();}
  const responses=await Promise.all(requests);for(const response of responses)expect(await response.json()).toEqual({finished:true});
  expect((await fetch(origin+'/api/auth/session',{method:'POST',body:'{}'})).status).toBe(200);expect(flow.auth).toHaveBeenCalledOnce();
 });
});
