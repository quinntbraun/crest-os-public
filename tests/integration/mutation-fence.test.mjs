// Synthetic provider rows test SQL invariants only. Actual SDK/JWT composition
// is additionally required by real-auth.test.mjs. Probe writes are CI-only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {sessionDatabase} from '../../src/security/session-database.ts';

let sandbox,client,target,web,login,loginOwned=false,bootstrap,backup,prior,receipt,legacy,probe,legacyRow,history,runtimeUrl;
const issuer='https://auth.example.com/auth/v1',signal=()=>new AbortController().signal;
const sql='SELECT crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result';
const values=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+60000),f.business,f.epoch,'crm.manage',false];
const fence=(f,connection=web,patch={})=>{const parameters=values(f);for(const [index,value] of Object.entries(patch))parameters[Number(index)]=value;return connection.query(sql,parameters);};
const denied=work=>assert.rejects(work,e=>e.code==='42501');
const recovery=work=>assert.rejects(work,e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
async function owner(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic fence owner',$1,$2,$3,$3,'manual') RETURNING id,auth_user_id",[issuer,randomUUID(),bootstrap])).rows[0];}
async function state({ageHours=0,trusted=false}={}){
  const actor=await owner(),subject=actor.auth_user_id,provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);let business,epoch;
  await client.query('BEGIN');try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic fence business','UTC',$1,$1,'manual') RETURNING id",[actor.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,actor.id,backup]);
    epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual') RETURNING active_epoch",[business,actor.id])).rows[0].active_epoch;await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_FENCE_SETUP_FAILED');}
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
  const created=new Date(Date.now()-ageHours*3600000-1000),expires=new Date(created.getTime()+(trusted?720:12)*3600000);
  await client.query("INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,$5,$5,$5,$6,$7,$8,'synthetic',id,id FROM crest_private.actors WHERE id=$2",[session,actor.id,provider,hash,created,expires,trusted,randomBytes(32)]);
  return {actor:actor.id,subject,provider,session,hash,business,epoch};
}
async function enabled(options){const f=await state(options);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);return f;}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(11));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;backup=(await owner()).id;legacy=await state();probe=await enabled();
  legacyRow=(await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value;
  history=createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex');receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_web TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();web=await sandbox.connect(runtimeUrl);await web.query('SET ROLE crest_web');
  // Explicitly isolated probe privileges test COMMIT/ROLLBACK on real writes.
  // Production migration grants no table writes and creates no such probe.
  assert.match(probe.business,/^[a-f0-9-]{36}$/);
  await client.query(`SET ROLE crest_schema_owner; CREATE TABLE crest.fence_probe(id uuid PRIMARY KEY,business_id uuid NOT NULL,value text NOT NULL); ALTER TABLE crest.fence_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE crest.fence_probe FORCE ROW LEVEL SECURITY; GRANT SELECT,INSERT ON crest.fence_probe TO crest_web; CREATE POLICY synthetic_probe ON crest.fence_probe TO crest_web USING (business_id='${probe.business}'::uuid) WITH CHECK (business_id='${probe.business}'::uuid); RESET ROLE`);
});
after(async()=>{await web?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});

test('schema11 upgrade preserves stored session/history and the exact CLI prefix',async()=>{
  assert.equal(prior.history.length,11);assert.equal(receipt.history.length,12);assert.deepEqual(receipt.history.slice(0,11),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value,legacyRow);
  assert.equal(createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex'),history);
});
test('default paused writes and stale expected epoch fail without changing authority or session activity',async()=>{
  await recovery(fence(legacy));const f=await enabled();await recovery(fence(f,web,{8:randomUUID()}));
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[legacy.session])).rows[0].value,legacyRow);
  assert.equal((await client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[f.business])).rows[0].active_epoch,f.epoch);
});
test('valid authority returns only the pinned exact context for migration-maintained capabilities',async()=>{
  const f=await enabled();for(const capability of ['identity.manage','crm.manage','finance.post','export.bulk']){
    assert.deepEqual((await fence(f,web,{9:capability})).rows[0].result,{actorId:f.actor,businessId:f.business,sessionId:f.session,recoveryEpoch:f.epoch,capability});
  }
});
test('unknown/read-only powers, extra authority selection and malformed input cannot grant a fence',async()=>{
  const f=await enabled();for(const patch of [{0:null},{0:randomBytes(31)},{8:null},{9:'identity.read'},{9:'recovery.authorize'},{10:null},{6:'infinity'}])await assert.rejects(fence(f,web,patch),e=>e.code==='22023');
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){await web.query('BEGIN ISOLATION LEVEL '+isolation);try{await assert.rejects(fence(f),e=>e.code==='25001');}finally{await web.query('ROLLBACK');}}
});
test('cross-business, forged GUC and exact provider/local binding mismatches deny before recovery lookup',async()=>{
  const f=await enabled(),other=await state();await web.query("SELECT set_config('crest.business_id',$1,false),set_config('crest.actor_id',$2,false)",[other.business,other.actor]);
  for(const patch of [{7:other.business},{0:randomBytes(32)},{1:randomUUID()},{2:randomUUID()},{3:'https://other.example.com/auth/v1'},{4:randomUUID()},{5:randomUUID()}])await denied(fence(f,web,patch));
  await web.query('RESET ALL; SET ROLE crest_web');await fence(f);
});
test('local revocation, absolute expiry and trusted inactivity deny even with an enabled epoch',async()=>{
  const f=await enabled();await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);await denied(fence(f));
  await denied(fence(await enabled({ageHours:13})));await denied(fence(await enabled({trusted:true,ageHours:169})));
  await denied(fence(await state({ageHours:13})));
});
test('recent authentication is route-selectable and unconditionally mandatory for export.bulk',async()=>{
  const f=await enabled({ageHours:1});await fence(f);await denied(fence(f,web,{10:true}));await denied(fence(f,web,{9:'export.bulk',10:false}));
});
test('actor/security epoch/membership/business changes and provider revocation remain live checks',async()=>{
  for(const kind of ['epoch','disable','membership','business','provider','aal']){
    const f=await enabled();await fence(f);
    if(kind==='epoch')await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),f.actor]);
    if(kind==='disable')await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.actor]);
    if(kind==='membership')await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor]);
    if(kind==='business')await client.query("UPDATE crest.businesses SET status='suspended',version=version+1 WHERE id=$1",[f.business]);
    if(kind==='provider')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);
    if(kind==='aal')await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[f.provider]);await denied(fence(f));
  }
});
test('command profile holds one checked-out transaction and commits or rolls back real probe writes',async()=>{
  const database=sessionDatabase({connectionString:runtimeUrl,environment:'test'}),committed=randomUUID(),rolledBack=randomUUID();
  const write=(q,id)=>q('INSERT INTO crest.fence_probe(id,business_id,value) VALUES($1,$2,$3) RETURNING id AS result',[id,probe.business,'synthetic']);
  assert.equal(await database.commandTransaction(async q=>{await q(sql,values(probe));return write(q,committed);},signal()),committed);
  await assert.rejects(database.commandTransaction(async q=>{await q(sql,values(probe));await write(q,rolledBack);throw new Error('private detail');},signal()),e=>e.message==='SESSION_DATABASE_FAILED'&&e.cause===undefined);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.fence_probe WHERE id=$1',[committed])).rows[0].n,1);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.fence_probe WHERE id=$1',[rolledBack])).rows[0].n,0);
});
test('command timeouts and isolation differ from refresh without broadening runtime authority',async()=>{
  const database=sessionDatabase({connectionString:runtimeUrl,environment:'test'});
  const result=await database.commandTransaction(q=>q("SELECT jsonb_build_object('lock',current_setting('lock_timeout'),'statement',current_setting('statement_timeout'),'idle',current_setting('idle_in_transaction_session_timeout'),'transaction',current_setting('transaction_timeout'),'isolation',current_setting('transaction_isolation'),'role',current_user,'application',current_setting('application_name')) AS result",[]),signal());
  assert.deepEqual(result,{lock:'3s',statement:'10s',idle:'12s',transaction:'15s',isolation:'read committed',role:'crest_web',application:'crest_business_command'});
  await assert.rejects(sessionDatabase({connectionString:target,environment:'test'}).commandTransaction(async()=>true,signal()),e=>e.message==='SESSION_DATABASE_FAILED');
});
test('a swallowed SQL error makes COMMIT report ROLLBACK and never returns false success',async()=>{
  const database=sessionDatabase({connectionString:runtimeUrl,environment:'test'}),id=randomUUID();
  await assert.rejects(database.commandTransaction(async q=>{
    await q(sql,values(probe));await q('INSERT INTO crest.fence_probe(id,business_id,value) VALUES($1,$2,$3) RETURNING id AS result',[id,probe.business,'synthetic']);
    try{await q("SELECT 'synthetic-private-failure'::integer AS result",[]);}catch{/* deliberately swallowed */}return 'must not confirm';
  },signal()),e=>e.message==='SESSION_DATABASE_FAILED'&&e.cause===undefined);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.fence_probe WHERE id=$1',[id])).rows[0].n,0);
});
test('only fixed recovery-review classification escapes the command DB profile',async()=>{
  const database=sessionDatabase({connectionString:runtimeUrl,environment:'test'});await assert.rejects(database.commandTransaction(q=>q(sql,values(legacy)),signal()),e=>e.message==='RECOVERY_REVIEW_REQUIRED'&&e.cause===undefined);
  await assert.rejects(database.commandTransaction(q=>q("SELECT 'synthetic-private-detail'::integer AS result",[]),signal()),e=>e.message==='SESSION_DATABASE_FAILED'&&e.cause===undefined);
});
test('migration adds no public recovery activation or runtime table write grant',async()=>{
  const fn='crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)';
  for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_command_owner','crest_auth_reader','crest_schema_owner'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);
  for(const column of ['active_epoch','writes_enabled']){
    assert.equal((await client.query("SELECT has_column_privilege('crest_session_owner','crest_private.business_recovery_authorities',$1,'UPDATE') AS allowed",[column])).rows[0].allowed,false);
    assert.equal((await client.query("SELECT has_column_privilege('crest_web','crest_private.business_recovery_authorities',$1,'SELECT,UPDATE') AS allowed",[column])).rows[0].allowed,false);
  }
  for(const relation of ['crest.businesses','crest.memberships','crest_private.actors','crest_private.app_sessions'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_web',$1,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed",[relation])).rows[0].allowed,false);
  const routine=(await client.query('SELECT proconfig,prosecdef,provolatile,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert.deepEqual(routine,{proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],prosecdef:true,provolatile:'v',owner:'crest_session_owner'});
});
async function blocked(waiter,holder){const deadline=Date.now()+3000;while(Date.now()<deadline){if((await client.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS value',[waiter,holder])).rows[0].value)return;await delay(10);}assert.fail('required lock barrier was not observed');}
const pid=async connection=>(await connection.query('SELECT pg_backend_pid() AS id')).rows[0].id;
test('authority is held through commit and a later recovery epoch denies the old command',async()=>{
  const f=await enabled(),writer=await sandbox.connect(target),holder=await pid(web),waiter=await pid(writer),next=randomUUID();let pending;await web.query('BEGIN');await writer.query('BEGIN');
  try{await fence(f);pending=writer.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[next,f.business]);void pending.catch(()=>undefined);await blocked(waiter,holder);await web.query('COMMIT');await pending;await writer.query('COMMIT');await recovery(fence(f));assert.equal((await fence(f,web,{8:next})).rows[0].result.recoveryEpoch,next);}
  finally{await web.query('ROLLBACK');await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('authority changed after request validation but before the shared lock fails on a fresh snapshot',async()=>{
  const f=await enabled(),writer=await sandbox.connect(target),waiter=await pid(web),holder=await pid(writer);let pending;await writer.query('BEGIN');
  try{await writer.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);pending=fence(f);void pending.catch(()=>undefined);await blocked(waiter,holder);await writer.query('COMMIT');await recovery(pending);}
  finally{await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('provider removal during the recovery lock wait denies before recovery disclosure or downstream work',async()=>{
  const f=await enabled(),writer=await sandbox.connect(target),waiter=await pid(web),holder=await pid(writer);let pending;await writer.query('BEGIN');
  try{await writer.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),f.business]);pending=fence(f);void pending.catch(()=>undefined);await blocked(waiter,holder);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);await writer.query('COMMIT');await denied(pending);}
  finally{await writer.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('rollback releases the authority and the selected session is serialized before the fence',async()=>{
  const f=await enabled(),other=await sandbox.connect(runtimeUrl),holder=await pid(web),waiter=await pid(other);await other.query('SET ROLE crest_web');let pending;await web.query('BEGIN');
  try{await fence(f);pending=fence(f,other);void pending.catch(()=>undefined);await blocked(waiter,holder);await web.query('ROLLBACK');assert.equal((await pending).rows[0].result.recoveryEpoch,f.epoch);}
  finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
