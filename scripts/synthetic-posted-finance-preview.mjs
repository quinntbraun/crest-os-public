// Explicit local fictional export credential. The owner preview launchers keep
// this capability closed unless the verified build and private login are supplied.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

const failure='SYNTHETIC_POSTED_FINANCE_EXPORT_REVIEW_REQUIRED';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const routines=[
 'crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)',
 'crest_commands.record_posted_finance_export_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text,text,text,integer)',
 'crest_commands.service_refund_source_snapshot(uuid)',
];

function workspaceTarget(state,administrator){
 const url=new URL(administrator);
 assert(state.schemaVersion===1&&/^[a-f0-9]{16}$/.test(state.id)&&uuid.test(state.businessId)&&uuid.test(state.owner?.subject)
  &&state.databaseName==='crest_migrate_'+state.id&&state.issuer==='http://127.0.0.1:54328/auth/v1'
  &&url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.username==='supabase_admin'&&url.password
  &&url.pathname==='/'+state.databaseName&&!url.search&&!url.hash,failure);
 return {url,login:'crest_export_local_'+state.id};
}

async function privateJson(path){
 const info=await lstat(path);
 assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=4096
  &&(process.platform==='win32'||(info.mode&0o077)===0),failure);
 return JSON.parse(await readFile(path,'utf8'));
}

async function requireRegisteredExport(client,state,versions){
 const installed=(await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version);
 assert.deepEqual(installed,versions,failure);
 const {rows:[capability]}=await client.query(`SELECT
  EXISTS(SELECT 1 FROM crest.memberships m JOIN crest_private.actors a ON a.id=m.actor_id
    JOIN crest_private.business_recovery_authorities r ON r.business_id=m.business_id
    WHERE m.business_id=$1 AND m.active AND m.role='owner' AND a.auth_provider_issuer=$2 AND a.auth_user_id=$3) AS owner,
  to_regprocedure($4) IS NOT NULL AND to_regprocedure($5) IS NOT NULL AND to_regprocedure($6) IS NOT NULL
   AND has_function_privilege('crest_web',to_regprocedure($4),'EXECUTE') AND has_function_privilege('crest_web',to_regprocedure($5),'EXECUTE')
   AND NOT has_function_privilege('crest_export',to_regprocedure($4),'EXECUTE') AND NOT has_function_privilege('crest_export',to_regprocedure($5),'EXECUTE')
   AND has_function_privilege('crest_export',to_regprocedure($6),'EXECUTE') AND NOT has_function_privilege('crest_web',to_regprocedure($6),'EXECUTE') AS grants`,
  [state.businessId,state.issuer,state.owner.subject,...routines]);
 assert.deepEqual(capability,{owner:true,grants:true},failure);
 if(versions.includes('20261217180000')){
  const {rows:[returned]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.excess_return_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.excess_return_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(returned.granted,true,failure);
 }
 if(versions.includes('20261218180000')){
  const {rows:[returned]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.tip_return_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.tip_return_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(returned.granted,true,failure);
 }
 if(versions.includes('20261219180000')){
  const {rows:[collection]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.collection_failure_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.collection_failure_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(collection.granted,true,failure);
 }
 if(versions.includes('20261220180000')){
  const {rows:[transfer]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.refund_transfer_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.refund_transfer_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(transfer.granted,true,failure);
 }
 if(versions.includes('20261221180000')){
  const {rows:[receiptTip]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.direct_receipt_tip_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.direct_receipt_tip_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(receiptTip.granted,true,failure);
 }
 if(versions.includes('20261222180000')){
  const {rows:[refundFee]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.refund_transfer_fee_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.refund_transfer_fee_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(refundFee.granted,true,failure);
 }
 if(versions.includes('20261223180000')){
  const {rows:[recredit]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.collection_failure_recredit_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.collection_failure_recredit_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(recredit.granted,true,failure);
 }
 if(versions.includes('20261224180000')){
  const {rows:[grouped]}=await client.query(`SELECT coalesce(
   has_function_privilege('crest_export',to_regprocedure('crest_commands.collection_failure_grouped_recredit_source_snapshot(uuid)'),'EXECUTE')
   AND NOT has_function_privilege('crest_web',to_regprocedure('crest_commands.collection_failure_grouped_recredit_source_snapshot(uuid)'),'EXECUTE'),false) AS granted`);
  assert.equal(grouped.granted,true,failure);
 }
}

async function registryVersions(root){
 const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));
 const versions=registry.migrations.map(entry=>entry.version);
 assert.equal(versions[88],'20261213180000',failure);
 return versions;
}

async function verifiedSource(root){
 const build=await privateJson(join(root,'.local','build-verification.json'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
 assert(/^[a-f0-9]{40}$/.test(build.publicCommit)&&git(['rev-parse','HEAD'])===build.publicCommit
  &&git(['rev-parse','HEAD^{tree}'])===build.tree&&build.productionBuildPassed===true&&build.serverBuildPassed===true,failure);
 git(['diff','--quiet','HEAD','--']);
 assert.equal(hash(await readFile(join(root,'.local','server','application.mjs'))),build.serverSha256,failure);
 assert.equal((await readFile(join(root,'.next','BUILD_ID'),'utf8')).trim(),build.buildId,failure);
 return build.publicCommit;
}

async function credentials(path,state){
 const value=await privateJson(path);
 assert.deepEqual(Object.keys(value).sort(),['businessId','formatVersion','password','workspaceId']);
 assert(value.formatVersion===1&&value.workspaceId===state.id&&value.businessId===state.businessId
  &&typeof value.password==='string'&&/^[a-f0-9]{64}$/.test(value.password),failure);
 return value;
}

async function verifyExportLogin(url,login){
 const client=new pg.Client({connectionString:url.href,options:'-c role=crest_export',connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await client.connect();
  const {rows:[identity]}=await client.query(`SELECT current_user='crest_export' AND session_user=$1::name
   AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT(rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
   AND (SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user))=1
   AND EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_export'::regrole AND member=(SELECT oid FROM pg_roles WHERE rolname=session_user)
    AND NOT(admin_option OR inherit_option) AND set_option)
   AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_export'::regrole)
   AND (SELECT NOT has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='crest_private' AND c.relname='audit_events')
   AND NOT has_function_privilege(session_user,to_regprocedure($2),'EXECUTE')
   AND has_function_privilege(current_user,to_regprocedure($3),'EXECUTE') AS allowed`,[login,routines[0],routines[2]]);
  assert.equal(identity?.allowed,true,failure);
 }finally{await client.end().catch(()=>undefined);}
}

function exporterUrl(url,login,value){
 const exporter=new URL(url);
 exporter.username=login;
 exporter.password=value.password;
 return exporter;
}

export async function prepareSyntheticPostedFinancePreview({root,directory,state,administrator,db}){
 try{
  const {url,login}=workspaceTarget(state,administrator);
  const versions=await registryVersions(root);
  const {rows:[identity]}=await db.query('SELECT current_database() AS database,current_user AS role');
  assert.deepEqual(identity,{database:state.databaseName,role:'supabase_admin'},failure);
  const path=join(directory,'posted-finance-preview.json');
  let value;
  await db.query('BEGIN');
  try{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,89))',['crest-synthetic-posted-finance:'+state.id]);
   await requireRegisteredExport(db,state,versions);
   const exists=(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[login])).rowCount===1;
   try{value=await credentials(path,state);}catch(error){
    if(error.code!=='ENOENT'||exists)throw error;
    value={formatVersion:1,workspaceId:state.id,businessId:state.businessId,password:randomBytes(32).toString('hex')};
    await writeFile(path,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
   }
   if(exists)await verifyExportLogin(exporterUrl(url,login,value),login);
   else{
    await db.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${value.password}'`);
    await db.query('GRANT crest_export TO '+login+' WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
   }
   await db.query('COMMIT');
  }catch(error){
   await db.query('ROLLBACK').catch(()=>undefined);
   throw error;
  }
  await verifyExportLogin(exporterUrl(url,login,value),login);
 }catch{throw Error(failure);}
}

export async function readSyntheticPostedFinancePreview(root,directory,state,administrator){
 let client;
 try{
  const {url,login}=workspaceTarget(state,administrator);
  const versions=await registryVersions(root);
  const appReleaseId=await verifiedSource(root);
  const value=await credentials(join(directory,'posted-finance-preview.json'),state);
  client=new pg.Client({connectionString:url.href,connectionTimeoutMillis:5000,statement_timeout:5000});
  await client.connect();
  const {rows:[identity]}=await client.query('SELECT current_database() AS database,current_user AS role');
  assert.deepEqual(identity,{database:state.databaseName,role:'supabase_admin'},failure);
  await requireRegisteredExport(client,state,versions);
  const exporter=exporterUrl(url,login,value);
  await verifyExportLogin(exporter,login);
  return Object.freeze({connectionString:exporter.href,appReleaseId,sourceSchemaVersion:versions.length});
 }catch{throw Error(failure);}
 finally{await client?.end().catch(()=>undefined);}
}
