// Isolated backup preflight. Caller owns a dedicated direct/session TLS client;
// no role, membership, credential, connection or release authority is created.
import pg from 'pg';

export class RecoveryBackupReaderError extends Error{constructor(){super('RECOVERY_BACKUP_READER_REVIEW_REQUIRED');this.name='RecoveryBackupReaderError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryBackupReaderError();}
export async function verifyRecoveryBackupReader(client:pg.Client,migrations:readonly Readonly<{version:string;name:string}>[]){
 try{
  require(client instanceof pg.Client&&Array.isArray(migrations)&&migrations.length>0&&migrations.length<=999);
  const expected=migrations.map((entry,index)=>{require(entry&&/^\d{14}$/.test(entry.version)&&/^[a-z0-9_]+$/.test(entry.name)&&(index===0||migrations[index-1]!.version<entry.version));return Object.freeze({...entry});});
  const role=(await client.query(`SELECT current_user='crest_backup_reader' AND current_user<>session_user
   AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND r.rolbypassrls AND NOT(r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit) AND r.rolconfig IS NULL)
   AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
   AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))=1
   AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND m.roleid='crest_backup_reader'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member='crest_backup_reader'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE m.roleid='crest_backup_reader'::regrole AND (NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit OR m.admin_option OR m.inherit_option OR NOT m.set_option OR (SELECT count(*) FROM pg_catalog.pg_auth_members other WHERE other.member=r.oid)<>1))
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner='crest_backup_reader'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner='crest_backup_reader'::regrole)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner='crest_backup_reader'::regrole) AS allowed`)).rows[0];require(role?.allowed===true);
  const privileges=(await client.query(`SELECT
   NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN('crest','crest_private','crest_commands','auth','supabase_migrations','public') AND (NOT has_schema_privilege(current_user,n.oid,'USAGE') OR has_schema_privilege(current_user,n.oid,'CREATE')))
   AND (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname IN('crest','crest_private','crest_commands','auth','supabase_migrations','public'))=6
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','auth','supabase_migrations','public') AND c.relkind IN('r','p') AND (NOT has_table_privilege(current_user,c.oid,'SELECT') OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','auth','supabase_migrations','public') AND c.relkind='S' AND (NOT has_sequence_privilege(current_user,c.oid,'SELECT') OR has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')))
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS allowed`)).rows[0];require(privileges?.allowed===true);
  const actual=(await client.query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')).rows;require(JSON.stringify(actual)===JSON.stringify(expected));
  const context=(await client.query('SELECT current_database() AS database,pg_backend_pid() AS backend_pid')).rows[0];require(typeof context?.database==='string'&&Number.isSafeInteger(context.backend_pid));return Object.freeze({database:context.database as string,backendPid:context.backend_pid as number,sourceSchemaVersion:expected.length,completeBackup:false as const});
 }catch{throw new RecoveryBackupReaderError();}
}
