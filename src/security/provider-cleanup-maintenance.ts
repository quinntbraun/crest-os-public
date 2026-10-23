import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import pg from 'pg';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
type Configuration={connectionString:string;environment:'production'|'test';actorId:string;issuer:string};
export type CleanupReceipt=Readonly<{requestId:string;outcome:'provider_removed'|'provider_absent_observed';evidenceHash:string;canonicalEvidence:string}>;
export type CleanupExecutor=(requestId:string,signal:AbortSignal)=>Promise<CleanupReceipt>;
export class CleanupMaintenanceError extends Error {
  constructor(){super('PROVIDER_CLEANUP_REVIEW_REQUIRED');this.name='CleanupMaintenanceError';}
}
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function validId(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function receipt(value:unknown,requestId:string,actorId:string,issuer:string):CleanupReceipt {
  if(!object(value)||Object.keys(value).sort().join(',')!=='canonicalEvidence,evidence,evidenceHash'
    ||typeof value.canonicalEvidence!=='string'||Buffer.byteLength(value.canonicalEvidence,'utf8')>8192
    ||typeof value.evidenceHash!=='string'||!hash.test(value.evidenceHash)
    ||createHash('sha256').update(value.canonicalEvidence,'utf8').digest('hex')!==value.evidenceHash)throw new CleanupMaintenanceError();
  const e:unknown=JSON.parse(value.canonicalEvidence);
  if(!object(e)||!isDeepStrictEqual(e,value.evidence)
    ||Object.keys(e).sort().join(',')!=='actorId,appSessionId,createdAt,databasePrincipal,origin,outcome,providerIssuer,providerSessionId,providerSubject,requestHash,requestId,schemaVersion,securityEpoch,sourceFinishId'
    ||e.schemaVersion!==1||e.origin!=='system'||e.requestId!==requestId.toLowerCase()||e.actorId!==actorId
    ||e.providerIssuer!==issuer||!validId(e.securityEpoch)||!validId(e.providerSubject)||!validId(e.providerSessionId)
    ||!validId(e.sourceFinishId)||(e.appSessionId!==null&&!validId(e.appSessionId))
    ||typeof e.requestHash!=='string'||!hash.test(e.requestHash)
    ||!['provider_removed','provider_absent_observed'].includes(String(e.outcome))
    ||typeof e.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(e.createdAt)||!Number.isFinite(Date.parse(e.createdAt))
    ||typeof e.databasePrincipal!=='string'||Buffer.byteLength(e.databasePrincipal,'utf8')<1||Buffer.byteLength(e.databasePrincipal,'utf8')>63)throw new CleanupMaintenanceError();
  return Object.freeze({requestId:requestId.toLowerCase(),outcome:e.outcome as CleanupReceipt['outcome'],evidenceHash:value.evidenceHash,canonicalEvidence:value.canonicalEvidence});
}

function boundary(config:Configuration,profile:'execute'|'read'){
  let connectionString:string,actorId:string,issuer:string;
  try{
    const url=new URL(config.connectionString),provider=new URL(config.issuer);
    if(!['production','test'].includes(config.environment)||!validId(config.actorId)
      ||config.issuer.length>500||provider.protocol!=='https:'||provider.username||provider.password||provider.search||provider.hash
      ||!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash
      ||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
    connectionString=url.toString();actorId=config.actorId.toLowerCase();issuer=config.issuer;
  }catch{throw new Error('PROVIDER_CLEANUP_CONFIGURATION_REQUIRED');}
  const ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
  const role=profile==='execute'?'crest_cleanup':'crest_inventory';
  const sql=profile==='execute'?'SELECT crest_commands.execute_provider_cleanup($1::uuid,$2::uuid,$3::text) AS result'
    :'SELECT crest_commands.read_provider_cleanup_outcome($1::uuid,$2::uuid,$3::text) AS result';
  return async(requestId:string,signal:AbortSignal):Promise<CleanupReceipt|null>=>{
    if(!validId(requestId)||signal.aborted)throw new CleanupMaintenanceError();
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const client=new pg.Client({connectionString,ssl,
      connectionTimeoutMillis:1000,statement_timeout:3000,lock_timeout:2000,query_timeout:3500,
      options:`-c role=${role}`,application_name:profile==='execute'?'crest_cleanup_execute':'crest_cleanup_history'});
    const stop=()=>{void client.end().catch(()=>undefined);};
    const failed=()=>controller.abort();client.on('error',failed);client.once('end',failed);
    const timer=setTimeout(failed,4000);timer.unref();
    let interrupted:()=>void=()=>{};
    const interruption=new Promise<never>((_,reject)=>{interrupted=()=>{stop();reject(new CleanupMaintenanceError());};combined.addEventListener('abort',interrupted,{once:true});});
    try{
      const work=(async()=>{
        await client.connect();if(combined.aborted)throw new CleanupMaintenanceError();
        // Separate single-role logins; never adopt an owner/admin or a login
        // that can also assume another capability. Provisioning is external.
        const guard=await client.query<{allowed:boolean}>(`SELECT current_user=$1
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=$1 AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))=1
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname=$1 AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)) AS allowed`,[role]);
        if(combined.aborted||guard.rows.length!==1||guard.rows[0]?.allowed!==true)throw new CleanupMaintenanceError();
        // A single autocommit statement confirms deletion plus retained outcome.
        // No explicit transaction, caller SQL, automatic replay or provider SDK.
        const result=await client.query<{result:unknown}>(sql,[requestId,actorId,issuer]);
        if(combined.aborted||result.rows.length!==1||!Object.hasOwn(result.rows[0]??{},'result'))throw new CleanupMaintenanceError();
        const value=result.rows[0]!.result;
        return profile==='read'&&value===null?null:receipt(value,requestId,actorId,issuer);
      })();
      const result=await Promise.race([work,interruption]);if(combined.aborted)throw new CleanupMaintenanceError();return result;
    }catch{
      // Never expose database messages, causes, SQL, connection strings or IDs
      // from errors. Even a timeout may follow a committed deletion.
      throw new CleanupMaintenanceError();
    }finally{
      clearTimeout(timer);combined.removeEventListener('abort',interrupted);await client.end().catch(()=>undefined);
    }
  };
}
export function createProviderCleanupExecutor(config:Configuration):CleanupExecutor {
  const execute=boundary(config,'execute');
  return async(id,signal)=>{const result=await execute(id,signal);if(!result)throw new CleanupMaintenanceError();return result;};
}
export function createProviderCleanupOutcomeReader(config:Configuration){return boundary(config,'read');}

export type CleanupDispatchResult=Readonly<{
  results:ReadonlyArray<Readonly<{requestId:string;status:'confirmed'|'outcome_unknown'|'not_started';receipt?:CleanupReceipt}>>;
  telemetry:Readonly<{selected:number;started:number;confirmed:number;removed:number;absentObserved:number;unknown:number;notStarted:number}>;
}>;
// Trusted maintenance composition only: the explicit original IDs are the work
// selection. Inventory classifications, age and empty pages never select work.
export async function dispatchProviderCleanup(requestIds:readonly string[],execute:CleanupExecutor,signal:AbortSignal):Promise<CleanupDispatchResult>{
  const ids:string[]=[];
  try{
    if(!Array.isArray(requestIds))throw new Error();
    const count=requestIds.length;
    if(!Number.isSafeInteger(count)||count<1||count>10)throw new Error();
    // Check the size before copying; never consume a caller's iterator.
    // Indexed reads also preserve sparse-entry rejection within the fixed bound.
    for(let index=0;index<count;index++){
      const id:unknown=requestIds[index];if(!validId(id))throw new Error();ids.push(id.toLowerCase());
    }
    if(new Set(ids).size!==count)throw new Error();
  }catch{throw new CleanupMaintenanceError();}
  const results:CleanupDispatchResult['results'][number][]=[],controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  const timer=setTimeout(()=>controller.abort(),45000);timer.unref();
  let stopped=false,started=0,removed=0,absentObserved=0,unknown=0;
  try{
    for(const requestId of ids){
      if(stopped||combined.aborted){results.push(Object.freeze({requestId,status:'not_started'}));continue;}
      started++;
      const item=new AbortController(),itemSignal=AbortSignal.any([combined,item.signal]),deadline=setTimeout(()=>item.abort(),4000);deadline.unref();
      let rejectAbort:()=>void=()=>{};
      const aborted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new CleanupMaintenanceError());itemSignal.addEventListener('abort',rejectAbort,{once:true});});
      try{
        const saved=await Promise.race([Promise.resolve().then(()=>{if(itemSignal.aborted)throw new CleanupMaintenanceError();return execute(requestId,itemSignal);}),aborted]);
        if(itemSignal.aborted||saved.requestId!==requestId||!['provider_removed','provider_absent_observed'].includes(saved.outcome))throw new CleanupMaintenanceError();
        const copy=Object.freeze({requestId:saved.requestId,outcome:saved.outcome,canonicalEvidence:saved.canonicalEvidence,evidenceHash:saved.evidenceHash});results.push(Object.freeze({requestId,status:'confirmed',receipt:copy}));
        if(saved.outcome==='provider_removed')removed++;else absentObserved++;
      }catch{unknown++;stopped=true;results.push(Object.freeze({requestId,status:'outcome_unknown'}));}
      finally{clearTimeout(deadline);itemSignal.removeEventListener('abort',rejectAbort);}
    }
  }finally{clearTimeout(timer);}
  return Object.freeze({results:Object.freeze(results),telemetry:Object.freeze({selected:ids.length,started,confirmed:removed+absentObserved,removed,absentObserved,unknown,notStarted:ids.length-started})});
}
