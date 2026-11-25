import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {spawn} from 'node:child_process';
import {readFile,readdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {keyPair,privateWorkspace,postgresTool,recoveryCluster,run} from '../support/recovery-drill.mjs';
import {assertPrivateRecoveryArtifact} from '../support/private-recovery-permissions.mjs';
import {withRecoveryBackupLease} from '../../src/tooling/recovery-backup-lease.ts';
import {createRecoveryDatabaseCapture} from '../../src/tooling/recovery-database-capture.ts';

const root=new URL('../../',import.meta.url),pins=JSON.parse(await readFile(new URL('release/toolchain.json',root),'utf8')),age=fileURLToPath(new URL('.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''),root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),signal=()=>new AbortController().signal,containers=new Set(),calls=[];let sandbox,url,admin,workspace,keys,destination;
async function client(){const value=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:6000});await value.connect();return value;}
function launch(command,args,environment){
 calls.push({command,args:[...args]});assert.equal(environment.GITHUB_TOKEN,undefined);assert(!args.some(arg=>arg.includes(url)));
 if(command==='age')return spawn(age,args,{env:{...environment,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});
 const name='crest-dump-'+randomUUID();containers.add(name);const env={...environment,NODE_ENV:'test',...(process.platform==='win32'&&environment.PGHOST?{PGHOST:'host.docker.internal'}:{})};
 return spawn('docker',['run','--rm','--name',name,...(process.platform==='win32'?[]:['--network','host']),...Object.keys(env).filter(key=>key.startsWith('PG')).flatMap(key=>['--env',key]),pins.testDatabaseImage,'pg_dump',...args],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
}
const capture=createRecoveryDatabaseCapture(launch);
const input=snapshot=>({environment:'test',connectionString:url,rootCertificate:null,workspace,snapshot,recipient:keys.recipient});
before(async()=>{
 sandbox=await migrationSandbox();url=await sandbox.database();admin=await sandbox.connect(url);workspace=await privateWorkspace();keys=await keyPair(workspace);
 await admin.query("CREATE SEQUENCE public.recovery_dump_seq AS bigint START 9007199254740993; CREATE TABLE public.recovery_dump_fixture(id bigint PRIMARY KEY DEFAULT nextval('public.recovery_dump_seq'),amount numeric(20,0) NOT NULL CHECK(amount>=0),at timestamptz NOT NULL,bytes bytea NOT NULL,note text NOT NULL); CREATE FUNCTION public.recovery_dump_value() RETURNS bigint LANGUAGE sql IMMUTABLE AS 'SELECT 9007199254740993::bigint'");
 await admin.query('INSERT INTO public.recovery_dump_fixture(amount,at,bytes,note) VALUES($1,$2,$3,$4)',['90071992547409931234','2026-11-22T12:34:56.123456Z',Buffer.from([0,255,17]),'Private fictional é 😀\nquotes " \\N']);
});
after(async()=>{
 for(const name of containers){assert.match(name,/^crest-dump-[a-f0-9-]{36}$/);await run('docker',['rm','--force',name]).catch(()=>{});}
 await destination?.close();await sandbox?.close();if(workspace){assert.equal(dirname(resolve(workspace)),resolve(fileURLToPath(new URL('.local/recovery-drill/',root))));await rm(workspace,{recursive:true,force:true});}
});
test('held snapshot streams straight into age and independently restores exact PostgreSQL values',async()=>{
 const expected=(await admin.query('SELECT id::text,amount::text,at::text,encode(bytes,\'hex\') AS bytes,note FROM public.recovery_dump_fixture ORDER BY id')).rows;
 const result=await withRecoveryBackupLease(await client(),randomUUID(),signal(),lease=>lease.capture(async snapshot=>{
  const before=(await snapshot.query('SELECT count(*)::int AS n FROM public.recovery_dump_fixture')).rows[0].n;assert.equal(before,1);
  await admin.query('INSERT INTO public.recovery_dump_fixture VALUES($1,$2,$3,$4,$5)',['9007199254740994','1','2026-11-22T13:00:00Z',Buffer.from('later'),'after snapshot']);
  const value=await capture(input(snapshot),signal());assert.throws(()=>JSON.stringify(value));return value;
 }));
 const value=result.value.forRecoveryTools(),encrypted=await readFile(value.path),ageHeader=Buffer.from('age-encryption.org/v1\n');assert(encrypted.subarray(0,ageHeader.length).equals(ageHeader));assert.equal(sha(encrypted),value.ciphertext.sha256);assert.equal(encrypted.length,value.ciphertext.byteSize);assert.equal(value.snapshotId,result.snapshot.id);assert.equal(value.completeBackup,false);await assertPrivateRecoveryArtifact(value.path);
 const decrypted=await run(age,['--decrypt','--identity',keys.path],{input:encrypted});assert(decrypted.subarray(0,5).equals(Buffer.from('PGDMP')));assert.equal(sha(decrypted),value.plaintext.sha256);assert.equal(decrypted.length,value.plaintext.byteSize);
 destination=await recoveryCluster();const restored=await destination.database();await postgresTool('pg_restore',restored,['--exit-on-error','--single-transaction'],decrypted);decrypted.fill(0);
 const connection=new pg.Client({connectionString:restored});await connection.connect();try{
  assert.deepEqual((await connection.query('SELECT id::text,amount::text,at::text,encode(bytes,\'hex\') AS bytes,note FROM public.recovery_dump_fixture ORDER BY id')).rows,expected);assert.equal((await connection.query('SELECT public.recovery_dump_value()::text AS value')).rows[0].value,'9007199254740993');assert.equal((await connection.query('SELECT last_value::text AS value FROM public.recovery_dump_seq')).rows[0].value,'9007199254740993');await assert.rejects(connection.query("INSERT INTO public.recovery_dump_fixture(amount,at,bytes,note) VALUES(-1,now(),''::bytea,'invalid')"),{code:'23514'});
 }finally{await connection.end();}
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.recovery_dump_fixture')).rows[0].n,2);assert.equal(calls.filter(call=>call.command==='pg_dump'&&call.args.some(arg=>arg==='--snapshot='+value.snapshotId)).length,1);assert((await readdir(workspace)).every(name=>name.endsWith('.age')||name.startsWith('key-')));
});
test('forged, foreign-source and expired snapshot references fail before any process starts',async()=>{
 let saved;await withRecoveryBackupLease(await client(),randomUUID(),signal(),lease=>lease.capture(async snapshot=>{saved=snapshot;const count=calls.length;await assert.rejects(capture(input({...snapshot}),signal()));const other=new URL(url);other.port=String(Number(other.port)+1);await assert.rejects(capture({...input(snapshot),connectionString:other.toString()},signal()));assert.equal(calls.length,count);}));const count=calls.length;await assert.rejects(capture(input(saved),signal()));assert.equal(calls.length,count);
});
test('invalid age recipient fails the attempt, closes owned processes and removes partial output',async()=>{
 const before=await readdir(workspace);await assert.rejects(withRecoveryBackupLease(await client(),randomUUID(),signal(),lease=>lease.capture(snapshot=>capture({...input(snapshot),recipient:'age1'+'q'.repeat(58)},signal()))));assert.deepEqual(await readdir(workspace),before);
});
