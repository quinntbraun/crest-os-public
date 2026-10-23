import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
const issuer='https://auth.example.com/auth/v1';
const sources=[['inventory_observation','provider_inventory_observations','request_id','inventory_export_scope'],['login_attempt','provider_login_attempts','attempt_id','attempt_export_scope'],['login_target','provider_login_targets','attempt_id','target_export_scope'],['login_finish','provider_login_finishes','id','finish_export_scope'],['cleanup_request','provider_cleanup_requests','request_id','request_export_scope'],['cleanup_outcome','provider_cleanup_outcomes','request_id','outcome_export_scope']];
let sandbox,target,client,web,second,maintenance,cleanup,reader,readerTwo,bootstrap,owner,other,business,prior,receipt,retained,grants;
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic target owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,subject,bootstrap])).rows[0];return {id:a.id,subject,epoch:a.current_security_epoch};}
async function member(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
const begin=(a=owner)=>web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),issuer,a.subject]).then(r=>r.rows[0].result);
async function fixture(a=owner){const b=await begin(a),p=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[p,a.subject]);const passwordAt=new Date(Math.floor(Date.now()/1000)*1000),expiresAt=new Date(Date.now()+60000);return {a,b,p,passwordAt,expiresAt,args:[b.attemptId,a.id,b.securityEpoch,issuer,a.subject,p,passwordAt,expiresAt]};}
const capture=(f,c=web)=>c.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8) AS result',f.args).then(r=>r.rows[0].result);
async function issue(f,{legacy=false,mutate=()=>{},c=web}={}){await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);const hash=randomBytes(32),args=[f.b.appSessionId,hash,f.a.id,f.b.securityEpoch,issuer,f.a.subject,f.p,f.passwordAt,new Date(),false,randomBytes(32),'synthetic',f.b.attemptId];mutate(args);await c.query(`SELECT crest_commands.${legacy?'issue_tracked_app_session':'issue_open_app_session'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,args);return {hash,id:args[0]};}
const finish=(f,phase='stopped_review',c=web)=>c.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[f.b.attemptId,f.a.id,f.b.securityEpoch,issuer,f.a.subject,phase]).then(r=>r.rows[0].result);
const request=f=>maintenance.query('SELECT crest_commands.request_provider_cleanup($1,$2,$3,$4) AS result',[randomUUID(),f.stop.evidence.finishId,f.a.id,issuer]).then(r=>r.rows[0].result);
const consume=(f,c=cleanup)=>c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3) AS result',[f.request.evidence.requestId,f.a.id,issuer]).then(r=>r.rows[0].result);

async function full(a=owner){const f=await fixture(a);await capture(f);await issue(f);await finish(f,'registration_closed');f.stop=await finish(f);f.request=await request(f);await consume(f);return f;}
const observation=(a=owner)=>maintenance.query('SELECT crest_commands.record_provider_inventory($1,$2,$3,NULL,100) AS result',[randomUUID(),a.id,issuer]);
const context=(a=owner,c=reader,url=issuer)=>c.query('SELECT crest_commands.provider_evidence_export_context($1,$2) AS result',[a.id,url]).then(r=>r.rows[0].result);
const page=(ctx,kind,{c=reader,actorId=ctx.actorId,url=ctx.providerIssuer,token=ctx.snapshotToken,cursor=null,size=20}={})=>c.query('SELECT * FROM crest_commands.provider_evidence_export_page($1,$2,$3,$4,$5,$6)',[actorId,url,token,kind,cursor,size]).then(r=>r.rows);
async function snapshot(a,work,c=reader){await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work(await context(a,c),c);}finally{await c.query('ROLLBACK');}}
async function all(ctx,kind,c=reader){const rows=[];let cursor=null;for(let i=0;i<100;i++){const part=await page(ctx,kind,{c,cursor});rows.push(...part);if(!part.length)return rows;cursor=part.at(-1).record_id;}assert.fail('fixture page bound exceeded');}
async function sourceHashes(){const result={};for(const table of [...sources.map(s=>'crest_private.'+s[1]),'auth.sessions','crest_private.app_sessions','crest_private.session_events','crest_private.provider_cleanup_references'])result[table]=(await client.query(`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${table} t`)).rows[0].hash;return result;}
const privileges=()=>client.query("SELECT n.nspname,c.relname,c.relacl::text,array_agg(a.attacl::text ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname IN ('auth','crest','crest_private') AND c.relkind='r' GROUP BY n.nspname,c.relname,c.relacl::text ORDER BY 1,2").then(r=>r.rows);
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(25));
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
 await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic snapshot business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await member(owner);await member(other);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
 web=await sandbox.connect(target);second=await sandbox.connect(target);maintenance=await sandbox.connect(target);cleanup=await sandbox.connect(target);reader=await sandbox.connect(target);readerTwo=await sandbox.connect(target);
 for(const c of [web,second])await c.query('SET ROLE crest_web');for(const c of [maintenance,reader,readerTwo])await c.query('SET ROLE crest_inventory');await cleanup.query('SET ROLE crest_cleanup');
 await full();await observation();retained=await sourceHashes();grants=await privileges();receipt=await sandbox.apply(target);
});
after(async()=>{await sandbox?.close();});

test('schema25 upgrade preserves every original source and table privilege with repeatable receipt',async()=>{
 assert.equal(prior.history.length,25);assert.equal(receipt.history.length,26);assert.deepEqual(receipt.history.slice(0,25),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);assert.deepEqual(await sourceHashes(),retained);assert.deepEqual(await privileges(),grants);
});
test('schema24 upgrade through25 and26 preserves its exact older migration prefix',async()=>{
 const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const old=await sandbox.apply(t,await sandbox.prefix(24)),updated=await sandbox.apply(t);assert.equal(updated.history.length,26);assert.deepEqual(updated.history.slice(0,24),old.history);
});
test('snapshot context has explicit six-ledger scope exact decimal counts and a non-authorizing scope fingerprint',async()=>{
 await snapshot(owner,async ctx=>{assert.deepEqual(Object.keys(ctx).sort(),['actorId','ledgerCounts','observedAt','providerIssuer','schemaVersion','scope','snapshotToken'].sort());assert.equal(ctx.scope,'retained_provider_ledgers');assert.equal(ctx.schemaVersion,1);assert.equal(ctx.actorId,owner.id);assert.equal(ctx.providerIssuer,issuer);assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);assert.match(ctx.observedAt,/\+00:00$/);assert.deepEqual(Object.keys(ctx.ledgerCounts).sort(),sources.map(s=>s[0]).sort());for(const [kind,table] of sources){const expected=(await client.query(`SELECT count(*)::text AS n FROM crest_private.${table} WHERE actor_id=$1 AND provider_issuer=$2`,[owner.id,issuer])).rows[0].n;assert.equal(ctx.ledgerCounts[kind],expected);}});
});
test('all six pages preserve original UTF8 bodies hashes and primary IDs without mutating any source',async()=>{
 const before=await sourceHashes();await snapshot(owner,async ctx=>{for(const [kind,table,key] of sources){const actual=await all(ctx,kind),expected=(await client.query(`SELECT ${key} AS record_id,canonical_evidence,event_hash AS evidence_hash FROM crest_private.${table} WHERE actor_id=$1 AND provider_issuer=$2 ORDER BY ${key}`,[owner.id,issuer])).rows;assert.deepEqual(actual,expected);assert.equal(String(actual.length),ctx.ledgerCounts[kind]);for(const row of actual)assert.equal(createHash('sha256').update(row.canonical_evidence,'utf8').digest('hex'),row.evidence_hash);}});assert.deepEqual(await sourceHashes(),before);
});
test('bounded exclusive UUID pages retain every selected source without truncation or duplicates',async()=>{
 const a=await actor();await member(a);for(let i=0;i<23;i++)await begin(a);await snapshot(a,async ctx=>{const first=await page(ctx,'login_attempt');assert.equal(first.length,20);const rest=await page(ctx,'login_attempt',{cursor:first.at(-1).record_id});assert.equal(rest.length,3);const ids=[...first,...rest].map(r=>r.record_id);assert.deepEqual(ids,[...new Set(ids)].sort());assert.equal(ctx.ledgerCounts.login_attempt,'23');assert.deepEqual(await page(ctx,'login_attempt',{cursor:rest.at(-1).record_id}),[]);});
});
test('empty scoped ledgers stay explicit zero counts and empty pages without global absence claims',async()=>{
 const a=await actor();await member(a);await snapshot(a,async ctx=>{for(const [kind] of sources){assert.equal(ctx.ledgerCounts[kind],'0');assert.deepEqual(await page(ctx,kind),[]);}assert.equal(ctx.scope,'retained_provider_ledgers');assert(!Object.hasOwn(ctx,'complete'));});
});
test('held snapshot excludes later target request and cleanup commits without blocking producer work',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);f.stop=await finish(f);const original=f.stop.canonicalEvidence;await web.query("SET statement_timeout='2000ms'");await cleanup.query("SET statement_timeout='2000ms'");
 try{await snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.login_target,'0');await capture(f);f.request=await request(f);await consume(f);for(const kind of ['login_target','cleanup_request','cleanup_outcome']){assert.deepEqual(await page(ctx,kind),[]);assert.equal((await context(a)).ledgerCounts[kind],'0');}assert.equal((await page(ctx,'login_finish'))[0].canonical_evidence,original);});}finally{await web.query('RESET statement_timeout');await cleanup.query('RESET statement_timeout');}
 await snapshot(a,async ctx=>{for(const kind of ['login_target','cleanup_request','cleanup_outcome'])assert.equal(ctx.ledgerCounts[kind],'1');assert.equal((await page(ctx,'login_finish'))[0].canonical_evidence,original);});
});
test('an uncommitted original stays outside another snapshot and rollback leaves no exported record',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);await second.query('BEGIN');try{await capture(f,second);await snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.login_target,'0');assert.deepEqual(await page(ctx,'login_target'),[]);});}finally{await second.query('ROLLBACK');}await snapshot(a,async ctx=>assert.equal(ctx.ledgerCounts.login_target,'0'));
});
test('new starts behind a page cursor do not alter the held count or snapshot page sequence',async()=>{
 const a=await actor();await member(a);const ids=['11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333'];for(const id of ids)await web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4)',[id,randomUUID(),issuer,a.subject]);
 await snapshot(a,async ctx=>{const first=await page(ctx,'login_attempt',{size:1});assert.equal(first[0].record_id,ids[0]);await web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4)',['00000000-0000-0000-0000-000000000001',randomUUID(),issuer,a.subject]);assert.deepEqual((await page(ctx,'login_attempt',{cursor:first[0].record_id})).map(r=>r.record_id),[ids[1]]);assert.equal((await context(a)).ledgerCounts.login_attempt,'2');});
 await snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.login_attempt,'3');assert.equal((await page(ctx,'login_attempt'))[0].record_id,'00000000-0000-0000-0000-000000000001');});
});
test('a fingerprint cannot mix actor or issuer scopes in the same snapshot',async()=>{
 for(const changes of [{actorId:other.id},{url:'https://other.example.com/auth/v1'}])await assert.rejects(snapshot(owner,ctx=>page(ctx,'login_attempt',changes)),e=>e.code==='40001');
});
test('a committed source change invalidates an older snapshot fingerprint in a new transaction',async()=>{
 const a=await actor();await member(a);let old;await snapshot(a,ctx=>{old=ctx;});await begin(a);await assert.rejects(snapshot(a,ctx=>page(ctx,'login_attempt',{token:old.snapshotToken})),e=>e.code==='40001');
});
test('disabled actors and old epochs retain scoped original history without access promotion',async()=>{
 const a=await actor();await member(a);const f=await full(a);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);await snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.cleanup_outcome,'1');assert.equal(JSON.parse((await page(ctx,'login_attempt'))[0].canonical_evidence).securityEpoch,f.b.securityEpoch);});
});
test('wrong issuer and unknown actor produce only their own empty scoped counts',async()=>{
 await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{for(const ctx of [await context(owner,reader,'https://other.example.com/auth/v1'),await context({id:randomUUID()})])for(const [kind] of sources){assert.equal(ctx.ledgerCounts[kind],'0');assert.deepEqual(await page(ctx,kind),[]);}}finally{await reader.query('ROLLBACK');}
});
test('read committed serializable and writable transactions cannot use export readers',async()=>{
 for(const beginSql of ['BEGIN READ ONLY','BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY','BEGIN ISOLATION LEVEL REPEATABLE READ'])for(const query of [()=>context(),()=>page({actorId:owner.id,providerIssuer:issuer,snapshotToken:'0'.repeat(64)},'login_attempt')]){await reader.query(beginSql);try{await assert.rejects(query(),e=>e.code==='25001');}finally{await reader.query('ROLLBACK');}}
});
test('null malformed and oversized typed export inputs fail explicitly without source changes',async()=>{
 const before=await sourceHashes();for(const args of [[null,issuer],[owner.id,null],[owner.id,''],[owner.id,'x'.repeat(501)]]){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(reader.query('SELECT crest_commands.provider_evidence_export_context($1,$2)',args),e=>e.code==='22023');}finally{await reader.query('ROLLBACK');}}
 for(const change of [{actorId:null},{url:''},{token:null},{token:''},{token:'x'.repeat(16385)},{token:'z'.repeat(64)},{size:null},{size:0},{size:21},{kind:'unknown'},{kind:null}])await assert.rejects(snapshot(owner,ctx=>page(ctx,change.kind===undefined?'login_attempt':change.kind,change)),e=>e.code==='22023');assert.deepEqual(await sourceHashes(),before);
});
test('snapshot context UTC formatting restores caller settings and original bytes remain untouched',async()=>{
 await reader.query("SET timezone='Pacific/Honolulu'");try{await snapshot(owner,async ctx=>{assert.match(ctx.observedAt,/\+00:00$/);assert.equal((await reader.query("SELECT current_setting('TimeZone') AS zone")).rows[0].zone,'Pacific/Honolulu');const rows=await page(ctx,'login_attempt');assert(rows.every(r=>JSON.parse(r.canonical_evidence).createdAt.endsWith('+00:00')));});}finally{await reader.query('RESET timezone');}
});
test('two fixed STABLE definers preserve isolation RLS ownership and restricted execution grants',async()=>{
 const functions=['crest_commands.provider_evidence_export_context(uuid,text)','crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer)'];for(const fn of functions){const meta=(await client.query('SELECT prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert.equal(meta.prosecdef,true);assert.equal(meta.provolatile,'s');assert.equal(meta.owner,'crest_inventory_owner');assert(meta.proconfig.includes('row_security=on'));assert(meta.proconfig.includes('search_path=pg_catalog, pg_temp'));for(const role of ['crest_web','crest_worker','crest_recovery','crest_cleanup','crest_cleanup_owner','crest_session_owner','crest_command_owner','anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,fn])).rows[0].ok,false);}
 for(const [,table] of sources)await assert.rejects(maintenance.query(`SELECT * FROM crest_private.${table}`),e=>e.code==='42501');await assert.rejects(maintenance.query('SELECT * FROM auth.sessions'),e=>e.code==='42501');assert.deepEqual(await privileges(),grants);
});
test('six scoped keyset indexes are valid and ordered by actor exact issuer and source primary ID',async()=>{
 for(const [,table,key,name] of sources){const row=(await client.query("SELECT i.indisvalid,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=x.attnum ORDER BY x.ord) AS columns FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=$1 AND i.indrelid=$2::regclass",[name,'crest_private.'+table])).rows[0];assert.equal(row.indisvalid,true);assert.deepEqual(row.columns,['actor_id','provider_issuer',key]);}
});
async function staged(){const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(25));return {t,c};}
test('unexpected schema CREATE authority refuses migration26 and leaves pending review',async()=>{
 const {t,c}=await staged();await c.query('GRANT CREATE ON SCHEMA crest_private TO crest_inventory_owner');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,25);assert.equal((await c.query("SELECT to_regprocedure('crest_commands.provider_evidence_export_context(uuid,text)') AS fn")).rows[0].fn,null);await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);
});
test('forbidden provider secret SELECT drift refuses migration26 without creating readers',async()=>{
 const {t,c}=await staged();await c.query('GRANT SELECT(token) ON auth.refresh_tokens TO crest_inventory_owner');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query("SELECT to_regprocedure('crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer)') AS fn")).rows[0].fn,null);
});
test('invalid UUID and integer parameters fail before producing any page',async()=>{
 for(const args of [['bad',issuer,'0'.repeat(64),'login_attempt',null,1],[owner.id,issuer,'0'.repeat(64),'login_attempt','bad',1],[owner.id,issuer,'0'.repeat(64),'login_attempt',null,'1.5']]){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(reader.query('SELECT * FROM crest_commands.provider_evidence_export_page($1,$2,$3,$4,$5,$6)',args),e=>e.code==='22P02');}finally{await reader.query('ROLLBACK');}}
});
test('a mismatched restored source hash fails the entire page instead of filtering out its record',async()=>{
 const a=await actor();await member(a);const fixtures=[await fixture(a),await fixture(a)],f=fixtures.sort((x,y)=>x.b.attemptId.localeCompare(y.b.attemptId)).at(-1);const checks=(await client.query("SELECT conname FROM pg_constraint WHERE conrelid='crest_private.provider_login_attempts'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%event_hash =%'")).rows;assert.equal(checks.length,1);assert.match(checks[0].conname,/^[a-z0-9_]+$/);
 await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.provider_login_attempts DISABLE TRIGGER USER');await client.query(`ALTER TABLE crest_private.provider_login_attempts DROP CONSTRAINT ${checks[0].conname}`);await client.query("UPDATE crest_private.provider_login_attempts SET event_hash=repeat('0',64) WHERE attempt_id=$1",[f.b.attemptId]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
 await assert.rejects(snapshot(a,ctx=>{assert.equal(ctx.ledgerCounts.login_attempt,'2');return page(ctx,'login_attempt');}),e=>e.code==='23514');
 // Dedicated final corruption fixture only. No repair, filtering or source writer is introduced.
});
