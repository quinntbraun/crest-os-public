import 'server-only';
import {randomUUID} from 'node:crypto';
import {createR2ObjectClient} from '../files/private-object-store.ts';
import {createEncryptedExportPartStore} from '../files/export-part-store.ts';
import {createCurrentBusinessSourceCollector} from '../security/business-foundation-collector.ts';
import {createCurrentBusinessExportWorker} from '../security/business-source-export-worker.ts';
import {consumeSourceExportExecutionAdmission,createSourceExportExecutionAccess} from '../security/source-export-execution-access.ts';
import {createSourceExportDatabaseJournal} from '../security/source-export-database-journal.ts';
import {bindCurrentSourceExportJournalWorker} from '../security/source-export-journal-worker-port.ts';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {parseSourceExportCommitted,parseSourceExportCommand} from '../security/source-export-job-contract.ts';
import {productionCapability} from '../security/production-capabilities.ts';
import type {ProductionCapabilities} from '../security/production-capabilities.ts';
import type {NodeConfiguration} from './node-server.ts';
import {getServerBuildIdentity,getServerMigrationIdentity} from './build-identity.ts';
import {validateFinanceExportConnection} from './production-finance-export-configuration.ts';
import {parseProductionSourceExportConfiguration} from './production-source-export-configuration.ts';
import type {ProductionSourceExportConfiguration} from './production-source-export-configuration.ts';

type Authentication=NonNullable<NodeConfiguration['authentication']>;
type Store=Awaited<ReturnType<typeof createEncryptedExportPartStore>>;
type Execution=ReturnType<typeof createSourceExportExecutionAccess>;
function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');}
class GrantedSourceExportRuntime{
 readonly appReleaseId:string;readonly sourceSchemaVersion=136;readonly profile='crest.current-business-source-bundle.v1';
 #businessId:string;#store:Store;#execution:Execution;#schedule:(admission:unknown,credential:string)=>void;#close:()=>Promise<void>;#cancel:(jobId:string)=>void;#closed=false;
 constructor(businessId:string,appReleaseId:string,store:Store,execution:Execution,schedule:(admission:unknown,credential:string)=>void,cancel:(jobId:string)=>void,close:()=>Promise<void>){this.#businessId=businessId;this.appReleaseId=appReleaseId;this.#store=store;this.#execution=execution;this.#schedule=schedule;this.#cancel=cancel;this.#close=close;Object.freeze(this);}
 belongsTo(businessId:string,appReleaseId:string){return !this.#closed&&this.#businessId===businessId&&this.appReleaseId===appReleaseId;}
 forDownloads(){return Object.freeze({readVerified:this.#store.readVerified.bind(this.#store)});}
 request(...args:Parameters<Execution['request']>){require(!this.#closed);return this.#execution.request(...args);}
 schedule(admission:unknown,credential:string){this.#schedule(admission,credential);}
 cancel(jobId:string){this.#cancel(jobId);}
 close(){this.#closed=true;return this.#close();}
 toJSON():never{throw Error('PRODUCTION_SOURCE_EXPORT_PRIVATE');}
}
export type ProductionSourceExportRuntime=GrantedSourceExportRuntime;
export function sourceExportRuntimeBelongsTo(value:unknown,businessId:string,appReleaseId:string){return value instanceof GrantedSourceExportRuntime&&value.belongsTo(businessId,appReleaseId);}
export async function openProductionSourceExportRuntime(input:ProductionSourceExportConfiguration,businessId:string,authentication:Authentication,capabilities:ProductionCapabilities,financeConnection?:string):Promise<ProductionSourceExportRuntime>{
 let client:ReturnType<typeof createR2ObjectClient>|undefined;
 try{
  const identity=getServerBuildIdentity(),migrationIdentity=getServerMigrationIdentity();require(identity&&identity.sourceSchemaVersion===136&&migrationIdentity&&productionCapability({environment:'production',businessId,productionCapabilities:capabilities},'businessExports'));
  const sessionConfiguration={...authentication.configuration,environment:'production' as const};
  const config=parseProductionSourceExportConfiguration(input);validateFinanceExportConnection(authentication.configuration.connectionString,{connectionString:config.connectionString},financeConnection);
  client=createR2ObjectClient(config.storage);const ownedClient=client,keys=config.keys.map(key=>({id:key.id,key:Buffer.from(key.key,'base64url')}));
  let store:Store;try{store=await createEncryptedExportPartStore(client,config.storage.bucket,config.activeKeyId,keys);}finally{for(const key of keys)key.key.fill(0);}
  const collector=createCurrentBusinessSourceCollector({environment:'production',businessId,connectionString:config.connectionString,migrationIdentity}),database=sessionDatabase(sessionConfiguration),sessions=createSessionLifecycle(sessionConfiguration,authentication.provider,authentication.tokens),execution=createSourceExportExecutionAccess(sessionConfiguration,authentication.provider,authentication.tokens,businessId,identity.appReleaseId,true);
  const stop=new AbortController(),tasks=new Map<string,AbortController>();let closed=false,pending=0,tail:Promise<void>=Promise.resolve();
  async function run(work:ReturnType<typeof consumeSourceExportExecutionAdmission>,credential:string,local:AbortSignal){
   const signal=AbortSignal.any([stop.signal,local,AbortSignal.timeout(900000)]),command=parseSourceExportCommand({schemaVersion:1,businessId,commandType:'export.claim',reference:{operationId:randomUUID(),recoveryEpoch:work.job.recovery_epoch,exportJobId:work.job.id,expectedVersion:work.job.version,leaseId:randomUUID()}});require(command.commandType==='export.claim');
   const hash=sessionCredentialHash(credential);
   let claimed:ReturnType<typeof parseSourceExportCommitted>;
   try{
    require(!signal.aborted);const session=await sessions.verify(credential,signal,'background',true),r=command.reference;
    const result=await database.commandTransaction(query=>query('SELECT crest_commands.claim_source_export($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::uuid) AS result',[hash,session.sessionId,session.actorId,session.provider.issuer,session.provider.subject,session.provider.sessionId,new Date(session.provider.expiresAt),businessId,r.recoveryEpoch,r.operationId,r.exportJobId,r.expectedVersion,r.leaseId]),signal);
    claimed=parseSourceExportCommitted(result,command,session.actorId);require(claimed.receipt.job.profile==='crest.current-business-source-bundle.v1'&&claimed.receipt.job.source_schema_version===136&&claimed.receipt.job.app_release_id===identity!.appReleaseId&&!signal.aborted);
   }finally{hash.fill(0);}
   const job=claimed.receipt.job,journal=createSourceExportDatabaseJournal(sessionConfiguration,authentication.provider,authentication.tokens,job,randomUUID()),jobs=bindCurrentSourceExportJournalWorker(journal,async current=>{require(!closed&&!current.aborted);return credential;});
   const worker=createCurrentBusinessExportWorker({businessId,appReleaseId:identity!.appReleaseId},collector,store,jobs);
   await worker.run({formatVersion:1,profile:job.profile,businessId,actorId:job.actor_id,exportJobId:job.id,recoveryEpoch:job.recovery_epoch,leaseId:job.lease_id},signal);
  }
  const schedule=(admission:unknown,credential:string)=>{
   require(!closed&&pending<2&&typeof credential==='string'&&credential.length>0);const work=consumeSourceExportExecutionAdmission(admission,stop.signal);
   require(work.command.businessId===businessId&&work.job.business_id===businessId&&work.job.profile==='crest.current-business-source-bundle.v1'&&work.job.source_schema_version===136&&work.job.app_release_id===identity.appReleaseId&&work.job.state==='Queued'&&!tasks.has(work.job.id));const task=new AbortController();tasks.set(work.job.id,task);pending++;
   let retained:string|undefined=credential;
   tail=tail.then(async()=>{require(!closed&&retained);await run(work,retained,task.signal);}).catch(()=>{if(!closed&&!task.signal.aborted)console.error('SOURCE_EXPORT_RUN_REVIEW_REQUIRED');}).finally(()=>{retained=undefined;if(tasks.get(work.job.id)===task)tasks.delete(work.job.id);pending--;});
  };
  return new GrantedSourceExportRuntime(businessId,identity.appReleaseId,store,execution,schedule,jobId=>{tasks.get(jobId)?.abort();},async()=>{if(closed)return;closed=true;stop.abort();ownedClient.destroy();await tail;});
 }catch{client?.destroy();throw Error('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');}
}
