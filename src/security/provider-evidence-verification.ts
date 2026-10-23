import {createHash} from 'node:crypto';
import {verifyProviderAttemptEvidence} from './provider-attempt-evidence.ts';
import type {ProviderEvidenceCollection} from './provider-evidence-collector.ts';

type Row=ProviderEvidenceCollection['records'][number];
type Kind=Row['kind'];
type Attempt=Readonly<{attemptId:string;missingKinds:ReturnType<typeof verifyProviderAttemptEvidence>['missingKinds']}>;
export type VerifiedProviderEvidence=Readonly<Omit<ProviderEvidenceCollection,'assurance'>&{
  assurance:'internal_consistency_only';attempts:readonly Attempt[];
}>;
export class ProviderEvidenceVerificationError extends Error{
  constructor(){super('PROVIDER_EVIDENCE_VERIFICATION_REVIEW_REQUIRED');this.name='ProviderEvidenceVerificationError';}
}
const kinds:readonly Kind[]=['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
function require(value:unknown):asserts value{if(!value)throw new ProviderEvidenceVerificationError();}
function object(value:unknown):asserts value is Record<string,unknown>{require(value!==null&&typeof value==='object'&&!Array.isArray(value));}
function fields(value:unknown,names:string[]):asserts value is Record<string,unknown>{object(value);require(Object.keys(value).sort().join(',')===[...names].sort().join(','));}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.length<=max&&!value.includes('\0')&&Buffer.byteLength(value,'utf8')<=max&&Buffer.from(value,'utf8').toString('utf8')===value;}
function id(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function utc(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(value))return false;
  const d=new Date(value);return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=1&&d.toISOString().slice(0,19)===value.slice(0,19);
}
function instant(value:string){return value.slice(0,19)+'.'+(value.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0');}

// Bounded JSON grammar, with duplicate decoded names rejected in every object.
// Decode individual scalar tokens with JSON.parse; never reserialize evidence.
function parse(source:string):unknown{
  const maxText=Buffer.byteLength(source,'utf8');let at=0,nodes=0;
  const space=()=>{while(at<source.length&&' \t\r\n'.includes(source[at]!))at++;};
  function string():string{
    require(source[at]==='"');const start=at++;
    while(at<source.length){
      const c=source.charCodeAt(at++);
      if(c===34){const value:unknown=JSON.parse(source.slice(start,at));require(typeof value==='string'&&text(value,maxText));return value;}
      require(c>=32);
      if(c===92){const escape=source[at++];require(escape!==undefined&&'"\\/bfnrtu'.includes(escape));if(escape==='u'){require(/^[a-fA-F0-9]{4}$/.test(source.slice(at,at+4)));at+=4;}}
    }
    throw new ProviderEvidenceVerificationError();
  }
  function value(depth:number):unknown{
    space();require(++nodes<=10000&&depth<=4);const c=source[at];
    if(c==='"')return string();
    if(c==='{'){
      at++;space();const result:Record<string,unknown>=Object.create(null),names=new Set<string>();
      if(source[at]==='}'){at++;return result;}
      for(;;){space();const name=string();require(!names.has(name)&&names.size<32);names.add(name);space();require(source[at++]===':');result[name]=value(depth+1);space();const next=source[at++];if(next==='}')return result;require(next===',');}
    }
    if(c==='['){
      at++;space();const result:unknown[]=[];if(source[at]===']'){at++;return result;}
      for(;;){require(result.length<1000);result.push(value(depth+1));space();const next=source[at++];if(next===']')return result;require(next===',');}
    }
    for(const [token,decoded] of [['null',null],['true',true],['false',false]] as const)if(source.startsWith(token,at)){at+=token.length;return decoded;}
    const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;number.lastIndex=at;const match=number.exec(source);require(match);at=number.lastIndex;
    const decoded:unknown=JSON.parse(match[0]);require(typeof decoded==='number'&&Number.isFinite(decoded));return decoded;
  }
  const result=value(0);space();require(at===source.length);return result;
}

function inventory(e:Record<string,unknown>,actorId:string,issuer:string){
  fields(e,['schemaVersion','origin','requestId','actorId','providerIssuer','afterSessionId','pageSize','observedAt','recordedAt','databasePrincipal','observationCount','lastSessionId','observations']);
  require(e.schemaVersion===1&&e.origin==='system'&&e.actorId===actorId&&e.providerIssuer===issuer&&id(e.requestId)
    &&(e.afterSessionId===null||id(e.afterSessionId))&&Number.isInteger(e.pageSize)&&Number(e.pageSize)>=1&&Number(e.pageSize)<=100
    &&utc(e.observedAt)&&utc(e.recordedAt)&&instant(e.recordedAt)>=instant(e.observedAt)
    &&text(e.databasePrincipal,63)&&e.databasePrincipal.length>0&&Array.isArray(e.observations)&&e.observations.length<=Number(e.pageSize)
    &&e.observationCount===e.observations.length);
  let after=e.afterSessionId as string|null;
  for(const o of e.observations){
    fields(o,['provider_session_id','app_session_id','cleanup_reference_id','provider_aal','provider_not_after','provider_unexpired','local_revoked_at','local_expires_at','local_epoch_current','actor_disabled','observed_at','classification']);
    require(id(o.provider_session_id)&&(after===null||o.provider_session_id>after));after=o.provider_session_id;
    require((o.app_session_id===null||id(o.app_session_id))&&(o.cleanup_reference_id===null||id(o.cleanup_reference_id))
      &&(o.provider_aal===null||typeof o.provider_aal==='string'&&['aal1','aal2','aal3'].includes(o.provider_aal))
      &&(o.provider_not_after===null||o.provider_not_after==='infinity'||o.provider_not_after==='-infinity'||utc(o.provider_not_after))
      &&(o.local_revoked_at===null||utc(o.local_revoked_at))&&(o.local_expires_at===null||utc(o.local_expires_at))
      &&typeof o.provider_unexpired==='boolean'&&typeof o.actor_disabled==='boolean'&&o.observed_at===e.observedAt);
    require(o.app_session_id===null?o.cleanup_reference_id===null&&o.local_revoked_at===null&&o.local_expires_at===null&&o.local_epoch_current===null
      :utc(o.local_expires_at)&&typeof o.local_epoch_current==='boolean');
    const unexpired=o.provider_not_after===null||utc(o.provider_not_after)&&instant(o.provider_not_after)>instant(e.observedAt);
    require(o.provider_unexpired===unexpired);
    const classification=o.local_revoked_at!==null?'local_revocation_review':o.app_session_id===null?'unregistered_review'
      :o.actor_disabled||o.local_epoch_current!==true||instant(o.local_expires_at as string)<=instant(e.observedAt)||!unexpired||o.provider_aal!=='aal2'?'registered_review':'registered_observed';
    require(o.classification===classification);
  }
  require(e.lastSessionId===(e.observations.length?after:null));
}

// Offline consistency of the claimed collection. No database/provider access,
// credentials, file I/O, authenticity/absence/restore or snapshot attestation.
export function verifyProviderEvidenceCollection(serialized:unknown,expected:{actorId:string;issuer:string}):VerifiedProviderEvidence{
  try{
    require(text(serialized,64*1024*1024));const actorId=expected.actorId.toLowerCase(),issuer=expected.issuer;
    require(id(actorId)&&text(issuer,2000)&&issuer.length>=1&&issuer.length<=500);
    const c=parse(serialized);fields(c,['formatVersion','assurance','generationId','context','evidenceBytes','records']);
    require(c.formatVersion===1&&c.assurance==='snapshot_bytes_only'&&id(c.generationId)&&Array.isArray(c.records)&&c.records.length<=1000
      &&typeof c.evidenceBytes==='number'&&Number.isInteger(c.evidenceBytes)&&c.evidenceBytes>=0&&c.evidenceBytes<=8*1024*1024);
    const ctx=c.context;fields(ctx,['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','ledgerCounts']);
    require(ctx.schemaVersion===1&&ctx.scope==='retained_provider_ledgers'&&ctx.actorId===actorId&&ctx.providerIssuer===issuer
      &&typeof ctx.snapshotToken==='string'&&digest.test(ctx.snapshotToken)&&utc(ctx.observedAt));fields(ctx.ledgerCounts,[...kinds]);
    const counts={} as Record<Kind,string>;let declared=0;
    for(const kind of kinds){const n=ctx.ledgerCounts[kind];require(typeof n==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(n));declared+=Number(n);counts[kind]=n;}
    require(declared===c.records.length);
    const rows:Row[]=[],bodies=new Map<Row,Record<string,unknown>>(),actual=Object.fromEntries(kinds.map(k=>[k,0])) as Record<Kind,number>;
    let lastKind=-1,lastId='',bytes=0;
    for(const r of c.records){
      fields(r,['kind','recordId','canonicalEvidence','evidenceHash']);require(typeof r.kind==='string'&&kinds.includes(r.kind as Kind)&&id(r.recordId));
      const kind=r.kind as Kind,index=kinds.indexOf(kind);require(index>=lastKind&&(index!==lastKind||r.recordId>lastId));lastKind=index;lastId=r.recordId;
      require(text(r.canonicalEvidence,kind==='inventory_observation'?262144:8192)&&r.canonicalEvidence.length>0&&typeof r.evidenceHash==='string'&&digest.test(r.evidenceHash));
      bytes+=Buffer.byteLength(r.canonicalEvidence,'utf8');require(bytes<=8*1024*1024&&createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex')===r.evidenceHash);
      const body=parse(r.canonicalEvidence);object(body);const key=kind==='login_attempt'||kind==='login_target'?'attemptId':kind==='login_finish'?'finishId':'requestId';require(body[key]===r.recordId);
      const row=Object.freeze({kind,recordId:r.recordId,canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash});rows.push(row);bodies.set(row,body);actual[kind]++;
      if(kind==='inventory_observation')inventory(body,actorId,issuer);
    }
    require(bytes===c.evidenceBytes);for(const kind of kinds)require(String(actual[kind])===counts[kind]);
    const groups=new Map<string,Row[]>(),requests=new Map<string,Row>(),sessions=new Set<unknown>(),targets=new Set<unknown>();
    for(const r of rows)if(r.kind==='login_attempt'){const e=bodies.get(r)!;require(id(e.attemptId)&&id(e.appSessionId)&&!sessions.has(e.appSessionId));sessions.add(e.appSessionId);groups.set(e.attemptId,[r]);}
    for(const r of rows)if(r.kind!=='inventory_observation'&&r.kind!=='login_attempt'&&r.kind!=='cleanup_outcome'){
      const e=bodies.get(r)!,group=typeof e.attemptId==='string'?groups.get(e.attemptId):undefined;require(group);group.push(r);
      if(r.kind==='login_target'){require(!targets.has(e.providerSessionId));targets.add(e.providerSessionId);}
      if(r.kind==='cleanup_request')requests.set(r.recordId,r);
    }
    for(const r of rows)if(r.kind==='cleanup_outcome'){const req=requests.get(r.recordId);require(req);const e=bodies.get(req)!;groups.get(e.attemptId as string)!.push(r);}
    const attempts:Attempt[]=[];
    for(const [attemptId,group] of groups){
      const fragment=group.map(r=>({kind:r.kind==='login_attempt'?'start':r.kind==='login_target'?'target':r.kind==='login_finish'?(bodies.get(r)!.phase==='registration_closed'?'registration_finish':'stop'):r.kind==='cleanup_request'?'request':'outcome',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash}));
      const header={format:'crest-provider-attempt-evidence',formatVersion:1,actorId,providerIssuer:issuer,attemptId};
      const verified=verifyProviderAttemptEvidence([JSON.stringify(header),...fragment.map(r=>JSON.stringify(r))].join('\n'),{actorId,issuer,attemptId});
      let provider:unknown=null,revoked:unknown=null;
      for(const r of group){const e=bodies.get(r)!;if(e.providerSessionId!==undefined&&e.providerSessionId!==null){require(provider===null||provider===e.providerSessionId);provider=e.providerSessionId;}if(e.localRevokedAt!==undefined&&e.localRevokedAt!==null){require(revoked===null||revoked===instant(e.localRevokedAt as string));revoked=instant(e.localRevokedAt as string);}}
      attempts.push(Object.freeze({attemptId,missingKinds:verified.missingKinds}));
    }
    return Object.freeze({formatVersion:1,assurance:'internal_consistency_only',generationId:c.generationId,
      context:Object.freeze({schemaVersion:1,scope:'retained_provider_ledgers',actorId,providerIssuer:issuer,snapshotToken:ctx.snapshotToken,observedAt:ctx.observedAt,ledgerCounts:Object.freeze(counts)}),
      evidenceBytes:bytes,records:Object.freeze(rows),attempts:Object.freeze(attempts)});
  }catch{throw new ProviderEvidenceVerificationError();}
}
