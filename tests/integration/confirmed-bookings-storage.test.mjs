// Closed schema construction only. No valid booking writes are enabled yet.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
// Explicit construction over immutable49, even when the repository registers later schemas.
import {backupLegacy49Database as backupDatabase,restoreLegacy49Database as restoreDatabase,inventory,keyPair,privateWorkspace,recoveryCluster,connect} from '../support/recovery-drill.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
const sql=await readFile(new URL('../../planning/proposals/confirmed-bookings-storage.sql',import.meta.url),'utf8'),modes=await readFile(new URL('../../planning/proposals/fulfillment-mode-storage.sql',import.meta.url),'utf8');
const history=await readFile(new URL('../../planning/proposals/confirmed-bookings-history.sql',import.meta.url),'utf8');
const plans=await readFile(new URL('../../planning/proposals/confirmed-bookings-invariants.sql',import.meta.url),'utf8'),jobs=await readFile(new URL('../../planning/proposals/confirmed-bookings-job-invariants.sql',import.meta.url),'utf8');
const tables=['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'];
let sandbox,target,client,definitions,cluster,restored,web,login,accepted;
const value=async(query,args=[])=>(await client.query(query,args)).rows[0]?.value;
async function transaction(work){await client.query('BEGIN');try{const result=await work();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
before(async()=>{sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));await transaction(()=>client.query(modes));await sandbox.apply(target,await sandbox.prefix(49));definitions=(await client.query("SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace IN('crest_private'::regnamespace,'crest_commands'::regnamespace) ORDER BY oid")).rows;},{timeout:240000});
after(async()=>{await restored?.end();await cluster?.close();await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('unsafe schema defaults are refused before any booking object or role is created',async()=>{
 await client.query('BEGIN');await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT SELECT ON TABLES TO PUBLIC');await assert.rejects(client.query(sql),error=>error.code==='42501'&&error.message==='CREST_BOOKING_SOURCE_REVIEW_REQUIRED');await client.query('ROLLBACK');
 assert.equal(await value("SELECT to_regclass('crest.jobs') AS value"),null);assert.equal(await value("SELECT count(*)::int AS value FROM pg_roles WHERE rolname='crest_booking_integrity_owner'"),0);
});
test('eleven typed tenant-scoped relations install without rewriting any registered routine or source ledger',async()=>{
 await transaction(async()=>{await client.query(sql);await client.query(history);await client.query(plans);await client.query(jobs);});await sandbox.apply(target,await sandbox.prefix(49));
 for(const item of definitions)assert.equal(await value('SELECT pg_get_functiondef($1::oid) AS value',[item.oid]),item.definition);
 assert.equal(await value('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),49);
 const rows=(await client.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner='crest_schema_owner'::regrole AS owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[tables])).rows;
 assert.equal(rows.length,11);assert(rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity&&row.owned));
 for(const table of tables){const keys=(await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",['crest.'+table])).rows;assert(keys.length>=3);assert(keys.every(key=>key.definition.startsWith('FOREIGN KEY (business_id')));}
});
test('job/appointment cycles defer correctly and reservation projections do not silently prohibit reasoned overrides',async()=>{
 const pointer=(await client.query("SELECT condeferrable,condeferred,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='job_current_appointment' AND conrelid='crest.jobs'::regclass")).rows[0];assert.equal(pointer.condeferrable,true);assert.equal(pointer.condeferred,true);assert.match(pointer.definition,/business_id, current_appointment_id, id/);
 assert.equal(await value("SELECT count(*)::int AS value FROM pg_constraint WHERE conrelid='crest.schedule_reservations'::regclass AND contype='x'"),0);
 assert.equal(await value("SELECT count(*)::int AS value FROM pg_constraint WHERE conrelid='crest.scope_allocations'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%job_id IS NULL%'"),1);
});
test('confirmed evidence rejects SQL null and job scope carries an exact accepted-customer foreign key',async()=>{
 const condition=await value("SELECT pg_get_expr(conbin,conrelid) AS value FROM pg_constraint WHERE conrelid='crest.appointments'::regclass AND contype='c' AND pg_get_expr(conbin,conrelid) LIKE '%confirmation_state%customer_confirmation%'");assert.equal(typeof condition,'string');
 for(const [confirmation,expected] of [[null,false],['null',false],['{}',true]])assert.equal(await value('SELECT '+condition+" AS value FROM (SELECT 'confirmed'::text AS confirmation_state,$1::jsonb AS customer_confirmation) fixture",[confirmation]),expected);
 assert.equal(await value("SELECT count(*)::int AS value FROM pg_constraint WHERE conrelid='crest.job_encounters'::regclass AND confrelid='crest.agreements'::regclass AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (business_id, agreement_id, family_id, customer_id)%'"),1);
});
test('ordinary roles have no table/private-function authority and the integrity role stays closed',async()=>{
 for(const role of ['crest_web','crest_worker','crest_export'])for(const table of tables)assert.equal(await value("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS value",[role,'crest.'+table]),false);
 const role=(await client.query("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname='crest_booking_integrity_owner'")).rows[0];assert(Object.entries(role).every(([key,value])=>key==='rolconfig'?value===null:value===false));assert.equal(await value("SELECT count(*)::int AS value FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole"),0);
 for(const role of ['crest_web','crest_worker','crest_export'])assert.equal(await value("SELECT has_function_privilege($1,'crest_private.booking_construction_closed()','EXECUTE') AS value",[role]),false);
 for(const role of ['crest_web','crest_worker','crest_export'])for(const table of tables)assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,'crest_private.'+table+'_projection(crest.'+table+')']),false);
 assert.equal(await value("SELECT count(*)::int AS value FROM pg_proc WHERE pronamespace='crest_private'::regnamespace AND proname IN('stamp_booking_row','check_booking_row_audit') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']"),2);
});
test('private typed projections retain bigint cents, microseconds and UTC independently of session timezone',async()=>{
 await client.query("SET TIME ZONE 'Pacific/Honolulu'");
 try{
  const stamp='2026-10-30T10:00:00.123456+03:00',large='9007199254740993';
  const job=await value('SELECT crest_private.jobs_projection(jsonb_populate_record(NULL::crest.jobs,$1::jsonb)) AS value',[{version:large,created_at:stamp,updated_at:stamp}]);assert.equal(job.version,large);assert.equal(job.created_at,'2026-10-30T07:00:00.123456Z');assert.equal(job.updated_at,job.created_at);
  const part=await value('SELECT crest_private.allocation_plan_parts_projection(jsonb_populate_record(NULL::crest.allocation_plan_parts,$1::jsonb)) AS value',[{gross_inclusive_cents:large,discount_inclusive_cents:'0',amount_cents:large,created_at:stamp}]);assert.equal(part.amount_cents,large);assert.equal(part.discount_inclusive_cents,'0');
  const reservation=await value('SELECT crest_private.schedule_reservations_projection(jsonb_populate_record(NULL::crest.schedule_reservations,$1::jsonb)) AS value',[{blocked_interval:'["2026-10-30T07:00:00.123456Z","2026-10-30T08:00:00.654321Z")',created_at:stamp}]);assert.deepEqual(reservation.blocked_interval,{start_at:'2026-10-30T07:00:00.123456Z',end_at:'2026-10-30T08:00:00.654321Z',lower_inclusive:true,upper_inclusive:false});
 }finally{await client.query("SET TIME ZONE 'UTC'");}
});
test('even empty administrative writes remain closed until complete transaction invariants are implemented',async()=>{
 for(const table of tables)for(const query of ['INSERT INTO crest.'+table+' DEFAULT VALUES','UPDATE crest.'+table+' SET id=id','DELETE FROM crest.'+table])await assert.rejects(client.query(query),error=>error.code==='55000'&&error.message==='CREST_BOOKING_IMPLEMENTATION_REQUIRED');
 // Include all mutually dependent new relations, so FK safety does not reject
 // the statement before PostgreSQL reaches its closed TRUNCATE triggers.
 await assert.rejects(client.query('TRUNCATE '+tables.map(table=>'crest.'+table).join(',')),error=>error.code==='55000'&&error.message==='CREST_BOOKING_IMPLEMENTATION_REQUIRED');
 assert.equal(await value("SELECT count(*)::int AS value FROM pg_trigger WHERE tgname='booking_construction_closed' AND (tgtype::integer & 32)=32 AND tgenabled='O' AND NOT tgisinternal"),11);
 for(const table of tables)assert.equal(await value('SELECT count(*)::int AS value FROM crest.'+table),0);
});
test('existing trusted CRM and approved/share/accept commands create real retained scope for booking tests',async()=>{
 login='crest_booking_fixture_1'+randomBytes(8).toString('hex');assert.match(login,/^crest_booking_fixture_1[a-f0-9]{16}$/);const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 const bootstrap=await value("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");accepted=await createConfirmedBookingFixture({client,web,bootstrap})();
 assert.equal(accepted.sources.length,2);assert.equal(accepted.sources.reduce((sum,source)=>sum+BigInt(source.amount_cents),0n),25000n);assert(accepted.sources.some(source=>source.amount_cents==='0'));assert(accepted.sources.some(source=>source.vehicle_id===accepted.vehicle));
 assert.equal(await value("SELECT count(*)::int AS value FROM crest.scope_allocations WHERE business_id=$1 AND job_id IS NULL AND allocation_state='unassigned'",[accepted.business]),2);
});
test('current allocation projection retains unassigned sources and the private lock role cannot update family versions',async()=>{
 assert.equal(await value("SELECT has_table_privilege('crest_web','crest.current_scope_allocation_parts','SELECT') AS value"),false);
 const options=await value("SELECT reloptions AS value FROM pg_class WHERE oid='crest.current_scope_allocation_parts'::regclass");assert(options.includes('security_invoker=true'));assert(options.includes('security_barrier=true'));
 await client.query('BEGIN');
 try{await client.query('SET LOCAL ROLE crest_booking_integrity_owner');await client.query('SELECT crest_private.lock_booking_family($1,$2)',[accepted.business,accepted.familyId]);
  const rows=(await client.query('SELECT plan_sequence::text,allocation_state,job_id,amount_cents::text FROM crest.current_scope_allocation_parts WHERE business_id=$1 ORDER BY amount_cents',[accepted.business])).rows;assert.equal(rows.length,2);assert(rows.every(row=>row.plan_sequence==='0'&&row.allocation_state==='unassigned'&&row.job_id===null));
  await client.query('SAVEPOINT denied_family_update');await assert.rejects(client.query('UPDATE crest.quote_families SET version=version+1 WHERE business_id=$1',[accepted.business]),error=>error.code==='42501');await client.query('ROLLBACK TO SAVEPOINT denied_family_update');
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
});
test('confirmed contact and factual confirmation validators reject malformed, missing and future evidence',async()=>{
 const contact=v=>value('SELECT crest_private.valid_booking_contact($1::jsonb) AS value',[v]);
 for(const v of [{kind:'phone',value:'+1 (202) 555-0105 ext. 123'},{kind:'email',value:'synthetic@example.com'},{kind:'no_contact',reason:'Customer arranged this synthetic visit in person'}])assert.equal(await contact(v),true);
 for(const v of [null,{}, {kind:'phone',value:'123'},{kind:'phone',value:'bad phone'},{kind:'email',value:'missing-at-sign'},{kind:'email',value:'synthetic@example.com\nBcc: hidden@example.com'},{kind:'no_contact',reason:'\u00a0'},{kind:'phone',value:'+12025550105',confirmed:true}])assert.equal(await contact(v),false);
 const recorded='2026-10-30T12:00:00.123456Z',base={channel:'in_person',effectiveAt:'2026-10-30T11:00:00.000000Z',evidenceNote:'Customer confirmed this specific fictional appointment'};
 assert.equal(await value('SELECT crest_private.valid_booking_confirmation($1,$2::timestamptz) AS value',[base,recorded]),true);
 for(const v of [null,{...base,effectiveAt:'2026-10-30T12:00:00.123457Z'},{...base,effectiveAt:'2026-02-30T00:00:00.000000Z'},{...base,evidenceNote:'\u00a0'},{...base,channel:'owner_approval'},{...base,extra:true}])assert.equal(await value('SELECT crest_private.valid_booking_confirmation($1,$2::timestamptz) AS value',[v,recorded]),false);
});
test('manual work locations require exact retained text; claimed address identities must match actual source data',async()=>{
 const location=v=>value('SELECT crest_private.valid_booking_location($1,$2,$3,true) AS value',[v,accepted.business,accepted.customer]);
 assert.equal(await location({schemaVersion:1,kind:'manual',locationText:'Synthetic shop — 123 Example Lane, Indianapolis, IN',instructions:null}),true);
 for(const v of [null,{schemaVersion:1,kind:'manual',locationText:' ',instructions:null},{schemaVersion:1,kind:'manual',locationText:'Synthetic shop',instructions:'\u00a0'},{schemaVersion:1,kind:'customer_address',addressId:accepted.customer,addressVersion:'1',snapshot:{}},{schemaVersion:1,kind:'manual',locationText:'Synthetic shop',instructions:null,verified:true}])assert.equal(await location(v),false);
});
test('closed construction schema and existing source rows restore exactly on an independent encrypted point',async()=>{
 const directory=await privateWorkspace(),point=join(directory,'point');await mkdir(point,{mode:0o700});const keys=await keyPair(directory),backup=await backupDatabase(client,target,point,keys.recipient);assert.equal(backup.manifest.schemaVersion,49);assert.equal(backup.manifest.completeBackup,false);
 cluster=await recoveryCluster();const destination=await cluster.database();await restoreDatabase(point,keys.path,destination);restored=await connect(destination);assert.deepEqual(await inventory(restored),backup.manifest.rows);
 for(const table of tables)await assert.rejects(restored.query('DELETE FROM crest.'+table),error=>error.code==='55000'&&error.message==='CREST_BOOKING_IMPLEMENTATION_REQUIRED');
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest.scope_allocations WHERE business_id=$1 AND agreement_id=$2',[accepted.business,accepted.agreementId])).rows[0].n,2);
},{timeout:180000});
