import 'server-only';
import {financePreviewDatabase,productionFinanceDatabase,openingDocumentWorkerDatabase} from '../security/session-database.ts';
import {productionCapability} from '../security/production-capabilities.ts';
import type {ProductionCapabilityConfiguration} from '../security/production-capabilities.ts';
import {validateFinanceRuntimeConnection} from './finance-runtime-configuration.ts';
import {getServerBuildIdentity,getServerMigrationIdentity} from '../server/build-identity.ts';
import {openingDocument142SourceProfile} from '../tooling/opening-document142-catalog.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOpeningDocumentReserve,parseOpeningDocumentEvidence} from './opening-document-contract.ts';
import {createOpeningDocumentWorkflow,parseOpeningDocumentRecord} from './opening-document-workflow.ts';
import type {createReceiptObjectStore} from './expenses/receipt-object-store.ts';
import type {createLocalSandboxValidator} from '../files/local-sandbox-validator.ts';
type Config=SessionDatabaseConfiguration&ProductionCapabilityConfiguration&Readonly<{businessId:string}>;
type Provider=Parameters<typeof createSessionLifecycle>[1];type Tokens=Parameters<typeof createSessionLifecycle>[2];
const auth='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
const commands={find:'SELECT crest_commands.find_fictional_opening_document('+auth+',$9::text,$10::text) AS result',read:'SELECT crest_commands.read_fictional_opening_document('+auth+',$9::uuid) AS result',writable:'SELECT crest_commands.authorize_fictional_opening_document_write('+auth+',$9::uuid,$10::uuid) AS result',reserve:'SELECT crest_commands.reserve_fictional_opening_document('+auth+',$9::uuid,$10::uuid,$11::uuid,$12::text,$13::text,$14::text,$15::integer) AS result',publish:'SELECT crest_commands.publish_fictional_opening_document('+auth+',$9::uuid,$10::uuid,$11::uuid,$12::jsonb) AS result'};
function require(value:unknown):asserts value{if(!value)throw Error('OPENING_DOCUMENT_AUTHORITY_REQUIRED');}
function authority(config:Config){
 require(uuid(config.businessId));
 if(config.environment==='production'){
  const identity=getServerBuildIdentity(),migrations=getServerMigrationIdentity();
  require(productionCapability(config,'openingDocuments')&&identity?.sourceSchemaVersion===142&&identity.migrationRegistrySha256===openingDocument142SourceProfile.migrationRegistrySha256&&migrations?.length===142);
 }
}
function authorized(config:Config,provider:Provider,tokens:Tokens,database:ReturnType<typeof financePreviewDatabase>){
 authority(config);const business=config.businessId,sessions=createSessionLifecycle(config,provider,tokens);
 return async(kind:keyof typeof commands,credential:string,businessId:string,values:unknown[],signal:AbortSignal)=>{
  require(businessId===business);signal.throwIfAborted();const pinned=[...values],session=await sessions.verify(credential,signal,'background',true),hash=sessionCredentialHash(credential);
  try{const args=[hash,session.sessionId,session.actorId,session.provider.issuer,session.provider.subject,session.provider.sessionId,new Date(session.provider.expiresAt),business,...pinned];return kind==='read'||kind==='find'?await database(commands[kind],args,signal):await database.commandTransaction(query=>query(commands[kind],args),signal);}finally{hash.fill(0);}
 };
}
function access(run:ReturnType<typeof authorized>){return {
 async read(credential:string,businessId:string,id:string,signal:AbortSignal){require(uuid(id));const record=await run('read',credential,businessId,[id],signal);parseOpeningDocumentRecord(record,businessId,id);return record;},
 async authorizeWrite(credential:string,businessId:string,epoch:string,id:string,signal:AbortSignal){require(uuid(id)&&uuid(epoch));return run('writable',credential,businessId,[epoch,id],signal);},
};}
export function createOpeningDocumentDirectory(config:Config,provider:Provider,tokens:Tokens,financeConnectionString:string){
 authority(config);
 if(config.environment==='production')validateFinanceRuntimeConnection(config.connectionString,financeConnectionString);
 const database=config.environment==='production'?productionFinanceDatabase({...config,connectionString:financeConnectionString}):financePreviewDatabase({environment:'test',connectionString:financeConnectionString});
 const run=authorized(config,provider,tokens,database);
 return Object.freeze({...access(run),async find(credential:string,input:unknown,signal:AbortSignal){
  const evidence=parseOpeningDocumentEvidence(input),result=await run('find',credential,config.businessId,[evidence.reference,evidence.sha256],signal);
  if(exact(result,['state'])&&result.state==='absent')return Object.freeze({state:'absent' as const});
  require(exact(result,['state','schemaVersion','reservation','candidate'])&&exact(result.reservation,['businessId','documentId','reference','sha256','recoveryEpoch','declaredType','byteSize','dispatchId','stagingKey','originalKey','previewKey'])&&uuid(result.reservation.documentId));
  const record=parseOpeningDocumentRecord(result,config.businessId,result.reservation.documentId);require(record.candidate&&record.evidence.reference===evidence.reference&&record.evidence.sha256===evidence.sha256);return Object.freeze({state:'available' as const,record});
 },async reserve(credential:string,input:unknown,signal:AbortSignal){
  const value=parseOpeningDocumentReserve(input),result=await run('reserve',credential,config.businessId,[value.recoveryEpoch,value.operationId,value.documentId,value.reference,value.sha256,value.contentType,value.byteSize],signal);
  if(exact(result,['state','reason'])&&result.state==='conflict'&&result.reason==='operation')return Object.freeze({state:'conflict' as const,reason:'operation' as const});
  require(exact(result,['state','receipt'])&&result.state==='committed'&&exact(result.receipt,['schemaVersion','reservation'])&&result.receipt.schemaVersion===1);
  const record=parseOpeningDocumentRecord({state:'ready',schemaVersion:1,reservation:result.receipt.reservation,candidate:null},config.businessId,value.documentId);
  require(record.evidence.reference===value.reference&&record.evidence.sha256===value.sha256&&record.reservation.recoveryEpoch===value.recoveryEpoch&&record.reservation.declaredType===value.contentType&&record.reservation.byteSize===value.byteSize);return result;
 }});
}
export function createOpeningDocumentDispatcher(config:Config,provider:Provider,tokens:Tokens,workerConnectionString:string,objects:ReturnType<typeof createReceiptObjectStore>,validator:ReturnType<typeof createLocalSandboxValidator>){
 authority(config);const worker=new URL(workerConnectionString),web=new URL(config.connectionString);require(worker.host===web.host&&worker.pathname===web.pathname&&decodeURIComponent(worker.username)!==decodeURIComponent(web.username));
 if(config.environment==='production')validateFinanceRuntimeConnection(config.connectionString,workerConnectionString);
 // The byte worker uses its separate credential; the web process receives only
 // this bounded dispatch callback, not a general SQL port or decoder capability.
 const workerRun=authorized(config,provider,tokens,openingDocumentWorkerDatabase({...config,connectionString:workerConnectionString}));
 const scoped=createOpeningDocumentWorkflow({...access(workerRun),publish:(credential,binding,candidate,signal)=>workerRun('publish',credential,binding.businessId,[binding.recoveryEpoch,binding.operationId,binding.documentId,candidate],signal)},objects,validator);
 return (credential:string,businessId:string,documentId:string,operationId:string,signal:AbortSignal)=>scoped.prepareAndPublish(credential,businessId,documentId,operationId,signal);
}
