// Actual PostgreSQL construction proof. Administrative fixture writes below are
// not trusted owner commands, genuine MFA, mode activation or confirmed bookings.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
// Explicit construction over immutable49, even when the repository registers later schemas.
import {backupLegacy49Database as backupDatabase,restoreLegacy49Database as restoreDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,normalizedSchema,postgresTool} from '../support/recovery-drill.mjs';
import {fulfillmentModeColumns,parseFulfillmentModeVersion} from '../../src/operations/fulfillment-mode-contract.ts';
const sql=await readFile(new URL('../../planning/proposals/fulfillment-mode-storage.sql',import.meta.url),'utf8');
const commandSql=await readFile(new URL('../../planning/proposals/fulfillment-mode-commands.sql',import.meta.url),'utf8');
let sandbox,target,client,a,b,c,d,e,first,revised,login,web,cluster,restored,initialized,changed,initializeRequest,changeRequest;
const value=async(connection,query,args=[])=>(await connection.query(query,args)).rows[0]?.value;
async function transaction(connection,work){await connection.query('BEGIN');try{const result=await work();await connection.query('COMMIT');return result;}catch(error){await connection.query('ROLLBACK');throw error;}}
async function fixture(){
 const bootstrap=await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");
 const actor=await value(client,"INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic mode owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id AS value",[randomUUID(),bootstrap]);
 return transaction(client,async()=>{const business=await value(client,"INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic mode business','America/Indiana/Indianapolis',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await value(client,"INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return {actor,business,epoch};});
}
const initial=f=>({id:randomUUID(),business_id:f.business,sequence:'1',replaces_sequence:null,mobile_enabled:true,dropoff_enabled:true,pickup_return_enabled:false,reason:null});
const columns=['id','business_id','sequence','replaces_sequence','mobile_enabled','dropoff_enabled','pickup_return_enabled','reason','created_by','operation_id'];
const projection=(connection,id)=>value(connection,'SELECT crest_private.fulfillment_mode_projection(v) AS value FROM crest.fulfillment_mode_versions v WHERE id=$1',[id]);
async function write(connection,f,body,{missingAudit=false,type=body.sequence==='1'?'operations.fulfillment_modes.initialize':'operations.fulfillment_modes.save',deltaPatch={}}={}){
 const operation=randomUUID();await connection.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,$6,$3,'manual')",[f.business,operation,f.actor,type,f.epoch,'a'.repeat(64)]);
 const input={...body,created_by:f.actor,operation_id:operation};await connection.query('INSERT INTO crest.fulfillment_mode_versions('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(k=>input[k]));
 const next=await projection(connection,body.id),prior=body.replaces_sequence===null?null:await value(connection,'SELECT crest_private.fulfillment_mode_projection(v) AS value FROM crest.fulfillment_mode_versions v WHERE business_id=$1 AND sequence=$2',[body.business_id,body.replaces_sequence]);
 if(!missingAudit)await connection.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,'fulfillment_modes',$1,$4,$5,$6,'manual')",[f.business,operation,f.actor,body.sequence,body.sequence==='1'?'initialize':'revise',{schemaVersion:1,before:prior,after:next,...deltaPatch}]);
 await connection.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[f.business,operation,{schemaVersion:1,fixture:true}]);return next;
}
const append=(f,body,options)=>transaction(client,()=>write(client,f,body,options));
async function authenticatedFixture(){
 const f=await fixture(),subject=await value(client,'SELECT auth_user_id AS value FROM crest_private.actors WHERE id=$1',[f.actor]);
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-mode-'+subject+'@example.com']);
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,auth:[hash,session,f.actor,'https://auth.example.com/auth/v1',subject,provider,new Date(Date.now()+300000),f.business]};
}
const request=(sequence='0',payload={mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:false,reason:null})=>({sequence,payload,operation:randomUUID()});
const command=(f,r)=>value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',[...f.auth,f.epoch,r.operation,r.sequence,r.payload]);
const lookup=(f,r)=>value(web,'SELECT crest_commands.lookup_fulfillment_mode_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...f.auth,r.operation]);
const history=(f,after='0',limit=20)=>value(web,'SELECT crest_commands.read_fulfillment_mode_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[...f.auth,after,limit]);
async function evidence(){const facts=[];for(const table of ['crest.fulfillment_mode_versions','crest_private.operations','crest_private.audit_events'])facts.push((await client.query('SELECT row_to_json(v)::text AS value FROM '+table+' v ORDER BY row_to_json(v)::text COLLATE "C"')).rows);return facts;}
async function refused(work,pattern){const prior=await evidence();await assert.rejects(work,pattern);assert.deepEqual(await evidence(),prior);}
before(async()=>{sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));a=await fixture();b=await fixture();c=await fixture();},{timeout:240000});
after(async()=>{await restored?.end();await cluster?.close();await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('storage preflight refuses unsafe future grants before creating any role or table',async()=>{
 await client.query('BEGIN');await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT SELECT ON TABLES TO PUBLIC');await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_MODE_SOURCE_REVIEW_REQUIRED');await client.query('ROLLBACK');assert.equal(await value(client,"SELECT to_regclass('crest.fulfillment_mode_versions') AS value"),null);assert.equal(await value(client,"SELECT count(*)::int AS value FROM pg_roles WHERE rolname='crest_mode_integrity_owner'"),0);
});
test('new storage leaves registered functions unchanged and has exact typed source columns, closed ownership and forced RLS',async()=>{
 const definitions=(await client.query("SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace IN('crest_private'::regnamespace,'crest_commands'::regnamespace) ORDER BY oid")).rows;
 await transaction(client,()=>client.query(sql));await sandbox.apply(target,await sandbox.prefix(49));
 for(const item of definitions)assert.equal(await value(client,'SELECT pg_get_functiondef($1::oid) AS value',[item.oid]),item.definition);
 assert.equal(await value(client,"SELECT relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole AS value FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass"),true);
 assert.deepEqual((await client.query("SELECT attname AS name FROM pg_attribute WHERE attrelid='crest.fulfillment_mode_versions'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(row=>row.name),[...fulfillmentModeColumns]);
 assert.equal(await value(client,"SELECT count(*)::int AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private') AND c.relkind='r'"),57);
});
test('ordinary web, worker and export logins cannot inspect, write or invoke private mode routines',async()=>{
 login='crest_mode_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web,crest_worker,crest_export TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());
 for(const role of ['crest_web','crest_worker','crest_export']){await web.query('SET ROLE '+role);for(const query of ['SELECT * FROM crest.fulfillment_mode_versions','DELETE FROM crest.fulfillment_mode_versions','TRUNCATE crest.fulfillment_mode_versions','SELECT crest_private.fulfillment_mode_projection(NULL::crest.fulfillment_mode_versions)'])await assert.rejects(web.query(query),e=>e.code==='42501');await web.query('RESET ROLE');}await assert.rejects(web.query('SET ROLE crest_mode_integrity_owner'),e=>e.code==='42501');
});
test('canonical initial policy and explicit later pickup enablement preserve both complete versions',async()=>{
 first=await append(a,initial(a));revised=await append(a,{...first,id:randomUUID(),sequence:'2',replaces_sequence:'1',pickup_return_enabled:true,reason:'Synthetic owner enabled pickup and return'});
 assert.equal(parseFulfillmentModeVersion(first,a.business).pickup_return_enabled,false);assert.equal(parseFulfillmentModeVersion(revised,a.business).pickup_return_enabled,true);assert.deepEqual(await projection(client,first.id),first);
});
test('bad defaults, cross-business parents, skipped revisions and reason-only revisions roll back with no operations or audits left behind',async()=>{
 for(const patch of [{pickup_return_enabled:true},{mobile_enabled:false},{dropoff_enabled:false},{reason:'Override initial policy'}])await refused(()=>append(b,{...initial(b),...patch}),e=>e.code==='23514');
 await refused(()=>append(a,{...initial(b)}),e=>e.code==='23503');
 await refused(()=>append(a,{...revised,id:randomUUID(),sequence:'4',replaces_sequence:'3',pickup_return_enabled:false,reason:'Skipped source'}),e=>e.code==='23514');
 await refused(()=>append(a,{...revised,id:randomUUID(),sequence:'3',replaces_sequence:'2',reason:'Only a different reason'}),e=>e.code==='23514'&&e.message==='CREST_MODE_SEQUENCE_REVIEW_REQUIRED');
});
test('missing or substituted before/after audit and wrong source command cannot commit a mode revision',async()=>{
 const next=()=>({...revised,id:randomUUID(),sequence:'3',replaces_sequence:'2',pickup_return_enabled:false,reason:'Synthetic owner disabled pickup'});
 // The existing operation-completion constraint rejects missing audit first.
 await refused(()=>append(a,next(),{missingAudit:true}),e=>e.code==='23514'&&e.message==='CREST_OPERATION_COMPLETION_REQUIRED');
 for(const options of [{deltaPatch:{before:null}},{deltaPatch:{after:{}}},{type:'crm.customer.save'}])await refused(()=>append(a,next(),options),e=>e.code==='23514'&&e.message==='CREST_MODE_AUDIT_REQUIRED');
 await refused(()=>append(a,next(),{deltaPatch:{extra:true}}),e=>e.code==='23514'&&e.constraint==='audit_events_delta_check');
});
test('even administrative update, delete and truncate cannot silently rewrite retained mode history',async()=>{
 for(const query of ["UPDATE crest.fulfillment_mode_versions SET pickup_return_enabled=false WHERE business_id='"+a.business+"'",'DELETE FROM crest.fulfillment_mode_versions','TRUNCATE crest.fulfillment_mode_versions'])await refused(()=>client.query(query),e=>e.code==='55000'&&e.message==='CREST_MODE_HISTORY_RETAINED');
});
test('parallel revisions block on the same business lock and cannot fork the retained sequence',async()=>{
 await append(c,initial(c));const one=await sandbox.connect(target),two=await sandbox.connect(target);await one.query('SET statement_timeout=15000');await two.query('SET statement_timeout=15000');
 try{
  await one.query('BEGIN');await write(one,c,{...initial(c),sequence:'2',replaces_sequence:'1',mobile_enabled:false,reason:'First owner change'});
  await two.query('BEGIN');let rejected;const pending=write(two,c,{...initial(c),sequence:'2',replaces_sequence:'1',pickup_return_enabled:true,reason:'Concurrent owner change'}).then(()=>({committed:true}),error=>({code:error.code}));
  let blocked=false;for(let attempt=0;attempt<80&&!blocked;attempt++){blocked=await value(client,'SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS value',[two.processID,one.processID]);if(!blocked)await delay(20);}assert.equal(blocked,true);
  await one.query('COMMIT');rejected=await pending;await two.query('ROLLBACK');assert.deepEqual(rejected,{code:'23514'});assert.deepEqual((await client.query('SELECT sequence::text,pickup_return_enabled FROM crest.fulfillment_mode_versions WHERE business_id=$1 ORDER BY sequence',[c.business])).rows,[{sequence:'1',pickup_return_enabled:false},{sequence:'2',pickup_return_enabled:false}]);
 }finally{await one.query('ROLLBACK').catch(()=>{});await two.query('ROLLBACK').catch(()=>{});}
});
test('trusted command installation preserves registered routines and exposes only authenticated settings entry points',async()=>{
 const definitions=(await client.query("SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace IN('crest_private'::regnamespace,'crest_commands'::regnamespace) ORDER BY oid")).rows;
 await transaction(client,()=>client.query(commandSql));await sandbox.apply(target,await sandbox.prefix(49));
 for(const item of definitions)assert.equal(await value(client,'SELECT pg_get_functiondef($1::oid) AS value',[item.oid]),item.definition);
 d=await authenticatedFixture();e=await authenticatedFixture();await web.query('SET ROLE crest_web');
 for(const query of ['SELECT * FROM crest.fulfillment_mode_versions','SELECT crest_private.valid_fulfillment_mode_payload(NULL)','SELECT crest_private.fulfillment_mode_operation_result(NULL,NULL,NULL)'])await assert.rejects(web.query(query),error=>error.code==='42501');
 assert.deepEqual(await history(d),{state:'absent'});
});

test('authenticated initialization, explicit pickup enablement and original replay retain exactly one row per operation',async()=>{
 initializeRequest=request();initialized=await command(d,initializeRequest);assert.equal(initialized.state,'committed');assert.equal(initialized.receipt.sequence,'1');
 const beforeReplay=await evidence();assert.deepEqual(await command(d,initializeRequest),initialized);assert.deepEqual(await evidence(),beforeReplay);
 changeRequest=request('1',{...initializeRequest.payload,pickupReturnEnabled:true,reason:'Synthetic owner explicitly enabled pickup and return'});changed=await command(d,changeRequest);assert.equal(changed.state,'committed');assert.equal(changed.receipt.sequence,'2');
 assert.deepEqual(await lookup(d,initializeRequest),initialized);assert.deepEqual(await lookup(d,changeRequest),changed);
 const page=await history(d,'0',1);assert.equal(page.currentSequence,'2');assert.equal(page.hasMore,true);assert.equal(page.versions.length,1);assert.equal(parseFulfillmentModeVersion(page.versions[0],d.business).pickup_return_enabled,false);
 const second=await history(d,'1',1);assert.equal(second.hasMore,false);assert.equal(parseFulfillmentModeVersion(second.versions[0],d.business).pickup_return_enabled,true);
 assert.deepEqual((await history(e)),{state:'absent'});assert.deepEqual(await lookup(e,initializeRequest),{state:'absent'});
});

test('conflicting original identity, stale version and reason-only changes leave all domain and operation history unchanged',async()=>{
 const before=await evidence();assert.deepEqual(await command(d,{...changeRequest,payload:{...changeRequest.payload,reason:'Different original content'}}),{state:'conflict',reason:'operation'});
 assert.deepEqual(await command(d,request('1',{...changeRequest.payload,pickupReturnEnabled:false})),{state:'conflict',reason:'version',currentSequence:'2'});
 assert.deepEqual(await command(d,request('2',{...changeRequest.payload,reason:'No actual flag changed'})),{state:'conflict',reason:'review'});assert.deepEqual(await evidence(),before);
});

test('trusted commands reject malformed boolean/default/reason input without coercion or partial initialization',async()=>{
 for(const payload of [{...initializeRequest.payload,pickupReturnEnabled:true},{...initializeRequest.payload,mobileEnabled:false},{...initializeRequest.payload,extra:true},{...initializeRequest.payload,mobileEnabled:'true'},{...initializeRequest.payload,dropoffEnabled:null},{...initializeRequest.payload,reason:'Override defaults'}])await refused(()=>command(e,request('0',payload)),error=>error.code==='22023');
 await refused(()=>command(d,request('2',{...initializeRequest.payload,pickupReturnEnabled:false})),error=>error.code==='22023');
});

test('forged context and paused recovery cannot change settings; original lookup remains usable during recovery review',async()=>{
 for(const f of [{...d,auth:d.auth.map((v,i)=>i===7?e.business:v)},{...d,auth:d.auth.map((v,i)=>i===2?e.actor:v)},{...d,auth:d.auth.map((v,i)=>i===0?randomBytes(32):v)}])await refused(()=>command(f,request('2',{...initializeRequest.payload,reason:'Forbidden change'})),error=>error.code==='42501');
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[d.business]);
 try{await refused(()=>command(d,request('2',{...initializeRequest.payload,reason:'Blocked during recovery'})),/RECOVERY_REVIEW_REQUIRED/);assert.deepEqual(await lookup(d,changeRequest),changed);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[d.business]);}
});

test('candidate storage and original operation/audit history restore on a separate cluster without claiming a registered later schema',async()=>{
 const directory=await privateWorkspace(),point=join(directory,'point');const {mkdir}=await import('node:fs/promises');await mkdir(point,{mode:0o700});const keys=await keyPair(directory),backup=await backupDatabase(client,target,point,keys.recipient);assert.equal(backup.manifest.schemaVersion,49);assert.equal(backup.manifest.completeBackup,false);
 cluster=await recoveryCluster();const destination=await cluster.database();
 try{await restoreDatabase(point,keys.path,destination);}catch(error){
  // Structural diagnostic only, kept inside the synthetic private workspace.
  await writeFile(join(directory,'source-schema.sql'),normalizedSchema(await postgresTool('pg_dump',target,['--schema-only'])),{mode:0o600});
  await writeFile(join(directory,'restored-schema.sql'),normalizedSchema(await postgresTool('pg_dump',destination,['--schema-only'])),{mode:0o600});
  console.log('MODE_RESTORE_SCHEMA_DIAGNOSTIC '+directory);throw error;
 }
 restored=await connect(destination);
 assert.deepEqual(await inventory(restored),backup.manifest.rows);assert.deepEqual(await projection(restored,first.id),first);assert.deepEqual(await projection(restored,revised.id),revised);
 await assert.rejects(restored.query('DELETE FROM crest.fulfillment_mode_versions'),e=>e.code==='55000');assert.equal(await value(restored,"SELECT to_regclass('crest.jobs') AS value"),null);
});
