import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {verifyBusinessFoundationEvidence} from './business-configuration-evidence.ts';

type Configuration=Readonly<{connectionString:string;environment:'production'|'test';businessId:string}>;
type Group='configuration'|'identity'|'history';
type Context=Readonly<{schemaVersion:1;scope:string;businessId:string;snapshotToken:string;observedAt:string;recordCounts:Readonly<Record<string,string>>}>;
type Row=Readonly<{kind:string;recordId:string;representation:'snapshot_projection';canonicalEvidence:string;evidenceHash:string}>;
type Capture=Readonly<{
 formatVersion:1;generationId:string;businessId:string;observedAt:string;
 capture:'single_connection_repeatable_read';configuration:string;identity:string;history:string;
 evidenceBytes:number;recordCount:number;completePortableExport:false;completeBackup:false;
}>;
export type BusinessFoundationCapture=Readonly<{forServer:()=>Capture;toJSON:()=>never}>;
export class BusinessFoundationCollectionError extends Error{
 constructor(){super('BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED');this.name='BusinessFoundationCollectionError';}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
const maxBytes=8*1024*1024,maxRecords=10000,lifetime=30000,pageSize=20;
const groups:readonly Group[]=['configuration','identity','history'];
const descriptors={
 configuration:{scope:'business_configuration',kinds:['business','membership','recovery_authority'],maxRecords:1000,sql:'SELECT * FROM crest_commands.business_configuration_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)'},
 identity:{scope:'business_identity',kinds:['actor','role_capability','identity_event'],maxRecords:10000,sql:'SELECT * FROM crest_commands.business_identity_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)'},
 history:{scope:'business_history',kinds:['operation','audit_event'],maxRecords:1000,sql:'SELECT * FROM crest_commands.business_history_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)'}
} as const;
function require(value:unknown):asserts value{if(!value)throw new BusinessFoundationCollectionError();}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
function context(value:unknown,group:Group,businessId:string):Context{
 const d=descriptors[group];
 require(exact(value,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'])&&value.schemaVersion===1&&value.scope===d.scope&&value.businessId===businessId&&typeof value.snapshotToken==='string'&&hash.test(value.snapshotToken)&&typeof value.observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(value.observedAt)&&exact(value.recordCounts,d.kinds));
 const counts:Record<string,string>={};let total=0;
 for(const kind of d.kinds){
  const n=value.recordCounts[kind];require(typeof n==='string'&&/^(0|[1-9][0-9]{0,4})$/.test(n));total+=Number(n);require(total<=d.maxRecords);counts[kind]=n;
 }
 if(group==='configuration')require(counts.business==='1'&&counts.recovery_authority==='1'&&Number(counts.membership)>=1);
 if(group==='identity')require(Number(counts.actor)<=1000&&Number(counts.role_capability)<=5);
 return Object.freeze({schemaVersion:1,scope:d.scope,businessId,snapshotToken:value.snapshotToken,observedAt:value.observedAt,recordCounts:Object.freeze(counts)});
}
function record(value:unknown,group:Group,kind:string,after:string|null):Row{
 require(exact(value,['record_id','representation','canonical_evidence','evidence_hash'])&&typeof value.record_id==='string'&&uuid.test(value.record_id)&&(after===null||value.record_id>after)&&value.representation==='snapshot_projection'&&typeof value.canonical_evidence==='string'&&typeof value.evidence_hash==='string'&&hash.test(value.evidence_hash));
 const limit=group==='configuration'?8192:group==='identity'?(kind==='identity_event'?262144:16384):kind==='operation'?262144:2097152;
 require(value.canonical_evidence.length>0&&value.canonical_evidence.length<=limit&&!value.canonical_evidence.includes('\0'));
 const bytes=Buffer.from(value.canonical_evidence,'utf8');require(bytes.length<=limit&&bytes.toString('utf8')===value.canonical_evidence&&createHash('sha256').update(bytes).digest('hex')===value.evidence_hash);
 return Object.freeze({kind,recordId:value.record_id,representation:'snapshot_projection',canonicalEvidence:value.canonical_evidence,evidenceHash:value.evidence_hash});
}

// Internal capture for a later owner-authorized export worker. This grants no
// browser authority, queue/Ready transition, custody, download or backup claim.
// All contexts are obtained in one statement and all pages on one owned
// READ ONLY REPEATABLE READ connection; source JSON text is never rewritten.
export function createBusinessFoundationCollector(config:Configuration){
 let connectionString:string,businessId:string,ssl:false|{rejectUnauthorized:true};
 try{
  const url=new URL(config.connectionString);
  if(!['production','test'].includes(config.environment)||typeof config.businessId!=='string'||!uuid.test(config.businessId.toLowerCase())||!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
  connectionString=url.toString();businessId=config.businessId.toLowerCase();ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
 }catch{throw new Error('BUSINESS_FOUNDATION_COLLECTION_CONFIGURATION_REQUIRED');}
 let active=false;
 return async(signal:AbortSignal):Promise<BusinessFoundationCapture>=>{
  require(!signal.aborted&&!active);active=true;
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),started=performance.now();
  let client:pg.Client|undefined,transport:Socket|undefined,closed=false,timer:ReturnType<typeof setTimeout>|undefined,interrupted:()=>void=()=>{};
  const stop=()=>{if(closed)return;closed=true;try{void client?.end().catch(()=>{});}catch{/* fixed outer error only */}finally{transport?.destroy();}};
  const check=()=>require(!closed&&!combined.aborted&&performance.now()-started<lifetime);
  try{
   client=new pg.Client({connectionString,ssl,stream:()=>{transport=new Socket();return transport;},connectionTimeoutMillis:1000,statement_timeout:3000,lock_timeout:2000,query_timeout:3500,idle_in_transaction_session_timeout:4000,options:'-c role=crest_export',application_name:'crest_business_capture'});
   const owned=client,failed=()=>controller.abort();owned.on('error',failed);owned.once('end',failed);
   timer=setTimeout(failed,lifetime);timer.unref();
   const interruption=new Promise<never>((_,reject)=>{interrupted=()=>{stop();reject(new BusinessFoundationCollectionError());};combined.addEventListener('abort',interrupted,{once:true});});
   const query=async(sql:string,values?:unknown[])=>{check();const result=await owned.query(sql,values);check();return result;};
   const work=(async()=>{
    await owned.connect();check();
    const guard=await query(`SELECT current_user=$1
     AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=$1 AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
     AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
     AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))=1
     AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname=$1 AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option)
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)) AS allowed`,['crest_export']);
    require(guard.rows.length===1&&exact(guard.rows[0],['allowed'])&&guard.rows[0].allowed===true);
    require((await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')).command==='BEGIN');
    const result=await query('SELECT crest_commands.business_configuration_export_context($1::uuid) AS configuration,crest_commands.business_identity_export_context($1::uuid) AS identity,crest_commands.business_history_export_context($1::uuid) AS history',[businessId]);
    require(result.rows.length===1&&exact(result.rows[0],groups));
    const contexts={} as Record<Group,Context>;let declared=0;
    for(const group of groups){contexts[group]=context(result.rows[0][group],group,businessId);declared+=Object.values(contexts[group].recordCounts).reduce((n,c)=>n+Number(c),0);}
    require(declared<=maxRecords&&groups.every(g=>contexts[g].observedAt===contexts.configuration.observedAt));
    const generationId=randomUUID(),parts={} as Record<Group,string>;let evidenceBytes=0,recordCount=0;
    for(const group of groups){
     const ctx=contexts[group],records:Row[]=[];let groupBytes=0;
     for(const kind of descriptors[group].kinds){
      let cursor:string|null=null,count=0;
      for(;;){
       const page=await query(descriptors[group].sql,[businessId,ctx.snapshotToken,kind,cursor,pageSize]);
       require(Array.isArray(page.rows)&&page.rows.length<=pageSize);
       for(const raw of page.rows){
        const row=record(raw,group,kind,cursor),size=Buffer.byteLength(row.canonicalEvidence,'utf8');count++;recordCount++;evidenceBytes+=size;groupBytes+=size;
        require(count<=Number(ctx.recordCounts[kind])&&recordCount<=maxRecords&&evidenceBytes<=maxBytes);
        records.push(row);cursor=row.recordId;
       }
       if(page.rows.length<pageSize)break;
      }
      require(String(count)===ctx.recordCounts[kind]);
     }
     parts[group]=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId,context:ctx,evidenceBytes:groupBytes,records});
    }
    require(recordCount===declared);
    // Reuse the existing lossless component, lineage and reference verifiers
    // while the transaction still owns the snapshot, before COMMIT.
    verifyBusinessFoundationEvidence(parts.configuration,parts.identity,parts.history,{businessId});check();
    require((await query('COMMIT')).command==='COMMIT');check();
    const value:Capture=Object.freeze({formatVersion:1,generationId,businessId,observedAt:contexts.configuration.observedAt,capture:'single_connection_repeatable_read',...parts,evidenceBytes,recordCount,completePortableExport:false,completeBackup:false});
    return Object.freeze({forServer:()=>value,toJSON():never{throw new Error('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');}});
   })();
   const value=await Promise.race([work,interruption]);check();return value;
  }catch{throw new BusinessFoundationCollectionError();}
  finally{clearTimeout(timer);combined.removeEventListener('abort',interrupted);stop();active=false;}
 };
}
