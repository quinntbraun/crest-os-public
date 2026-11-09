import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import currentRegistry from '../../supabase/migration-checksums.json';
import registry from '../support/registered54-migration-checksums.json';
import previous from '../support/registered53-migration-checksums.json';
import previousCoverage from '../support/registered53-export-coverage.json';
import previousCompatibility from '../support/registered53-compatibility.json';
import coverage from '../support/field54-export-coverage.json';
import currentCoverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../support/registered54-compatibility.json';
import currentCompatibility from '../../release/compatibility.json';
import registration from '../../planning/FIELD54_REGISTRATION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('registers the exact reviewed13-part54 package with the entire immutable53 prefix',()=>{
 expect(registry.migrations).toHaveLength(54);expect(registry.migrations.slice(0,53)).toEqual(previous.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),previous as MigrationRegistry)).not.toThrow();expect(registry.migrations.at(-1)).toEqual(registration.migration);
 const sql=bytes('supabase/migrations/'+registration.migration.file);expect(sql.length).toBe(registration.bytes);expect(sha256(sql)).toBe('ebc88d2029dbac5815415a92f708e1213eaf3edbdcb342d583b925a4f3ff6524');expect(sha256(sql)).toBe(registration.migration.sha256);expect(sha256(bytes('tests/support/registered54-migration-checksums.json'))).toBe(registration.registrySha256);expect(registration.registrySha256).toBe('4834f520561796ce811f3b5a1d9391c3490b472a4f72a6fa9af5f232d3751dac');expect(sha256(bytes('tests/support/registered53-migration-checksums.json'))).toBe(registration.previousRegistrySha256);expect(registration.parts).toHaveLength(13);
 let end=0;for(const part of registration.parts){const original=bytes(part.path);expect(sha256(original)).toBe(part.sha256);expect(original.length).toBe(part.bytes);expect(sql.subarray(part.offset,part.offset+part.bytes)).toEqual(original);expect(sql.subarray(end,part.offset).toString()).toContain('RESET ROLE;');end=part.offset+part.bytes;}expect(sql.subarray(end).toString()).toContain('RESET ROLE;');
});
it('retains every frozen53 source/credential policy and declares only the12 added field tables',()=>{
 expect(coverage.migrationCount).toBe(54);expect(previousCoverage.migrationCount).toBe(53);expect(previousCoverage.tables).toHaveLength(68);expect(coverage.tables.slice(0,68)).toEqual(previousCoverage.tables);expect(coverage.tables).toHaveLength(80);
 expect(coverage.tables.slice(68).map(t=>t.table)).toEqual(['crest.work_intervals','crest.travel_legs','crest.work_scope_outcomes','crest.message_templates','crest.review_requests','crest.messages','crest.message_events','crest.review_request_encounters','crest.job_finalization_tasks','crest.mileage_evidence','crest.leg_job_allocations','crest.operator_occupancy']);
 const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));expect(verifyExportCoverage(coverage,observed,54)).toMatchObject({tables:80,requiredColumns:1234,excludedColumns:10,completePortableExport:false,completeBackup:false});expect(()=>verifyExportCoverage(coverage,[...observed,{table:'crest.invented_finance',column:'amount'}],54)).toThrow();
});
it('appends only the End Job reader with unchanged source coverage and activation gates',()=>{
 expect(currentRegistry.migrations).toHaveLength(55);
 expect(currentRegistry.migrations.slice(0,54)).toEqual(registry.migrations);
 expect(currentRegistry.migrations.at(-1)?.file).toBe('20261109180000_work_completion_context.sql');
 expect(()=>validateMigrationSet(currentRegistry as MigrationRegistry,new Map(currentRegistry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registry as MigrationRegistry)).not.toThrow();
 expect(currentCoverage).toEqual({...coverage,migrationCount:55});
 expect(currentCompatibility).toEqual({...compatibility,schemaMaximum:55});
});
it('freezes accepted53 coverage and compatibility without production or finance activation',()=>{
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:54});for(const prior of [registration.previousCoverage,registration.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);expect(registration).toMatchObject({schemaVersion:54,ownerApplied:false,completeCrestExport:false,completeBackup:false,productionActivation:false,runtimeFinancePostingEnabled:false,originalRowsAndHistoryRewritten:false,candidateHeaderRetainedByteExact:true});expect(compatibility.productionActivation).toBe('blocked');
});
