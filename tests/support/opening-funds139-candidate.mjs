// Candidate-only packaging. Root migration registry and138 baselines stay intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openingFundsSourceCoverage} from '../../src/bookkeeping/opening-funds-source-columns.ts';
import {openingFunds139SourceProfile} from '../../src/tooling/opening-funds139-catalog.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const openingFunds139Version='20270205183000',openingFunds139File=openingFunds139Version+'_fictional_opening_funds_sources.sql';
export const openingFunds139PriorRegistry='9d4864f71e8641a6972b4a5db4b1e47bf58f3917ebab34f27e1802226d72236a';
export const openingFunds139Parts=Object.freeze(['20270201180000_opening_journal_context.sql','20270202180000_opening_funds_sources.sql','20270203180000_opening_journal_funds_context.sql','20270204180000_opening_funds_export_history.sql','20270205180000_opening_funds_recovery_read.sql'].map(name=>'planning/proposals/'+name));
export async function openingFunds139Candidate(sandbox){
 const active=await readFile(join(sandbox.root,'supabase/migration-checksums.json'));assert([openingFunds139PriorRegistry,openingFunds139SourceProfile.migrationRegistrySha256,'823ffc623e93cc0f2c6122b6a04a47b5b1c776dbd6d9c0f779211869f5e75234'].includes(hash(active)));const before=await readFile(join(sandbox.root,'tests/support/registered138-migration-checksums.json'));assert.equal(hash(before),openingFunds139PriorRegistry);const registry=JSON.parse(before);assert.equal(registry.migrations.length,138);
 const directory=await sandbox.prefix(138),parts=[];let source='-- Candidate139 opening customer-funds evidence; no posting or production activation.\n';
 for(const path of openingFunds139Parts){const bytes=await readFile(join(sandbox.root,path));source+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(source);source+=bytes.toString('utf8');assert(Buffer.from(source).subarray(offset).equals(bytes));parts.push({path,offset,bytes:bytes.length,sha256:hash(bytes)});source+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';}
 const sha256=hash(source);registry.migrations.push({version:openingFunds139Version,file:openingFunds139File,sha256});const registryBytes=JSON.stringify(registry,null,2)+'\n';
 await writeFile(join(directory,'supabase/migrations',openingFunds139File),source,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 const baseline=JSON.parse(await readFile(join(sandbox.root,'tests/support/registered138-security-export-coverage.json'),'utf8'));assert.equal(baseline.migrationCount,138);const coverage={...baseline,migrationCount:139,tables:[...baseline.tables,...openingFundsSourceCoverage]};
 return{directory,previousRegistrySha256:hash(before),registrySha256:hash(registryBytes),registry,source,sha256,file:openingFunds139File,bytes:Buffer.byteLength(source),parts,coverage,registered:false,postingAuthorized:false};
}
