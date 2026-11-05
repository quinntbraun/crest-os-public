import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';
import {verifyBusinessHistoryEvidence} from '../../src/security/business-history-evidence.ts';

// Closed-storage synthetic probes, not a generic application command API.
// The parent explicitly awaits the returned initializer after migrations.
export function businessHistoryExportTests(get){
 let client,sandbox,reader,owner,author,business,other,empty,manifest;
 const tables={operation:'crest_private.operations',audit_event:'crest_private.audit_events'};
 const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
 const context=(id=business,c=reader)=>c.query('SELECT crest_commands.business_history_export_context($1) AS result',[id]).then(r=>r.rows[0].result);
 const page=(ctx,kind,{id=ctx.businessId,token=ctx.snapshotToken,cursor=null,size=20,c=reader}={})=>c.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,$5)',[id,token,kind,cursor,size]).then(r=>r.rows);
 async function snapshot(work,id=business){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work(await context(id));}finally{await reader.query('ROLLBACK');}}
 async function all(ctx,kind,size=20){const out=[];let cursor=null;for(let i=0;i<100;i++){const rows=await page(ctx,kind,{cursor,size});out.push(...rows);if(!rows.length)return out;cursor=rows.at(-1).record_id;}assert.fail('fixture pagination limit');}
 async function root(label){await client.query('BEGIN');try{
  const id=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES($1,'America/Chicago',$2,$2,'manual') RETURNING id",[label,owner])).rows[0].id;
  for(const actor of [owner,author])await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[id,actor,owner]);
  await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[id,owner]);await client.query('COMMIT');return id;
 }catch(e){await client.query('ROLLBACK');throw e;}}
 async function claim(id=business){return (await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'synthetic.export_probe',1,$4,$5,$3,'manual') RETURNING id,operation_id",[id,randomUUID(),author,randomUUID(),digest('synthetic history payload')])).rows[0];}
 async function commit(id=business,delta={schemaVersion:1,before:null,after:{label:'Synthetic, "history" 雪',counter: '9007199254740993'}}){
  await client.query('BEGIN');try{const o=await claim(id);
   const a=(await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,effective_at,delta,created_by,origin) VALUES($1,$2,$3,'businesses',$1,9007199254740993,'synthetic.export_probe','Synthetic evidence','2026-01-01T01:02:03.123456-06:00',$4::jsonb,$3,'manual') RETURNING id",[id,o.operation_id,author,typeof delta==='string'?delta:JSON.stringify(delta)])).rows[0].id;
   await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$2::jsonb WHERE id=$1",[o.id,'{"schemaVersion":1,"counter":9007199254740993,"ids":[]}']);await client.query('COMMIT');return {...o,audit:a};
  }catch(e){await client.query('ROLLBACK');throw e;}
 }
 const hashes=async()=>{const out=[];for(const t of Object.values(tables))out.push((await client.query(`SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${t} t`)).rows[0].hash);return out;};
 async function changeAudit(id,field,value){assert(['entity_id','event_hash'].includes(field));await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.audit_events DISABLE TRIGGER retained_update');await client.query(`UPDATE crest_private.audit_events SET ${field}=$2 WHERE id=$1`,[id,value]);await client.query('ALTER TABLE crest_private.audit_events ENABLE TRIGGER retained_update');await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}}
 const initialize=async()=>{
  ({client,sandbox}=get());const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const actor=async label=>(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner',$1,'https://auth.example.com/auth/v1',$2,$3,$3,'manual') RETURNING id",[label,randomUUID(),bootstrap])).rows[0].id;
  owner=await actor('Synthetic history owner');author=await actor('Synthetic historical author');business=await root('Synthetic history scope');other=await root('Unrelated history scope');empty=await root('Empty history scope');
  for(let i=0;i<23;i++)await commit();await commit(other);
  await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE actor_id=$1',[author]);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[author]);
  manifest=JSON.parse(await readFile(new URL('./registered43-export-coverage.json',import.meta.url),'utf8'));
  reader=await sandbox.connect(get().target);await reader.query('SET ROLE crest_export');
 };
 test('history context counts every selected operation and audit and permits a valid empty history scope',async()=>{
  await snapshot(async ctx=>{assert.deepEqual(Object.keys(ctx).sort(),['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'].sort());assert.equal(ctx.schemaVersion,1);assert.equal(ctx.scope,'business_history');assert.equal(ctx.businessId,business);assert.deepEqual(ctx.recordCounts,{operation:'23',audit_event:'23'});assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);assert.match(ctx.observedAt,/\+00:00$/);});
  await snapshot(async ctx=>{assert.deepEqual(ctx.recordCounts,{operation:'0',audit_event:'0'});for(const kind of Object.keys(tables))assert.deepEqual(await page(ctx,kind),[]);},empty);
 });
 test('history projections preserve all36 source columns with an explicit JSON text dictionary',async()=>{
  await client.query("SET timezone='UTC'");await snapshot(async ctx=>{for(const [kind,table] of Object.entries(tables)){
   const source=(await client.query(`SELECT id,to_jsonb(t)||${kind==='operation'?"jsonb_build_object('result',result::text)":"jsonb_build_object('delta',delta::text,'payload',payload::text,'entity_version',entity_version::text)"} AS row FROM ${table} t WHERE business_id=$1 ORDER BY id`,[business])).rows;
   const rows=await all(ctx,kind);assert.deepEqual(rows.map(r=>r.record_id),source.map(r=>r.id));
   for(let i=0;i<rows.length;i++){const r=rows[i],b=JSON.parse(r.canonical_evidence);assert.equal(r.representation,'snapshot_projection');assert.deepEqual(b,{schemaVersion:1,kind,businessId:business,jsonTextColumns:kind==='operation'?['result']:['delta','payload'],row:source[i].row});assert.deepEqual(Object.keys(b.row).sort(),manifest.tables.find(t=>t.table===table).required.toSorted());assert.equal(r.evidence_hash,digest(r.canonical_evidence));}
  }});
 });
 test('history retains original audit hash-input bytes hash and source bindings separately from the new wrapper hash',async()=>snapshot(async ctx=>{
  for(const r of await all(ctx,'audit_event')){const b=JSON.parse(r.canonical_evidence),row=b.row,p=JSON.parse(row.payload);assert.equal(row.payload,row.hash_input);assert.equal(row.event_hash,digest(row.hash_input));assert.equal(p.id,row.id);assert.equal(p.businessId,business);assert.equal(p.entityVersion,'9007199254740993');assert.equal(row.entity_version,'9007199254740993');assert.equal(p.effectiveAt,'2026-01-01T07:02:03.123456Z');assert.notEqual(r.evidence_hash,row.event_hash);}
 }));
 test('offline history verification accepts exact PostgreSQL evidence and reports unresolved historical actors',async()=>snapshot(async ctx=>{
  const records=[];for(const kind of Object.keys(tables))for(const r of await all(ctx,kind))records.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});
  const input={formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:ctx,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records};
  const report=verifyBusinessHistoryEvidence(JSON.stringify(input),{businessId:business});assert.deepEqual(report.records,records);assert.deepEqual(report.requiredActorIds,[author]);assert.equal(report.referenceClosureComplete,false);assert.equal(report.completePortableExport,false);assert.equal(report.completeBackup,false);
 }));
 test('offline verification rejects rounded exact PostgreSQL delta values even after the wrapper hash is replaced',async()=>{
  const id=await root('Synthetic exact numeric history');await commit(id,'{"schemaVersion":1,"before":null,"after":{"counter":9007199254740993,"fraction":0.12345678901234567890123456789}}');await snapshot(async ctx=>{
  const records=[];for(const kind of Object.keys(tables))for(const r of await all(ctx,kind))records.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});
  const input0={formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:ctx,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records};assert.equal(verifyBusinessHistoryEvidence(JSON.stringify(input0),{businessId:id}).records.length,2);
  const row=records.find(r=>r.kind==='audit_event'),b=JSON.parse(row.canonicalEvidence);assert(b.row.delta.includes('9007199254740993'));assert(b.row.delta.includes('0.12345678901234567890123456789'));b.row.delta=b.row.delta.replace('9007199254740993','9007199254740992');row.canonicalEvidence=JSON.stringify(b);row.evidenceHash=digest(row.canonicalEvidence);
  const input={formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:ctx,evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records};
  assert.throws(()=>verifyBusinessHistoryEvidence(JSON.stringify(input),{businessId:id}),/BUSINESS_HISTORY_EVIDENCE_REVIEW_REQUIRED/);
 },id);});
 test('offline verification detects an omitted PostgreSQL audit even with a corrected declared count',async()=>snapshot(async ctx=>{
  const records=[];for(const kind of Object.keys(tables))for(const r of await all(ctx,kind))records.push({kind,recordId:r.record_id,representation:r.representation,canonicalEvidence:r.canonical_evidence,evidenceHash:r.evidence_hash});
  records.splice(records.findIndex(r=>r.kind==='audit_event'),1);const input={formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:{...ctx,recordCounts:{...ctx.recordCounts,audit_event:'22'}},evidenceBytes:records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0),records};
  assert.throws(()=>verifyBusinessHistoryEvidence(JSON.stringify(input),{businessId:business}),/BUSINESS_HISTORY_EVIDENCE_REVIEW_REQUIRED/);
 }));
 test('operation result JSON retains unsafe integer lexemes without decoding them through Number',async()=>snapshot(async ctx=>{
  const row=JSON.parse((await page(ctx,'operation'))[0].canonical_evidence).row;assert.equal(typeof row.result,'string');assert(row.result.includes('9007199254740993'));assert.notEqual(row.recovery_epoch,(await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[business])).rows[0].active_epoch);
 }));
 test('history pagination returns20 then3 then empty in strict UUID order',async()=>snapshot(async ctx=>{
  for(const kind of Object.keys(tables)){const a=await page(ctx,kind),b=await page(ctx,kind,{cursor:a.at(-1).record_id}),c=await page(ctx,kind,{cursor:b.at(-1).record_id});assert.equal(a.length,20);assert.equal(b.length,3);assert.equal(c.length,0);const ids=[...a,...b].map(r=>r.record_id);assert.deepEqual(ids,ids.toSorted());assert.equal(new Set(ids).size,23);}
 }));
 test('history retains disabled inactive historical authors and paused/suspended roots without actor reads',async()=>{
  await client.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[business]);try{await snapshot(async ctx=>{assert.equal(ctx.recordCounts.operation,'23');for(const r of await all(ctx,'operation'))assert.equal(JSON.parse(r.canonical_evidence).row.actor_id,author);});}finally{await client.query("UPDATE crest.businesses SET status='setup',version=version+1 WHERE id=$1",[business]);}
 });
 test('history does not mix another business even when both share owner and author IDs',async()=>{
  await snapshot(async ctx=>{for(const kind of Object.keys(tables))for(const r of await all(ctx,kind))assert.equal(JSON.parse(r.canonical_evidence).row.business_id,business);});
  await snapshot(async ctx=>{assert.deepEqual(ctx.recordCounts,{operation:'1',audit_event:'1'});},other);
 });
 test('history refuses another business or the configuration scope fingerprint',async()=>{
  await snapshot(async ctx=>{await assert.rejects(page(ctx,'operation',{id:other}),/CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_MISMATCH/);});
  await snapshot(async ctx=>{const token=(await reader.query('SELECT crest_commands.business_configuration_export_context($1) AS result',[business])).rows[0].result.snapshotToken;assert.notEqual(token,ctx.snapshotToken);await assert.rejects(page(ctx,'operation',{token}),/CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_MISMATCH/);});
 });
 for(const mode of ['BEGIN','BEGIN READ ONLY','BEGIN ISOLATION LEVEL REPEATABLE READ','BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY'])test(`history denies incompatible transaction ${mode}`,async()=>{await reader.query(mode);try{await assert.rejects(context(),/CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_REQUIRED/);}finally{await reader.query('ROLLBACK');}});
 for(const size of [0,21,null])test(`history rejects invalid page size ${size}`,async()=>snapshot(async ctx=>{await assert.rejects(page(ctx,'operation',{size}),/CREST_BUSINESS_HISTORY_EXPORT_INPUT_REQUIRED/);}));
 test('history rejects missing or null business and unknown kinds or invalid fingerprints',async()=>{
  for(const id of [randomUUID(),null]){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(context(id),/CREST_BUSINESS(?:_HISTORY)?_EXPORT_(SOURCE_REVIEW_REQUIRED|INPUT_REQUIRED)/);}finally{await reader.query('ROLLBACK');}}
  for(const [kind,token] of [['actor',undefined],['operation','bad'],['operation','0'.repeat(64)],['operation',null]])await snapshot(async ctx=>{await assert.rejects(page(ctx,kind,token===undefined?{}:{token}),/CREST_BUSINESS_HISTORY_EXPORT_(INPUT_REQUIRED|SNAPSHOT_MISMATCH)/);});
 });
 test('history reads do not alter original source rows and caller timezone or DateStyle cannot alter the bytes',async()=>{
  const before=await hashes();await snapshot(async ctx=>{const a=await all(ctx,'audit_event');await reader.query("SET LOCAL timezone='Pacific/Auckland'; SET LOCAL datestyle='SQL, DMY'");assert.deepEqual(await all(ctx,'audit_event'),a);});assert.deepEqual(await hashes(),before);
 });
 test('history does not see an uncommitted claim and rollback leaves no missing invented audit fact',async()=>{
  await client.query('BEGIN');try{await claim();await snapshot(async ctx=>{assert.equal(ctx.recordCounts.operation,'23');assert.equal((await all(ctx,'operation')).length,23);});}finally{await client.query('ROLLBACK');}await snapshot(async ctx=>assert.equal(ctx.recordCounts.operation,'23'));
 });
 test('one history snapshot excludes a concurrent committed receipt and audit while the next snapshot includes both',async()=>{
  let added;await snapshot(async ctx=>{const before=await all(ctx,'operation');added=await commit();assert.deepEqual(await all(ctx,'operation'),before);assert.deepEqual((await context()).recordCounts,ctx.recordCounts);assert.equal((await context()).snapshotToken,ctx.snapshotToken);assert(!(await all(ctx,'audit_event')).some(r=>r.record_id===added.audit));});
  await snapshot(async ctx=>{assert.deepEqual(ctx.recordCounts,{operation:'24',audit_event:'24'});assert((await all(ctx,'operation')).some(r=>r.record_id===added.id));assert((await all(ctx,'audit_event')).some(r=>r.record_id===added.audit));});
 });
 test('future private source columns are not automatically serialized into history projections',async()=>{
  for(const [kind,table] of Object.entries(tables)){await client.query(`ALTER TABLE ${table} ADD COLUMN synthetic_private_field text DEFAULT 'synthetic private sentinel'`);try{await snapshot(async ctx=>{const s=(await page(ctx,kind))[0].canonical_evidence;assert(!s.includes('synthetic_private_field'));assert(!s.includes('synthetic private sentinel'));});}finally{await client.query(`ALTER TABLE ${table} DROP COLUMN synthetic_private_field`);}}
 });
 test('an operation with its matching audit hidden by restrictive RLS fails instead of exporting incomplete evidence',async()=>{
  const before=await hashes();await client.query('CREATE POLICY synthetic_hide_history_audits ON crest_private.audit_events AS RESTRICTIVE FOR SELECT TO crest_export_owner USING(false)');
  try{await snapshot(async ctx=>{assert.equal(ctx.recordCounts.operation,'24');assert.equal(ctx.recordCounts.audit_event,'0');await assert.rejects(page(ctx,'operation'),/CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED/);});}
  finally{await client.query('DROP POLICY synthetic_hide_history_audits ON crest_private.audit_events');}
  assert.deepEqual(await hashes(),before);await snapshot(async ctx=>assert.equal(ctx.recordCounts.audit_event,'24'));
 });
 test('an audit with valid original bytes and hash but contradictory source metadata fails the whole page',async()=>{
  const old=(await client.query('SELECT id,entity_id,hash_input,event_hash FROM crest_private.audit_events WHERE business_id=$1 ORDER BY id LIMIT 1',[business])).rows[0];
  await changeAudit(old.id,'entity_id',randomUUID());try{assert.equal((await client.query('SELECT event_hash FROM crest_private.audit_events WHERE id=$1',[old.id])).rows[0].event_hash,old.event_hash);await snapshot(async ctx=>assert.rejects(page(ctx,'audit_event'),/CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED/));}finally{await changeAudit(old.id,'entity_id',old.entity_id);}
 });
 test('a restored audit with a corrupted original hash is rejected without rewriting its original body',async()=>{
  const old=(await client.query('SELECT id,event_hash,hash_input FROM crest_private.audit_events WHERE business_id=$1 ORDER BY id LIMIT 1',[business])).rows[0];
  const constraint=(await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='crest_private.audit_events'::regclass AND contype='c'")).rows.find(r=>r.definition.includes('hash_input')&&r.definition.includes('event_hash'));assert(constraint);assert(/^[a-z_0-9]+$/.test(constraint.conname));
  // Disposable restored-source corruption fixture. RLS remains forced; the
  // original CHECK and retained trigger are reinstated before leaving.
  await client.query(`ALTER TABLE crest_private.audit_events DROP CONSTRAINT ${constraint.conname}`);
  try{await changeAudit(old.id,'event_hash','0'.repeat(64));await snapshot(async ctx=>assert.rejects(page(ctx,'audit_event'),/CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED/));assert.equal((await client.query('SELECT hash_input FROM crest_private.audit_events WHERE id=$1',[old.id])).rows[0].hash_input,old.hash_input);}
  finally{await changeAudit(old.id,'event_hash',old.event_hash);await client.query(`ALTER TABLE crest_private.audit_events ADD CONSTRAINT ${constraint.conname} ${constraint.definition}`);}
 });
 test('large legal audit records preserve every original byte and a page over8MiB fails instead of truncating',async()=>{
  const id=await root('Synthetic bounded history');const delta={schemaVersion:1,before:null,after:{text:String.fromCharCode(92,34).repeat(50000)}};for(let i=0;i<10;i++)await commit(id,delta);
  await snapshot(async ctx=>{assert.equal(ctx.recordCounts.audit_event,'10');const one=await page(ctx,'audit_event',{size:1});const bytes=Buffer.byteLength(one[0].canonical_evidence);assert(bytes<2097152);assert(bytes*10>8388608);const row=JSON.parse(one[0].canonical_evidence).row;assert.equal(row.event_hash,digest(row.hash_input));assert.equal(JSON.parse(row.delta).after.text,delta.after.text);},id);
  await snapshot(async ctx=>assert.rejects(page(ctx,'audit_event'),/CREST_BUSINESS_HISTORY_EXPORT_BUDGET_REQUIRED/),id);
  await snapshot(async ctx=>assert.equal((await all(ctx,'audit_event',1)).length,10),id);
 });
 test('a real restricted export login has no raw history writes reads or definer role membership',async()=>{
  const name='crest_history_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);get().runtimeRoles.push(name);const url=new URL(get().target);url.username=name;url.password=password;const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  try{await sandbox.admin.query(`GRANT crest_export TO ${name}`);await c.connect();await c.query('SET ROLE crest_export');for(const sql of ['SELECT * FROM crest_private.operations','SELECT * FROM crest_private.audit_events','SELECT token_hash FROM crest_private.app_sessions','UPDATE crest_private.operations SET state=state','SET ROLE crest_export_owner'])await assert.rejects(c.query(sql),e=>e.code==='42501');}
  finally{await c.end();await sandbox.admin.query(`DROP ROLE ${name}`);get().runtimeRoles.splice(get().runtimeRoles.indexOf(name),1);}
 });
 test('ordinary web worker recovery inventory cleanup browser and service roles cannot execute history extraction',async()=>{
  const c=await sandbox.connect(get().target);for(const role of ['crest_web','crest_worker','crest_recovery','crest_inventory','crest_cleanup','anon','authenticated','service_role']){await c.query(`SET ROLE ${role}`);await assert.rejects(context(business,c),e=>e.code==='42501');await c.query('RESET ROLE');}
 });
 test('history owner has exact36 added safe column grants forced RLS no writes and no actor session or provider access',async()=>{
  for(const table of Object.values(tables)){const cols=(await client.query("SELECT attname,has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT') AS allowed FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attname",[table])).rows;assert.deepEqual(cols.filter(r=>r.allowed).map(r=>r.attname),manifest.tables.find(t=>t.table===table).required.toSorted());const r=(await client.query("SELECT relrowsecurity,relforcerowsecurity,has_any_column_privilege('crest_export_owner',oid,'INSERT,UPDATE,REFERENCES') AS writes,has_table_privilege('crest_export_owner',oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS destructive FROM pg_class WHERE oid=$1::regclass",[table])).rows[0];assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true,writes:false,destructive:false});}
  for(const table of ['auth.sessions','auth.users','crest_private.actors','crest_private.app_sessions','crest_private.identity_events'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_export_owner',$1,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed",[table])).rows[0].allowed,false);
 });
 test('history routines preserve fixed owner volatility private execute and settings',async()=>{
  const rows=(await client.query("SELECT proconfig,prosecdef,provolatile,pg_get_userbyid(proowner) AS owner,has_function_privilege('crest_export',oid,'EXECUTE') AS caller,has_function_privilege('crest_web',oid,'EXECUTE') AS web FROM pg_proc WHERE pronamespace='crest_commands'::regnamespace AND proname LIKE 'business_history_export_%'")).rows;assert.equal(rows.length,2);for(const r of rows){assert.equal(r.owner,'crest_export_owner');assert(r.prosecdef);assert.equal(r.provolatile,'s');assert(r.caller);assert.equal(r.web,false);assert.deepEqual(r.proconfig.map(s=>s.toLowerCase()),['search_path=pg_catalog, pg_temp','row_security=on','timezone=utc','datestyle=iso, ymd']);}
 });
 test('history upgrade rejects preexisting provider-column privilege drift before adding routines',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(28));await c.query('GRANT SELECT(id) ON auth.sessions TO crest_export_owner');try{await assert.rejects(sandbox.apply(t,await sandbox.prefix(43)));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_history_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await c.query('REVOKE SELECT(id) ON auth.sessions FROM crest_export_owner');}
 });
 return initialize;
}
