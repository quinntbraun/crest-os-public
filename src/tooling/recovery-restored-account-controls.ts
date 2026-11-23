// Offline posted-account controls in a fenced restored database. The caller
// supplies a separate restricted account-owner identity; no grants are created.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifiedRecoveryDatabaseComparison} from './recovery-restored-database.ts';
import {recoveryDatabaseEndpoint} from './recovery-database-endpoint.ts';
import {withRecoveryBackupLease} from './recovery-backup-lease.ts';
import {captureRecoveryRoutineCatalog} from './recovery-routine-catalog.ts';
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import {captureRecoverySchemaCatalog} from './recovery-schema-catalog.ts';
import {recoverySchemaBaseline138} from './recovery-schema-baseline138.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
type Stage='comparison'|'identity'|'snapshot'|'endpoint'|'migrations'|'roles'|'catalog'|'schema'|'event_state'|'postings'|'controls';
export class RecoveryRestoredAccountControlsError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_RESTORED_ACCOUNT_CONTROLS_REVIEW_REQUIRED');this.name='RecoveryRestoredAccountControlsError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
async function fingerprintPostedBusinesses(snapshot:RecoveryBackupSnapshot,businesses:readonly Readonly<{businessId:string;eventCount:string}>[],signal:AbortSignal){
 // This role has tenant-filtered reads. Visit every captured business explicitly,
 // then merge sorted row hashes to reproduce the original global fingerprint.
 for(const sql of["SET LOCAL timezone='UTC'","SET LOCAL datestyle='ISO, YMD'","SET LOCAL intervalstyle='postgres'",'SET LOCAL extra_float_digits=3',"SET LOCAL bytea_output='hex'"])await snapshot.query(sql);
 const hashes:string[]=[];
 for(const business of businesses){
  signal.throwIfAborted();await snapshot.query("SELECT set_config('crest.business_id',$1,true)",[business.businessId]);let count=0;
  await snapshot.query(`DECLARE crest_account_event_state NO SCROLL CURSOR FOR SELECT encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') AS hash FROM ONLY crest.financial_events e WHERE business_id=$1::uuid`,[business.businessId]);
  try{for(;;){signal.throwIfAborted();const page=(await snapshot.query('FETCH FORWARD 256 FROM crest_account_event_state')).rows;if(!page.length)break;for(const row of page){require(typeof row.hash==='string'&&/^[a-f0-9]{64}$/.test(row.hash));hashes.push(row.hash);count++;require(hashes.length<=100000);}}}finally{await snapshot.query('CLOSE crest_account_event_state');}
  require(String(count)===business.eventCount);
 }
 const digest=createHash('sha256');for(const hash of hashes.sort())digest.update(hash);return Object.freeze({rowCount:String(hashes.length),rowMultisetSha256:digest.digest('hex')});
}
export async function verifyRecoveryRestoredAccountControls(input:Readonly<{comparison:unknown;client:pg.Client}>,external:AbortSignal){
 let stage:Stage='comparison';const client=input.client,signal=AbortSignal.any([external,AbortSignal.timeout(900000)]);
 try{
  signal.throwIfAborted();require(client instanceof pg.Client);const comparison=verifiedRecoveryDatabaseComparison(input.comparison),baseline=recoveryRoutineBaseline138;require(comparison.sourceSchemaVersion===baseline.sourceSchemaVersion&&comparison.migrationRegistrySha256===baseline.migrationRegistrySha256);
  stage='identity';await client.query("SET default_transaction_read_only='on'");await client.query("SET statement_timeout='5s'");
  const identity=(await client.query(`SELECT current_user=session_user
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='crest_finance_account_owner' AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
   AND (SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user))=1
   AND EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user) AND roleid='crest_finance_account_owner'::regrole AND NOT admin_option AND NOT inherit_option AND set_option)
   AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_finance_account_owner'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(session_user,n.oid,'CREATE'))
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p') AND has_table_privilege(session_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
   AS allowed`)).rows[0];require(identity?.allowed===true);
  return await withRecoveryBackupLease(client,comparison.businessId,signal,async lease=>{
   stage='snapshot';const captured=await lease.capture(async snapshot=>{
    stage='endpoint';require(await recoveryDatabaseEndpoint(client,sql=>snapshot.query(sql))===comparison.endpoint);
    stage='migrations';require(isDeepStrictEqual((await snapshot.query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')).rows,comparison.migrations));
    stage='roles';require(isDeepStrictEqual((await snapshot.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' AND NOT rolcanlogin ORDER BY oid")).rows,comparison.roles));
    stage='catalog';const catalog=await captureRecoveryRoutineCatalog(snapshot,lease.signal);require(catalog.profile===baseline.profile&&catalog.routineCount===baseline.routineCount&&catalog.sha256===baseline.sha256);
    stage='schema';const schema=await captureRecoverySchemaCatalog(snapshot,lease.signal),schemaBaseline=recoverySchemaBaseline138;require(comparison.sourceSchemaVersion===schemaBaseline.sourceSchemaVersion&&comparison.migrationRegistrySha256===schemaBaseline.migrationRegistrySha256&&schema.profile===schemaBaseline.profile&&schema.objectCount===schemaBaseline.objectCount&&schema.sha256===schemaBaseline.sha256);
    await snapshot.query('SET LOCAL ROLE crest_finance_account_owner');
    stage='event_state';require(isDeepStrictEqual(await fingerprintPostedBusinesses(snapshot,comparison.postedBusinesses,lease.signal),comparison.eventFingerprint));
    const checked=[];
    for(const business of comparison.postedBusinesses){
     lease.signal.throwIfAborted();stage='controls';
     await snapshot.query("SELECT set_config('crest.business_id',$1,true)",[business.businessId]);
     const row=(await snapshot.query('SELECT crest_private.fictional_posted_report_context($1::uuid,$2::date,$3::text,true) AS report',[business.businessId,business.throughOn,business.timeZone])).rows[0],report=row?.report;
     require(report&&report.schemaVersion===11&&report.businessId===business.businessId&&report.currency==='USD'&&report.timeZone===business.timeZone&&report.throughOn===business.throughOn&&report.postedEventCount===business.eventCount);
     require(report.coverage?.complete===false&&report.coverage.openingBalancesIncluded===false&&report.coverage.reconciliationVerified===false);
     for(const name of ['ledgerBalanced','receivablesTie','moneyMovementsTie','customerFundsTie','taxPayableTie','supplierPayablesTie'])require(report.controls?.[name]===true);
     checked.push(Object.freeze({...business,controls:Object.freeze({ledgerBalanced:true as const,receivablesTie:true as const,moneyMovementsTie:true as const,customerFundsTie:true as const,taxPayableTie:true as const,supplierPayablesTie:true as const})}));
    }
    stage='event_state';require(isDeepStrictEqual(await fingerprintPostedBusinesses(snapshot,comparison.postedBusinesses,lease.signal),comparison.eventFingerprint));return Object.freeze(checked);
   });await lease.assertHeld();
   const evidence=Object.freeze({profile:'crest.restored-posted-account-controls.v1' as const,pointId:comparison.pointId,businessId:comparison.businessId,destinationDatabase:comparison.destinationDatabase,snapshotId:captured.snapshot.id,checkedBusinessCount:captured.value.length,businesses:captured.value,canonicalRoutineCatalogVerified:true as const,canonicalSchemaCatalogVerified:true as const,canonicalPostedAccountControlsVerified:true as const,exactEventStateMatchesComparison:true as const,atomicWithDataComparison:false as const,openingBalancesIncluded:false as const,fullBusinessReconciliationVerified:false as const,securityAndIncidentAcceptance:false as const,runtimeActivated:false as const,completeBackup:false as const});return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryRestoredAccountControlsError('controls');}});
  });
 }catch{throw new RecoveryRestoredAccountControlsError(stage);}finally{if(client instanceof pg.Client)await client.end().catch(()=>{});}
}
