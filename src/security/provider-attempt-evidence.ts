import {createHash} from 'node:crypto';

const kinds=['start','target','registration_finish','stop','request','outcome'] as const;
type Kind=typeof kinds[number];
type Expected=Readonly<{actorId:string;issuer:string;attemptId:string}>;
type RecordBytes=Readonly<{kind:Kind;canonicalEvidence:string;evidenceHash:string}>;
export type VerifiedAttemptEvidence=Readonly<{
  formatVersion:1;assurance:'internal_consistency_only';actorId:string;providerIssuer:string;attemptId:string;
  records:readonly RecordBytes[];missingKinds:readonly Kind[];
}>;
export class AttemptEvidenceError extends Error{
  constructor(){super('PROVIDER_ATTEMPT_EVIDENCE_REVIEW_REQUIRED');this.name='AttemptEvidenceError';}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
function require(value:unknown):asserts value{if(!value)throw new AttemptEvidenceError();}
function wellFormed(value:string):boolean{return !value.includes('\0')&&Buffer.from(value,'utf8').toString('utf8')===value;}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.length<=max&&wellFormed(value)&&Buffer.byteLength(value,'utf8')<=max;}
function id(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function hash(value:unknown):value is string{return typeof value==='string'&&digest.test(value);}
function utc(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(value))return false;
  const date=new Date(value);return Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1&&date.toISOString().slice(0,19)===value.slice(0,19);
}
function instantKey(value:string):string{return value.slice(0,19)+'.'+(value.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0');}
// The header, record envelopes and these ledger schema1 bodies are flat JSON
// objects. Parse JSON normally, then reject non-scalars and duplicate names,
// including escaped spellings. Never normalize/reserialize original evidence.
function flat(source:string):Record<string,unknown>{
  const value:unknown=JSON.parse(source);
  require(value!==null&&typeof value==='object'&&!Array.isArray(value));
  const object=value as Record<string,unknown>;require(Object.keys(object).length<=20);
  require(Object.values(object).every(v=>v===null||typeof v==='string'&&wellFormed(v)||typeof v==='number'||typeof v==='boolean'));
  const names=new Set<string>();
  for(const match of source.matchAll(/"(?:[^"\\]|\\.)*"/g)){
    if(!/^\s*:/.test(source.slice(match.index+match[0].length)))continue;
    const name:string=JSON.parse(match[0]);require(!names.has(name));names.add(name);
  }
  require(names.size===Object.keys(object).length);return object;
}
function keys(value:Record<string,unknown>,names:string[]){require(Object.keys(value).sort().join(',')===[...names].sort().join(','));}
const common=['schemaVersion','origin','actorId','securityEpoch','providerIssuer','providerSubject','appSessionId','createdAt','databasePrincipal'];
const fields:Record<Kind,string[]>={
  start:['attemptId'],target:['attemptId','providerSessionId','passwordAt','accessExpiresAt'],
  registration_finish:['attemptId','finishId','phase','providerSessionId','registrationEventId','localRevokedAt'],
  stop:['attemptId','finishId','phase','providerSessionId','registrationEventId','localRevokedAt'],
  request:['attemptId','requestId','sourceFinishId','sourceFinishHash','targetHash','providerSessionId','registrationEventId','cleanupReferenceId','localRevokedAt','state'],
  outcome:['requestId','requestHash','providerSessionId','sourceFinishId','outcome'],
};
function body(kind:Kind,source:string,binding:Expected):Record<string,unknown>{
  const e=flat(source);keys(e,[...common,...fields[kind]]);
  require(e.schemaVersion===1&&e.origin==='system'&&e.actorId===binding.actorId&&e.providerIssuer===binding.issuer);
  for(const key of ['actorId','securityEpoch','providerSubject','appSessionId',...fields[kind].filter(k=>k.endsWith('Id'))]){
    require(e[key]===null&&['providerSessionId','registrationEventId','cleanupReferenceId'].includes(key)&&['registration_finish','stop','request'].includes(kind)||id(e[key]));
  }
  if(kind!=='outcome')require(e.attemptId===binding.attemptId);
  require(utc(e.createdAt)&&text(e.databasePrincipal,63)&&Buffer.byteLength(e.databasePrincipal,'utf8')>0);
  if(kind==='target')require(utc(e.passwordAt)&&utc(e.accessExpiresAt)&&instantKey(e.accessExpiresAt)>instantKey(e.passwordAt));
  if(kind==='registration_finish'||kind==='stop'){
    require(e.phase===(kind==='stop'?'stopped_review':'registration_closed'));
    require(e.localRevokedAt===null||utc(e.localRevokedAt));
    if(kind==='registration_finish')require(id(e.registrationEventId)&&id(e.providerSessionId));
    if(kind==='stop')require(e.registrationEventId===null?e.localRevokedAt===null:id(e.providerSessionId)&&utc(e.localRevokedAt));
  }
  if(kind==='request'){
    require(e.state==='pending_review'&&hash(e.sourceFinishHash)&&hash(e.targetHash)&&id(e.providerSessionId));
    require(e.registrationEventId===null?e.cleanupReferenceId===null&&e.localRevokedAt===null:id(e.cleanupReferenceId)&&utc(e.localRevokedAt));
  }
  if(kind==='outcome')require(hash(e.requestHash)&&(e.outcome==='provider_removed'||e.outcome==='provider_absent_observed'));
  return e;
}

// Offline consistency only. Hashes and claimed principals are not signatures,
// completeness, current absence, provider identity attestation or authority.
export function verifyProviderAttemptEvidence(serialized:unknown,expected:Expected):VerifiedAttemptEvidence{
  try{
    require(text(serialized,131072));
    require(typeof expected.actorId==='string'&&typeof expected.attemptId==='string');
    const binding={actorId:expected.actorId.toLowerCase(),attemptId:expected.attemptId.toLowerCase(),issuer:expected.issuer};
    require(id(binding.actorId)&&id(binding.attemptId)&&text(binding.issuer,2000)&&binding.issuer.length>=1&&[...binding.issuer].length<=500);
    const lines=serialized.split('\n');if(lines.at(-1)==='')lines.pop();require(lines.length>=2&&lines.length<=7);
    const header=flat(lines[0]!);keys(header,['format','formatVersion','actorId','providerIssuer','attemptId']);
    require(header.format==='crest-provider-attempt-evidence'&&header.formatVersion===1&&header.actorId===binding.actorId&&header.providerIssuer===binding.issuer&&header.attemptId===binding.attemptId);
    const records=new Map<Kind,RecordBytes>(),bodies=new Map<Kind,Record<string,unknown>>();
    for(let index=1;index<lines.length;index++){
      const row=flat(lines[index]!);keys(row,['kind','canonicalEvidence','evidenceHash']);
      require(typeof row.kind==='string'&&kinds.includes(row.kind as Kind)&&text(row.canonicalEvidence,8192)&&hash(row.evidenceHash));
      const kind=row.kind as Kind;require(!records.has(kind));
      require(createHash('sha256').update(row.canonicalEvidence,'utf8').digest('hex')===row.evidenceHash);
      bodies.set(kind,body(kind,row.canonicalEvidence,binding));
      records.set(kind,Object.freeze({kind,canonicalEvidence:row.canonicalEvidence,evidenceHash:row.evidenceHash}));
    }
    const start=bodies.get('start');require(start);
    for(const e of bodies.values())for(const key of ['actorId','securityEpoch','providerIssuer','providerSubject','appSessionId'])require(e[key]===start[key]);
    const target=bodies.get('target'),closed=bodies.get('registration_finish'),stop=bodies.get('stop'),request=bodies.get('request'),outcome=bodies.get('outcome');
    if(target)for(const e of [closed,stop,request,outcome])if(e?.providerSessionId!==undefined&&e.providerSessionId!==null)require(e.providerSessionId===target.providerSessionId);
    if(closed&&stop)require(closed.finishId!==stop.finishId&&closed.registrationEventId===stop.registrationEventId);
    if(request){
      require(target&&stop&&request.sourceFinishId===stop.finishId&&request.sourceFinishHash===records.get('stop')!.evidenceHash&&request.targetHash===records.get('target')!.evidenceHash);
      // A stop can precede late target evidence and retain null original fields.
      if(stop.registrationEventId!==null)require(stop.registrationEventId===request.registrationEventId);
    }
    if(outcome)require(request&&outcome.requestId===request.requestId&&outcome.requestHash===records.get('request')!.evidenceHash&&outcome.sourceFinishId===request.sourceFinishId);
    return Object.freeze({formatVersion:1,assurance:'internal_consistency_only',actorId:binding.actorId,providerIssuer:binding.issuer,attemptId:binding.attemptId,
      records:Object.freeze(kinds.flatMap(k=>records.has(k)?[records.get(k)!]:[])),missingKinds:Object.freeze(kinds.filter(k=>!records.has(k)))});
  }catch{throw new AttemptEvidenceError();}
}
