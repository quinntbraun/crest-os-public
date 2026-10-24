import {createHash} from 'node:crypto';
import {parseHistoryJson,historyJsonEqual,historyJsonInteger,historyJsonNumber} from './history-evidence-json.ts';
import {verifyBusinessIdentityEvidence} from './business-identity-evidence.ts';
import {verifyBusinessHistoryEvidence} from './business-history-evidence.ts';

type Body=Record<string,unknown>;
type Expected={businessId:string};
const kinds=['business','membership','recovery_authority'] as const;
type Kind=typeof kinds[number];
const entities={business:'businesses',membership:'memberships',recovery_authority:'business_recovery_authorities'};
const columns={
 business:['id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
 membership:['id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
 recovery_authority:['id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
export class BusinessConfigurationEvidenceError extends Error{
 constructor(){super('BUSINESS_CONFIGURATION_EVIDENCE_REVIEW_REQUIRED');this.name='BusinessConfigurationEvidenceError';}
}
function require(v:unknown):asserts v{if(!v)throw new BusinessConfigurationEvidenceError();}
function object(v:unknown):asserts v is Body{require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===null||Object.getPrototypeOf(v)===Object.prototype));}
function fields(v:unknown,names:readonly string[]):asserts v is Body{object(v);require(Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k)));}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.length<=max&&Buffer.byteLength(v,'utf8')<=max&&!v.includes('\0')&&Buffer.from(v,'utf8').toString('utf8')===v;}
function id(v:unknown):v is string{return typeof v==='string'&&uuid.test(v);}
function version(v:unknown):v is string{return typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;}
function instant(v:unknown,utc=false):bigint{
 require(typeof v==='string');const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|([+-])(\d\d):(\d\d)(?::(\d\d))?)$/.exec(v);
 require(m&&(!utc||m[3]==='+00:00'));const d=new Date(m[1]+'Z');require(Number.isFinite(d.getTime())&&d.getUTCFullYear()>=1&&d.toISOString().slice(0,19)===m[1]);
 const h=Number(m[5]??0),min=Number(m[6]??0),s=Number(m[7]??0);require(h<=15&&min<=59&&s<=59);
 return BigInt(d.getTime())*1000n+BigInt((m[2]??'').padEnd(6,'0'))-BigInt((h*3600+min*60+s)*(m[4]==='-'?-1:1))*1000000n;
}
function digest(s:string){return createHash('sha256').update(s,'utf8').digest('hex');}
function sourceRow(row:unknown,kind:Kind,businessId:string,actors:Set<string>):asserts row is Body{
 fields(row,columns[kind]);require(id(row.id)&&id(row.created_by)&&id(row.updated_by)&&version(row.version)&&['manual','import','system'].includes(row.origin as string)
  &&(row.operation_id===null||id(row.operation_id))&&(row.import_row_id===null||id(row.import_row_id)));
 actors.add(row.created_by);actors.add(row.updated_by);instant(row.created_at,true);instant(row.updated_at,true);
 if(kind==='business'){
  require(row.id===businessId&&text(row.legal_name,800));const n=[...row.legal_name.replace(/^ +| +$/g,'')].length;require(n>=1&&n<=200);
  require(row.currency==='USD'&&text(row.timezone,400)&&[...row.timezone].length>=1&&[...row.timezone].length<=100&&['setup','active','suspended'].includes(row.status as string));
 }else{
  require(row.business_id===businessId);
  if(kind==='membership'){require(id(row.actor_id)&&row.role==='owner'&&typeof row.active==='boolean');actors.add(row.actor_id);}
  else require(id(row.active_epoch)&&typeof row.writes_enabled==='boolean'&&(row.incident_id===null||id(row.incident_id)));
 }
}

// Pure offline validation. Unkeyed projections/counts are not source capture,
// current membership/epoch authority, a complete portable export or a backup.
export function verifyBusinessConfigurationEvidence(serialized:unknown,expected:Expected){
 try{
  require(text(serialized,64*1024*1024));const businessId=expected.businessId.toLowerCase();require(id(businessId));const c=parseHistoryJson(serialized);
  fields(c,['formatVersion','assurance','generationId','context','evidenceBytes','records']);const declared=historyJsonInteger(c.evidenceBytes);
  require(historyJsonNumber(c.formatVersion,1)&&c.assurance==='snapshot_bytes_only'&&id(c.generationId)&&declared!==undefined&&declared>=0&&declared<=8*1024*1024&&Array.isArray(c.records)&&c.records.length<=1000);
  const ctx=c.context;fields(ctx,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts']);require(historyJsonNumber(ctx.schemaVersion,1)&&ctx.scope==='business_configuration'&&ctx.businessId===businessId&&typeof ctx.snapshotToken==='string'&&hash.test(ctx.snapshotToken));instant(ctx.observedAt,true);
  fields(ctx.recordCounts,kinds);const counts=ctx.recordCounts;require(counts.business==='1'&&counts.recovery_authority==='1'&&typeof counts.membership==='string'&&/^[1-9][0-9]{0,3}$/.test(counts.membership)&&BigInt(counts.membership)<=1000n);
  const records:Readonly<{kind:Kind;recordId:string;representation:'snapshot_projection';canonicalEvidence:string;evidenceHash:string}>[]=[],actors=new Set<string>(),members=new Set<string>(),operators=new Set<string>(),seen={business:0,membership:0,recovery_authority:0};let bytes=0,lastKind=-1,lastId='';
  for(const r of c.records){
   fields(r,['kind','recordId','representation','canonicalEvidence','evidenceHash']);require(typeof r.kind==='string'&&kinds.includes(r.kind as Kind)&&id(r.recordId)&&r.representation==='snapshot_projection');const kind=r.kind as Kind,index=kinds.indexOf(kind);require(index>=lastKind&&(index!==lastKind||r.recordId>lastId));lastKind=index;lastId=r.recordId;
   require(text(r.canonicalEvidence,8192)&&typeof r.evidenceHash==='string'&&hash.test(r.evidenceHash)&&digest(r.canonicalEvidence)===r.evidenceHash);bytes+=Buffer.byteLength(r.canonicalEvidence);require(bytes<=8*1024*1024);
   const b=parseHistoryJson(r.canonicalEvidence);fields(b,['schemaVersion','kind','businessId','row']);require(historyJsonNumber(b.schemaVersion,1)&&b.kind===kind&&b.businessId===businessId);sourceRow(b.row,kind,businessId,actors);require(b.row.id===r.recordId);
   if(kind==='membership'){require(!members.has(b.row.actor_id as string));members.add(b.row.actor_id as string);}operators.add(b.row.created_by as string);operators.add(b.row.updated_by as string);seen[kind]++;
   records.push(Object.freeze({kind,recordId:r.recordId,representation:'snapshot_projection',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash}));
  }
  require(bytes===declared&&kinds.every(k=>String(seen[k])===counts[k])&&[...operators].every(a=>members.has(a)));
  return Object.freeze({formatVersion:1 as const,assurance:'internal_consistency_only' as const,generationId:c.generationId,
   context:Object.freeze({schemaVersion:1 as const,scope:'business_configuration' as const,businessId,snapshotToken:ctx.snapshotToken,observedAt:ctx.observedAt as string,recordCounts:Object.freeze({...ctx.recordCounts})}),
   evidenceBytes:bytes,records:Object.freeze(records),requiredActorIds:Object.freeze([...actors].sort()),referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
 }catch{throw new BusinessConfigurationEvidenceError();}
}
function body(r:{canonicalEvidence:string}):Body{const b=parseHistoryJson(r.canonicalEvidence);object(b);object(b.row);return b.row;}
function normalized(row:Body,projection=false){const out={...row};for(const k of ['created_at','updated_at'])out[k]=instant(row[k],projection);if(projection){require(version(row.version));out.version=parseHistoryJson(row.version);}return out;}

// Reuse unchanged component verifiers. A common generation claim does not
// attest one actual snapshot. Other source domains and custody remain gates.
export function verifyBusinessFoundationEvidence(configurationSerialized:unknown,identitySerialized:unknown,historySerialized:unknown,expected:Expected){
 try{
  const inputs=[configurationSerialized,identitySerialized,historySerialized];require(inputs.every(s=>text(s,64*1024*1024))&&inputs.reduce<number>((n,s)=>n+Buffer.byteLength(s as string),0)<=64*1024*1024);
  const configuration=verifyBusinessConfigurationEvidence(configurationSerialized,expected),identity=verifyBusinessIdentityEvidence(identitySerialized,expected),history=verifyBusinessHistoryEvidence(historySerialized,expected);
  require(configuration.generationId===identity.generationId&&configuration.generationId===history.generationId&&configuration.records.length+identity.records.length+history.records.length<=10000&&configuration.evidenceBytes+identity.evidenceBytes+history.evidenceBytes<=8*1024*1024);
  const current=new Map<string,Body>(),members=new Set<string>(),profiles=new Set(identity.records.filter(r=>r.kind==='actor').map(r=>r.recordId)),latest=new Map<string,{version:bigint;after:Body}>();
  for(const r of configuration.records){const row=body(r);current.set(entities[r.kind]+':'+r.recordId,normalized(row,true));if(r.kind==='membership')members.add(row.actor_id as string);}
  for(const r of identity.records)if(r.kind==='identity_event'){
   const row=body(r);if(!Object.values(entities).includes(row.entity_kind as string))continue;const key=row.entity_kind+':'+row.entity_id,version=BigInt(row.entity_version as string),prior=latest.get(key);
   if(!prior||version>prior.version){require(typeof row.payload==='string');const p=parseHistoryJson(row.payload);object(p);object(p.after);latest.set(key,{version,after:normalized(p.after)});}
  }
  require(current.size===latest.size&&[...current].every(([k,row])=>latest.has(k)&&historyJsonEqual(row,latest.get(k)!.after)));
  const requiredActorIds=[...new Set([...configuration.requiredActorIds,...identity.requiredActorIds,...history.requiredActorIds])].sort();require(requiredActorIds.every(a=>profiles.has(a))&&history.requiredActorIds.every(a=>members.has(a)));
  return Object.freeze({formatVersion:1 as const,assurance:'internal_consistency_only' as const,generationId:configuration.generationId,configuration,identity,history,
   linkedConfigurationRows:identity.requiredConfigurationRows,requiredActorIds:Object.freeze(requiredActorIds),configurationCurrentRowsVerified:true as const,includedActorReferencesVerified:true as const,
   consistentCaptureProven:false as const,referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
 }catch{throw new BusinessConfigurationEvidenceError();}
}
