import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile,readdir,lstat,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {privateWorkspace} from '../support/recovery-drill.mjs';
import {exerciseOperatorSources} from '../support/operator-source-fixture.mjs';

test('private operator command delivers exact files through a real restricted database login',{timeout:120000},async()=>{
 assert.equal(process.env.CREST_ENV,'test');let sandbox,workspace,login;
 try{
  sandbox=await migrationSandbox();const database=await sandbox.database(),admin=await sandbox.connect(database);await sandbox.apply(database,await sandbox.prefix(0),true);await installProviderSchema(admin,database);await sandbox.apply(database,await sandbox.prefix(138));
  const web=await sandbox.connect(database);await web.query('SET ROLE crest_web');const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id,seed=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await seed(),other=await seed();
  const password=randomBytes(32).toString('hex');login='crest_operator_test_'+randomBytes(8).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_backup_reader TO '+login+' WITH INHERIT FALSE,SET TRUE');
  const target=new URL(database);target.username=login;target.password=password;const createReader=async()=>{const client=new pg.Client({connectionString:target.toString(),options:'-c role=crest_backup_reader',connectionTimeoutMillis:5000,query_timeout:6000});await client.connect();return client;};
  const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8')),migrations=registry.migrations.map(row=>({version:row.version,name:row.file.slice(15,-4)})),proof=await exerciseOperatorSources({admin,owner,other,migrations,createReader,createForbiddenReader:()=>sandbox.connect(database)});
  workspace=await privateWorkspace();const request={schemaVersion:1,leaseBusinessId:owner.business,databaseUrl:target.toString(),rootCertificateFile:null,outputParent:workspace},requestFile=join(workspace,'request-'+randomUUID()+'.json');await writeFile(requestFile,JSON.stringify(request),{flag:'wx',mode:0o600});
  async function command(args){const env={CREST_ENV:'test'};for(const name of['PATH','SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name];const child=spawn(process.execPath,['--conditions=react-server','scripts/operator-source-export.mjs',...args],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;if(stdout.length>16384)child.kill('SIGKILL');});child.stderr.on('data',part=>{stderr+=part;if(stderr.length>16384)child.kill('SIGKILL');});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return{code,stdout,stderr};}
  const result=await command([requestFile]);assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');assert(!result.stdout.includes(password));const delivery=JSON.parse(result.stdout);assert.equal(delivery.scope,'instance_operator');assert.equal(delivery.fileCount,13);assert.equal(delivery.recordCount,proof.recordCount);assert.equal(delivery.completePortableExport,false);assert.equal(delivery.completeBackup,false);assert.equal(dirname(resolve(delivery.directory)),resolve(workspace));assert(basename(delivery.directory).startsWith('crest-operator-export-'));
  const actual=(await readdir(delivery.directory)).sort();assert.deepEqual(actual,Object.keys(proof.expectedFiles).sort());for(const name of actual){const bytes=await readFile(join(delivery.directory,name));if(name!=='operator_manifest.json')assert.deepEqual(bytes,Buffer.from(proof.expectedFiles[name]));if(process.platform==='linux')assert.equal((await lstat(join(delivery.directory,name))).mode&0o077,0);}
  assert.equal(createHash('sha256').update(await readFile(join(delivery.directory,'operator_manifest.json'))).digest('hex'),delivery.manifestSha256);
  const before=(await readdir(workspace)).sort();for(const args of[[requestFile,'extra'],[]]){const rejected=await command(args);assert.equal(rejected.code,1);assert.equal(rejected.stdout,'');assert.equal(rejected.stderr,'OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED\n');assert.deepEqual((await readdir(workspace)).sort(),before);}
  const badFile=join(workspace,'bad-'+randomUUID()+'.json');await writeFile(badFile,JSON.stringify({...request,databaseUrl:request.databaseUrl+'?sslmode=disable'}),{flag:'wx',mode:0o600});const rejected=await command([badFile]);assert.equal(rejected.code,1);assert.equal(rejected.stdout,'');assert.equal(rejected.stderr,'OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED\n');assert(!rejected.stderr.includes(password));
 }finally{
  if(workspace){const path=resolve(workspace);assert.equal(dirname(path),resolve('.local/recovery-drill'));assert(basename(path).startsWith('case-'));await rm(path,{recursive:true,force:true});}
  if(sandbox){if(login){assert.match(login,/^crest_operator_test_[a-f0-9]{16}$/);await sandbox.admin.query('DROP ROLE '+login);}await sandbox.close();}
 }
});
