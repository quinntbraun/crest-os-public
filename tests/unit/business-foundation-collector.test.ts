import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({configs:[] as Record<string,unknown>[],clients:[] as {events:Record<string,()=>void>}[],query:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({default:{Client:class{
 events:Record<string,()=>void>={};constructor(config:Record<string,unknown>){db.configs.push(config);db.clients.push(this);}
 on(name:string,fn:()=>void){this.events[name]=fn;return this;}once(name:string,fn:()=>void){return this.on(name,fn);}
 connect(){return db.connect();}query(...args:unknown[]){return db.query(...args);}end(){return db.end();}
}}}));
import {createBusinessFoundationCollector,createBusinessSourceCollector,createBusinessSourceJournalCollector,createBusinessSourceCatalogCollector} from '../../src/security/business-foundation-collector';
import {serviceStorageFixture} from '../support/service-storage-fixture';
import {journalCollectionFixture} from '../support/journal-collection-fixture.ts';
import {customerFixture} from '../support/customer-fixture.ts';
import {addressFixture} from '../support/customer-address-fixture.ts';
import {vehicleFixture} from '../support/vehicle-fixture.ts';
import {associationFixture} from '../support/vehicle-association-fixture.ts';
import {leadFixture,leadSourceFixture} from '../support/lead-fixture.ts';
import {leadStateEventFixture} from '../support/lead-state-fixture.ts';
import {leadVehicleFixture} from '../support/lead-vehicle-fixture.ts';
import {leadAddressFixture} from '../support/lead-address-fixture.ts';
import {conversionRecordFixture,conversionLinkFixture} from '../support/lead-conversion-record-fixture.ts';
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

const crmInventory=[
 ['customers','customer','customer_directory','customers'],['addresses','address','address_directory','addresses'],['vehicles','vehicle','vehicle_directory','vehicles'],['associations','association','vehicle_associations','associations'],['leadSources','lead_source','lead_source_directory','lead_sources'],['leads','lead','lead_directory','leads'],['leadEvents','lead_event','lead_state_events','events'],['leadVehicles','lead_vehicle','lead_vehicle_intake','leadVehicles'],['leadAddresses','lead_address','lead_address_intake','leadAddresses'],['conversions','lead_conversion','lead_conversion','conversions'],['links','conversion_link','lead_conversion','links']
] as const;
function sourceFixture(){
 const businessId=f.expected.businessId,base=conversionRecordFixture(),parent={...base,business_id:businessId,request:{...base.request,businessId}};
 const link=conversionLinkFixture(),addressLink=conversionLinkFixture('address');
 const source=leadSourceFixture({business_id:businessId,referral_customer_id:parent.customer_id});
 const lead=leadFixture({business_id:businessId,id:parent.lead_id,customer_id:parent.customer_id,source_id:source.id,source_snapshot:source,estimated_cents:'9007199254740993'});
 const rows:Record<string,Record<string,unknown>[]>={
  customers:[customerFixture({business_id:businessId,id:parent.customer_id,notes:'=Private É 😀\\N\ntext',version:'9007199254740993'})],
  addresses:[addressFixture({business_id:businessId,id:addressLink.address_id!,customer_id:parent.customer_id,latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000'})],
  vehicles:[vehicleFixture({business_id:businessId,id:link.vehicle_id!})],
  associations:[associationFixture({business_id:businessId,customer_id:parent.customer_id,vehicle_id:link.vehicle_id!})],
  leadSources:[source],leads:[lead],leadEvents:[leadStateEventFixture({business_id:businessId,lead_id:parent.lead_id})],
  leadVehicles:[leadVehicleFixture({business_id:businessId,id:link.lead_vehicle_id!,lead_id:parent.lead_id,vehicle_id:link.vehicle_id!})],
  leadAddresses:[leadAddressFixture({business_id:businessId,id:addressLink.lead_address_id!,lead_id:parent.lead_id})],
  conversions:[parent],links:[{...link,business_id:businessId},{...addressLink,business_id:businessId}]
 };
 for(const [i,[name,,scope]]of crmInventory.entries())if(name!=='links')contexts[name]=JSON.stringify({schemaVersion:1,scope,businessId,snapshotToken:i.toString(16).repeat(64),...(name==='conversions'?{conversionCount:'1',linkCount:'2'}:{rowCount:String(rows[name]!.length)})});
 function sourceAnswer(sql:string,args:unknown[]=[]):unknown{
  const d=crmInventory.find(([,routine])=>sql.includes(`.${routine}_snapshot_page(`));if(!d)return answer(sql,args);
  const [name,,,field]=d,token=JSON.parse(contexts[name==='links'?'conversions':name] as string).snapshotToken;
  return {rows:[{page:JSON.stringify({schemaVersion:1,businessId,snapshotToken:token,[field]:rows[name]!.filter(r=>args[2]===null||(r.id as string)>(args[2] as string)).slice(0,20)})}]};
 }
 db.query.mockImplementation(sourceAnswer);return {rows,sourceAnswer};
}
function journalFixture(){
 const base=sourceFixture(),journal=journalCollectionFixture(f.expected.businessId,f.identity.stamp);contexts.journal=JSON.stringify(journal.context);
 const original=async(sql:string,args:unknown[]=[])=>sql.includes('source_export_journal_')&&!sql.includes('_context(')?journal.query(sql,args):base.sourceAnswer(sql,args);
 db.query.mockImplementation(original);return {base,journal,original};
}
it('includes the proposed journal in the original CRM snapshot and seals a separate private schema43 result only after commit',async()=>{
 const fixture=journalFixture(),out=await createBusinessSourceJournalCollector(config())(signal()),value=out.forJournalServer(),journal=JSON.parse(value.journal);
 expect(out).not.toHaveProperty('forServer');expect(()=>JSON.stringify(out)).toThrow('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');expect(value.sourceSchemaVersion).toBe(43);expect(Object.isFrozen(value)).toBe(true);
 expect(journal.generationId).toBe(value.generationId);expect(journal.observedAt).toBe(value.observedAt);expect(JSON.parse(value.crm).generationId).toBe(value.generationId);expect(journal.pages.snapshot[0]).toBe(JSON.stringify([fixture.journal.page()]));
 expect(value.metadataBytes).toBeLessThanOrEqual(8388608);expect(value.originalBytes).toBe(Buffer.byteLength(fixture.journal.text));expect(value.evidenceBytes).toBe([value.configuration,value.identity,value.history,value.crm,value.journal].reduce((n,s)=>n+Buffer.byteLength(s),0));
 expect(db.configs).toHaveLength(1);const initial=db.query.mock.calls.filter(c=>c[0].includes('_context('));expect(initial).toHaveLength(1);expect(initial[0]![0]).toContain('source_export_journal_context');expect(db.query.mock.calls.at(-1)![0]).toBe('COMMIT');
});
it.each(['time','aggregate-count','original-budget','missing-context'])('refuses journal %s before any foundation or CRM page',async issue=>{
 const fixture=journalFixture();if(issue==='time')fixture.journal.context.observedAt='2026-10-25T07:00:00.123456+00:00';if(issue==='aggregate-count')fixture.journal.context.recordCounts.job='10000';if(issue==='original-budget')fixture.journal.context.originalTextBytes='16777217';contexts.journal=JSON.stringify(fixture.journal.context);if(issue==='missing-context')delete contexts.journal;
 await expect(createBusinessSourceJournalCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);expect(db.end).toHaveBeenCalledOnce();
});
it.each(['missing-original','commit','bad-commit','late-cancel'])('does not release a journal capture after %s',async issue=>{
 const fixture=journalFixture(),c=new AbortController();db.query.mockImplementation(async(sql,args)=>{if(sql==='COMMIT'){if(issue==='commit')throw Error('private database detail');if(issue==='bad-commit')return {command:'ROLLBACK'};if(issue==='late-cancel')c.abort();}if(sql.includes('_text_chunk(')&&issue==='missing-original')return {rows:[]};return fixture.original(sql,args);});
 const failure=await createBusinessSourceJournalCollector(config())(c.signal).catch(e=>e);expect(failure.message).toBe(error);expect(failure).not.toHaveProperty('cause');if(issue==='missing-original')expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);expect(db.end).toHaveBeenCalledOnce();
});
it('captures every CRM group and foundation on one connection with one initial context statement and commit',async()=>{
 const fixture=sourceFixture(),sealed=await createBusinessSourceCollector(config())(signal()),value=sealed.forServer(),crm=JSON.parse(value.crm);
 expect(()=>JSON.stringify(sealed)).toThrow('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');expect(db.configs).toHaveLength(1);expect(db.query.mock.calls.filter(c=>c[0].includes('_context('))).toHaveLength(1);
 expect(crm.generationId).toBe(value.generationId);expect(crm.observedAt).toBe(value.observedAt);expect(crm.completePortableExport).toBe(false);expect(crm.completeBackup).toBe(false);
 for(const [name,,,field]of crmInventory)expect(crm.pages[name].flatMap((p:string)=>JSON.parse(p)[field])).toEqual(fixture.rows[name]);
 expect(Object.keys(crm.contexts)).toHaveLength(10);expect(Object.keys(crm.pages)).toHaveLength(11);expect(crm.recordCount).toBe(12);
 expect(value.recordCount).toBe(12+[value.configuration,value.identity,value.history].reduce((n,s)=>n+JSON.parse(s).records.length,0));
 expect(value.evidenceBytes).toBe(crm.evidenceBytes+[value.configuration,value.identity,value.history].reduce((n,s)=>n+JSON.parse(s).evidenceBytes,0));
 expect(db.query.mock.calls.at(-1)![0]).toBe('COMMIT');expect(db.query.mock.calls.filter(c=>c[0].includes('_snapshot_page(')).every(c=>c[1][0]===f.expected.businessId&&c[1][3]===20)).toBe(true);
});
it('retains exact source JSON, large decimal strings, microseconds and domain-separated tokens',async()=>{
 const fixture=sourceFixture(),original=fixture.sourceAnswer;
 db.query.mockImplementation((sql,args)=>{const r=original(sql,args) as {rows:{page?:string}[]};if(sql.includes('.customer_snapshot_page('))r.rows[0]!.page='  '+r.rows[0]!.page+' \n';return r;});
 const value=(await createBusinessSourceCollector(config())(signal())).forServer(),crm=JSON.parse(value.crm);
 expect(crm.pages.customers[0]).toBe((db.query.mock.results.find((_,i)=>db.query.mock.calls[i]![0].includes('.customer_snapshot_page('))!.value as {rows:{page:string}[]}).rows[0]!.page);
 expect(value.crm).toContain('9007199254740993');expect(value.crm).toContain('-89.00000000000000000001');expect(value.crm).toContain('.123456Z');
 expect(new Set(Object.values(crm.contexts).map(p=>JSON.parse(p as string).snapshotToken)).size).toBe(10);
});
it('paginates complete CRM sources with an exclusive UUID cursor and explicit terminal page for exact multiples',async()=>{
 const fixture=sourceFixture();fixture.rows.customers=Array.from({length:40},(_,i)=>({...fixture.rows.customers![0],id:i===39?conversionRecordFixture().customer_id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')}));
 contexts.customers=JSON.stringify({...JSON.parse(contexts.customers as string),rowCount:'40'});
 const crm=JSON.parse((await createBusinessSourceCollector(config())(signal())).forServer().crm),calls=db.query.mock.calls.filter(c=>c[0].includes('.customer_snapshot_page('));
 expect(calls).toHaveLength(3);expect(calls[1]![1][2]).toBe(fixture.rows.customers[19]!.id);expect(calls[2]![1][2]).toBe(fixture.rows.customers[39]!.id);expect(JSON.parse(crm.pages.customers[2]).customers).toEqual([]);
});
it('retains explicit empty source pages and exact zero counts without claiming complete Crest coverage',async()=>{
 const fixture=sourceFixture();for(const [name]of crmInventory){fixture.rows[name]=[];if(name!=='links')contexts[name]=JSON.stringify({...JSON.parse(contexts[name] as string),...(name==='conversions'?{conversionCount:'0',linkCount:'0'}:{rowCount:'0'})});}
 const value=(await createBusinessSourceCollector(config())(signal())).forServer(),crm=JSON.parse(value.crm);expect(crm.recordCount).toBe(0);expect(value.completePortableExport).toBe(false);expect(Object.values(crm.pages).every(p=>(p as string[]).length===1)).toBe(true);
});
it.each(['context-scope','context-number-count','context-extra','context-limit','context-business','missing-context'])('refuses %s before paging either source family',async issue=>{
 sourceFixture();const c=JSON.parse(contexts.customers as string);if(issue==='context-scope')c.scope='vehicle_directory';if(issue==='context-number-count')c.rowCount=1;if(issue==='context-extra')c.secret='private';if(issue==='context-limit')c.rowCount='1001';if(issue==='context-business')c.businessId=randomUUID();contexts.customers=JSON.stringify(c);if(issue==='missing-context')delete contexts.customers;
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);
});
it.each(['foreign-page','wrong-token','extra-field','missing-row','extra-row','reversed-order','duplicate','foreign-row','bad-bigint','unsafe-number','duplicate-json-key','invalid-utf8','oversized-page'])('rejects %s without committing or publishing partial CRM output',async issue=>{
 const fixture=sourceFixture();
 if(issue==='missing-row')fixture.rows.customers=[];if(issue==='extra-row'||issue==='duplicate')fixture.rows.customers!.push({...fixture.rows.customers![0]});
 if(issue==='bad-bigint')fixture.rows.customers![0]!.version=9007199254740992;if(issue==='foreign-row')fixture.rows.customers![0]!.business_id=randomUUID();
 if(issue==='reversed-order'){fixture.rows.customers!.unshift({...fixture.rows.customers![0],id:'ffffffff-ffff-4fff-8fff-ffffffffffff'});contexts.customers=JSON.stringify({...JSON.parse(contexts.customers as string),rowCount:'2'});}
 const original=fixture.sourceAnswer;db.query.mockImplementation((sql,args)=>{const r=original(sql,args) as {rows:{page?:string}[]};if(sql.includes('.customer_snapshot_page(')){
  const page=JSON.parse(r.rows[0]!.page!);if(issue==='foreign-page')page.businessId=randomUUID();if(issue==='wrong-token')page.snapshotToken='f'.repeat(64);if(issue==='extra-field')page.secret='private';r.rows[0]!.page=JSON.stringify(page);
  if(issue==='unsafe-number')r.rows[0]!.page=r.rows[0]!.page!.replace('"schemaVersion":1','"schemaVersion":9007199254740993');
  if(issue==='duplicate-json-key')r.rows[0]!.page=r.rows[0]!.page!.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');
  if(issue==='invalid-utf8')r.rows[0]!.page+='\ud800';if(issue==='oversized-page')r.rows[0]!.page+=' '.repeat(1048576);
 }return r;});
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it.each(['address-customer','association-vehicle','lead-source','event-lead','lead-vehicle','lead-address','conversion-customer','missing-conversion-link'])('rejects broken %s references after complete capture',async issue=>{
 const fixture=sourceFixture(),rows=fixture.rows;
 if(issue==='address-customer')rows.addresses![0]!.customer_id=randomUUID();if(issue==='association-vehicle')rows.associations![0]!.vehicle_id=randomUUID();
 if(issue==='lead-source')rows.leadSources=[];if(issue==='event-lead')rows.leadEvents![0]!.lead_id=randomUUID();if(issue==='lead-vehicle')rows.leadVehicles![0]!.vehicle_id=randomUUID();if(issue==='lead-address')rows.leadAddresses![0]!.lead_id=randomUUID();
 if(issue==='conversion-customer')rows.customers=[];if(issue==='missing-conversion-link')rows.links!.pop();
 for(const [name]of crmInventory)if(name!=='links'){const c=JSON.parse(contexts[name] as string);contexts[name]=JSON.stringify({...c,...(name==='conversions'?{conversionCount:String(rows.conversions!.length),linkCount:String(rows.links!.length)}:{rowCount:String(rows[name]!.length)})});}
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('cancellation during the last CRM page destroys the same connection and fences late output',async()=>{
 const fixture=sourceFixture(),controller=new AbortController();let finish!:(value:unknown)=>void;
 db.query.mockImplementation((sql,args)=>sql.includes('.conversion_link_snapshot_page(')?new Promise(r=>{finish=()=>r(fixture.sourceAnswer(sql,args));}):fixture.sourceAnswer(sql,args));
 const pending=createBusinessSourceCollector(config())(controller.signal);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));controller.abort();await expect(pending).rejects.toThrow(error);finish(undefined);await Promise.resolve();expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);expect(db.end).toHaveBeenCalledOnce();
});
it('bounds the aggregate declared record count before reading any foundation or CRM page',async()=>{
 sourceFixture();for(const [name]of crmInventory)if(name!=='links')contexts[name]=JSON.stringify({...JSON.parse(contexts[name] as string),...(name==='conversions'?{conversionCount:'1000',linkCount:'1000'}:{rowCount:'1000'})});
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);
});
it('rejects aggregate source bytes across individually valid bounded pages instead of truncating a capture',async()=>{
 const fixture=sourceFixture();fixture.rows.customers=Array.from({length:1000},(_,i)=>({...fixture.rows.customers![0],id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0'),notes:'😀'.repeat(2000),display_name:'😀'.repeat(200)}));contexts.customers=JSON.stringify({...JSON.parse(contexts.customers as string),rowCount:'1000'});
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);const calls=db.query.mock.calls.filter(c=>c[0].includes('.customer_snapshot_page('));expect(calls.length).toBeGreaterThan(1);expect(calls.length).toBeLessThan(50);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it.each(['lead-parent','address-customer'])('rejects a conversion link whose existing %s belongs to another source',async issue=>{
 const fixture=sourceFixture();if(issue==='lead-parent'){const other={...fixture.rows.leads![0],id:randomUUID()};fixture.rows.leads!.push(other);fixture.rows.leads!.sort((a,b)=>(a.id as string)<(b.id as string)?-1:1);contexts.leads=JSON.stringify({...JSON.parse(contexts.leads as string),rowCount:'2'});fixture.rows.leadVehicles![0]!.lead_id=other.id;}
 else{const other={...fixture.rows.customers![0],id:randomUUID()};fixture.rows.customers!.push(other);fixture.rows.customers!.sort((a,b)=>(a.id as string)<(b.id as string)?-1:1);contexts.customers=JSON.stringify({...JSON.parse(contexts.customers as string),rowCount:'2'});fixture.rows.addresses![0]!.customer_id=other.id;}
 await expect(createBusinessSourceCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});

function catalogFixture(){
 const base=journalFixture(),catalog=serviceStorageFixture(),business=f.expected.businessId;
 const rows={services:[{...catalog.service,business_id:business}],versions:[{...catalog.content,business_id:business}]};
 const context={schemaVersion:1,scope:'service_catalog',businessId:business,snapshotToken:'c'.repeat(64),serviceCount:'1',versionCount:'1'};
 contexts.catalog=JSON.stringify(context);
 const original=async(sql:string,args:unknown[]=[])=>{
  const entity=sql.includes('.service_catalog_snapshot_services(')?'services':sql.includes('.service_catalog_snapshot_versions(')?'versions':null;
  return entity?{rows:[{page:JSON.stringify({schemaVersion:1,businessId:business,snapshotToken:context.snapshotToken,[entity]:args[2]===null?rows[entity]:[]})}]}:base.original(sql,args);
 };
 db.query.mockImplementation(original);return{base,catalog,rows,context,original};
}
it('adds catalog to the same owned snapshot and returns a separate honest unregistered candidate after commit',async()=>{
 catalogFixture();const capture=await createBusinessSourceCatalogCollector(config())(signal()),out=capture.forCatalogServer(),catalog=JSON.parse(out.catalog);
 expect(capture).not.toHaveProperty('forServer');expect(capture).not.toHaveProperty('forJournalServer');expect(()=>JSON.stringify(capture)).toThrow('BUSINESS_FOUNDATION_CAPTURE_PRIVATE');
 expect(out.registeredSourceSchemaVersion).toBe(43);expect(out.catalogRegistered).toBe(false);expect(out.source.sourceSchemaVersion).toBe(43);expect(Object.isFrozen(out.source)).toBe(true);
 expect(catalog.generationId).toBe(out.source.generationId);expect(catalog.observedAt).toBe(out.source.observedAt);expect(out.recordCount).toBe(out.source.recordCount+2);
 expect(out.metadataBytes).toBe(out.source.metadataBytes+catalog.metadataBytes);expect(out.evidenceBytes).toBe(out.source.evidenceBytes+Buffer.byteLength(out.catalog));
 expect(db.configs).toHaveLength(1);const initial=db.query.mock.calls.filter(c=>c[0].includes('_context('));expect(initial).toHaveLength(1);expect(initial[0]![0]).toContain('source_export_journal_context');expect(initial[0]![0]).toContain('service_catalog_snapshot_context');
 expect(db.query.mock.calls[1]![0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(db.query.mock.calls.at(-1)![0]).toBe('COMMIT');
});
it.each(['missing','foreign','count','aggregate'])('rejects catalog %s context before reading any domain page',async issue=>{
 const fixture=catalogFixture();if(issue==='missing')delete contexts.catalog;else if(issue==='foreign')contexts.catalog=JSON.stringify({...fixture.context,businessId:randomUUID()});else if(issue==='count')contexts.catalog=JSON.stringify({...fixture.context,versionCount:'1001'});else {fixture.base.journal.context.recordCounts.job='9999';contexts.journal=JSON.stringify(fixture.base.journal.context);}
 await expect(createBusinessSourceCatalogCollector(config())(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page(')||c[0].includes('_snapshot_services('))).toBe(false);
});
it.each(['commit','bad-commit','late-cancel','catalog-page'])('never releases mixed source after %s',async issue=>{
 const fixture=catalogFixture(),c=new AbortController();db.query.mockImplementation(async(sql,args)=>{if(sql==='COMMIT'){if(issue==='commit')throw new Error('private failure');if(issue==='bad-commit')return{command:'ROLLBACK'};if(issue==='late-cancel')c.abort();}if(issue==='catalog-page'&&sql.includes('.service_catalog_snapshot_versions('))return{rows:[{page:'{}'}]};return fixture.original(sql,args);});
 await expect(createBusinessSourceCatalogCollector(config())(c.signal)).rejects.toThrow(error);expect(db.end).toHaveBeenCalledOnce();if(issue==='catalog-page')expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
