// Recovery-tool coordination only. The caller transfers an already connected,
// dedicated direct/session PostgreSQL client. No credentials, role privileges,
// database scope, production acceptance or complete backup are granted here.
import {createHash} from 'node:crypto';
import pg from 'pg';
import {schemaMigrationLock} from '../security/schema-migration-lock.ts';

export class RecoveryBackupLeaseError extends Error{constructor(){super('RECOVERY_BACKUP_LEASE_REVIEW_REQUIRED');this.name='RecoveryBackupLeaseError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryBackupLeaseError();}
type Query=(sql:string,values?:unknown[])=>Promise<pg.QueryResult>;
export type RecoveryBackupSnapshot=Readonly<{id:string;capturedAt:string;database:string;databaseRole:string;backendPid:number;query:Query}>;
type Snapshot=RecoveryBackupSnapshot;
type DatabaseTarget=Readonly<{host:string;port:number;database:string;user:string;password:string;secure:boolean}>;
const sourceBindings=new WeakMap<object,(target:DatabaseTarget)=>boolean>();
const liveSnapshots=new WeakMap<object,()=>boolean>();
export function isLiveRecoveryBackupSnapshot(snapshot:unknown):snapshot is RecoveryBackupSnapshot{return !!snapshot&&typeof snapshot==='object'&&liveSnapshots.get(snapshot)?.()===true;}
const targetHash=(target:DatabaseTarget)=>createHash('sha256').update(JSON.stringify([target.host,target.port,target.database,target.user,target.password,target.secure])).digest('hex');
export function recoveryBackupSnapshotMatches(snapshot:unknown,target:DatabaseTarget){return !!snapshot&&typeof snapshot==='object'&&sourceBindings.get(snapshot)?.(target)===true;}
type Lease=Readonly<{signal:AbortSignal;assertHeld:()=>Promise<void>;capture:<T>(work:(snapshot:Snapshot,signal:AbortSignal)=>Promise<T>)=>Promise<Readonly<{value:T;snapshot:Omit<Snapshot,'query'>}>>}>;

export async function withRecoveryBackupLease<T>(client:pg.Client,businessId:string,external:AbortSignal,work:(lease:Lease)=>Promise<T>):Promise<T>{
 require(client instanceof pg.Client&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(businessId)&&typeof work==='function');
 // pg's already-connected client properties are trusted composition, not input
 // from a browser. Fingerprints/credentials never enter the snapshot metadata.
 const parameters=client as unknown as Record<string,unknown>,tls=parameters.ssl;
 const secure=tls===true||!!tls&&typeof tls==='object'&&'rejectUnauthorized' in tls&&tls.rejectUnauthorized===true;
 const source=typeof parameters.host==='string'&&typeof parameters.port==='number'&&typeof parameters.database==='string'&&typeof parameters.user==='string'&&typeof parameters.password==='string'?targetHash({host:parameters.host,port:parameters.port,database:parameters.database,user:parameters.user,password:parameters.password,secure}):null;
 const bytes=createHash('sha256').update('crest.recovery.backup-lease.v1:'+businessId).digest(),key=bytes.readBigInt64BE(0).toString(),high=bytes.readUInt32BE(0),low=bytes.readUInt32BE(4);
 const controller=new AbortController(),signal=AbortSignal.any([external,controller.signal,AbortSignal.timeout(3600000)]);let closing=false,capturing=false,captured=false,activeCapture:Promise<unknown>|undefined;
 const lost=()=>{if(!closing)controller.abort();},abort=()=>{void client.end().catch(()=>{});};client.on('error',lost);client.once('end',lost);signal.addEventListener('abort',abort,{once:true});
 const query:Query=async(sql,values=[])=>{signal.throwIfAborted();const timer=setTimeout(()=>controller.abort(),5000);timer.unref();try{return await client.query(sql,values);}finally{clearTimeout(timer);}};
 async function assertHeld(){
  const result=await query("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND classid=$1::oid AND objid=$2::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted) AS held",[high,low]);require(result.rows[0]?.held===true);
 }
 try{
  signal.throwIfAborted();await query("SET statement_timeout='5s'");await query("SET lock_timeout='2s'");
  require((await query('SELECT pg_try_advisory_lock($1::bigint) AS acquired',[key])).rows[0]?.acquired===true);
  const lease:Lease=Object.freeze({signal,assertHeld,async capture<C>(captureWork:(snapshot:Snapshot,signal:AbortSignal)=>Promise<C>){
   require(!closing&&!capturing&&!captured&&typeof captureWork==='function');capturing=true;captured=true;
   const task=(async()=>{
    let shared=false,transaction=false,live=false;const timer=setTimeout(()=>controller.abort(),900000);timer.unref();
    try{
     await assertHeld();require((await query('SELECT pg_try_advisory_lock_shared($1::integer,$2::integer) AS acquired',[...schemaMigrationLock])).rows[0]?.acquired===true);shared=true;
     await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
     const row=(await query("SELECT pg_export_snapshot() AS id,clock_timestamp()::text AS captured_at,current_database() AS database,current_user::text AS database_role,pg_backend_pid() AS backend_pid,current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation")).rows[0];
     require(row&&typeof row.id==='string'&&/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{8}-[0-9]+$/.test(row.id)&&typeof row.captured_at==='string'&&row.captured_at.length<=128&&typeof row.database==='string'&&row.database.length<=128&&typeof row.database_role==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(row.database_role)&&Number.isSafeInteger(row.backend_pid)&&row.read_only==='on'&&row.isolation==='repeatable read');
     const metadata=Object.freeze({id:row.id as string,capturedAt:row.captured_at as string,database:row.database as string,databaseRole:row.database_role as string,backendPid:row.backend_pid as number});live=true;
     const snapshot:Snapshot=Object.freeze({...metadata,query:async(sql:string,values:unknown[]=[])=>{require(live&&!closing);return query(sql,values);}});
     sourceBindings.set(snapshot,target=>live&&!closing&&!signal.aborted&&source!==null&&targetHash(target)===source);liveSnapshots.set(snapshot,()=>live&&!closing&&!signal.aborted);
     try{
     const value=await captureWork(snapshot,signal);live=false;sourceBindings.delete(snapshot);liveSnapshots.delete(snapshot);await assertHeld();await query('ROLLBACK');transaction=false;
     require((await query('SELECT pg_advisory_unlock_shared($1::integer,$2::integer) AS released',[...schemaMigrationLock])).rows[0]?.released===true);shared=false;
     return Object.freeze({value,snapshot:metadata});
     }finally{liveSnapshots.delete(snapshot);sourceBindings.delete(snapshot);}
    }catch{controller.abort();throw new RecoveryBackupLeaseError();}
    finally{live=false;clearTimeout(timer);capturing=false;if(transaction)await client.query('ROLLBACK').catch(()=>{});if(shared&&!signal.aborted)await client.query('SELECT pg_advisory_unlock_shared($1::integer,$2::integer)',[...schemaMigrationLock]).catch(()=>{});}
   })();activeCapture=task;void task.catch(()=>{});return await task;
  }});
  const value=await work(lease);require(!capturing);await assertHeld();return value;
 }catch{throw new RecoveryBackupLeaseError();}
 finally{
  closing=true;controller.abort();await client.end().catch(()=>{});await activeCapture?.catch(()=>{});signal.removeEventListener('abort',abort);
 }
}
