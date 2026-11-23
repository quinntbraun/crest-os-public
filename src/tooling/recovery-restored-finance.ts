// Isolated destination verification only. No source/scheduler privileges are
// expanded; no login, grant, repair, posting, replay or application is created.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifiedRecoveryDatabaseComparison} from './recovery-restored-database.ts';
import {recoveryDatabaseEndpoint} from './recovery-database-endpoint.ts';
import {withRecoveryBackupLease} from './recovery-backup-lease.ts';
import {captureRecoveryRoutineCatalog} from './recovery-routine-catalog.ts';
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
type Stage='comparison'|'identity'|'snapshot'|'endpoint'|'migrations'|'roles'|'catalog'|'event_state'|'postings';
export class RecoveryRestoredFinanceError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_RESTORED_FINANCE_REVIEW_REQUIRED');this.name='RecoveryRestoredFinanceError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
async function fingerprintEvents(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 for(const sql of["SET LOCAL timezone='UTC'","SET LOCAL datestyle='ISO, YMD'","SET LOCAL intervalstyle='postgres'",'SET LOCAL extra_float_digits=3',"SET LOCAL bytea_output='hex'"])await snapshot.query(sql);
 const digest=createHash('sha256');let count=0;await snapshot.query(`DECLARE crest_finance_state NO SCROLL CURSOR FOR SELECT hash FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM ONLY crest.financial_events t) rows ORDER BY hash COLLATE "C"`);
 try{for(;;){signal.throwIfAborted();const page=(await snapshot.query('FETCH FORWARD 256 FROM crest_finance_state')).rows;if(!page.length)break;for(const row of page){require(typeof row.hash==='string'&&/^[a-f0-9]{64}$/.test(row.hash));digest.update(row.hash);require(++count<=100000);}}}finally{await snapshot.query('CLOSE crest_finance_state');}
 return Object.freeze({rowCount:String(count),rowMultisetSha256:digest.digest('hex')});
}
export async function verifyRecoveryRestoredFinance(input:Readonly<{comparison:unknown;client:pg.Client}>,external:AbortSignal){
 let stage:Stage='comparison';const client=input.client,signal=AbortSignal.any([external,AbortSignal.timeout(900000)]);
 try{
  signal.throwIfAborted();require(client instanceof pg.Client);const comparison=verifiedRecoveryDatabaseComparison(input.comparison),baseline=recoveryRoutineBaseline138;require(comparison.sourceSchemaVersion===baseline.sourceSchemaVersion&&comparison.migrationRegistrySha256===baseline.migrationRegistrySha256);
  stage='identity';await client.query("SET default_transaction_read_only='on'");await client.query("SET statement_timeout='5s'");
  const identity=(await client.query(`SELECT current_user=session_user
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='crest_finance_integrity_owner' AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
   AND (SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user))=1
   AND EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user) AND roleid='crest_finance_integrity_owner'::regrole AND NOT admin_option AND NOT inherit_option AND set_option)
   AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_finance_integrity_owner'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(session_user,n.oid,'CREATE'))
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p') AND has_table_privilege(session_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
   AS allowed`)).rows[0];require(identity?.allowed===true);
  return await withRecoveryBackupLease(client,comparison.businessId,signal,async lease=>{
   stage='snapshot';const captured=await lease.capture(async snapshot=>{
    stage='endpoint';require(await recoveryDatabaseEndpoint(client,sql=>snapshot.query(sql))===comparison.endpoint);
    stage='migrations';require(isDeepStrictEqual((await snapshot.query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')).rows,comparison.migrations));
    stage='roles';require(isDeepStrictEqual((await snapshot.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' AND NOT rolcanlogin ORDER BY oid")).rows,comparison.roles));
    stage='catalog';const catalog=await captureRecoveryRoutineCatalog(snapshot,lease.signal);require(catalog.profile===baseline.profile&&catalog.routineCount===baseline.routineCount&&catalog.sha256===baseline.sha256);
    await snapshot.query('SET LOCAL ROLE crest_finance_integrity_owner');
    stage='event_state';require(isDeepStrictEqual(await fingerprintEvents(snapshot,lease.signal),comparison.eventFingerprint));
    stage='postings';let checked=0;await snapshot.query('DECLARE crest_finance_events NO SCROLL CURSOR FOR SELECT business_id::text,id::text FROM crest.financial_events ORDER BY business_id,id');
    try{for(;;){lease.signal.throwIfAborted();const page=(await snapshot.query('FETCH FORWARD 64 FROM crest_finance_events')).rows;if(!page.length)break;for(const event of page){lease.signal.throwIfAborted();require(++checked<=100000);await snapshot.query('SELECT crest_private.verify_finance_event_posting($1::uuid,$2::uuid)',[event.business_id,event.id]);}}}finally{await snapshot.query('CLOSE crest_finance_events');}
    stage='event_state';require(String(checked)===comparison.eventFingerprint.rowCount&&isDeepStrictEqual(await fingerprintEvents(snapshot,lease.signal),comparison.eventFingerprint));return checked;
   });await lease.assertHeld();
   const evidence=Object.freeze({profile:'crest.restored-financial-postings.v1' as const,pointId:comparison.pointId,businessId:comparison.businessId,destinationDatabase:comparison.destinationDatabase,snapshotId:captured.snapshot.id,checkedEventCount:captured.value,canonicalRoutineCatalogVerified:true as const,canonicalPostingRulesVerified:true as const,exactEventStateMatchesComparison:true as const,atomicWithDataComparison:false as const,fullBusinessReconciliationVerified:false as const,securityAndIncidentAcceptance:false as const,runtimeActivated:false as const,completeBackup:false as const});return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryRestoredFinanceError('postings');}});
  });
 }catch{throw new RecoveryRestoredFinanceError(stage);}finally{if(client instanceof pg.Client)await client.end().catch(()=>{});}
}
