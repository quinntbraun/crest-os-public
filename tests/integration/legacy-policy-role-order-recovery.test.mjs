import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {field54Candidate} from '../support/field54-candidate.mjs';
import {backupField54CandidateDatabase,restoreField54CandidateDatabase,backupLegacy53Database,restoreLegacy53Database,connect,inventory,roleDefinitions,keyPair,privateWorkspace,recoveryCluster} from '../support/recovery-drill.mjs';

for(const version of [53,54])test('legacy'+version+' restore preserves an unchanged schema after physical role-catalog relocation',{timeout:240000},async()=>{
 const sandbox=await migrationSandbox();let cluster,restored,sourceClosed=false;
 try{
  const url=await sandbox.database(),admin=await sandbox.connect(url);
  await sandbox.apply(url,await sandbox.prefix(0),true);await installProviderSchema(admin,url);
  await sandbox.apply(url,await sandbox.prefix(version));
  const rows=await inventory(admin),roles=await roleDefinitions(admin);
  const order=async client=>(await client.query("SELECT rolname FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' ORDER BY oid")).rows;
  const originalOrder=await order(admin);
  // Renaming back preserves role identity, privileges and relative OID order,
  // while forcing a physical catalog tuple relocation through the name index.
  await admin.query('ALTER ROLE crest_quote_integrity_owner RENAME TO crest_quote_integrity_owner_catalog_probe');
  await admin.query('ALTER ROLE crest_quote_integrity_owner_catalog_probe RENAME TO crest_quote_integrity_owner');
  assert.deepEqual(await roleDefinitions(admin),roles);assert.deepEqual(await order(admin),originalOrder);
  assert.deepEqual(await inventory(admin),rows);
  const policySets=async client=>(await client.query(`SELECT n.nspname,c.relname,p.polname,
   ARRAY(SELECT r.rolname::text FROM unnest(p.polroles) o(oid) JOIN pg_roles r ON r.oid=o.oid ORDER BY r.rolname COLLATE "C") AS roles
   FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('crest','crest_private') ORDER BY 1,2,3`)).rows;
  const policies=await policySets(admin),folder=await privateWorkspace(),point=join(folder,'relocated-role'+version);
  await mkdir(point,{mode:0o700});const keys=await keyPair(folder),candidate=version===54?await field54Candidate(sandbox):null;
  const backup=version===53?await backupLegacy53Database(admin,url,point,keys.recipient):await backupField54CandidateDatabase(candidate,admin,url,point,keys.recipient);
  assert.equal(backup.manifest.schemaVersion,version);await sandbox.close();sourceClosed=true;cluster=await recoveryCluster();const destination=await cluster.database();
  try{
   if(version===53)await restoreLegacy53Database(point,keys.path,destination);else await restoreField54CandidateDatabase(candidate,point,keys.path,destination);
  }catch(error){
   restored=await connect(destination);
   const facts={rowsExact:JSON.stringify(await inventory(restored))===JSON.stringify(rows),
    rolesExact:JSON.stringify(await roleDefinitions(restored))===JSON.stringify(roles),
    roleOidOrderExact:JSON.stringify(await order(restored))===JSON.stringify(originalOrder),
    policyRoleSetsExact:JSON.stringify(await policySets(restored))===JSON.stringify(policies)};
   console.error('SYNTHETIC_ROLE_CATALOG_RESTORE_PROBE '+JSON.stringify(facts));throw error;
  }
  restored=await connect(destination);assert.deepEqual(await inventory(restored),rows);
  assert.deepEqual(await roleDefinitions(restored),roles);assert.deepEqual(await policySets(restored),policies);
 }finally{
  await restored?.end();await cluster?.close();if(!sourceClosed)await sandbox.close();
 }
});
