import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../support/registered51-migration-checksums.json';
import coverage from '../support/registered51-export-coverage.json';
import compatibility from '../support/registered51-compatibility.json';
import previous from '../support/registered50-migration-checksums.json';
import previousCoverage from '../support/registered50-export-coverage.json';
import previousCompatibility from '../support/registered50-compatibility.json';
import adoption from '../../planning/BOOKING_CONFLICT_SCHEMA51_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('appends the exact reviewed51 body without changing any50 migration or role boundary',()=>{
 expect(registry.migrations).toHaveLength(51);expect(registry.migrations.slice(0,50)).toEqual(previous.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),previous as MigrationRegistry)).not.toThrow();
 for(const prior of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);
 const sql=bytes('supabase/migrations/'+adoption.migration.file),body=adoption.proposalBody,original=bytes(body.path);expect(sql.length).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(registry.migrations.at(-1)?.sha256).toBe(adoption.migration.sha256);expect(sha256(bytes('tests/support/registered51-migration-checksums.json'))).toBe(adoption.migration.registrySha256);expect(sha256(original)).toBe(body.sha256);expect(sql.subarray(body.offset,body.offset+body.bytes)).toEqual(original);expect(sql.subarray(0,body.offset).toString()).toContain('RESET ROLE;');expect(sql.subarray(body.offset+body.bytes).toString()).toContain('RESET ROLE;');
 const history=adoption.proposalHistoryBody;expect(sha256(bytes(history.path))).toBe(history.sha256);expect(sql.subarray(history.offset,history.offset+history.bytes)).toEqual(bytes(history.path));expect(sql.subarray(body.offset+body.bytes,history.offset).toString()).toContain('RESET ROLE;');
});
it('retains all physical coverage and credential exclusions with an explicit51 profile',()=>{
 expect(coverage).toEqual({...previousCoverage,migrationCount:51});expect(adoption.sourceTablesAdded).toEqual([]);expect(adoption.sourceColumnsAdded).toBe(0);const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(v=>v.column)].map(column=>({table:t.table,column})));expect(verifyExportCoverage(coverage,observed,51)).toEqual({assurance:'schema_inventory_only',tables:68,requiredColumns:1054,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
});
it('keeps owner upgrade, finance and full real-use release separate from source registration',()=>{
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:51});expect(adoption).toMatchObject({repositoryRegistration:51,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',originalRowsAndHistoryRewritten:false,runtimeFinancePostingEnabled:false,completePortableExport:false,completeBackup:false});expect(adoption.requiredAcceptance.join(' ')).toMatch(/fresh|Fresh/);expect(adoption.requiredAcceptance.join(' ')).toMatch(/Calendar/);
});
