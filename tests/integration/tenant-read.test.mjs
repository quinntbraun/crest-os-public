// DB invariants use synthetic provider rows; real SDK/JWT composition is also
// required in real-auth.test.mjs. These rows alone are not authentication proof.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

let sandbox,client,target,web,login,loginOwned=false,bootstrap,backup,prior,receipt,legacy,legacyRow,legacyHistory;
const issuer='https://auth.example.com/auth/v1';
const sql='SELECT crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8) AS result';
const parameters=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+60000),f.business];
const read=(f,connection=web,patch={})=>{const values=parameters(f);for(const [index,value] of Object.entries(patch))values[Number(index)]=value;return connection.query(sql,values);};
const denied=work=>assert.rejects(work,error=>error.code==='42501');
async function owner(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic tenant owner',$1,$2,$3,$3,'manual') RETURNING id,auth_user_id",[issuer,randomUUID(),bootstrap])).rows[0];}
async function state({trusted=false,ageHours=0}={}){
  const actor=await owner(),subject=actor.auth_user_id,provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
  await client.query('BEGIN');let business;
  try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic tenant','UTC',$1,$1,'manual') RETURNING id",[actor.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,actor.id,backup]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor.id]);await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_TENANT_SETUP_FAILED');}
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
  const created=new Date(Date.now()-ageHours*3600000-1000),expires=new Date(created.getTime()+(trusted?720:12)*3600000);
  await client.query("INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,$5,$5,$5,$6,$7,$8,'synthetic',id,id FROM crest_private.actors WHERE id=$2",[session,actor.id,provider,hash,created,expires,trusted,randomBytes(32)]);
  return {actor:actor.id,subject,provider,session,hash,business};
}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(10));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;backup=(await owner()).id;
  legacy=await state();legacyRow=(await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value;
  legacyHistory=createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex');
  receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
});
after(async()=>{await web?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});

test('schema10 upgrade preserves session/identity history and append-only CLI prefix',async()=>{
  assert.equal(prior.history.length,10);assert.equal(receipt.history.length,11);assert.deepEqual(receipt.history.slice(0,10),prior.history);
  assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value,legacyRow);
  assert.equal(createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex'),legacyHistory);
});
test('one guarded identity.read returns only the selected business context without changing activity',async()=>{
  const result=(await read(legacy)).rows[0].result;assert.deepEqual(result,{actorId:legacy.actor,businessId:legacy.business,currency:'USD',timezone:'UTC'});
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value,legacyRow);
  assert.equal((await client.query('SELECT writes_enabled FROM crest_private.business_recovery_authorities WHERE business_id=$1',[legacy.business])).rows[0].writes_enabled,false,'read does not enable writes');
});
test('a guessed business, other tenant and forged GUCs cannot choose another membership',async()=>{
  const other=await state();await denied(read(legacy,web,{7:other.business}));await denied(read(legacy,web,{7:randomUUID()}));
  await web.query("SELECT set_config('crest.business_id',$1,false),set_config('crest.actor_id',$2,false)",[other.business,other.actor]);
  assert.equal((await read(legacy)).rows[0].result.businessId,legacy.business);await denied(read(legacy,web,{7:other.business}));await web.query('RESET ALL; SET ROLE crest_web');
});
test('same restricted connection alternates authorized tenants across commit and rollback without context leakage',async()=>{
  const other=await state();for(const [f,finish] of [[legacy,'COMMIT'],[other,'ROLLBACK'],[legacy,'COMMIT']]){
    await web.query('BEGIN');try{assert.equal((await read(f)).rows[0].result.businessId,f.business);await web.query(finish);}catch(error){await web.query('ROLLBACK');throw error;}
    await denied(read(f,web,{7:f===legacy?other.business:legacy.business}));
  }
});
test('one actor explicitly linked to two businesses can select either, while an unrelated third stays denied',async()=>{
  const a=await state(),b=await state(),c=await state();
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[b.business,a.actor,b.actor]);
  for(const business of [a.business,b.business])assert.equal((await read(a,web,{7:business})).rows[0].result.businessId,business);
  await denied(read(a,web,{7:c.business}));
});
test('exact hash, local identity, immutable issuer/subject and provider binding are all mandatory',async()=>{
  for(const patch of [{0:randomBytes(32)},{1:randomUUID()},{2:randomUUID()},{3:'https://other.example.com/auth/v1'},{4:randomUUID()},{5:randomUUID()},{6:new Date(Date.now()-1000)}])await denied(read(legacy,web,patch));
});
test('null/malformed guard inputs and stale isolation cannot become a partial read',async()=>{
  for(const patch of [{0:null},{0:randomBytes(31)},{7:null},{6:'infinity'}])await assert.rejects(read(legacy,web,patch),error=>error.code==='22023');
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){await web.query('BEGIN ISOLATION LEVEL '+isolation);try{await assert.rejects(read(legacy),error=>error.code==='25001');}finally{await web.query('ROLLBACK');}}
});
test('expired untrusted and idle trusted sessions deny at the DB boundary',async()=>{
  await denied(read(await state({ageHours:13})));await denied(read(await state({trusted:true,ageHours:169})));
});
test('durable local revocation denies even while provider session remains live',async()=>{
  const f=await state();await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);await denied(read(f));
  assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[f.provider])).rows[0].n,1);
});
test('actor epoch change, disable, inactive membership and suspended business deny on the next read',async()=>{
  for(const kind of ['epoch','disable','membership','business']){
    const f=await state();await read(f);
    if(kind==='epoch')await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),f.actor]);
    if(kind==='disable')await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.actor]);
    if(kind==='membership')await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor]);
    if(kind==='business')await client.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);
    await denied(read(f));
  }
});
test('provider deletion, AAL downgrade and provider expiry are reread rather than cached',async()=>{
  for(const kind of ['delete','aal','expiry']){
    const f=await state();await read(f);
    if(kind==='delete')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);
    if(kind==='aal')await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[f.provider]);
    if(kind==='expiry')await client.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=$1",[f.provider]);
    await denied(read(f));
  }
});
test('missing capability/recovery read privileges fail closed without suppressing RLS',async()=>{
  for(const [relation,columns] of [['crest_private.role_capabilities','role,capability'],['crest_private.business_recovery_authorities','id,business_id']]){
    await client.query(`REVOKE SELECT(${columns}) ON ${relation} FROM crest_session_owner`);
    try{await denied(read(legacy));}finally{await client.query(`GRANT SELECT(${columns}) ON ${relation} TO crest_session_owner`);}
  }
});
test('no runtime table grant or browser/worker/recovery execute permission is introduced',async()=>{
  for(const role of ['anon','authenticated','service_role','crest_auth_reader','crest_worker','crest_recovery','crest_command_owner','crest_schema_owner']){
    assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,'crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)'])).rows[0].allowed,false);
  }
  for(const relation of ['crest.businesses','crest.memberships','crest_private.actors','crest_private.app_sessions','crest_private.role_capabilities','crest_private.business_recovery_authorities']){
    assert.equal((await client.query("SELECT has_any_column_privilege('crest_web',$1,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed",[relation])).rows[0].allowed,false);
    const r=(await client.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[relation])).rows[0];assert(r.relrowsecurity&&r.relforcerowsecurity);
  }
});
test('the new definer and lock-only recovery rights cannot update identity or recovery state',async()=>{
  const r=(await client.query("SELECT proconfig,provolatile,prosecdef,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)'::regprocedure")).rows[0];
  assert.equal(r.owner,'crest_session_owner');assert.equal(r.provolatile,'v');assert(r.prosecdef);assert.deepEqual(r.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
  await client.query('BEGIN; SET LOCAL ROLE crest_session_owner');try{await assert.rejects(client.query('UPDATE crest_private.business_recovery_authorities SET id=gen_random_uuid()'),error=>['42501','55000','23514'].includes(error.code));}finally{await client.query('ROLLBACK');}
});
async function blocked(waiter,holder){
  const deadline=Date.now()+3000;while(Date.now()<deadline){if((await client.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked',[waiter,holder])).rows[0].blocked)return;await delay(10);}assert.fail('required database lock barrier was not observed');
}
test('an authorized read holds the business root until commit; a later membership/status change denies next request',async()=>{
  const f=await state(),writer=await sandbox.connect(target),holder=(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,waiter=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let pending;await web.query('BEGIN');await writer.query('BEGIN');
  try{
    await read(f);pending=writer.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);void pending.catch(()=>undefined);
    await blocked(waiter,holder);await web.query('COMMIT');await pending;await writer.query('COMMIT');await denied(read(f));
  }finally{await web.query('ROLLBACK');await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('authorization waiting on a changed business root uses a fresh post-wait snapshot',async()=>{
  const f=await state(),writer=await sandbox.connect(target),waiter=(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,holder=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let pending;await writer.query('BEGIN');
  try{
    await writer.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);pending=read(f);void pending.catch(()=>undefined);
    await blocked(waiter,holder);await writer.query('COMMIT');await denied(pending);
  }finally{await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('recovery authority shared lock survives the read and rollback releases it without advancing authority',async()=>{
  const f=await state(),writer=await sandbox.connect(target),holder=(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,waiter=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const before=(await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[f.business])).rows[0].active_epoch;
  let pending;await web.query('BEGIN');await writer.query('BEGIN');
  try{
    await read(f);pending=writer.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);void pending.catch(()=>undefined);
    await blocked(waiter,holder);await web.query('ROLLBACK');await pending;await writer.query('ROLLBACK');
    assert.equal((await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[f.business])).rows[0].active_epoch,before);await read(f);
  }finally{await web.query('ROLLBACK');await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('selected-session revoke waits for the in-flight context read, then denies the next request',async()=>{
  const f=await state(),writer=await sandbox.connect(target),holder=(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,waiter=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let pending;await web.query('BEGIN');await writer.query('BEGIN; SET LOCAL ROLE crest_web');
  try{
    await read(f);pending=writer.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);void pending.catch(()=>undefined);
    await blocked(waiter,holder);await web.query('COMMIT');await pending;await writer.query('COMMIT');await denied(read(f));
  }finally{await web.query('ROLLBACK');await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
