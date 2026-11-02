import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import {bookingRecordGroups,bookingRecordSchema} from '../../src/operations/confirmed-booking-records';
import registry from '../../supabase/migration-checksums.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import prior from '../support/registered49-migration-checksums.json';
import priorCoverage from '../support/registered49-export-coverage.json';
import priorCompatibility from '../support/registered49-compatibility.json';
import adoption from '../../planning/CONFIRMED_BOOKINGS_SCHEMA50_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('appends50 without changing any49 migration and preserves all17 tested SQL bodies and role boundaries',()=>{
 expect(registry.migrations).toHaveLength(50);expect(registry.migrations.slice(0,49)).toEqual(prior.migrations);
 expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),prior as MigrationRegistry)).not.toThrow();
 for(const p of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(sha256(bytes(p.frozenFixture))).toBe(p.sha256);
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(sql.length).toBe(adoption.migration.bytes);expect(registry.migrations.at(-1)?.sha256).toBe(adoption.migration.sha256);expect(adoption.proposalBodies).toHaveLength(17);
 let end=0;for(const body of adoption.proposalBodies){const original=bytes(body.path);expect(body.offset).toBeGreaterThan(end);expect(body.bytes).toBe(original.length);expect(sha256(original)).toBe(body.sha256);expect(sql.subarray(body.offset,body.offset+body.bytes)).toEqual(original);expect(sql.subarray(end,body.offset).toString()).toContain('RESET ROLE;');end=body.offset+body.bytes;}expect(sql.subarray(end).toString()).toContain('RESET ROLE;');expect(adoption.resetCallerRoleBetweenBodies).toBe(true);
});
it('adds all154 declared source columns and keeps every old table and credential exclusion unchanged',()=>{
 expect(coverage.migrationCount).toBe(50);expect(coverage.tables).toHaveLength(68);expect(coverage.tables.slice(0,priorCoverage.tables.length)).toEqual(priorCoverage.tables);expect(adoption.sourceTables).toEqual(bookingRecordGroups.map(g=>'crest.'+g));
 for(const group of bookingRecordGroups){const table=coverage.tables.find(t=>t.table==='crest.'+group);expect(table).toMatchObject({scope:'business',required:Object.keys(bookingRecordSchema[group]),excluded:[],partialEvidenceGroup:null});}
 const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(v=>v.column)].map(column=>({table:t.table,column})));expect(observed).toHaveLength(1064);expect(verifyExportCoverage(coverage,observed,50)).toEqual({assurance:'schema_inventory_only',tables:68,requiredColumns:1054,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});expect(coverage.tables.flatMap(t=>t.excluded)).toEqual(priorCoverage.tables.flatMap(t=>t.excluded));
});
it('keeps repository registration separate from synthetic owner migration, runtime and real-use approval',()=>{
 expect(compatibility).toEqual({...priorCompatibility,schemaMaximum:50});expect(compatibility.productionActivation).toBe('blocked');expect(adoption).toMatchObject({repositoryRegistration:50,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',runtimeSchedulingEnabled:false,runtimeFinancePostingEnabled:false,completePortableExport:false,completeBackup:false});expect(adoption.requiredAcceptance.join(' ')).toMatch(/browser/);expect(adoption.requiredAcceptance.join(' ')).toMatch(/phone/);expect(adoption.remainingV1).toContain('approved Google Calendar capability');
});
