import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../../supabase/migration-checksums.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import previous from '../support/registered51-migration-checksums.json';
import previousCoverage from '../support/registered51-export-coverage.json';
import previousCompatibility from '../support/registered51-compatibility.json';
import adoption from '../../planning/QUOTE_AMENDMENT_SCHEMA52_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('registers all eight byte-exact reviewed bodies while retaining the entire51 migration prefix',()=>{
 expect(registry.migrations).toHaveLength(52);expect(registry.migrations.slice(0,51)).toEqual(previous.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),previous as MigrationRegistry)).not.toThrow();
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sql.length).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(registry.migrations.at(-1)?.sha256).toBe(adoption.migration.sha256);expect(sha256(bytes('supabase/migration-checksums.json'))).toBe(adoption.migration.registrySha256);expect(adoption.proposalBodies).toHaveLength(8);let end=0;
 for(const part of adoption.proposalBodies){const original=bytes(part.path);expect(part.bytes).toBe(original.length);expect(sha256(original)).toBe(part.sha256);expect(sql.subarray(part.offset,part.offset+part.bytes)).toEqual(original);expect(sql.subarray(end,part.offset).toString()).toContain('RESET ROLE;');end=part.offset+part.bytes;}expect(sql.subarray(end).toString()).toContain('RESET ROLE;');
});
it('keeps immutable51 registry, coverage and compatibility separately identifiable',()=>{
 for(const prior of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);expect(previous.migrations).toHaveLength(51);expect(previousCoverage.migrationCount).toBe(51);expect(previousCompatibility.schemaMaximum).toBe(51);expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:52});
});
it('adds only the physical accepted-parent column and retains every secret exclusion',()=>{
 const expected=structuredClone(previousCoverage);expected.migrationCount=52;expected.tables.find(t=>t.table==='crest.quote_revisions')!.required.push('parent_agreement_id');expect(coverage).toEqual(expected);expect(adoption.sourceTablesAdded).toEqual([]);expect(adoption.sourceColumnsAdded).toBe(1);const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(v=>v.column)].map(column=>({table:t.table,column})));expect(verifyExportCoverage(coverage,observed,52)).toEqual({assurance:'schema_inventory_only',tables:68,requiredColumns:1055,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
});
it('keeps construction, owner adoption, finance and the full V1 scope separate',()=>{
 expect(adoption).toMatchObject({repositoryRegistration:52,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',originalRowsAndHistoryRewritten:false,runtimeFinancePostingEnabled:false,completePortableExport:false,completeBackup:false});expect(adoption.requiredAcceptance.join(' ')).toMatch(/genuine MFA/);expect(adoption.requiredAcceptance.join(' ')).toMatch(/independent|independently/);expect(adoption.requiredAcceptance.join(' ')).toMatch(/WebKit/);expect(adoption.remainingV1).toContain('amendment customer acceptance and resulting agreement chains');expect(adoption.remainingV1).toContain('approved Google Calendar capability');
});
