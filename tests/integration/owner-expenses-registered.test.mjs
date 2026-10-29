// Actual registered48-to49 coordinator in disposable databases. Runtime and
// owner migration remain closed pending combined recovery/application gates.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {inventory,recoveryCluster} from '../support/recovery-drill.mjs';
import {ownerExpense49Candidate} from '../support/owner-expense49-candidate.mjs';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
let sandbox,client,target,candidate,prior,oldRows,f,guardCluster,guardSandbox,guardTarget,guardClient;
const value=(query,args=[])=>client.query(query,args).then(r=>r.rows[0].value);
async function transaction(fn){await client.query('BEGIN');try{const r=await fn();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}
const issuer='https://auth.example.com/auth/v1';
async function state(){
 const bootstrap=await value("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'"),subject=randomUUID();
 const actor=await value("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic expense owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(async()=>{const business=await value("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic expenses','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await value("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return {business,actor,epoch,subject};});
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
 f.provider=randomUUID();f.session=randomUUID();f.hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[f.provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[f.session,actor,f.provider,f.hash,randomBytes(32)]);return f;
}
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const payload={paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic wash soap',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
const request=(patch={})=>({id:randomUUID(),operation:randomUUID(),version:'0',payload:{...payload},...patch});
async function asWeb(fn){return transaction(async()=>{await client.query('SET LOCAL ROLE crest_web');return fn();});}
const save=(f,r)=>asWeb(()=>value('SELECT crest_commands.save_expense($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS value',[...auth(f),f.epoch,r.operation,r.id,r.version,r.payload]));

async function definitions(c){return (await c.query("SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY 1,2,3")).rows;}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=(await sandbox.apply(target,await sandbox.prefix(48))).history;f=await state();f.customer=randomUUID();await asWeb(()=>value('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth(f),f.epoch,randomUUID(),f.customer,{displayName:'Synthetic pre-upgrade customer é 😀',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}]));oldRows=await inventory(client);candidate=await ownerExpense49Candidate(sandbox);
 guardCluster=await recoveryCluster();guardSandbox=await migrationSandbox(guardCluster.testDatabaseUrl);guardTarget=await guardSandbox.database();guardClient=await guardSandbox.connect(guardTarget);await guardSandbox.apply(guardTarget,await guardSandbox.prefix(0),true);await installProviderSchema(guardClient,guardTarget);await guardSandbox.apply(guardTarget,await guardSandbox.prefix(48));
},{timeout:240000});
after(async()=>{try{await guardSandbox?.close();}finally{try{await guardCluster?.close();}finally{await sandbox?.close();}}});

test('candidate49 exactly preserves all seven reviewed bodies and frozen48 prefix',async()=>{
 const bytes=Buffer.from(candidate.sql);for(const body of candidate.bodies){const original=await readFile(new URL('../../'+body.path,import.meta.url));assert.equal(createHash('sha256').update(original).digest('hex'),body.sha256);assert(bytes.subarray(body.offset,body.offset+body.bytes).equals(original));}assert.equal(candidate.bodies.length,7);const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8'));assert.equal(registry.migrations.length,49);assert.equal(registry.migrations.at(-1).sha256,candidate.sha256);assert.equal(await readFile(new URL('../../supabase/migrations/'+candidate.file,import.meta.url),'utf8'),candidate.sql);
});
test('early closed-role refusal makes no financial definitions or data changes',async()=>{
 const before=await definitions(client),rows=await inventory(client);await client.query('BEGIN');try{await client.query('ALTER ROLE crest_session_owner LOGIN');await assert.rejects(client.query(candidate.sql),e=>e.code==='42501'&&e.message==='CREST_EXPENSE49_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}assert.deepEqual(await definitions(client),before);assert.deepEqual(await inventory(client),rows);assert.equal(await value("SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations"),48);
});
test('actual coordinator late namespace refusal atomically preserves48, existing definitions and rows',async()=>{
 await guardClient.query('SET ROLE crest_schema_owner');await guardClient.query('CREATE FUNCTION crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT NULL::jsonb $$');await guardClient.query('RESET ROLE');const defs=await definitions(guardClient),rows=await inventory(guardClient),input=await ownerExpense49Candidate(guardSandbox);await assert.rejects(guardSandbox.apply(guardTarget,input.directory),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.deepEqual(await definitions(guardClient),defs);assert.deepEqual(await inventory(guardClient),rows);assert.equal((await guardClient.query('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations')).rows[0].value,48);assert.equal((await guardClient.query("SELECT to_regclass('crest.expense_revisions') AS value")).rows[0].value,null);assert.equal((await guardClient.query("SELECT to_regclass('crest.expense_receipt_revisions') AS value")).rows[0].value,null);assert.equal((await guardClient.query("SELECT count(*)::int AS value FROM pg_roles WHERE rolname='crest_expense_owner'")).rows[0].value,0);
},{timeout:120000});
test('actual48-to49 candidate applies and replays idempotently while preserving every prior business row',async()=>{
 const result=await sandbox.apply(target,candidate.directory);assert.equal(result.history.length,49);assert.deepEqual(result.history.slice(0,48),prior);assert.deepEqual((await sandbox.apply(target,candidate.directory)).history,result.history);const after=await inventory(client);for(const row of oldRows.filter(r=>r.schema!=='supabase_migrations'))assert.deepEqual(after.find(r=>r.schema===row.schema&&r.name===row.name),row);const coverage=JSON.parse(await readFile(new URL('../../planning/proposals/owner-expenses-coverage.json',import.meta.url),'utf8')),observed=(await client.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;assert.deepEqual(verifyExportCoverage(coverage,observed,49),{assurance:'schema_inventory_only',tables:56,requiredColumns:900,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});assert.equal(observed.length,910);
},{timeout:120000});
test('trusted financial saves work on the actual49 ledger with an unchanged prior customer',async()=>{
 const r=request(),result=await save(f,r);assert.equal(result.state,'committed');assert.deepEqual(await save(f,r),result);assert.equal(await value('SELECT count(*)::int AS value FROM crest.expense_revisions WHERE business_id=$1 AND expense_id=$2',[f.business,r.id]),1);assert.equal(await value('SELECT display_name AS value FROM crest.customers WHERE id=$1',[f.customer]),'Synthetic pre-upgrade customer é 😀');assert.equal((await client.query("SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS unsafe FROM pg_roles WHERE rolname='crest_expense_owner'")).rows[0].unsafe,false);
});
