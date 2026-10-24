import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';

// Synthetic storage probes. The parent awaits initialization after schema30.
export function businessIdentityExportTests(get){
 let client,sandbox,reader,bootstrap,owner,ancestor,oldOperator,olderAncestor,business,other,unrelated,manifest;
 const actorIds=new Set(),tables={actor:'crest_private.actors',role_capability:'crest_private.role_capabilities',identity_event:'crest_private.identity_events'};
 const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
 const context=(id=business,c=reader)=>c.query('SELECT crest_commands.business_identity_export_context($1) AS result',[id]).then(r=>r.rows[0].result);
 const page=(ctx,kind,{id=ctx.businessId,token=ctx.snapshotToken,cursor=null,size=20,c=reader}={})=>c.query('SELECT * FROM crest_commands.business_identity_export_page($1,$2,$3,$4,$5)',[id,token,kind,cursor,size]).then(r=>r.rows);
 async function snapshot(work,id=business){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work(await context(id));}finally{await reader.query('ROLLBACK');}}
 async function all(ctx,kind){const out=[];let cursor=null;for(let i=0;i<600;i++){const rows=await page(ctx,kind,{cursor});out.push(...rows);if(!rows.length)return out;cursor=rows.at(-1).record_id;}assert.fail('synthetic identity pagination bound');}
 async function actor(label,creator=bootstrap,version='1'){
  return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,version,created_by,updated_by,origin) VALUES('owner',$1,'https://auth.example.com/auth/v1',$2,$3,$4,$4,'manual') RETURNING id",[label,randomUUID(),version,creator])).rows[0].id;
 }
 async function root(label,who=owner){await client.query('BEGIN');try{
  const id=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES($1,'America/Chicago',$2,$2,'manual') RETURNING id",[label,who])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[id,who]);
  await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[id,who]);await client.query('COMMIT');return id;
 }catch(e){await client.query('ROLLBACK');throw e;}}
 const member=(who,id=business)=>client.query("INSERT INTO crest.memberships(business_id,actor_id,role,active,created_by,updated_by,origin) VALUES($1,$2,'owner',false,$3,$3,'manual')",[id,who,owner]);
 const events=(id=owner)=>client.query("SELECT id,entity_version::text,payload::text AS body,event_hash FROM crest_private.identity_events WHERE business_id IS NULL AND entity_kind='actors' AND entity_id=$1 ORDER BY entity_version",[id]).then(r=>r.rows);
 const patched=async(id,path,value)=>(await client.query('SELECT jsonb_set(payload,$2::text[],$3::jsonb)::text AS body FROM crest_private.identity_events WHERE id=$1',[id,path,JSON.stringify(value)])).rows[0].body;
 const hashes=async()=>{const out=[];for(const t of Object.values(tables))out.push((await client.query(`SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'UTF8')),'hex') AS hash FROM ${t} t`)).rows[0].hash);return out;};
 async function eventChange(id,field,value){assert(['event_hash','database_principal','payload'].includes(field));await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.identity_events DISABLE TRIGGER retained_update');await client.query(`UPDATE crest_private.identity_events SET ${field}=$2${field==='payload'?'::jsonb':''}${field==='payload'?",event_hash=encode(sha256(convert_to(($2::jsonb)::text,'UTF8')),'hex')":''} WHERE id=$1`,[id,value]);await client.query('ALTER TABLE crest_private.identity_events ENABLE TRIGGER retained_update');await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}}
 async function policy(table,condition,work){await client.query(`CREATE POLICY synthetic_identity_filter ON ${table} AS RESTRICTIVE FOR SELECT TO crest_identity_export_owner USING(${condition})`);try{await work();}finally{await client.query(`DROP POLICY synthetic_identity_filter ON ${table}`);}}
 const fails=()=>snapshot(()=>assert.fail('invalid source must fail')).then(()=>assert.fail('expected source review'),e=>assert.match(e.message,/CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED/));
 const initialize=async()=>{
  ({client,sandbox}=get());bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  ancestor=await actor('Synthetic creator');olderAncestor=await actor('Synthetic historical operator creator');oldOperator=await actor('Synthetic historical operator',olderAncestor);
  await client.query("SET timezone='Pacific/Auckland'");owner=await actor('Synthetic identity owner',ancestor,'9007199254740993');
  await client.query("UPDATE crest_private.actors SET display_label='Synthetic intermediate identity',updated_by=$2,version=version+1 WHERE id=$1",[owner,oldOperator]);
  await client.query("SET timezone='America/Chicago'");await client.query("UPDATE crest_private.actors SET display_label='Synthetic current identity',updated_by=$2,version=version+1 WHERE id=$1",[owner,ancestor]);await client.query("SET timezone='UTC'");
  business=await root('Synthetic identity scope');other=await root('FOREIGN BUSINESS PRIVATE SENTINEL');unrelated=await actor('UNRELATED ACTOR PRIVATE SENTINEL');await member(unrelated,other);
  for(const id of [bootstrap,owner,ancestor,oldOperator,olderAncestor])actorIds.add(id);
  for(let i=0;i<22;i++){const id=await actor('Synthetic inactive historical identity '+i,owner);await member(id);actorIds.add(id);if(i===0)await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[id]);}
  manifest=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));reader=await sandbox.connect(get().target);await reader.query('SET ROLE crest_export');
 };
 test('identity context reports exact bounded actor ancestry catalog and original event counts',async()=>snapshot(async ctx=>{
  assert.deepEqual(Object.keys(ctx).sort(),['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'].sort());assert.equal(ctx.schemaVersion,1);assert.equal(ctx.scope,'business_identity');assert.equal(ctx.businessId,business);assert.equal(ctx.recordCounts.actor,String(actorIds.size));assert.equal(ctx.recordCounts.role_capability,'5');assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);assert.match(ctx.observedAt,/\+00:00$/);
  assert.equal(ctx.recordCounts.identity_event,String((await all(ctx,'identity_event')).length));
 }));
 test('identity projections preserve all38 explicit source columns with exact versions JSON text and declared dictionaries',async()=>snapshot(async ctx=>{
  for(const [kind,table] of Object.entries(tables)){
   const where=kind==='actor'?'t.id=ANY($1::uuid[])':kind==='role_capability'?'true':"t.business_id=$2 OR t.business_id IS NULL AND (t.entity_kind='actors' AND t.entity_id=ANY($1::uuid[]) OR t.entity_kind='role_capabilities')";
   const patch=kind==='actor'?"jsonb_build_object('version',version::text)":kind==='identity_event'?"jsonb_build_object('entity_version',entity_version::text,'payload',payload::text)":"'{}'::jsonb";
   const source=(await client.query(`SELECT id,to_jsonb(t)||${patch} AS row FROM ${table} t WHERE ${where} ORDER BY id`,kind==='actor'?[[...actorIds]]:kind==='role_capability'?[]:[[...actorIds],business])).rows;
   const rows=await all(ctx,kind);assert.deepEqual(rows.map(r=>r.record_id),source.map(r=>r.id));
   for(let i=0;i<rows.length;i++){const r=rows[i],b=JSON.parse(r.canonical_evidence);assert.equal(r.representation,'snapshot_projection');assert.equal(r.evidence_hash,digest(r.canonical_evidence));assert.deepEqual(b,{schemaVersion:1,kind,businessId:business,jsonTextColumns:kind==='identity_event'?['payload']:[],row:source[i].row});assert.deepEqual(Object.keys(b.row).sort(),manifest.tables.find(t=>t.table===table).required.toSorted());}
  }
 }));
 test('identity events retain original hashes unsafe numeric lexemes offsets and historical versions separately from wrapper hashes',async()=>snapshot(async ctx=>{
  const profile=JSON.parse((await all(ctx,'actor')).find(r=>r.record_id===owner).canonical_evidence).row;assert.equal(profile.version,'9007199254740995');
  const rows=(await all(ctx,'identity_event')).filter(r=>{const b=JSON.parse(r.canonical_evidence).row;return b.entity_kind==='actors'&&b.entity_id===owner;});assert.equal(rows.length,3);
  for(const r of rows){const row=JSON.parse(r.canonical_evidence).row;assert.equal(row.event_hash,digest(row.payload));assert.notEqual(row.event_hash,r.evidence_hash);assert.match(row.entity_version,/^900719925474099[345]$/);assert(row.payload.includes(row.entity_version));}assert(rows.some(r=>/\+(12|13):00/.test(JSON.parse(r.canonical_evidence).row.payload)));
 }));
 test('identity keyset pages preserve exclusive UUID order through multiple pages and empty exhaustion',async()=>snapshot(async ctx=>{
  for(const kind of ['actor','identity_event']){const a=await page(ctx,kind),b=await page(ctx,kind,{cursor:a.at(-1).record_id}),rows=await all(ctx,kind);assert.equal(a.length,20);assert(b.length>0);assert.deepEqual(rows.map(r=>r.record_id),[...new Set(rows.map(r=>r.record_id))].sort());assert.deepEqual(await page(ctx,kind,{cursor:rows.at(-1).record_id}),[]);}
 }));
 test('historical operators creator ancestry and disabled inactive actors remain included without current eligibility filtering',async()=>snapshot(async ctx=>{
  const rows=(await all(ctx,'actor')).map(r=>JSON.parse(r.canonical_evidence).row),ids=rows.map(r=>r.id);for(const id of [oldOperator,olderAncestor,ancestor,bootstrap])assert(ids.includes(id));assert(rows.some(r=>r.disabled_at!==null));assert(!ids.includes(unrelated));
 }));
 test('shared actors never include another business memberships events names or unrelated global actor profiles',async()=>snapshot(async ctx=>{
  for(const kind of Object.keys(tables))for(const r of await all(ctx,kind)){assert(!r.canonical_evidence.includes('FOREIGN BUSINESS PRIVATE SENTINEL'));assert(!r.canonical_evidence.includes('UNRELATED ACTOR PRIVATE SENTINEL'));if(kind==='identity_event'){const row=JSON.parse(r.canonical_evidence).row;assert(row.business_id===null||row.business_id===business);}}
 }));
 test('visited ancestry handles a two-actor creation cycle and bootstrap self-reference without duplication',async()=>{
  const a=randomUUID(),b=randomUUID();await client.query('BEGIN');try{for(const [id,creator] of [[a,b],[b,a]])await client.query("INSERT INTO crest_private.actors(id,kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES($1,'owner','Synthetic cyclic creator','https://auth.example.com/auth/v1',$2,$3,$3,'manual')",[id,randomUUID(),creator]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
  const id=await root('Synthetic cyclic scope',a);await snapshot(async ctx=>{const rows=await all(ctx,'actor');assert.deepEqual(rows.map(r=>r.record_id).sort(),[a,b,bootstrap].sort());assert.equal(ctx.recordCounts.actor,'3');},id);
 });
 test('identity context and page deny every incompatible transaction mode',async()=>{
  for(const mode of ['BEGIN','BEGIN READ ONLY','BEGIN ISOLATION LEVEL REPEATABLE READ','BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY']){await reader.query(mode);try{await assert.rejects(context(),/CREST_IDENTITY_EXPORT_SNAPSHOT_REQUIRED/);}finally{await reader.query('ROLLBACK');}}
 });
 test('identity readers reject invalid roots kinds page sizes fingerprints and null scope',async()=>{
  for(const id of [null,randomUUID()]){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(context(id),/CREST_IDENTITY_EXPORT_(INPUT_REQUIRED|SOURCE_REVIEW_REQUIRED)/);}finally{await reader.query('ROLLBACK');}}
  for(const patch of [{size:0},{size:21},{size:null},{token:null},{token:'bad'},{token:'0'.repeat(64)}])await snapshot(async ctx=>assert.rejects(page(ctx,'actor',patch),/CREST_IDENTITY_EXPORT_(INPUT_REQUIRED|SNAPSHOT_MISMATCH)/));await snapshot(async ctx=>assert.rejects(page(ctx,'session'),/CREST_IDENTITY_EXPORT_INPUT_REQUIRED/));
 });
 test('identity fingerprints cannot cross businesses or reuse configuration or audit scope tokens',async()=>{
  await snapshot(async ctx=>assert.rejects(page(ctx,'actor',{id:other}),/CREST_IDENTITY_EXPORT_SNAPSHOT_MISMATCH/));
  for(const routine of ['business_configuration_export_context','business_history_export_context'])await snapshot(async ctx=>{const token=(await reader.query(`SELECT crest_commands.${routine}($1) AS result`,[business])).rows[0].result.snapshotToken;assert.notEqual(token,ctx.snapshotToken);await assert.rejects(page(ctx,'actor',{token}),/CREST_IDENTITY_EXPORT_SNAPSHOT_MISMATCH/);});
 });
 test('identity extraction changes no source bytes and caller timezone or DateStyle cannot rewrite original history',async()=>{
  const before=await hashes();await snapshot(async ctx=>{const rows=await all(ctx,'identity_event');await reader.query("SET LOCAL timezone='Pacific/Honolulu'; SET LOCAL datestyle='SQL, DMY'");assert.deepEqual(await all(ctx,'identity_event'),rows);});assert.deepEqual(await hashes(),before);
 });
 test('one identity snapshot excludes a concurrent committed member and actor change while the next includes both',async()=>{
  let added;await snapshot(async ctx=>{const before=await all(ctx,'actor'),eventsBefore=await all(ctx,'identity_event');added=await actor('Synthetic concurrently committed member',owner);await member(added);await client.query("UPDATE crest_private.actors SET display_label='Synthetic later label',version=version+1 WHERE id=$1",[owner]);assert.deepEqual(await all(ctx,'actor'),before);assert.deepEqual(await all(ctx,'identity_event'),eventsBefore);assert.deepEqual((await context()).recordCounts,ctx.recordCounts);});actorIds.add(added);
  await snapshot(async ctx=>{assert.equal(ctx.recordCounts.actor,String(actorIds.size));assert((await all(ctx,'actor')).some(r=>r.record_id===added));assert((await all(ctx,'identity_event')).some(r=>JSON.parse(r.canonical_evidence).row.payload.includes('Synthetic later label')));});
 });
 test('uncommitted identity insertion and membership rollback cannot appear in another read-only snapshot',async()=>{
  await client.query('BEGIN');try{const id=await actor('Synthetic rolled back actor',owner);await member(id);await snapshot(async ctx=>{assert.equal(ctx.recordCounts.actor,String(actorIds.size));assert(!(await all(ctx,'actor')).some(r=>r.record_id===id));});}finally{await client.query('ROLLBACK');}
 });
 test('future private actor capability or identity-event columns never enter explicit projections or preserved payloads',async()=>{
  for(const [kind,table] of Object.entries(tables)){await client.query(`ALTER TABLE ${table} ADD COLUMN synthetic_private_identity text DEFAULT 'PRIVATE FUTURE SENTINEL'`);try{await snapshot(async ctx=>{for(const r of await page(ctx,kind)){assert(!r.canonical_evidence.includes('synthetic_private_identity'));assert(!r.canonical_evidence.includes('PRIVATE FUTURE SENTINEL'));}});}finally{await client.query(`ALTER TABLE ${table} DROP COLUMN synthetic_private_identity`);}}
 });
 test('a real restricted export login cannot read raw identity credentials or assume either definer role',async()=>{
  const name='crest_identity_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);get().runtimeRoles.push(name);const url=new URL(get().target);url.username=name;url.password=password;const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  try{await sandbox.admin.query(`GRANT crest_export TO ${name}`);await c.connect();await c.query('SET ROLE crest_export');for(const sql of ['SELECT * FROM crest_private.actors','SELECT * FROM crest_private.identity_events','SELECT * FROM crest_private.role_capabilities','SELECT token_hash FROM crest_private.app_sessions','SET ROLE crest_identity_export_owner','SET ROLE crest_export_owner'])await assert.rejects(c.query(sql),e=>e.code==='42501');await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{assert.equal((await context(business,c)).recordCounts.actor,String(actorIds.size));}finally{await c.query('ROLLBACK');}}
  finally{await c.end();await sandbox.admin.query(`DROP ROLE ${name}`);get().runtimeRoles.splice(get().runtimeRoles.indexOf(name),1);}
 });
 test('ordinary runtime provider inventory cleanup browser and service roles cannot execute identity extraction or private review helpers',async()=>{
  const c=await sandbox.connect(get().target);for(const role of ['crest_web','crest_worker','crest_recovery','crest_inventory','crest_cleanup','anon','authenticated','service_role']){await c.query(`SET ROLE ${role}`);await assert.rejects(context(business,c),e=>e.code==='42501');await c.query('RESET ROLE');}
  await c.query('SET ROLE crest_export');for(const sql of ["SELECT crest_private.identity_export_normalize('{}'::jsonb)","SELECT crest_private.identity_export_check_event('{}'::jsonb)",`SELECT crest_private.business_identity_export_review('${business}')`])await assert.rejects(c.query(sql),e=>e.code==='42501');await c.query('RESET ROLE');
 });
 test('the isolated identity owner has exactly83 safe SELECT columns forced RLS no source writes or provider/session access',async()=>{
  const expected=new Map(manifest.tables.filter(t=>['crest.businesses','crest.memberships','crest_private.business_recovery_authorities',...Object.values(tables)].includes(t.table)).map(t=>[t.table,t.required.toSorted()]));for(const t of ['crest_private.operations','crest_private.audit_events'])expected.set(t,['actor_id','business_id','created_by']);let count=0;
  for(const [table,names] of expected){const cols=(await client.query("SELECT attname,has_column_privilege('crest_identity_export_owner',attrelid,attnum,'SELECT') AS allowed FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attname",[table])).rows;assert.deepEqual(cols.filter(r=>r.allowed).map(r=>r.attname),names);count+=names.length;const r=(await client.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('crest_identity_export_owner',oid,'SELECT,DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS raw,has_any_column_privilege('crest_identity_export_owner',oid,'INSERT,UPDATE,REFERENCES') AS writes FROM pg_class WHERE oid=$1::regclass",[table])).rows[0];assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true,raw:false,writes:false});}assert.equal(count,83);
  for(const table of ['auth.sessions','auth.users','crest_private.app_sessions','crest_private.session_events','crest_private.provider_login_attempts'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_identity_export_owner',$1,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed",[table])).rows[0].allowed,false);
 });
 test('identity routines have fixed private owners settings volatility and no public helper execution or schema CREATE',async()=>{
  const rows=(await client.query("SELECT proname,prosecdef,provolatile,proconfig,has_function_privilege('crest_export',oid,'EXECUTE') AS caller FROM pg_proc WHERE proowner='crest_identity_export_owner'::regrole")).rows;assert.equal(rows.length,5);for(const r of rows){assert.equal(r.provolatile,'s');assert.deepEqual(r.proconfig.map(s=>s.toLowerCase()),['search_path=pg_catalog, pg_temp','row_security=on','timezone=utc','datestyle=iso, ymd']);assert.equal(r.caller,['business_identity_export_context','business_identity_export_page'].includes(r.proname));assert.equal(r.prosecdef,!['identity_export_normalize','identity_export_check_event'].includes(r.proname));}
  const role=(await client.query("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname='crest_identity_export_owner'")).rows[0];for(const [k,v] of Object.entries(role))assert.equal(v,k==='rolconfig'?null:false);assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_namespace WHERE has_schema_privilege('crest_identity_export_owner',oid,'CREATE')")).rows[0].n,0);assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid='crest_identity_export_owner'::regrole OR member='crest_identity_export_owner'::regrole")).rows[0].n,0);
 });
 test('a hidden required actor under restrictive RLS fails instead of disappearing from the closure',async()=>policy('crest_private.actors',`id<>'${ancestor}'`,fails));
 test('hidden original creation history fails even when later actor versions remain visible',async()=>{const [first]=await events();await policy('crest_private.identity_events',`id<>'${first.id}'`,fails);});
 test('hidden intermediate identity history fails with the latest actor version still present',async()=>{const rows=await events();await policy('crest_private.identity_events',`id<>'${rows[1].id}'`,fails);});
 test('hidden latest identity history fails against the actual current source version',async()=>{const rows=await events();await policy('crest_private.identity_events',`id<>'${rows.at(-1).id}'`,fails);});
 test('hidden global capability configuration fails instead of becoming a plausible empty catalog',async()=>policy('crest_private.role_capabilities',"capability<>'export.bulk'",fails));
 test('an original identity hash corruption is rejected and restored without changing original payload bytes',async()=>{
  const old=(await events())[0];await eventChange(old.id,'event_hash','0'.repeat(64));try{await fails();}finally{await eventChange(old.id,'event_hash',old.event_hash);}assert.equal((await client.query('SELECT payload::text AS body FROM crest_private.identity_events WHERE id=$1',[old.id])).rows[0].body,old.body);
 });
 test('contradictory source principal metadata cannot be legitimized by an unchanged original hash',async()=>{
  const old=(await client.query('SELECT id,database_principal FROM crest_private.identity_events WHERE entity_id=$1 ORDER BY entity_version LIMIT 1',[owner])).rows[0];await eventChange(old.id,'database_principal','synthetic_wrong_principal');try{await fails();}finally{await eventChange(old.id,'database_principal',old.database_principal);}
 });
 test('a rehashed payload cannot contradict the stored entity identity or operation binding',async()=>{
  const old=(await client.query('SELECT id,payload::text AS body FROM crest_private.identity_events WHERE entity_id=$1 ORDER BY entity_version LIMIT 1',[owner])).rows[0];await eventChange(old.id,'payload',await patched(old.id,['entityId'],randomUUID()));try{await fails();}finally{await eventChange(old.id,'payload',old.body);}
 });
 test('a rehashed valid-shaped before snapshot must exactly match the preceding original after snapshot',async()=>{
  const old=(await client.query("SELECT id,payload::text AS body FROM crest_private.identity_events WHERE entity_id=$1 AND action='UPDATE' ORDER BY entity_version LIMIT 1",[owner])).rows[0];await eventChange(old.id,'payload',await patched(old.id,['before','display_label'],'Synthetic conflicting prior label'));try{await fails();}finally{await eventChange(old.id,'payload',old.body);}
 });
 test('a restored current actor row that contradicts its retained history fails without being repaired by the reader',async()=>{
  const old=(await client.query('SELECT display_label FROM crest_private.actors WHERE id=$1',[owner])).rows[0].display_label;
  async function change(value){await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.actors DISABLE TRIGGER identity_change; ALTER TABLE crest_private.actors DISABLE TRIGGER identity_history');await client.query('UPDATE crest_private.actors SET display_label=$2 WHERE id=$1',[owner,value]);await client.query('ALTER TABLE crest_private.actors ENABLE TRIGGER identity_change; ALTER TABLE crest_private.actors ENABLE TRIGGER identity_history');await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}}
  await change('Synthetic damaged current label');try{await fails();assert.equal((await client.query('SELECT display_label FROM crest_private.actors WHERE id=$1',[owner])).rows[0].display_label,'Synthetic damaged current label');}finally{await change(old);}
 });
 test('over1000 seeded related actors fail the explicit closure budget without truncation',async()=>{
  const who=await actor('Synthetic overbudget scope owner'),id=await root('Synthetic bounded closure',who);await client.query('BEGIN');try{
   const ids=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) SELECT 'owner','Synthetic bounded actor','https://auth.example.com/auth/v1',gen_random_uuid()::text,$1,$1,'manual' FROM generate_series(1,1000) RETURNING id",[bootstrap])).rows.map(r=>r.id);
   await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,active,created_by,updated_by,origin) SELECT $1,id,'owner',false,$2,$2,'manual' FROM unnest($3::uuid[]) id",[id,who,ids]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(context(id),/CREST_IDENTITY_EXPORT_BUDGET_REQUIRED/);}finally{await reader.query('ROLLBACK');}
 });
 test('over10000 selected events stop before scanning an overbudget synthetic history set',async()=>{
  const who=await actor('Synthetic event budget owner'),id=await root('Synthetic history budget',who);
  // Disposable malformed copies exercise the fail-fast count guard, not a
  // fabricated claim that these copies represent legitimate identity updates.
  await client.query("WITH original AS(SELECT * FROM crest_private.identity_events WHERE entity_kind='actors' AND entity_id=$1 ORDER BY entity_version LIMIT 1),copies AS(SELECT gen_random_uuid() AS id FROM generate_series(1,10001)) INSERT INTO crest_private.identity_events(id,business_id,created_at,created_by,origin,operation_id,import_row_id,entity_kind,entity_id,entity_version,action,database_principal,payload,event_hash) SELECT c.id,o.business_id,o.created_at,o.created_by,o.origin,o.operation_id,o.import_row_id,o.entity_kind,o.entity_id,o.entity_version,o.action,o.database_principal,jsonb_set(o.payload,'{id}',to_jsonb(c.id)),encode(sha256(convert_to(jsonb_set(o.payload,'{id}',to_jsonb(c.id))::text,'UTF8')),'hex') FROM original o CROSS JOIN copies c",[who]);
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(context(id),/CREST_IDENTITY_EXPORT_BUDGET_REQUIRED/);}finally{await reader.query('ROLLBACK');}
 });
 test('identity migration refuses to adopt a login-capable existing definer role',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(29));await client.query('ALTER ROLE crest_identity_export_owner LOGIN');try{await assert.rejects(sandbox.apply(t));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_identity_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await client.query('ALTER ROLE crest_identity_export_owner NOLOGIN');}
 });
 test('identity migration refuses preexisting provider-column grants before creating any new reader',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await get().installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(29));await c.query('GRANT SELECT(id) ON auth.sessions TO crest_identity_export_owner');try{await assert.rejects(sandbox.apply(t));assert.equal((await c.query("SELECT to_regprocedure('crest_commands.business_identity_export_context(uuid)') AS routine")).rows[0].routine,null);}finally{await c.query('REVOKE SELECT(id) ON auth.sessions FROM crest_identity_export_owner');}
 });
 test('original creation events cannot acquire an invented before snapshot even with a valid new source hash',async()=>{
  const old=(await client.query("SELECT id,payload::text AS body FROM crest_private.identity_events WHERE entity_id=$1 AND action='INSERT'",[owner])).rows[0];await eventChange(old.id,'payload',await patched(old.id,['before'],{id:owner}));try{await fails();}finally{await eventChange(old.id,'payload',old.body);}
 });
 return initialize;
}
