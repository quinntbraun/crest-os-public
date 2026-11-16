import 'server-only';
import next from 'next';
import nextConfig from '../../next.config.ts';
import {bindApplicationHandler,createBoundedNodeServer} from './node-server.ts';
import type {NodeConfiguration} from './node-server.ts';
import {prepareSyntheticGoogleCalendarRunner} from '../operations/google-calendar-worker.ts';
import {createLegacyContactImportDispatcher} from '../security/session-database.ts';
import {startLegacyContactImportRunner} from '../customer/legacy-contact-import-runner.ts';
export {openSyntheticSupplierStore,readSupplierProfile} from './synthetic-supplier-store.ts';
export {createAuthenticationRuntime} from './authentication-runtime.ts';
export {createTenantContextReader} from '../security/tenant-read.ts';
export {createMutationTransaction} from '../security/mutation-transaction.ts';
export {createBusinessOperationLookup} from '../security/business-operation-lookup.ts';
export {createBusinessNameCommand} from '../security/business-name-command.ts';
export {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
export {createBusinessHttp} from '../security/business-http.ts';
export {createCustomerDirectory} from '../customer/customer-directory.ts';
export {createCustomerHttp} from '../customer/customer-http.ts';
export {createQuoteDirectory} from '../commercial/quote-directory.ts';
export {createQuoteHttp} from '../commercial/quote-http.ts';
export {createQuoteReviewDirectory} from '../commercial/quote-review-directory.ts';
export {createQuoteReviewHttp} from '../commercial/quote-review-http.ts';

// One Node process, one listener, one Next application. No separate API service.
export async function createCrestApplication(config:NodeConfiguration){
  const server=createBoundedNodeServer(config.tls);
  const app=next({dev:false,quiet:true,conf:nextConfig,httpServer:server});
  try{
    await app.prepare();bindApplicationHandler(server,config,app.getRequestHandler());
    let stopCalendar:(()=>Promise<void>)|undefined;
    const calendar=config.syntheticGoogleCalendar,worker=calendar?.worker;
    let startCalendar:(()=>void)|undefined;
    if(worker!==undefined){
      if(config.environment!=='test'||!config.business||!config.tls||!calendar||
        Object.keys(worker).length!==1||typeof worker.connectionString!=='string')throw Error();
      const begin=await prepareSyntheticGoogleCalendarRunner({environment:'test',origin:config.origin,
        businessId:config.business.businessId,calendarKeyMaterial:calendar.calendarKeyMaterial,connectionString:worker.connectionString});
      startCalendar=()=>{
        const address=server.address();
        if(address&&typeof address!=='string'&&['127.0.0.1','::1'].includes(address.address)&&
          address.port===Number(new URL(config.origin).port||443))stopCalendar=begin();
      };
      server.once('listening',startCalendar);
      server.once('close',()=>{void stopCalendar?.();});
    }
    let startContactImport:(()=>void)|undefined;
    let stopContactImport:(()=>Promise<void>)|undefined;
    const contactWorker=config.syntheticLegacyContactImportWorker;
    if(contactWorker!==undefined){
      const target=new URL(config.origin);
      if(config.environment!=='test'||!config.business||!config.tls||config.syntheticLegacyContactApplications!=='background'||
       target.protocol!=='https:'||target.origin!==config.origin||!['127.0.0.1','[::1]'].includes(target.hostname)||
       !contactWorker||Object.keys(contactWorker).length!==1||typeof contactWorker.connectionString!=='string')throw Error();
      const dispatch=createLegacyContactImportDispatcher({environment:'test',connectionString:contactWorker.connectionString});
      startContactImport=()=>{
        const address=server.address();
        if(address&&typeof address!=='string'&&['127.0.0.1','::1'].includes(address.address)&&
         address.port===Number(target.port||443))stopContactImport=startLegacyContactImportRunner(dispatch);
      };
      server.once('listening',startContactImport);
      server.once('close',()=>{void stopContactImport?.();});
    }
    return {server,close:async()=>{
      if(startCalendar)server.off('listening',startCalendar);
      if(startContactImport)server.off('listening',startContactImport);
      const stopped=Promise.all([stopCalendar?.(),stopContactImport?.()]);
      server.closeAllConnections();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
      await stopped;
      await app.close();
    }};
  }catch{await app.close();throw new Error('APPLICATION_START_FAILED');}
}
export {createCustomerAddressDirectory} from '../customer/customer-address-directory.ts';

export {createCustomerAddressHttp} from '../customer/customer-address-http.ts';
export {createVehicleDirectory} from '../customer/vehicle-directory.ts';

export {createVehicleAssociationDirectory} from '../customer/vehicle-association-directory.ts';
export {createVehicleHttp} from '../customer/vehicle-http.ts';
export {createAssociationHttp} from '../customer/association-http.ts';
export {createLeadHttp} from '../customer/lead-http.ts';
export {createLeadSourceHttp} from '../customer/lead-source-http.ts';
export {createOriginalOperationDirectory} from '../security/original-operation-directory.ts';
export {createOriginalOperationHttp} from '../security/original-operation-http.ts';

export {createSourceExportHttp} from '../security/source-export-http.ts';
export {createSourceExportDownloadHttp} from '../security/source-export-download-http.ts';
