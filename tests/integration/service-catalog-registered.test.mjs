// Actual registered44 upgrade and retained catalog lifecycle. Synthetic only.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {formatServiceCatalogCsv} from '../../src/commercial/service-catalog-csv.ts';
import {verifyServiceCatalogCsv} from '../../src/tooling/verify-service-catalog-csv.ts';
import {bindServiceOriginalReceipt} from '../../src/commercial/service-original-operation.ts';
import {backupDatabase,restoreDatabase,restoreLegacy43Database,connect,hash,inventory,keyPair,privateWorkspace,recoveryCluster} from '../support/recovery-drill.mjs';
const adoption=JSON.parse(await readFile(new URL('../../planning/CATALOG_SCHEMA44_ADOPTION.json',import.meta.url),'utf8'));
const sql=await readFile(new URL('../../supabase/migrations/'+adoption.migration.file,import.meta.url),'utf8');
const issuer='https://auth.example.com/auth/v1';
let sandbox,target,client,guardTarget,guardClient,prior,receipt,bootstrap,web,exporter,owner,first,firstReceipt,firstRef,archived,retiredRef,retiredOutcome,point,keys,backup,cluster,restoredUrl,restored,restoredWeb,sourceAfter;
const logins=[];
const value=(c,q,args=[])=>c.query(q,args).then(r=>r.rows[0].value);
async function transaction(c,run,mode=''){await c.query('BEGIN '+mode);try{const result=await run();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}}
async function runtime(admin,url,role){
 const login='crest_catalog44_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');await admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");logins.push({admin,login});await admin.query('GRANT '+role+' TO '+login);
 const u=new URL(url);u.username=login;u.password=password;const c=await connect(u.toString());await c.query('SET ROLE '+role);return c;
}
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business];
const definition=(patch={})=>({name:'Synthetic registered44 scope',inclusions:'=SUM(A1)\nVacuum, "care"; literal \\N',exclusions:'',internalGuidance:"'Private\\scope",rangeLowCents:'9007199254740993',rangeHighCents:'9223372036854775807',estimatedSeconds:'9007199254740993',...patch});
const command=(patch={})=>({operation:randomUUID(),service:randomUUID(),revision:'0',body:{code:'registered44-'+randomUUID(),active:true,definition:definition()},...patch});
const save=(f,r,c=web)=>value(c,'SELECT crest_commands.save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth(f),f.epoch,r.operation,r.service,r.revision,r.body]);
const ref=(f,r)=>({schemaVersion:1,businessId:f.business,commandType:'catalog.service.save',reference:{operationId:r.operation,recoveryEpoch:f.epoch,serviceId:r.service,expectedRevision:r.revision}});
const lookup=(f,r,c=web)=>value(c,'SELECT crest_commands.lookup_service_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),r.operation]);
const resolve=(f,original,c=web)=>value(c,'SELECT crest_commands.lookup_original_operation_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),original]);
const retire=(f,original,c=web)=>value(c,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),f.epoch,original,'Owner reviewed the missing synthetic scope.']);
async function session(c,f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);await c.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await c.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return{...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=await value(client,"INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic registered44 owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(client,async()=>{
  const business=await value(client,"INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic registered44','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=await value(client,"INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return{actor,subject,business,epoch};
 });
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session(client,f);
}
const definitions=c=>c.query("SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.proowner::regrole::text AS owner,p.proconfig,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY 1,2,3").then(r=>r.rows);
before(async()=>{
 assert.equal(hash(sql),adoption.migration.sha256);sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(43));
 guardTarget=await sandbox.database();guardClient=await sandbox.connect(guardTarget);await sandbox.apply(guardTarget,await sandbox.prefix(0),true);await installProviderSchema(guardClient,guardTarget);await sandbox.apply(guardTarget,await sandbox.prefix(43));
},{timeout:240000});
after(async()=>{
 await restoredWeb?.end();await web?.end();await exporter?.end();
 for(const {admin,login}of logins.toReversed())await admin.query('DROP ROLE '+login);
 await restored?.end();await cluster?.close();await sandbox?.close();
});
test('actual migration CLI refuses late validator drift and atomically retains registered43 with no partial catalog',async()=>{
 await guardClient.query('ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) SET search_path=public');const before=await definitions(guardClient);
 await assert.rejects(sandbox.apply(guardTarget),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
 const ledgerRoot=join(sandbox.workspace,'ledger'),targets=(await readdir(ledgerRoot)).filter(name=>/^[a-f0-9]{64}$/.test(name)),diagnostics=[];
 for(const target of targets)for(const file of(await readdir(join(ledgerRoot,target))).filter(name=>name.startsWith('failed-cli-')&&name.endsWith('.json')))diagnostics.push(JSON.parse(await readFile(join(ledgerRoot,target,file),'utf8')));
 assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].rawOutputRetained,false);assert(diagnostics[0].publicErrorCodes.length>0);assert(diagnostics[0].publicErrorCodes.every(code=>sql.includes(code)));
 assert.equal(await value(guardClient,"SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations"),43);assert.equal(await value(guardClient,"SELECT to_regclass('crest.services') AS value"),null);assert.equal(await value(guardClient,"SELECT to_regclass('crest.service_versions') AS value"),null);
 assert.equal(await value(sandbox.admin,"SELECT count(*)::int AS value FROM pg_roles WHERE rolname IN('crest_catalog_owner','crest_catalog_integrity_owner')"),0);assert.deepEqual(await definitions(guardClient),before);
 // The failed target's ledger is retained for review; never retry it blindly.
});
for(const [name,change,message]of [
 ['unsafe original owner',"ALTER ROLE crest_integrity_owner LOGIN",'CREST_CATALOG_SOURCE_REVIEW_REQUIRED'],
 ['weakened original RLS',"ALTER TABLE crest.businesses NO FORCE ROW LEVEL SECURITY",'CREST_CATALOG_SOURCE_REVIEW_REQUIRED'],
 ['late original validator path',"ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) SET search_path=public",'CREST_CATALOG_RESOLUTION_REVIEW_REQUIRED']
])test('whole44 SQL refuses '+name+' and rolls back its earlier components',async()=>{
 const before=await definitions(client);await client.query('BEGIN');try{await client.query(change);await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message===message);}finally{await client.query('ROLLBACK');}
 assert.deepEqual(await definitions(client),before);assert.equal(await value(client,"SELECT to_regclass('crest.services') AS value"),null);assert.equal(await value(client,'SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),43);
 assert.equal(await value(sandbox.admin,"SELECT count(*)::int AS value FROM pg_roles WHERE rolname IN('crest_catalog_owner','crest_catalog_integrity_owner')"),0);
});
test('actual registered43-to44 migration preserves every historical row and reapplies idempotently',async()=>{
 receipt=await sandbox.apply(target);assert.equal(receipt.history.length,44);assert.deepEqual(receipt.history.slice(0,43),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
 bootstrap=await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");web=await runtime(sandbox.admin,target,'crest_web');exporter=await runtime(sandbox.admin,target,'crest_export');
});
test('registered44 actual catalog accounts for every642 column with unchanged credential exclusions and closed privileges',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8')),columns=(await client.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
 assert.deepEqual(verifyExportCoverage(manifest,columns,44),{assurance:'schema_inventory_only',tables:41,requiredColumns:632,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 for(const table of adoption.catalogTables){assert.equal(await value(client,"SELECT relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole AS value FROM pg_class WHERE oid=$1::regclass",[table]),true);await assert.rejects(web.query('SELECT * FROM '+table),e=>e.code==='42501');}
 assert.equal(await value(client,"SELECT count(*)::int AS value FROM pg_roles WHERE rolname IN('crest_catalog_owner','crest_catalog_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL"),2);
 assert.equal(await value(client,"SELECT count(*)::int AS value FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_catalog_owner','crest_catalog_integrity_owner')"),0);
 assert.equal(await value(web,"SELECT pg_has_role(current_user,'crest_export','MEMBER') AS value"),false);
});
test('registered44 trusted lifecycle retains original receipts through edit/archive and preserves exact CSV source',async()=>{
 owner=await state();first=command();firstRef=ref(owner,first);firstReceipt=await save(owner,first);assert.equal(firstReceipt.state,'committed');
 const edited=command({service:first.service,revision:'1',body:{...first.body,definition:definition({name:'Revised registered44 scope'})}});assert.equal((await save(owner,edited)).receipt.serviceRevision,'2');
 archived=command({service:first.service,revision:'2',body:{...edited.body,active:false}});assert.equal((await save(owner,archived)).receipt.serviceRevision,'3');
 assert.deepEqual(bindServiceOriginalReceipt(await lookup(owner,first),firstRef),firstReceipt);
 const history=await value(web,'SELECT crest_commands.read_service_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(owner),first.service,'0',20]);assert.equal(history.history.length,3);assert.equal(history.history[0].content.name,first.body.definition.name);assert.equal(history.service.active,false);
 await transaction(exporter,async()=>{
  const context=await value(exporter,'SELECT crest_commands.service_catalog_snapshot_context($1) AS value',[owner.business]);
  const roots=await value(exporter,'SELECT crest_commands.service_catalog_snapshot_services($1,$2,$3,$4) AS value',[owner.business,context.snapshotToken,null,20]),contents=await value(exporter,'SELECT crest_commands.service_catalog_snapshot_versions($1,$2,$3,$4) AS value',[owner.business,context.snapshotToken,null,20]);
  const csv=formatServiceCatalogCsv({businessId:owner.business,snapshotToken:context.snapshotToken,expectedServiceCount:context.serviceCount,expectedVersionCount:context.versionCount,services:roots.services,versions:contents.versions});
  const texts={'services.csv':csv.servicesCsv,'service_versions.csv':csv.versionsCsv,'service_catalog_escape_map.json':csv.escapeMap,'service_catalog_dictionary.json':csv.dictionary},m=JSON.parse(csv.manifest),files=m.parts.map(p=>({...p,content:texts[p.name],contentType:p.name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json'}));
  const decoded=verifyServiceCatalogCsv(csv.manifest,files,{businessId:owner.business,snapshotToken:context.snapshotToken});assert.deepEqual(decoded.services,roots.services);assert.deepEqual(decoded.versions,contents.versions);assert.equal(decoded.versions.length,2);
 },'ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('registered44 absent-original retirement is immutable and blocks late catalog creation',async()=>{
 const lost=command();retiredRef=ref(owner,lost);retiredOutcome=await retire(owner,retiredRef);assert.equal(retiredOutcome.state,'retired');assert.deepEqual(await retire(owner,retiredRef),retiredOutcome);assert.deepEqual(await resolve(owner,retiredRef),retiredOutcome);assert.deepEqual(await save(owner,lost),{state:'conflict',reason:'operation'});
 assert.equal(await value(client,'SELECT count(*)::int AS value FROM crest.services WHERE business_id=$1 AND id=$2',[owner.business,lost.service]),0);
});
test('independent encrypted44 restore retains catalog history and excludes an actual post-snapshot edit',async()=>{
 point=join(await privateWorkspace(),'registered44-point');await mkdir(point);keys=await keyPair(point);
 backup=await backupDatabase(client,target,point,keys.recipient,async()=>{const late=command({service:first.service,revision:'3',body:{...archived.body,definition:definition({name:'After registered44 snapshot'})}});assert.equal((await save(owner,late)).receipt.serviceRevision,'4');});
 assert.equal(backup.manifest.schemaVersion,44);assert.equal(backup.manifest.completeBackup,false);sourceAfter=await inventory(client);cluster=await recoveryCluster();restoredUrl=await cluster.database();restored=await connect(restoredUrl);
 await assert.rejects(restoreLegacy43Database(point,keys.path,restoredUrl));assert.equal(await value(restored,"SELECT to_regclass('crest.services') AS value"),null);
 const manifest=await restoreDatabase(point,keys.path,restoredUrl);assert.equal(manifest.schemaVersion,44);assert.equal(await value(restored,'SELECT version::text AS value FROM crest.services WHERE business_id=$1 AND id=$2',[owner.business,first.service]),'3');
 assert.deepEqual(await inventory(restored),backup.manifest.rows);assert.equal(await value(restored,'SELECT count(*)::int AS value FROM crest.service_versions WHERE business_id=$1',[owner.business]),2);
},{timeout:180000});
test('restored44 writers stay paused after epoch rotation and original catalog evidence remains available',async()=>{
 const incident=randomUUID(),epoch=randomUUID();await transaction(restored,async()=>{
  await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$1,incident_id=$2,version=version+1 WHERE business_id=$3',[epoch,incident,owner.business]);
  await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');await restored.query("UPDATE crest_private.actors SET current_security_epoch=gen_random_uuid(),version=version+1 WHERE kind='owner'");await restored.query('DELETE FROM auth.sessions');
 });
 restoredWeb=await runtime(restored,restoredUrl,'crest_web');
 assert.deepEqual(await save(owner,command(),restoredWeb),{state:'denied'});const fresh=await session(restored,owner);
 for(const f of [fresh,{...fresh,epoch}])await assert.rejects(save(f,command(),restoredWeb),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
 assert.deepEqual(bindServiceOriginalReceipt(await lookup(fresh,first,restoredWeb),firstRef),firstReceipt);assert.deepEqual(await resolve(fresh,retiredRef,restoredWeb),retiredOutcome);
 assert.equal(await value(restored,'SELECT writes_enabled AS value FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business]),false);assert.equal(await value(restored,'SELECT count(*)::int AS value FROM crest_private.app_sessions WHERE revoked_at IS NOT NULL AND (provider_token_ciphertext IS NOT NULL OR key_id IS NOT NULL)'),0);
 assert.deepEqual(await inventory(client),sourceAfter);
});
