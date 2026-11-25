// Disposable candidate only. Root141 source and registered migrations stay fixed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {openingDocumentSourceCoverage} from '../../src/bookkeeping/opening-document-source-columns.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const openingDocument142PriorRegistry='7bcd4b1b7374f163442c2528ccd4984020f0cadadea0ac3d38f36cf66facf4eb';
export const openingDocument142Parts=Object.freeze([
 '20270218180000_opening_document_custody.sql',
 '20270218181000_opening_document_recovery_read.sql',
 '20270218182000_opening_document_workspace_source.sql',
 '20270218183000_opening_document_export_original.sql',
 '20270218184000_opening_document_workspace_jobs.sql',
].map(name=>'planning/proposals/'+name));
export async function openingDocument142Candidate(sandbox){
 const prior=await readFile(join(sandbox.root,'tests/support/registered141-migration-checksums.json'));assert.equal(hash(prior),openingDocument142PriorRegistry);const registry=JSON.parse(prior);assert.equal(registry.migrations.length,141);
 const frozen=await sandbox.prefix(141);assert.deepEqual(JSON.parse(await readFile(join(frozen,'supabase/migration-checksums.json'),'utf8')),registry);
 // The sandbox serializes prefix manifests independently. Verify the complete
 // ordered identity and every SQL byte; never rewrite that prefix's manifest.
 for(const entry of registry.migrations)assert.equal(hash(await readFile(join(frozen,'supabase/migrations',entry.file))),entry.sha256);
 const directory=join(sandbox.workspace,'opening-document142-candidate');await cp(join(frozen,'supabase'),join(directory,'supabase'),{recursive:true,force:false,errorOnExist:true});
 let source='-- Candidate142 private opening originals and versioned exports; no posting or production activation.\n';const parts=[];
 for(const path of openingDocument142Parts){const bytes=await readFile(join(sandbox.root,path));assert(!bytes.includes(13),'CANDIDATE_PROPOSAL_LF_REQUIRED');source+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';const offset=Buffer.byteLength(source);source+=bytes.toString('utf8');assert(Buffer.from(source).subarray(offset).equals(bytes));parts.push({path,offset,bytes:bytes.length,sha256:hash(bytes)});source+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';}
 const file='20270218185000_opening_document_workspace.sql',sha256=hash(source);registry.migrations.push({version:'20270218185000',file,sha256});const registryBytes=JSON.stringify(registry,null,2)+'\n';await writeFile(join(directory,'supabase/migrations',file),source,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
 const baselineBytes=await readFile(join(sandbox.root,'tests/support/registered141-security-export-coverage.json'));assert.equal(hash(baselineBytes),'f110e2643a7d310011b32f66e9f17712df572856d6427391457a6db7707d0b3d');assert.equal(hash(await readFile(join(sandbox.root,'tests/support/registered141-compatibility.json'))),'b9d67c10cdac0d744d24320d968bf948878eb033661f70c8ea7f9bdf42210dd0');const baseline=JSON.parse(baselineBytes);assert.equal(baseline.migrationCount,141);const coverage={...baseline,migrationCount:142,tables:[...baseline.tables,...openingDocumentSourceCoverage]};assert.equal(new Set(coverage.tables.map(row=>row.table)).size,coverage.tables.length);
 return Object.freeze({directory,registry,file,sha256,registrySha256:hash(registryBytes),previousRegistrySha256:hash(prior),parts,coverage,registered:false,postingAuthorized:false});
}
