import 'server-only';
import {isAbsolute} from 'node:path';
import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionReleaseAccepted,readProductionProfile,readConfigurationFile} from './production-configuration.ts';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import {parseReceiptStorageConfiguration,receiptStorageBinding} from './production-receipt-configuration.ts';
import {createR2ReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';
import {createReceiptDirectory} from '../bookkeeping/expenses/receipt-directory.ts';
import {createReceiptWorkflow} from '../bookkeeping/expenses/receipt-workflow.ts';
import {createLocalSandboxValidator} from '../files/local-sandbox-validator.ts';
import {SandboxValidationError} from '../files/validation-reply.ts';
import {createReceiptWorkerServer} from './receipt-worker-transport.ts';

function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');}
export function parseProductionReceiptWorkerProfile(source:string){
 try{
  require(Buffer.byteLength(source,'utf8')<=65536);const input=parseEvidenceJson(source);
  require(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as Record<string,unknown>;
  const fields=['schemaVersion','authenticationProfileFile','storage','imageId','clientCAFile','clientFingerprint'];
  require(Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field))&&value.schemaVersion===1);
  for(const field of ['authenticationProfileFile','clientCAFile'])require(typeof value[field]==='string'&&value[field].length<=4096&&isAbsolute(value[field])&&!/\p{Cc}/u.test(value[field]));
  require(typeof value.imageId==='string'&&/^sha256:[a-f0-9]{64}$/.test(value.imageId));
  require(typeof value.clientFingerprint==='string'&&/^[a-f0-9]{64}$/.test(value.clientFingerprint));
  return new WorkerProfile({authenticationProfileFile:value.authenticationProfileFile as string,clientCAFile:value.clientCAFile as string,imageId:value.imageId,clientFingerprint:value.clientFingerprint,storage:parseReceiptStorageConfiguration(value.storage)});
 }catch{throw Error('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');}
}
type WorkerConfiguration={authenticationProfileFile:string;clientCAFile:string;imageId:string;clientFingerprint:string;storage:ReturnType<typeof parseReceiptStorageConfiguration>};
class WorkerProfile{
 #value:WorkerConfiguration;
 constructor(value:WorkerConfiguration){this.#value=value;Object.freeze(this);}
 toJSON():never{throw Error('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');}
 async open(){
  let storage:ReturnType<typeof createR2ReceiptObjectStore>|undefined;
  try{
   require(productionReleaseAccepted(compatibility)&&process.platform==='linux');const value=this.#value;
   const auth=await (await readProductionProfile(value.authenticationProfileFile)).forReceiptWorker();
   const ca=await readConfigurationFile(value.clientCAFile,65536,false);
   storage=createR2ReceiptObjectStore(value.storage);const owned=storage,decoder=createLocalSandboxValidator({imageId:value.imageId});
   let uncertain=false;
   const validator={async validate(...args:Parameters<typeof decoder.validate>){
    require(!uncertain);
    try{return await decoder.validate(...args);}
    catch(error){if(error instanceof SandboxValidationError&&['SANDBOX_CREATE_UNCERTAIN','SANDBOX_CLEANUP_UNCERTAIN'].includes(error.code))uncertain=true;throw error;}
   }};
   const directory=createReceiptDirectory(auth.configuration,auth.provider,auth.tokens),workflow=createReceiptWorkflow(directory,owned.objects,validator);
   const worker=createReceiptWorkerServer({host:new URL(auth.origin).host,businessId:auth.configuration.businessId,storageBinding:receiptStorageBinding(value.storage,auth.configuration.businessId),clientFingerprint:value.clientFingerprint,tls:{...auth.tls,ca}},async(credential,businessId,receiptId,operationId,signal)=>{
    require(!uncertain);await workflow.prepareAndPublish(credential,businessId,receiptId,operationId,signal);require(!uncertain&&!signal.aborted);
   });
   return {server:worker.server,listen:auth.listen,async close(){try{await worker.close();}finally{owned.close();}}};
  }catch{storage?.close();throw Error('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');}
 }
}
export async function readProductionReceiptWorkerProfile(path:string){
 try{return parseProductionReceiptWorkerProfile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readConfigurationFile(path,65536,true)));}
 catch{throw Error('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');}
}
