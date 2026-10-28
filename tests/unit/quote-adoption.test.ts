import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../../supabase/migration-checksums.json';
import previous from '../support/registered44-migration-checksums.json';
import priorCoverage from '../support/registered44-export-coverage.json';
import priorCompatibility from '../support/registered44-compatibility.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import adoption from '../../planning/QUOTE_SCHEMA45_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('registers one append-only quote migration and preserves every prior checksum',()=>{
 expect(previous.migrations).toHaveLength(44);expect(registry.migrations).toHaveLength(45);expect(registry.migrations.slice(0,44)).toEqual(previous.migrations);
 const files=new Map(registry.migrations.map(e=>[e.file,bytes('supabase/migrations/'+e.file)]));expect(()=>validateMigrationSet(registry as MigrationRegistry,files,previous as MigrationRegistry)).not.toThrow();
 expect(registry.migrations[44]).toEqual({version:'20261028020000',file:adoption.migration.file,sha256:adoption.migration.sha256});expect(sha256(bytes(adoption.previousRegistry.frozenFixture))).toBe(adoption.previousRegistry.sha256);
});
it('retains all five reviewed quote bodies byte-for-byte in dependency order',()=>{
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sql.length).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);
 expect(adoption.proposalBodies.map(p=>p.path)).toEqual(['quote-pricing','quote-draft-storage','quote-draft-commands','quote-draft-source','quote-draft-resolution'].map(n=>'planning/proposals/'+n+'.sql'));let end=0;
 for(const [i,p]of adoption.proposalBodies.entries()){const original=bytes(p.path);expect(p.order).toBe(i+1);expect(p.offset).toBeGreaterThan(end);expect(p.bytes).toBe(original.length);expect(p.sha256).toBe(sha256(original));expect(sql.subarray(p.offset,p.offset+p.bytes)).toEqual(original);end=p.offset+p.bytes;}
});
it('keeps44 artifacts distinct and includes every current quote column without new credential exclusions',()=>{
 expect(sha256(bytes(adoption.previousCoverage.frozenFixture))).toBe(adoption.previousCoverage.sha256);expect(sha256(bytes(adoption.previousCompatibility.frozenFixture))).toBe(adoption.previousCompatibility.sha256);
 expect(priorCoverage.migrationCount).toBe(44);expect(priorCoverage.tables).toHaveLength(41);expect(priorCompatibility.schemaMaximum).toBe(44);expect(compatibility).toEqual({...priorCompatibility,schemaMaximum:45});
 const rows=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
 expect(verifyExportCoverage(coverage,rows,45)).toEqual({assurance:'schema_inventory_only',tables:44,requiredColumns:693,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 expect(coverage.tables.filter(t=>adoption.quoteTables.includes(t.table)).reduce((n,t)=>n+t.required.length,0)).toBe(61);expect(()=>verifyExportCoverage(priorCoverage,rows,44)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it.each(adoption.quoteTables)('refuses omission of an adopted %s field',table=>{
 const m=structuredClone(coverage),rows=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));m.tables.find(t=>t.table===table)!.required.pop();expect(()=>verifyExportCoverage(m,rows,45)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it('does not interpret registration or inventory as runtime, worker, production or backup acceptance',()=>{
 expect(adoption).toMatchObject({repositoryRegistration:45,databaseApplied:false,productionActivation:'blocked',legacyProfiles:[42,43,44],runtimeQuotesEnabled:false,registeredQuoteWorkerEnabled:false,completePortableExport:false,completeBackup:false,sourceCoverage:{actualRegistered45QuoteVerified:false}});expect(compatibility.productionActivation).toBe('blocked');
});
