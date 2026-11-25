// Disposable candidate packaging only. Historical/root registries are not rewritten.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {openingPayablesSourceCoverage} from '../../src/bookkeeping/opening-payables-source-columns.ts';
import {openingAllocationsSourceCoverage} from '../../src/bookkeeping/opening-allocations-source-columns.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const openingSupplier141PriorRegistry='823ffc623e93cc0f2c6122b6a04a47b5b1c776dbd6d9c0f779211869f5e75234';
export const openingSupplier141File='20270215183000_fictional_opening_supplier_sources.sql';
export const openingSupplier141Parts=Object.freeze([
 '20270207180000_opening_payables_sources.sql','20270208180000_opening_payables_export_history.sql',
 '20270209180000_opening_journal_payables_context.sql','20270210180000_opening_payables_allocation_review.sql',
 '20270211180000_opening_allocation_export_history.sql','20270212180000_opening_allocation_context.sql',
 '20270213180000_opening_allocation_private_response.sql','20270214180000_opening_supplier_source_history.sql',
 '20270215180000_opening_supplier_recovery_read.sql',
].map(file=>'planning/proposals/'+file));
export async function openingSupplier141Candidate(sandbox){
 const frozen=await readFile(join(sandbox.root,'tests/support/registered140-migration-checksums.json'));assert.equal(hash(frozen),openingSupplier141PriorRegistry);
 const registry=JSON.parse(frozen);assert.equal(registry.migrations.length,140);const frozenDirectory=await sandbox.prefix(140);assert.equal(hash(await readFile(join(frozenDirectory,'supabase/migration-checksums.json'))),openingSupplier141PriorRegistry);
 const directory=join(sandbox.workspace,'opening-supplier141-candidate');await cp(join(frozenDirectory,'supabase'),join(directory,'supabase'),{recursive:true,force:false,errorOnExist:true});
 let source='-- Candidate141 retained supplier evidence and reconciliation; no posting or production activation.\n';const parts=[];
 for(const path of openingSupplier141Parts){const bytes=await readFile(join(sandbox.root,path));assert(!bytes.includes(13),'CANDIDATE_PROPOSAL_LF_REQUIRED');source+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(source);source+=bytes.toString('utf8');assert(Buffer.from(source).subarray(offset).equals(bytes));parts.push({path,offset,bytes:bytes.length,sha256:hash(bytes)});source+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';}
 const sha256=hash(source);registry.migrations.push({version:'20270215183000',file:openingSupplier141File,sha256});const registryBytes=JSON.stringify(registry,null,2)+'\n';
 await writeFile(join(directory,'supabase/migrations',openingSupplier141File),source,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 const coverageBytes=await readFile(join(sandbox.root,'tests/support/registered140-security-export-coverage.json'));assert.equal(hash(coverageBytes),'69360a328bb723b3dd06d869cd27efdd8ee88788c8dd5e35c69c6fbf22b3341e');
 assert.equal(hash(await readFile(join(sandbox.root,'tests/support/registered140-compatibility.json'))),'4a4fd476b6c25997c254c621f0f295cb142405aaace2c2dc383131e2795172e1');
 const baseline=JSON.parse(coverageBytes);assert.equal(baseline.migrationCount,140);
 const coverage={...baseline,migrationCount:141,tables:[...baseline.tables,...openingPayablesSourceCoverage,...openingAllocationsSourceCoverage]};assert.equal(new Set(coverage.tables.map(row=>row.table)).size,coverage.tables.length);
 return Object.freeze({directory,registry,source,file:openingSupplier141File,sha256,registrySha256:hash(registryBytes),previousRegistrySha256:hash(frozen),parts,coverage,registered:false,postingAuthorized:false});
}
