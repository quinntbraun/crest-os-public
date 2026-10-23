// Actual pinned provider DDL and PostgreSQL RLS; synthetic metadata only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

const issuer='https://auth.example.com/auth/v1';
const fn='crest_commands.provider_session_inventory(uuid,text,uuid,integer)';
let sandbox,client,target,maintenance,login,loginOwned=false,bootstrap,owner,other,business,prior,receipt,legacy,retained;
const tables=['auth.sessions','auth.users','auth.refresh_tokens','crest_private.actors','crest_private.app_sessions','crest_private.provider_cleanup_references','crest_private.session_events'];
const inventory=(actor=owner,after=null,size=100,expectedIssuer=issuer,c=maintenance)=>c.query('SELECT * FROM crest_commands.provider_session_inventory($1,$2,$3,$4)',[actor.id,expectedIssuer,after,size]).then(r=>r.rows);
async function digest(){return (await client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.provider_cleanup_references s))::text,'UTF8')),'hex') AS hash")).rows[0].hash;}
async function actor(subject=randomUUID(),expectedIssuer=issuer){
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated') ON CONFLICT DO NOTHING",[subject,`synthetic-${subject}@example.com`]);
  const id=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic inventory owner',$1,$2,$3,$3,'manual') RETURNING id",[expectedIssuer,subject,bootstrap])).rows[0].id;
  return {id,subject};
}
async function provider(a=owner,{id=randomUUID(),aal='aal2',notAfter=null}={}){await client.query('INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())',[id,a.subject,aal,notAfter]);return id;}
async function register(a,p,{expired=false}={}){
  const hash=randomBytes(32);const id=(await client.query("WITH moment AS (SELECT clock_timestamp()-CASE WHEN $4 THEN interval '14 hours' ELSE interval '1 second' END AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT id,$2,$3,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,decode(repeat('ab',32),'hex'),'synthetic',id,id FROM crest_private.actors,moment WHERE id=$1 RETURNING id",[a.id,p,hash,expired])).rows[0].id;return {id,hash};
}
async function membership(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
async function asRole(role,work){await client.query('BEGIN');try{await client.query(`SET LOCAL ROLE ${role}`);await work();}finally{await client.query('ROLLBACK');}}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(17));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic inventory business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,owner.id,other.id]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const p=await provider();legacy=await register(owner,p);await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[legacy.hash,randomUUID()]);retained=await digest();receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_inventory TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;maintenance=await sandbox.connect(url.toString());await maintenance.query('SET ROLE crest_inventory');
});
after(async()=>{await maintenance?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});

test('schema17 upgrade preserves provider/local evidence and exact migration receipt prefix',async()=>{
  assert.equal(prior.history.length,17);assert.equal(receipt.history.length,18);assert.deepEqual(receipt.history.slice(0,17),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);assert.equal(await digest(),retained);
});
test('unregistered AAL1 and AAL2 sessions are observations with no inferred orphan or authorization',async()=>{
  const a=await provider(owner,{aal:'aal1'}),b=await provider(),before=await digest(),rows=await inventory();
  for(const [id,aal] of [[a,'aal1'],[b,'aal2']]){const row=rows.find(r=>r.provider_session_id===id);assert(row);assert.equal(row.provider_aal,aal);assert.equal(row.app_session_id,null);assert.equal(row.cleanup_reference_id,null);assert.equal(row.local_epoch_current,null);assert.equal(row.provider_unexpired,true);}
  assert.equal(await digest(),before);assert(rows.every(r=>r.observed_at.getTime()===rows[0].observed_at.getTime()));
});
test('registered and locally revoked devices join only exact retained reference metadata',async()=>{
  const p=await provider(),f=await register(owner,p),rows=await inventory(),active=rows.find(r=>r.provider_session_id===p),revoked=rows.find(r=>r.app_session_id===legacy.id);
  assert.equal(active.app_session_id,f.id);assert.equal(active.local_revoked_at,null);assert.equal(active.local_epoch_current,true);assert.equal(active.cleanup_reference_id,null);assert.equal(active.actor_disabled,false);
  assert(revoked.local_revoked_at);assert(revoked.cleanup_reference_id);assert.equal(revoked.provider_unexpired,true);
  assert.deepEqual(Object.keys(active).sort(),['provider_session_id','app_session_id','cleanup_reference_id','provider_aal','provider_not_after','provider_unexpired','local_revoked_at','local_expires_at','local_epoch_current','actor_disabled','observed_at'].sort());
});
test('provider deadlines remain separate from MFA and local registration',async()=>{
  const ids=[];for(const notAfter of [new Date(Date.now()-1000),'infinity','-infinity'])ids.push(await provider(owner,{notAfter}));const future=await provider(owner,{notAfter:new Date(Date.now()+60000)}),rows=await inventory();
  for(const id of ids)assert.equal(rows.find(r=>r.provider_session_id===id).provider_unexpired,false);assert.equal(rows.find(r=>r.provider_session_id===future).provider_unexpired,true);
});
test('actor and exact issuer binding exclude other subjects and mismatched provider environments',async()=>{
  const p=await provider(other),alias=await actor(owner.subject,'https://other.example.com/auth/v1');
  assert(!(await inventory()).some(r=>r.provider_session_id===p));assert.deepEqual((await inventory(other)).map(r=>r.provider_session_id),[p]);
  await assert.rejects(inventory(owner,null,100,'https://other.example.com/auth/v1'),e=>e.code==='42501');await assert.rejects(inventory(alias),e=>e.code==='42501');
});
test('null or oversized inputs fail closed rather than allowing unlimited results',async()=>{
  for(const size of [null,0,-1,101,2147483647])await assert.rejects(inventory(owner,null,size),e=>e.code==='22023');
  for(const expectedIssuer of [null,'','x'.repeat(501)])await assert.rejects(inventory(owner,null,1,expectedIssuer),e=>e.code==='22023');await assert.rejects(inventory({id:null}),e=>e.code==='22023');
});
test('bounded UUID keyset pagination is ordered, exclusive and complete for a quiescent subject',async()=>{
  const a=await actor(),ids=[];for(let i=0;i<7;i++)ids.push(await provider(a));ids.sort();let cursor=null;const seen=[];
  for(let i=0;i<5;i++){const page=await inventory(a,cursor,2);assert(page.length<=2);if(!page.length)break;seen.push(...page.map(r=>r.provider_session_id));cursor=page.at(-1).provider_session_id;}
  assert.deepEqual(seen,ids);assert.deepEqual(await inventory(a,cursor,2),[]);
});
test('an in-flight registration commits independently and a new observation sees it without mutation',async()=>{
  const a=await actor();await membership(a);const p=await provider(a);await client.query('BEGIN');let f;try{f=await register(a,p);assert.equal((await inventory(a))[0].app_session_id,null);await client.query('COMMIT');}finally{await client.query('ROLLBACK');}
  assert.equal((await inventory(a))[0].app_session_id,f.id);assert.equal((await client.query('SELECT revoked_at FROM crest_private.app_sessions WHERE id=$1',[f.id])).rows[0].revoked_at,null);
});
test('inserts behind a cursor require a fresh sweep and end-of-page is never absence proof',async()=>{
  const a=await actor(),high='ffffffff-ffff-ffff-ffff-fffffffffff0',low='00000000-0000-0000-0000-000000000010';await provider(a,{id:high});assert.equal((await inventory(a,null,1))[0].provider_session_id,high);
  await provider(a,{id:low});assert.deepEqual(await inventory(a,high,1),[]);assert.equal((await inventory(a,null,1))[0].provider_session_id,low);
});
test('provider removal does not erase retained local revocation or claim cleanup completion',async()=>{
  const a=await actor();await membership(a);const p=await provider(a),f=await register(a,p);await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);
  const before=(await client.query('SELECT to_jsonb(r) AS row FROM crest_private.provider_cleanup_references r WHERE app_session_id=$1',[f.id])).rows;assert.equal((await inventory(a))[0].app_session_id,f.id);
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[p]);assert.deepEqual(await inventory(a),[]);assert.deepEqual((await client.query('SELECT to_jsonb(r) AS row FROM crest_private.provider_cleanup_references r WHERE app_session_id=$1',[f.id])).rows,before);assert.equal(before[0].row.state,'review_required');
});
test('expired local sessions, epoch changes and disabled actors stay visible as separate metadata',async()=>{
  const a=await actor();await membership(a);const p=await provider(a),f=await register(a,p,{expired:true});await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,disabled_at=clock_timestamp(),version=version+1 WHERE id=$2',[randomUUID(),a.id]);
  const [r]=await inventory(a);assert.equal(r.app_session_id,f.id);assert(r.local_expires_at<r.observed_at);assert.equal(r.local_epoch_current,false);assert.equal(r.actor_disabled,true);assert.equal(r.provider_unexpired,true);assert.equal(r.local_revoked_at,null);
});
test('unknown, system and non-UUID provider subjects fail with the same binding error',async()=>{
  const malformed=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic non-UUID owner',$1,'not-a-uuid',$2,$2,'manual') RETURNING id",[issuer,bootstrap])).rows[0];
  for(const id of [randomUUID(),bootstrap,malformed.id])await assert.rejects(inventory({id}),e=>e.code==='42501'&&e.message==='CREST_INVENTORY_BINDING_REQUIRED');
});
test('repeatable snapshots cannot masquerade as a fresh maintenance observation',async()=>{
  await maintenance.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(inventory(),e=>e.code==='25001');}finally{await maintenance.query('ROLLBACK');}
  await maintenance.query('BEGIN READ ONLY');try{assert((await inventory()).length>0);}finally{await maintenance.query('ROLLBACK');}
});
test('ordinary runtimes cannot execute or assume either maintenance role',async()=>{
  for(const role of ['crest_web','crest_worker','crest_recovery','anon','authenticated','service_role','crest_session_owner','crest_auth_reader']){
    assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,fn])).rows[0].allowed,false);
    for(const targetRole of ['crest_inventory','crest_inventory_owner'])assert.equal((await client.query("SELECT pg_has_role($1,$2,'MEMBER') AS allowed",[role,targetRole])).rows[0].allowed,false);
  }
  await asRole('crest_web',async()=>{await assert.rejects(inventory(owner,null,1,issuer,client),e=>e.code==='42501');});
  await assert.rejects(maintenance.query('SET ROLE crest_inventory_owner'),e=>e.code==='42501');
});
test('caller has no raw data; definer has exactly safe column reads and no writes or CREATE',async()=>{
  const columns={'auth.sessions':['id','user_id','not_after','aal'],'crest_private.actors':['id','kind','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at'],'crest_private.app_sessions':['id','actor_id','provider_session_id','issued_security_epoch','expires_at','revoked_at'],'crest_private.provider_cleanup_references':['id','app_session_id','actor_id','provider_session_id']};
  for(const role of ['crest_inventory','crest_inventory_owner']){
    const r=(await client.query('SELECT * FROM pg_roles WHERE rolname=$1',[role])).rows[0];for(const key of ['rolcanlogin','rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(r[key],false);assert.equal(r.rolconfig,null);
    for(const schema of ['auth','crest','crest_private','crest_commands','public'])assert.equal((await client.query("SELECT has_schema_privilege($1,$2,'CREATE') AS allowed",[role,schema])).rows[0].allowed,false);
    for(const table of tables){assert.equal((await client.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege($1,$2,'INSERT,UPDATE,REFERENCES') AS allowed",[role,table])).rows[0].allowed,false);
      const actual=(await client.query("SELECT attname FROM pg_attribute WHERE attrelid=$2::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege($1,attrelid,attnum,'SELECT') ORDER BY attname",[role,table])).rows.map(r=>r.attname);assert.deepEqual(actual,role==='crest_inventory_owner'?(columns[table]??[]).toSorted():[]);}
  }
  assert.deepEqual((await client.query('SELECT prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0],{prosecdef:true,provolatile:'s',proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner:'crest_inventory_owner'});
  for(const table of Object.keys(columns))await asRole('crest_inventory_owner',async()=>{await assert.rejects(client.query(`DELETE FROM ${table}`),e=>e.code==='42501');});
});
test('hostile search_path and temporary names cannot redirect the fixed reader',async()=>{
  const before=await digest();await maintenance.query("SET search_path=pg_temp,public; CREATE TEMP TABLE app_sessions(id uuid); CREATE TEMP TABLE actors(id uuid); CREATE TEMP TABLE sessions(id uuid)");
  try{assert((await inventory()).some(r=>r.app_session_id===legacy.id));}finally{await maintenance.query('RESET search_path');}assert.equal(await digest(),before);
});
test('fresh schema17 targets reject each role drift and retain failed-attempt review barriers',async()=>{
  await sandbox.admin.query(`REVOKE crest_inventory FROM ${login}`);
  try{
    for(const [change,restore] of [
      ['ALTER ROLE crest_inventory_owner INHERIT','ALTER ROLE crest_inventory_owner NOINHERIT'],
      ['GRANT crest_inventory_owner TO crest_inventory','REVOKE crest_inventory_owner FROM crest_inventory'],
      ['ALTER DEFAULT PRIVILEGES FOR ROLE crest_inventory_owner GRANT EXECUTE ON ROUTINES TO crest_inventory','ALTER DEFAULT PRIVILEGES FOR ROLE crest_inventory_owner REVOKE EXECUTE ON ROUTINES FROM crest_inventory'],
      ['GRANT SELECT ON auth.users TO crest_inventory_owner','REVOKE SELECT ON auth.users FROM crest_inventory_owner']
    ]){
      const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const before=await sandbox.apply(t,await sandbox.prefix(17));
      await c.query(change);try{await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);}finally{await c.query(restore);}
      assert.equal((await c.query("SELECT to_regprocedure('crest_commands.provider_session_inventory(uuid,text,uuid,integer)') AS fn")).rows[0].fn,null);
      assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,before.history.length);
      await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);
    }
  }finally{await sandbox.admin.query(`GRANT crest_inventory TO ${login}`);}
});
test('incompatible provider RLS aborts without repairing state or replaying the failed target',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(17));
  await c.query('ALTER TABLE auth.sessions DISABLE ROW LEVEL SECURITY');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
  assert.equal((await c.query("SELECT relrowsecurity FROM pg_class WHERE oid='auth.sessions'::regclass")).rows[0].relrowsecurity,false);
  assert.equal((await c.query("SELECT to_regprocedure('crest_commands.provider_session_inventory(uuid,text,uuid,integer)') AS fn")).rows[0].fn,null);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,17);
  await c.query('ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY');await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);
});
