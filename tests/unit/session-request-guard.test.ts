import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({query:vi.fn()}));vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>mock.query}));
import {createSessionCsrfVerifier} from '../../src/security/session-request-guard';
import {createCsrfToken} from '../../src/security/request-protection';
const origin='https://crest.example.com',session=randomUUID(),credential=randomBytes(32).toString('base64url'),proof=createCsrfToken(session);
const request=(headers:Record<string,string>={})=>({method:'POST',headers:new Headers({origin,'content-type':'application/json','x-crest-csrf':proof.tokenForResponse(),...headers})});
const run=()=>createSessionCsrfVerifier({connectionString:'unused',environment:'test',origin}),signal=()=>new AbortController().signal;
beforeEach(()=>{vi.resetAllMocks();mock.query.mockResolvedValue({id:session,hashes:[randomBytes(32).toString('base64'),proof.hashForDatabase().toString('base64')]});});
it('validates retained session-bound proof, digest-only query and cleanup',async()=>{
  mock.query.mockImplementation(async(sql,params)=>{expect(sql).toBe('SELECT crest_commands.browser_csrf_snapshot($1::bytea) AS result');expect(params[0].equals(createHash('sha256').update(credential,'ascii').digest())).toBe(true);return {id:session,hashes:[proof.hashForDatabase().toString('base64')]};});
  await run()(request(),credential,signal());expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));
});
it('rejects Origin before any credential snapshot work',async()=>{await expect(run()(request({origin:'https://evil.example.com'}),credential,signal())).rejects.toThrow();expect(mock.query).not.toHaveBeenCalled();});
it('checks every bounded retained proof and rejects a proof from another session',async()=>{
  await run()(request(),credential,signal());await expect(run()(request({'x-crest-csrf':createCsrfToken(randomUUID()).tokenForResponse()}),credential,signal())).rejects.toThrow('SESSION_REQUEST_GUARD_FAILED');
});
it.each([null,{}, {id:'bad',hashes:[]},{id:session,hashes:[]},{id:session,hashes:Array(9).fill(proof.hashForDatabase().toString('base64'))},{id:session,hashes:['bad']},{id:session,hashes:[randomBytes(31).toString('base64')]},{id:session,hashes:[42]}])('fails closed on malformed durable snapshots',async value=>{
  mock.query.mockResolvedValue(value);await expect(run()(request(),credential,signal())).rejects.toThrow('SESSION_REQUEST_GUARD_FAILED');
});
it('masks SQL failure and clears the digest',async()=>{mock.query.mockRejectedValue(new Error('private SQL detail'));const e=await run()(request(),credential,signal()).catch((e:unknown)=>e);expect(e).toMatchObject({message:'SESSION_REQUEST_GUARD_FAILED'});expect(e).not.toHaveProperty('cause');expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));});
it('late cancellation cannot authorize work after a snapshot',async()=>{const controller=new AbortController();mock.query.mockImplementation(async()=>{controller.abort();return {id:session,hashes:[proof.hashForDatabase().toString('base64')]};});await expect(run()(request(),credential,controller.signal)).rejects.toThrow('SESSION_REQUEST_GUARD_FAILED');});
