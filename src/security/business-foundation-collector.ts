import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {verifyBusinessFoundationEvidence} from './business-configuration-evidence.ts';
import {parseCustomer} from '../customer/customer-contract.ts';
import {parseCustomerAddress} from '../customer/customer-address-contract.ts';
import {parseVehicle} from '../customer/vehicle-contract.ts';
import {parseAssociation} from '../customer/vehicle-association-contract.ts';
import {parseLead,parseLeadSource} from '../customer/lead-contract.ts';
import {parseLeadEvent} from '../customer/lead-state-contract.ts';
import {parseLeadVehicle} from '../customer/lead-vehicle-contract.ts';
import {parseLeadAddress} from '../customer/lead-address-contract.ts';
import {parseLeadConversionRecord,parseConversionLink,parseLeadConversionCollection} from '../customer/lead-conversion-record.ts';
import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';

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
export type BusinessSourceCapture=Readonly<{forServer:()=>Capture&Readonly<{crm:string}>;toJSON:()=>never}>;
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
// Closed source inventory. These are existing export-only routines, never
// caller-supplied identifiers or additional grants. Links share their parent's
// conversion context and domain-separated snapshot token.
const crmSources={
 customers:{routine:'customer',scope:'customer_directory',field:'customers',parse:parseCustomer},
 addresses:{routine:'address',scope:'address_directory',field:'addresses',parse:parseCustomerAddress},
 vehicles:{routine:'vehicle',scope:'vehicle_directory',field:'vehicles',parse:parseVehicle},
 associations:{routine:'association',scope:'vehicle_associations',field:'associations',parse:parseAssociation},
 leadSources:{routine:'lead_source',scope:'lead_source_directory',field:'lead_sources',parse:parseLeadSource},
 leads:{routine:'lead',scope:'lead_directory',field:'leads',parse:parseLead},
 leadEvents:{routine:'lead_event',scope:'lead_state_events',field:'events',parse:parseLeadEvent},
 leadVehicles:{routine:'lead_vehicle',scope:'lead_vehicle_intake',field:'leadVehicles',parse:parseLeadVehicle},
 leadAddresses:{routine:'lead_address',scope:'lead_address_intake',field:'leadAddresses',parse:parseLeadAddress},
 conversions:{routine:'lead_conversion',scope:'lead_conversion',field:'conversions',parse:parseLeadConversionRecord},
 links:{routine:'conversion_link',scope:'lead_conversion',field:'links',parse:parseConversionLink}
} as const;
type CrmSource=keyof typeof crmSources;
const crmNames=Object.keys(crmSources) as CrmSource[],crmContexts=crmNames.filter(n=>n!=='links');
type CrmContext=Readonly<{schemaVersion:1;scope:string;businessId:string;snapshotToken:string;rowCount?:string;conversionCount?:string;linkCount?:string}>;
function crmContext(value:unknown,name:CrmSource,businessId:string):CrmContext{
 const counts=name==='conversions'?['conversionCount','linkCount']:['rowCount'];
 require(exact(value,['schemaVersion','scope','businessId','snapshotToken',...counts])&&value.schemaVersion===1&&value.scope===crmSources[name].scope&&value.businessId===businessId&&typeof value.snapshotToken==='string'&&hash.test(value.snapshotToken));
 for(const key of counts)require(typeof value[key]==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(value[key])&&Number(value[key])<=1000);
 return Object.freeze({...value}) as CrmContext;
}
// PostgreSQL JSONB text is retained unchanged. Reject duplicate keys, malformed
// UTF8 and numbers that ordinary JSON decoding would round, before typed use.
function sourceJson(value:unknown):{text:string;value:unknown;bytes:number}{
 require(typeof value==='string'&&value.length>0&&value.length<=1048576&&!value.includes('\0'));
 const bytes=Buffer.from(value,'utf8');require(bytes.length<=1048576&&bytes.toString('utf8')===value);
 const decoded:unknown=JSON.parse(value);require(historyJsonEqual(parseHistoryJson(value),parseHistoryJson(JSON.stringify(decoded))));
 return {text:value,value:decoded,bytes:bytes.length};
}
function currentCrmReferences(rows:Record<CrmSource,Record<string,unknown>[]>){
 const ids=Object.fromEntries(crmNames.map(n=>[n,new Set(rows[n].map(r=>r.id))])) as Record<CrmSource,Set<unknown>>;
 const references:Partial<Record<CrmSource,Record<string,CrmSource>>>={addresses:{customer_id:'customers'},associations:{customer_id:'customers',vehicle_id:'vehicles'},leadSources:{referral_customer_id:'customers'},leads:{customer_id:'customers',source_id:'leadSources'},leadEvents:{lead_id:'leads'},leadVehicles:{lead_id:'leads',vehicle_id:'vehicles'},leadAddresses:{lead_id:'leads'},conversions:{lead_id:'leads',customer_id:'customers'},links:{conversion_id:'conversions',lead_id:'leads',lead_vehicle_id:'leadVehicles',vehicle_id:'vehicles',lead_address_id:'leadAddresses',address_id:'addresses'}};
 for(const name of crmNames)for(const row of rows[name])for(const [field,target] of Object.entries(references[name]??{}))require(row[field]===null||ids[target].has(row[field]));
 // Immutable conversion mappings require the complete bounded child set.
 // Current target versions may legitimately be newer than their retained images.
 const leads=new Map(rows.leadVehicles.map(r=>[r.id,r.lead_id])),addresses=new Map(rows.leadAddresses.map(r=>[r.id,r.lead_id])),customers=new Map(rows.addresses.map(r=>[r.id,r.customer_id])),parents=new Map(rows.conversions.map(r=>[r.id,r.customer_id]));
 for(const link of rows.links)require(link.lead_vehicle_id!==null?leads.get(link.lead_vehicle_id)===link.lead_id:addresses.get(link.lead_address_id)===link.lead_id&&customers.get(link.address_id)===parents.get(link.conversion_id));
}
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
export function createBusinessFoundationCollector(config:Configuration){return createCollector(config,false);}
export function createBusinessSourceCollector(config:Configuration){return createCollector(config,true);}
function createCollector(config:Configuration,includeCrm:true):(signal:AbortSignal)=>Promise<BusinessSourceCapture>;
function createCollector(config:Configuration,includeCrm:false):(signal:AbortSignal)=>Promise<BusinessFoundationCapture>;
function createCollector(config:Configuration,includeCrm:boolean){
 let connectionString:string,businessId:string,ssl:false|{rejectUnauthorized:true};
 try{
  const url=new URL(config.connectionString);
  if(!['production','test'].includes(config.environment)||typeof config.businessId!=='string'||!uuid.test(config.businessId.toLowerCase())||!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
  connectionString=url.toString();businessId=config.businessId.toLowerCase();ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
 }catch{throw new Error('BUSINESS_FOUNDATION_COLLECTION_CONFIGURATION_REQUIRED');}
 let active=false;
 return async(signal:AbortSignal)=>{
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
    const contextSql='SELECT crest_commands.business_configuration_export_context($1::uuid) AS configuration,crest_commands.business_identity_export_context($1::uuid) AS identity,crest_commands.business_history_export_context($1::uuid) AS history';
    const result=await query(contextSql+(includeCrm?crmContexts.map(n=>`,crest_commands.${crmSources[n].routine}_snapshot_context($1::uuid)::text AS "${n}"`).join(''):''),[businessId]);
    require(result.rows.length===1&&exact(result.rows[0],includeCrm?[...groups,...crmContexts]:groups));
    const contexts={} as Record<Group,Context>;let declared=0;
    for(const group of groups){contexts[group]=context(result.rows[0][group],group,businessId);declared+=Object.values(contexts[group].recordCounts).reduce((n,c)=>n+Number(c),0);}
    const crm={} as Record<CrmSource,CrmContext>,rawContexts:Partial<Record<CrmSource,string>>={};let crmBytes=0;
    if(includeCrm)for(const name of crmContexts){const raw=sourceJson(result.rows[0][name]);crm[name]=crmContext(raw.value,name,businessId);rawContexts[name]=raw.text;crmBytes+=raw.bytes;declared+=name==='conversions'?Number(crm[name].conversionCount)+Number(crm[name].linkCount):Number(crm[name].rowCount);}
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
    let crmPart:string|undefined;
    if(includeCrm){
     const rows={} as Record<CrmSource,Record<string,unknown>[]>,pages={} as Record<CrmSource,string[]>;
     evidenceBytes+=crmBytes;require(evidenceBytes<=maxBytes);crm.links=crm.conversions;
     for(const name of crmNames){
      const descriptor=crmSources[name],ctx=crm[name],expected=name==='conversions'?ctx.conversionCount:name==='links'?ctx.linkCount:ctx.rowCount;
      rows[name]=[];pages[name]=[];let cursor:string|null=null;
      for(;;){
       const result=await query(`SELECT crest_commands.${descriptor.routine}_snapshot_page($1::uuid,$2::text,$3::uuid,$4::integer)::text AS page`,[businessId,ctx.snapshotToken,cursor,pageSize]);
       require(result.rows.length===1&&exact(result.rows[0],['page']));const raw=sourceJson(result.rows[0].page),page=raw.value;
       require(exact(page,['schemaVersion','businessId','snapshotToken',descriptor.field])&&page.schemaVersion===1&&page.businessId===businessId&&page.snapshotToken===ctx.snapshotToken&&Array.isArray(page[descriptor.field]));
       const part=page[descriptor.field] as unknown[];require(part.length<=pageSize);
       evidenceBytes+=raw.bytes;crmBytes+=raw.bytes;require(evidenceBytes<=maxBytes);pages[name].push(raw.text);
       for(const value of part){
        const row=descriptor.parse(value,businessId);require(uuid.test(row.id)&&(cursor===null||row.id>cursor));cursor=row.id;rows[name].push(row);recordCount++;
        require(rows[name].length<=Number(expected)&&recordCount<=maxRecords);
       }
       if(part.length<pageSize)break;
      }
      require(String(rows[name].length)===expected);
     }
     currentCrmReferences(rows);parseLeadConversionCollection(rows.conversions,rows.links,businessId);
     crmPart=JSON.stringify({formatVersion:1,generationId,businessId,observedAt:contexts.configuration.observedAt,contexts:rawContexts,pages,evidenceBytes:crmBytes,recordCount:Object.values(rows).reduce((n,r)=>n+r.length,0),completePortableExport:false,completeBackup:false});
    }
    require(recordCount===declared);
    // Reuse the existing lossless component, lineage and reference verifiers
    // while the transaction still owns the snapshot, before COMMIT.
    verifyBusinessFoundationEvidence(parts.configuration,parts.identity,parts.history,{businessId});check();
    require((await query('COMMIT')).command==='COMMIT');check();
    const value:Capture&{crm?:string}=Object.freeze({formatVersion:1,generationId,businessId,observedAt:contexts.configuration.observedAt,capture:'single_connection_repeatable_read',...parts,...(includeCrm?{crm:crmPart!}:{}),evidenceBytes,recordCount,completePortableExport:false,completeBackup:false});
    return Object.freeze({forServer:()=>value,toJSON():never{throw new Error('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');}});
   })();
   const value=await Promise.race([work,interruption]);check();return value;
  }catch{throw new BusinessFoundationCollectionError();}
  finally{clearTimeout(timer);combined.removeEventListener('abort',interrupted);stop();active=false;}
 };
}
