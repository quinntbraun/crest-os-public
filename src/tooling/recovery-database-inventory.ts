// Private recovery metadata, not a tenant export or a complete backup. Pass the
// result directly to the encrypted recovery manifest; never log its contents.
import {createHash} from 'node:crypto';
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';

export class RecoveryDatabaseInventoryError extends Error{constructor(){super('RECOVERY_DATABASE_INVENTORY_REVIEW_REQUIRED');this.name='RecoveryDatabaseInventoryError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryDatabaseInventoryError();}
const identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"';

// Database-side row hashes preserve bigint/numeric/bytea/JSON values without
// converting them through JavaScript numbers. Sorting fixed-width hashes gives
// a multiset fingerprint, including duplicate rows, independent of heap order.
export async function captureRecoveryDatabaseInventory(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();
  const query:RecoveryBackupSnapshot['query']=async(sql,values)=>{require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();const result=await snapshot.query(sql,values);signal.throwIfAborted();return result;};
  await query('SET LOCAL search_path=pg_catalog');await query("SET LOCAL timezone='UTC'");await query("SET LOCAL datestyle='ISO, YMD'");await query("SET LOCAL intervalstyle='postgres'");await query('SET LOCAL extra_float_digits=3');await query("SET LOCAL bytea_output='hex'");
  const context=(await query("SELECT current_database() AS database,current_user::text AS role,current_setting('server_version_num') AS version,current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only")).rows[0];
  require(context?.database===snapshot.database&&context.role===snapshot.databaseRole&&/^17\d{4}$/.test(context.version)&&context.isolation==='repeatable read'&&context.read_only==='on');
  const roles=(await query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_catalog.pg_roles WHERE rolname ~ '^crest_[a-z_]+$' AND NOT rolcanlogin ORDER BY oid")).rows;
  require(roles.length>0&&roles.length<=256&&roles.some(role=>role.rolname==='crest_backup_reader'));
  for(const role of roles)require(!role.rolsuper&&!role.rolinherit&&!role.rolcreaterole&&!role.rolcreatedb&&!role.rolcanlogin&&!role.rolreplication&&role.rolbypassrls===(role.rolname==='crest_backup_reader')&&role.rolconnlimit===-1&&role.rolconfig===null);
  const roleNames=roles.map(role=>role.rolname as string);
  const memberships=(await query('SELECT a.rolname AS role,b.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles a ON a.oid=m.roleid JOIN pg_catalog.pg_roles b ON b.oid=m.member WHERE a.rolname=ANY($1::text[]) OR b.rolname=ANY($1::text[]) ORDER BY a.rolname,b.rolname',[roleNames])).rows;
  require(memberships.length<=1024&&!memberships.some(link=>roleNames.includes(link.member)));
  // Login identities/memberships are recovery references, never password dumps
  // or instructions to re-enable old application/worker sessions after restore.
  const extensions=(await query('SELECT extname,extversion,n.nspname AS schema FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace ORDER BY extname')).rows;
  const relations=(await query("SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced_rls,pg_get_userbyid(c.relowner) AS owner,EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') AS extension_owned FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','m','f') ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\"")).rows;
  require(relations.length>0&&relations.length<=4096&&!relations.some(row=>row.kind==='f'));
  const tables=[];let totalRows=0;
  for(const relation of relations){
   require(typeof relation.schema==='string'&&typeof relation.name==='string');const name=identifier(relation.schema)+'.'+identifier(relation.name);
   const columns=(await query('SELECT a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated FROM pg_catalog.pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',[name])).rows;
   require(columns.length<=1600);const digest=createHash('sha256');let count=0;
   await query(`DECLARE crest_recovery_inventory NO SCROLL CURSOR FOR SELECT hash FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM ONLY ${name} t) rows ORDER BY hash COLLATE "C"`);
   try{
    for(;;){const page=(await query('FETCH FORWARD 512 FROM crest_recovery_inventory')).rows;require(page.length<=512);if(!page.length)break;
     for(const row of page){require(typeof row.hash==='string'&&/^[a-f0-9]{64}$/.test(row.hash));digest.update(row.hash);count++;totalRows++;require(totalRows<=10000000);}
    }
   }finally{await query('CLOSE crest_recovery_inventory');}
   tables.push(Object.freeze({...relation,columns:Object.freeze(columns.map(column=>Object.freeze({...column}))),rowCount:String(count),rowMultisetSha256:digest.digest('hex')}));
  }
  const evidence=Object.freeze({profile:'crest.private-database-inventory.v1' as const,snapshotId:snapshot.id,database:snapshot.database,capturedAt:snapshot.capturedAt,serverVersion:context.version as string,roles:Object.freeze(roles.map(role=>Object.freeze({...role}))),roleCreationOrder:Object.freeze(roleNames),membershipReferences:Object.freeze(memberships.map(link=>Object.freeze({...link}))),extensions:Object.freeze(extensions.map(extension=>Object.freeze({...extension}))),tables:Object.freeze(tables),rowCount:String(totalRows),fingerprint:'sha256-concatenated-sorted-sha256-pg17-jsonb-utf8.v1' as const,sequenceValuesTransactional:false as const,completeBackup:false as const});
  return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryDatabaseInventoryError();}});
 }catch{throw new RecoveryDatabaseInventoryError();}
}
