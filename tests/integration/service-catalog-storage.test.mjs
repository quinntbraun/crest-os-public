// Unregistered schema proposal only; no trusted catalog command/Auth claim.
// Actual disposable PostgreSQL and official provider DDL, synthetic admin fixtures.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseServiceDefinition} from '../../src/commercial/service-catalog.ts';
const sql=await readFile(new URL('../../planning/proposals/service-catalog-storage.sql',import.meta.url),'utf8');
const provenance=JSON.parse(await readFile(new URL('../../planning/proposals/service-catalog-storage.json',import.meta.url),'utf8'));
let sandbox,target,client,web,login,bootstrap,prior,source,installed=false,a,b;
const scalar=async(query,values=[])=> (await client.query(query,values)).rows[0].value;
const definition=(patch={})=>({name:'Synthetic interior',inclusions:'Vacuum.\nApplicable leather care.',exclusions:'Exterior protection excluded; no odor guarantee.',internalGuidance:'Internal synthetic guidance',rangeLowCents:'10000',rangeHighCents:'15000',estimatedSeconds:'5430',...patch});
async function transaction(run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}}
async function state(){
 const actor=await scalar("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic catalog owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id AS value",[randomUUID(),bootstrap]);
 return transaction(async()=>{const business=await scalar("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic catalog business','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await scalar("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return{business,actor,epoch};});
}
async function claim(f,type='catalog.service.save'){
 const operation=randomUUID();await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,$6,$3,'manual')",[f.business,operation,f.actor,type,f.epoch,'a'.repeat(64)]);return operation;
}
async function finish(f,operation){await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[f.business,operation,{schemaVersion:1,fixture:true}]);}
async function audit(f,operation,kind,id,version,action,beforeRow,afterRow){
 return scalar("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,'manual') RETURNING id AS value",[f.business,operation,f.actor,kind,id,version,action,{schemaVersion:1,before:beforeRow,after:afterRow}]);
}
const service=(f,id)=>scalar('SELECT crest_private.service_projection(s) AS value FROM crest.services s WHERE business_id=$1 AND id=$2',[f.business,id]);
const content=(f,id)=>scalar('SELECT crest_private.service_version_projection(v) AS value FROM crest.service_versions v WHERE business_id=$1 AND id=$2',[f.business,id]);
async function insertContent(f,operation,id,serviceId,sequence,d){
 await client.query("INSERT INTO crest.service_versions(id,business_id,service_id,sequence,name,inclusions,exclusions,internal_guidance,range_low_cents,range_high_cents,estimated_seconds,created_by,origin,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',$13)",[id,f.business,serviceId,sequence,d.name,d.inclusions,d.exclusions,d.internalGuidance,d.rangeLowCents,d.rangeHighCents,d.estimatedSeconds,f.actor,operation]);return content(f,id);
}
// Fixture writers are deliberately admin-only. They neither authenticate a
// request nor prove canonical payload/receipt/idempotency behavior.
async function create(f,{d=definition(),code='sample-'+randomUUID(),missing=null,type='catalog.service.save'}={}){
 return transaction(async()=>{const id=randomUUID(),versionId=randomUUID(),operation=await claim(f,type);
  await client.query("INSERT INTO crest.services(id,business_id,code,current_version_id,active,created_by,updated_by,origin,operation_id) VALUES($1,$2,$3,$4,true,$5,$5,'manual',$6)",[id,f.business,code,versionId,f.actor,operation]);
  const v=await insertContent(f,operation,versionId,id,'1',d),s=await service(f,id);
  if(missing!=='service')await audit(f,operation,'services',id,'1','create',null,s);
  if(missing!=='content')await audit(f,operation,'service_versions',versionId,'1','append',null,v);
  await finish(f,operation);return{id,versionId,operation,s,v};
 });
}
async function revise(f,id,{d,active,missing=null}={}){
 return transaction(async()=>{const old=await service(f,id),operation=await claim(f);let v=null,versionId=old.current_version_id;
  if(d){versionId=randomUUID();const sequence=await scalar('SELECT (sequence+1)::text AS value FROM crest.service_versions WHERE id=$1',[old.current_version_id]);v=await insertContent(f,operation,versionId,id,sequence,d);}
  await client.query('UPDATE crest.services SET current_version_id=$3,active=$4,version=version+1,updated_by=$5,operation_id=$6 WHERE business_id=$1 AND id=$2',[f.business,id,versionId,active??old.active,f.actor,operation]);
  const next=await service(f,id),action=d?'edit':next.active?'reopen':'archive';
  if(missing!=='service')await audit(f,operation,'services',id,next.version,action,old,next);
  if(v&&missing!=='content')await audit(f,operation,'service_versions',versionId,'1','append',null,v);
  await finish(f,operation);return{old,next,v};
 });
}
async function evidence(f){return(await client.query("SELECT jsonb_build_object('services',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM crest.services s WHERE business_id=$1),'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.service_versions v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM crest_private.operations o WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM crest_private.audit_events a WHERE business_id=$1)) AS value",[f.business])).rows[0].value;}
async function refused(run,pattern){const before=await evidence(a);await assert.rejects(run,pattern);assert.deepEqual(await evidence(a),before);}
async function sourceDefinitions(){return(await client.query("SELECT p.oid::text,pg_get_functiondef(p.oid) AS definition,p.proowner::text,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY p.oid")).rows;}
async function guard(setup,error){
 await client.query('BEGIN');try{await setup();await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message===error);}finally{await client.query('ROLLBACK');}
 assert.equal(await scalar("SELECT to_regclass('crest.services')::text AS value"),null);
 assert.equal(await scalar("SELECT count(*)::int AS value FROM pg_roles WHERE rolname='crest_catalog_integrity_owner'"),0);
 assert.deepEqual(await sourceDefinitions(),source);
}
before(async()=>{
 assert.equal(provenance.registered,false);assert.equal(provenance.runtimeEnabled,false);assert.equal(provenance.existingMigrationCount,43);
 assert.equal(Buffer.byteLength(sql),provenance.sqlBytes);assert.equal(createHash('sha256').update(sql).digest('hex'),provenance.sqlSha256);
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=(await sandbox.apply(target,await sandbox.prefix(43))).history;
 source=await sourceDefinitions();bootstrap=await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('proposal rejects an existing unsafe integrity login atomically',()=>guard(()=>client.query('CREATE ROLE crest_catalog_integrity_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'),'CREST_CATALOG_ROLE_REVIEW_REQUIRED'));
test('proposal rejects schema-owner PUBLIC execute including implicit default ACL absence',()=>guard(async()=>{
 await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
 assert.equal(await scalar("SELECT count(*)::int AS value FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'"),0);
},'CREST_CATALOG_SOURCE_REVIEW_REQUIRED'));
for(const table of ['operations','audit_events'])test('proposal rejects missing forced RLS on '+table,()=>guard(()=>client.query('ALTER TABLE crest_private.'+table+' NO FORCE ROW LEVEL SECURITY'),'CREST_CATALOG_SOURCE_REVIEW_REQUIRED'));
test('proposal rejects schema-owner login authority',()=>guard(()=>client.query('ALTER ROLE crest_schema_owner LOGIN'),'CREST_CATALOG_SOURCE_REVIEW_REQUIRED'));
test('proposal installs only closed schema and preserves all43 migration entries and prior functions',async()=>{
 await transaction(()=>client.query(sql));installed=true;
 const following=(await sandbox.apply(target,await sandbox.prefix(43))).history;assert.deepEqual(following,prior);
 const current=await sourceDefinitions();for(const entry of source)assert.deepEqual(current.find(row=>row.oid===entry.oid),entry);
 assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.services'),0);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.service_versions'),0);
 login='crest_catalog_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web,crest_export,crest_worker TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());
},{timeout:240000});
test('two tables use forced RLS and closed runtime table/type/function access',async()=>{
 assert(installed);for(const table of ['services','service_versions']){
  assert.equal(await scalar("SELECT relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole AS value FROM pg_class WHERE oid=$1::regclass",['crest.'+table]),true);
  for(const role of ['crest_web','crest_export','crest_worker']){
   await web.query('SET ROLE '+role);for(const query of ['SELECT * FROM crest.'+table,'DELETE FROM crest.'+table,'TRUNCATE crest.'+table])await assert.rejects(web.query(query),e=>e.code==='42501');await web.query('RESET ROLE');
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS value',[role,'crest.'+table,privilege]),false);
  }
 }
 assert.equal(await scalar("SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL AS value FROM pg_roles WHERE rolname='crest_catalog_integrity_owner'"),false);
 await assert.rejects(web.query('SET ROLE crest_catalog_integrity_owner'),e=>e.code==='42501');
 for(const signature of provenance.functions)for(const role of ['crest_web','crest_export','crest_worker'])assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) AS value',[role,signature,'EXECUTE']),false);
});
test('atomic root/content publication retains exact typed audit images and customer definition',async()=>{
 const row=await create(a),d=await scalar('SELECT crest_private.service_definition(v) AS value FROM crest.service_versions v WHERE id=$1',[row.versionId]);
 assert.deepEqual(parseServiceDefinition(d),definition());assert.equal(row.s.version,'1');assert.equal(row.v.sequence,'1');assert.equal(row.v.estimated_seconds,'5430');
 const events=(await client.query('SELECT entity_kind,delta FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 ORDER BY entity_kind',[a.business,row.operation])).rows;
 assert.equal(events.length,2);assert.deepEqual(events.find(e=>e.entity_kind==='services').delta,{schemaVersion:1,before:null,after:row.s});assert.deepEqual(events.find(e=>e.entity_kind==='service_versions').delta,{schemaVersion:1,before:null,after:row.v});
});
test('scope changes append while archive/reopen preserves old content and avoids extra scope versions',async()=>{
 const row=await create(a),second=await revise(a,row.id,{d:definition({inclusions:'Revised synthetic work',rangeLowCents:'20000',rangeHighCents:null})});
 assert.equal(second.next.version,'2');assert.equal(second.v.sequence,'2');assert.deepEqual(await content(a,row.versionId),row.v);
 await revise(a,row.id,{active:false});await revise(a,row.id,{active:true});const final=await service(a,row.id);
 assert.equal(final.version,'4');assert.equal(final.current_version_id,second.v.id);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.service_versions WHERE service_id=$1',[row.id]),2);
});
test('multiple content publications in one transaction retain every deferred audit image',async()=>{
 const row=await create(a);await transaction(async()=>{
  for(const label of ['Second','Third']){const old=await service(a,row.id),op=await claim(a),id=randomUUID(),seq=await scalar('SELECT (sequence+1)::text AS value FROM crest.service_versions WHERE id=$1',[old.current_version_id]),v=await insertContent(a,op,id,row.id,seq,definition({name:label}));await client.query('UPDATE crest.services SET current_version_id=$2,version=version+1,operation_id=$3 WHERE id=$1',[row.id,id,op]);const next=await service(a,row.id);await audit(a,op,'services',row.id,next.version,'edit',old,next);await audit(a,op,'service_versions',id,'1','append',null,v);await finish(a,op);}
 });assert.equal((await service(a,row.id)).version,'3');
});
for(const missing of ['service','content'])test('missing '+missing+' audit rolls back root, content and original claim',()=>refused(()=>create(a,{missing}),e=>e.code==='23514'));
test('a CRM operation cannot impersonate a catalog operation',()=>refused(()=>create(a,{type:'crm.customer.save'}),e=>e.code==='23514'));
test('same-business service codes are unique but separate businesses may use the same code',async()=>{
 const code='shared-synthetic-'+randomUUID();await create(a,{code});await refused(()=>create(a,{code}),e=>e.code==='23505');await create(b,{code});
});
for(const patch of [{name:''},{inclusions:'\u00a0'},{internalGuidance:' '},{rangeHighCents:'9999'},{rangeLowCents:null},{rangeLowCents:'-1'},{estimatedSeconds:'0'},{estimatedSeconds:'1.5'}])test('invalid stored service definition is refused: '+JSON.stringify(patch),()=>refused(()=>create(a,{d:definition(patch)}),e=>['23514','22P02'].includes(e.code)));
test('stored integer strings preserve bigint maxima and optional absence exactly',async()=>{
 const d=definition({rangeLowCents:'9007199254740993',rangeHighCents:'9223372036854775807',estimatedSeconds:'9223372036854775807'}),row=await create(a,{d});assert.deepEqual(await scalar('SELECT crest_private.service_definition(v) AS value FROM crest.service_versions v WHERE id=$1',[row.versionId]),d);
 const empty=await create(a,{d:definition({rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null,internalGuidance:null})});assert.equal(empty.v.range_low_cents,null);assert.equal(empty.v.estimated_seconds,null);
});
test('append-only content refuses updates, deletion and complete-group truncation',async()=>{
 const row=await create(a);for(const query of ["UPDATE crest.service_versions SET name='Forged' WHERE id=$1",'DELETE FROM crest.service_versions WHERE id=$1'])await refused(()=>client.query(query,[row.versionId]),e=>e.code==='55000');
 await refused(()=>client.query('DELETE FROM crest.services WHERE id=$1',[row.id]),e=>e.code==='55000');await refused(()=>client.query('TRUNCATE crest.services,crest.service_versions'),e=>e.code==='55000');
});
test('stable directory provenance and code cannot be rewritten',async()=>{
 const row=await create(a);for(const query of ["UPDATE crest.services SET code='changed',version=version+1 WHERE id=$1","UPDATE crest.services SET created_at=created_at-interval '1 day',version=version+1 WHERE id=$1"])await refused(()=>client.query(query,[row.id]),e=>e.code==='55000');
});
test('reusing an earlier content version or manufacturing an unchanged revision is refused',async()=>{
 const row=await create(a);await revise(a,row.id,{d:definition({name:'Second'})});await refused(()=>transaction(async()=>{const op=await claim(a);await client.query('UPDATE crest.services SET current_version_id=$2,version=version+1,operation_id=$3 WHERE id=$1',[row.id,row.versionId,op]);}),e=>e.code==='23514');
 await refused(()=>revise(a,row.id),e=>e.code==='23514');
});
test('orphan append and forged future audit cannot publish content without updating its service',async()=>{
 const row=await create(a);await refused(()=>transaction(async()=>{const old=await service(a,row.id),op=await claim(a),id=randomUUID(),v=await insertContent(a,op,id,row.id,'2',definition({name:'Orphan'}));await audit(a,op,'service_versions',id,'1','append',null,v);await audit(a,op,'services',row.id,'2','edit',old,{...old,current_version_id:id,version:'2',operation_id:op});await finish(a,op);}),e=>e.code==='23514');
});
test('foreign-business parent and current-version attachment cannot cross tenant/service boundaries',async()=>{
 const row=await create(a),foreign=await create(b);await refused(()=>transaction(async()=>{const op=await claim(a);await insertContent(a,op,randomUUID(),foreign.id,'2',definition());}),e=>e.code==='23503');
 await refused(()=>transaction(async()=>{const op=await claim(a);await client.query('UPDATE crest.services SET current_version_id=$2,version=version+1,operation_id=$3 WHERE id=$1',[row.id,foreign.versionId,op]);}),e=>e.code==='23514');
});
test('missing content cannot commit a partially published service',()=>refused(()=>transaction(async()=>{const op=await claim(a),id=randomUUID();await client.query("INSERT INTO crest.services(id,business_id,code,current_version_id,active,created_by,updated_by,origin,operation_id) VALUES($1,$2,$3,$4,true,$5,$5,'manual',$6)",[id,a.business,'missing-'+id,randomUUID(),a.actor,op]);const root=await service(a,id);await audit(a,op,'services',id,'1','create',null,root);await finish(a,op);}),e=>['23503','23514'].includes(e.code)));
