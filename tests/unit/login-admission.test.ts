import {randomBytes} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createLoginAdmission,createLoginFingerprinter,LoginAdmissionError} from '../../src/security/login-admission.ts';
const bytes=randomBytes(32),fingerprint=createLoginFingerprinter(bytes);
describe('private login fingerprints and admission input',()=>{
  it('normalizes email casing/outer spaces and IPv6 spellings without retaining raw identifiers',()=>{
    const a=fingerprint(' Owner@Example.COM ','2001:0DB8:0000:0000:0000:0000:0000:0001'),b=fingerprint('owner@example.com','2001:db8::1');
    expect(a.parametersForDatabase()).toEqual(b.parametersForDatabase());
    for(const digest of a.parametersForDatabase()){expect(digest).toHaveLength(32);expect(digest.includes(Buffer.from('owner@example.com'))).toBe(false);}
    expect(()=>JSON.stringify(a)).toThrow(LoginAdmissionError);
  });
  it('groups mapped IPv6 and IPv4 together to prevent spelling-based IP limit bypass',()=>{
    const a=fingerprint('owner@example.com','192.0.2.10').parametersForDatabase();
    for(const ip of ['::ffff:192.0.2.10','::ffff:c000:20a','0:0:0:0:0:ffff:c000:020a'])expect(fingerprint('owner@example.com',ip).parametersForDatabase()).toEqual(a);
  });
  it('separates identifier and IP domains and different keys; snapshots key input and returns defensive copies',()=>{
    const source=randomBytes(32),first=createLoginFingerprinter(source),other=createLoginFingerprinter(randomBytes(32));
    const before=first('192.0.2.1','192.0.2.1').parametersForDatabase();source.fill(0);
    expect(first('192.0.2.1','192.0.2.1').parametersForDatabase()).toEqual(before);expect(before[0]).not.toEqual(before[1]);
    expect(other('192.0.2.1','192.0.2.1').parametersForDatabase()).not.toEqual(before);
    const value=fingerprint('owner@example.com','192.0.2.1'),copy=value.parametersForDatabase();copy[0]!.fill(0);expect(value.parametersForDatabase()[0]).not.toEqual(copy[0]);
  });
  it.each(['','192.168.001.1','localhost','192.0.2.1, 192.0.2.2','192.0.2.1:443','fe80::1%eth0','https://example.com'])('rejects nonliteral or ambiguous trusted IP %s',ip=>{
    expect(()=>fingerprint('owner@example.com',ip)).toThrow('LOGIN_ADMISSION_FAILED');
  });
  it.each(['',' ','has space@example.com','owner\u0000@example.com','x'.repeat(321)])('rejects malformed identifier %j',identifier=>{
    expect(()=>fingerprint(identifier,'192.0.2.1')).toThrow(LoginAdmissionError);
  });
  it.each([0,31,33])('rejects a %i-byte key',length=>{expect(()=>createLoginFingerprinter(randomBytes(length))).toThrow('LOGIN_KEY_CONFIGURATION_REQUIRED');});
  it('rejects cancelled or malformed input before network access with fixed errors',async()=>{
    const guard=createLoginAdmission({connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test'},bytes),controller=new AbortController();controller.abort();
    await expect(guard('owner@example.com','192.0.2.1',controller.signal)).rejects.toThrow('LOGIN_ADMISSION_FAILED');
    await expect(guard('owner@example.com','untrusted-header-value',new AbortController().signal)).rejects.toThrow(LoginAdmissionError);
  });
});
