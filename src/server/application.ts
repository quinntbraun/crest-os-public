import 'server-only';
import next from 'next';
import nextConfig from '../../next.config.ts';
import {bindApplicationHandler,createBoundedNodeServer} from './node-server.ts';
import type {NodeConfiguration} from './node-server.ts';
export {createAuthenticationRuntime} from './authentication-runtime.ts';
export {createTenantContextReader} from '../security/tenant-read.ts';
export {createMutationTransaction} from '../security/mutation-transaction.ts';
export {createBusinessOperationLookup} from '../security/business-operation-lookup.ts';
export {createBusinessNameCommand} from '../security/business-name-command.ts';
export {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
export {createBusinessHttp} from '../security/business-http.ts';
export {createCustomerDirectory} from '../customer/customer-directory.ts';
export {createCustomerHttp} from '../customer/customer-http.ts';

// One Node process, one listener, one Next application. No separate API service.
export async function createCrestApplication(config:NodeConfiguration){
  const server=createBoundedNodeServer(config.tls);
  const app=next({dev:false,quiet:true,conf:nextConfig,httpServer:server});
  try{
    await app.prepare();bindApplicationHandler(server,config,app.getRequestHandler());
    return {server,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();}};
  }catch{await app.close();throw new Error('APPLICATION_START_FAILED');}
}
export {createCustomerAddressDirectory} from '../customer/customer-address-directory.ts';

export {createCustomerAddressHttp} from '../customer/customer-address-http.ts';
export {createVehicleDirectory} from '../customer/vehicle-directory.ts';
