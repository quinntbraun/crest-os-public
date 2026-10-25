// Disposable pre-adoption SQL proof only. The canonical registry stays at39.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {migrationSandbox} from './migration-sandbox.mjs';
export async function leadAddressProposalSandbox(){
 const sandbox=await migrationSandbox();
 return {...sandbox,async prefix(count){
  if(count!==40)return sandbox.prefix(count);
  const original=await sandbox.prefix(39),directory=join(sandbox.workspace,'lead-address-proposal40');
  await mkdir(join(directory,'supabase/migrations'),{recursive:true});
  const registry=JSON.parse(await readFile(join(original,'supabase/migration-checksums.json'),'utf8'));
  assert.equal(registry.migrations.length,39);
  for(const entry of registry.migrations)await copyFile(join(original,'supabase/migrations',entry.file),join(directory,'supabase/migrations',entry.file));
  const sql=await readFile(new URL('../../planning/proposals/lead-address-intake.sql',import.meta.url));
  const file='20261025160000_lead_addresses.sql';
  await writeFile(join(directory,'supabase/migrations',file),sql);
  registry.migrations.push({version:'20261025160000',file,sha256:createHash('sha256').update(sql).digest('hex')});
  await writeFile(join(directory,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
  return directory;
 }};
}
