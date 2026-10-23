import {createHash,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {verifyProviderAttemptEvidence} from '../../src/security/provider-attempt-evidence.ts';

type Row={kind:string;canonicalEvidence:string;evidenceHash:string};
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture(){
  const actorId=randomUUID(),attemptId=randomUUID(),issuer='https://auth.example.com/auth/v1',appSessionId=randomUUID(),providerSessionId=randomUUID(),event=randomUUID(),finish=randomUUID(),stopped=randomUUID(),requestId=randomUUID();
  const expected={actorId,issuer,attemptId},header={format:'crest-provider-attempt-evidence',formatVersion:1,actorId,providerIssuer:issuer,attemptId};
  const common={schemaVersion:1,origin:'system',actorId,securityEpoch:randomUUID(),providerIssuer:issuer,providerSubject:randomUUID(),appSessionId,createdAt:'2026-10-23T10:00:00.123456+00:00',databasePrincipal:'synthetic_probe'};
  const rows:Row[]=[];
  const add=(kind:string,extras:Record<string,unknown>)=>{const canonicalEvidence=JSON.stringify({...common,...extras},null,1);rows.push({kind,canonicalEvidence,evidenceHash:hash(canonicalEvidence)});};
  add('start',{attemptId});add('target',{attemptId,providerSessionId,passwordAt:'2026-10-23T10:00:00+00:00',accessExpiresAt:'2026-10-23T11:00:00+00:00'});
  add('registration_finish',{attemptId,finishId:finish,phase:'registration_closed',providerSessionId,registrationEventId:event,localRevokedAt:null});
  add('stop',{attemptId,finishId:stopped,phase:'stopped_review',providerSessionId,registrationEventId:event,localRevokedAt:common.createdAt});
  add('request',{attemptId,requestId,sourceFinishId:stopped,sourceFinishHash:rows[3]!.evidenceHash,targetHash:rows[1]!.evidenceHash,providerSessionId,registrationEventId:event,cleanupReferenceId:randomUUID(),localRevokedAt:common.createdAt,state:'pending_review'});
  add('outcome',{requestId,requestHash:rows[4]!.evidenceHash,providerSessionId,sourceFinishId:stopped,outcome:'provider_removed'});
  return {expected,header,rows};
}
function encode(f:ReturnType<typeof fixture>,rows=f.rows){return [JSON.stringify(f.header),...rows.map(r=>JSON.stringify(r))].join('\n')+'\n';}
function change(row:Row,changes:Record<string,unknown>){row.canonicalEvidence=JSON.stringify({...JSON.parse(row.canonicalEvidence),...changes});row.evidenceHash=hash(row.canonicalEvidence);}
const reject=(data:unknown,expected:ReturnType<typeof fixture>['expected'])=>expect(()=>verifyProviderAttemptEvidence(data,expected)).toThrow('PROVIDER_ATTEMPT_EVIDENCE_REVIEW_REQUIRED');

it('verifies original bytes and all included hash links without replacing the source serialization',()=>{
  const f=fixture(),r=verifyProviderAttemptEvidence(encode(f),f.expected);expect(r.assurance).toBe('internal_consistency_only');expect(r.missingKinds).toEqual([]);expect(r.records).toEqual(f.rows);expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.records)).toBe(true);expect(Object.isFrozen(r.records[0])).toBe(true);
  expect(r.records[0]!.canonicalEvidence).not.toBe(JSON.stringify(JSON.parse(r.records[0]!.canonicalEvidence)));f.rows[0]!.canonicalEvidence='changed';expect(r.records[0]!.canonicalEvidence).not.toBe('changed');
});
it('reports omitted kinds explicitly for a start-only fragment',()=>{const f=fixture(),r=verifyProviderAttemptEvidence(encode(f,f.rows.slice(0,1)),f.expected);expect(r.missingKinds).toEqual(['target','registration_finish','stop','request','outcome']);});
it('preserves both finish phases and distinguishes observed absence',()=>{const f=fixture();change(f.rows[5]!,{outcome:'provider_absent_observed'});const r=verifyProviderAttemptEvidence(encode(f),f.expected);expect(JSON.parse(r.records[5]!.canonicalEvidence).outcome).toBe('provider_absent_observed');expect(r.records.filter(r=>r.kind==='registration_finish'||r.kind==='stop')).toHaveLength(2);});
it('accepts arbitrary record order and CRLF framing without changing canonical bytes',()=>{const f=fixture();expect(verifyProviderAttemptEvidence(encode(f,[...f.rows].reverse()).replaceAll('\n','\r\n'),f.expected).records).toEqual(f.rows);});
it('accepts a stopped unknown target while reporting the missing target',()=>{const f=fixture();change(f.rows[3]!,{providerSessionId:null,registrationEventId:null,localRevokedAt:null});const r=verifyProviderAttemptEvidence(encode(f,[f.rows[0]!,f.rows[3]!]),f.expected);expect(r.missingKinds).toContain('target');});
it('accepts a late target without rewriting the original unknown stop',()=>{
  const f=fixture();change(f.rows[3]!,{providerSessionId:null,registrationEventId:null,localRevokedAt:null});change(f.rows[4]!,{sourceFinishHash:f.rows[3]!.evidenceHash,registrationEventId:null,cleanupReferenceId:null,localRevokedAt:null});change(f.rows[5]!,{requestHash:f.rows[4]!.evidenceHash});
  expect(verifyProviderAttemptEvidence(encode(f,f.rows.filter(r=>r.kind!=='registration_finish')),f.expected).missingKinds).toEqual(['registration_finish']);
});
it('normalizes only the separately supplied expected UUIDs',()=>{const f=fixture();expect(verifyProviderAttemptEvidence(encode(f),{...f.expected,actorId:f.expected.actorId.toUpperCase(),attemptId:f.expected.attemptId.toUpperCase()}).records).toEqual(f.rows);});
it.each([undefined,null,{},[],true,1,'','{}','\n','x'.repeat(131073),'\ud800'])('rejects invalid or oversized framing %#',value=>{reject(value,fixture().expected);});
it.each(['actorId','issuer','attemptId'])('rejects a different configured %s',key=>{const f=fixture();reject(encode(f),{...f.expected,[key]:key==='issuer'?'https://other.example.com':randomUUID()});});
it.each(['format','formatVersion','actorId','providerIssuer','attemptId','extra'])('rejects invalid header field %s',key=>{const f=fixture();Object.assign(f.header,{[key]:key==='formatVersion'?2:'changed'});reject(encode(f),f.expected);});
it.each(['start','target','stop','request'])('rejects missing required included-source %s',kind=>{const f=fixture();reject(encode(f,f.rows.filter(r=>r.kind!==kind)),f.expected);});
it('rejects duplicate record kinds and too many record lines',()=>{const f=fixture();reject(encode(f,[f.rows[0]!,f.rows[0]!]),f.expected);reject(encode(f,[...f.rows,f.rows[0]!]),f.expected);});
it.each(['blank-line','truncated','trailing-garbage','extra-final-line'])('rejects malformed file framing %s',mode=>{const f=fixture(),s=encode(f);reject(mode==='blank-line'?s.replace('\n','\n\n'):mode==='truncated'?s.slice(0,-30):mode==='trailing-garbage'?s+'x':s+'\n',f.expected);});
it.each(['hash','bytes','extra','kind','array-hash'])('rejects invalid record envelope %s',mode=>{
  const f=fixture(),r=f.rows[0]!;if(mode==='hash')r.evidenceHash='0'.repeat(64);if(mode==='bytes')r.canonicalEvidence+=' ';if(mode==='extra')Object.assign(r,{evidence:{secret:'hidden'}});if(mode==='kind')r.kind='provider_secret';if(mode==='array-hash')Object.assign(r,{evidenceHash:[r.evidenceHash]});reject(encode(f),f.expected);
});
it.each(['actorId','securityEpoch','providerSubject','appSessionId','attemptId','providerIssuer'])('rejects a rehashed source with a conflicting %s',key=>{const f=fixture();change(f.rows[1]!,{[key]:key==='providerIssuer'?'https://other.example.com':randomUUID()});reject(encode(f),f.expected);});
it.each(['sourceFinishId','sourceFinishHash','targetHash','providerSessionId','registrationEventId','state','cleanupReferenceId','localRevokedAt'])('rejects a rehashed inconsistent request %s',key=>{
  const f=fixture();change(f.rows[4]!,{[key]:key.endsWith('Hash')?'0'.repeat(64):key==='state'?'complete':key==='localRevokedAt'||key==='cleanupReferenceId'?null:randomUUID()});change(f.rows[5]!,{requestHash:f.rows[4]!.evidenceHash});reject(encode(f),f.expected);
});
it.each(['requestId','requestHash','sourceFinishId','providerSessionId','outcome'])('rejects a rehashed inconsistent outcome %s',key=>{const f=fixture();change(f.rows[5]!,{[key]:key==='requestHash'?'0'.repeat(64):key==='outcome'?['provider_removed']:randomUUID()});reject(encode(f),f.expected);});
it.each(['phase','finishId','providerSessionId','registrationEventId','localRevokedAt'])('rejects an invalid registration finish %s',key=>{const f=fixture();change(f.rows[2]!,{[key]:key==='phase'?'stopped_review':key==='localRevokedAt'?'2026-02-31T10:00:00+00:00':null});reject(encode(f),f.expected);});
it('rejects two phases claiming the same finish primary key',()=>{const f=fixture();change(f.rows[2]!,{finishId:JSON.parse(f.rows[3]!.canonicalEvidence).finishId});reject(encode(f),f.expected);});
it.each([{schemaVersion:2},{origin:'manual'},{databasePrincipal:''},{databasePrincipal:'x'.repeat(64)},{databasePrincipal:'\ud800'},{accessToken:'never export'},{createdAt:'2026-02-31T10:00:00+00:00'},{createdAt:'2026-10-23T10:00:00Z'}])('rejects unsupported or unsafe source fields %#',changes=>{const f=fixture();change(f.rows[0]!,changes);reject(encode(f),f.expected);});
it.each(['passwordAt','accessExpiresAt'])('rejects invalid target time %s',key=>{const f=fixture();change(f.rows[1]!,{[key]:key==='passwordAt'?'invalid':'2026-10-23T09:00:00+00:00'});reject(encode(f),f.expected);});
it('rejects oversized canonical bodies even if the file and digest are valid',()=>{const f=fixture();f.rows[0]!.canonicalEvidence=' '.repeat(8193)+f.rows[0]!.canonicalEvidence;f.rows[0]!.evidenceHash=hash(f.rows[0]!.canonicalEvidence);reject(encode(f),f.expected);});
it('rejects duplicate JSON header names including escaped spellings',()=>{const f=fixture(),s=encode(f);reject(s.replace('"formatVersion":1','"formatVersion":2,"formatVersion":1'),f.expected);reject(s.replace('"formatVersion":1',String.raw`"formatVersion":2,"format\u0056ersion":1`),f.expected);});
it('rejects rehashed duplicate source JSON names including escaped spellings',()=>{const f=fixture(),r=f.rows[0]!;r.canonicalEvidence=r.canonicalEvidence.replace('"origin": "system"',String.raw`"origin":"manual","\u006frigin":"system"`);r.evidenceHash=hash(r.canonicalEvidence);reject(encode(f),f.expected);});
it('rejects duplicate envelope names while allowing colon-like escaped content inside strings',()=>{const f=fixture();const s=encode(f);reject(s.replace('"kind":"start"','"kind":"target","kind":"start"'),f.expected);change(f.rows[0]!,{databasePrincipal:'quote "key":\\value'});expect(verifyProviderAttemptEvidence(encode(f,f.rows.slice(0,1)),f.expected).records).toEqual(f.rows.slice(0,1));});
it('returns fixed errors without exposing file contents or parser diagnostics',()=>{const error=(()=>{try{return verifyProviderAttemptEvidence('{private token secret',fixture().expected);}catch(e){return e;}})();expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('PROVIDER_ATTEMPT_EVIDENCE_REVIEW_REQUIRED');expect((error as Error&{cause?:unknown}).cause).toBeUndefined();});

it.each(['missing-revocation','missing-registration','different-registration'])('rejects contradictory included stop registration facts: %s',mode=>{
 const f=fixture();change(f.rows[3]!,mode==='missing-revocation'?{localRevokedAt:null}:mode==='missing-registration'?{registrationEventId:null}:{registrationEventId:randomUUID()});change(f.rows[4]!,{sourceFinishHash:f.rows[3]!.evidenceHash,...(mode==='different-registration'?{registrationEventId:JSON.parse(f.rows[3]!.canonicalEvidence).registrationEventId}:{})});change(f.rows[5]!,{requestHash:f.rows[4]!.evidenceHash});reject(encode(f),f.expected);
});

it('preserves valid sub-millisecond target ordering without rounding away microseconds',()=>{const f=fixture();change(f.rows[1]!,{passwordAt:'2026-10-23T10:00:00.123456+00:00',accessExpiresAt:'2026-10-23T10:00:00.123457+00:00'});expect(verifyProviderAttemptEvidence(encode(f,f.rows.slice(0,2)),f.expected).records).toEqual(f.rows.slice(0,2));});
it.each(['2026-10-23T10:00:00.123455+00:00','2026-10-23T10:00:00.123456+00:00'])('rejects reversed or equal microsecond target ranges: %s',accessExpiresAt=>{const f=fixture();change(f.rows[1]!,{passwordAt:'2026-10-23T10:00:00.123456+00:00',accessExpiresAt});reject(encode(f,f.rows.slice(0,2)),f.expected);});
