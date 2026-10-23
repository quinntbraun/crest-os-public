import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Socket} from 'node:net';
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
    ||typeof e.outcome!=='string'||!['provider_removed','provider_absent_observed'].includes(e.outcome)
    ||typeof e.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(e.createdAt)||!Number.isFinite(Date.parse(e.createdAt))
    ||typeof e.databasePrincipal!=='string'||Buffer.byteLength(e.databasePrincipal,'utf8')<1||Buffer.byteLength(e.databasePrincipal,'utf8')>63)throw new CleanupMaintenanceError();
  return Object.freeze({requestId:requestId.toLowerCase(),outcome:e.outcome as CleanupReceipt['outcome'],evidenceHash:value.evidenceHash,canonicalEvidence:value.canonicalEvidence});
}

function connection(config:Configuration,profile:'execute'|'read'|'review'){
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
  return async<T>(signal:AbortSignal,work:(client:pg.Client,actorId:string,issuer:string)=>Promise<T>):Promise<T>=>{
    if(signal.aborted)throw new CleanupMaintenanceError();
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    let transport:Socket|undefined;
    const client=new pg.Client({connectionString,ssl,stream:()=>{transport=new Socket();return transport;},
      connectionTimeoutMillis:1000,statement_timeout:3000,lock_timeout:2000,query_timeout:3500,
      options:`-c role=${role}`,application_name:profile==='execute'?'crest_cleanup_execute':profile==='read'?'crest_cleanup_history':'crest_reconciliation_review'});
    // Own the supported pg transport: peer shutdown acknowledgement must never
    // outlive this call. A completed query already includes ReadyForQuery.
    const stop=()=>{try{void client.end().catch(()=>undefined);}catch{/* Closing errors must not expose database diagnostics. */}finally{transport?.destroy();}};
    const failed=()=>controller.abort();client.on('error',failed);client.once('end',failed);
    const timer=setTimeout(failed,4000);timer.unref();
    let interrupted:()=>void=()=>{};
    const interruption=new Promise<never>((_,reject)=>{interrupted=()=>{stop();reject(new CleanupMaintenanceError());};combined.addEventListener('abort',interrupted,{once:true});});
    try{
      const pending=(async()=>{
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
        const value=await work(client,actorId,issuer);if(combined.aborted)throw new CleanupMaintenanceError();return value;
      })();
      const result=await Promise.race([pending,interruption]);if(combined.aborted)throw new CleanupMaintenanceError();return result;
    }catch{
      // Never expose database messages, causes, SQL, connection strings or IDs
      // from errors. Even a timeout may follow a committed deletion.
      throw new CleanupMaintenanceError();
    }finally{
      clearTimeout(timer);combined.removeEventListener('abort',interrupted);stop();
    }
  };
}
function boundary(config:Configuration,profile:'execute'|'read'){
  const run=connection(config,profile);
  const sql=profile==='execute'?'SELECT crest_commands.execute_provider_cleanup($1::uuid,$2::uuid,$3::text) AS result'
    :'SELECT crest_commands.read_provider_cleanup_outcome($1::uuid,$2::uuid,$3::text) AS result';
  return async(requestId:string,signal:AbortSignal):Promise<CleanupReceipt|null>=>{
    if(!validId(requestId))throw new CleanupMaintenanceError();
    return run(signal,async(client,actorId,issuer)=>{
      // One autocommit statement confirms deletion plus retained outcome.
      const result=await client.query<{result:unknown}>(sql,[requestId,actorId,issuer]);
      if(result.rows.length!==1||!Object.hasOwn(result.rows[0]??{},'result'))throw new CleanupMaintenanceError();
      const value=result.rows[0]!.result;
      return profile==='read'&&value===null?null:receipt(value,requestId,actorId,issuer);
    });
  };
}
export function createProviderCleanupExecutor(config:Configuration):CleanupExecutor {
  const execute=boundary(config,'execute');
  return async(id,signal)=>{const result=await execute(id,signal);if(!result)throw new CleanupMaintenanceError();return result;};
}
export function createProviderCleanupOutcomeReader(config:Configuration){return boundary(config,'read');}

type EvidenceRef=Readonly<{evidenceHash:string}>;
export type ReconciliationObservation=Readonly<{
  schemaVersion:1;observedAt:string;
  attempt:Readonly<{attemptId:string;actorId:string;providerIssuer:string;providerSubject:string;securityEpoch:string;appSessionId:string;evidenceHash:string}>;
  reviewState:'binding_conflict_review'|'target_unconfirmed_review'|'finish_unconfirmed_review'|'registration_closed_recorded'|'stopped_without_request_review'|'cleanup_outcome_unconfirmed_review'|'cleanup_outcome_recorded';
  registration:Readonly<{state:'registration_unconfirmed'|'registration_recorded'|'binding_conflict_review';providerSessionId:string|null;localRevokedAt:string|null}>;
  target:(EvidenceRef&Readonly<{providerSessionId:string}>)|null;
  registrationFinish:(EvidenceRef&Readonly<{finishId:string}>)|null;
  stop:(EvidenceRef&Readonly<{finishId:string}>)|null;
  request:(EvidenceRef&Readonly<{requestId:string}>)|null;
  outcome:(EvidenceRef&Readonly<{outcome:'provider_removed'|'provider_absent_observed'}>)|null;
}>;
function keys(value:unknown,expected:string):value is Record<string,unknown>{return object(value)&&Object.keys(value).sort().join(',')===expected;}
function utc(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(value)&&Number.isFinite(Date.parse(value));}
function ref(value:unknown,key:string):boolean{return value===null||keys(value,['evidenceHash',key].sort().join(','))&&validId(value[key])&&typeof value.evidenceHash==='string'&&hash.test(value.evidenceHash);}
function observation(value:unknown,id:string,actorId:string,issuer:string):ReconciliationObservation{
  if(!keys(value,'attempt,observedAt,outcome,registration,registrationFinish,request,reviewState,schemaVersion,stop,target')
    ||value.schemaVersion!==1||!utc(value.observedAt)
    ||!keys(value.attempt,'actorId,appSessionId,attemptId,evidenceHash,providerIssuer,providerSubject,securityEpoch')
    ||value.attempt.attemptId!==id||value.attempt.actorId!==actorId||value.attempt.providerIssuer!==issuer
    ||!validId(value.attempt.providerSubject)||!validId(value.attempt.securityEpoch)||!validId(value.attempt.appSessionId)
    ||typeof value.attempt.evidenceHash!=='string'||!hash.test(value.attempt.evidenceHash)
    ||!keys(value.registration,'localRevokedAt,providerSessionId,state')
    ||typeof value.registration.state!=='string'||!['registration_unconfirmed','registration_recorded','binding_conflict_review'].includes(value.registration.state)
    ||value.registration.providerSessionId!==null&&!validId(value.registration.providerSessionId)
    ||value.registration.localRevokedAt!==null&&!utc(value.registration.localRevokedAt)
    ||!ref(value.target,'providerSessionId')||!ref(value.registrationFinish,'finishId')||!ref(value.stop,'finishId')||!ref(value.request,'requestId')
    ||value.outcome!==null&&(!keys(value.outcome,'evidenceHash,outcome')||typeof value.outcome.evidenceHash!=='string'||!hash.test(value.outcome.evidenceHash)
      ||typeof value.outcome.outcome!=='string'||!['provider_removed','provider_absent_observed'].includes(value.outcome.outcome)))throw new CleanupMaintenanceError();
  const v=value as unknown as ReconciliationObservation,r=v.registration;
  if(v.reviewState==='binding_conflict_review'){
    if(v.target||v.registrationFinish||v.stop||v.request||v.outcome||r.providerSessionId||r.localRevokedAt)throw new CleanupMaintenanceError();
  }else{
    if(r.state==='binding_conflict_review'||r.state==='registration_unconfirmed'&&(r.providerSessionId!==null||r.localRevokedAt!==null)
      ||r.state==='registration_recorded'&&r.providerSessionId===null
      ||v.target&&r.providerSessionId!==null&&v.target.providerSessionId!==r.providerSessionId
      ||v.request&&(!v.target||!v.stop)||v.outcome&&!v.request)throw new CleanupMaintenanceError();
    const expected=!v.target?'target_unconfirmed_review':!v.stop&&!v.registrationFinish?'finish_unconfirmed_review'
      :!v.stop?'registration_closed_recorded':!v.request?'stopped_without_request_review'
      :!v.outcome?'cleanup_outcome_unconfirmed_review':'cleanup_outcome_recorded';
    if(v.reviewState!==expected)throw new CleanupMaintenanceError();
  }
  // Copy only the validated fixed shape. This is a historical observation, not
  // retained canonical evidence, a cleanup selection or a complete scan receipt.
  return Object.freeze({...v,attempt:Object.freeze({...v.attempt}),registration:Object.freeze({...r}),
    target:v.target&&Object.freeze({...v.target}),registrationFinish:v.registrationFinish&&Object.freeze({...v.registrationFinish}),
    stop:v.stop&&Object.freeze({...v.stop}),request:v.request&&Object.freeze({...v.request}),outcome:v.outcome&&Object.freeze({...v.outcome})});
}
export function createProviderReconciliationReviewer(config:Configuration){
  const run=connection(config,'review');
  return async(afterAttempt:string|null,pageSize:number,signal:AbortSignal):Promise<readonly ReconciliationObservation[]>=>{
    if(afterAttempt!==null&&!validId(afterAttempt)||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new CleanupMaintenanceError();
    const cursor=afterAttempt?.toLowerCase()??null;
    return run(signal,async(client,actorId,issuer)=>{
      await client.query('BEGIN READ ONLY ISOLATION LEVEL READ COMMITTED');
      const result=await client.query<{attempt_id:unknown;observation:unknown}>('SELECT * FROM crest_commands.provider_reconciliation_review($1::uuid,$2::text,$3::uuid,$4::integer)',[actorId,issuer,cursor,pageSize]);
      if(!Array.isArray(result.rows)||result.rows.length>pageSize)throw new CleanupMaintenanceError();
      const rows:ReconciliationObservation[]=[];let previous=cursor;
      for(let index=0;index<result.rows.length;index++){
        const row:unknown=result.rows[index];
        if(!keys(row,'attempt_id,observation')||!validId(row.attempt_id)||row.attempt_id!==row.attempt_id.toLowerCase()
          ||previous!==null&&row.attempt_id<=previous)throw new CleanupMaintenanceError();
        const item=observation(row.observation,row.attempt_id,actorId,issuer);
        if(Buffer.byteLength(JSON.stringify(item),'utf8')>8192)throw new CleanupMaintenanceError();
        rows.push(item);previous=row.attempt_id;
      }
      if((await client.query('COMMIT')).command!=='COMMIT')throw new CleanupMaintenanceError();
      return Object.freeze(rows);
    });
  };
}

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
