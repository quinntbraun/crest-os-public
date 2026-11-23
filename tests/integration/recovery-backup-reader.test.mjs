import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {prepareCurrentOriginalSources} from '../support/current-original-sources.mjs';
import {keyPair,privateWorkspace,postgresTool,recoveryCluster,run,inventory,roleDefinitions} from '../support/recovery-drill.mjs';
import {createRecoveryDatabaseCapture} from '../../src/tooling/recovery-database-capture.ts';
import {withRecoveryBackupLease} from '../../src/tooling/recovery-backup-lease.ts';
import {verifyRecoveryBackupReader} from '../../src/tooling/recovery-backup-reader.ts';

const root=new URL('../../',import.meta.url),registry=JSON.parse(await readFile(new URL('supabase/migration-checksums.json',root),'utf8')),pins=JSON.parse(await readFile(new URL('release/toolchain.json',root),'utf8')),age=fileURLToPath(new URL('.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''),root)),proposal=await readFile(new URL('planning/proposals/recovery-backup-reader.sql',root),'utf8');
const expected=registry.migrations.map(entry=>({version:entry.version,name:entry.file.slice(15,-4)})),signal=()=>new AbortController().signal;

test('Unregistered137 full backup reader: limited login, protected source and independent encrypted restoration',{timeout:240000},async t=>{
 let sandbox,admin,reader,restrictedWeb,workspace,destination,backupLogin,webLogin,groupCreated=false;const containers=new Set();
 const launch=(command,args,environment)=>{
  if(command==='age')return spawn(age,args,{env:{...environment,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const name='crest-reader-dump-'+randomUUID();containers.add(name);const env={...environment,NODE_ENV:'test',...(process.platform==='win32'&&environment.PGHOST?{PGHOST:'host.docker.internal'}:{})};
  return spawn('docker',['run','--rm','--name',name,...(process.platform==='win32'?[]:['--network','host']),...Object.keys(env).filter(key=>key.startsWith('PG')).flatMap(key=>['--env',key]),pins.testDatabaseImage,'pg_dump',...args],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
 };
 try{
  sandbox=await migrationSandbox();const database=await sandbox.database();admin=await sandbox.connect(database);await sandbox.apply(database,await sandbox.prefix(0),true);await installProviderSchema(admin,database);await sandbox.apply(database,await sandbox.prefix(137));
  const web=await sandbox.connect(database);await web.query('SET ROLE crest_web');const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id,seed=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await seed(),other=await seed();
  const bytes=await sharp({create:{width:1,height:1,channels:3,background:'#304b68'}}).png().toBuffer(),preview=await sharp(bytes).jpeg().toBuffer();await prepareCurrentOriginalSources({sandbox,database,admin,web,owner,bytes,preview});
  const baseRoles=await roleDefinitions(admin),baseOrder=(await admin.query("SELECT rolname FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' ORDER BY oid")).rows.map(row=>row.rolname);
  const policies=(await admin.query("SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,p.polname,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS check FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_policy p ON p.polrelid=c.oid WHERE n.nspname IN('crest','crest_private') ORDER BY n.nspname,c.relname,p.polname")).rows;
  await t.test('proposal refuses adoption and adds only the dedicated read role',async()=>{await sandbox.applyHeldSql(admin,proposal);groupCreated=true;await assert.rejects(sandbox.applyHeldSql(admin,proposal),{code:'42501'});assert.deepEqual((await admin.query("SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,p.polname,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS check FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_policy p ON p.polrelid=c.oid WHERE n.nspname IN('crest','crest_private') ORDER BY n.nspname,c.relname,p.polname")).rows,policies);});
  const password=randomBytes(32).toString('hex');backupLogin='crest_backup_test_'+randomBytes(8).toString('hex');webLogin='crest_backup_web_'+randomBytes(8).toString('hex');
  for(const [login,group]of [[backupLogin,'crest_backup_reader'],[webLogin,'crest_web']]){await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT '+group+' TO '+login+' WITH INHERIT FALSE,SET TRUE');}
  const target=new URL(database);target.username=backupLogin;target.password=password;reader=new pg.Client({connectionString:target.toString(),options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:6000});await reader.connect();
  const webTarget=new URL(database);webTarget.username=webLogin;webTarget.password=password;restrictedWeb=new pg.Client({connectionString:webTarget.toString(),options:'-c role=crest_web',connectionTimeoutMillis:5000,query_timeout:6000});await restrictedWeb.connect();
  await t.test('preflight accepts exact closed reader and refuses web and administrator identities',async()=>{assert.equal((await verifyRecoveryBackupReader(reader,expected)).sourceSchemaVersion,137);await assert.rejects(verifyRecoveryBackupReader(restrictedWeb,expected));await assert.rejects(verifyRecoveryBackupReader(admin,expected));await assert.rejects(verifyRecoveryBackupReader(reader,expected.slice(0,-1)));});
  await t.test('reader preserves both businesses but cannot mutate records, sequence or authority',async()=>{
   assert.equal((await reader.query('SELECT count(*)::int AS n FROM crest.businesses WHERE id=ANY($1::uuid[])',[[owner.business,other.business]])).rows[0].n,2);
   for(const sql of ['DELETE FROM crest.customers WHERE false','TRUNCATE crest.jobs','CREATE TABLE crest.backup_probe(id integer)','SET ROLE crest_command_owner','SELECT * FROM pg_authid'])await assert.rejects(reader.query(sql),{code:'42501'});
   await assert.rejects(restrictedWeb.query('SET ROLE crest_backup_reader'),{code:'42501'});await assert.rejects(restrictedWeb.query('SELECT * FROM crest.customers'),{code:'42501'});
   assert.equal((await reader.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')")).rows[0].n,0);
  });
  const originalInventory=await inventory(admin);workspace=await privateWorkspace();const keys=await keyPair(workspace),capture=createRecoveryDatabaseCapture(launch);
  const result=await withRecoveryBackupLease(reader,owner.business,signal(),lease=>lease.capture(async snapshot=>{assert.deepEqual(await inventory({query:snapshot.query}),originalInventory);return capture({environment:'test',connectionString:target.toString(),rootCertificate:null,workspace,snapshot,recipient:keys.recipient},lease.signal);}));reader=undefined;
  await t.test('restricted pg_dump/age archive contains every source row without administrator fallback',async()=>{
   const evidence=result.value.forRecoveryTools();assert.equal(evidence.databaseRole,'crest_backup_reader');assert.equal(evidence.completeBackup,false);
   const cipher=await readFile(evidence.path),plain=await run(age,['--decrypt','--identity',keys.path],{input:cipher});destination=await recoveryCluster();const restored=await destination.database(),connection=new pg.Client({connectionString:restored});await connection.connect();try{
    for(const name of baseOrder){assert.match(name,/^crest_[a-z_]+$/);assert(baseRoles.some(role=>role.rolname===name));await connection.query('CREATE ROLE '+name+' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');}
    await connection.query('CREATE ROLE crest_backup_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS');
    await postgresTool('pg_restore',restored,['--exit-on-error','--single-transaction'],plain);plain.fill(0);assert.deepEqual(await inventory(connection),originalInventory);
    assert.equal((await connection.query("SELECT rolbypassrls AND NOT(rolsuper OR rolcanlogin OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication) AS valid FROM pg_roles WHERE rolname='crest_backup_reader'")).rows[0].valid,true);
    const freshLogin='crest_restored_backup_'+randomBytes(8).toString('hex'),freshPassword=randomBytes(32).toString('hex');await connection.query('CREATE ROLE '+freshLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+freshPassword+"'");await connection.query('GRANT crest_backup_reader TO '+freshLogin+' WITH INHERIT FALSE,SET TRUE');
    const recoveredUrl=new URL(restored);recoveredUrl.username=freshLogin;recoveredUrl.password=freshPassword;const recoveredReader=new pg.Client({connectionString:recoveredUrl.toString(),options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:6000});await recoveredReader.connect();try{await verifyRecoveryBackupReader(recoveredReader,expected);assert.deepEqual(await inventory(recoveredReader),originalInventory);await assert.rejects(recoveredReader.query('DELETE FROM crest.customers WHERE false'),{code:'42501'});}finally{await recoveredReader.end();}
   }finally{plain.fill(0);await connection.end();}
  });
  assert.deepEqual(await inventory(admin),originalInventory);
 }finally{
  for(const name of containers){assert.match(name,/^crest-reader-dump-[a-f0-9-]{36}$/);await run('docker',['rm','--force',name]).catch(()=>{});}
  await reader?.end();await restrictedWeb?.end();await destination?.close();
  if(sandbox){for(const login of[backupLogin,webLogin])if(login){assert.match(login,/^crest_backup_(?:test|web)_[a-f0-9]{16}$/);await sandbox.admin.query('DROP ROLE '+login);}if(groupCreated){await admin.query('DROP OWNED BY crest_backup_reader');await sandbox.admin.query('DROP ROLE crest_backup_reader');}await sandbox.close();}
  if(workspace){assert.equal(dirname(resolve(workspace)),resolve(fileURLToPath(new URL('.local/recovery-drill/',root))));await rm(workspace,{recursive:true,force:true});}
 }
});
