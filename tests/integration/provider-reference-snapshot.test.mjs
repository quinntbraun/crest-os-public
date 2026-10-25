import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProviderRecoveryEvidenceCollector} from '../../src/security/provider-evidence-collector.ts';
import {verifyProviderRecoveryEvidenceCollection} from '../../src/security/provider-recovery-evidence-verification.ts';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {readFile} from 'node:fs/promises';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {businessConfigurationExportTests} from '../support/business-configuration-export-tests.mjs';
import {businessHistoryExportTests} from '../support/business-history-export-tests.mjs';
import {sessionMetadataExportTests} from '../support/session-metadata-export-tests.mjs';
import {businessIdentityExportTests} from '../support/business-identity-export-tests.mjs';

const issuer='https://auth.example.com/auth/v1',kinds=['session_identity','session_event','cleanup_reference'];
const tables=['app_sessions','session_events','provider_cleanup_references'];
const functions=['crest_commands.provider_reference_export_context(uuid,text)','crest_commands.provider_reference_export_page(uuid,text,text,text,uuid,integer)'];
let sandbox,target,client,reader,bootstrap,business,owner,other,legacy,prior,receipt,retained,oldFunctions,referenceReceipt,configurationReceipt,historyReceipt,identityReceipt;
const runtimeRoles=[];let runtimeInventory;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
async function actor(){const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic reference owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,randomUUID(),bootstrap])).rows[0];await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner?.id??a.id]);return a;}
async function session(a=owner,{id=randomUUID(),version='1'}={}){const p=randomUUID();await client.query("WITH moment AS MATERIALIZED(SELECT clock_timestamp() AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,version,created_by,updated_by) SELECT $1,$2,$3,$4,$5,stamp,stamp,stamp,stamp+interval '1 hour',false,$6,'synthetic',$7,$2,$2 FROM moment",[id,a.id,p,randomBytes(32),a.current_security_epoch,randomBytes(32),version]);return {id,p,a};}
const revoke=f=>client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.id]);
const context=(a=owner,url=issuer,c=reader)=>c.query('SELECT crest_commands.provider_reference_export_context($1,$2) AS result',[a.id,url]).then(r=>r.rows[0].result);
const page=(ctx,kind,{cursor=null,size=20,token=ctx.snapshotToken,actorId=ctx.actorId,url=ctx.providerIssuer,c=reader}={})=>c.query('SELECT * FROM crest_commands.provider_reference_export_page($1,$2,$3,$4,$5,$6)',[actorId,url,token,kind,cursor,size]).then(r=>r.rows);
async function snapshot(a,work,url=issuer){await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work(await context(a,url));}finally{await reader.query('ROLLBACK');}}
async function all(ctx,kind){const rows=[];let cursor=null;for(let i=0;i<10;i++){const part=await page(ctx,kind,{cursor});rows.push(...part);if(!part.length)return rows;cursor=part.at(-1).record_id;}assert.fail('fixture cursor limit');}
async function sourceHashes(){const r={};for(const table of [...tables,'provider_login_attempts','provider_login_finishes'])r[table]=(await client.query(`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM crest_private.${table} t`)).rows[0].hash;return r;}
const originals=()=>client.query("SELECT oid::text,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid IN ('crest_commands.provider_evidence_export_context(uuid,text)'::regprocedure,'crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer)'::regprocedure) ORDER BY oid").then(r=>r.rows);
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(26));
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 const root=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic reference bootstrap',$1,$2,$3,$3,'manual') RETURNING id",[issuer,randomUUID(),bootstrap])).rows[0].id;
 await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic reference business','UTC',$1,$1,'manual') RETURNING id",[root])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,root]);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,root]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 owner=await actor();other=await actor();legacy=await session();await revoke(legacy);retained=await sourceHashes();oldFunctions=await originals();referenceReceipt=await sandbox.apply(target,await sandbox.prefix(27));configurationReceipt=await sandbox.apply(target,await sandbox.prefix(28));historyReceipt=await sandbox.apply(target,await sandbox.prefix(29));identityReceipt=await sandbox.apply(target,await sandbox.prefix(30));receipt=await sandbox.apply(target);reader=await sandbox.connect(target);await reader.query('SET ROLE crest_inventory');await initializeBusinessConfigurationExport();await initializeBusinessHistoryExport();await initializeBusinessIdentityExport();await initializeSessionMetadataExport();
});
after(async()=>{for(const name of runtimeRoles)await sandbox.admin.query(`DROP ROLE ${name}`);await sandbox?.close();});
const initializeBusinessConfigurationExport=businessConfigurationExportTests(()=>({client,sandbox,target,installProviderSchema,runtimeRoles}));
const initializeBusinessHistoryExport=businessHistoryExportTests(()=>({client,sandbox,target,installProviderSchema,runtimeRoles}));
const initializeSessionMetadataExport=sessionMetadataExportTests(()=>({client,sandbox,target,installProviderSchema,runtimeRoles}));
const initializeBusinessIdentityExport=businessIdentityExportTests(()=>({client,sandbox,target,installProviderSchema,runtimeRoles}));

async function exportColumns(){
 return (await client.query(`SELECT n.nspname||'.'||c.relname AS "table",a.attname AS "column"
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
  WHERE n.nspname IN ('crest','crest_private') AND c.relkind IN ('r','p')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`)).rows;
}
test('portable coverage inventory accounts for every actual Crest source column without claiming completed exports',async()=>{
 const m=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
 const report=verifyExportCoverage(m,await exportColumns(),receipt.history.length);
 assert.deepEqual(report,{assurance:'schema_inventory_only',tables:26,requiredColumns:344,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
});
test('live added source columns and tables fail coverage until reviewed without altering retained sources',async()=>{
 const m=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
 await client.query('BEGIN');try{
  await client.query('ALTER TABLE crest.businesses ADD COLUMN synthetic_export_review text');
  const columns=await exportColumns();assert(columns.some(r=>r.column==='synthetic_export_review'));
  assert.throws(()=>verifyExportCoverage(m,columns,receipt.history.length),/EXPORT_COVERAGE_REVIEW_REQUIRED/);
 }finally{await client.query('ROLLBACK');}
 await client.query('BEGIN');try{
  await client.query('CREATE TABLE crest.synthetic_export_review(id uuid)');
  const columns=await exportColumns();assert(columns.some(r=>r.table==='crest.synthetic_export_review'));
  assert.throws(()=>verifyExportCoverage(m,columns,receipt.history.length),/EXPORT_COVERAGE_REVIEW_REQUIRED/);
 }finally{await client.query('ROLLBACK');}
 assert.equal(verifyExportCoverage(m,await exportColumns(),receipt.history.length).tables,26);
});

test('schema26 upgrade preserves all prior source bytes history and original six-ledger routines',async()=>{
 assert.equal(prior.history.length,26);assert.equal(referenceReceipt.history.length,27);assert.equal(configurationReceipt.history.length,28);assert.equal(identityReceipt.history.length,30);assert.deepEqual(identityReceipt.history.slice(0,29),historyReceipt.history);assert.equal(receipt.history.length,36);assert.deepEqual(receipt.history.slice(0,30),identityReceipt.history);assert.equal(historyReceipt.history.length,29);assert.deepEqual(receipt.history.slice(0,29),historyReceipt.history);assert.deepEqual(receipt.history.slice(0,28),configurationReceipt.history);assert.deepEqual(receipt.history.slice(0,27),referenceReceipt.history);assert.deepEqual(receipt.history.slice(0,26),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);assert.deepEqual(await sourceHashes(),retained);assert.deepEqual(await originals(),oldFunctions);
});
test('schema25 upgrade preserves its prefix through26,27,28,29,30,31,32,33,34,35 and36',async()=>{
 const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const p=await sandbox.apply(t,await sandbox.prefix(25)),r=await sandbox.apply(t);assert.equal(r.history.length,36);assert.deepEqual(r.history.slice(0,25),p.history);
});
test('reference context reports all three exact source counts in an explicit separate scope',async()=>{
 await snapshot(owner,async ctx=>{assert.deepEqual(Object.keys(ctx).sort(),['actorId','ledgerCounts','observedAt','providerIssuer','schemaVersion','scope','snapshotToken'].sort());assert.equal(ctx.schemaVersion,1);assert.equal(ctx.scope,'provider_session_references');assert.equal(ctx.actorId,owner.id);assert.equal(ctx.providerIssuer,issuer);assert.match(ctx.observedAt,/\+00:00$/);assert.match(ctx.snapshotToken,/^[a-f0-9]{64}$/);for(let i=0;i<3;i++)assert.equal(ctx.ledgerCounts[kinds[i]],(await client.query(`SELECT count(*)::text AS n FROM crest_private.${tables[i]} WHERE actor_id=$1`,[owner.id])).rows[0].n);assert.deepEqual(Object.keys(ctx.ledgerCounts).sort(),[...kinds].sort());});
});
test('session events retain original stored JSONB bytes and original hashes including legacy untracked registration',async()=>{
 const before=await sourceHashes();await snapshot(owner,async ctx=>{const rows=await all(ctx,'session_event'),expected=(await client.query("SELECT id AS record_id,'stored_payload'::text AS representation,payload::text AS canonical_evidence,event_hash AS evidence_hash FROM crest_private.session_events WHERE actor_id=$1 ORDER BY id",[owner.id])).rows;assert.deepEqual(rows,expected);assert.equal(rows.length,2);assert(rows.some(r=>JSON.parse(r.canonical_evidence).before===null));for(const r of rows)assert.equal(digest(r.canonical_evidence),r.evidence_hash);});assert.deepEqual(await sourceHashes(),before);
});
test('immutable session mappings are explicitly labeled projections with no credentials or mutable eligibility',async()=>{
 await snapshot(owner,async ctx=>{const rows=await all(ctx,'session_identity');assert.equal(rows.length,1);const r=rows[0];assert.equal(r.representation,'snapshot_projection');assert.equal(r.record_id,legacy.id);assert.equal(r.evidence_hash,digest(r.canonical_evidence));assert.deepEqual(JSON.parse(r.canonical_evidence),{schemaVersion:1,appSessionId:legacy.id,actorId:owner.id,providerIssuer:issuer,providerSessionId:legacy.p,securityEpoch:owner.current_security_epoch});});
});
test('cleanup projections preserve every retained reference column with original source hash and exact decimal version',async()=>{
 const a=await actor(),f=await session(a,{version:'9007199254740993'});await revoke(f);await snapshot(a,async ctx=>{const [r]=await all(ctx,'cleanup_reference'),s=(await client.query("SELECT id,schema_version,app_session_id,actor_id,provider_session_id,issued_security_epoch,source_version::text,revoked_at::text,source_event_id,source_event_hash,state,created_at::text,created_by,origin,operation_id FROM crest_private.provider_cleanup_references WHERE app_session_id=$1",[f.id])).rows[0];const b=JSON.parse(r.canonical_evidence);assert.equal(r.representation,'snapshot_projection');assert.equal(digest(r.canonical_evidence),r.evidence_hash);assert.equal(b.sourceVersion,'9007199254740994');assert.deepEqual(Object.keys(b).sort(),['schemaVersion','origin','referenceId','appSessionId','actorId','providerSessionId','securityEpoch','sourceVersion','revokedAt','sourceEventId','sourceEventHash','state','createdAt','createdBy','operationId'].sort());assert.equal(b.referenceId,s.id);assert.equal(b.sourceEventId,s.source_event_id);assert.equal(b.sourceEventHash,s.source_event_hash);assert.equal(b.actorId,a.id);assert.equal(b.providerSessionId,f.p);assert.equal(b.operationId,null);assert.equal(b.origin,'system');assert.equal(b.state,'review_required');assert.equal(b.schemaVersion,1);assert.equal(b.createdBy,a.id);assert.equal(b.securityEpoch,a.current_security_epoch);assert.equal(new Date(b.revokedAt).getTime(),new Date(s.revoked_at).getTime());assert.equal(new Date(b.createdAt).getTime(),new Date(s.created_at).getTime());const e=(await all(ctx,'session_event')).find(x=>x.record_id===b.sourceEventId);assert.equal(e.evidence_hash,b.sourceEventHash);});
});
test('all three source kinds paginate exclusively across more than one page without gaps duplicates or omission',async()=>{
 const a=await actor();for(let i=0;i<23;i++){const f=await session(a);await revoke(f);}await snapshot(a,async ctx=>{for(const kind of kinds){const rows=await all(ctx,kind),first=await page(ctx,kind),rest=await page(ctx,kind,{cursor:first.at(-1).record_id});assert.equal(first.length,20);assert(rest.length>0);assert.equal(rows.length,Number(ctx.ledgerCounts[kind]));assert.deepEqual(rows.map(r=>r.record_id),[...new Set(rows.map(r=>r.record_id))].sort());assert.deepEqual(await page(ctx,kind,{cursor:rows.at(-1).record_id}),[]);}});
});
test('empty unknown and wrong-issuer scopes preserve explicit zero counts without global absence claims',async()=>{
 const a=await actor();for(const [who,url] of [[a,issuer],[{id:randomUUID()},issuer],[owner,'https://other.example.com/auth/v1']])await snapshot(who,async ctx=>{for(const kind of kinds){assert.equal(ctx.ledgerCounts[kind],'0');assert.deepEqual(await page(ctx,kind),[]);}assert(!Object.hasOwn(ctx,'complete'));},url);
});
test('disabled actors old security epochs and revoked sessions keep immutable registration and reference history',async()=>{
 const a=await actor(),f=await session(a);await revoke(f);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);await snapshot(a,async ctx=>{assert.deepEqual(ctx.ledgerCounts,{session_identity:'1',session_event:'2',cleanup_reference:'1'});assert.equal(JSON.parse((await page(ctx,'session_identity'))[0].canonical_evidence).securityEpoch,a.current_security_epoch);});
});
test('one held snapshot excludes concurrent registration and revocation while producers finish without row locks',async()=>{
 const a=await actor(),f=await session(a);await client.query("SET statement_timeout='2000ms'");try{await snapshot(a,async ctx=>{assert.deepEqual(ctx.ledgerCounts,{session_identity:'1',session_event:'1',cleanup_reference:'0'});await revoke(f);await session(a);assert.equal((await page(ctx,'session_identity')).length,1);assert.equal((await page(ctx,'session_event')).length,1);assert.deepEqual(await page(ctx,'cleanup_reference'),[]);assert.deepEqual((await context(a)).ledgerCounts,ctx.ledgerCounts);});}finally{await client.query('RESET statement_timeout');}await snapshot(a,ctx=>assert.deepEqual(ctx.ledgerCounts,{session_identity:'2',session_event:'3',cleanup_reference:'1'}));
});
test('uncommitted registration cannot appear in another snapshot and rollback creates no source history',async()=>{
 const a=await actor();await client.query('BEGIN');try{await session(a);await snapshot(a,async ctx=>{for(const kind of kinds)assert.deepEqual(await page(ctx,kind),[]);});}finally{await client.query('ROLLBACK');}await snapshot(a,ctx=>assert(Object.values(ctx.ledgerCounts).every(n=>n==='0')));
});
test('scope fingerprint rejects mixed actors issuers and original six-ledger tokens',async()=>{
 for(const change of [{actorId:other.id},{url:'https://other.example.com/auth/v1'}])await assert.rejects(snapshot(owner,ctx=>page(ctx,'session_event',change)),e=>e.code==='40001');await assert.rejects(snapshot(owner,async ctx=>{const old=(await reader.query('SELECT crest_commands.provider_evidence_export_context($1,$2) AS result',[owner.id,issuer])).rows[0].result;assert.notEqual(old.snapshotToken,ctx.snapshotToken);await page(ctx,'session_event',{token:old.snapshotToken});}),e=>e.code==='40001');
});
test('a fingerprint from a released snapshot cannot resume after a committed visibility change',async()=>{
 const a=await actor();let old;await snapshot(a,ctx=>{old=ctx;});await session(a);await assert.rejects(snapshot(a,ctx=>page(ctx,'session_event',{token:old.snapshotToken})),e=>e.code==='40001');
});
test('read committed serializable and writable transactions are rejected for context and page',async()=>{
 for(const begin of ['BEGIN READ ONLY','BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY','BEGIN ISOLATION LEVEL REPEATABLE READ'])for(const work of [()=>context(),()=>page({actorId:owner.id,providerIssuer:issuer,snapshotToken:'0'.repeat(64)},'session_event')]){await reader.query(begin);try{await assert.rejects(work(),e=>e.code==='25001');}finally{await reader.query('ROLLBACK');}}
});
test('null malformed oversized unknown-kind page-size and typed cursor inputs fail closed',async()=>{
 for(const [a,url] of [[{id:null},issuer],[owner,null],[owner,''],[owner,'x'.repeat(501)]])await assert.rejects(snapshot(a,()=>{},url),e=>e.code==='22023');for(const change of [{actorId:null},{url:null},{url:''},{url:'x'.repeat(501)},{token:null},{token:'A'.repeat(64)},{size:null},{size:0},{size:21}])await assert.rejects(snapshot(owner,ctx=>page(ctx,'session_event',change)),e=>e.code==='22023');for(const kind of [null,'unknown','login_attempt'])await assert.rejects(snapshot(owner,ctx=>page(ctx,kind)),e=>e.code==='22023');for(const change of [{cursor:'bad'},{size:1.5},{actorId:'bad'}])await assert.rejects(snapshot(owner,ctx=>page(ctx,'session_event',change)),e=>e.code==='22P02');
});
test('UTC projection is stable across caller timezones and does not change caller settings',async()=>{
 let original;await snapshot(owner,async ctx=>{original=await all(ctx,'cleanup_reference');});await reader.query("SET timezone='Pacific/Honolulu'");try{await snapshot(owner,async ctx=>{assert.deepEqual(await all(ctx,'cleanup_reference'),original);assert.match(ctx.observedAt,/\+00:00$/);assert.equal((await reader.query("SELECT current_setting('TimeZone') AS zone")).rows[0].zone,'Pacific/Honolulu');});}finally{await reader.query('RESET timezone');}
});
test('definers expose only fixed read-only inventory execution and no raw source or provider write permission',async()=>{
 for(const fn of functions){const m=(await client.query('SELECT prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert.equal(m.prosecdef,true);assert.equal(m.provolatile,'s');assert.equal(m.owner,'crest_inventory_owner');assert(m.proconfig.includes('row_security=on'));assert(m.proconfig.includes('search_path=pg_catalog, pg_temp'));assert.equal((await client.query("SELECT has_function_privilege('crest_inventory',$1,'EXECUTE') AS ok",[fn])).rows[0].ok,true);for(const role of ['crest_web','crest_worker','crest_recovery','crest_cleanup','crest_cleanup_owner','crest_session_owner','crest_command_owner','anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,fn])).rows[0].ok,false);}
 for(const table of [...tables,'actors'])await assert.rejects(reader.query(`SELECT * FROM crest_private.${table}`),e=>e.code==='42501');for(const table of ['sessions','users','refresh_tokens'])await assert.rejects(reader.query(`SELECT * FROM auth.${table}`),e=>e.code==='42501');
 const cols=(await client.query("SELECT attname::text FROM pg_attribute WHERE attrelid='crest_private.app_sessions'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('crest_inventory_owner',attrelid,attnum,'SELECT') ORDER BY attname")).rows.map(r=>r.attname);assert.deepEqual(cols,['actor_id','expires_at','id','issued_security_epoch','provider_session_id','revoked_at']);
 for(const table of tables){assert.equal((await client.query("SELECT has_any_column_privilege('crest_inventory_owner',$1,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',$1,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS ok",['crest_private.'+table])).rows[0].ok,false);}
});
test('three valid indexes provide actor and exclusive primary-ID key ordering',async()=>{
 for(let i=0;i<3;i++){const name=['session_identity_export_scope','session_event_export_scope','cleanup_reference_export_scope'][i],r=(await client.query("SELECT i.indisvalid,ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=x.attnum ORDER BY x.ord) AS columns FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=$1 AND i.indrelid=$2::regclass",[name,'crest_private.'+tables[i]])).rows[0];assert.equal(r.indisvalid,true);assert.deepEqual(r.columns,['actor_id','id']);}
});
test('safe definer column grants exactly match the reviewed projection without provider credential access',async()=>{
 const allowed={session_events:['id','session_id','actor_id','operation_id','action','payload','event_hash'],provider_cleanup_references:['id','schema_version','app_session_id','actor_id','provider_session_id','issued_security_epoch','source_version','revoked_at','source_event_id','source_event_hash','state','created_at','created_by','origin','operation_id'],actors:['id','kind','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at']};
 for(const [table,names] of Object.entries(allowed)){const got=(await client.query("SELECT attname::text FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('crest_inventory_owner',attrelid,attnum,'SELECT') ORDER BY attname",['crest_private.'+table])).rows.map(r=>r.attname);assert.deepEqual(got,names.sort());}
 for(const table of ['auth.users','auth.refresh_tokens','auth.mfa_amr_claims'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_inventory_owner',$1,'SELECT') AS ok",[table])).rows[0].ok,false);
});
async function staged(){const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(26));return {t,c};}
test('unexpected CREATE authority refuses migration27 and leaves review pending without new functions',async()=>{
 const {t,c}=await staged();await c.query('GRANT CREATE ON SCHEMA crest_private TO crest_inventory_owner');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,26);assert.equal((await c.query('SELECT to_regprocedure($1) AS fn',[functions[0]])).rows[0].fn,null);await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);await c.query('REVOKE CREATE ON SCHEMA crest_private FROM crest_inventory_owner');
});
test('secret-column SELECT privilege drift refuses migration27 before adding safe source grants',async()=>{
 const {t,c}=await staged();await c.query('GRANT SELECT(token_hash) ON crest_private.app_sessions TO crest_inventory_owner');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT to_regprocedure($1) AS fn',[functions[1]])).rows[0].fn,null);assert.equal((await c.query("SELECT has_column_privilege('crest_inventory_owner','crest_private.session_events','payload','SELECT') AS ok")).rows[0].ok,false);
});
test('corrupt stored session hash fails a whole page after an earlier valid row instead of filtering the original',async()=>{
 const a=await actor();await session(a);await session(a);const ids=(await client.query('SELECT id FROM crest_private.session_events WHERE actor_id=$1 ORDER BY id',[a.id])).rows.map(r=>r.id);await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.session_events DISABLE TRIGGER USER');await client.query("UPDATE crest_private.session_events SET event_hash=repeat('0',64) WHERE id=$1",[ids.at(-1)]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}await assert.rejects(snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.session_event,'2');await page(ctx,'session_event');}),e=>e.code==='23514');
});
test('a broken cleanup source link remains counted and fails rather than disappearing through a join',async()=>{
 const a=await actor(),f=await session(a);await revoke(f);await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.provider_cleanup_references DISABLE TRIGGER USER');await client.query("UPDATE crest_private.provider_cleanup_references SET source_event_hash=repeat('0',64) WHERE app_session_id=$1",[f.id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}await assert.rejects(snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.cleanup_reference,'1');await page(ctx,'cleanup_reference');}),e=>e.code==='23514');
});
test('rehashed event ID binding corruption fails instead of presenting the hash as complete source validation',async()=>{
 const a=await actor();await session(a);await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.session_events DISABLE TRIGGER USER');await client.query("UPDATE crest_private.session_events SET payload=payload||jsonb_build_object('id',$1::text),event_hash=encode(sha256(convert_to((payload||jsonb_build_object('id',$1::text))::text,'UTF8')),'hex') WHERE actor_id=$2",[randomUUID(),a.id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}await assert.rejects(snapshot(a,ctx=>page(ctx,'session_event')),e=>e.code==='23514');
});
test('an oversized original fails explicitly rather than truncating or omitting its stored bytes',async()=>{
 const a=await actor();await session(a);await client.query('BEGIN');try{await client.query('ALTER TABLE crest_private.session_events DISABLE TRIGGER USER');await client.query("UPDATE crest_private.session_events SET payload=payload||jsonb_build_object('unsupported',repeat('x',8192)),event_hash=encode(sha256(convert_to((payload||jsonb_build_object('unsupported',repeat('x',8192)))::text,'UTF8')),'hex') WHERE actor_id=$1",[a.id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}await assert.rejects(snapshot(a,async ctx=>{assert.equal(ctx.ledgerCounts.session_event,'1');await page(ctx,'session_event');}),e=>e.code==='23514');
});

async function provisionCollector(){
 const name=`crest_probe_${randomBytes(8).toString('hex')}`,password=randomBytes(32).toString('hex');assert.match(name,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
 await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);runtimeRoles.push(name);await sandbox.admin.query(`GRANT crest_inventory TO ${name} WITH INHERIT FALSE`);
 const url=new URL(target);url.username=name;url.password=password;return {name,config:{connectionString:url.toString(),environment:'test',actorId:owner.id,issuer}};
}
const collect=a=>createProviderRecoveryEvidenceCollector({...runtimeInventory.config,actorId:a.id})(new AbortController().signal);
const verify=(c,a)=>verifyProviderRecoveryEvidenceCollection(JSON.stringify(c),{actorId:a.id,issuer});
async function tracked(a){
 const subject=(await client.query('SELECT auth_user_id FROM crest_private.actors WHERE id=$1',[a.id])).rows[0].auth_user_id;
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
 const web=await sandbox.connect(target),cleanup=await sandbox.connect(target);await web.query('SET ROLE crest_web');await cleanup.query('SET ROLE crest_cleanup');
 try{
  const b=(await web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),issuer,subject])).rows[0].result,p=randomUUID(),passwordAt=new Date(Math.floor(Date.now()/1000)*1000);
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[p,subject]);
  await web.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8)',[b.attemptId,a.id,b.securityEpoch,issuer,subject,p,passwordAt,new Date(Date.now()+60000)]);
  await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[p]);
  await web.query('SELECT crest_commands.issue_open_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[b.appSessionId,randomBytes(32),a.id,b.securityEpoch,issuer,subject,p,passwordAt,new Date(),false,randomBytes(32),'synthetic',b.attemptId]);
  await web.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6)',[b.attemptId,a.id,b.securityEpoch,issuer,subject,'registration_closed']);
  const stop=(await web.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[b.attemptId,a.id,b.securityEpoch,issuer,subject,'stopped_review'])).rows[0].result;
  const request=(await reader.query('SELECT crest_commands.request_provider_cleanup($1,$2,$3,$4) AS result',[randomUUID(),stop.evidence.finishId,a.id,issuer])).rows[0].result;
  await cleanup.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3)',[request.evidence.requestId,a.id,issuer]);return b;
 }finally{await web.end();await cleanup.end();}
}
test('combined collector verifies actual nine-group source bytes and links including a legacy session without source writes',async()=>{
 runtimeInventory=await provisionCollector();const a=await actor(),legacy=await session(a);await revoke(legacy);await tracked(a);const before=await sourceHashes(),c=await collect(a),r=verify(c,a);
 assert.equal(c.formatVersion,2);assert.equal(c.context.scope,'retained_provider_ledgers');assert.equal(c.referenceContext.scope,'provider_session_references');assert.equal(c.referenceContext.ledgerCounts.session_identity,'2');assert.equal(c.referenceContext.ledgerCounts.session_event,'4');assert.equal(c.referenceContext.ledgerCounts.cleanup_reference,'2');assert.deepEqual(r.records,c.records);assert.deepEqual(r.attempts.map(x=>x.missingKinds),[[]]);assert.equal(r.assurance,'internal_consistency_only');
 for(const v of [c,c.referenceContext,c.referenceContext.ledgerCounts,c.records,...c.records,r,r.referenceContext,r.referenceContext.ledgerCounts,r.records,...r.records])assert(Object.isFrozen(v));assert.deepEqual(await sourceHashes(),before);
});
test('combined held snapshot excludes later registration revocation requests and outcomes across both scopes',async()=>{
 const a=await actor(),f=await session(a),original=pg.Client.prototype.query,connections=new Set();let contexts=0;
 pg.Client.prototype.query=async function(sql,...args){const r=await original.call(this,sql,...args);if(this.user===runtimeInventory.name){connections.add(this);if(typeof sql==='string'&&sql.includes('provider_evidence_export_context(')){contexts++;await revoke(f);await tracked(a);}}return r;};
 let held;try{held=await collect(a);}finally{pg.Client.prototype.query=original;}
 assert.equal(contexts,1);assert.equal(connections.size,1);assert(Object.values(held.context.ledgerCounts).every(n=>n==='0'));assert.deepEqual(held.referenceContext.ledgerCounts,{session_identity:'1',session_event:'1',cleanup_reference:'0'});assert.equal(verify(held,a).records.length,2);
 const fresh=await collect(a);assert.notEqual(fresh.generationId,held.generationId);assert.equal(fresh.context.ledgerCounts.cleanup_outcome,'1');assert.equal(fresh.referenceContext.ledgerCounts.cleanup_reference,'2');assert.deepEqual(verify(fresh,a).attempts.map(x=>x.missingKinds),[[]]);
});
test('combined reference pagination and exact bigint versions verify in a fresh credential-free Node process',async()=>{
 const a=await actor();for(let i=0;i<23;i++)await session(a,{version:'9007199254740993'});const c=await collect(a),r=verify(c,a);assert.equal(r.records.length,46);assert.equal(c.referenceContext.ledgerCounts.session_event,'23');
 const module=pathToFileURL(resolve('src/security/provider-recovery-evidence-verification.ts')).href;
 const script=`import {readFileSync} from 'node:fs';import {verifyProviderRecoveryEvidenceCollection} from ${JSON.stringify(module)};const r=verifyProviderRecoveryEvidenceCollection(readFileSync(0,'utf8'),${JSON.stringify({actorId:a.id,issuer})});if(process.env.CREST_TEST_DATABASE_URL||r.assurance!=='internal_consistency_only')process.exit(1);process.stdout.write(String(r.records.length));`;
 const result=execFileSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify(c),encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000,maxBuffer:1024});assert.equal(result,'46');
});
test('combined collection preserves source timezone offsets and microseconds after a local revocation',async()=>{
 const a=await actor();await client.query("SET timezone='Pacific/Honolulu'");try{const f=await session(a);await revoke(f);}finally{await client.query('RESET timezone');}const c=await collect(a);assert(c.records.filter(r=>r.kind==='session_event').every(r=>r.canonicalEvidence.includes('-10:00')));assert.deepEqual(verify(c,a).records,c.records);
});
test('combined collection retains disabled old-epoch history and empty scopes without application-access claims',async()=>{
 const a=await actor(),f=await session(a);await revoke(f);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);const c=await collect(a);assert.equal(verify(c,a).referenceContext.ledgerCounts.cleanup_reference,'1');const empty=await collect({id:randomUUID()});assert.deepEqual(verify(empty,{id:empty.context.actorId}).records,[]);assert(!Object.hasOwn(c,'ready'));
});
test('losing the combined connection in a reference page discards both scopes and an explicit new call starts fresh',async()=>{
 const a=await actor();await session(a);const original=pg.Client.prototype.query;let contexts=0;
 pg.Client.prototype.query=async function(sql,...args){const r=await original.call(this,sql,...args);if(this.user===runtimeInventory.name&&typeof sql==='string'){if(sql.includes('provider_evidence_export_context('))contexts++;if(sql.includes('provider_reference_export_page('))await this.end();}return r;};
 try{await assert.rejects(collect(a),/PROVIDER_EVIDENCE_COLLECTION_REVIEW_REQUIRED/);}finally{pg.Client.prototype.query=original;}assert.equal(contexts,1);assert.equal(verify(await collect(a),a).records.length,2);
});
test('portable rehashed source-reference contradictions fail while unmodified originals remain verifiable',async()=>{
 const a=await actor();await tracked(a);const c=await collect(a),copy=JSON.parse(JSON.stringify(c)),ref=copy.records.find(r=>r.kind==='cleanup_reference');const b=JSON.parse(ref.canonicalEvidence);b.sourceEventHash='0'.repeat(64);ref.canonicalEvidence=JSON.stringify(b);ref.evidenceHash=digest(ref.canonicalEvidence);copy.evidenceBytes=copy.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);assert.throws(()=>verify(copy,a),/PROVIDER_RECOVERY_EVIDENCE_REVIEW_REQUIRED/);assert.deepEqual(verify(c,a).records,c.records);
});
test('combined collector has no administrator adoption raw-source read or cleanup mutation authority',async()=>{
 await assert.rejects(createProviderRecoveryEvidenceCollector({...runtimeInventory.config,connectionString:target})(new AbortController().signal),/PROVIDER_EVIDENCE_COLLECTION_REVIEW_REQUIRED/);
 const c=new pg.Client({connectionString:runtimeInventory.config.connectionString,options:'-c role=crest_inventory'});await c.connect();try{await assert.rejects(c.query('SELECT * FROM crest_private.session_events'),e=>e.code==='42501');await assert.rejects(c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3)',[randomUUID(),owner.id,issuer]),e=>e.code==='42501');}finally{await c.end();}
});
