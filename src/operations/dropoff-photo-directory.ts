import 'server-only';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {custodyPhotoDispatcherDatabase,sessionDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {DropoffPhotoError,parsePhotoReservation} from './dropoff-photo-workflow.ts';
import type {DropoffPhotoScope,DropoffPhotoDispatchAuthority} from './dropoff-photo-workflow.ts';

const auth='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
const commands={
 reserveReturn:`SELECT crest_commands.reserve_pickup_return_photo(${auth},$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15::bigint,$16::text,$17::integer) AS result`,
 reservePickup:`SELECT crest_commands.reserve_pickup_photo(${auth},$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15::bigint,$16::text,$17::integer) AS result`,
 read:`SELECT crest_commands.read_dropoff_photo(${auth},$9::uuid) AS result`,
 writable:`SELECT crest_commands.check_dropoff_photo_upload(${auth},$9::uuid,$10::uuid) AS result`,
 reserve:`SELECT crest_commands.reserve_dropoff_photo(${auth},$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::integer,$14::text,$15::integer) AS result`,
 publish:`SELECT crest_commands.publish_dropoff_photo(${auth},$9::uuid,$10::uuid,$11::jsonb) AS result`,
 originalAccess:`SELECT crest_commands.record_dropoff_original_access(${auth},$9::uuid,$10::uuid,$11::uuid,$12::text,$13::integer) AS result`
} as const;
type Database=ReturnType<typeof sessionDatabase>;
type Provider=Parameters<typeof createSessionLifecycle>[1];
type Tokens=Parameters<typeof createSessionLifecycle>[2];
type Reservation=DropoffPhotoScope&Readonly<{epoch:string;caseId:string;handoff:1|2;contentType:string;byteSize:number}>;
import type {PickupPhotoBinding} from './pickup-custody-contract.ts';

function authorized(config:SessionDatabaseConfiguration,provider:Provider,tokens:Tokens,database:Database){
 if(config.environment!=='test')throw new DropoffPhotoError();
 const sessions=createSessionLifecycle(config,provider,tokens);
 return async(kind:keyof typeof commands,credential:string,scope:DropoffPhotoScope,args:unknown[],signal:AbortSignal)=>{
  if(!uuid(scope.businessId)||!uuid(scope.jobVehicleId)||!uuid(scope.photoId))throw new DropoffPhotoError();
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]),digest=sessionCredentialHash(credential);
  try{
   const verified=await sessions.verify(credential,bounded,'background');
   bounded.throwIfAborted();
   const parameters=[digest,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,
    verified.provider.sessionId,new Date(verified.provider.expiresAt),scope.businessId,...args];
   const result=kind==='read'?await database(commands[kind],parameters,bounded):
    await database.commandTransaction(query=>query(commands[kind],parameters),bounded);
   bounded.throwIfAborted();
   return result;
  }finally{digest.fill(0);}
 };
}
function photoAccess(query:ReturnType<typeof authorized>){
 return {
  read:(credential:string,scope:DropoffPhotoScope,signal:AbortSignal)=>query('read',credential,scope,[scope.photoId],signal),
  async writable(credential:string,scope:DropoffPhotoScope,epoch:string,signal:AbortSignal){
   if(!uuid(epoch))throw new DropoffPhotoError();
   const remaining=await query('writable',credential,scope,[epoch,scope.photoId],signal);
   if(typeof remaining!=='number'||!Number.isSafeInteger(remaining)||remaining<1||remaining>600)throw new DropoffPhotoError();
   return remaining;
  }
 };
}
export function createDropoffPhotoDirectory(config:SessionDatabaseConfiguration,provider:Provider,tokens:Tokens){
 const query=authorized(config,provider,tokens,sessionDatabase(config));
 return Object.freeze({...photoAccess(query),async reserve(credential:string,input:Reservation,signal:AbortSignal,pickup?:PickupPhotoBinding){
  const scope=Object.freeze({...input});
  if(!uuid(scope.epoch)||!uuid(scope.caseId))throw new DropoffPhotoError();
  const target=[scope.epoch,scope.photoId,scope.jobVehicleId,scope.caseId];
  const value=pickup?await ('collectionId'in pickup?
   query('reserveReturn',credential,scope,[...target,pickup.collectionId,pickup.arrivalVersionId,pickup.jobVersion,scope.contentType,scope.byteSize],signal):
   query('reservePickup',credential,scope,[...target,pickup.arrivalVersionId,pickup.policyId,pickup.jobVersion,scope.contentType,scope.byteSize],signal)):
   await query('reserve',credential,scope,[...target,scope.handoff,scope.contentType,scope.byteSize],signal);
  const r=parsePhotoReservation(value,scope);
  if(r.recovery_epoch!==scope.epoch||r.case_id!==scope.caseId||r.handoff_version!==scope.handoff||
   r.declared_type!==scope.contentType||r.byte_size!==scope.byteSize)throw new DropoffPhotoError();
  return Object.freeze({photoId:scope.photoId});
 },async recordOriginalAccess(credential:string,scope:DropoffPhotoScope,epoch:string,
  file:Readonly<{sha256:string;byteSize:number;contentType:string}>,signal:AbortSignal){
  const pinned=Object.freeze({...scope}),{sha256,byteSize,contentType}=file;
  const value=await query('originalAccess',credential,pinned,[epoch,pinned.jobVehicleId,pinned.photoId,sha256,byteSize],signal);
  if(!exact(value,['schemaVersion','operationId','auditEventId','scope'])||value.schemaVersion!==1||
   !uuid(value.operationId)||!uuid(value.auditEventId)||
   !exact(value.scope,['photoId','jobVehicleId','caseId','handoffEventId','sha256','byteSize','contentType'])||
   value.scope.photoId!==pinned.photoId||value.scope.jobVehicleId!==pinned.jobVehicleId||
   !uuid(value.scope.caseId)||!uuid(value.scope.handoffEventId)||value.scope.sha256!==sha256||
   value.scope.byteSize!==byteSize||value.scope.contentType!==contentType)throw new DropoffPhotoError();
 }});
}

// The isolated worker composes this with its own login. The application
// server's separate directory has no publication method or worker login.
export function createDropoffPhotoDispatcherDirectory(config:SessionDatabaseConfiguration,provider:Provider,
 tokens:Tokens,worker:SessionDatabaseConfiguration):DropoffPhotoDispatchAuthority{
 if(worker.environment!=='test'||config.environment!=='test')throw new DropoffPhotoError();
 const webUrl=new URL(config.connectionString),workerUrl=new URL(worker.connectionString);
 if(webUrl.host!==workerUrl.host||webUrl.pathname!==workerUrl.pathname||webUrl.username===workerUrl.username)throw new DropoffPhotoError();
 const query=authorized(config,provider,tokens,custodyPhotoDispatcherDatabase(worker));
 const publish:DropoffPhotoDispatchAuthority['publish']=(credential,scope,epoch,metadata,signal)=>
  query('publish',credential,scope,[epoch,scope.photoId,metadata],signal);
 return Object.freeze({...photoAccess(query),publish});
}
