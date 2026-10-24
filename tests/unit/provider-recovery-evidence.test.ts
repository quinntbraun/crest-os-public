import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {verifyProviderRecoveryEvidenceCollection as verify} from '../../src/security/provider-recovery-evidence-verification.ts';
import {recoveryFixture,change,digest,encode,type RecoveryFixture} from '../support/provider-recovery-fixture.ts';
const error='PROVIDER_RECOVERY_EVIDENCE_REVIEW_REQUIRED';
const reject=(f:RecoveryFixture)=>expect(()=>verify(encode(f),f.expected)).toThrow(error);
it('verifies all nine groups and explicit source links while returning immutable original text',()=>{
 const f=recoveryFixture(),r=verify(encode(f),f.expected);expect(r.records).toEqual(f.collection.records);expect(r.attempts).toEqual([{attemptId:f.start.recordId,missingKinds:[]}]);expect(r.assurance).toBe('internal_consistency_only');
 for(const v of [r,r.context,r.context.ledgerCounts,r.referenceContext,r.referenceContext.ledgerCounts,r.records,...r.records,r.attempts,...r.attempts])expect(Object.isFrozen(v)).toBe(true);
 change(f.mapping,{providerSessionId:randomUUID()});expect(r.records.find(x=>x.kind==='session_identity')?.canonicalEvidence).not.toBe(f.mapping.canonicalEvidence);expect(r).not.toHaveProperty('ready');
});
it('accepts legacy untracked sessions and an explicit empty scope without invented login facts',()=>{
 const f=recoveryFixture(false);expect(verify(encode(f),f.expected).attempts).toEqual([]);f.collection.records=[];expect(verify(encode(f),f.expected).records).toEqual([]);
});
it('retains original missing phases despite later registration and revocation evidence',()=>{
 const f=recoveryFixture();f.collection.records=f.collection.records.filter(r=>['login_attempt','login_target','session_identity','session_event','cleanup_reference'].includes(r.kind));expect(verify(encode(f),f.expected).attempts[0]?.missingKinds).toEqual(['registration_finish','stop','request','outcome']);
});
it('does not backfill a null historical registration from a later source event',()=>{
 const f=recoveryFixture();f.collection.records=f.collection.records.filter(r=>r!==f.closed&&r!==f.request&&r!==f.outcome);change(f.stop,{registrationEventId:null,providerSessionId:null,localRevokedAt:null});const r=verify(encode(f),f.expected);expect(r.attempts[0]?.missingKinds).toContain('registration_finish');expect(r.records.find(x=>x.recordId===f.stop.recordId)?.canonicalEvidence).toBe(f.stop.canonicalEvidence);
});
it('preserves exact bigint event versions without rounding original JSON integer lexemes',()=>{
 const f=recoveryFixture(false);for(const r of [f.created,f.stoppedEvent]){r.canonicalEvidence=r.canonicalEvidence.replace(/"version": 1/g,'"version": 9007199254740993').replace(/"version": 2/g,'"version": 9007199254740994');r.evidenceHash=digest(r.canonicalEvidence);}change(f.reference,{sourceVersion:'9007199254740994',sourceEventHash:f.stoppedEvent.evidenceHash});expect(verify(encode(f),f.expected).records).toEqual(f.collection.records);change(f.reference,{sourceVersion:'9007199254740995'});reject(f);
});
it('accepts unrecorded activity-version gaps without fabricating security history',()=>{
 const f=recoveryFixture(false),b=JSON.parse(f.stoppedEvent.canonicalEvidence);b.before.version=5;b.after.version=6;change(f.stoppedEvent,b);change(f.reference,{sourceVersion:'6',sourceEventHash:f.stoppedEvent.evidenceHash});expect(verify(encode(f),f.expected).records).toHaveLength(4);
});
it('compares equivalent original timezone offsets and microseconds without replacing strings',()=>{
 const f=recoveryFixture(false);const b=JSON.parse(f.stoppedEvent.canonicalEvidence);b.after.revoked_at='2026-10-23T07:00:00.000010-05:00';change(f.stoppedEvent,b);change(f.reference,{sourceEventHash:f.stoppedEvent.evidenceHash});expect(verify(encode(f),f.expected).records).toEqual(f.collection.records);change(f.reference,{revokedAt:'2026-10-23T12:00:00.000011+00:00'});reject(f);
});
it.each(['schemaVersion','appSessionId','actorId','providerIssuer','providerSessionId','securityEpoch','extra'])('rejects a rehashed bad session mapping %s',key=>{const f=recoveryFixture();change(f.mapping,{[key]:key==='schemaVersion'?2:'invalid'});reject(f);});
it.each(['schemaVersion','id','sessionId','actorId','createdBy','recordedAt','databasePrincipal','extra'])('rejects a rehashed bad event field %s',key=>{const f=recoveryFixture();change(f.created,{[key]:key==='schemaVersion'?2:key==='databasePrincipal'?'':'invalid'});reject(f);});
it.each(['id','actor_id','issued_security_epoch','created_at','authenticated_at','last_active_at','expires_at','revoked_at','trusted','reauth_at','version','created_by','updated_by','origin','operation_id','extra'])('rejects a rehashed bad session snapshot field %s',key=>{
 const f=recoveryFixture();const b=JSON.parse(f.created.canonicalEvidence);b.after[key]='invalid';change(f.created,b);reject(f);
});
it.each(['schemaVersion','origin','referenceId','appSessionId','actorId','providerSessionId','securityEpoch','sourceVersion','revokedAt','sourceEventId','sourceEventHash','state','createdAt','createdBy','operationId','extra'])('rejects a rehashed bad cleanup reference %s',key=>{const f=recoveryFixture();change(f.reference,{[key]:key==='schemaVersion'?2:'invalid'});reject(f);});
it.each(['mapping','created','stoppedEvent','reference'] as const)('rejects a missing included source %s rather than silently downgrading the collection',key=>{const f=recoveryFixture();f.collection.records=f.collection.records.filter(r=>r!==f[key]);reject(f);});
it.each(['representation','hash','id','kind','extra','duplicate'])('rejects malformed envelope %s',key=>{const f=recoveryFixture();if(key==='representation')f.created.representation='snapshot_projection';if(key==='hash')f.created.evidenceHash='0'.repeat(64);if(key==='id')f.created.recordId=randomUUID();if(key==='kind')f.created.kind='unknown';if(key==='extra')Object.assign(f.created,{secret:'synthetic'});if(key==='duplicate')f.collection.records.push({...f.created});reject(f);});
it.each(['providerSessionId','securityEpoch'])('rejects contradictory but well-formed immutable mapping %s',key=>{const f=recoveryFixture();change(f.mapping,{[key]:randomUUID()});reject(f);});
it('rejects contradictory event versions and immutable before/after fields',()=>{
 for(const patch of [{version:3},{created_by:randomUUID()},{trusted:true},{created_at:'2026-10-23T11:00:00+00:00'},{expires_at:'2026-10-23T14:00:00+00:00'},{last_active_at:'2026-10-23T11:00:00+00:00'}]){const f=recoveryFixture();const b=JSON.parse(f.stoppedEvent.canonicalEvidence);Object.assign(b.after,patch);change(f.stoppedEvent,b);change(f.reference,{sourceEventHash:f.stoppedEvent.evidenceHash});reject(f);}
});
it('rejects registration events that reference another valid session mapping',()=>{const f=recoveryFixture(),wrong=randomUUID();change(f.closed,{registrationEventId:wrong});change(f.stop,{registrationEventId:wrong});change(f.request,{registrationEventId:wrong,sourceFinishHash:f.stop.evidenceHash});change(f.outcome,{requestHash:f.request.evidenceHash});reject(f);});
it('rejects a cleanup request with a different well-formed source reference',()=>{const f=recoveryFixture();change(f.request,{cleanupReferenceId:randomUUID()});change(f.outcome,{requestHash:f.request.evidenceHash});reject(f);});
it('rejects a contradicted stop revocation instant even when no cleanup request was captured',()=>{const f=recoveryFixture();f.collection.records=f.collection.records.filter(r=>r!==f.request&&r!==f.outcome);change(f.stop,{localRevokedAt:'2026-10-23T12:00:00.000011+00:00'});reject(f);});
it('preserves an initially revoked legacy session without inventing a later cleanup reference',()=>{const f=recoveryFixture(false,false),b=JSON.parse(f.created.canonicalEvidence);b.after.revoked_at=f.revocation;change(f.created,b);expect(verify(encode(f),f.expected).referenceContext.ledgerCounts.cleanup_reference).toBe('0');});
it.each(['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','ledgerCounts','extra'])('rejects bad reference context %s',key=>{const f=recoveryFixture(),c=JSON.parse(encode(f));c.referenceContext[key]=key==='schemaVersion'?2:'invalid';expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['formatVersion','assurance','generationId','context','evidenceBytes','records','extra'])('rejects malformed outer field %s',key=>{const f=recoveryFixture(),c=JSON.parse(encode(f));c[key]='invalid';expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['01','-1','1001','1.0','9007199254740993'])('rejects malformed or contradicted counts %s',value=>{const f=recoveryFixture(),c=JSON.parse(encode(f));c.referenceContext.ledgerCounts.session_event=value;expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['1e30','9007199254740993.0','9223372036854775808','0','-1'])('rejects an unsafe or invalid version lexeme %s',value=>{const f=recoveryFixture(false,false);f.created.canonicalEvidence=f.created.canonicalEvidence.replace('"version": 1','"version": '+value);f.created.evidenceHash=digest(f.created.canonicalEvidence);reject(f);});
it('rejects duplicate decoded names in source bodies and the enclosing collection',()=>{
 const f=recoveryFixture();f.mapping.canonicalEvidence=f.mapping.canonicalEvidence.replace('"schemaVersion": 1','"schemaVersion": 1,"schema\\u0056ersion":1');f.mapping.evidenceHash=digest(f.mapping.canonicalEvidence);reject(f);const g=recoveryFixture(),s=encode(g).replace('"formatVersion":2','"formatVersion":2,"formatVersion":2');expect(()=>verify(s,g.expected)).toThrow(error);
});
it('rejects malformed Unicode, deep or oversized envelopes without leaking the original input in errors',()=>{
 const f=recoveryFixture();for(const s of ['\ufeff'+encode(f),'['.repeat(8)+'0'+']'.repeat(8),encode(f)+'\0','x'.repeat(64*1024*1024+1)]){try{verify(s,f.expected);throw new Error('expected failure');}catch(e){expect((e as Error).message).toBe(error);expect((e as Error).cause).toBeUndefined();}}
});
it('rejects reordered cross-scope rows and source byte-total mismatches',()=>{const f=recoveryFixture(),c=JSON.parse(encode(f));c.records.reverse();expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);const d=JSON.parse(encode(f));d.evidenceBytes++;expect(()=>verify(JSON.stringify(d),f.expected)).toThrow(error);});
it('binds the caller scope and preserves the assurance limit for a self-consistent omitted lifecycle',()=>{
 const f=recoveryFixture();for(const expected of [{...f.expected,actorId:randomUUID()},{...f.expected,issuer:'https://other.example.com/auth/v1'}])expect(()=>verify(encode(f),expected)).toThrow(error);
 f.collection.records=[];const r=verify(encode(f),f.expected);expect(r.assurance).toBe('internal_consistency_only');expect(r.attempts).toEqual([]);expect(r).not.toHaveProperty('authenticatedSnapshot');
});
