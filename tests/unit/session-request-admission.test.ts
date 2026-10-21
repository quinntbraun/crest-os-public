import {randomBytes} from 'node:crypto';
import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('server-only',()=>({}));
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>query}));
import {createSessionRequestAdmission,SessionAdmissionError} from '../../src/security/session-request-admission.ts';
const config={connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test' as const};
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
beforeEach(()=>{query.mockReset();});
describe('per-session work reservation boundary',()=>{
  it.each(['ordinary','logout'] as const)('sends only a credential digest and trusted bucket %s; wipes digest after success',async bucket=>{
    let saved:Buffer|undefined;
    query.mockImplementation(async(sql:string,values:unknown[])=>{
      expect(sql).not.toContain(credential);expect(values[1]).toBe(bucket);saved=values[0] as Buffer;
      expect(saved).toHaveLength(32);expect(saved.includes(Buffer.from(credential))).toBe(false);return true;
    });
    expect(await createSessionRequestAdmission(config)(credential,bucket,signal())).toBe(true);expect(saved!.equals(Buffer.alloc(32))).toBe(true);
  });
  it('preserves a durable denial rather than treating it as authority or retrying',async()=>{
    query.mockResolvedValue(false);expect(await createSessionRequestAdmission(config)(credential,'ordinary',signal())).toBe(false);expect(query).toHaveBeenCalledOnce();
  });
  it.each([null,undefined,1,'true',{},[]])('fails closed on a malformed database result %#',async value=>{
    query.mockResolvedValue(value);await expect(createSessionRequestAdmission(config)(credential,'ordinary',signal())).rejects.toThrow(SessionAdmissionError);
  });
  it('masks raw database errors and wipes credential digests after failure',async()=>{
    let saved:Buffer|undefined;query.mockImplementation(async(_sql:string,values:unknown[])=>{saved=values[0] as Buffer;throw new Error('private database detail');});
    const error=await createSessionRequestAdmission(config)(credential,'ordinary',signal()).catch(error=>error);
    expect(error).toBeInstanceOf(SessionAdmissionError);expect(error.message).toBe('SESSION_ADMISSION_FAILED');expect(error.cause).toBeUndefined();
    expect(saved!.equals(Buffer.alloc(32))).toBe(true);expect(query).toHaveBeenCalledOnce();
  });
  it.each(['','all','ORDINARY','login',null,undefined])('rejects unapproved server bucket %# before IO',async bucket=>{
    await expect(createSessionRequestAdmission(config)(credential,bucket as never,signal())).rejects.toThrow(SessionAdmissionError);expect(query).not.toHaveBeenCalled();
  });
  it.each(['',credential+'=',credential+'\r\n', 'A'.repeat(42)+'B'])('rejects malformed opaque credential %# before IO',async value=>{
    await expect(createSessionRequestAdmission(config)(value,'ordinary',signal())).rejects.toThrow(SessionAdmissionError);expect(query).not.toHaveBeenCalled();
  });
  it('rejects cancellation before making an attempt',async()=>{
    const c=new AbortController();c.abort();await expect(createSessionRequestAdmission(config)(credential,'ordinary',c.signal)).rejects.toThrow(SessionAdmissionError);expect(query).not.toHaveBeenCalled();
  });
});
