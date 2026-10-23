// DB invariants use synthetic provider rows; real SDK/JWT composition is also
// required in real-auth.test.mjs. These rows alone are not authentication proof.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

let sandbox,client,target,web,login,loginOwned=false,bootstrap,backup,prior,previous,receipt,legacy,retained,operation;
const issuer='https://auth.example.com/auth/v1';
const sql='SELECT crest_commands.read_business_settings_context($1,$2,$3,$4,$5,$6,$7,$8) AS result';
const parameters=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+60000),f.business];
const read=(f,connection=web,patch={})=>{const values=parameters(f);for(const [index,value] of Object.entries(patch))values[Number(index)]=value;return connection.query(sql,values);};
const denied=work=>assert.rejects(work,error=>error.code==='42501');
async function owner(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic tenant owner',$1,$2,$3,$3,'manual') RETURNING id,auth_user_id",[issuer,randomUUID(),bootstrap])).rows[0];}
async function state({trusted=false,ageHours=0,initialVersion='1'}={}){
  const actor=await owner(),subject=actor.auth_user_id,provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
  await client.query('BEGIN');let business;
  try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,version,created_by,updated_by,origin) VALUES('Synthetic tenant','UTC',$2,$1,$1,'manual') RETURNING id",[actor.id,initialVersion])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,actor.id,backup]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor.id]);await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_TENANT_SETUP_FAILED');}
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
  const created=new Date(Date.now()-ageHours*3600000-1000),expires=new Date(created.getTime()+(trusted?720:12)*3600000);
  await client.query("INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,$5,$5,$5,$6,$7,$8,'synthetic',id,id FROM crest_private.actors WHERE id=$2",[session,actor.id,provider,hash,created,expires,trusted,randomBytes(32)]);
  return {actor:actor.id,subject,provider,session,hash,business};
}
async function evidence(f){
  const rows={};for(const [name,relation,where,id] of [['business','crest.businesses','id',f.business],['session','crest_private.app_sessions','id',f.session],
    ['recovery','crest_private.business_recovery_authorities','business_id',f.business],['history','crest_private.identity_events','business_id',f.business],
    ['operations','crest_private.operations','business_id',f.business],['audits','crest_private.audit_events','business_id',f.business]])
    rows[name]=(await client.query(`SELECT to_jsonb(r) AS row FROM ${relation} r WHERE ${where}=$1 ORDER BY id`,[id])).rows;
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
const enable=f=>client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);
const authority=async f=>(await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[f.business])).rows[0].active_epoch;
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(14));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;backup=(await owner()).id;legacy=await state();
  previous=await sandbox.apply(target,await sandbox.prefix(15));
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query("SET ROLE crest_web; SET lock_timeout='3s'");
  await enable(legacy);operation=randomUUID();await web.query('SELECT crest_commands.rename_business($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1,$11)',
    [...parameters(legacy),await authority(legacy),operation,'Retained synthetic name']);retained=await evidence(legacy);
  receipt=await sandbox.apply(target);
});
after(async()=>{await web?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
test('schema14/15 upgrades preserve prior receipts and genuine committed source/session/audit/history',async()=>{
  assert.equal(prior.history.length,14);assert.equal(previous.history.length,15);assert.equal(receipt.history.length,26);
  assert.deepEqual(previous.history.slice(0,14),prior.history);assert.deepEqual(receipt.history.slice(0,15),previous.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.equal(await evidence(legacy),retained);assert.equal((await read(legacy)).rows[0].result.legalName,'Retained synthetic name');
  const result=(await web.query('SELECT crest_commands.lookup_business_name_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[...parameters(legacy),operation])).rows[0].result;
  assert.equal(result.state,'committed');assert.equal(result.receipt.businessVersion,'2');
});
test('ready settings expose only exact name/version/epoch and never change data or foreground activity',async()=>{
  const before=await evidence(legacy),result=(await read(legacy)).rows[0].result;
  assert.deepEqual(result,{schemaVersion:1,businessId:legacy.business,legalName:'Retained synthetic name',businessVersion:'2',writeState:'ready',recoveryEpoch:await authority(legacy)});
  assert.equal(await evidence(legacy),before);
});
test('paused settings remain reviewable but never reveal an active epoch or enable writes',async()=>{
  const f=await state(),before=await evidence(f);assert.deepEqual((await read(f)).rows[0].result,{schemaVersion:1,businessId:f.business,legalName:'Synthetic tenant',businessVersion:'1',writeState:'paused',recoveryEpoch:null});assert.equal(await evidence(f),before);
});
test('positive bigint versions cross the boundary as exact decimal strings',async()=>{
  const f=await state({initialVersion:'9007199254740993'});assert.equal((await read(f)).rows[0].result.businessVersion,'9007199254740993');
});
test('cross-tenant, guessed targets and forged session GUCs cannot disclose settings',async()=>{
  const f=await state();await web.query("SELECT set_config('crest.business_id',$1,false),set_config('crest.actor_id',$2,false),set_config('crest.operation_id',$3,false)",[legacy.business,legacy.actor,operation]);
  await denied(read(f,web,{7:legacy.business}));await denied(read(f,web,{7:randomUUID()}));assert.equal((await read(f)).rows[0].result.businessId,f.business);
  for(const patch of [{0:randomBytes(32)},{1:randomUUID()},{2:legacy.actor},{3:'https://other.example.com/auth/v1'},{4:randomUUID()},{5:randomUUID()},{6:new Date(Date.now()-1000)}])await denied(read(f,web,patch));
  await web.query('RESET ALL; SET ROLE crest_web; SET lock_timeout=\'3s\'');
});
test('both identity capabilities are required independently even for paused settings',async()=>{
  const f=await state();for(const capability of ['identity.read','identity.manage']){
    await client.query(`CREATE POLICY settings_capability_probe ON crest_private.role_capabilities AS RESTRICTIVE FOR SELECT TO crest_session_owner USING(capability<>'${capability}')`);
    try{await denied(read(f));}finally{await client.query('DROP POLICY settings_capability_probe ON crest_private.role_capabilities');}
  }
});
test('null and malformed bindings and nonfresh isolation fail before a projection',async()=>{
  for(const patch of [{0:null},{0:randomBytes(31)},{1:null},{2:null},{3:null},{4:null},{5:null},{6:'infinity'},{7:null}])await assert.rejects(read(legacy,web,patch),e=>e.code==='22023');
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){await web.query('BEGIN ISOLATION LEVEL '+isolation);try{await assert.rejects(read(legacy),e=>e.code==='25001');}finally{await web.query('ROLLBACK');}}
});
test('current local/provider eligibility, membership and business status remain mandatory',async()=>{
  for(const kind of ['local','provider','aal','actor','membership','business']){
    const f=await state();if(kind==='local')await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);
    if(kind==='provider')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);if(kind==='aal')await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[f.provider]);
    if(kind==='actor')await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),f.actor]);
    if(kind==='membership')await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor]);
    if(kind==='business')await client.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);await denied(read(f));
  }
  await denied(read(await state({ageHours:13})));await denied(read(await state({trusted:true,ageHours:169})));
});
test('only web can execute the guarded definer; no raw web access or added write power',async()=>{
  const name='crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)';
  const row=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[name])).rows[0];assert.deepEqual(row,{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner:'crest_session_owner'});
  for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_command_owner','crest_web'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS yes",[role,name])).rows[0].yes,role==='crest_web');
  for(const relation of ['crest.businesses','crest_private.business_recovery_authorities']){
    assert.equal((await client.query("SELECT has_any_column_privilege('crest_web',$1,'SELECT,INSERT,UPDATE,REFERENCES') AS yes",[relation])).rows[0].yes,false);
    const r=(await client.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[relation])).rows[0];assert(r.relrowsecurity&&r.relforcerowsecurity);
  }
  for(const col of ['legal_name','version'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest.businesses',$1,'UPDATE') AS yes",[col])).rows[0].yes,false);
  for(const col of ['active_epoch','writes_enabled'])assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.business_recovery_authorities',$1,'UPDATE') AS yes",[col])).rows[0].yes,false);
  await assert.rejects(web.query('SET ROLE crest_session_owner'),e=>e.code==='42501');
});
async function blocked(waiter,holder){const until=Date.now()+2500;while(Date.now()<until){if((await client.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked',[waiter,holder])).rows[0].blocked)return;await delay(10);}assert.fail('required settings lock barrier was not observed');}
const pid=async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
test('settings hold a coherent root/recovery snapshot through commit; later changes need a fresh read',async()=>{
  const f=await state();await enable(f);const holder=await pid(web),writer=await sandbox.connect(target),waiter=await pid(writer);let pending;
  await web.query('BEGIN');await writer.query('BEGIN');try{
    const first=(await read(f)).rows[0].result;pending=writer.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);void pending.catch(()=>undefined);
    await blocked(waiter,holder);await web.query('COMMIT');await pending;await writer.query('COMMIT');assert.notEqual((await read(f)).rows[0].result.recoveryEpoch,first.recoveryEpoch);
  }finally{await web.query('ROLLBACK');await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('provider revocation during an observed recovery wait denies the late snapshot',async()=>{
  const f=await state(),writer=await sandbox.connect(target),waiter=await pid(web),holder=await pid(writer);let pending;await writer.query('BEGIN');try{
    await writer.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[f.business]);pending=read(f);void pending.catch(()=>undefined);await blocked(waiter,holder);
    await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);await writer.query('ROLLBACK');await denied(pending);
  }finally{await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('business changes during a root wait are freshly authorized before name/version disclosure',async()=>{
  const f=await state(),writer=await sandbox.connect(target),waiter=await pid(web),holder=await pid(writer);let pending;await writer.query('BEGIN');try{
    await writer.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);pending=read(f);void pending.catch(()=>undefined);await blocked(waiter,holder);await writer.query('COMMIT');await denied(pending);
  }finally{await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('pooled commit/rollback and another tenant cannot reuse previously returned context as authority',async()=>{
  const f=await state();for(const [current,finish] of [[legacy,'COMMIT'],[f,'ROLLBACK'],[legacy,'COMMIT']]){
    await web.query('BEGIN');try{assert.equal((await read(current)).rows[0].result.businessId,current.business);await web.query(finish);}finally{await web.query('ROLLBACK');}
    await denied(read(current,web,{7:current===legacy?f.business:legacy.business}));
  }
});
