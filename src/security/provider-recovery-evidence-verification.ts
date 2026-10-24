import {createHash} from 'node:crypto';
import {parseEvidenceJson} from './provider-evidence-json.ts';
import {verifyProviderEvidenceCollection} from './provider-evidence-verification.ts';
import type {ProviderRecoveryEvidenceCollection} from './provider-evidence-collector.ts';

type Row=ProviderRecoveryEvidenceCollection['records'][number];
type Body=Record<string,unknown>;
export type VerifiedProviderRecoveryEvidence=Readonly<Omit<ProviderRecoveryEvidenceCollection,'assurance'>&{
  assurance:'internal_consistency_only';attempts:ReturnType<typeof verifyProviderEvidenceCollection>['attempts'];
}>;
export class ProviderRecoveryEvidenceError extends Error{
  constructor(){super('PROVIDER_RECOVERY_EVIDENCE_REVIEW_REQUIRED');this.name='ProviderRecoveryEvidenceError';}
}
const evidenceKinds=['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'] as const;
const referenceKinds=['session_identity','session_event','cleanup_reference'] as const;
const kinds:readonly string[]=[...evidenceKinds,...referenceKinds];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
const sessionFields=['id','actor_id','issued_security_epoch','created_at','authenticated_at','last_active_at','expires_at','revoked_at','trusted','reauth_at','version','created_by','updated_by','origin','operation_id'];
function require(value:unknown):asserts value{if(!value)throw new ProviderRecoveryEvidenceError();}
function object(v:unknown):asserts v is Body{require(v!==null&&typeof v==='object'&&!Array.isArray(v));}
function fields(v:unknown,names:readonly string[]):asserts v is Body{object(v);require(Object.keys(v).sort().join(',')===[...names].sort().join(','));}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.length<=max&&!v.includes('\0')&&Buffer.byteLength(v,'utf8')<=max&&Buffer.from(v,'utf8').toString('utf8')===v;}
function id(v:unknown):v is string{return typeof v==='string'&&uuid.test(v);}
function integer(v:unknown):bigint{
  require(typeof v==='bigint'||typeof v==='number'&&Number.isSafeInteger(v));const n=BigInt(v);require(n>=1n&&n<=9223372036854775807n);return n;
}
// Retain source offsets and microseconds; never compare truncated Date values.
function instant(v:unknown):bigint{
  require(typeof v==='string');const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(v);require(m);
  const wall=new Date(m[1]+'Z');require(Number.isFinite(wall.getTime())&&wall.getUTCFullYear()>=1&&wall.toISOString().slice(0,19)===m[1]);
  const time=Date.parse(m[1]!+m[3]!);require(Number.isFinite(time));return BigInt(time)*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
function utc(v:unknown):v is string{try{instant(v);return typeof v==='string'&&v.endsWith('+00:00');}catch{return false;}}
function sameTime(a:unknown,b:unknown){return a===null||b===null?a===b:instant(a)===instant(b);}
function session(v:unknown,mapping:Body):Body{
  fields(v,sessionFields);require(v.id===mapping.appSessionId&&v.actor_id===mapping.actorId&&v.issued_security_epoch===mapping.securityEpoch
    &&v.created_by===mapping.actorId&&id(v.updated_by)&&v.origin==='system'&&(v.operation_id===null||id(v.operation_id))&&typeof v.trusted==='boolean');integer(v.version);
  const created=instant(v.created_at),expires=instant(v.expires_at),active=instant(v.last_active_at);require(instant(v.authenticated_at)<=created&&active>=created&&active<expires
    &&expires>created&&expires-created<=BigInt(v.trusted?720:12)*3600000000n);
  if(v.revoked_at!==null)require(instant(v.revoked_at)>=created);if(v.reauth_at!==null)require(instant(v.reauth_at)>=created&&instant(v.reauth_at)<expires);return v;
}
function immutable(a:Body,b:Body){
  for(const k of ['id','actor_id','issued_security_epoch','trusted','created_by','origin'])require(a[k]===b[k]);
  for(const k of ['created_at','authenticated_at'])require(sameTime(a[k],b[k]));
}

// Pure offline consistency, not authentication, authorization or restore readiness.
export function verifyProviderRecoveryEvidenceCollection(serialized:unknown,expected:{actorId:string;issuer:string}):VerifiedProviderRecoveryEvidence{
  try{
    require(text(serialized,64*1024*1024));const actorId=expected.actorId.toLowerCase(),issuer=expected.issuer;require(id(actorId)&&text(issuer,2000)&&issuer.length>=1&&issuer.length<=500);
    const c=parseEvidenceJson(serialized,true);fields(c,['formatVersion','assurance','generationId','context','referenceContext','evidenceBytes','records']);
    require(c.formatVersion===2&&c.assurance==='snapshot_bytes_only'&&id(c.generationId)&&Array.isArray(c.records)&&c.records.length<=1000
      &&typeof c.evidenceBytes==='number'&&Number.isSafeInteger(c.evidenceBytes)&&c.evidenceBytes>=0&&c.evidenceBytes<=8*1024*1024);
    const ctx=c.referenceContext;fields(ctx,['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','ledgerCounts']);
    require(ctx.schemaVersion===1&&ctx.scope==='provider_session_references'&&ctx.actorId===actorId&&ctx.providerIssuer===issuer&&typeof ctx.snapshotToken==='string'&&hash.test(ctx.snapshotToken)&&utc(ctx.observedAt));fields(ctx.ledgerCounts,referenceKinds);
    const counts={} as Record<typeof referenceKinds[number],string>;
    for(const kind of referenceKinds){const n=ctx.ledgerCounts[kind];require(typeof n==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(n));counts[kind]=n;}
    const rows:Row[]=[],bodies=new Map<Row,Body>(),actual=Object.fromEntries(referenceKinds.map(k=>[k,0])) as Record<typeof referenceKinds[number],number>;
    let bytes=0,baseBytes=0,lastKind=-1,lastId='';
    for(const r of c.records){
      object(r);require(typeof r.kind==='string'&&kinds.includes(r.kind)&&id(r.recordId));const index=kinds.indexOf(r.kind),reference=index>=6;
      fields(r,reference?['kind','recordId','canonicalEvidence','evidenceHash','representation']:['kind','recordId','canonicalEvidence','evidenceHash']);
      require(index>=lastKind&&(index!==lastKind||r.recordId>lastId));lastKind=index;lastId=r.recordId;
      require(text(r.canonicalEvidence,r.kind==='inventory_observation'?262144:8192)&&r.canonicalEvidence.length>0&&typeof r.evidenceHash==='string'&&hash.test(r.evidenceHash)
        &&createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex')===r.evidenceHash);
      const length=Buffer.byteLength(r.canonicalEvidence,'utf8');bytes+=length;require(bytes<=8*1024*1024);if(!reference)baseBytes+=length;
      if(reference)require(r.representation===(r.kind==='session_event'?'stored_payload':'snapshot_projection'));
      const row=Object.freeze({...r}) as Row;rows.push(row);
      if(reference){const b=parseEvidenceJson(r.canonicalEvidence,true);object(b);bodies.set(row,b);actual[r.kind as typeof referenceKinds[number]]++;}
    }
    require(bytes===c.evidenceBytes);for(const kind of referenceKinds)require(String(actual[kind])===counts[kind]);
    const base=verifyProviderEvidenceCollection(JSON.stringify({formatVersion:1,assurance:c.assurance,generationId:c.generationId,context:c.context,evidenceBytes:baseBytes,records:rows.filter(r=>evidenceKinds.includes(r.kind as typeof evidenceKinds[number]))}),{actorId,issuer});
    const mappings=new Map<string,Body>(),providers=new Set<string>(),events=new Map<string,{row:Row;body:Body}>(),bySession=new Map<string,Body[]>(),references=new Map<string,{row:Row;body:Body}>(),referenceSessions=new Set<string>();
    for(const row of rows)if(row.kind==='session_identity'){
      const b=bodies.get(row)!;fields(b,['schemaVersion','appSessionId','actorId','providerIssuer','providerSessionId','securityEpoch']);
      require(b.schemaVersion===1&&b.appSessionId===row.recordId&&b.actorId===actorId&&b.providerIssuer===issuer&&id(b.providerSessionId)&&id(b.securityEpoch)&&!providers.has(b.providerSessionId));
      providers.add(b.providerSessionId);mappings.set(row.recordId,b);
    }
    for(const row of rows)if(row.kind==='session_event'){
      const b=bodies.get(row)!;fields(b,['schemaVersion','id','sessionId','actorId','createdBy','recordedAt','databasePrincipal','before','after']);
      require(b.schemaVersion===1&&b.id===row.recordId&&id(b.sessionId)&&b.actorId===actorId&&id(b.createdBy)&&text(b.databasePrincipal,63)&&b.databasePrincipal.length>0);instant(b.recordedAt);
      const mapping=mappings.get(b.sessionId);require(mapping);const after=session(b.after,mapping);require(b.createdBy===after.updated_by);
      if(b.before!==null){const before=session(b.before,mapping);immutable(before,after);require(integer(after.version)===integer(before.version)+1n&&instant(after.last_active_at)>=instant(before.last_active_at)
        &&instant(after.expires_at)<=instant(before.expires_at)&&before.revoked_at===null);
        if(before.reauth_at!==null)require(after.reauth_at!==null&&instant(after.reauth_at)>=instant(before.reauth_at));
      }
      const group=bySession.get(b.sessionId)??[];group.push(b);bySession.set(b.sessionId,group);events.set(row.recordId,{row,body:b});
    }
    for(const [sid,mapping] of mappings){
      const group=bySession.get(sid);require(group);const creates=group.filter(b=>b.before===null);require(creates.length===1);const creation=creates[0]!.after as Body;
      group.sort((a,b)=>integer((a.after as Body).version)<integer((b.after as Body).version)?-1:1);require(group[0]===creates[0]);
      for(let i=0;i<group.length;i++){const b=group[i]!,after=b.after as Body;immutable(creation,after);require(after.id===mapping.appSessionId);
        if(i){const prior=group[i-1]!.after as Body,before=b.before as Body;require(integer(prior.version)<=integer(before.version));for(const k of ['expires_at','revoked_at','reauth_at'])require(sameTime(prior[k],before[k]));require(instant(prior.last_active_at)<=instant(before.last_active_at));}
      }
    }
    for(const row of rows)if(row.kind==='cleanup_reference'){
      const b=bodies.get(row)!;fields(b,['schemaVersion','origin','referenceId','appSessionId','actorId','providerSessionId','securityEpoch','sourceVersion','revokedAt','sourceEventId','sourceEventHash','state','createdAt','createdBy','operationId']);
      require(b.schemaVersion===1&&b.origin==='system'&&b.referenceId===row.recordId&&b.actorId===actorId&&id(b.appSessionId)&&id(b.providerSessionId)&&id(b.securityEpoch)&&id(b.sourceEventId)
        &&typeof b.sourceEventHash==='string'&&hash.test(b.sourceEventHash)&&typeof b.sourceVersion==='string'&&/^[1-9][0-9]{0,18}$/.test(b.sourceVersion)
        &&integer(BigInt(b.sourceVersion))>1n&&b.state==='review_required'&&id(b.createdBy)&&(b.operationId===null||id(b.operationId))&&utc(b.createdAt)&&utc(b.revokedAt)&&instant(b.createdAt)>=instant(b.revokedAt)&&!referenceSessions.has(b.appSessionId));
      const mapping=mappings.get(b.appSessionId),source=events.get(b.sourceEventId);require(mapping&&source&&source.row.evidenceHash===b.sourceEventHash);
      require(mapping.providerSessionId===b.providerSessionId&&mapping.securityEpoch===b.securityEpoch&&source.body.sessionId===b.appSessionId&&source.body.createdBy===b.createdBy&&source.body.before!==null);
      const before=source.body.before as Body,after=source.body.after as Body;require(before.revoked_at===null&&after.revoked_at!==null&&sameTime(after.revoked_at,b.revokedAt)&&integer(after.version)===BigInt(b.sourceVersion)&&after.operation_id===b.operationId);
      referenceSessions.add(b.appSessionId);references.set(row.recordId,{row,body:b});
    }
    for(const [sid,group] of bySession)if(group.some(b=>b.before!==null&&(b.before as Body).revoked_at===null&&(b.after as Body).revoked_at!==null))require(referenceSessions.has(sid));
    for(const row of base.records)if(row.kind==='login_finish'||row.kind==='cleanup_request'){
      const b=parseEvidenceJson(row.canonicalEvidence);object(b);
      if(b.registrationEventId!==null){require(id(b.registrationEventId));const event=events.get(b.registrationEventId),mapping=typeof b.appSessionId==='string'?mappings.get(b.appSessionId):undefined;
        require(event&&mapping&&event.body.before===null&&event.body.sessionId===b.appSessionId&&mapping.providerSessionId===b.providerSessionId&&mapping.securityEpoch===b.securityEpoch&&(event.body.after as Body).operation_id===b.attemptId);
        if(b.localRevokedAt!==null)require(bySession.get(b.appSessionId as string)?.some(e=>(e.after as Body).revoked_at!==null&&sameTime((e.after as Body).revoked_at,b.localRevokedAt)));
      }
      if(row.kind==='cleanup_request'&&b.cleanupReferenceId!==null){require(id(b.cleanupReferenceId));const ref=references.get(b.cleanupReferenceId)?.body;require(ref&&ref.appSessionId===b.appSessionId&&ref.providerSessionId===b.providerSessionId&&ref.securityEpoch===b.securityEpoch&&sameTime(ref.revokedAt,b.localRevokedAt));}
    }
    return Object.freeze({formatVersion:2,assurance:'internal_consistency_only',generationId:c.generationId,context:base.context,
      referenceContext:Object.freeze({schemaVersion:1,scope:'provider_session_references',actorId,providerIssuer:issuer,snapshotToken:ctx.snapshotToken,observedAt:ctx.observedAt,ledgerCounts:Object.freeze(counts)}),
      evidenceBytes:bytes,records:Object.freeze(rows),attempts:base.attempts});
  }catch{throw new ProviderRecoveryEvidenceError();}
}
