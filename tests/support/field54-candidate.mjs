// Owned synthetic coordinator package only. No repository migration registration,
// owner database upgrade, runtime activation or weakening of predecessor pins.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export const field54Parts=Object.freeze(['field-time-storage','field-session-commands','work-completion-plan','work-completion-commands','field-scope-floor','mileage-evidence','mileage-field-profile','mobile-trip-interruption','unfulfilled-work-cancellation','support-trip-commands','field-originals','field-source','field-parent-source']);
export async function field54Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered53-migration-checksums.json')),registry=JSON.parse(frozen);
 assert.equal(sha(frozen),'033199a5f2e528f629799cdba48901bf2a4687df1eea3166b0cf7bfcf5ec3c67');assert.equal(registry.migrations.length,53);
 const directory=await sandbox.prefix(53),prefix=JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8'));assert.deepEqual(prefix,registry);
 let sql='-- Synthetic field workspace schema54 candidate; not repository registration.\n-- Coordinator owns one atomic transaction; original source history is retained.\nRESET ROLE;\n';const parts=[];
 for(const name of field54Parts){const path='planning/proposals/'+name+'.sql',body=await readFile(join(sandbox.root,path));sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(sql);sql+=body.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(body));parts.push(Object.freeze({path,offset,bytes:body.length,sha256:sha(body)}));sql+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';}
 const bytes=Buffer.from(sql),file='20261105180000_field_workspace.sql',entry={version:'20261105180000',file,sha256:sha(bytes)};registry.migrations.push(entry);const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');
 await writeFile(join(directory,'supabase/migrations',file),bytes,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sql,sha256:entry.sha256,bytes:bytes.length,registrySha256:sha(registryBytes),previousRegistrySha256:sha(frozen),parts:Object.freeze(parts)});
}
