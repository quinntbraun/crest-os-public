import {randomUUID,randomBytes} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createProductionCapabilities,productionCapabilityNames,productionFieldCapabilities,productionPickupCapabilities,productionPhotoWorkerBaseCapabilities} from '../../src/security/production-capabilities';
import {createAuthenticationRuntime} from '../../src/server/authentication-runtime';
import {createServiceHttp} from '../../src/commercial/service-http';
import {createQuoteHttp} from '../../src/commercial/quote-http';
import {createQuoteReviewHttp} from '../../src/commercial/quote-review-http';
import {createQuoteCommercialHttp} from '../../src/commercial/quote-commercial-http';
import {createQuoteAmendmentHttp} from '../../src/commercial/quote-amendment-http';
import {createHoldHttp} from '../../src/operations/appointment-hold-http';
import {createSchedulingHttp} from '../../src/operations/scheduling-http';
import {createBookingDirectory} from '../../src/operations/confirmed-booking-directory';
import {createFieldDirectory} from '../../src/operations/field-directory';
import {createCompletionDirectory} from '../../src/operations/work-completion-directory';
import {createMileageDirectory} from '../../src/operations/mileage-directory';
import {createSupportTripDirectory} from '../../src/operations/support-trip-directory';
import {createCustomerHttp} from '../../src/customer/customer-http';
import {createFinanceAccountHttp} from '../../src/bookkeeping/finance-account-http';
import {financeRuntimeFeatures,financeRuntimeFeatureNames} from '../../src/bookkeeping/finance-runtime-configuration';
import {createExpenseHttp} from '../../src/bookkeeping/expenses/expense-http';
import {createReceiptHttp} from '../../src/bookkeeping/expenses/receipt-http';
import {createReceiptDirectory} from '../../src/bookkeeping/expenses/receipt-directory';
import {createR2ReceiptObjectStore} from '../../src/bookkeeping/expenses/receipt-object-store';
import {createR2ObjectStore} from '../../src/files/private-object-store';
import {createDropoffPhotoHttp} from '../../src/operations/dropoff-photo-http';
import {createDropoffPhotoDirectory,createDropoffPhotoDispatcherDirectory} from '../../src/operations/dropoff-photo-directory';
import {custodyPhotoDispatcherDatabase} from '../../src/security/session-database';
import {supplierDocumentWorkerDatabase} from '../../src/security/session-database';
import {createSupplierBillOriginalHttp} from '../../src/bookkeeping/expenses/supplier-bill-original-http';
import {createSupplierOriginalDirectory,createSupplierOriginalDispatcher} from '../../src/bookkeeping/expenses/supplier-bill-original-directory';
import {createLocalSandboxValidator} from '../../src/files/local-sandbox-validator';

async function configuration(){
 const businessId=randomUUID(),runtime=await createAuthenticationRuntime({database:{environment:'production',connectionString:'postgresql://crest_runtime:fixture-only@database.example.com/crest'},
  provider:{environment:'production',issuer:'https://identity.example.com/auth/v1',publicKey:'sb_publishable_'+'a'.repeat(32)},owner:{subject:randomUUID(),factorId:randomUUID()},
  loginKey:randomBytes(32),activeKeyId:'fixture',keys:[{id:'fixture',key:randomBytes(32)}],ingress:{kind:'direct'}});
 const auth=runtime.forServer();return {auth,base:{...auth.configuration,environment:'production' as const,origin:'https://crest.example.com',businessId},
  grant:createProductionCapabilities({productionActivation:'ready'},businessId,productionCapabilityNames)};
}
it('constructs the full production pickup/return handler while refusing undeclared pickup access',async()=>{
 const {auth,base,grant}=await configuration();
 const prepare=(config:typeof base&{productionCapabilities?:typeof grant})=>createSchedulingHttp(config,auth.provider,auth.tokens,
  true,true, // Scheduling and amended agreements.
  true,true,true,true,true, // Field, completion, mileage, support, cancellation.
  true,true,true,true,true, // Work time/boundary/start/end and departure.
  true,true,true,true,true, // Review/history, maintenance, custody and policy.
  true,true,true,true,true,true,true); // Full pickup chain through failed return.
 expect(prepare({...base,productionCapabilities:grant})).toBeTypeOf('function');expect(()=>prepare(base)).toThrow('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 const withoutPickup=createProductionCapabilities({productionActivation:'ready'},base.businessId,productionCapabilityNames.filter(name=>!productionPickupCapabilities.some(pickup=>pickup===name))),config={...base,productionCapabilities:withoutPickup};
 expect(()=>prepare(config)).toThrow('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 const directory=createFieldDirectory(config,auth.provider,auth.tokens),signal=new AbortController().signal,jobId=randomUUID(),jobVehicleId=randomUUID();
 await expect(directory.pickupPolicy('not-a-session',base.businessId,null,signal)).rejects.toThrow('FIELD_REQUEST_FAILED');
 await expect(directory.pickupCollection('not-a-session',base.businessId,jobId,jobVehicleId,signal)).rejects.toThrow('FIELD_REQUEST_FAILED');
 await expect(directory.pickupTrips('not-a-session',base.businessId,jobId,{beforeDepartedAt:null,beforeLegId:null},signal)).rejects.toThrow('FIELD_REQUEST_FAILED');
 await expect(directory.vehicleCustodyQueue('not-a-session',base.businessId,{afterReceivedAt:null,afterCaseId:null},signal,'pickup')).rejects.toThrow('FIELD_REQUEST_FAILED');
 await expect(directory.saveSession('not-a-session',{schemaVersion:1,businessId:base.businessId,operationId:randomUUID(),recoveryEpoch:randomUUID(),jobId,expectedJobVersion:'1',body:{action:'start_pickup',reason:null}},signal)).rejects.toThrow('FIELD_SAVE_NOT_SUBMITTED');
});
it('composes production supplier original access/dispatch without authenticating, decoding or posting',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant},storage=createR2ReceiptObjectStore({accountId:'a'.repeat(32),bucket:'crest-private-suppliers',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'});
 const runtime={objects:storage.objects,stagingOrigin:storage.stagingOrigin,dispatch:async()=>{throw Error('No decoding in constructor test');}};
 const finance='postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',worker='postgresql://crest_supplier_runtime:fixture-only@database.example.com/crest',decoder=createLocalSandboxValidator({imageId:'sha256:'+'c'.repeat(64)});
 try{
  expect(createSupplierBillOriginalHttp(config,auth.provider,auth.tokens,finance,runtime)).toBeTypeOf('function');
  expect(createSupplierOriginalDispatcher(config,auth.provider,auth.tokens,worker,storage.objects,decoder)).toBeTypeOf('function');
  for(const denied of [base,{...config,businessId:randomUUID()}]){
   expect(()=>createSupplierBillOriginalHttp(denied,auth.provider,auth.tokens,finance,runtime)).toThrow();
   expect(()=>createSupplierOriginalDirectory(denied,auth.provider,auth.tokens,finance)).toThrow();
   expect(()=>createSupplierOriginalDispatcher(denied,auth.provider,auth.tokens,worker,storage.objects,decoder)).toThrow();
  }
  expect(()=>supplierDocumentWorkerDatabase({environment:'production',connectionString:worker})).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  for(const connection of [config.connectionString,config.connectionString.replace('crest_runtime','%63rest_runtime'),worker.replace(/\/crest$/,'/other')])expect(()=>createSupplierOriginalDispatcher(config,auth.provider,auth.tokens,connection,storage.objects,decoder)).toThrow();
  expect(()=>createSupplierBillOriginalHttp(config,auth.provider,auth.tokens,finance,{...runtime,stagingOrigin:'https://other.example.com'})).toThrow();
  const directory=createSupplierOriginalDirectory(config,auth.provider,auth.tokens,finance);
  await expect(directory.read('not-a-session',randomUUID(),randomUUID(),new AbortController().signal)).rejects.toThrow('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');
 }finally{storage.close();}
});
it('composes production custody photo access and restricted dispatch only for the declared business',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant},storage=createR2ObjectStore({accountId:'a'.repeat(32),bucket:'crest-private-photos',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'});
 const runtime={objects:storage.store,stagingOrigin:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',dispatch:async()=>{throw Error('No decoding in constructor test');}};
 const worker={environment:'production' as const,connectionString:'postgresql://crest_photo_runtime:fixture-only@database.example.com/crest'};
 try{
  expect(createDropoffPhotoHttp(config,auth.provider,auth.tokens,runtime)).toBeTypeOf('function');
  expect(createDropoffPhotoDispatcherDirectory(config,auth.provider,auth.tokens,worker).publish).toBeTypeOf('function');
  for(const denied of [base,{...config,businessId:randomUUID()}]){
   expect(()=>createDropoffPhotoHttp(denied,auth.provider,auth.tokens,runtime)).toThrow();
   expect(()=>createDropoffPhotoDirectory(denied,auth.provider,auth.tokens)).toThrow('DROPOFF_PHOTO_UNCONFIRMED');
   expect(()=>createDropoffPhotoDispatcherDirectory(denied,auth.provider,auth.tokens,worker)).toThrow();
  }
  expect(()=>custodyPhotoDispatcherDatabase(worker)).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  for(const connectionString of [config.connectionString,config.connectionString.replace('crest_runtime','%63rest_runtime'),worker.connectionString.replace(/\/crest$/,'/other')])expect(()=>createDropoffPhotoDispatcherDirectory(config,auth.provider,auth.tokens,{...worker,connectionString})).toThrow();
  expect(()=>createDropoffPhotoHttp(config,auth.provider,auth.tokens,{...runtime,stagingOrigin:'https://other.example.com'})).toThrow();
  expect(createDropoffPhotoHttp(config,auth.provider,auth.tokens,runtime,true,true)).toBeTypeOf('function');
  const photoOnly={...base,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},base.businessId,[...productionPhotoWorkerBaseCapabilities,'dropoffPhotos'])};
  expect(()=>createDropoffPhotoHttp(photoOnly,auth.provider,auth.tokens,runtime,true,true)).toThrow();
  const directory=createDropoffPhotoDirectory(config,auth.provider,auth.tokens);
  await expect(directory.read('not-a-session',{businessId:randomUUID(),jobVehicleId:randomUUID(),photoId:randomUUID()},new AbortController().signal)).rejects.toThrow('DROPOFF_PHOTO_UNCONFIRMED');
 }finally{storage.close();}
});
it('constructs production receipt storage/HTTP only with scoped authority and a fixed private relay destination',async()=>{
 const {auth,base,grant}=await configuration(),storage=createR2ReceiptObjectStore({accountId:'a'.repeat(32),bucket:'crest-private-receipts',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'});
 // No dispatch or authenticated request is performed by this composition test.
 const dispatch=async()=>{throw Error('Dispatcher must not execute during construction');};
 try{
  const config={...base,productionCapabilities:grant};
  expect(createReceiptHttp(config,auth.provider,auth.tokens,storage.objects,dispatch,true,storage.stagingOrigin)).toBeTypeOf('function');
  for(const denied of [base,{...config,businessId:randomUUID()}]){
   expect(()=>createReceiptHttp(denied,auth.provider,auth.tokens,storage.objects,dispatch,true,storage.stagingOrigin)).toThrow();
   expect(()=>createReceiptDirectory(denied,auth.provider,auth.tokens)).toThrow('RECEIPT_REQUEST_UNCONFIRMED');
  }
  for(const origin of [undefined,'http://127.0.0.1:9999','https://private.example.com',storage.stagingOrigin+'/',storage.stagingOrigin+':443'])expect(()=>createReceiptHttp(config,auth.provider,auth.tokens,storage.objects,dispatch,true,origin)).toThrow();
  const directory=createReceiptDirectory(config,auth.provider,auth.tokens);
  await expect(directory.read('not-a-session',randomUUID(),randomUUID(),new AbortController().signal)).rejects.toThrow('RECEIPT_REQUEST_UNCONFIRMED');
 }finally{storage.close();}
});
it('constructs prospective operational handlers with real adapters, without any session or provider success',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant};
 for(const factory of [createServiceHttp,createQuoteReviewHttp,createQuoteCommercialHttp,createHoldHttp])expect(factory(config,auth.provider,auth.tokens,true)).toBeTypeOf('function');
 expect(createQuoteHttp(config,auth.provider,auth.tokens,true,true,true,true)).toBeTypeOf('function');
 expect(createQuoteAmendmentHttp(config,auth.provider,auth.tokens,true,true)).toBeTypeOf('function');
 expect(createSchedulingHttp(config,auth.provider,auth.tokens,true,true)).toBeTypeOf('function');
 expect(createBookingDirectory(config,auth.provider,auth.tokens,true).workspace).toBeTypeOf('function');
});
it('keeps production handlers closed without a capability or with a different business',async()=>{
 const {auth,base,grant}=await configuration();
 for(const config of [base,{...base,businessId:randomUUID(),productionCapabilities:grant}]){
  for(const factory of [createServiceHttp,createQuoteHttp,createQuoteReviewHttp,createQuoteCommercialHttp,createQuoteAmendmentHttp,createHoldHttp,createSchedulingHttp])expect(()=>factory(config,auth.provider,auth.tokens,true)).toThrow();
  expect(()=>createBookingDirectory(config,auth.provider,auth.tokens,true)).toThrow('BOOKING_CONFIGURATION_REQUIRED');
 }
});
it('separates amendment acceptance from quote/scheduling access and refuses undeclared field modes',async()=>{
 const {auth,base}=await configuration(),commercial=productionCapabilityNames.filter(value=>!productionFieldCapabilities.some(field=>field===value)),grant=createProductionCapabilities({productionActivation:'ready'},base.businessId,commercial.filter(value=>value!=='quoteAmendmentAcceptance'));
 const config={...base,productionCapabilities:grant};
 expect(()=>createQuoteHttp(config,auth.provider,auth.tokens,true,true,true,true)).toThrow('QUOTE_HTTP_CONFIGURATION_REQUIRED');
 expect(()=>createQuoteAmendmentHttp(config,auth.provider,auth.tokens,true,true)).toThrow('QUOTE_AMENDMENT_HTTP_CONFIGURATION_REQUIRED');
 expect(()=>createSchedulingHttp(config,auth.provider,auth.tokens,true,true)).toThrow('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 const all={...base,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},base.businessId,commercial)};
 expect(()=>createSchedulingHttp(all,auth.provider,auth.tokens,true,true,true)).toThrow('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
});
it('constructs declared field, completion, mileage, work-time and follow-up adapters without authorizing a session',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant};
 expect(createSchedulingHttp(config,auth.provider,auth.tokens,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true)).toBeTypeOf('function');
 expect(createFieldDirectory(config,auth.provider,auth.tokens).saveSession).toBeTypeOf('function');
 expect(createCompletionDirectory(config,auth.provider,auth.tokens)).toBeDefined();
 expect(createMileageDirectory(config,auth.provider,auth.tokens)).toBeDefined();
 expect(createSupportTripDirectory(config,auth.provider,auth.tokens)).toBeDefined();
 expect(createCustomerHttp(config,auth.provider,auth.tokens,true,true)).toBeTypeOf('function');
});
it('refuses field directory construction for missing or foreign-business composition authority',async()=>{
 const {auth,base,grant}=await configuration();
 for(const config of [base,{...base,businessId:randomUUID(),productionCapabilities:grant}]){
  for(const factory of [createFieldDirectory,createCompletionDirectory,createMileageDirectory,createSupportTripDirectory])expect(()=>factory(config,auth.provider,auth.tokens)).toThrow();
 }
});
it('rejects a foreign-business field read before parsing a cookie or contacting a provider/database',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant},directory=createFieldDirectory(config,auth.provider,auth.tokens);
 await expect(directory.dropoffPolicy('not-a-session',randomUUID(),randomUUID(),new AbortController().signal)).rejects.toThrow('FIELD_REQUEST_FAILED');
});
it('constructs explicit production finance/expense adapters without a session or any financial action',async()=>{
 const {auth,base,grant}=await configuration(),config={...base,productionCapabilities:grant};
 const connection='postgresql://crest_finance_runtime:fixture-only@database.example.com/crest';
 expect(createFinanceAccountHttp(config,connection,auth.provider,auth.tokens,financeRuntimeFeatures(financeRuntimeFeatureNames))).toBeTypeOf('function');
 expect(createExpenseHttp(config,auth.provider,auth.tokens,true)).toBeTypeOf('function');
 for(const denied of [base,{...base,businessId:randomUUID(),productionCapabilities:grant}]){
  expect(()=>createFinanceAccountHttp(denied,connection,auth.provider,auth.tokens)).toThrow();
  expect(()=>createExpenseHttp(denied,auth.provider,auth.tokens,true)).toThrow();
 }
});
