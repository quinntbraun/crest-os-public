// Unregistered catalog construction. Real disposable SQL + encrypted recovery;
// no runtime route, registry adoption, production authority or local-owner secrets.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,connect,hash,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,postgresTool,normalizedSchema} from '../support/recovery-drill.mjs';
import {formatServiceCatalogCsv} from '../../src/commercial/service-catalog-csv.ts';
import {serviceColumns,serviceContentColumns} from '../../src/commercial/service-storage-contract.ts';
import {decodeServiceCatalogCsv} from '../support/service-catalog-csv-fixture.ts';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {bindServiceOriginalReceipt} from '../../src/commercial/service-original-operation.ts';
import {parseOriginalOperationOutcome} from '../../src/security/original-operation-reference.ts';
import pg from 'pg';
import {createBusinessSourceCatalogCollector} from '../../src/security/business-foundation-collector.ts';
import {formatBusinessSourceCatalogBundle} from '../../src/security/business-source-catalog-bundle.ts';
import {verifyBusinessSourceCatalogBundle} from '../../src/tooling/verify-business-source-catalog-bundle.ts';
const proposal=name=>new URL('../../planning/proposals/service-catalog-'+name,import.meta.url);
const sql=await readFile(proposal('source.sql'),'utf8'),meta=JSON.parse(await readFile(proposal('source.json'),'utf8'));
const storage=await readFile(proposal('storage.sql'),'utf8'),commands=await readFile(proposal('commands.sql'),'utf8');
const resolution=await readFile(proposal('resolution.sql'),'utf8'),resolutionMeta=JSON.parse(await readFile(proposal('resolution.json'),'utf8'));
const issuer='https://auth.example.com/auth/v1';
let sandbox,url,admin,web,exporter,login,a,b,bootstrap,original,edited,archive,emptyBusiness,firstSnapshot,point,keys,backup,cluster,restored,restoredUrl,restoredLogin,restoredWeb,sourceInventory;
let catalogOwner,web2,catalogSaved,catalogReference,catalogCommitted,retiredOriginal,retiredDecision,retirementBeforeBackup;
const value=(c,q,args=[])=>c.query(q,args).then(r=>r.rows[0].value);
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business];
const definition=(patch={})=>({name:'Synthetic interior é',inclusions:'=SUM(A1)\nVacuum, "care"; literal \\N',exclusions:'',internalGuidance:'Private scope\nOwner only',rangeLowCents:'9007199254740993',rangeHighCents:'9223372036854775807',estimatedSeconds:'9007199254740993',...patch});
const request=(patch={})=>({operation:randomUUID(),service:randomUUID(),revision:'0',body:{code:'sample-'+randomUUID(),active:true,definition:definition()},...patch});
const save=(f,r,c=web)=>value(c,'SELECT crest_commands.save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth(f),f.epoch,r.operation,r.service,r.revision,r.body]);
const reference=(f,r)=>({schemaVersion:1,businessId:f.business,commandType:'catalog.service.save',reference:{operationId:r.operation,recoveryEpoch:f.epoch,serviceId:r.service,expectedRevision:r.revision}});
const retire=(f,ref,{reason='Owner reviewed the lost service scope.',epoch=f.epoch,c=web}={})=>value(c,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),epoch,ref,reason]);
const resolved=(f,ref,c=web)=>value(c,'SELECT crest_commands.lookup_original_operation_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),ref]);
const lookup=(f,id,c=web)=>value(c,'SELECT crest_commands.lookup_service_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),id]);
const context=(business,c=exporter)=>value(c,'SELECT crest_commands.service_catalog_snapshot_context($1) AS value',[business]);
const page=(entity,business,token,after=null,size=1,c=exporter)=>value(c,'SELECT crest_commands.service_catalog_snapshot_'+entity+'($1,$2,$3,$4) AS value',[business,token,after,size]);
async function transaction(c,run,mode=''){await c.query('BEGIN '+mode);try{const result=await run();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}}
async function session(c,f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await c.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await c.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=await value(admin,"INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic catalog export owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(admin,async()=>{
  const business=await value(admin,"INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic catalog export','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);
  await admin.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=await value(admin,"INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return{subject,actor,business,epoch};
 });
 await admin.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session(admin,f);
}
async function runtime(c,target,roles){
 const login='crest_catalog_source_probe_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 await c.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await c.query('GRANT '+roles.join(',')+' TO '+login);const u=new URL(target);u.username=login;u.password=password;return{login,url:u.toString()};
}
async function collect(business,c=exporter){
 const scope=await context(business,c),result={businessId:business,snapshotToken:scope.snapshotToken,expectedServiceCount:scope.serviceCount,expectedVersionCount:scope.versionCount,services:[],versions:[]};
 for(const entity of ['services','versions']){
  let after=null;for(let i=0;i<=1000;i++){
   const p=await page(entity,business,scope.snapshotToken,after,1,c);assert.equal(p.businessId,business);assert.equal(p.snapshotToken,scope.snapshotToken);
   if(p[entity].length===0)break;assert.equal(p[entity].length,1);assert(after===null||p[entity][0].id>after);result[entity].push(...p[entity]);after=p[entity][0].id;
  }
 }
 assert.equal(result.services.length,Number(scope.serviceCount));assert.equal(result.versions.length,Number(scope.versionCount));return result;
}
const catalogEvidence=(c,business)=>value(c,"SELECT jsonb_build_object('services',(SELECT coalesce(jsonb_agg(crest_private.service_projection(s) ORDER BY id),'[]') FROM crest.services s WHERE business_id=$1),'versions',(SELECT coalesce(jsonb_agg(crest_private.service_version_projection(v) ORDER BY id),'[]') FROM crest.service_versions v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM crest_private.operations o WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM crest_private.audit_events a WHERE business_id=$1)) AS value",[business]);
before(async()=>{
 assert.equal(hash(sql),meta.sqlSha256);assert.equal(hash(storage),meta.requiredSchemaSqlSha256);assert.equal(hash(commands),meta.requiredCommandsSqlSha256);
 assert.equal(hash(resolution),resolutionMeta.sqlSha256);assert.equal(hash(storage),resolutionMeta.requiredSchemaSqlSha256);assert.equal(hash(commands),resolutionMeta.requiredCommandsSqlSha256);
 assert.equal(hash(await readFile(new URL('../../supabase/migrations/'+resolutionMeta.requiredOriginalMigration,import.meta.url))),resolutionMeta.requiredOriginalMigrationSha256);
 sandbox=await migrationSandbox();url=await sandbox.database();admin=await sandbox.connect(url);
 await sandbox.apply(url,await sandbox.prefix(0),true);await installProviderSchema(admin,url);await sandbox.apply(url,await sandbox.prefix(43));
 await transaction(admin,()=>admin.query(storage));await transaction(admin,()=>admin.query(commands));
 bootstrap=await value(admin,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();emptyBusiness=await state();catalogOwner=await state();
 const r=await runtime(sandbox.admin,url,['crest_web','crest_export']);login=r.login;web=await sandbox.connect(r.url);web2=await sandbox.connect(r.url);exporter=await sandbox.connect(r.url);await web.query('SET ROLE crest_web');await web2.query('SET ROLE crest_web');await exporter.query('SET ROLE crest_export');
},{timeout:240000});
after(async()=>{await restoredWeb?.end();if(restoredLogin)await restored.query('DROP ROLE '+restoredLogin);await restored?.end();await cluster?.close();await web?.end();await web2?.end();await exporter?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function guard(change){await admin.query('BEGIN');try{await change();await assert.rejects(admin.query(sql),e=>e.code==='42501'&&e.message==='CREST_CATALOG_SOURCE_REVIEW_REQUIRED');}finally{await admin.query('ROLLBACK');}}
test('source proposal rejects drifted source columns',()=>guard(()=>admin.query('ALTER TABLE crest.service_versions ADD COLUMN unreviewed text')));
test('source proposal rejects changed projector search path',()=>guard(()=>admin.query('ALTER FUNCTION crest_private.service_projection(crest.services) SET search_path=public')));
test('source proposal rejects weakened forced RLS',()=>guard(()=>admin.query('ALTER TABLE crest.service_versions NO FORCE ROW LEVEL SECURITY')));
test('source proposal rejects unsafe catalog role',()=>guard(()=>admin.query('ALTER ROLE crest_catalog_owner LOGIN')));
test('install adds only isolated snapshot functions; registry43 and existing routines stay unchanged',async()=>{
 const before=(await admin.query("SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY p.oid")).rows;
 const prior=(await sandbox.apply(url,await sandbox.prefix(43))).history;
 await transaction(admin,()=>admin.query(sql));assert.deepEqual((await sandbox.apply(url,await sandbox.prefix(43))).history,prior);
 for(const f of before)assert.equal(await value(admin,'SELECT pg_get_functiondef($1::oid) AS value',[f.oid]),f.definition);
});
test('registered43 refuses catalog retirement before the explicit proposal',async()=>{
 const ref=reference(catalogOwner,request());assert.equal(await value(admin,'SELECT crest_private.original_operation_reference_valid($1) AS value',[ref]),false);
 await assert.rejects(retire(catalogOwner,ref),e=>e.code==='22023');
});
async function resolutionGuard(change){await admin.query('BEGIN');try{await change();await assert.rejects(admin.query(resolution),e=>e.code==='42501'&&e.message==='CREST_CATALOG_RESOLUTION_REVIEW_REQUIRED');}finally{await admin.query('ROLLBACK');}}
test('catalog resolution refuses a changed original validator body',()=>resolutionGuard(async()=>{
 const definition=await value(admin,"SELECT pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure) AS value");await admin.query(definition.replace("WHEN 'crm.customer.save'","WHEN 'changed.customer.save'"));
}));
test('catalog resolution refuses changed validator search path',()=>resolutionGuard(()=>admin.query('ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) SET search_path=public')));
test('catalog resolution refuses PUBLIC execution',()=>resolutionGuard(()=>admin.query('GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb) TO PUBLIC')));
test('catalog resolution refuses an unsafe existing role',()=>resolutionGuard(()=>admin.query('ALTER ROLE crest_catalog_owner LOGIN')));
test('catalog recovery changes only the pinned validator, preserving its identity/ACL and registry43',async()=>{
 const routines=()=>admin.query("SELECT p.oid::text,p.proowner::text,p.proacl::text,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY p.oid").then(r=>r.rows);
 const before=await routines(),id=await value(admin,"SELECT 'crest_private.original_operation_reference_valid(jsonb)'::regprocedure::oid::text AS value"),prior=(await sandbox.apply(url,await sandbox.prefix(43))).history;
 await transaction(admin,()=>admin.query(resolution));const after=await routines();assert.equal(after.length,before.length);
 for(const entry of before){const current=after.find(r=>r.oid===entry.oid);if(entry.oid===id){assert.notEqual(current.definition,entry.definition);assert.equal(current.proowner,entry.proowner);assert.equal(current.proacl,entry.proacl);}else assert.deepEqual(current,entry);}
 assert.deepEqual((await sandbox.apply(url,await sandbox.prefix(43))).history,prior);
});
test('catalog original references agree with SQL without admitting draft, finance or malformed revisions',async()=>{
 const ref=reference(catalogOwner,request());assert.equal(await value(admin,'SELECT crest_private.original_operation_reference_valid($1) AS value',[ref]),true);
 for(const revision of ['-1','01','1.0','9223372036854775808','1\n',0,null])assert.equal(await value(admin,'SELECT crest_private.original_operation_reference_valid($1) AS value',[{...ref,reference:{...ref.reference,expectedRevision:revision}}]),false);
 for(const bad of [{...ref,commandType:'finance.post'},{...ref,reference:{...ref.reference,definition:{name:'Never retained'}}},{...ref,reference:{...ref.reference,expectedVersion:'0'}}])assert.equal(await value(admin,'SELECT crest_private.original_operation_reference_valid($1) AS value',[bad]),false);
});
test('committed catalog originals retain typed results after later edits; generic observation cannot clear a mismatched service',async()=>{
 catalogSaved=request();catalogCommitted=await save(catalogOwner,catalogSaved);const ref=catalogReference=reference(catalogOwner,catalogSaved);assert.equal(catalogCommitted.state,'committed');
 assert.equal((await save(catalogOwner,request({service:catalogSaved.service,revision:'1',body:{...catalogSaved.body,definition:definition({name:'Later catalog scope'})}}))).state,'committed');
 const before=await catalogEvidence(admin,catalogOwner.business),observation=await retire(catalogOwner,ref);assert.equal(observation.state,'original_recorded');
 assert.deepEqual(bindServiceOriginalReceipt(await lookup(catalogOwner,catalogSaved.operation),ref),catalogCommitted);
 const wrong={...ref,reference:{...ref.reference,serviceId:randomUUID()}};assert.equal((await resolved(catalogOwner,wrong)).state,'original_recorded');assert.throws(()=>bindServiceOriginalReceipt(catalogCommitted,wrong));
 assert.throws(()=>bindServiceOriginalReceipt(observation,ref));assert.deepEqual(await catalogEvidence(admin,catalogOwner.business),before);
});
test('absent catalog original is retired once with immutable reason/audit; late original writes cannot create it',async()=>{
 const requestToRetire=request();retiredOriginal=reference(catalogOwner,requestToRetire);assert.deepEqual(await resolved(catalogOwner,retiredOriginal),{state:'absent'});
 retiredDecision=await retire(catalogOwner,retiredOriginal);assert.equal(retiredDecision.state,'retired');assert.deepEqual(parseOriginalOperationOutcome(retiredDecision,retiredOriginal),retiredDecision);
 const before=await catalogEvidence(admin,catalogOwner.business);assert.deepEqual(await retire(catalogOwner,retiredOriginal),retiredDecision);assert.deepEqual(await resolved(catalogOwner,retiredOriginal),retiredDecision);
 assert.equal((await retire(catalogOwner,retiredOriginal,{reason:'Different reviewed reason'})).state,'conflict');assert.equal((await save(catalogOwner,requestToRetire)).state,'conflict');
 assert.equal(await value(admin,'SELECT count(*)::int AS value FROM crest.services WHERE id=$1',[requestToRetire.service]),0);
 assert.equal(await value(admin,'SELECT count(*)::int AS value FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[catalogOwner.business,requestToRetire.operation]),1);assert.deepEqual(await catalogEvidence(admin,catalogOwner.business),before);
});
test('catalog retirement rejects another owner and malformed reasons without source changes',async()=>{
 const ref=reference(catalogOwner,request()),before=await catalogEvidence(admin,catalogOwner.business);
 await assert.rejects(retire({...b,business:catalogOwner.business},ref,{epoch:catalogOwner.epoch}),e=>e.code==='42501');
 for(const reason of ['', ' '.repeat(3),'x'.repeat(2001)])await assert.rejects(retire(catalogOwner,ref,{reason}),e=>e.code==='22023');assert.deepEqual(await catalogEvidence(admin,catalogOwner.business),before);
});
test('paused/rotated authority cannot rewrite the original epoch or admit a stale retirement',async()=>{
 const ref=reference(catalogOwner,request());await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[catalogOwner.business]);
 assert.deepEqual(await resolved(catalogOwner,retiredOriginal),retiredDecision);await assert.rejects(retire(catalogOwner,ref),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
 const epoch=randomUUID();await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,active_epoch=$1,version=version+1 WHERE business_id=$2',[epoch,catalogOwner.business]);
 await assert.rejects(retire(catalogOwner,ref),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');const decision=await retire(catalogOwner,ref,{epoch});assert.equal(decision.retirement.recoveryEpoch,epoch);assert.equal(decision.original.reference.recoveryEpoch,catalogOwner.epoch);catalogOwner.epoch=epoch;
});
test('two actual SQL sessions race a catalog save and retirement through the same original identity',async()=>{
 const r=request(),ref=reference(catalogOwner,r),pids=await Promise.all([web,web2].map(c=>value(c,'SELECT pg_backend_pid() AS value')));
 await admin.query('BEGIN');await admin.query('SELECT 1 FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[catalogOwner.business]);
 const pending=Promise.all([save(catalogOwner,r,web),retire(catalogOwner,ref,{c:web2})]);pending.catch(()=>{});
 let results;try{let waiting=false;for(let i=0;i<100;i++){if(await value(admin,"SELECT count(*)=2 AS value FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])){waiting=true;break;}await delay(20);}assert(waiting,'both real sessions waited on command locks');await admin.query('COMMIT');results=await pending;}finally{await admin.query('ROLLBACK');await pending.catch(()=>{});}
 const [saved,decision]=results;assert.equal(await value(admin,'SELECT count(*)::int AS value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[catalogOwner.business,r.operation]),1);
 if(saved.state==='committed'){assert.equal(decision.state,'original_recorded');assert.deepEqual(bindServiceOriginalReceipt(await lookup(catalogOwner,r.operation),ref),saved);}else{assert.equal(saved.state,'conflict');assert.equal(decision.state,'retired');assert.equal(await value(admin,'SELECT count(*)::int AS value FROM crest.services WHERE id=$1',[r.service]),0);}
});
test('ordinary web cannot read bulk source or tables; source role cannot execute catalog writes',async()=>{
 for(const signature of ['crest_commands.service_catalog_snapshot_context(uuid)','crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer)','crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer)']){
  assert.equal(await value(admin,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[signature]),false);
  assert.equal(await value(admin,"SELECT has_function_privilege('crest_export',$1,'EXECUTE') AS value",[signature]),true);
 }
 await assert.rejects(context(a.business,web),e=>e.code==='42501');for(const c of [web,exporter])for(const t of ['crest.services','crest.service_versions'])await assert.rejects(c.query('SELECT * FROM '+t),e=>e.code==='42501');
 await assert.rejects(save(a,request(),exporter),e=>e.code==='42501');
});
test('complete column inventory observes actual pg_catalog and fails on an unlisted future column',async()=>{
 const observed=(await admin.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.oid IN('crest.services'::regclass,'crest.service_versions'::regclass) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum")).rows;
 const manifest={formatVersion:1,migrationCount:43,tables:[['crest.services',serviceColumns],['crest.service_versions',serviceContentColumns]].map(([table,required])=>({table,scope:'business',required,excluded:[],partialEvidenceGroup:null}))};
 assert.deepEqual(verifyExportCoverage(manifest,observed,43),{assurance:'schema_inventory_only',tables:2,requiredColumns:29,excludedColumns:0,partialEvidenceTables:0,completePortableExport:false,completeBackup:false});
 assert.throws(()=>verifyExportCoverage(manifest,[...observed,{table:'crest.services',column:'unreviewed'}],43),/EXPORT_COVERAGE_REVIEW_REQUIRED/);
});
test('seed genuine typed catalog saves, retained edits, archive and a foreign business',async()=>{
 original=request();assert.equal((await save(a,original)).state,'committed');
 edited=request({service:original.service,revision:'1',body:{...original.body,definition:definition({name:'Synthetic revised scope',internalGuidance:null})}});assert.equal((await save(a,edited)).state,'committed');
 archive=request({service:original.service,revision:'2',body:{...edited.body,active:false}});assert.equal((await save(a,archive)).state,'committed');
 assert.equal((await save(b,request())).state,'committed');
});
for(const mode of ['', 'READ ONLY','ISOLATION LEVEL REPEATABLE READ'])test('snapshot refuses wrong transaction mode: '+(mode||'default'),()=>transaction(exporter,()=>assert.rejects(context(a.business),e=>e.code==='25001'),mode));
test('snapshot rejects nonexistent and missing businesses',async()=>{
 for(const business of [randomUUID(),null])await transaction(exporter,()=>assert.rejects(context(business),e=>e.code==='22023'),'ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('empty scoped catalog produces header-only readable source without false backup claims',async()=>{
 await transaction(exporter,async()=>{const rows=await collect(emptyBusiness.business),files=formatServiceCatalogCsv(rows);assert.equal(rows.services.length,0);assert.equal(rows.versions.length,0);assert.equal(decodeServiceCatalogCsv(files.servicesCsv,files.escapeMap,'services').length,0);assert.equal(JSON.parse(files.manifest).completeBackup,false);},'ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('wrong token, cross-business token and invalid page limits refuse both source pages',async()=>{
 for(const entity of ['services','versions'])for(const [kind,size] of [['wrong',1],['missing',1],['foreign',1],['ok',0],['ok',51],['ok',null]])await transaction(exporter,async()=>{
  const scope=await context(a.business),token=kind==='wrong'?'0'.repeat(64):kind==='missing'?null:kind==='foreign'?(await context(b.business)).snapshotToken:scope.snapshotToken;
  await assert.rejects(page(entity,a.business,token,null,size),e=>e.code==='22023');
 },'ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('one snapshot retains archive and every old version, excluding a concurrent later save',async()=>{
 await transaction(exporter,async()=>{
  firstSnapshot=await collect(a.business);assert.equal(firstSnapshot.services.length,1);assert.equal(firstSnapshot.services[0].active,false);assert.equal(firstSnapshot.services[0].version,'3');assert.equal(firstSnapshot.versions.length,2);
  const later=request({service:original.service,revision:'3',body:{...edited.body,active:true,definition:definition({name:'Post snapshot scope'})}});assert.equal((await save(a,later)).state,'committed');
  assert.deepEqual(await collect(a.business),firstSnapshot);
  const files=formatServiceCatalogCsv(firstSnapshot);assert.deepEqual(decodeServiceCatalogCsv(files.servicesCsv,files.escapeMap,'services'),firstSnapshot.services);assert.deepEqual(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions'),firstSnapshot.versions);
  assert.equal(firstSnapshot.versions[0].business_id,a.business);assert(firstSnapshot.versions.every(v=>v.range_low_cents==='9007199254740993'&&v.range_high_cents==='9223372036854775807'&&v.estimated_seconds==='9007199254740993'));
 },'ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await transaction(exporter,async()=>{const later=await collect(a.business);assert.equal(later.services[0].version,'4');assert.equal(later.versions.length,3);},'ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('encrypted independent restore preserves all catalog source, receipts, audits and grants at one point',async()=>{
 const directory=await privateWorkspace();point=join(directory,'point');await mkdir(point,{mode:0o700});keys=await keyPair(directory);
 const prior=await catalogEvidence(admin,a.business);
 retirementBeforeBackup=await catalogEvidence(admin,catalogOwner.business);
 const sourceSchema=normalizedSchema(await postgresTool('pg_dump',url,['--schema-only']));
 backup=await backupDatabase(admin,url,point,keys.recipient,async()=>{
  const later=request({service:original.service,revision:'4',body:{...edited.body,active:false,definition:definition({name:'After encrypted point'})}});assert.equal((await save(a,later)).state,'committed');
 });
 assert.equal(backup.manifest.schemaVersion,43);assert.equal(backup.manifest.completeBackup,false);
 cluster=await recoveryCluster();restoredUrl=await cluster.database();assert.notEqual(new URL(url).port,new URL(restoredUrl).port);
 try{await restoreDatabase(point,keys.path,restoredUrl);}catch(error){
  if(error.message==='SYNTHETIC_RECOVERY_RESTORE_FAILED:schema'){
   // Bounded diagnostics for public-schema permission/order differences only.
   // Never print dump contents, row values, connection strings or credentials.
   const destination=normalizedSchema(await postgresTool('pg_dump',restoredUrl,['--schema-only'])),before=sourceSchema.split('\n'),after=destination.split('\n');
   const index=before.findIndex((line,i)=>line!==after[i]);
   const describe=line=>line===undefined?'missing':line.replace(/'(?:''|[^'])*'|'.*$/g,"'<redacted literal>'").slice(0,512);
   const object=before.slice(0,index+1).filter(line=>line.startsWith('-- Name:')).at(-1);
   throw new Error('SYNTHETIC_CATALOG_SCHEMA_REVIEW_REQUIRED:'+JSON.stringify({line:index,object:describe(object),source:describe(before[index]),restored:describe(after[index]),sameLineMultiset:JSON.stringify([...before].sort())===JSON.stringify([...after].sort())}),{cause:error});
  }throw error;
 }restored=await connect(restoredUrl);
 assert.deepEqual(await inventory(restored),backup.manifest.rows);assert.deepEqual(await catalogEvidence(restored,a.business),prior);
 assert.deepEqual(await catalogEvidence(restored,catalogOwner.business),retirementBeforeBackup);
 const p=await runtime(restored,restoredUrl,['crest_web','crest_export']);restoredLogin=p.login;restoredWeb=await connect(p.url);await restoredWeb.query('SET ROLE crest_web');
 const restoredExport=await connect(p.url);await restoredExport.query('SET ROLE crest_export');try{
  await transaction(restoredExport,async()=>{const rows=await collect(a.business,restoredExport);assert.equal(rows.services[0].version,'4');assert.equal(rows.versions.length,3);const files=formatServiceCatalogCsv(rows);assert.deepEqual(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions'),rows.versions);},'ISOLATION LEVEL REPEATABLE READ READ ONLY');
 }finally{await restoredExport.end();}
 sourceInventory=await inventory(admin);
},{timeout:180000});
test('restored credentials are retired and the new incident epoch remains write-paused',async()=>{
 const epoch=randomUUID(),incident=randomUUID(),record=join(point,'independent-incident.json');await writeFile(record,JSON.stringify({businessId:a.business,priorEpoch:a.epoch,epoch,incident,writesEnabled:false}),{flag:'wx',mode:0o600});
 await transaction(restored,async()=>{
  await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$1,incident_id=$2,version=version+1 WHERE business_id=$3',[epoch,incident,a.business]);
  await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=gen_random_uuid(),incident_id=$1,version=version+1 WHERE business_id=$2',[incident,catalogOwner.business]);
  await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
  await restored.query("UPDATE crest_private.actors SET current_security_epoch=gen_random_uuid(),version=version+1 WHERE kind='owner'");await restored.query('DELETE FROM auth.sessions');
 });
 assert.deepEqual(await save(a,request(),restoredWeb),{state:'denied'});
 const fresh=await session(restored,a);for(const f of [fresh,{...fresh,epoch}])await assert.rejects(save(f,request(),restoredWeb),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
 assert.equal(await value(restored,'SELECT writes_enabled AS value FROM crest_private.business_recovery_authorities WHERE business_id=$1',[a.business]),false);
 assert.equal(await value(restored,'SELECT count(*)::int AS value FROM crest_private.app_sessions WHERE revoked_at IS NOT NULL AND (provider_token_ciphertext IS NOT NULL OR key_id IS NOT NULL)'),0);
 const catalogFresh=await session(restored,catalogOwner),catalogEpoch=await value(restored,'SELECT active_epoch AS value FROM crest_private.business_recovery_authorities WHERE business_id=$1',[catalogOwner.business]);
 assert.deepEqual(await resolved(catalogFresh,retiredOriginal,restoredWeb),retiredDecision);
 assert.deepEqual(bindServiceOriginalReceipt(await lookup(catalogFresh,catalogSaved.operation,restoredWeb),catalogReference),catalogCommitted);
 await assert.rejects(retire(catalogFresh,reference(catalogFresh,request()),{epoch:catalogEpoch,c:restoredWeb}),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
 assert.deepEqual(await inventory(admin),sourceInventory);
});
test('actual capacity boundary includes 1000 inactive services and refuses 1001 instead of truncating',async()=>{
 const body={code:'',active:false,definition:definition({name:'Synthetic capacity scope',inclusions:'Included',exclusions:'',internalGuidance:null,rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null})};
 for(let i=0;i<1000;i++)assert.equal((await save(emptyBusiness,request({body:{...body,code:'capacity-'+i}}))).state,'committed');
 await transaction(exporter,async()=>{
  const scope=await context(emptyBusiness.business);assert.equal(scope.serviceCount,'1000');assert.equal(scope.versionCount,'1000');
  const p=await page('services',emptyBusiness.business,scope.snapshotToken,null,50);assert.equal(p.services.length,50);assert(p.services.every(s=>s.active===false));
 },'ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal((await save(emptyBusiness,request({body:{...body,code:'capacity-over-limit'}}))).state,'committed');
 await transaction(exporter,()=>assert.rejects(context(emptyBusiness.business),e=>e.code==='54000'&&e.message==='CREST_CATALOG_SNAPSHOT_LIMIT'),'ISOLATION LEVEL REPEATABLE READ READ ONLY');
},{timeout:180000});

async function withCatalogCollector(f,run){
 const source=await runtime(sandbox.admin,url,['crest_export']);
 try{const collector=createBusinessSourceCatalogCollector({connectionString:source.url,environment:'test',businessId:f.business});await run(collector);}
 finally{await sandbox.admin.query('DROP ROLE '+source.login);}
}
function catalogRows(capture){
 const c=JSON.parse(capture.catalog),context=JSON.parse(c.context),services=c.pages.services.flatMap(t=>JSON.parse(t).services),versions=c.pages.versions.flatMap(t=>JSON.parse(t).versions);
 return{c,input:{businessId:c.businessId,snapshotToken:context.snapshotToken,expectedServiceCount:context.serviceCount,expectedVersionCount:context.versionCount,services,versions}};
}
async function verifyJointPackage(capture){
 const source=capture.forCatalogServer(),binding={businessId:source.source.businessId,generationId:source.source.generationId,appReleaseId:'a'.repeat(40),sourceSchemaVersion:43};
 const formatted=(await formatBusinessSourceCatalogBundle(capture,binding)).forCatalogBundle();
 const verified=verifyBusinessSourceCatalogBundle(formatted.manifest,formatted.parts,binding).forCatalogBundleVerification();
 assert.equal(verified.originals.catalog,source.catalog);assert.equal(verified.originals.history,source.source.history);assert.equal(verified.originals.journal,source.source.journal);assert.equal(verified.recordCount,source.recordCount);assert.equal(verified.catalogRegistered,false);assert.equal(verified.completeBackup,false);return verified;
}
test('joint collector captures empty catalog with genuine foundation/CRM/journal and explicit unregistered status',async()=>{
 const f=await state();await withCatalogCollector(f,async collector=>{
  const sealed=await collector(new AbortController().signal),capture=sealed.forCatalogServer(),{c,input}=catalogRows(capture);
  const verified=await verifyJointPackage(sealed);assert.equal(verified.catalogRows.services.length,0);
  assert.throws(()=>JSON.stringify(sealed),/BUSINESS_FOUNDATION_CAPTURE_PRIVATE/);assert.equal(sealed.forJournalServer,undefined);
  assert.equal(capture.registeredSourceSchemaVersion,43);assert.equal(capture.catalogRegistered,false);assert.equal(capture.source.sourceSchemaVersion,43);assert.equal(capture.completePortableExport,false);
  assert.equal(c.generationId,capture.source.generationId);assert.equal(c.observedAt,capture.source.observedAt);assert.equal(c.recordCount,0);assert.equal(capture.recordCount,capture.source.recordCount);
  const csv=formatServiceCatalogCsv(input);assert.deepEqual(decodeServiceCatalogCsv(csv.servicesCsv,csv.escapeMap,'services'),[]);
  assert.equal(JSON.parse(capture.source.journal).businessId,f.business);
 });
});
test('joint collector retains service versions and original source history for a portable catalog round trip',async()=>{
 const f=await state(),first=request();assert.equal((await save(f,first)).state,'committed');
 const second=request({service:first.service,revision:'1',body:{...first.body,definition:definition({name:'Revised joint snapshot scope'})}});assert.equal((await save(f,second)).state,'committed');
 await withCatalogCollector(f,async collector=>{
  const sealed=await collector(new AbortController().signal),capture=sealed.forCatalogServer(),{c,input}=catalogRows(capture),csv=formatServiceCatalogCsv(input);
  const verified=await verifyJointPackage(sealed);assert.deepEqual(verified.catalogRows.services,input.services);assert.deepEqual(verified.catalogRows.versions,input.versions);
  assert.equal(c.recordCount,3);assert.equal(input.services[0].version,'2');assert.equal(input.versions.length,2);assert.equal(capture.recordCount,capture.source.recordCount+3);
  assert.deepEqual(decodeServiceCatalogCsv(csv.servicesCsv,csv.escapeMap,'services'),input.services);assert.deepEqual(decodeServiceCatalogCsv(csv.versionsCsv,csv.escapeMap,'service_versions'),input.versions);
  const history=JSON.parse(capture.source.history);assert(history.records.some(r=>r.kind==='operation'&&r.canonicalEvidence.includes(first.operation)));assert(history.records.some(r=>r.kind==='operation'&&r.canonicalEvidence.includes(second.operation)));
  assert.equal(capture.metadataBytes,capture.source.metadataBytes+c.metadataBytes);assert.equal(capture.evidenceBytes,capture.source.evidenceBytes+Buffer.byteLength(capture.catalog));
 });
});
test('actual concurrent catalog commit cannot mix later content into the one-connection source snapshot',async()=>{
 const f=await state(),first=request();assert.equal((await save(f,first)).state,'committed');
 const second=request({service:first.service,revision:'1',body:{...first.body,definition:definition({name:'Committed during actual collection'})}});
 await withCatalogCollector(f,async collector=>{
  const originalQuery=pg.Client.prototype.query,calls=[],connections=new Set();let changed=false;
  pg.Client.prototype.query=function(...args){
   if(this.connectionParameters.application_name==='crest_business_capture'){
    connections.add(this);calls.push(args[0]);
    if(!changed&&typeof args[0]==='string'&&args[0].includes('.service_catalog_snapshot_services(')){
     changed=true;return save(f,second).then(result=>{assert.equal(result.state,'committed');return originalQuery.apply(this,args);});
    }
   }
   return originalQuery.apply(this,args);
  };
  let sealed,capture;try{sealed=await collector(new AbortController().signal);capture=sealed.forCatalogServer();}finally{pg.Client.prototype.query=originalQuery;}
  assert.equal(changed,true);assert.equal(connections.size,1);assert(calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));assert.equal(calls.at(-1),'COMMIT');assert.equal(calls.filter(s=>s.includes('business_configuration_export_context')).length,1);
  const {input}=catalogRows(capture);assert.equal(input.services[0].version,'1');assert.equal(input.versions.length,1);assert.equal(input.versions[0].name,first.body.definition.name);
  const history=JSON.parse(capture.source.history);assert(history.records.some(r=>r.kind==='operation'&&r.canonicalEvidence.includes(first.operation)));assert(!history.records.some(r=>r.kind==='operation'&&r.canonicalEvidence.includes(second.operation)));
  assert.equal(await value(admin,'SELECT version::text AS value FROM crest.services WHERE business_id=$1 AND id=$2',[f.business,first.service]),'2');
  const verified=await verifyJointPackage(sealed);assert.equal(verified.catalogRows.services[0].version,'1');assert(!verified.originals.history.includes(second.operation));
 });
});
test('catalog page cancellation discards the whole joint capture and permits a fresh explicit read',async()=>{
 const f=await state(),first=request();assert.equal((await save(f,first)).state,'committed');await withCatalogCollector(f,async collector=>{
  const controller=new AbortController(),originalQuery=pg.Client.prototype.query;let read=false;
  pg.Client.prototype.query=function(...args){if(this.connectionParameters.application_name==='crest_business_capture'&&typeof args[0]==='string'&&args[0].includes('.service_catalog_snapshot_versions(')){read=true;return originalQuery.apply(this,args).then(r=>{controller.abort();return r;});}return originalQuery.apply(this,args);};
  try{await assert.rejects(collector(controller.signal),e=>e.message==='BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED');assert.equal(read,true);}finally{pg.Client.prototype.query=originalQuery;}
  const capture=(await collector(new AbortController().signal)).forCatalogServer();assert.equal(catalogRows(capture).input.services.length,1);
 });
});
