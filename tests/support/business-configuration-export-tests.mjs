import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {verifyBusinessConfigurationEvidence,verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence.ts';
import {createBusinessFoundationCollector} from '../../src/security/business-foundation-collector.ts';

// Registered by the existing actual-PG provider-reference suite so the same
// schema27->28 upgrade also exercises both independent read boundaries.
export function businessConfigurationExportTests(get){
 const tables={business:'crest.businesses',membership:'crest.memberships',recovery_authority:'crest_private.business_recovery_authorities'};
 let client,reader,sandbox,business,other,owner,bootstrap,manifest;
 const context=(id=business,c=reader)=>c.query('SELECT crest_commands.business_configuration_export_context($1) AS result',[id]).then(r=>r.rows[0].result);
 const page=(ctx,kind,{id=ctx.businessId,token=ctx.snapshotToken,cursor=null,size=20,c=reader}={})=>c.query('SELECT * FROM crest_commands.business_configuration_export_page($1,$2,$3,$4,$5)',[id,token,kind,cursor,size]).then(r=>r.rows);
 async function snapshot(work){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work(await context());}finally{await reader.query('ROLLBACK');}}
 async function actor(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic export identity','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id",[randomUUID(),bootstrap])).rows[0].id;}
 async function root(name){await client.query('BEGIN');try{
  const id=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,version,created_at,updated_at,created_by,updated_by,origin) VALUES($1,'America/Chicago',9007199254740993,'2026-01-01T01:02:03.123456-06:00','2026-01-01T01:02:03.123456-06:00',$2,$2,'manual') RETURNING id",[name,owner])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[id,owner]);
  await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[id,owner]);await client.query('COMMIT');return id;
 }catch(e){await client.query('ROLLBACK');throw e;}}
 const allSources=()=>client.query("SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'UTF8')),'hex') AS hash FROM crest.businesses t UNION ALL SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'UTF8')),'hex') FROM crest.memberships t UNION ALL SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'UTF8')),'hex') FROM crest_private.business_recovery_authorities t").then(r=>r.rows);
 const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
 async function portable(ctx){
  const generationId=randomUUID(),wrap=(context,records)=>({formatVersion:1,assurance:'snapshot_bytes_only',generationId,context,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records}),out={};
  for(const [name,routine,kinds,context] of [['configuration','business_configuration',['business','membership','recovery_authority'],ctx],['identity','business_identity',['actor','role_capability','identity_event'],null],['history','business_history',['operation','audit_event'],null]]){
   const c=context??(await reader.query(`SELECT crest_commands.${routine}_export_context($1) AS result`,[business])).rows[0].result,records=[];
   for(const kind of kinds){let cursor=null,ended=false,count=0;for(let i=0;i<600;i++){const rows=(await reader.query(`SELECT * FROM crest_commands.${routine}_export_page($1,$2,$3,$4,20)`,[business,c.snapshotToken,kind,cursor])).rows;for(const r of rows)records.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});count+=rows.length;if(!rows.length){ended=true;break;}cursor=rows.at(-1).record_id;}assert(ended);assert.equal(String(count),c.recordCounts[kind]);}out[name]=wrap(c,records);
  }return out;
 }
 const offline=c=>verifyBusinessFoundationEvidence(JSON.stringify(c.configuration),JSON.stringify(c.identity),JSON.stringify(c.history),{businessId:business});
 const initialize=async()=>{
  ({client,sandbox}=get());bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  owner=await actor();business=await root('Synthetic, "export" 雪 = text');other=await root('Unrelated synthetic business');
  for(let i=0;i<21;i++){const id=await actor();await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,active,created_by,updated_by,origin) VALUES($1,$2,'owner',false,$3,$3,'manual')",[business,id,owner]);}
  manifest=JSON.parse(await readFile(new URL('./registered43-export-coverage.json',import.meta.url),'utf8'));
  reader=await sandbox.connect(get().target);await reader.query('SET ROLE crest_export');
 };
 test('business export context counts exactly one business root all memberships and recovery root',async()=>{
  await snapshot(async ctx=>{assert.deepEqual(Object.keys(ctx).sort(),['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'].sort());assert.equal(ctx.scope,'business_configuration');assert.equal(ctx.schemaVersion,1);assert.equal(ctx.businessId,business);assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);assert.match(ctx.observedAt,/\+00:00$/);assert.deepEqual(ctx.recordCounts,{business:'1',membership:'22',recovery_authority:'1'});});
 });
 test('business export projects all39 source columns exactly with bigint strings and no foreign business rows',async()=>{
  await client.query("SET timezone='UTC'");await snapshot(async ctx=>{
   for(const [kind,table] of Object.entries(tables)){
    const actual=[],condition=kind==='business'?'id':'business_id';let cursor=null;
    for(let i=0;i<4;i++){const rows=await page(ctx,kind,{cursor});actual.push(...rows);if(!rows.length)break;cursor=rows.at(-1).record_id;}
    const expected=(await client.query(`SELECT id,to_jsonb(t)||jsonb_build_object('version',version::text) AS row FROM ${table} t WHERE ${condition}=$1 ORDER BY id`,[business])).rows;
    assert.deepEqual(actual.map(r=>r.record_id),expected.map(r=>r.id));
    for(let i=0;i<actual.length;i++){const r=actual[i],body=JSON.parse(r.canonical_evidence);assert.equal(r.representation,'snapshot_projection');assert.deepEqual(Object.keys(r).sort(),['record_id','representation','canonical_evidence','evidence_hash'].sort());assert.deepEqual(body,{schemaVersion:1,kind,businessId:business,row:expected[i].row});assert.deepEqual(Object.keys(body.row).sort(),manifest.tables.find(t=>t.table===table).required.toSorted());assert.equal(r.evidence_hash,createHash('sha256').update(r.canonical_evidence,'utf8').digest('hex'));}
   }
   const b=JSON.parse((await page(ctx,'business'))[0].canonical_evidence).row;assert.equal(b.version,'9007199254740993');assert.equal(b.created_at,'2026-01-01T07:02:03.123456+00:00');assert.equal(b.import_row_id,null);assert.equal(b.timezone,'America/Chicago');
  });
 });
 test('offline configuration consumes all39 native source fields without mutating source rows',async()=>snapshot(async ctx=>{const before=await allSources(),c=await portable(ctx),r=verifyBusinessConfigurationEvidence(JSON.stringify(c.configuration),{businessId:business});assert.deepEqual(r.records,c.configuration.records);assert.equal(r.records.length,24);assert(r.records.some(r=>r.canonicalEvidence.includes('9007199254740993')));assert.deepEqual(await allSources(),before);assert.equal(r.referenceClosureComplete,false);assert.equal(r.completeBackup,false);}));
 test('offline configuration join binds native current roots memberships and recovery to original identity history',async()=>snapshot(async ctx=>{const c=await portable(ctx),r=offline(c);assert.equal(r.linkedConfigurationRows.length,24);assert.equal(r.configurationCurrentRowsVerified,true);assert.equal(r.includedActorReferencesVerified,true);assert.equal(r.identity.configurationCurrentRowsVerified,false);assert.deepEqual(r.configuration.records,c.configuration.records);assert.deepEqual(r.identity.records,c.identity.records);assert.deepEqual(r.history.records,c.history.records);assert.equal(r.consistentCaptureProven,false);assert.equal(r.referenceClosureComplete,false);assert.equal(r.completePortableExport,false);assert.equal(r.completeBackup,false);}));
 test('offline configuration join rejects rehashed native security state drift and corrected-count omitted membership',async()=>snapshot(async ctx=>{const c=await portable(ctx);for(const [kind,key,value] of [['business','legal_name','Synthetic changed root'],['membership','active',true],['recovery_authority','writes_enabled',true]]){const copy=structuredClone(c),r=copy.configuration.records.find(r=>r.kind===kind&&(kind!=='membership'||JSON.parse(r.canonicalEvidence).row.active===false)),b=JSON.parse(r.canonicalEvidence);b.row[key]=value;r.canonicalEvidence=JSON.stringify(b);r.evidenceHash=digest(r.canonicalEvidence);copy.configuration.evidenceBytes=copy.configuration.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);verifyBusinessConfigurationEvidence(JSON.stringify(copy.configuration),{businessId:business});assert.throws(()=>offline(copy),/BUSINESS_CONFIGURATION_EVIDENCE_REVIEW_REQUIRED/);}const copy=structuredClone(c),index=copy.configuration.records.findIndex(r=>r.kind==='membership'&&JSON.parse(r.canonicalEvidence).row.actor_id!==owner);copy.configuration.records.splice(index,1);copy.configuration.context.recordCounts.membership='21';copy.configuration.evidenceBytes=copy.configuration.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);verifyBusinessConfigurationEvidence(JSON.stringify(copy.configuration),{businessId:business});assert.throws(()=>offline(copy),/BUSINESS_CONFIGURATION_EVIDENCE_REVIEW_REQUIRED/);}));
 test('offline configuration and identity history join runs in a fresh credential-free process with exact native bigint and microseconds',async()=>snapshot(async ctx=>{const c=await portable(ctx),module=new URL('../../src/security/business-configuration-evidence.ts',import.meta.url).href,script=`import{readFileSync}from'node:fs';import{verifyBusinessFoundationEvidence as verify}from ${JSON.stringify(module)};const c=JSON.parse(readFileSync(0,'utf8')),r=verify(JSON.stringify(c.configuration),JSON.stringify(c.identity),JSON.stringify(c.history),${JSON.stringify({businessId:business})});if(process.env.CREST_TEST_DATABASE_URL||r.completeBackup||r.consistentCaptureProven||!r.configurationCurrentRowsVerified)process.exit(1);process.stdout.write(String(r.linkedConfigurationRows.length));`;assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify(c),encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000,maxBuffer:1024}),'24');}));
 test('business membership keyset pagination returns20 then2 then an empty page without repeats',async()=>snapshot(async ctx=>{
  const a=await page(ctx,'membership'),b=await page(ctx,'membership',{cursor:a.at(-1).record_id}),c=await page(ctx,'membership',{cursor:b.at(-1).record_id});assert.equal(a.length,20);assert.equal(b.length,2);assert.equal(c.length,0);const ids=[...a,...b].map(r=>r.record_id);assert.deepEqual(ids,ids.toSorted());assert.equal(new Set(ids).size,22);
 }));
 test('business export keeps inactive memberships and paused recovery configuration',async()=>snapshot(async ctx=>{
  const rows=await page(ctx,'membership');assert(rows.some(r=>JSON.parse(r.canonical_evidence).row.active===false));const root=JSON.parse((await page(ctx,'recovery_authority'))[0].canonical_evidence).row;assert.equal(root.writes_enabled,false);assert.equal(root.incident_id,null);
 }));
 test('business export includes suspended roots without promoting them into current authorization',async()=>{
  await client.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[business]);try{await snapshot(async ctx=>assert.equal(JSON.parse((await page(ctx,'business'))[0].canonical_evidence).row.status,'suspended'));}finally{await client.query("UPDATE crest.businesses SET status='setup',version=version+1 WHERE id=$1",[business]);}
 });
 test('business scope tokens cannot be used for another business even when both share an owner',async()=>snapshot(async ctx=>{
  await assert.rejects(page(ctx,'business',{id:other}),/CREST_BUSINESS_EXPORT_SNAPSHOT_MISMATCH/);
 }));
 for(const mode of ['BEGIN','BEGIN READ ONLY','BEGIN ISOLATION LEVEL REPEATABLE READ','BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'])test(`business export denies incompatible transaction ${mode}`,async()=>{
  await reader.query(mode);try{await assert.rejects(context(),/CREST_BUSINESS_EXPORT_SNAPSHOT_REQUIRED/);}finally{await reader.query('ROLLBACK');}
 });
 test('business export context rejects missing and null roots rather than returning an empty success',async()=>{
  for(const id of [randomUUID(),null]){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(context(id),/CREST_BUSINESS_EXPORT_(SOURCE_REVIEW_REQUIRED|INPUT_REQUIRED)/);}finally{await reader.query('ROLLBACK');}}
 });
 for(const size of [0,21,null])test(`business export rejects invalid page size ${size}`,async()=>snapshot(async ctx=>{await assert.rejects(page(ctx,'membership',{size}),/CREST_BUSINESS_EXPORT_INPUT_REQUIRED/);}));
 test('business export rejects unknown kinds and malformed or unrelated scope fingerprints',async()=>{
  for(const [kind,token] of [['actors',undefined],['business','bad'],['business','0'.repeat(64)],['business',null]])await snapshot(async ctx=>{await assert.rejects(page(ctx,kind,token===undefined?{}:{token}),/CREST_BUSINESS_EXPORT_(INPUT_REQUIRED|SNAPSHOT_MISMATCH)/);});
 });
 test('business snapshot keeps old root membership counts and rows during concurrent committed changes',async()=>{
  const id=await actor();await snapshot(async ctx=>{
   const original=await page(ctx,'business');await client.query("UPDATE crest.businesses SET legal_name='Synthetic concurrent rename',version=version+1 WHERE id=$1",[business]);
   await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,active,created_by,updated_by,origin) VALUES($1,$2,'owner',false,$3,$3,'manual')",[business,id,owner]);
   assert.deepEqual((await context()).recordCounts,ctx.recordCounts);assert.equal((await context()).snapshotToken,ctx.snapshotToken);assert.deepEqual(await page(ctx,'business'),original);const all=[...await page(ctx,'membership'),...await page(ctx,'membership',{cursor:(await page(ctx,'membership')).at(-1).record_id})];assert.equal(all.length,22);assert(!all.some(r=>JSON.parse(r.canonical_evidence).row.actor_id===id));
  });await snapshot(async ctx=>{assert.equal(ctx.recordCounts.membership,'23');assert.equal(JSON.parse((await page(ctx,'business'))[0].canonical_evidence).row.legal_name,'Synthetic concurrent rename');});
 });
 test('business projections are invariant under caller timezone and DateStyle settings and source reads do not mutate rows',async()=>{
  const before=await allSources();await snapshot(async ctx=>{const a=await page(ctx,'business');await reader.query("SET LOCAL timezone='Pacific/Auckland'");await reader.query("SET LOCAL datestyle='SQL, DMY'");assert.deepEqual(await page(ctx,'business'),a);});assert.deepEqual(await allSources(),before);
 });
 test('business export does not automatically expose a future sensitive source column',async()=>{
  await client.query("ALTER TABLE crest.businesses ADD COLUMN synthetic_private_field text DEFAULT 'synthetic private sentinel'");
  try{await snapshot(async ctx=>{const rows=await page(ctx,'business');assert(!rows[0].canonical_evidence.includes('synthetic_private_field'));assert(!rows[0].canonical_evidence.includes('synthetic private sentinel'));});}
  finally{await client.query('ALTER TABLE crest.businesses DROP COLUMN synthetic_private_field');}
 });
 test('business export caller cannot read raw source credentials or assume the owner role',async()=>{
  const name='crest_export_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
  await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);get().runtimeRoles.push(name);
  const url=new URL(get().target);url.username=name;url.password=password;const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  try{await sandbox.admin.query(`GRANT crest_export TO ${name}`);await c.connect();await c.query('SET ROLE crest_export');
   for(const sql of ['SELECT * FROM crest.businesses','SELECT * FROM crest.memberships','SELECT * FROM crest_private.business_recovery_authorities','SELECT token_hash FROM crest_private.app_sessions','SET ROLE crest_export_owner'])await assert.rejects(c.query(sql),e=>e.code==='42501');
  }finally{await c.end();await sandbox.admin.query(`DROP ROLE ${name}`);get().runtimeRoles.splice(get().runtimeRoles.indexOf(name),1);}
 });
 test('ordinary web worker recovery inventory cleanup and browser principals cannot execute export readers',async()=>{
  const c=await sandbox.connect(get().target);for(const role of ['crest_web','crest_worker','crest_recovery','crest_inventory','crest_cleanup','anon','authenticated']){await c.query(`SET ROLE ${role}`);await assert.rejects(context(business,c),e=>e.code==='42501');await c.query('RESET ROLE');}
 });
 test('business export owner has exact column SELECT under forced RLS and no source or provider write grants',async()=>{
  for(const table of Object.values(tables)){
   const cols=(await client.query("SELECT attname,has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT') AS allowed FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attname",[table])).rows;assert.deepEqual(cols.filter(r=>r.allowed).map(r=>r.attname),manifest.tables.find(t=>t.table===table).required.toSorted());
   const r=(await client.query("SELECT relrowsecurity,relforcerowsecurity,has_any_column_privilege('crest_export_owner',oid,'INSERT,UPDATE,REFERENCES') AS writes,has_table_privilege('crest_export_owner',oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS destructive FROM pg_class WHERE oid=$1::regclass",[table])).rows[0];assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true,writes:false,destructive:false});
  }
  for(const role of ['crest_export','crest_export_owner']){const r=(await client.query('SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname=$1',[role])).rows[0];for(const [k,v] of Object.entries(r))assert.equal(v,k==='rolconfig'?null:false);for(const table of ['auth.sessions','auth.users','crest_private.app_sessions','crest_private.actors','crest_private.identity_events'])assert.equal((await client.query("SELECT has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed",[role,table])).rows[0].allowed,false);}
 });
 test('business export routines retain fixed definer owner volatility and private execute grants',async()=>{
  const rows=(await client.query("SELECT proname,pg_get_userbyid(proowner) AS owner,prosecdef,provolatile,proconfig,has_function_privilege('crest_export',oid,'EXECUTE') AS caller,has_function_privilege('crest_web',oid,'EXECUTE') AS web FROM pg_proc WHERE pronamespace='crest_commands'::regnamespace AND proname LIKE 'business_configuration_export_%' ORDER BY proname")).rows;assert.equal(rows.length,2);for(const r of rows){assert.equal(r.owner,'crest_export_owner');assert(r.prosecdef);assert.equal(r.provolatile,'s');assert.deepEqual(r.proconfig.map(s=>s.toLowerCase()),['search_path=pg_catalog, pg_temp','row_security=on','timezone=utc','datestyle=iso, ymd']);assert(r.caller);assert.equal(r.web,false);}
 });
 test('business export migration rejects preexisting elevated role attributes before creating its routines',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(27));
  await client.query('ALTER ROLE crest_export LOGIN');try{await assert.rejects(sandbox.apply(t,await sandbox.prefix(43)));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_configuration_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await client.query('ALTER ROLE crest_export NOLOGIN');}
 });
 test('business export migration rejects a preexisting role membership link',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(27));
  await client.query('GRANT crest_export TO crest_worker');try{await assert.rejects(sandbox.apply(t,await sandbox.prefix(43)));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_configuration_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await client.query('REVOKE crest_export FROM crest_worker');}
 });
 test('business export migration rejects preexisting column grants without adopting them',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(27));
  await c.query('GRANT SELECT(id) ON crest_private.actors TO crest_export');try{await assert.rejects(sandbox.apply(t,await sandbox.prefix(43)));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_configuration_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await c.query('REVOKE SELECT(id) ON crest_private.actors FROM crest_export');}
 });
 async function withCollector(work){
  const name='crest_capture_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');assert.match(name,/^crest_capture_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);get().runtimeRoles.push(name);
  try{await sandbox.admin.query(`GRANT crest_export TO ${name} WITH INHERIT FALSE`);const url=new URL(get().target);url.username=name;url.password=password;return await work({connectionString:url.toString(),environment:'test',businessId:business});}
  finally{await sandbox.admin.query(`DROP ROLE ${name}`);get().runtimeRoles.splice(get().runtimeRoles.indexOf(name),1);}
 }
 test('business foundation collector captures complete native source groups with real restricted credentials and multi-page memberships',async()=>withCollector(async captureConfig=>{
  const expected=(await client.query('SELECT version::text,(SELECT count(*)::int FROM crest.memberships WHERE business_id=$1) AS memberships FROM crest.businesses WHERE id=$1',[business])).rows[0];assert(expected.memberships>=22);
  const before=await allSources(),sealed=await createBusinessFoundationCollector(captureConfig)(new AbortController().signal),value=sealed.forServer(),parts=['configuration','identity','history'].map(k=>JSON.parse(value[k]));
  assert.throws(()=>JSON.stringify(sealed),/BUSINESS_FOUNDATION_CAPTURE_PRIVATE/);assert.equal(value.capture,'single_connection_repeatable_read');assert.equal(value.businessId,business);
  assert.equal(new Set(parts.map(p=>p.generationId)).size,1);assert.equal(new Set(parts.map(p=>p.context.observedAt)).size,1);assert.equal(new Set(parts.map(p=>p.context.snapshotToken)).size,3);
  const report=verifyBusinessFoundationEvidence(value.configuration,value.identity,value.history,{businessId:business});assert.equal(report.configurationCurrentRowsVerified,true);assert.equal(report.includedActorReferencesVerified,true);assert.equal(report.configuration.records.length,expected.memberships+2);assert.equal(report.configuration.context.recordCounts.membership,String(expected.memberships));assert.equal(report.completePortableExport,false);assert.equal(report.completeBackup,false);
  const root=JSON.parse(report.configuration.records.find(r=>r.kind==='business').canonicalEvidence).row;assert.equal(root.version,expected.version);assert(BigInt(root.version)>9007199254740991n);assert.equal(root.created_at,'2026-01-01T07:02:03.123456+00:00');
  assert.equal(value.recordCount,parts.reduce((n,p)=>n+p.records.length,0));assert.equal(value.evidenceBytes,parts.reduce((n,p)=>n+p.evidenceBytes,0));assert.deepEqual(await allSources(),before);
 }));
 test('business foundation collector retains its original snapshot across a real lock wait and concurrent committed root change',{timeout:30000},async()=>withCollector(async captureConfig=>{
  const lock=await sandbox.connect(get().target),before=(await client.query('SELECT legal_name,version::text FROM crest.businesses WHERE id=$1',[business])).rows[0];let locked=false,pending;
  try{
   await lock.query('BEGIN');await lock.query('LOCK TABLE crest_private.audit_events IN ACCESS EXCLUSIVE MODE');locked=true;
   pending=createBusinessFoundationCollector(captureConfig)(new AbortController().signal).then(value=>({value}),error=>({error}));
   let observed=false;const deadline=performance.now()+1500;
   while(performance.now()<deadline){const r=await client.query("SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE application_name='crest_business_capture' AND wait_event_type='Lock' AND backend_xmin IS NOT NULL");if(r.rows[0].n===1){observed=true;break;}}
   assert(observed,'capture must own an actual snapshot while waiting for the source lock');
   await client.query("UPDATE crest.businesses SET legal_name='Synthetic committed after capture snapshot',version=version+1 WHERE id=$1",[business]);
   await lock.query('COMMIT');locked=false;
   const result=await pending;assert(!result.error,'native capture must finish with its original snapshot');const value=result.value.forServer(),report=verifyBusinessFoundationEvidence(value.configuration,value.identity,value.history,{businessId:business});
   const old=JSON.parse(report.configuration.records.find(r=>r.kind==='business').canonicalEvidence).row;assert.equal(old.legal_name,before.legal_name);assert.equal(old.version,before.version);assert(!value.identity.includes('Synthetic committed after capture snapshot'));
   const fresh=(await createBusinessFoundationCollector(captureConfig)(new AbortController().signal)).forServer(),current=verifyBusinessFoundationEvidence(fresh.configuration,fresh.identity,fresh.history,{businessId:business});
   const next=JSON.parse(current.configuration.records.find(r=>r.kind==='business').canonicalEvidence).row;assert.equal(next.legal_name,'Synthetic committed after capture snapshot');assert.equal(next.version,String(BigInt(before.version)+1n));assert.notEqual(fresh.generationId,value.generationId);
  }finally{if(locked)await lock.query('ROLLBACK');await pending;await lock.end();}
 }));
 test('business foundation collector refuses privileged login and its restricted role still cannot read raw sources or assume ownership',async()=>withCollector(async captureConfig=>{
  await assert.rejects(createBusinessFoundationCollector({...captureConfig,connectionString:get().target})(new AbortController().signal),/BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED/);
  const c=new pg.Client({connectionString:captureConfig.connectionString,options:'-c role=crest_export',connectionTimeoutMillis:5000});await c.connect();
  try{for(const sql of ['SELECT * FROM crest.businesses','SELECT token_hash FROM crest_private.app_sessions','SELECT * FROM crest_private.operations','SET ROLE crest_export_owner'])await assert.rejects(c.query(sql),e=>e.code==='42501');}
  finally{await c.end();}
 }));
 return initialize;
}
