import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {bindApplicationHandler,createBoundedNodeServer} from '../../src/server/node-server';
import type {NodeConfiguration} from '../../src/server/node-server';
it('appointment composition requires synthetic authentication, business and shared recovery',()=>{
 for(const patch of [
  {environment:'test',syntheticAppointmentHolds:true},
  {environment:'test',syntheticAppointmentHolds:'yes'},
  {environment:'production',syntheticAppointmentHolds:true,authentication:{},business:{businessId:'synthetic'},operationResolution:true},
  {environment:'test',syntheticAppointmentHolds:true,authentication:{},business:{businessId:'synthetic'},operationResolution:false},
 ]){const server=createBoundedNodeServer();try{expect(()=>bindApplicationHandler(server,{origin:'https://crest.example.com',...patch} as NodeConfiguration,async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');expect(server.listenerCount('request')).toBe(0);}finally{server.close();}}
});
it('disabled appointment paths including encoded aliases never fall through to application pages',async()=>{
 const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();const origin='http://127.0.0.1:'+address.port,pages=vi.fn(async()=>{});
 bindApplicationHandler(server,{origin,environment:'test'},pages);
 try{for(const path of ['/api/business/appointment-holds/save','/api/business/%61ppointment-holds/history','/api%2fbusiness/appointment-holds/operation']){const response=await fetch(origin+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual({error:'HOLD_REQUEST_FAILED'});}expect(pages).not.toHaveBeenCalled();}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
