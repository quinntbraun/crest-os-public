// Canonical application routine identity, including owners and effective ACLs.
// No application routine is executed while collecting this observation.
import {createHash} from 'node:crypto';
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
export class RecoveryRoutineCatalogError extends Error{constructor(){super('RECOVERY_ROUTINE_CATALOG_REVIEW_REQUIRED');this.name='RecoveryRoutineCatalogError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryRoutineCatalogError();}
export async function captureRecoveryRoutineCatalog(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();
  await snapshot.query('SET LOCAL search_path=pg_catalog');
  const state=(await snapshot.query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,current_setting('server_version_num') AS version")).rows[0];require(state?.read_only==='on'&&state.isolation==='repeatable read'&&/^17[0-9]{4}$/.test(state.version));
  const rows=(await snapshot.query(`SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
   owner.rolname AS owner,p.prokind AS kind,
   CASE WHEN p.prokind IN('f','p') THEN encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') ELSE NULL END AS definition_sha256,
   (SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee=0,grantee.rolname,grantor.rolname,x.privilege_type,x.is_grantable)
     ORDER BY x.grantee=0,grantee.rolname COLLATE "C",grantor.rolname COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
    FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee LEFT JOIN pg_roles grantor ON grantor.oid=x.grantor) AS grants
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
   WHERE n.nspname IN('crest','crest_private','crest_commands')
   ORDER BY n.nspname COLLATE "C",p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C" LIMIT 4097`)).rows;
  require(rows.length>0&&rows.length<=4096&&rows.every(row=>['f','p'].includes(row.kind)&&typeof row.definition_sha256==='string'&&/^[a-f0-9]{64}$/.test(row.definition_sha256)&&Array.isArray(row.grants)));
  signal.throwIfAborted();require(isLiveRecoveryBackupSnapshot(snapshot));const source=JSON.stringify(rows);require(Buffer.byteLength(source)<=2097152);
  return Object.freeze({profile:'crest.application-routine-catalog.v1' as const,routineCount:rows.length,sha256:createHash('sha256').update(source).digest('hex'),completeBackup:false as const});
 }catch{throw new RecoveryRoutineCatalogError();}
}
