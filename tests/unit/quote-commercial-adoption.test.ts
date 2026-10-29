import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import registry from '../../supabase/migration-checksums.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import prior from '../support/registered47-migration-checksums.json';
import priorCoverage from '../support/registered47-export-coverage.json';
import priorCompatibility from '../support/registered47-compatibility.json';
import adoption from '../../planning/QUOTE_ACCEPTANCE_SCHEMA48_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(v=>v.column)].map(column=>({table:t.table,column})));
it('appends48 preserving every47 hash and both original proposal byte sequences in order',()=>{
  expect(prior.migrations).toHaveLength(47);expect(registry.migrations).toHaveLength(48);expect(registry.migrations.slice(0,47)).toEqual(prior.migrations);
  expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(v=>[v.file,bytes('supabase/migrations/'+v.file)])),prior as MigrationRegistry)).not.toThrow();
  const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sql.length).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(adoption.proposalBodies).toHaveLength(2);
  let previousEnd=0;for(const [index,body] of adoption.proposalBodies.entries()){const original=bytes(body.path);expect(body.order).toBe(index+1);expect(body.offset).toBeGreaterThan(previousEnd);expect(original.length).toBe(body.bytes);expect(sha256(original)).toBe(body.sha256);expect(sql.subarray(body.offset,body.offset+body.bytes)).toEqual(original);if(index>0)expect(sql.subarray(previousEnd,body.offset).toString()).toContain('RESET ROLE;');previousEnd=body.offset+body.bytes;}
  expect(sql.toString().trimEnd().endsWith('RESET ROLE;')).toBe(true);expect(adoption.resetCallerRoleBetweenBodies).toBe(true);
});
it('freezes exact committed47 profiles without relabeling their identities',()=>{
  for(const previous of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(sha256(bytes(previous.frozenFixture))).toBe(previous.sha256);
  expect(adoption.previousSourceCommit).toBe('2e89e7113c5c547204858214923608f9ed108545');expect(priorCoverage.migrationCount).toBe(47);expect(priorCoverage.tables).toHaveLength(47);expect(priorCompatibility.schemaMaximum).toBe(47);expect(compatibility).toEqual({...priorCompatibility,schemaMaximum:48});
});
it('inventories all130 commercial columns and preserves the ten credential exclusions',()=>{
  expect(observed).toHaveLength(893);expect(verifyExportCoverage(coverage,observed,48)).toEqual({assurance:'schema_inventory_only',tables:54,requiredColumns:883,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
  expect(coverage.tables.reduce((n,t)=>n+t.required.length,0)-priorCoverage.tables.reduce((n,t)=>n+t.required.length,0)).toBe(130);expect(coverage.tables.flatMap(t=>t.excluded)).toEqual(priorCoverage.tables.flatMap(t=>t.excluded));expect(()=>verifyExportCoverage(priorCoverage,observed,47)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it.each(adoption.commercialTables)('refuses omitted registered commercial fields: %s',table=>{
  const omitted=structuredClone(coverage);omitted.tables.find(t=>t.table===table)!.required.pop();expect(()=>verifyExportCoverage(omitted,observed,48)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it('keeps repository registration separate from production, full export and unfinishedV1 acceptance',()=>{
  expect(adoption).toMatchObject({repositoryRegistration:48,databaseApplied:false,productionActivation:'blocked',legacyProfiles:[42,43,44,45,46,47],runtimeCommercialEnabled:false,registeredCommercialWorkerEnabled:false,completePortableExport:false,completeBackup:false,sourceCoverage:{actualRegistered48CommercialVerified:true},nativeAcceptance:{tests:8,passed:8,failed:0,skipped:0,realCrestDatabaseApplied:false,genuineAuthHttpVerified:false,browserVerified:false}});expect(compatibility.productionActivation).toBe('blocked');expect(adoption.unfinishedV1.join(' ')).toMatch(/Decline\/cancel/);expect(adoption.unfinishedV1.join(' ')).toMatch(/amendments/);
});
