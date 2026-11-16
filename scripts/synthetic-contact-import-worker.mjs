// A dedicated worker credential for an explicitly selected fictional workspace.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

const failure='SYNTHETIC_CONTACT_IMPORT_WORKER_REVIEW_REQUIRED';
const role='crest_legacy_contact_dispatch';
const version='20270109180000';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const routines=[
 'crest_commands.claim_legacy_contact_application(uuid)',
 'crest_commands.run_claimed_legacy_contact_application(uuid)',
 'crest_commands.release_legacy_contact_application(uuid)',
];

function workspace(directory,state,administrator){
 const url=new URL(administrator);
 assert(state.schemaVersion===1&&/^[a-f0-9]{16}$/.test(state.id)&&uuid.test(state.businessId)&&
  state.databaseName==='crest_migrate_'+state.id&&url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&
  url.username==='supabase_admin'&&url.password&&url.pathname==='/'+state.databaseName&&!url.search&&!url.hash,failure);
 return {url,login:'crest_contact_local_'+state.id,path:join(directory,'contact-import-worker.json')};
}

async function requireSchema(db,state){
 const {rows:[scope]}=await db.query(`SELECT current_database()=$1 AND current_user='supabase_admin'
  AND EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version=$2)
  AND EXISTS(SELECT FROM crest.businesses WHERE id=$3)
  AND NOT has_function_privilege('crest_web',to_regprocedure(
   'crest_commands.apply_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)'),'EXECUTE')
  AND NOT has_function_privilege($4::name,to_regprocedure('crest_commands.run_next_legacy_contact_application()'),'EXECUTE')
  AND (SELECT bool_and(coalesce(has_function_privilege($4::name,oid,'EXECUTE') AND
   NOT has_function_privilege('crest_web',oid,'EXECUTE'),false))
   FROM (SELECT to_regprocedure(signature) AS oid FROM unnest($5::text[]) AS signatures(signature)) commands) AS allowed`,
  [state.databaseName,version,state.businessId,role,routines]);
 assert.equal(scope?.allowed,true,failure);
}

async function credentials(path,state){
 const info=await lstat(path);
 assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=4096&&
  (process.platform==='win32'||(info.mode&0o077)===0),failure);
 const value=JSON.parse(await readFile(path,'utf8'));
 assert.deepEqual(Object.keys(value).sort(),['businessId','formatVersion','password','workspaceId']);
 assert(value.formatVersion===1&&value.workspaceId===state.id&&value.businessId===state.businessId&&
  typeof value.password==='string'&&/^[a-f0-9]{64}$/.test(value.password),failure);
 return value;
}

async function workerConnection({url,login},secret){
 const worker=new URL(url);
 worker.username=login;worker.password=secret.password;
 const db=new pg.Client({connectionString:worker.href,options:'-c role='+role,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await db.connect();
  const {rows:[scope]}=await db.query(`SELECT session_user=$1::name AND executor.rolname=current_user
   AND login.rolcanlogin AND NOT(login.rolinherit OR login.rolsuper OR login.rolcreatedb OR login.rolcreaterole OR login.rolreplication OR login.rolbypassrls)
   AND NOT(executor.rolcanlogin OR executor.rolinherit OR executor.rolsuper OR executor.rolcreatedb OR executor.rolcreaterole OR executor.rolreplication OR executor.rolbypassrls)
   AND (SELECT count(*) FROM pg_auth_members WHERE member=login.oid)=1
   AND EXISTS(SELECT FROM pg_auth_members WHERE member=login.oid AND roleid=executor.oid AND set_option AND NOT(admin_option OR inherit_option))
   AND NOT EXISTS(SELECT FROM pg_auth_members WHERE member=executor.oid)
   AND NOT has_schema_privilege(current_user,'crest_private','USAGE') AS allowed
   FROM pg_roles login CROSS JOIN pg_roles executor
   WHERE login.rolname=session_user AND executor.rolname=$2::name`,[login,role]);
  assert.equal(scope?.allowed,true,failure);
  return Object.freeze({connectionString:worker.href});
 }finally{await db.end().catch(()=>undefined);}
}

export async function prepareSyntheticContactImportWorker(directory,state,administrator){
 const config=workspace(directory,state,administrator);
 const db=new pg.Client({connectionString:config.url.href,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await db.connect();
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['crest-contact-worker:'+state.id]);
  await requireSchema(db,state);
  const exists=(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[config.login])).rowCount===1;
  let secret;
  try{secret=await credentials(config.path,state);}
  catch(error){
   if(error.code!=='ENOENT'||exists)throw error;
   secret={formatVersion:1,workspaceId:state.id,businessId:state.businessId,password:randomBytes(32).toString('hex')};
   await writeFile(config.path,JSON.stringify(secret)+'\n',{flag:'wx',mode:0o600});
  }
  if(!exists){
   await db.query(`CREATE ROLE ${config.login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret.password}'`);
   await db.query('GRANT '+role+' TO '+config.login+' WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
  }
  await db.query('COMMIT');
  return await workerConnection(config,secret);
 }catch{
  await db.query('ROLLBACK').catch(()=>undefined);
  throw Error(failure);
 }finally{await db.end().catch(()=>undefined);}
}

export async function readSyntheticContactImportWorker(directory,state,administrator){
 const config=workspace(directory,state,administrator);
 const db=new pg.Client({connectionString:config.url.href,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await db.connect();
  await requireSchema(db,state);
  return await workerConnection(config,await credentials(config.path,state));
 }catch{throw Error(failure);}
 finally{await db.end().catch(()=>undefined);}
}
