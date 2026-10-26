import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({configs:[] as Record<string,unknown>[],clients:[] as {events:Record<string,()=>void>}[],query:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({default:{Client:class{
 events:Record<string,()=>void>={};constructor(config:Record<string,unknown>){db.configs.push(config);db.clients.push(this);}
 on(name:string,fn:()=>void){this.events[name]=fn;return this;}once(name:string,fn:()=>void){return this.on(name,fn);}
 connect(){return db.connect();}query(...args:unknown[]){return db.query(...args);}end(){return db.end();}
}}}));
import {createBusinessFoundationCollector} from '../../src/security/business-foundation-collector';
import {configurationFixture} from '../support/business-configuration-fixture';
import {identityDigest} from '../support/business-identity-fixture';
import {verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence';

let f:ReturnType<typeof configurationFixture>,contexts:Record<string,unknown>,pages:Record<string,Record<string,unknown>[]>;
const error='BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED',signal=()=>new AbortController().signal;
const config=()=>({connectionString:'postgresql://synthetic:synthetic@127.0.0.1/crest_migrate_0000000000000000',environment:'test' as const,businessId:f.expected.businessId});
function answer(sql:string,args:unknown[]=[]):unknown{
 if(sql.startsWith('SELECT current_user'))return {rows:[{allowed:true}]};
 if(sql.startsWith('BEGIN'))return {command:'BEGIN',rows:[]};
 if(sql==='COMMIT')return {command:'COMMIT',rows:[]};
 if(sql.includes('_context('))return {rows:[contexts]};
 const name=['configuration','identity','history'].find(g=>sql.includes('business_'+g+'_export_page('));if(!name)throw new Error('Unexpected fixture SQL');
 return {rows:(pages[name+':'+args[2]]??[]).filter(r=>args[3]===null||(r.record_id as string)>(args[3] as string)).slice(0,20)};
}
beforeEach(()=>{
 vi.resetAllMocks();db.configs.length=0;db.clients.length=0;db.connect.mockResolvedValue(undefined);db.end.mockResolvedValue(undefined);db.query.mockImplementation(answer);
 f=configurationFixture();const parts={configuration:f.collection,identity:f.identity.collection,history:f.history.collection};contexts={};pages={};
 for(const [group,part]of Object.entries(parts)){
  contexts[group]={...part.context,observedAt:f.identity.stamp};
  for(const r of part.records)(pages[group+':'+r.kind]??=[]).push({record_id:r.recordId,representation:r.representation,canonical_evidence:r.canonicalEvidence,evidence_hash:r.evidenceHash});
 }
});
afterEach(()=>vi.useRealTimers());
it('collects all three groups on one closed-role connection/snapshot and seals only after commit acknowledgment',async()=>{
 const out=await createBusinessFoundationCollector(config())(signal()),value=out.forServer();
 expect(()=>JSON.stringify(out)).toThrow('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');expect(Object.isFrozen(value)).toBe(true);
 expect(value).toMatchObject({businessId:f.expected.businessId,capture:'single_connection_repeatable_read',completePortableExport:false,completeBackup:false});
 const report=verifyBusinessFoundationEvidence(value.configuration,value.identity,value.history,f.expected);expect(report.configurationCurrentRowsVerified).toBe(true);
 const parts=[value.configuration,value.identity,value.history].map(s=>JSON.parse(s));expect(new Set(parts.map(p=>p.generationId)).size).toBe(1);expect(new Set(parts.map(p=>p.context.observedAt)).size).toBe(1);expect(new Set(parts.map(p=>p.context.snapshotToken)).size).toBe(3);
 expect(value.recordCount).toBe(parts.reduce((n,p)=>n+p.records.length,0));expect(value.evidenceBytes).toBe(parts.reduce((n,p)=>n+p.evidenceBytes,0));
 for(const [index,name]of ['configuration','identity','history'].entries()){expect(parts[index].records.map((r:{canonicalEvidence:string})=>r.canonicalEvidence)).toEqual(Object.entries(pages).filter(([k])=>k.startsWith(name+':')).flatMap(([,rows])=>rows.map(r=>r.canonical_evidence)));}
 expect(db.configs).toHaveLength(1);expect(db.connect).toHaveBeenCalledOnce();expect(db.end).toHaveBeenCalledOnce();
 expect(db.configs[0]).toMatchObject({ssl:false,options:'-c role=crest_export',statement_timeout:3000,query_timeout:3500,idle_in_transaction_session_timeout:4000});
 const calls=db.query.mock.calls;expect(calls[1]![0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(calls.filter(c=>c[0].includes('_context('))).toHaveLength(1);expect(calls.at(-1)![0]).toBe('COMMIT');
 expect(calls.filter(c=>c[0].includes('_page(')).every(c=>c[1][0]===f.expected.businessId&&c[1][4]===20)).toBe(true);
});
it('preserves source bigint and JSON text bytes without deriving authority from consistency verification',async()=>{
 const value=(await createBusinessFoundationCollector(config())(signal())).forServer();
 expect(value.identity).toContain('9007199254740995');const report=verifyBusinessFoundationEvidence(value.configuration,value.identity,value.history,f.expected);
 expect(report.consistentCaptureProven).toBe(false);expect(report.referenceClosureComplete).toBe(false);expect(value).not.toHaveProperty('ready');expect(value).not.toHaveProperty('authorized');
});
it('reads explicit empty operation/audit pages without inventing an operation or dropping other groups',async()=>{
 Object.assign(contexts.history as object,{recordCounts:{operation:'0',audit_event:'0'}});pages['history:operation']=[];pages['history:audit_event']=[];
 const value=(await createBusinessFoundationCollector(config())(signal())).forServer();expect(JSON.parse(value.history).records).toEqual([]);
 expect(db.query.mock.calls.filter(c=>c[0].includes('business_history_export_page('))).toHaveLength(2);
});
it.each(['role','missing-role-row','context-business','context-extra','context-time','context-over-cap','context-numeric-count','context-missing-count'])('rejects %s before any source page',async issue=>{
 if(issue==='role'||issue==='missing-role-row')db.query.mockImplementation((sql,args)=>sql.startsWith('SELECT current_user')?{rows:issue==='role'?[{allowed:false}]:[]}:answer(sql,args));
 const ctx=contexts.configuration as Record<string,unknown>;
 if(issue==='context-business')ctx.businessId=randomUUID();if(issue==='context-extra')ctx.extra='private';if(issue==='context-time')ctx.observedAt='2026-10-24T07:00:00.123457+00:00';
 if(issue==='context-over-cap')ctx.recordCounts={business:'1',membership:'1000',recovery_authority:'1'};
 if(issue==='context-numeric-count')ctx.recordCounts={business:1,membership:'1',recovery_authority:'1'};
 if(issue==='context-missing-count')ctx.recordCounts={business:'1',membership:'1'};
 await expect(createBusinessFoundationCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);expect(db.end).toHaveBeenCalledOnce();
});
it.each(['hash','extra','id','representation','short-count','body-mismatch','source-lineage'])('discards all partial output on %s and does not commit',async issue=>{
 const row=pages['configuration:business']![0]!;
 if(issue==='hash')row.evidence_hash='0'.repeat(64);if(issue==='extra')row.extra='private';if(issue==='id')row.record_id='invalid';if(issue==='representation')row.representation='stored_payload';
 if(issue==='short-count')pages['configuration:membership']=[];
 if(issue==='body-mismatch'||issue==='source-lineage'){const body=JSON.parse(row.canonical_evidence as string);if(issue==='body-mismatch')body.row.id=randomUUID();else body.row.legal_name='Rehashed inconsistent latest state';row.canonical_evidence=JSON.stringify(body);row.evidence_hash=identityDigest(row.canonical_evidence as string);}
 await expect(createBusinessFoundationCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('advances an exclusive fixed cursor and still rejects a rehashed invalid source after all pages',async()=>{
 const rows=Array.from({length:21},(_,i)=>({...pages['history:operation']![0],record_id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0')}));
 pages['history:operation']=rows;Object.assign(contexts.history as object,{recordCounts:{operation:'21',audit_event:'1'}});
 await expect(createBusinessFoundationCollector(config())(signal())).rejects.toThrow(error);
 const calls=db.query.mock.calls.filter(c=>c[0].includes('business_history_export_page(')&&c[1][2]==='operation');expect(calls).toHaveLength(2);expect(calls[1]![1][3]).toBe(rows[19]!.record_id);expect(calls.every(c=>c[1][4]===20)).toBe(true);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it.each(['connect','query','commit','bad-commit-ack'])('redacts %s failure without releasing a capture',async where=>{
 if(where==='connect')db.connect.mockRejectedValue(new Error('private connection'));
 else db.query.mockImplementation((sql,args)=>{if(where==='query'&&sql.includes('_page(')||where==='commit'&&sql==='COMMIT')throw new Error('private SQL');if(where==='bad-commit-ack'&&sql==='COMMIT')return {command:'ROLLBACK'};return answer(sql,args);});
 const caught=await createBusinessFoundationCollector(config())(signal()).catch(e=>e);expect(caught.message).toBe(error);expect(caught).not.toHaveProperty('cause');expect(db.end).toHaveBeenCalledOnce();
});
it('already-aborted work never opens a connection',async()=>{const c=new AbortController();c.abort();await expect(createBusinessFoundationCollector(config())(c.signal)).rejects.toThrow(error);expect(db.configs).toHaveLength(0);});
it('aborts a stalled source read, tears down transport and ignores a late successful query',async()=>{
 const c=new AbortController();let finish!:(value:unknown)=>void;
 db.query.mockImplementation((sql,args)=>sql.includes('_page(')?new Promise(r=>{finish=r;}):answer(sql,args));
 const pending=createBusinessFoundationCollector(config())(c.signal);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));const transport=(db.configs[0]!.stream as ()=>{destroyed:boolean})();c.abort();
 await expect(pending).rejects.toThrow(error);expect(transport.destroyed).toBe(true);finish({rows:[]});await Promise.resolve();expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('a commit reply received after cancellation cannot publish private output',async()=>{
 const c=new AbortController();let finish!:(value:unknown)=>void;db.query.mockImplementation((sql,args)=>sql==='COMMIT'?new Promise(r=>{finish=r;}):answer(sql,args));
 const pending=createBusinessFoundationCollector(config())(c.signal);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));c.abort();await expect(pending).rejects.toThrow(error);finish({command:'COMMIT'});await Promise.resolve();expect(db.end).toHaveBeenCalledOnce();
});
it('bounds the whole capture lifetime including a stalled connect',async()=>{
 vi.useFakeTimers();db.connect.mockImplementation(()=>new Promise(()=>{}));const pending=createBusinessFoundationCollector(config())(signal());const rejected=expect(pending).rejects.toThrow(error);await vi.advanceTimersByTimeAsync(30000);await rejected;expect(db.end).toHaveBeenCalledOnce();
});
it('refuses overlapping capture and permits a fresh connection after a failed one',async()=>{
 const c=new AbortController(),read=createBusinessFoundationCollector(config());db.connect.mockImplementationOnce(()=>new Promise(()=>{}));const first=read(c.signal),rejected=expect(first).rejects.toThrow(error);
 await expect(read(signal())).rejects.toThrow(error);expect(db.configs).toHaveLength(1);c.abort();await rejected;
 await read(signal());expect(db.configs).toHaveLength(2);expect(db.end).toHaveBeenCalledTimes(2);
});
it('requires verified TLS in production and copies configuration before work starts',async()=>{
 const input={...config(),environment:'production' as const,connectionString:'postgresql://synthetic:synthetic@db.example.com/crest'},read=createBusinessFoundationCollector(input);input.businessId=randomUUID();input.connectionString='postgresql://changed:changed@other.example.com/other';
 expect((await read(signal())).forServer().businessId).toBe(f.expected.businessId);expect(db.configs[0]).toMatchObject({connectionString:'postgresql://synthetic:synthetic@db.example.com/crest',ssl:{rejectUnauthorized:true}});
});
it.each(['postgresql://u:p@remote.example.com/crest_migrate_0000000000000000','postgresql://u:p@127.0.0.1/real_database','postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable'])('does not permit test capture from %s',connectionString=>{
 expect(()=>createBusinessFoundationCollector({...config(),connectionString})).toThrow('BUSINESS_FOUNDATION_COLLECTION_CONFIGURATION_REQUIRED');expect(db.configs).toHaveLength(0);
});
