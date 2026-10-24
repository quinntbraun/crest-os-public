import {createHash} from 'node:crypto';
import {parseHistoryJson,historyJsonBigint,historyJsonInteger,historyJsonNumber} from './history-evidence-json.ts';
import {verifyProviderRecoveryEvidenceCollection} from './provider-recovery-evidence-verification.ts';

type Body=Record<string,unknown>;
type Expected={actorId:string;issuer:string};
const columns=['id','actor_id','provider_session_id','issued_security_epoch','created_at','authenticated_at','last_active_at','expires_at','revoked_at','trusted','reauth_at','version','updated_at','created_by','updated_by','origin','operation_id'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
export class SessionMetadataEvidenceError extends Error{
  constructor(){super('SESSION_METADATA_EVIDENCE_REVIEW_REQUIRED');this.name='SessionMetadataEvidenceError';}
}
function require(v:unknown):asserts v{if(!v)throw new SessionMetadataEvidenceError();}
function object(v:unknown):asserts v is Body{require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===null||Object.getPrototypeOf(v)===Object.prototype));}
function fields(v:unknown,names:readonly string[]):asserts v is Body{object(v);require(Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k)));}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.length<=max&&Buffer.byteLength(v,'utf8')<=max&&!v.includes('\0')&&Buffer.from(v,'utf8').toString('utf8')===v;}
function id(v:unknown):v is string{return typeof v==='string'&&uuid.test(v);}
function version(v:unknown):bigint{require(typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v));const n=BigInt(v);require(n<=9223372036854775807n);return n;}
function originalVersion(v:unknown):bigint{const n=historyJsonBigint(v);require(n!==undefined&&n>0n);return n;}
function instant(v:unknown,utc=false):bigint{
  require(typeof v==='string');const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|([+-])(\d\d):(\d\d)(?::(\d\d))?)$/.exec(v);
  require(m&&(!utc||m[3]==='+00:00'));const d=new Date(m[1]+'Z');require(Number.isFinite(d.getTime())&&d.getUTCFullYear()>=1&&d.toISOString().slice(0,19)===m[1]);
  const h=Number(m[5]??0),min=Number(m[6]??0),s=Number(m[7]??0);require(h<=15&&min<=59&&s<=59);
  return BigInt(d.getTime())*1000n+BigInt((m[2]??'').padEnd(6,'0'))-BigInt((h*3600+min*60+s)*(m[4]==='-'?-1:1))*1000000n;
}
function sameTime(a:unknown,b:unknown){return a===null||b===null?a===b:instant(a)===instant(b);}
function digest(s:string){return createHash('sha256').update(s,'utf8').digest('hex');}
function scope(expected:Expected){const actorId=expected.actorId.toLowerCase(),issuer=expected.issuer;require(id(actorId)&&text(issuer,2000));const length=[...issuer.replace(/^ +| +$/g,'')].length;require(length>=1&&length<=500);return {actorId,issuer};}
function state(row:unknown,actorId:string,actors:Set<string>):asserts row is Body{
  fields(row,columns);require(id(row.id)&&row.actor_id===actorId&&id(row.provider_session_id)&&id(row.issued_security_epoch)
    &&row.created_by===actorId&&id(row.updated_by)&&row.origin==='system'&&(row.operation_id===null||id(row.operation_id))&&typeof row.trusted==='boolean');
  actors.add(actorId);actors.add(row.updated_by);version(row.version);
  const created=instant(row.created_at,true),expires=instant(row.expires_at,true),active=instant(row.last_active_at,true);
  require(instant(row.authenticated_at,true)<=created&&active>=created&&active<expires&&expires>created&&expires-created<=BigInt(row.trusted?720:12)*3600000000n);
  instant(row.updated_at,true);
  if(row.revoked_at!==null)require(instant(row.revoked_at,true)>=created);
  if(row.reauth_at!==null)require(instant(row.reauth_at,true)>=created&&instant(row.reauth_at,true)<expires);
}

// Pure bounded validation. Metadata counts/hashes are unkeyed claims, not
// authentic capture, current eligibility, a complete export or a usable backup.
export function verifySessionMetadataEvidence(serialized:unknown,expected:Expected){
  try{
    require(text(serialized,64*1024*1024));const {actorId,issuer}=scope(expected),c=parseHistoryJson(serialized);
    fields(c,['formatVersion','assurance','generationId','context','evidenceBytes','records']);const declared=historyJsonInteger(c.evidenceBytes);
    require(historyJsonNumber(c.formatVersion,1)&&c.assurance==='snapshot_bytes_only'&&id(c.generationId)&&declared!==undefined&&declared>=0&&declared<=8*1024*1024&&Array.isArray(c.records)&&c.records.length<=1000);
    const ctx=c.context;fields(ctx,['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','recordCount']);
    require(historyJsonNumber(ctx.schemaVersion,1)&&ctx.scope==='application_session_metadata'&&ctx.actorId===actorId&&ctx.providerIssuer===issuer&&typeof ctx.snapshotToken==='string'&&hash.test(ctx.snapshotToken)
      &&typeof ctx.recordCount==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(ctx.recordCount)&&BigInt(ctx.recordCount)<=1000n);instant(ctx.observedAt,true);
    const records:Readonly<{kind:'session_metadata';recordId:string;representation:'snapshot_projection';canonicalEvidence:string;evidenceHash:string}>[]=[],providers=new Set<string>(),actors=new Set<string>();let bytes=0,previous='';
    for(const r of c.records){
      fields(r,['kind','recordId','representation','canonicalEvidence','evidenceHash']);require(r.kind==='session_metadata'&&id(r.recordId)&&r.recordId>previous&&r.representation==='snapshot_projection');previous=r.recordId;
      require(text(r.canonicalEvidence,8192)&&typeof r.evidenceHash==='string'&&hash.test(r.evidenceHash)&&digest(r.canonicalEvidence)===r.evidenceHash);bytes+=Buffer.byteLength(r.canonicalEvidence,'utf8');require(bytes<=8*1024*1024);
      const b=parseHistoryJson(r.canonicalEvidence);fields(b,['schemaVersion','scope','actorId','providerIssuer','jsonTextColumns','row']);
      require(historyJsonNumber(b.schemaVersion,1)&&b.scope==='application_session_metadata'&&b.actorId===actorId&&b.providerIssuer===issuer&&Array.isArray(b.jsonTextColumns)&&b.jsonTextColumns.length===0);
      state(b.row,actorId,actors);require(b.row.id===r.recordId&&!providers.has(b.row.provider_session_id as string));providers.add(b.row.provider_session_id as string);
      records.push(Object.freeze({kind:'session_metadata',recordId:r.recordId,representation:'snapshot_projection',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash}));
    }
    require(bytes===declared&&String(records.length)===ctx.recordCount);
    return Object.freeze({formatVersion:1 as const,assurance:'internal_consistency_only' as const,generationId:c.generationId,
      context:Object.freeze({schemaVersion:1 as const,scope:'application_session_metadata' as const,actorId,providerIssuer:issuer,snapshotToken:ctx.snapshotToken,observedAt:ctx.observedAt as string,recordCount:ctx.recordCount}),
      evidenceBytes:bytes,records:Object.freeze(records),requiredActorIds:Object.freeze([...actors].sort()),referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  }catch{throw new SessionMetadataEvidenceError();}
}

// Strengthen numeric admission for this consumer without altering legacy
// provider parsers/verifiers. Every numeric token must be an exact signed64
// integer, including nested inventory fields and original source versions.
function exactNumbers(value:unknown):void{
  if(value===null||typeof value!=='object')return;
  if(Array.isArray(value)){for(const v of value)exactNumbers(v);return;}
  if(Object.getPrototypeOf(value)===null){for(const v of Object.values(value))exactNumbers(v);return;}
  require(historyJsonBigint(value)!==undefined);
}
function sourceRow(r:{canonicalEvidence:string}):Body{const b=parseHistoryJson(r.canonicalEvidence);object(b);return b;}
function immutable(current:Body,original:Body){
  for(const k of ['id','actor_id','issued_security_epoch','trusted','created_by','origin'])require(current[k]===original[k]);
  for(const k of ['created_at','authenticated_at'])require(sameTime(current[k],original[k]));
}

// A matching generation UUID and consistent links do not prove one database
// snapshot. An authorized owned collector and authenticated private custody
// remain mandatory before a complete-export or restore claim.
export function verifySessionRecoveryEvidence(metadataSerialized:unknown,providerSerialized:unknown,expected:Expected){
  try{
    require(text(metadataSerialized,64*1024*1024)&&text(providerSerialized,64*1024*1024)&&Buffer.byteLength(metadataSerialized)+Buffer.byteLength(providerSerialized)<=64*1024*1024);
    const metadata=verifySessionMetadataEvidence(metadataSerialized,expected),raw=parseHistoryJson(providerSerialized);exactNumbers(raw);object(raw);require(Array.isArray(raw.records)&&raw.records.length+metadata.records.length<=1000);
    for(const r of raw.records){object(r);require(text(r.canonicalEvidence,262144));exactNumbers(parseHistoryJson(r.canonicalEvidence));}
    const provider=verifyProviderRecoveryEvidenceCollection(providerSerialized,expected);
    require(provider.generationId===metadata.generationId&&provider.evidenceBytes+metadata.evidenceBytes<=8*1024*1024);
    const rows=new Map<string,Body>(),mappings=new Map<string,Body>(),latest=new Map<string,Body>(),actors=new Set(metadata.requiredActorIds);
    for(const r of metadata.records){const b=sourceRow(r);object(b.row);rows.set(r.recordId,b.row);}
    for(const r of provider.records){
      const b=sourceRow(r);
      if(r.kind==='session_identity')mappings.set(r.recordId,b);
      if(r.kind==='session_event'){
        require(id(b.createdBy));actors.add(b.createdBy);object(b.after);require(id(b.after.updated_by));actors.add(b.after.updated_by);
        if(b.before!==null){object(b.before);require(id(b.before.updated_by));actors.add(b.before.updated_by);}
        const prior=latest.get(b.sessionId as string);if(!prior||originalVersion(b.after.version)>originalVersion(prior.version))latest.set(b.sessionId as string,b.after);
      }
    }
    require(rows.size===mappings.size);
    for(const [sid,current] of rows){
      const mapping=mappings.get(sid),last=latest.get(sid);require(mapping&&last&&mapping.providerSessionId===current.provider_session_id&&mapping.securityEpoch===current.issued_security_epoch);
      immutable(current,last);const now=version(current.version),then=originalVersion(last.version);require(now>=then);
      for(const k of ['expires_at','revoked_at','reauth_at'])require(sameTime(current[k],last[k]));
      require(instant(current.last_active_at)>=instant(last.last_active_at));
      if(now===then||last.revoked_at!==null)require(sameTime(current.last_active_at,last.last_active_at));
      if(now===then)require(current.updated_by===last.updated_by&&current.operation_id===last.operation_id);
    }
    return Object.freeze({formatVersion:1 as const,assurance:'internal_consistency_only' as const,generationId:metadata.generationId,metadata,provider,
      linkedSessionIds:Object.freeze([...rows.keys()].sort()),requiredActorIds:Object.freeze([...actors].sort()),consistentCaptureProven:false as const,
      referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  }catch{throw new SessionMetadataEvidenceError();}
}
