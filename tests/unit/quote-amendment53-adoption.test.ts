import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../../supabase/migration-checksums.json';
import previous from '../support/registered52-migration-checksums.json';
import previousCoverage from '../support/registered52-export-coverage.json';
import previousCompatibility from '../support/registered52-compatibility.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import registration from '../../planning/QUOTE_AMENDMENT53_REGISTRATION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('registers the exact reviewed12-part53 package and immutable52 prefix',()=>{
 expect(registry.migrations).toHaveLength(53);expect(registry.migrations.slice(0,52)).toEqual(previous.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),previous as MigrationRegistry)).not.toThrow();const sql=bytes('supabase/migrations/'+registration.migration.file);expect(sql.length).toBe(registration.bytes);expect(sha256(sql)).toBe(registration.migration.sha256);expect(registry.migrations.at(-1)).toEqual(registration.migration);expect(sha256(bytes('supabase/migration-checksums.json'))).toBe(registration.registrySha256);expect(sha256(bytes('tests/support/registered52-migration-checksums.json'))).toBe(registration.previousRegistrySha256);expect(registration.parts).toHaveLength(12);let end=0;for(const part of registration.parts){const original=bytes(part.path);expect(sha256(original)).toBe(part.sha256);expect(original.length).toBe(part.bytes);expect(sql.subarray(part.offset,part.offset+part.bytes)).toEqual(original);expect(sql.subarray(end,part.offset).toString()).toContain('RESET ROLE;');end=part.offset+part.bytes;}expect(sql.subarray(end).toString()).toContain('RESET ROLE;');
});
it('adds only explicit acceptance kind and paired plan bindings without losing source or secret policies',()=>{
 const expected=structuredClone(previousCoverage);expected.migrationCount=53;expected.tables.find(t=>t.table==='crest.quote_acceptances')!.required.push('kind');expected.tables.find(t=>t.table==='crest.allocation_plan_versions')!.required.push('entitlement_version_id','authorization_state');expect(coverage).toEqual(expected);const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));expect(verifyExportCoverage(coverage,observed,53)).toEqual({assurance:'schema_inventory_only',tables:68,requiredColumns:1058,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});expect(previousCoverage.migrationCount).toBe(52);
});
it('retains exact frozen52 compatibility while admitting53 without activating real data or finance',()=>{
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:53});for(const prior of [registration.previousCoverage,registration.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);expect(registration).toMatchObject({schemaVersion:53,ownerApplied:false,completeCrestExport:false,completeBackup:false,productionActivation:false,runtimeFinancePostingEnabled:false,originalRowsAndHistoryRewritten:false});expect(compatibility.productionActivation).toBe('blocked');
});
