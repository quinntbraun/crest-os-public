import 'server-only';

import {financePreviewDatabase,productionFinanceDatabase,supplierDocumentWorkerDatabase} from '../../security/session-database.ts';
import {productionCapability} from '../../security/production-capabilities.ts';
import type {ProductionCapabilityConfiguration} from '../../security/production-capabilities.ts';
import {validateFinanceRuntimeConnection} from '../finance-runtime-configuration.ts';
import type {SessionDatabaseConfiguration} from '../../security/session-database.ts';
import {createSessionLifecycle} from '../../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../../security/session-credential.ts';
import {createSupplierBillOriginalWorkflow} from './supplier-bill-original-workflow.ts';
import type {createReceiptObjectStore} from './receipt-object-store.ts';
import type {createLocalSandboxValidator} from '../../files/local-sandbox-validator.ts';

type Config=SessionDatabaseConfiguration&ProductionCapabilityConfiguration&{businessId:string};
type Provider=Parameters<typeof createSessionLifecycle>[1];
type Tokens=Parameters<typeof createSessionLifecycle>[2];
const auth='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
const commands={
 read:'SELECT crest_commands.read_fictional_supplier_original('+auth+',$9::uuid) AS result',
 writable:'SELECT crest_commands.authorize_fictional_supplier_original_write('+auth+',$9::uuid,$10::uuid) AS result',
 reserve:'SELECT crest_commands.reserve_fictional_supplier_original('+auth+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::text,$15::integer) AS result',
 publish:'SELECT crest_commands.publish_fictional_supplier_original('+auth+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::jsonb) AS result',
};
function authorized(config:Config,provider:Provider,tokens:Tokens,database:ReturnType<typeof financePreviewDatabase>){
 if(config.environment==='production'&&!productionCapability(config,'supplierOriginals'))throw Error('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');
 const expectedBusiness=config.businessId;
 const sessions=createSessionLifecycle(config,provider,tokens);
 return async(kind:keyof typeof commands,credential:string,businessId:string,values:unknown[],signal:AbortSignal)=>{
  if(businessId!==expectedBusiness)throw Error('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');
  const pinnedValues=[...values];
  const session=await sessions.verify(credential,signal,'background',true);
  const hash=sessionCredentialHash(credential);
  try{
   const args=[hash,session.sessionId,session.actorId,session.provider.issuer,session.provider.subject,
    session.provider.sessionId,new Date(session.provider.expiresAt),businessId,...pinnedValues];
   return kind==='read'?await database(commands.read,args,signal)
    :await database.commandTransaction(query=>query(commands[kind],args),signal);
  }finally{hash.fill(0);}
 };
}
function access(run:ReturnType<typeof authorized>){
 return {
  read:(credential:string,businessId:string,id:string,signal:AbortSignal)=>run('read',credential,businessId,[id],signal),
  authorizeWrite:(credential:string,businessId:string,epoch:string,id:string,signal:AbortSignal)=>
   run('writable',credential,businessId,[epoch,id],signal),
 };
}
export function createSupplierOriginalDirectory(config:Config,provider:Provider,tokens:Tokens,financeConnectionString:string){
 if(config.environment==='production'){
  if(!productionCapability(config,'supplierOriginals'))throw Error('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');
  validateFinanceRuntimeConnection(config.connectionString,financeConnectionString);
 }
 const database=config.environment==='production'?productionFinanceDatabase({...config,connectionString:financeConnectionString}):financePreviewDatabase({connectionString:financeConnectionString,environment:'test'});
 const run=authorized(config,provider,tokens,database);
 return {...access(run),
  reserve:(credential:string,values:unknown[],signal:AbortSignal)=>run('reserve',credential,config.businessId,values,signal),
 };
}

// Trusted worker composition. The application transport gets only the scoped
// dispatch callback. It does not receive the worker login or a decoder.
export function createSupplierOriginalDispatcher(config:Config,provider:Provider,tokens:Tokens,workerConnectionString:string,
 objects:ReturnType<typeof createReceiptObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
 const workerUrl=new URL(workerConnectionString),webUrl=new URL(config.connectionString);
 if(config.environment==='production'&&!productionCapability(config,'supplierOriginals')||workerUrl.host!==webUrl.host||workerUrl.pathname!==webUrl.pathname||decodeURIComponent(workerUrl.username)===decodeURIComponent(webUrl.username))
  throw Error('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');
 const run=authorized(config,provider,tokens,supplierDocumentWorkerDatabase({...config,connectionString:workerConnectionString}));
 const workflow=createSupplierBillOriginalWorkflow({...access(run),
  publish:(credential,ref,candidate,signal)=>run('publish',credential,ref.businessId,
   [ref.recoveryEpoch,ref.operationId,ref.originalId,ref.billId,ref.billRevision,candidate],signal),
 },objects,validator);
 return async(credential:string,businessId:string,originalId:string,operationId:string,signal:AbortSignal)=>{
  await workflow.prepareAndPublish(credential,businessId,originalId,operationId,signal);
 };
}
