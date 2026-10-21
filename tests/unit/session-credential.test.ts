import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createSessionCredential,sessionCredentialHash,SessionCredentialError} from '../../src/security/session-credential.ts';
import {createSessionRevoker} from '../../src/security/session-revocation-db.ts';

describe('opaque session credential material',()=>{
  it('uses 32 random bytes and hashes the canonical cookie value with standard SHA256',()=>{
    const a=createSessionCredential(),b=createSessionCredential(),value=a.cookieValueForResponse();
    expect(Buffer.from(value,'base64url')).toHaveLength(32);expect(value).toMatch(/^[-A-Za-z0-9_]{43}$/);
    expect(value).not.toBe(b.cookieValueForResponse());expect(a.hashForDatabase()).toEqual(createHash('sha256').update(value,'ascii').digest());
    expect(sessionCredentialHash(value)).toEqual(a.hashForDatabase());
    const hash=a.hashForDatabase();hash.fill(0);expect(a.hashForDatabase()).not.toEqual(hash);
  });
  it('does not serialize bearer material',()=>{const material=createSessionCredential();expect(Object.keys(material)).toEqual([]);expect(()=>JSON.stringify(material)).toThrow(SessionCredentialError);});
  it.each(['','a'.repeat(42),'a'.repeat(44),'a'.repeat(43)+'=',' '+'a'.repeat(43),'a'.repeat(42)+'!','a'.repeat(42)+'B'])('rejects malformed/noncanonical synthetic input %s',value=>expect(()=>sessionCredentialHash(value)).toThrow('SESSION_CREDENTIAL_INVALID'));
});
describe('revocation database boundary',()=>{
  it.each(['https://example.com/db','postgresql://127.0.0.1/crest_test','postgresql://u:p@localhost/crest_migrate_0000000000000000',
    'postgresql://u:p@127.0.0.1/crest_test','postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable'])('rejects unsafe test target %s',connectionString=>{
    expect(()=>createSessionRevoker({connectionString,environment:'test'})).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  });
  it('rejects malformed credentials and pre-cancelled work before connecting',async()=>{
    const revoke=createSessionRevoker({connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test'});
    await expect(revoke('invalid',new AbortController().signal)).rejects.toThrow('SESSION_REVOCATION_FAILED');
    const controller=new AbortController();controller.abort();await expect(revoke(createSessionCredential().cookieValueForResponse(),controller.signal)).rejects.toThrow('SESSION_REVOCATION_FAILED');
  });
});
