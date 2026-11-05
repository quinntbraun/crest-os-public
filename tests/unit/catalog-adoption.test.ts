import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../support/registered44-migration-checksums.json';
import previous from '../support/registered43-migration-checksums.json';
import priorCoverage from '../support/registered43-export-coverage.json';
import priorCompatibility from '../support/registered43-compatibility.json';
import coverage from '../support/registered44-export-coverage.json';
import compatibility from '../support/registered44-compatibility.json';
import adoption from '../../planning/CATALOG_SCHEMA44_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('appends exactly one44 migration while retaining every registered43 file and checksum',()=>{
 expect(registry.migrations).toHaveLength(44);expect(registry.migrations.slice(0,43)).toEqual(previous.migrations);
 const files=new Map(registry.migrations.map(e=>[e.file,bytes('supabase/migrations/'+e.file)]));expect(()=>validateMigrationSet(registry as MigrationRegistry,files,previous as MigrationRegistry)).not.toThrow();
 expect(registry.migrations[43]).toEqual({version:'20261028010000',file:adoption.migration.file,sha256:adoption.migration.sha256});expect(sha256(bytes(adoption.previousRegistry.frozenFixture))).toBe(adoption.previousRegistry.sha256);
});
it('embeds every reviewed catalog body in exact dependency order without changing its bytes',()=>{
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sql.length).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);
 expect(adoption.proposalBodies.map(p=>p.path)).toEqual(['storage','commands','source','resolution'].map(n=>'planning/proposals/service-catalog-'+n+'.sql'));let end=0;
 for(const [i,p]of adoption.proposalBodies.entries()){expect(p.order).toBe(i+1);expect(p.offset).toBeGreaterThan(end);const original=bytes(p.path);expect(p.bytes).toBe(original.length);expect(p.sha256).toBe(sha256(original));expect(sql.subarray(p.offset,p.offset+p.bytes)).toEqual(original);end=p.offset+p.bytes;}
});
it('retains exact historical43 coverage and compatibility instead of interpreting them as44',()=>{
 expect(sha256(bytes(adoption.previousCoverage.frozenFixture))).toBe(adoption.previousCoverage.sha256);expect(priorCoverage.migrationCount).toBe(43);expect(priorCoverage.tables).toHaveLength(39);
 expect(sha256(bytes(adoption.previousCompatibility.frozenFixture))).toBe(adoption.previousCompatibility.sha256);expect(priorCompatibility.schemaMaximum).toBe(43);expect(compatibility).toEqual({...priorCompatibility,schemaMaximum:44});
});
it('includes all29 catalog fields in the new closed inventory without adding credential exclusions',()=>{
 const rows=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
 expect(coverage.migrationCount).toBe(44);expect(verifyExportCoverage(coverage,rows,44)).toEqual({assurance:'schema_inventory_only',tables:41,requiredColumns:632,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 expect(coverage.tables.filter(t=>t.table==='crest.services'||t.table==='crest.service_versions').reduce((n,t)=>n+t.required.length,0)).toBe(29);expect(()=>verifyExportCoverage(priorCoverage,rows,43)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it.each(['crest.services','crest.service_versions'])('rejects an omitted adopted %s source field instead of silently exporting a partial table',table=>{
 const m=structuredClone(coverage),rows=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));m.tables.find(t=>t.table===table)!.required.pop();expect(()=>verifyExportCoverage(m,rows,44)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it('keeps registration separate from runtime worker/editor, production and completeness approval',()=>{
 expect(adoption).toMatchObject({repositoryRegistration:44,databaseApplied:false,productionActivation:'blocked',legacyProfiles:[42,43],runtimeCatalogEnabled:false,registeredCatalogWorkerEnabled:false,completePortableExport:false,completeBackup:false,sourceCoverage:{tables:41,requiredColumns:632,excludedCredentialColumns:10,actualRegistered44CatalogVerified:false}});
 expect(compatibility.productionActivation).toBe('blocked');expect(adoption.requiredCatalogColumns).toBe(29);
});
