import {createHash} from 'node:crypto';
import {parseHistoryJson, historyJsonEqual, historyJsonInteger, historyJsonNumber} from './history-evidence-json.ts';

type Body = Record<string, unknown>;
const kinds = ['actor','role_capability','identity_event'] as const;
type Kind = typeof kinds[number];
const entityFields = {
  actors:['id','kind','display_label','system_key','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
  role_capabilities:['id','role','capability','created_at','created_by','origin','operation_id','import_row_id'],
  businesses:['id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
  memberships:['id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
  business_recovery_authorities:['id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
} as const;
type Entity = keyof typeof entityFields;
const eventFields = ['id','business_id','created_at','created_by','origin','operation_id','import_row_id','entity_kind','entity_id','entity_version','action','database_principal','payload','event_hash'];
const payloadFields = ['schemaVersion','id','businessId','createdBy','recordedAt','operationId','entityKind','entityId','entityVersion','action','databasePrincipal','before','after'];
const mutable = new Set(['display_label','current_security_epoch','disabled_at','legal_name','currency','timezone','status','active','active_epoch','writes_enabled','incident_id','version','updated_at','updated_by','operation_id']);
const capabilities = ['crm.manage','export.bulk','finance.post','identity.manage','identity.read'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export class BusinessIdentityEvidenceError extends Error {
  constructor() { super('BUSINESS_IDENTITY_EVIDENCE_REVIEW_REQUIRED'); this.name = 'BusinessIdentityEvidenceError'; }
}
function require(value: unknown): asserts value { if (!value) throw new BusinessIdentityEvidenceError(); }
function object(value: unknown): asserts value is Body {
  require(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype));
}
function fields(value: unknown, names: readonly string[]): asserts value is Body {
  object(value); require(Object.keys(value).length === names.length && names.every(k=>Object.hasOwn(value,k)));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && Buffer.byteLength(value,'utf8') <= max
    && !value.includes('\0') && Buffer.from(value,'utf8').toString('utf8') === value;
}
function id(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
function nullableId(value: unknown) { require(value === null || id(value)); }
function label(value: unknown, max: number) {
  require(text(value,max*4)); const length = [...value.replace(/^ +| +$/g,'')].length; require(length >= 1 && length <= max);
}
function version(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function digest(value: string) { return createHash('sha256').update(value,'utf8').digest('hex'); }
// Bounded ISO PostgreSQL spellings, including original offsets and microseconds.
// Date is used only to validate whole calendar seconds, never fractional equality.
function instant(value: unknown, projection = false): bigint {
  require(typeof value === 'string');
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|([+-])(\d\d):(\d\d)(?::(\d\d))?)$/.exec(value);
  require(m && Number(m[1]) >= 1 && (!projection || m[8] === '+00:00'));
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  require(Number.isFinite(date.getTime()) && date.toISOString().slice(0,19) === value.slice(0,19));
  const hours=Number(m[10]??0), minutes=Number(m[11]??0), seconds=Number(m[12]??0);
  require(hours<=15 && minutes<=59 && seconds<=59);
  const offset=BigInt((hours*3600+minutes*60+seconds)*(m[9]==='-'?-1:1));
  return BigInt(date.getTime())*1000n + BigInt((m[7]??'').padEnd(6,'0')) - offset*1000000n;
}
function normalized(row: Body, projection = false): Body {
  const result={...row};
  for(const key of ['created_at','updated_at','disabled_at'])if(Object.hasOwn(row,key)&&row[key]!==null)result[key]=instant(row[key],projection);
  if(projection && Object.hasOwn(row,'version')){require(version(row.version));result.version=parseHistoryJson(row.version);}
  return result;
}
function sourceRow(row: unknown, kind: Entity, businessId: string, actors: Set<string>, projection = false): asserts row is Body {
  fields(row,entityFields[kind]); require(id(row.id) && id(row.created_by)); actors.add(row.created_by);
  require(typeof row.origin==='string' && ['manual','import','system'].includes(row.origin)); nullableId(row.operation_id);nullableId(row.import_row_id);
  instant(row.created_at,projection);
  if(kind!=='role_capabilities'){
    require(id(row.updated_by));actors.add(row.updated_by);instant(row.updated_at,projection);
    if(projection)require(version(row.version));
    // Original numeric versions are checked against the exact event version
    // (and predecessor) by event(), without JavaScript Number coercion.
  }
  switch(kind){
    case 'actors':
      label(row.display_label,200);require(id(row.current_security_epoch));if(row.disabled_at!==null)instant(row.disabled_at,projection);
      if(row.kind==='system')require(typeof row.system_key==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(row.system_key) && row.auth_provider_issuer===null && row.auth_user_id===null);
      else {require(row.kind==='owner' && row.system_key===null);label(row.auth_provider_issuer,500);label(row.auth_user_id,255);}
      break;
    case 'role_capabilities':require(row.role==='owner' && typeof row.capability==='string' && capabilities.includes(row.capability) && row.origin==='system');break;
    case 'businesses':require(row.id===businessId && row.currency==='USD' && ['setup','active','suspended'].includes(row.status as string));label(row.legal_name,200);require(text(row.timezone,400) && [...row.timezone].length>=1 && [...row.timezone].length<=100);break;
    case 'memberships':require(row.business_id===businessId && id(row.actor_id) && row.role==='owner' && typeof row.active==='boolean');actors.add(row.actor_id);break;
    case 'business_recovery_authorities':require(row.business_id===businessId && id(row.active_epoch) && typeof row.writes_enabled==='boolean');nullableId(row.incident_id);break;
  }
}
type Event = {row:Body; kind:Entity; after:Body; before:Body|null; version:bigint};
function event(row: Body, businessId: string, actors: Set<string>): Event {
  fields(row,eventFields);
  require(id(row.id) && id(row.entity_id) && id(row.created_by) && row.origin==='system' && row.import_row_id===null
    && version(row.entity_version) && (row.action==='INSERT'||row.action==='UPDATE')
    && text(row.database_principal,63) && row.database_principal.length>=1);
  nullableId(row.operation_id);actors.add(row.created_by);const stamp=instant(row.created_at,true);
  require(typeof row.entity_kind==='string' && Object.hasOwn(entityFields,row.entity_kind));const kind=row.entity_kind as Entity;
  require(row.business_id===(kind==='actors'||kind==='role_capabilities'?null:businessId));
  require(text(row.payload,65536) && typeof row.event_hash==='string' && hash.test(row.event_hash) && digest(row.payload)===row.event_hash);
  const p=parseHistoryJson(row.payload);fields(p,payloadFields);
  require(historyJsonNumber(p.schemaVersion,1) && instant(p.recordedAt)===stamp);
  for(const [a,b] of [['id','id'],['businessId','business_id'],['createdBy','created_by'],['operationId','operation_id'],['entityKind','entity_kind'],['entityId','entity_id'],['action','action'],['databasePrincipal','database_principal']] as const)require(p[a]===row[b]);
  const v=BigInt(row.entity_version);require(historyJsonEqual(p.entityVersion,parseHistoryJson(row.entity_version)));
  sourceRow(p.after,kind,businessId,actors);const after=p.after;
  require(after.id===row.entity_id && after.operation_id===row.operation_id && (after.updated_by??after.created_by)===row.created_by
    && (kind==='role_capabilities'?v===1n:historyJsonEqual(after.version,p.entityVersion)));
  if(row.action==='INSERT')require(p.before===null);
  else {
    require(kind!=='role_capabilities' && v>1n);sourceRow(p.before,kind,businessId,actors);
    require(historyJsonEqual(p.before.version,parseHistoryJson(String(v-1n))));
    const a=normalized(after),b=normalized(p.before);
    for(const key of entityFields[kind])if(!mutable.has(key))require(historyJsonEqual(a[key],b[key]));
  }
  return {row,kind,after:normalized(after),before:p.before===null?null:normalized(p.before as Body),version:v};
}

// Pure offline, bounded internal consistency. Claimed counts/snapshot metadata
// and unkeyed hashes cannot prove capture authenticity, source completeness,
// current authorization, tenant membership, a complete export or recoverability.
export function verifyBusinessIdentityEvidence(serialized: unknown, expected: {businessId:string}) {
  try {
    require(text(serialized,64*1024*1024));const businessId=expected.businessId.toLowerCase();require(id(businessId));
    const c=parseHistoryJson(serialized);fields(c,['formatVersion','assurance','generationId','context','evidenceBytes','records']);
    const declared=historyJsonInteger(c.evidenceBytes);
    require(historyJsonNumber(c.formatVersion,1) && c.assurance==='snapshot_bytes_only' && id(c.generationId)
      && declared!==undefined && declared>=0 && declared<=8*1024*1024 && Array.isArray(c.records) && c.records.length<=10000);
    const ctx=c.context;fields(ctx,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts']);
    require(historyJsonNumber(ctx.schemaVersion,1) && ctx.scope==='business_identity' && ctx.businessId===businessId && typeof ctx.snapshotToken==='string' && hash.test(ctx.snapshotToken));instant(ctx.observedAt,true);
    fields(ctx.recordCounts,kinds);const counts={} as Record<Kind,string>;
    for(const kind of kinds){const n=ctx.recordCounts[kind];require(typeof n==='string' && /^(0|[1-9][0-9]{0,4})$/.test(n) && BigInt(n)<=BigInt(kind==='actor'?1000:kind==='role_capability'?5:10000));counts[kind]=n;}
    const current=new Map<string,{kind:Entity;row:Body}>(),chains=new Map<string,Event[]>(),requiredActors=new Set<string>(),catalog:string[]=[];
    const scopedOperators=new Set<string>(),members=new Set<string>(),owners=new Set<string>();
    const records:Readonly<{kind:Kind;recordId:string;representation:'snapshot_projection';canonicalEvidence:string;evidenceHash:string}>[]=[];
    const seen={actor:0,role_capability:0,identity_event:0};let bytes=0,lastKind=-1,lastId='';
    for(const r of c.records){
      fields(r,['kind','recordId','representation','canonicalEvidence','evidenceHash']);
      require(typeof r.kind==='string' && kinds.includes(r.kind as Kind) && id(r.recordId) && r.representation==='snapshot_projection');const kind=r.kind as Kind,index=kinds.indexOf(kind);
      require(index>=lastKind && (index!==lastKind||r.recordId>lastId));lastKind=index;lastId=r.recordId;
      require(text(r.canonicalEvidence,kind==='identity_event'?262144:16384) && typeof r.evidenceHash==='string' && hash.test(r.evidenceHash) && digest(r.canonicalEvidence)===r.evidenceHash);
      bytes+=Buffer.byteLength(r.canonicalEvidence,'utf8');require(bytes<=8*1024*1024);
      const b=parseHistoryJson(r.canonicalEvidence);fields(b,['schemaVersion','kind','businessId','jsonTextColumns','row']);
      require(historyJsonNumber(b.schemaVersion,1) && b.kind===kind && b.businessId===businessId && JSON.stringify(b.jsonTextColumns)===JSON.stringify(kind==='identity_event'?['payload']:[]));
      object(b.row);require(b.row.id===r.recordId);seen[kind]++;
      if(kind==='identity_event'){
        const e=event(b.row,businessId,requiredActors),key=e.kind+':'+e.row.entity_id;
        const chain=chains.get(key)??[];chain.push(e);chains.set(key,chain);
        if(e.row.business_id!==null){scopedOperators.add(e.row.created_by as string);for(const source of [e.before,e.after])if(source)for(const field of ['created_by','updated_by'])scopedOperators.add(source[field] as string);}
      }else{
        const entity=kind==='actor'?'actors':'role_capabilities';sourceRow(b.row,entity,businessId,requiredActors,true);
        current.set(entity+':'+r.recordId,{kind:entity,row:normalized(b.row,true)});if(kind==='role_capability')catalog.push(b.row.capability as string);
        if(kind==='actor' && b.row.kind==='owner')owners.add(r.recordId);
      }
      records.push(Object.freeze({kind,recordId:r.recordId,representation:'snapshot_projection',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash}));
    }
    require(bytes===declared && kinds.every(k=>String(seen[k])===counts[k]) && seen.actor>=1 && catalog.sort().join(',')===capabilities.join(','));
    const configuration:Readonly<{entityKind:Entity;recordId:string;entityVersion:string}>[]=[];let roots=0,recovery=0,memberships=0;
    for(const [key,chain] of chains){
      chain.sort((a,b)=>a.version<b.version?-1:a.version>b.version?1:0);let previous:Event|undefined;
      for(const e of chain){require(previous?e.row.action==='UPDATE' && e.version===previous.version+1n && historyJsonEqual(e.before,previous.after):e.row.action==='INSERT');previous=e;}
      const last=previous!;
      if(last.kind==='actors'||last.kind==='role_capabilities'){
        const source=current.get(key);require(source && historyJsonEqual(last.after,source.row));current.delete(key);
      }else{
        if(last.kind==='businesses')roots++;else if(last.kind==='business_recovery_authorities')recovery++;else {memberships++;require(!members.has(last.after.actor_id as string) && owners.has(last.after.actor_id as string));members.add(last.after.actor_id as string);}
        configuration.push(Object.freeze({entityKind:last.kind,recordId:last.row.entity_id as string,entityVersion:String(last.version)}));
      }
    }
    require(current.size===0 && roots===1 && recovery===1 && memberships>=1 && [...scopedOperators].every(a=>members.has(a)));
    const actorIds=new Set(records.filter(r=>r.kind==='actor').map(r=>r.recordId));require([...requiredActors].every(a=>actorIds.has(a)));
    configuration.sort((a,b)=>a.entityKind<b.entityKind?-1:a.entityKind>b.entityKind?1:a.recordId<b.recordId?-1:1);
    return Object.freeze({formatVersion:1 as const,assurance:'internal_consistency_only' as const,generationId:c.generationId,
      context:Object.freeze({schemaVersion:1 as const,scope:'business_identity' as const,businessId,snapshotToken:ctx.snapshotToken,observedAt:ctx.observedAt as string,recordCounts:Object.freeze(counts)}),
      evidenceBytes:bytes,records:Object.freeze(records),requiredActorIds:Object.freeze([...requiredActors].sort()),
      requiredConfigurationRows:Object.freeze(configuration),configurationCurrentRowsVerified:false as const,referenceClosureComplete:false as const,
      completePortableExport:false as const,completeBackup:false as const});
  }catch{throw new BusinessIdentityEvidenceError();}
}
