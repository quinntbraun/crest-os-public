// Owned synthetic migration candidate. This does not register a repository
// migration, upgrade the owner's preview or activate storage/financial services.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const dropoff67Parts=Object.freeze(['storage','photos','commands','reads','policy','originals',
 'photo-commands','photo-access','work','completion','queue','source','cancellation','schema-compatibility']);
export async function dropoff67Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered66-migration-checksums.json'));
 assert.equal(sha(frozen),'f8b1e968201fba0d24b782a9fe3639f0ce6baeea2276eee98c0208ecd0eee28f');
 const registry=JSON.parse(frozen);assert.equal(registry.migrations.length,66);
 const directory=await sandbox.prefix(66);
 assert.deepEqual(JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8')),registry);
 let sql='-- P08/BR08 per-vehicle Drop-Off custody, work, collection and retained source.\n-- The migration coordinator owns one atomic transaction.\nRESET ROLE;\n';
 const parts=[];
 for(const part of dropoff67Parts){
  const path='planning/proposals/dropoff-custody-'+part+'.sql',body=await readFile(join(sandbox.root,path));
  sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(sql);
  sql+=body.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(body));
  parts.push(Object.freeze({path,offset,bytes:body.length,sha256:sha(body)}));
  sql+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';
 }
 const bytes=Buffer.from(sql),file='20261121180000_dropoff_custody.sql';
 const entry={version:'20261121180000',file,sha256:sha(bytes)};registry.migrations.push(entry);
 const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');
 await writeFile(join(directory,'supabase/migrations',file),bytes,{flag:'wx'});
 await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sha256:entry.sha256,bytes:bytes.length,registrySha256:sha(registryBytes),
  previousRegistrySha256:sha(frozen),parts:Object.freeze(parts)});
}
