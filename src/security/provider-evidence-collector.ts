import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {performance} from 'node:perf_hooks';
import pg from 'pg';

const kinds=['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'] as const;
type Kind=typeof kinds[number];
type Configuration={connectionString:string;environment:'production'|'test';actorId:string;issuer:string};
type Context=Readonly<{schemaVersion:1;scope:'retained_provider_ledgers';actorId:string;providerIssuer:string;snapshotToken:string;observedAt:string;ledgerCounts:Readonly<Record<Kind,string>>}>;
type RecordBytes=Readonly<{kind:Kind;recordId:string;canonicalEvidence:string;evidenceHash:string}>;
export type ProviderEvidenceCollection=Readonly<{
  formatVersion:1;assurance:'snapshot_bytes_only';generationId:string;context:Context;
  evidenceBytes:number;records:readonly RecordBytes[];
}>;
export class ProviderEvidenceCollectionError extends Error{
  constructor(){super('PROVIDER_EVIDENCE_COLLECTION_REVIEW_REQUIRED');this.name='ProviderEvidenceCollectionError';}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const maxRecords=1000,maxBytes=8*1024*1024,lifetime=30000,pageSize=20;
function require(value:unknown):asserts value{if(!value)throw new ProviderEvidenceCollectionError();}
function keys(value:unknown,expected:string):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===expected;}
function utc(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(value))return false;
  const d=new Date(value);return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=1&&d.toISOString().slice(0,19)===value.slice(0,19);
}
function context(value:unknown,actorId:string,issuer:string):Context{
  require(keys(value,'actorId,ledgerCounts,observedAt,providerIssuer,schemaVersion,scope,snapshotToken')
    &&value.schemaVersion===1&&value.scope==='retained_provider_ledgers'&&value.actorId===actorId&&value.providerIssuer===issuer
    &&typeof value.snapshotToken==='string'&&hash.test(value.snapshotToken)&&utc(value.observedAt)
    &&keys(value.ledgerCounts,[...kinds].sort().join(',')));
  const counts={} as Record<Kind,string>;let total=0;
  for(const kind of kinds){const n=value.ledgerCounts[kind];require(typeof n==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(n));total+=Number(n);require(total<=maxRecords);counts[kind]=n;}
  return Object.freeze({schemaVersion:1,scope:'retained_provider_ledgers',actorId,providerIssuer:issuer,
    snapshotToken:value.snapshotToken,observedAt:value.observedAt,ledgerCounts:Object.freeze(counts)});
}
function record(value:unknown,kind:Kind,after:string|null):RecordBytes{
  require(keys(value,'canonical_evidence,evidence_hash,record_id')&&typeof value.record_id==='string'&&uuid.test(value.record_id)
    &&(after===null||value.record_id>after)&&typeof value.canonical_evidence==='string'
    &&value.canonical_evidence.length<=(kind==='inventory_observation'?262144:8192)
    &&typeof value.evidence_hash==='string'&&hash.test(value.evidence_hash));
  const bytes=Buffer.from(value.canonical_evidence,'utf8');
  require(bytes.length>0&&bytes.length<=(kind==='inventory_observation'?262144:8192)
    &&!value.canonical_evidence.includes('\0')&&bytes.toString('utf8')===value.canonical_evidence
    &&createHash('sha256').update(bytes).digest('hex')===value.evidence_hash);
  return Object.freeze({kind,recordId:value.record_id,canonicalEvidence:value.canonical_evidence,evidenceHash:value.evidence_hash});
}

// Private composition only. No caller SQL, pool, callback/sink, filesystem,
// environment lookup, provider action, runtime route or automatic retry.
export function createProviderEvidenceCollector(config:Configuration){
  let connectionString:string,actorId:string,issuer:string,ssl:false|{rejectUnauthorized:true};
  try{
    const url=new URL(config.connectionString),provider=new URL(config.issuer);
    if(!['production','test'].includes(config.environment)||typeof config.actorId!=='string'||!uuid.test(config.actorId.toLowerCase())
      ||config.issuer.length>500||Buffer.from(config.issuer,'utf8').toString('utf8')!==config.issuer
      ||provider.protocol!=='https:'||provider.username||provider.password||provider.search||provider.hash
      ||!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash
      ||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
    connectionString=url.toString();actorId=config.actorId.toLowerCase();issuer=config.issuer;ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
  }catch{throw new Error('PROVIDER_EVIDENCE_COLLECTION_CONFIGURATION_REQUIRED');}
  let active=false;
  return async(signal:AbortSignal):Promise<ProviderEvidenceCollection>=>{
    require(!signal.aborted&&!active);active=true;
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),started=performance.now();
    let client:pg.Client|undefined,transport:Socket|undefined,closed=false,timer:ReturnType<typeof setTimeout>|undefined;
    let interrupted:()=>void=()=>{};
    const stop=()=>{if(closed)return;closed=true;try{void client?.end().catch(()=>undefined);}catch{/* Redact shutdown diagnostics. */}finally{transport?.destroy();}};
    const check=()=>require(!closed&&!combined.aborted&&performance.now()-started<lifetime);
    try{
      client=new pg.Client({connectionString,ssl,stream:()=>{transport=new Socket();return transport;},
        connectionTimeoutMillis:1000,statement_timeout:3000,lock_timeout:2000,query_timeout:3500,
        idle_in_transaction_session_timeout:4000,options:'-c role=crest_inventory',application_name:'crest_evidence_collect'});
      const owned=client,failed=()=>controller.abort();owned.on('error',failed);owned.once('end',failed);
      timer=setTimeout(failed,lifetime);timer.unref();
      const interruption=new Promise<never>((_,reject)=>{interrupted=()=>{stop();reject(new ProviderEvidenceCollectionError());};combined.addEventListener('abort',interrupted,{once:true});});
      const query=async(sql:string,values?:unknown[])=>{check();const result=await owned.query(sql,values);check();return result;};
      const pending=(async()=>{
        await owned.connect();check();
        const guard=await query(`SELECT current_user=$1
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=$1 AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))=1
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname=$1 AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1)) AS allowed`,['crest_inventory']);
        require(guard.rows.length===1&&keys(guard.rows[0],'allowed')&&guard.rows[0].allowed===true);
        require((await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')).command==='BEGIN');
        // First data statement in this transaction establishes and counts the
        // one snapshot. Never reacquire a connection/context for a later page.
        const result=await query('SELECT crest_commands.provider_evidence_export_context($1::uuid,$2::text) AS result',[actorId,issuer]);
        require(result.rows.length===1&&keys(result.rows[0],'result'));const ctx=context(result.rows[0].result,actorId,issuer);
        const generationId=randomUUID(),records:RecordBytes[]=[];let evidenceBytes=0;
        for(const kind of kinds){
          let after:string|null=null,count=0;
          for(;;){
            const page=await query('SELECT * FROM crest_commands.provider_evidence_export_page($1::uuid,$2::text,$3::text,$4::text,$5::uuid,$6::integer)',[actorId,issuer,ctx.snapshotToken,kind,after,pageSize]);
            require(Array.isArray(page.rows)&&page.rows.length<=pageSize);
            for(const value of page.rows){
              const r=record(value,kind,after);evidenceBytes+=Buffer.byteLength(r.canonicalEvidence,'utf8');count++;
              require(evidenceBytes<=maxBytes&&records.length<maxRecords&&count<=Number(ctx.ledgerCounts[kind]));
              records.push(r);after=r.recordId;
            }
            if(page.rows.length<pageSize)break;
          }
          require(String(count)===ctx.ledgerCounts[kind]);
        }
        require((await query('COMMIT')).command==='COMMIT');check();
        return Object.freeze({formatVersion:1 as const,assurance:'snapshot_bytes_only' as const,generationId,context:ctx,evidenceBytes,records:Object.freeze(records)});
      })();
      const value=await Promise.race([pending,interruption]);check();return value;
    }catch{throw new ProviderEvidenceCollectionError();}
    finally{clearTimeout(timer);combined.removeEventListener('abort',interrupted);stop();active=false;}
  };
}
