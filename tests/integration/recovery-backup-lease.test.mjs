import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {withRecoveryBackupLease} from '../../src/tooling/recovery-backup-lease.ts';
import {schemaMigrationLock} from '../../src/security/schema-migration-lock.ts';

let sandbox,url,admin;const business=randomUUID(),signal=()=>new AbortController().signal;
async function client(){const value=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:6000});await value.connect();return value;}
before(async()=>{sandbox=await migrationSandbox();url=await sandbox.database();admin=await sandbox.connect(url);await admin.query('CREATE TABLE public.recovery_lease_fixture(id integer PRIMARY KEY)');await admin.query('INSERT INTO public.recovery_lease_fixture VALUES(1)');});
after(async()=>{await sandbox?.close();});

test('one exported read-only snapshot survives concurrent writes and lease outlives capture',async()=>{
 const importer=await client(),migration=await client();let source;
 try{
  const capture=await withRecoveryBackupLease(await client(),business,signal(),async lease=>{
   const result=await lease.capture(async(snapshot,active)=>{
    source=snapshot;assert.equal(active.aborted,false);assert.equal((await snapshot.query('SELECT count(*)::int AS n FROM public.recovery_lease_fixture')).rows[0].n,1);
    await admin.query('INSERT INTO public.recovery_lease_fixture VALUES(2)');
    assert.equal((await snapshot.query('SELECT count(*)::int AS n FROM public.recovery_lease_fixture')).rows[0].n,1);
    await importer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await importer.query("SET TRANSACTION SNAPSHOT '"+snapshot.id+"'");assert.equal((await importer.query('SELECT count(*)::int AS n FROM public.recovery_lease_fixture')).rows[0].n,1);await importer.query('ROLLBACK');return'captured';
   });
   await assert.rejects(source.query('SELECT 1'));await assert.rejects(withRecoveryBackupLease(await client(),business,signal(),async()=>assert.fail('second same-business lease acquired')));
   assert.equal((await migration.query('SELECT pg_try_advisory_lock($1,$2) AS acquired',[...schemaMigrationLock])).rows[0].acquired,true);await migration.query('SELECT pg_advisory_unlock($1,$2)',[...schemaMigrationLock]);
   await withRecoveryBackupLease(await client(),randomUUID(),signal(),async other=>other.assertHeld());await lease.assertHeld();return result;
  });
  assert.equal(capture.value,'captured');assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.recovery_lease_fixture')).rows[0].n,2);
  await importer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assert.rejects(importer.query("SET TRANSACTION SNAPSHOT '"+capture.snapshot.id+"'"));await importer.query('ROLLBACK');
 }finally{await importer.end();await migration.end();}
});
test('capture refuses database writes even on the disposable administrative connection',async()=>{
 await assert.rejects(withRecoveryBackupLease(await client(),business,signal(),lease=>lease.capture(async snapshot=>snapshot.query('INSERT INTO public.recovery_lease_fixture VALUES(3)'))),{message:'RECOVERY_BACKUP_LEASE_REVIEW_REQUIRED'});assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.recovery_lease_fixture WHERE id=3')).rows[0].n,0);
});
test('schema coordinator lock prevents snapshot capture without waiting or running its reader',async()=>{
 const migration=await client();let ran=false;try{
  await migration.query('SELECT pg_advisory_lock($1,$2)',[...schemaMigrationLock]);await assert.rejects(withRecoveryBackupLease(await client(),business,signal(),lease=>lease.capture(async()=>{ran=true;})));assert.equal(ran,false);
 }finally{await migration.end();}
 await withRecoveryBackupLease(await client(),business,signal(),lease=>lease.capture(async snapshot=>(await snapshot.query('SELECT 1 AS n')).rows[0].n));
});
test('one lease cannot mix a second source snapshot into the same attempt',async()=>{
 await withRecoveryBackupLease(await client(),business,signal(),async lease=>{await lease.capture(async()=>null);let ran=false;await assert.rejects(lease.capture(async()=>{ran=true;}));assert.equal(ran,false);await lease.assertHeld();});
});
test('cancellation ends the owned connection and releases the business lock',async()=>{
 const controller=new AbortController();await assert.rejects(withRecoveryBackupLease(await client(),business,controller.signal,async lease=>{await lease.assertHeld();controller.abort();return'not-success';}),{message:'RECOVERY_BACKUP_LEASE_REVIEW_REQUIRED'});await withRecoveryBackupLease(await client(),business,signal(),lease=>lease.assertHeld());
});
test('terminated database session aborts the attempt and cannot report success',async()=>{
 const owned=await client(),pid=(await owned.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await assert.rejects(withRecoveryBackupLease(owned,business,signal(),async lease=>{await admin.query('SELECT pg_terminate_backend($1)',[pid]);if(!lease.signal.aborted)await new Promise(resolve=>lease.signal.addEventListener('abort',resolve,{once:true}));return'not-success';}),{message:'RECOVERY_BACKUP_LEASE_REVIEW_REQUIRED'});
 await withRecoveryBackupLease(await client(),business,signal(),lease=>lease.assertHeld());
});
