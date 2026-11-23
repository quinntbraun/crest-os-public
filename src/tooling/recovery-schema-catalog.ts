// Structural application protections, independently comparable across clusters.
// Reads system catalogs only; no application routine, row or expression runs.
import {createHash} from 'node:crypto';
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
export class RecoverySchemaCatalogError extends Error{constructor(){super('RECOVERY_SCHEMA_CATALOG_REVIEW_REQUIRED');this.name='RecoverySchemaCatalogError';}}
export async function captureRecoverySchemaCatalog(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  if(!isLiveRecoveryBackupSnapshot(snapshot))throw new RecoverySchemaCatalogError();signal.throwIfAborted();
  await snapshot.query('SET LOCAL search_path=pg_catalog');
  const state=(await snapshot.query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,current_setting('server_version_num') AS version")).rows[0];
  if(state?.read_only!=='on'||state.isolation!=='repeatable read'||!/^17[0-9]{4}$/.test(state.version))throw new RecoverySchemaCatalogError();
  const rows=(await snapshot.query(`WITH namespaces AS (
   SELECT * FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands')
  ), relations AS (
   SELECT c.*,n.nspname FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace
  ), observations AS (
   SELECT 'schema' AS kind,n.nspname AS name,jsonb_build_object('owner',owner.rolname,'grants',
    (SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee=0,g.rolname,r.rolname,x.privilege_type,x.is_grantable)
     ORDER BY x.grantee=0,g.rolname COLLATE "C",r.rolname COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
     FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee LEFT JOIN pg_roles r ON r.oid=x.grantor)) AS definition
   FROM namespaces n JOIN pg_roles owner ON owner.oid=n.nspowner
   UNION ALL
   SELECT 'relation',format('%I.%I',c.nspname,c.relname),jsonb_build_object('kind',c.relkind,'owner',owner.rolname,
    'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,'persistence',c.relpersistence,'replicaIdentity',c.relreplident,
    'options',c.reloptions,'partition',c.relispartition,'view',CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,false) END,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee=0,g.rolname,r.rolname,x.privilege_type,x.is_grantable)
     ORDER BY x.grantee=0,g.rolname COLLATE "C",r.rolname COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
     FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee LEFT JOIN pg_roles r ON r.oid=x.grantor))
   FROM relations c JOIN pg_roles owner ON owner.oid=c.relowner
   UNION ALL
   SELECT 'column',format('%I.%I.%I',c.nspname,c.relname,a.attname),jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid,false),
    'collation',CASE WHEN a.attcollation<>0 THEN format('%I.%I',cn.nspname,co.collname) END,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee=0,g.rolname,r.rolname,x.privilege_type,x.is_grantable)
     ORDER BY x.grantee=0,g.rolname COLLATE "C",r.rolname COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
     FROM aclexplode(a.attacl) x LEFT JOIN pg_roles g ON g.oid=x.grantee LEFT JOIN pg_roles r ON r.oid=x.grantor))
   FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
   LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
   WHERE a.attnum>0 AND NOT a.attisdropped
   UNION ALL
   SELECT 'constraint',format('%I.%I.%I',n.nspname,coalesce(c.relname,t.typname),k.conname),jsonb_build_object('kind',k.contype,
    'definition',pg_get_constraintdef(k.oid,false),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred,'noInherit',k.connoinherit)
   FROM pg_constraint k JOIN namespaces n ON n.oid=k.connamespace LEFT JOIN pg_class c ON c.oid=k.conrelid LEFT JOIN pg_type t ON t.oid=k.contypid
   UNION ALL
   SELECT 'index',format('%I.%I',c.nspname,c.relname),jsonb_build_object('definition',pg_get_indexdef(c.oid),
    'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'unique',i.indisunique,'primary',i.indisprimary,'replicaIdentity',i.indisreplident)
   FROM relations c JOIN pg_index i ON i.indexrelid=c.oid
   UNION ALL
   SELECT 'policy',format('%I.%I.%I',c.nspname,c.relname,p.polname),jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
    'roles',(SELECT jsonb_agg(CASE WHEN id=0 THEN 'PUBLIC' ELSE r.rolname END ORDER BY CASE WHEN id=0 THEN 'PUBLIC' ELSE r.rolname END COLLATE "C") FROM unnest(p.polroles) id LEFT JOIN pg_roles r ON r.oid=id),
    'using',pg_get_expr(p.polqual,p.polrelid,false),'check',pg_get_expr(p.polwithcheck,p.polrelid,false))
   FROM pg_policy p JOIN relations c ON c.oid=p.polrelid
   UNION ALL
   SELECT 'trigger',format('%I.%I.%s',c.nspname,c.relname,CASE WHEN t.tgisinternal THEN k.conname||':'||t.tgtype::text||':'||p.proname ELSE t.tgname END),
    jsonb_build_object('internal',t.tgisinternal,'enabled',t.tgenabled,'type',t.tgtype,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,
     'function',format('%I.%I(%s)',pn.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
     'definition',CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid,false) END)
   FROM pg_trigger t JOIN relations c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint k ON k.oid=t.tgconstraint
   UNION ALL
   SELECT 'type',format('%I.%I',n.nspname,t.typname),jsonb_build_object('owner',owner.rolname,'kind',t.typtype,'notNull',t.typnotnull,
    'base',CASE WHEN t.typbasetype<>0 THEN format_type(t.typbasetype,t.typtypmod) END,'element',CASE WHEN t.typelem<>0 THEN format_type(t.typelem,NULL) END,
    'default',t.typdefault,'labels',
    (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
   FROM pg_type t JOIN namespaces n ON n.oid=t.typnamespace JOIN pg_roles owner ON owner.oid=t.typowner
   UNION ALL
   SELECT 'inheritance',format('%I.%I:%s',c.nspname,c.relname,h.inhseqno),jsonb_build_object('parent',format('%I.%I',pn.nspname,p.relname))
   FROM pg_inherits h JOIN relations c ON c.oid=h.inhrelid JOIN pg_class p ON p.oid=h.inhparent JOIN pg_namespace pn ON pn.oid=p.relnamespace
   UNION ALL
   SELECT 'rule',format('%I.%I.%I',c.nspname,c.relname,r.rulename),jsonb_build_object('enabled',r.ev_enabled,'definition',pg_get_ruledef(r.oid,false))
   FROM pg_rewrite r JOIN relations c ON c.oid=r.ev_class
   UNION ALL
   SELECT 'sequence',format('%I.%I',c.nspname,c.relname),jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart::text,
    'increment',s.seqincrement::text,'minimum',s.seqmin::text,'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle)
   FROM pg_sequence s JOIN relations c ON c.oid=s.seqrelid
   UNION ALL
   SELECT 'membership',format('%I.%I',r.rolname,m.rolname),jsonb_build_object('grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)
   FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor
   WHERE r.rolname~'^crest_' AND m.rolname~'^crest_' AND NOT r.rolcanlogin AND NOT m.rolcanlogin
   UNION ALL
   SELECT 'default_acl',format('%I.%I.%s',owner.rolname,coalesce(n.nspname,''),d.defaclobjtype),jsonb_build_object('grants',
    (SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee=0,g.rolname,r.rolname,x.privilege_type,x.is_grantable)
     ORDER BY x.grantee=0,g.rolname COLLATE "C",r.rolname COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]'::jsonb)
     FROM aclexplode(d.defaclacl) x LEFT JOIN pg_roles g ON g.oid=x.grantee LEFT JOIN pg_roles r ON r.oid=x.grantor))
   FROM pg_default_acl d JOIN pg_roles owner ON owner.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
   WHERE n.nspname IN('crest','crest_private','crest_commands') OR d.defaclnamespace=0 AND owner.rolname~'^crest_'
  ) SELECT kind,name,definition FROM observations ORDER BY kind COLLATE "C",name COLLATE "C",definition::text COLLATE "C" LIMIT 32769`)).rows;
  signal.throwIfAborted();if(!isLiveRecoveryBackupSnapshot(snapshot)||rows.length===0||rows.length>32768||rows.some(row=>typeof row.name!=='string'||!row.name||!row.definition))throw new RecoverySchemaCatalogError();
  const source=JSON.stringify(rows);if(Buffer.byteLength(source)>16777216)throw new RecoverySchemaCatalogError();
  return Object.freeze({profile:'crest.application-schema-catalog.v1' as const,objectCount:rows.length,sha256:createHash('sha256').update(source).digest('hex'),completeBackup:false as const});
 }catch{throw new RecoverySchemaCatalogError();}
}
