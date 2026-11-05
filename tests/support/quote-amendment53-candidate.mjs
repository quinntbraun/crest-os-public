// Disposable coordinator package. No repository registration or owner upgrade.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function quoteAmendment53Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered52-migration-checksums.json')),registry=JSON.parse(frozen),directory=await sandbox.prefix(52),prefix=JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8'));
 assert.equal(registry.migrations.length,52);assert.deepEqual(prefix,registry);
 let sql='-- Synthetic amendment acceptance schema53 candidate; not repository registration.\n-- Coordinator owns the atomic transaction. Initial accepted history stays intact.\nRESET ROLE;\n';const parts=[];
 for(const name of ['quote-amendment-acceptance-storage','quote-amendment-acceptance-input','quote-amendment-acceptance-ledger','quote-amendment-acceptance-core','quote-amendment-acceptance-result','quote-amendment-acceptance-closure','quote-amendment-acceptance-originals','quote-amendment-booking-commands','quote-amendment-current-reads','quote-cancellation-lifecycle','quote-cancellation-edit','quote-amendment-accepted-source']){
  const path='planning/proposals/'+name+'.sql',body=await readFile(join(sandbox.root,path));
  sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(sql);sql+=body.toString('utf8');assert(Buffer.from(sql).subarray(offset).equals(body));parts.push(Object.freeze({path,offset,bytes:body.length,sha256:sha(body)}));sql+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';
 }
 const bytes=Buffer.from(sql),file='20261104180000_quote_amendment_acceptance.sql',entry={version:'20261104180000',file,sha256:sha(bytes)};registry.migrations.push(entry);const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');
 await writeFile(join(directory,'supabase/migrations',file),bytes,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 return Object.freeze({directory,file,sql,sha256:entry.sha256,bytes:bytes.length,registrySha256:sha(registryBytes),previousRegistrySha256:sha(frozen),parts:Object.freeze(parts)});
}
