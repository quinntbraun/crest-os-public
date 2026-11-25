import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionProfile,productionReleaseAccepted,readProductionProfile} from '../../src/server/production-configuration';
import compatibility from '../../release/compatibility.json';
import {productionCapabilityNames} from '../../src/security/production-capabilities';
import {financeRuntimeFeatureNames} from '../../src/bookkeeping/finance-runtime-configuration';
import {productionPhotoWorkerBaseCapabilities} from '../../src/security/production-capabilities';

function profile(){return {schemaVersion:1,origin:'https://workspace.example.com',listen:{address:'127.0.0.1',port:3000},businessId:randomUUID(),
 authentication:{databaseUrl:'postgresql://crest_runtime:fixture-only@database.example.com/crest',issuer:'https://identity.example.com/auth/v1',publicKey:'sb_publishable_'+'a'.repeat(32),
  owner:{subject:randomUUID(),factorId:randomUUID()},loginKey:randomBytes(32).toString('base64url'),activeKeyId:'current',tokenKeys:[{id:'current',key:randomBytes(32).toString('base64url')}]},
 tls:{keyFile:resolve('.local/operator/tls-key.pem'),certFile:resolve('.local/operator/tls-cert.pem')},
 capabilities:['customers','vehicles','associations','leads','leadFollowUps','leadMatchReview','leadConversions','operationResolution','catalog']};}
it('requires private source-export storage/keys with the capability and separates them from authentication secrets',()=>{
 const input=profile(),exports={connectionString:'postgresql://crest_source_export:fixture-only@database.example.com/crest',storage:{accountId:'a'.repeat(32),bucket:'crest-private-exports',accessKeyId:'fixture-only-export-access',secretAccessKey:'fixture-only-export-secret'},activeKeyId:'export-current',keys:[{id:'export-current',key:randomBytes(32).toString('base64url')}]};
 const complete={...input,capabilities:[...input.capabilities,'businessExports'],exports};
 expect(parseProductionProfile(JSON.stringify(complete)).forServer).toBeTypeOf('function');expect(()=>JSON.stringify(parseProductionProfile(JSON.stringify(complete)))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
 for(const value of [{...input,exports},{...complete,exports:undefined},{...complete,exports:{...exports,appReleaseId:'a'.repeat(40)}},{...complete,exports:{...exports,connectionString:input.authentication.databaseUrl}},{...complete,exports:{...exports,keys:[{id:'export-current',key:input.authentication.loginKey}]}},{...complete,exports:{...exports,keys:[{id:'export-current',key:input.authentication.tokenKeys[0]!.key}]}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires private export credentials with finance authority and rejects runtime-selected release metadata',()=>{
 const input=profile(),finance={connectionString:'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',features:[]},financeExports={connectionString:'postgresql://crest_export_login:fixture-only@database.example.com/crest'};
 const complete={...input,capabilities:[...input.capabilities,'finance','financeExports'],finance,financeExports};
 expect(parseProductionProfile(JSON.stringify(complete)).forServer).toBeTypeOf('function');
 for(const value of [{...input,financeExports},{...complete,financeExports:undefined},{...complete,financeExports:{...financeExports,appReleaseId:'a'.repeat(40)}},{...complete,financeExports:{connectionString:finance.connectionString}},{...complete,financeExports:{connectionString:input.authentication.databaseUrl}},{...complete,financeExports:{connectionString:financeExports.connectionString.replace('.com/crest','.com/other')}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires real Calendar material, matching capability and distinct authentication/integration keys',()=>{
 const input=profile(),calendar={connectionString:'postgresql://crest_calendar_setup:fixture-only@database.example.com/crest',clientId:'crest-owner-client.apps.googleusercontent.com',clientSecret:'fixture-only-client-secret',verifierKeyId:'calendar-pkce',credentialKeyId:'calendar-grants',calendarKeyMaterial:randomBytes(32).toString('base64url'),googleOwner:'crest-owner@example.com'};
 const capabilities=['customers','vehicles','associations','operationResolution','quotes','quoteReview','quoteCommercial','scheduling','googleCalendar'],complete={...input,capabilities,calendar};
 expect(parseProductionProfile(JSON.stringify(complete)).forServer).toBeTypeOf('function');
 for(const value of [{...input,capabilities},{...input,calendar},{...complete,calendar:{...calendar,calendarKeyMaterial:input.authentication.loginKey}},{...complete,calendar:{...calendar,calendarKeyMaterial:input.authentication.tokenKeys[0]!.key}},{...complete,calendar:{...calendar,credentialKeyId:calendar.verifierKeyId}},{...complete,calendar:{...calendar,connectionString:input.authentication.databaseUrl}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('accepts the complete pickup chain only with its real photo-worker configuration',()=>{
 const input=profile(),photos={storage:{accountId:'a'.repeat(32),bucket:'crest-private-photos',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'},worker:{origin:'https://photo-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')}};
 const capabilities=productionCapabilityNames.filter(name=>name!=='businessExports'&&!['finance','financeExports','expenseReceipts','supplierOriginals','openingDocuments','googleCalendar'].includes(name));
 expect(parseProductionProfile(JSON.stringify({...input,capabilities,photos})).forServer).toBeTypeOf('function');
 expect(()=>parseProductionProfile(JSON.stringify({...input,capabilities}))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires supplier originals together with private worker/storage and finance review prerequisites',()=>{
 const input=profile(),supplierOriginals={storage:{accountId:'a'.repeat(32),bucket:'crest-private-suppliers',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'},worker:{origin:'https://supplier-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')}};
 const capabilities=[...input.capabilities,'finance','supplierOriginals'],finance={connectionString:'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',features:['moneyChannels','supplierBillDrafts','supplierPayableReview']};
 const complete={...input,capabilities,finance,supplierOriginals};expect(parseProductionProfile(JSON.stringify(complete)).forServer).toBeTypeOf('function');
 for(const value of [{...input,capabilities,finance},{...input,supplierOriginals},{...complete,finance:{...finance,features:['moneyChannels','supplierBillDrafts']}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires opening documents together with their own worker, finance capability and opening worksheet',()=>{
 const input=profile(),openingDocuments={storage:{accountId:'a'.repeat(32),bucket:'crest-private-documents',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'},worker:{origin:'https://document-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')}};
 const capabilities=[...input.capabilities,'finance','openingDocuments'],finance={connectionString:'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',features:['moneyChannels','openingWorksheet']};
 const complete={...input,capabilities,finance,openingDocuments};
 expect(parseProductionProfile(JSON.stringify(complete)).forServer).toBeTypeOf('function');
 for(const value of [{...input,capabilities,finance},{...input,openingDocuments},{...complete,finance:{...finance,features:['moneyChannels']}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires production photo storage/worker material together with custody dependencies',()=>{
 const input=profile(),photos={storage:{accountId:'a'.repeat(32),bucket:'crest-private-photos',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'},worker:{origin:'https://photo-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')}};
 const capabilities=[...productionPhotoWorkerBaseCapabilities,'dropoffPhotos'];
 expect(parseProductionProfile(JSON.stringify({...input,capabilities,photos})).forServer).toBeTypeOf('function');
 for(const value of [{...input,capabilities},{...input,photos},{...input,capabilities:capabilities.filter(name=>name!=='dropoffCustody'),photos}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires private receipt storage/worker material and its capability together',()=>{
 const input=profile(),receipts={storage:{accountId:'a'.repeat(32),bucket:'crest-private-receipts',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'},
  worker:{origin:'https://worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')}};
 const capabilities=[...input.capabilities,'expenses','expenseReceipts'];
 expect(parseProductionProfile(JSON.stringify({...input,capabilities,receipts})).forServer).toBeTypeOf('function');
 for(const value of [{...input,capabilities},{...input,receipts},{...input,capabilities,receipts:{...receipts,worker:{...receipts.worker,skipTlsVerification:true}}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('accepts explicit production configuration without exposing its private fields or activating a connection',()=>{
 const configured=parseProductionProfile(JSON.stringify(profile(),null,2));
 expect(Object.keys(configured)).toEqual([]);expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
 expect(configured.forServer).toBeTypeOf('function');
});
it('accepts declared operational controls without private file or finance material',()=>{
 const input=profile();input.capabilities=productionCapabilityNames.filter(name=>name!=='businessExports'&&name!=='finance'&&name!=='financeExports'&&name!=='expenseReceipts'&&name!=='dropoffPhotos'&&name!=='supplierOriginals'&&name!=='openingDocuments'&&name!=='googleCalendar'&&!['pickupPhotos','pickupRelease','pickupReturnFailure'].includes(name));
 expect(parseProductionProfile(JSON.stringify(input)).forServer).toBeTypeOf('function');
});
it('accepts explicit finance connection/features while retaining private configuration',()=>{
 const input={...profile(),capabilities:productionCapabilityNames.filter(name=>name!=='businessExports'&&name!=='financeExports'&&name!=='expenseReceipts'&&name!=='dropoffPhotos'&&name!=='supplierOriginals'&&name!=='openingDocuments'&&name!=='googleCalendar'&&!['pickupPhotos','pickupRelease','pickupReturnFailure'].includes(name)),finance:{connectionString:'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',features:[...financeRuntimeFeatureNames]}};
 expect(parseProductionProfile(JSON.stringify(input)).forServer).toBeTypeOf('function');
 expect(()=>JSON.stringify(parseProductionProfile(JSON.stringify(input)))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('accepts an explicit managed Render profile without a redundant app certificate',()=>{
 const {tls,...base}=profile();void tls;
 const ingress={kind:'render',serviceId:'srv-fixture',hostname:'crest-fixture.onrender.com',peers:['10.0.0.5']};
 const managed={...base,listen:{address:'0.0.0.0',port:10000},ingress};
 expect(parseProductionProfile(JSON.stringify(managed)).forServer).toBeTypeOf('function');
 for(const value of [{...managed,tls:profile().tls},{...managed,listen:{address:'127.0.0.1',port:10000}},{...managed,ingress:{...ingress,peers:['10.0.0.0/8']}}])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('requires finance credentials and capability together, with a separate restricted login and complete dependencies',()=>{
 const input=profile(),finance={connectionString:'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest',features:[] as string[]};
 for(const value of [
  {...input,capabilities:[...input.capabilities,'finance']},
  {...input,finance},
  {...input,capabilities:[...input.capabilities,'finance'],finance:{...finance,connectionString:input.authentication.databaseUrl}},
  {...input,capabilities:[...input.capabilities,'finance'],finance:{...finance,connectionString:'postgresql://crest_finance_runtime:fixture-only@other.example.com/crest'}},
  {...input,capabilities:[...input.capabilities,'finance'],finance:{...finance,features:['invoiceIssue']}},
  {...input,capabilities:[...input.capabilities,'finance'],finance:{...finance,features:['invoicePreparation']}},
 ])expect(()=>parseProductionProfile(JSON.stringify(value))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('keeps the actual release closed regardless of any private profile',()=>{
 expect(productionReleaseAccepted(compatibility)).toBe(false);
 for(const value of [null,{},true,{productionActivation:true},{productionActivation:'test'},{productionActivation:'blocked'},Object.create({productionActivation:'ready'})])expect(productionReleaseAccepted(value)).toBe(false);
 expect(productionReleaseAccepted({productionActivation:'ready'})).toBe(true);
});
it('also refuses direct profile composition while the actual bundled release is blocked',async()=>{
 const input=profile();input.capabilities=['customers'];
 await expect(parseProductionProfile(JSON.stringify(input)).forServer()).rejects.toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('rejects construction-only and unknown capabilities rather than silently omitting them',()=>{
 for(const capability of ['syntheticCatalog','unregisteredFinance','pickupPhotos','googleCalendar','unexpected']){
  const input=profile();input.capabilities.push(capability);expect(()=>parseProductionProfile(JSON.stringify(input))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
 }
});
it('requires complete dependencies for enabled capabilities',()=>{
 for(const missing of ['customers','vehicles','associations','leads','operationResolution']){
  const input=profile();input.capabilities=input.capabilities.filter(item=>item!==missing);expect(()=>parseProductionProfile(JSON.stringify(input))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
 }
});
it('keeps the login signing key separate from token-encryption keys',()=>{
 const input=profile();input.authentication.loginKey=input.authentication.tokenKeys[0]!.key;
 expect(()=>parseProductionProfile(JSON.stringify(input))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
});
it('rejects an insecure origin, provider, key ring, path and malformed listen settings',()=>{
 const mutations=[(v:ReturnType<typeof profile>)=>{v.origin='http://workspace.example.com';},v=>{v.authentication.issuer='http://identity.example.com/auth/v1';},v=>{v.authentication.loginKey='invalid';},v=>{v.authentication.tokenKeys.push({...v.authentication.tokenKeys[0]!});},v=>{v.authentication.activeKeyId='missing';},v=>{v.tls.keyFile='relative.pem';},v=>{v.listen.port=0;},v=>{v.listen.address='public.example.com';},v=>{v.authentication.databaseUrl+='?sslmode=disable';}] satisfies ((value:ReturnType<typeof profile>)=>void)[];
 for(const mutate of mutations){const input=profile();mutate(input);expect(()=>parseProductionProfile(JSON.stringify(input))).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');}
});
it('rejects duplicate decoded fields, extra fields, oversize and malformed JSON without echoing configuration',()=>{
 const source=JSON.stringify(profile());
 for(const input of [source.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),source.replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'),source.replace('"schemaVersion":1','"schemaVersion":1,"productionActivation":"ready"'),source+'x',' '.repeat(65537)]){
  expect(()=>parseProductionProfile(input)).toThrow('PRODUCTION_CONFIGURATION_REQUIRED');
 }
});
it('does not expose private filenames or filesystem errors for an unreadable profile',async()=>{
 await expect(readProductionProfile(resolve('.local/missing-production-profile-'+randomUUID()+'.json'))).rejects.toMatchObject({message:'PRODUCTION_CONFIGURATION_REQUIRED'});
});
