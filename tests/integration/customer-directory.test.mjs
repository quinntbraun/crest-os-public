// Actual PostgreSQL/Auth DDL and restricted roles, never mocked database rows.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {formatCustomerCsv} from '../../src/customer/customer-csv.ts';
import {decodeCustomerCsv} from '../support/customer-fixture.ts';
let sandbox,client,target,web,web2,exporter,login,loginOwned=false,bootstrap,a,b,prior,receipt,customerReceipt,beforeUpgrade,guardRefused=false,upgradeCustomer,upgradeEvidence;
const issuer='https://auth.example.com/auth/v1';
const body=(patch={})=>({displayName:'Synthetic customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null,...patch});
const request=(patch={})=>({operation:randomUUID(),customer:randomUUID(),version:'0',schema:1,body:body(),...patch});
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const command=(f,r=request(),c=web)=>c.query('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result',[...auth(f),f.epoch,r.operation,r.schema,r.customer,r.version,r.body]).then(r=>r.rows[0].result);
const directory=(f,{search='',after=null,archived=false,size=50,c=web}={})=>c.query('SELECT crest_commands.read_customer_directory($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[...auth(f),search,after,archived,size]).then(r=>r.rows[0].result);
const history=(f,id,{after='0',size=20,c=web}={})=>c.query('SELECT crest_commands.read_customer_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',[...auth(f),id,after,size]).then(r=>r.rows[0].result);
const lookup=(f,id,c=web)=>c.query('SELECT crest_commands.lookup_customer_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[...auth(f),id]).then(r=>r.rows[0].result);
async function rows(f){return (await client.query('SELECT crest_private.customer_projection(c) AS value FROM crest.customers c WHERE business_id=$1 ORDER BY id',[f.business])).rows.map(r=>r.value);}
async function evidence(f){return {customers:await rows(f),operations:(await client.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o WHERE business_id=$1 ORDER BY id',[f.business])).rows,audit:(await client.query('SELECT to_jsonb(a) AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY id',[f.business])).rows};}
async function extraSession(f){
  const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
  await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
  return {...f,provider,session,hash};
}
async function state(){
  const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic CRM owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
  await client.query('BEGIN');let business,epoch;
  try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic CRM business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
    epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);return extraSession({business,epoch,subject,actor});
}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(31));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;a=await state();b=await state();beforeUpgrade=(await client.query('SELECT to_jsonb(b) AS value FROM crest.businesses b ORDER BY id')).rows;
  const guardTarget=await sandbox.database(),guardClient=await sandbox.connect(guardTarget);await sandbox.apply(guardTarget,await sandbox.prefix(0),true);await installProviderSchema(guardClient,guardTarget);await sandbox.apply(guardTarget,await sandbox.prefix(31));
  await client.query('CREATE ROLE crest_customer_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  try{await assert.rejects(sandbox.apply(guardTarget),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await guardClient.query("SELECT to_regclass('crest.customers') AS value")).rows[0].value,null);await assert.rejects(sandbox.apply(guardTarget),/MIGRATION_PENDING_REVIEW_REQUIRED/);guardRefused=true;}finally{await client.query('ALTER ROLE crest_customer_owner NOLOGIN');}
  // Keep the failed target's pending evidence. The positive upgrade uses the
  // original distinct database/ledger after explicit synthetic role repair.
  customerReceipt=await sandbox.apply(target,await sandbox.prefix(32));
  login=`crest_crm_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_web,crest_export TO ${login}`);
  const u=new URL(target);u.username=login;u.password=password;
  web=await sandbox.connect(u.toString());web2=await sandbox.connect(u.toString());exporter=await sandbox.connect(u.toString());for(const c of [web,web2])await c.query("SET ROLE crest_web; SET lock_timeout='3s'");await exporter.query('SET ROLE crest_export');
  upgradeCustomer=request({body:body({displayName:'Synthetic schema32 customer',archived:true,archiveReason:'Retained\r\nreason',notes:'Unchanged\r\nnotes'})});await command(a,upgradeCustomer);upgradeEvidence=await evidence(a);receipt=await sandbox.apply(target);
},{timeout:180000});
after(async()=>{await web?.end();await web2?.end();await exporter?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
test('schema31 through32 and33 preserves original migration receipts, source audit and business rows',async()=>{
  assert.equal(prior.history.length,31);assert.equal(customerReceipt.history.length,32);assert.deepEqual(customerReceipt.history.slice(0,31),prior.history);assert.equal(receipt.history.length,33);assert.deepEqual(receipt.history.slice(0,32),customerReceipt.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);assert.deepEqual((await client.query('SELECT to_jsonb(b) AS value FROM crest.businesses b ORDER BY id')).rows,beforeUpgrade);assert.deepEqual(await evidence(a),upgradeEvidence);
});
test('migration refuses an existing login role before creating customer storage',()=>{assert.equal(guardRefused,true);});

// Captured PostgreSQL17 canonical forms from the failed isolated restore.
const normalizedCustomerChecks=[{"name":"customers_display_name_check","definition":"CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200) AND (btrim(display_name) <> ''::text) AND (display_name !~ '[[:cntrl:]]'::text)))"},{"name":"customers_archived_reason_check","definition":"CHECK (((archived_reason IS NULL) OR ((char_length(archived_reason) >= 1) AND (char_length(archived_reason) <= 1000) AND (btrim(archived_reason) <> ''::text) AND (translate(archived_reason, '\t\n\r'::text, ''::text) !~ '[[:cntrl:]]'::text))))"}];
for(const profile of ['restored','unexpected'])test('check repair accepts only known schema32 forms: '+profile,async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const before=await sandbox.apply(t,await sandbox.prefix(32));
  for(const item of normalizedCustomerChecks)await c.query('ALTER TABLE crest.customers DROP CONSTRAINT '+item.name+', ADD CONSTRAINT '+item.name+' '+item.definition);
  if(profile==='unexpected')await c.query('ALTER TABLE crest.customers DROP CONSTRAINT customers_display_name_check, ADD CONSTRAINT customers_display_name_check CHECK(char_length(display_name)>0)');
  const definitions=async()=>(await c.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='crest.customers'::regclass ORDER BY conname")).rows,original=await definitions();
  if(profile==='restored'){const result=await sandbox.apply(t);assert.equal(result.history.length,33);assert.deepEqual(result.history.slice(0,32),before.history);assert.deepEqual(await definitions(),original);}
  else{await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.deepEqual(await definitions(),original);await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);}
});

test('customer and integrity owners are closed; web has only typed commands, never raw customer/secret access',async()=>{
  for(const role of ['crest_customer_owner','crest_customer_integrity_owner']){const r=(await client.query('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL AS bad FROM pg_roles WHERE rolname=$1',[role])).rows[0];assert.equal(r.bad,false);await assert.rejects(web.query(`SET ROLE ${role}`),e=>e.code==='42501');assert.equal((await client.query("SELECT has_schema_privilege($1,'crest_commands','CREATE') AS yes",[role])).rows[0].yes,false);}
  assert.equal((await client.query("SELECT relrowsecurity AND relforcerowsecurity AS secure FROM pg_class WHERE oid='crest.customers'::regclass")).rows[0].secure,true);
  for(const sql of ['SELECT * FROM crest.customers','SELECT token_hash FROM crest_private.app_sessions',"DELETE FROM crest.customers","UPDATE crest.customers SET display_name='forged'",'TRUNCATE crest.customers'])await assert.rejects(web.query(sql),e=>e.code==='42501');
  for(const role of ['crest_web','crest_export','crest_customer_integrity_owner'])assert.equal((await client.query("SELECT has_any_column_privilege($1,'crest.customers','SELECT') AS yes",[role])).rows[0].yes,false);
});
test('label-only customer persists unknown details and complete source audit',async()=>{
  const r=request(),v=await command(a,r);assert.equal(v.state,'committed');assert.equal(v.receipt.customerId,r.customer);assert.equal(v.receipt.customerVersion,'1');const h=await history(a,r.customer);assert.equal(h.history.length,1);assert.equal(h.history[0].before,null);assert.deepEqual(h.history[0].after,h.customer);for(const k of ['phone_raw','phone_normalized','email_raw','email_normalized','customer_since','contact_preference','notes'])assert.equal(h.customer[k],null);
});
test('household contacts remain two customers and preserve raw values without inferred country or merge',async()=>{
  const f=await state(),raw={phone:'(317) 555-0100',email:' Household@Example.com '},r1=request({body:body(raw)}),r2=request({body:body({...raw,displayName:'Second household member'})});await command(f,r1);await command(f,r2);
  const list=await directory(f,{search:'3175550100'});assert.equal(list.customers.length,2);assert.notEqual(list.customers[0].id,list.customers[1].id);for(const c of list.customers){assert.equal(c.phone_raw,raw.phone);assert.equal(c.phone_normalized,'3175550100');assert.equal(c.email_raw,raw.email);assert.equal(c.email_normalized,'household@example.com');}
});
test('Unicode, formula-looking notes, empty text and explicit opt-out retain exact source values',async()=>{
  const r=request({body:body({displayName:'=SUM(1,2) é 😀',notes:'\\N\n=private evidence\t😀',contactPreference:'',customerSince:'2026-01-02',outreachOptOut:true})});await command(a,r);const h=await history(a,r.customer);assert.equal(h.customer.notes,r.body.notes);assert.equal(h.customer.contact_preference,'');assert.equal(h.customer.customer_since,'2026-01-02');assert.equal(h.customer.outreach_opt_out,true);assert.match(h.customer.created_at,/\.\d{6}Z$/);
});
test('identical lost-response retry returns the original receipt without a second customer or audit',async()=>{
  const f=await state(),r=request(),first=await command(f,r),before=await evidence(f);assert.deepEqual(await lookup(f,r.operation),first);assert.deepEqual(await command(f,r),first);assert.deepEqual(await evidence(f),before);
});
test('reused operation with a changed payload conflicts and new IDs cannot duplicate the same customer',async()=>{
  const f=await state(),r=request();await command(f,r);const before=await evidence(f);assert.deepEqual(await command(f,{...r,body:body({displayName:'changed'})}),{state:'conflict',reason:'operation'});assert.deepEqual(await command(f,{...r,operation:randomUUID()}),{state:'conflict',reason:'version',currentVersion:'1'});assert.deepEqual(await evidence(f),before);
});
test('optimistic updates retain before/after history and reject stale writes without a pending claim',async()=>{
  const f=await state(),r=request();await command(f,r);const edit=request({customer:r.customer,version:'1',body:body({displayName:'Edited customer',notes:'new notes'})});assert.equal((await command(f,edit)).receipt.customerVersion,'2');const before=await evidence(f);const stale=request({customer:r.customer,version:'1'});assert.deepEqual(await command(f,stale),{state:'conflict',reason:'version',currentVersion:'2'});assert.deepEqual(await lookup(f,stale.operation),{state:'absent'});assert.deepEqual(await evidence(f),before);const h=await history(f,r.customer);assert.equal(h.history[1].before.display_name,r.body.displayName);assert.equal(h.history[1].after.display_name,'Edited customer');
});
test('archive requires a reason, stays searchable when included, and reopening retains both transitions',async()=>{
  const f=await state(),r=request();await command(f,r);await assert.rejects(command(f,request({customer:r.customer,version:'1',body:body({archived:true})})),e=>e.code==='22023');
  await command(f,request({customer:r.customer,version:'1',body:body({archived:true,archiveReason:'Owner reviewed archive'})}));assert.equal((await directory(f)).customers.length,0);assert.equal((await directory(f,{archived:true})).customers.length,1);
  await command(f,request({customer:r.customer,version:'2'}));const first=await history(f,r.customer,{size:2}),last=await history(f,r.customer,{after:'2',size:2});assert.equal(first.hasMore,true);assert.deepEqual(last.history.map(e=>e.action),['reopen']);assert.equal(last.customer.archived_at,null);assert.equal(last.history[0].before.archived_reason,'Owner reviewed archive');
});
test('literal search and UUID pagination neither interpret SQL/wildcards nor include another business',async()=>{
  const f=await state();for(const name of ['Alpha%literal','Beta','Gamma'])await command(f,request({body:body({displayName:name})}));assert.equal((await directory(f,{search:'%'})).customers.length,1);assert.equal((await directory(f,{search:"' OR 1=1 --"})).customers.length,0);
  const first=await directory(f,{size:2}),next=await directory(f,{size:2,after:first.customers.at(-1).id});assert.equal(first.hasMore,true);assert.equal(next.hasMore,false);assert.equal(new Set([...first.customers,...next.customers].map(c=>c.id)).size,3);
});
test('guessed cross-business customer IDs cannot be read or changed and another business binding is denied',async()=>{
  const r=request();await command(b,r);const before=await evidence(b);assert.deepEqual(await history(a,r.customer),{state:'absent'});assert.equal((await command(a,request({customer:r.customer,version:'1'}))).state,'conflict');await assert.rejects(directory({...a,business:b.business}),e=>e.code==='42501');assert.deepEqual(await command({...a,business:b.business,epoch:b.epoch},request()),{state:'denied'});assert.deepEqual(await evidence(b),before);
});
test('missing CRM or identity-read capability denies reads and writes before a claim',async()=>{
  const f=await state(),before=await evidence(f);for(const capability of ['crm.manage','identity.read']){
    await client.query(`CREATE POLICY customer_capability_probe ON crest_private.role_capabilities AS RESTRICTIVE FOR SELECT TO crest_session_owner USING(capability<>'${capability}')`);
    try{await assert.rejects(directory(f),e=>e.code==='42501');assert.deepEqual(await command(f),{state:'denied'});}finally{await client.query('DROP POLICY customer_capability_probe ON crest_private.role_capabilities');}
  }assert.deepEqual(await evidence(f),before);
});
test('provider deletion, local revocation and actor security-epoch rotation deny matching replays',async()=>{
  for(const kind of ['provider','local','actor']){const f=await state(),r=request();await command(f,r);if(kind==='provider')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);else if(kind==='local')await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);else await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),f.actor]);const before=await evidence(f);assert.deepEqual(await command(f,r),{state:'denied'});await assert.rejects(directory(f),e=>e.code==='42501');assert.deepEqual(await evidence(f),before);}
});
test('paused writes and changed recovery epochs block replay while history and operation lookup remain readable',async()=>{
  const f=await state(),r=request(),saved=await command(f,r);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await assert.rejects(command(f,r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.equal((await history(f,r.customer)).customer.id,r.customer);assert.deepEqual(await lookup(f,r.operation),saved);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);await assert.rejects(command(f,r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');await assert.rejects(command(f,request()),e=>e.code==='P0001');assert.deepEqual(await lookup(f,r.operation),saved);
});
test('two independently authorized devices editing one version produce exactly one committed change',async()=>{
  const f=await state(),other=await extraSession(f),r=request();await command(f,r);const outcomes=await Promise.all([command(f,request({customer:r.customer,version:'1',body:body({displayName:'First device'})})),command(other,request({customer:r.customer,version:'1',body:body({displayName:'Second device'})}),web2)]);assert.deepEqual(outcomes.map(o=>o.state).sort(),['committed','conflict']);assert.equal((await history(f,r.customer)).history.length,2);
});
test('provider revocation while waiting for the customer row rolls back the source, audit and operation together',async()=>{
  const f=await state(),r=request();await command(f,r);const before=await evidence(f),pid=(await web.query('SELECT pg_backend_pid() AS value')).rows[0].value;
  await client.query('BEGIN');await client.query('SELECT id FROM crest.customers WHERE id=$1 FOR UPDATE',[r.customer]);const pending=command(f,request({customer:r.customer,version:'1'}));void pending.catch(()=>{});
  try{let waiting=false;for(let i=0;i<60;i++){if((await client.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0].waiting){waiting=true;break;}await delay(20);}assert(waiting);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);await client.query('COMMIT');await assert.rejects(pending,e=>e.code==='42501');assert.deepEqual(await evidence(f),before);}finally{await client.query('ROLLBACK');await pending.catch(()=>{});}
});
test('source/audit failures roll back pending claims instead of leaving partially saved customers',async()=>{
  const f=await state();await client.query("CREATE FUNCTION crest_private.customer_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$");
  try{for(const table of ['crest.customers','crest_private.audit_events']){const before=await evidence(f);await client.query(`CREATE TRIGGER customer_failure_probe BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION crest_private.customer_failure_probe()`);try{await assert.rejects(command(f),e=>e.code==='P0001');assert.deepEqual(await evidence(f),before);}finally{await client.query(`DROP TRIGGER customer_failure_probe ON ${table}`);}}}finally{await client.query('DROP FUNCTION crest_private.customer_failure_probe()');}
});
test('deferred customer audit rejects an internally hashed but incorrect after snapshot at commit',async()=>{
  const f=await state(),r=request();await command(f,r);const before=await evidence(f),old=before.customers[0],operation=randomUUID();await client.query('BEGIN');
  try{
    await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'crm.customer.save',1,$4,$5,$3,'manual')",[f.business,operation,f.actor,f.epoch,'a'.repeat(64)]);
    await client.query("UPDATE crest.customers SET display_name='Actual source change',version=version+1,updated_by=$1,operation_id=$2 WHERE id=$3",[f.actor,operation,r.customer]);
    const after=(await client.query('SELECT crest_private.customer_projection(c) AS value FROM crest.customers c WHERE id=$1',[r.customer])).rows[0].value;after.display_name='Wrong audit snapshot';
    await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,'customers',$4,2,'edit',$5,'manual')",[f.business,operation,f.actor,r.customer,{schemaVersion:1,before:old,after}]);
    await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result='{\"schemaVersion\":1}' WHERE business_id=$1 AND operation_id=$2",[f.business,operation]);
    await assert.rejects(client.query('COMMIT'),e=>e.code==='23514'&&e.message==='CREST_CUSTOMER_AUDIT_REQUIRED');
  }finally{await client.query('ROLLBACK');}assert.deepEqual(await evidence(f),before);
});
test('invalid payloads and page limits fail before source changes',async()=>{
  const f=await state(),before=await evidence(f);for(const value of [null,{},body({displayName:''}),body({phone:''}),body({outreachOptOut:'false'}),body({notes:'x'.repeat(2001)}),body({customerSince:'2026-02-30'}),{...body(),unknown:true}])await assert.rejects(command(f,request({body:value})),e=>e.code==='22023');for(const size of [0,51])await assert.rejects(directory(f,{size}),e=>e.code==='22023');assert.deepEqual(await evidence(f),before);
});
test('snapshot export requires a separate caller and read-only repeatable-read transaction',async()=>{
  await assert.rejects(web.query('SELECT crest_commands.customer_snapshot_context($1)',[a.business]),e=>e.code==='42501');await assert.rejects(exporter.query('SELECT crest_commands.customer_snapshot_context($1)',[a.business]),e=>e.code==='25001');
});
test('one snapshot includes archived/raw/null columns, excludes a concurrent commit and rejects another scope token',async()=>{
  const f=await state(),r=request({body:body({archived:true,archiveReason:'Retained evidence',notes:'\\N =text é 😀'})});await command(f,r);const original=await rows(f);await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{const ctx=(await exporter.query('SELECT crest_commands.customer_snapshot_context($1) AS result',[f.business])).rows[0].result;assert.equal(ctx.rowCount,'1');await command(f,request());const result=(await exporter.query('SELECT crest_commands.customer_snapshot_page($1,$2,$3,$4) AS result',[f.business,ctx.snapshotToken,null,50])).rows[0].result;assert.deepEqual(result.customers,original);assert.equal(Object.keys(result.customers[0]).length,21);const files=formatCustomerCsv({businessId:f.business,snapshotToken:ctx.snapshotToken,expectedRowCount:ctx.rowCount,rows:result.customers});assert.deepEqual(decodeCustomerCsv(files.csv,files.escapeMap),original);await assert.rejects(exporter.query('SELECT crest_commands.customer_snapshot_page($1,$2,$3,$4)',[b.business,ctx.snapshotToken,null,50]),e=>e.code==='22023');}finally{await exporter.query('ROLLBACK');}
  assert.equal((await rows(f)).length,2);
});
