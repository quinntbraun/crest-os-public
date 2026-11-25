// Disposable held-schema rehearsal only. Does not alter registered138 backup
// profiles, approve an opening or expose a restored application to real traffic.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {rememberRecoverySchema,recoverySchemaDifference} from './recovery-schema-diagnostic.mjs';
import {readFile,realpath,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connect,inventory,keyPair,normalizedSchema,postgresTool,privateWorkspace,recoveryCluster,roleDefinitions,run} from './recovery-drill.mjs';
import {openingSupplier141Parts} from './opening-supplier141-candidate.mjs';
import {openingDocument142Parts} from './opening-document142-candidate.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function exerciseOpeningFundsCandidateRestore(source,url,inspect,{schemaVersion=138}={}){
 assert([138,139,140,141,142].includes(schemaVersion));
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const workspace=await privateWorkspace();let cluster,restored;const age=join(root,'.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''));
 try{
  const proposalPaths=schemaVersion===142?openingDocument142Parts:schemaVersion===141?openingSupplier141Parts:['20270201180000_opening_journal_context.sql','20270202180000_opening_funds_sources.sql','20270203180000_opening_journal_funds_context.sql','20270204180000_opening_funds_export_history.sql','20270205180000_opening_funds_recovery_read.sql'].map(name=>'planning/proposals/'+name);
  const proposals=[];for(const path of proposalPaths){assert.match(path,/^planning\/proposals\/[0-9]{14}_[a-z0-9_]+\.sql$/);const bytes=await readFile(join(root,path));proposals.push({name:path.slice('planning/proposals/'.length),bytes:bytes.length,sha256:hash(bytes)});}
  const keys=await keyPair(workspace),wrong=await keyPair(workspace);let dump,rows,schema,roles,order,policies;
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
   await source.query("SET LOCAL timezone='UTC';SET LOCAL datestyle='ISO, YMD';SET LOCAL bytea_output='hex'");
   const snapshot=(await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
   roles=await roleDefinitions(source,true);order=(await source.query("SELECT rolname FROM pg_roles WHERE rolname~'^crest_[a-z_]+$' ORDER BY oid")).rows.map(row=>row.rolname);assert.deepEqual(order.slice().sort(),roles.map(row=>row.rolname));
   policies=(await source.query("SELECT n.nspname AS \"schemaName\",c.relname AS \"tableName\",p.polname AS \"policyName\",ARRAY(SELECT r.rolname::text FROM unnest(p.polroles) AS member(oid) JOIN pg_roles r ON r.oid=member.oid ORDER BY r.rolname COLLATE \"C\") AS roles FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private') AND cardinality(p.polroles)>1 ORDER BY n.nspname,c.relname,p.polname")).rows;
   rows=await inventory(source);schema=normalizedSchema(await postgresTool('pg_dump',url,['--schema-only','--snapshot',snapshot]),policies);rememberRecoverySchema(schema);dump=await postgresTool('pg_dump',url,['--format=custom','--snapshot',snapshot]);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
  }finally{await source.query('ROLLBACK');}
  // Authenticate the entire in-memory dump before any restore SQL executes.
  // Real baseline/profile checks remain required by production capture/restore.
  const cipher=await run(age,['--encrypt','--recipient',keys.recipient],{input:dump});assert(cipher.length>0);assert(!cipher.includes(Buffer.from('PGDMP')));
  await assert.rejects(run(age,['--decrypt','--identity',wrong.path],{input:cipher}));const corrupted=Buffer.from(cipher);corrupted[corrupted.length-1]^=1;await assert.rejects(run(age,['--decrypt','--identity',keys.path],{input:corrupted}));
  const plaintext=await run(age,['--decrypt','--identity',keys.path],{input:cipher});assert.equal(hash(plaintext),hash(dump));assert.equal(plaintext.length,dump.length);
  cluster=await recoveryCluster();const target=await cluster.database();restored=await connect(target);assert.equal((await restored.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN('auth','crest','crest_private','crest_commands')")).rows[0].n,0);
  for(const name of order){assert.match(name,/^crest_[a-z_]+$/);const role=roles.find(row=>row.rolname===name);assert(role);await restored.query('CREATE ROLE "'+name+'" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION '+(role.rolbypassrls?'BYPASSRLS':'NOBYPASSRLS'));}
  await postgresTool('pg_restore',target,['--exit-on-error','--single-transaction'],plaintext);
  assert.deepEqual(await inventory(restored),rows);assert.deepEqual(await roleDefinitions(restored,true),roles);
  const restoredSchema=normalizedSchema(await postgresTool('pg_dump',target,['--schema-only']),policies);
  if(schemaVersion===141&&hash(restoredSchema)!==hash(schema)&&process.env.CREST_TEST_EVIDENCE_DIRECTORY){
   // Synthetic fixture table DDL only; retained locally, never emitted to TAP.
   const tables=sql=>new Map(sql.split(/(?=^-- Name: )/m).filter(block=>/^-- Name: [a-z_]+; Type: TABLE; Schema: crest;/m.test(block)).map(block=>[block.split('\n')[0],block]));
   const before=tables(schema),after=tables(restoredSchema),differences=[...before].filter(([name,sql])=>after.get(name)!==sql).map(([name,sql])=>({name,before:sql,after:after.get(name)}));
   assert(differences.length<=4&&JSON.stringify(differences).length<=131072);const directory=join(process.env.CREST_TEST_EVIDENCE_DIRECTORY,'private-diagnostics');await mkdir(directory,{recursive:true});await writeFile(join(directory,'table-definition-differences.json'),JSON.stringify(differences,null,2)+'\n');
  }
  assert.equal(hash(restoredSchema),hash(schema),JSON.stringify(recoverySchemaDifference(hash(schema),restoredSchema,{schemaVersion})));
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,schemaVersion);
  await inspect(restored);
  return{profile:schemaVersion===142?'crest.held-opening-document-restore-rehearsal.v1':schemaVersion===141?'crest.held-opening-supplier-restore-rehearsal.v1':'crest.held-opening-funds-restore-rehearsal.v1',proposals,tableCount:rows.length,schemaSha256:hash(schema),dumpSha256:hash(dump),encryptedDumpBytes:cipher.length,rolesRecreated:roles.length,independentCluster:true,registered:false,completeBackup:false,productionReopenAccepted:false};
 }finally{if(restored)await restored.end();if(cluster)await cluster.close();assert.equal(await realpath(workspace),workspace);await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
