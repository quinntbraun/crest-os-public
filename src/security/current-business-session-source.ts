import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifySessionMetadataEvidence} from './session-metadata-evidence.ts';
import {verifyCurrentIdentitySource} from './current-business-identity-source.ts';
import type {CurrentBusinessIdentitySource} from './current-business-identity-source.ts';
import {readCurrentBusinessCsv,currentSourceCsvScalarFormat} from './current-business-source-csv.ts';
import type {CurrentBusinessRows} from './current-business-source.ts';

export const currentSessionSource=Object.freeze({source:'crest_private.app_sessions',columns:Object.freeze(['id','actor_id','provider_session_id','issued_security_epoch','created_at','authenticated_at','last_active_at','expires_at','revoked_at','trusted','reauth_at','version','updated_at','created_by','updated_by','origin','operation_id'])});
type Binding=Pick<CurrentBusinessRows,'businessId'|'snapshotToken'|'observedAt'>;
type Source=CurrentBusinessRows['sources'][number];
type Metadata=Pick<Source,'columns'|'types'|'primaryKey'>;
type Scope=Readonly<{actorId:string;issuer:string;evidence:string}>;
export type CurrentBusinessSessionSource=Readonly<{schemaVersion:1;profile:'crest.current-business-session-source.v1';businessId:string;businessSnapshotToken:string;businessObservedAt:string;identitySnapshotToken:string;scopes:readonly Scope[];source:Source;recordCount:number;completePortableExport:false;completeBackup:false}>;
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_SESSION_REVIEW_REQUIRED');}
function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));}
function actors(identity:CurrentBusinessIdentitySource){return identity.sources[0]!.rows.filter(row=>row.auth_provider_issuer!==null).map(row=>{require(typeof row.id==='string'&&typeof row.auth_provider_issuer==='string');return{actorId:row.id,issuer:row.auth_provider_issuer};}).sort((a,b)=>a.actorId<b.actorId?-1:a.actorId>b.actorId?1:0);}
export function currentSessionsFromEvidence(scopes:readonly Scope[],metadata:Metadata,identity:CurrentBusinessIdentitySource,binding:Binding):CurrentBusinessSessionSource{
 const checkedIdentity=verifyCurrentIdentitySource(identity,binding),owners=actors(checkedIdentity),actorIds=new Set(checkedIdentity.sources[0]!.rows.map(row=>row.id)),rows:Readonly<Record<string,string|null>>[]=[];let totalBytes=0;
 require(scopes.length===owners.length&&isDeepStrictEqual([...metadata.columns].sort(),[...currentSessionSource.columns].sort())&&exact(metadata.types,currentSessionSource.columns)&&Object.values(metadata.types).every(type=>typeof type==='string')&&metadata.types.trusted==='boolean'&&isDeepStrictEqual(metadata.primaryKey,['id']));
 for(const [index,scope]of scopes.entries()){
  require(exact(scope,['actorId','issuer','evidence'])&&scope.actorId===owners[index]!.actorId&&scope.issuer===owners[index]!.issuer);
  const verified=verifySessionMetadataEvidence(scope.evidence,{actorId:scope.actorId,issuer:scope.issuer});totalBytes+=verified.evidenceBytes;require(totalBytes<=8388608&&verified.requiredActorIds.every(actor=>actorIds.has(actor)));
  for(const record of verified.records){
   const body=JSON.parse(record.canonicalEvidence) as {row:unknown};require(exact(body.row,currentSessionSource.columns));const value=body.row;
   const row=Object.fromEntries(currentSessionSource.columns.map(column=>{const cell=value[column];if(column==='trusted'){require(typeof cell==='boolean');return[column,String(cell)];}require(cell===null||typeof cell==='string'&&!cell.includes('\0')&&Buffer.from(cell).toString('utf8')===cell);return[column,cell];}));
   rows.push(Object.freeze(row) as Readonly<Record<string,string|null>>);require(rows.length<=10000);
  }
 }
 rows.sort((a,b)=>a.id!<b.id!?-1:a.id!>b.id!?1:0);require(new Set(rows.map(row=>row.id)).size===rows.length);
 const source=Object.freeze({source:currentSessionSource.source,columns:currentSessionSource.columns,types:Object.freeze({...metadata.types}),primaryKey:Object.freeze([...metadata.primaryKey]),rows:Object.freeze(rows)});
 return Object.freeze({schemaVersion:1,profile:'crest.current-business-session-source.v1',businessId:binding.businessId,businessSnapshotToken:binding.snapshotToken,businessObservedAt:binding.observedAt,identitySnapshotToken:checkedIdentity.identitySnapshotToken,scopes:Object.freeze(scopes.map(scope=>Object.freeze({...scope}))),source,recordCount:rows.length,completePortableExport:false,completeBackup:false});
}
export function verifyCurrentSessionSource(input:CurrentBusinessSessionSource,identity:CurrentBusinessIdentitySource,binding:Binding){
 require(input.businessId===binding.businessId&&input.businessSnapshotToken===binding.snapshotToken&&input.businessObservedAt===binding.observedAt&&input.identitySnapshotToken===identity.identitySnapshotToken);const checked=currentSessionsFromEvidence(input.scopes,input.source,identity,binding);require(isDeepStrictEqual(input,checked));return checked;
}
export async function captureCurrentSessionSource(identity:CurrentBusinessIdentitySource,binding:Binding,query:(sql:string,args:unknown[])=>Promise<unknown[]>,check:()=>void){
 const checked=verifyCurrentIdentitySource(identity,binding),scopes:Scope[]=[];let bytes=0,recordsTotal=0;
 for(const owner of actors(checked)){
  check();const result=await query('SELECT crest_commands.session_metadata_export_context($1::uuid,$2::text) AS context',[owner.actorId,owner.issuer]);check();require(result.length===1&&exact(result[0],['context']));const ctx=result[0].context;
  require(exact(ctx,['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','recordCount'])&&ctx.schemaVersion===1&&ctx.scope==='application_session_metadata'&&ctx.actorId===owner.actorId&&ctx.providerIssuer===owner.issuer&&typeof ctx.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(ctx.snapshotToken)&&typeof ctx.recordCount==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(ctx.recordCount)&&Number(ctx.recordCount)<=1000);
  const records:Record<string,unknown>[]=[];let cursor:string|null=null,scopeBytes=0;
  for(;;){
   check();const page=await query('SELECT * FROM crest_commands.session_metadata_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)',[owner.actorId,owner.issuer,ctx.snapshotToken,cursor,20]);check();require(page.length<=20);
   for(const raw of page){require(exact(raw,['record_id','representation','canonical_evidence','evidence_hash'])&&typeof raw.record_id==='string'&&/^[a-f0-9-]{36}$/.test(raw.record_id)&&(cursor===null||raw.record_id>cursor)&&raw.representation==='snapshot_projection'&&typeof raw.canonical_evidence==='string'&&Buffer.byteLength(raw.canonical_evidence)<=8192&&typeof raw.evidence_hash==='string'&&sha(raw.canonical_evidence)===raw.evidence_hash);cursor=raw.record_id;const size=Buffer.byteLength(raw.canonical_evidence);scopeBytes+=size;bytes+=size;recordsTotal++;require(bytes<=8388608&&recordsTotal<=10000&&records.length<Number(ctx.recordCount));records.push({kind:'session_metadata',recordId:raw.record_id,representation:raw.representation,canonicalEvidence:raw.canonical_evidence,evidenceHash:raw.evidence_hash});}
   if(page.length<20)break;
  }
  require(records.length===Number(ctx.recordCount));scopes.push(Object.freeze({...owner,evidence:JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:ctx,evidenceBytes:scopeBytes,records})}));
 }
 check();const metadata=await query(`SELECT array_agg(a.attname::text ORDER BY a.attnum) AS columns,jsonb_object_agg(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod)) AS types,
 (SELECT array_agg(k.attname::text ORDER BY part.ordinality) FROM pg_catalog.pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY part(attnum,ordinality) JOIN pg_catalog.pg_attribute k ON k.attrelid=c.oid AND k.attnum=part.attnum WHERE i.indrelid=c.oid AND i.indisprimary) AS "primaryKey"
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest_private' AND c.relname='app_sessions' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attname=ANY($1::text[]) GROUP BY c.oid`,[currentSessionSource.columns]);check();
 require(metadata.length===1&&exact(metadata[0],['columns','types','primaryKey'])&&Array.isArray(metadata[0].columns)&&Array.isArray(metadata[0].primaryKey));return currentSessionsFromEvidence(scopes,metadata[0] as Metadata,checked,binding);
}
export function formatCurrentSessionSource(input:CurrentBusinessSessionSource,identity:CurrentBusinessIdentitySource,binding:Binding){
 const value=verifyCurrentSessionSource(input,identity,binding),source=value.source,escapes:{row:number;column:string}[]=[],quote=(cell:string)=>'"'+cell.replaceAll('"','""')+'"';
 const lines=[source.columns.map(quote).join(','),...source.rows.map((row,index)=>source.columns.map(column=>{const original=row[column]!;if(original===null)return quote('\\N');let cell=original.replaceAll('\\','\\\\');if(cell.startsWith("'")||['=','+','-','@'].includes(cell.trimStart()[0]??'')){cell="'"+cell;escapes.push({row:index+1,column});}return quote(cell);}).join(','))],csv=lines.join('\r\n')+'\r\n';require(isDeepStrictEqual(readCurrentBusinessCsv(csv,source.columns,escapes),source.rows));
 const files:Record<string,Uint8Array>={'crest_private_app_sessions.csv':Buffer.from(csv),'current_session_dictionary.json':Buffer.from(JSON.stringify({source:source.source,columns:source.columns,types:source.types,primaryKey:source.primaryKey,records:source.rows.length,booleanColumns:['trusted'],csvScalars:'Exact text. Quoted \\N is null; unescape paired backslashes after removing only the escape-map-marked apostrophe.'})+'\n'),'current_session_escape_map.json':Buffer.from(JSON.stringify({'crest_private_app_sessions.csv':escapes})+'\n'),'application_session_evidence.json':Buffer.from(JSON.stringify({schemaVersion:1,businessId:value.businessId,businessSnapshotToken:value.businessSnapshotToken,identitySnapshotToken:value.identitySnapshotToken,scopes:value.scopes})+'\n')};
 files['current_session_source_manifest.json']=Buffer.from(JSON.stringify({schemaVersion:1,profile:value.profile,businessId:value.businessId,businessSnapshotToken:value.businessSnapshotToken,identitySnapshotToken:value.identitySnapshotToken,recordCount:value.recordCount,scope:'Approved noncredential session metadata for every provider-bound actor in the reviewed business identity projection. Tokens, credential hashes, CSRF and network digests are absent. Provider references and instance runtime sources remain separate.',scalarFormat:currentSourceCsvScalarFormat,booleanColumns:['trusted'],completePortableExport:false,completeBackup:false,files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:sha(bytes)}))})+'\n');require(Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0)<=33554432);return Object.freeze({files:Object.freeze(files),session:value});
}
