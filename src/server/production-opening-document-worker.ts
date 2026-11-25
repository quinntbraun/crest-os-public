import 'server-only';
import {isAbsolute} from 'node:path';
import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionReleaseAccepted,readProductionProfile,readConfigurationFile} from './production-configuration.ts';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import {parseReceiptStorageConfiguration} from './production-receipt-configuration.ts';
import {openingDocumentStorageBinding} from './production-opening-document-configuration.ts';
import {createR2ReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';
import {createOpeningDocumentDispatcher} from '../bookkeeping/opening-document-directory.ts';
import {createLocalSandboxValidator} from '../files/local-sandbox-validator.ts';
import {SandboxValidationError} from '../files/validation-reply.ts';
import {createOpeningDocumentWorkerServer} from './receipt-worker-transport.ts';

function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');}
export function parseProductionOpeningDocumentWorkerProfile(source:string){
 try{
  require(Buffer.byteLength(source,'utf8')<=65536);const input=parseEvidenceJson(source);
  require(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as Record<string,unknown>;
  const fields=['schemaVersion','authenticationProfileFile','storage','imageId','clientCAFile','clientFingerprint','workerConnectionString'];
  require(Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field))&&value.schemaVersion===1);
  for(const field of ['authenticationProfileFile','clientCAFile'])require(typeof value[field]==='string'&&value[field].length<=4096&&isAbsolute(value[field])&&!/\p{Cc}/u.test(value[field]));
  require(typeof value.imageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(value.imageId));
  require(typeof value.clientFingerprint==='string'&&/^[a-f0-9]{64}$/.test(value.clientFingerprint));
  require(typeof value.workerConnectionString==='string'&&value.workerConnectionString.length<=4096&&!/\p{Cc}/u.test(value.workerConnectionString));
  const connection=new URL(value.workerConnectionString);
  require(['postgres:','postgresql:'].includes(connection.protocol)&&connection.username&&connection.password&&connection.pathname.length>1&&!connection.search&&!connection.hash);
  return new OpeningDocumentWorkerProfile({authenticationProfileFile:value.authenticationProfileFile as string,clientCAFile:value.clientCAFile as string,imageId:value.imageId,clientFingerprint:value.clientFingerprint,workerConnectionString:value.workerConnectionString,storage:parseReceiptStorageConfiguration(value.storage)});
 }catch{throw Error('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');}
}
type Configuration={authenticationProfileFile:string;clientCAFile:string;imageId:string;clientFingerprint:string;workerConnectionString:string;storage:ReturnType<typeof parseReceiptStorageConfiguration>};
class OpeningDocumentWorkerProfile{
 #value:Configuration;
 constructor(value:Configuration){this.#value=value;Object.freeze(this);}
 toJSON():never{throw Error('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');}
 async open(){
  let storage:ReturnType<typeof createR2ReceiptObjectStore>|undefined;
  try{
   require(productionReleaseAccepted(compatibility)&&process.platform==='linux');const value=this.#value;
   const auth=await (await readProductionProfile(value.authenticationProfileFile)).forOpeningDocumentWorker();
   const ca=await readConfigurationFile(value.clientCAFile,65536,false);
   storage=createR2ReceiptObjectStore(value.storage);const owned=storage,decoder=createLocalSandboxValidator({imageId:value.imageId});let uncertain=false;
   const validator={async validate(...args:Parameters<typeof decoder.validate>){
    require(!uncertain);
    try{return await decoder.validate(...args);}
    catch(error){if(error instanceof SandboxValidationError&&['SANDBOX_CREATE_UNCERTAIN','SANDBOX_CLEANUP_UNCERTAIN'].includes(error.code))uncertain=true;throw error;}
   }};
   const dispatch=createOpeningDocumentDispatcher(auth.configuration,auth.provider,auth.tokens,value.workerConnectionString,owned.objects,validator);
   const worker=createOpeningDocumentWorkerServer({host:new URL(auth.origin).host,businessId:auth.configuration.businessId,storageBinding:openingDocumentStorageBinding(value.storage,auth.configuration.businessId),clientFingerprint:value.clientFingerprint,tls:{...auth.tls,ca}},async(credential,businessId,documentId,operationId,signal)=>{
    require(!uncertain);await dispatch(credential,businessId,documentId,operationId,signal);require(!uncertain&&!signal.aborted);
   });
   return {server:worker.server,listen:auth.listen,async close(){try{await worker.close();}finally{owned.close();}}};
  }catch{storage?.close();throw Error('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');}
 }
}
export async function readProductionOpeningDocumentWorkerProfile(path:string){
 try{return parseProductionOpeningDocumentWorkerProfile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readConfigurationFile(path,65536,true)));}
 catch{throw Error('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');}
}
