import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import {expenseSourceTables} from '../../src/bookkeeping/expenses/expense-source-csv';
import registry from '../../supabase/migration-checksums.json';
import coverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../../release/compatibility.json';
import prior from '../support/registered48-migration-checksums.json';
import priorCoverage from '../support/registered48-export-coverage.json';
import priorCompatibility from '../support/registered48-compatibility.json';
import adoption from '../../planning/OWNER_EXPENSES_SCHEMA49_ADOPTION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('appends49 with exact frozen48 provenance and all seven reviewed bodies',()=>{
 expect(registry.migrations).toHaveLength(49);expect(registry.migrations.slice(0,48)).toEqual(prior.migrations);
 expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),prior as MigrationRegistry)).not.toThrow();
 for(const entry of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(sha256(bytes(entry.frozenFixture))).toBe(entry.sha256);
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(sql.length).toBe(adoption.migration.bytes);expect(adoption.proposalBodies).toHaveLength(7);
 let end=0;for(const body of adoption.proposalBodies){const original=bytes(body.path);expect(body.offset).toBeGreaterThan(end);expect(original.length).toBe(body.bytes);expect(sha256(original)).toBe(body.sha256);expect(sql.subarray(body.offset,body.offset+body.bytes)).toEqual(original);expect(sql.subarray(end,body.offset).toString()).toContain('RESET ROLE;');end=body.offset+body.bytes;}
 expect(sql.subarray(end).toString()).toContain('RESET ROLE;');expect(adoption.resetCallerRoleBetweenBodies).toBe(true);
});
it('declares all17 real composite-key source columns without changing credential exclusions',()=>{
 expect(coverage.migrationCount).toBe(49);expect(coverage.tables).toHaveLength(56);expect(coverage.tables.filter(t=>!adoption.financialTables.includes(t.table))).toEqual(priorCoverage.tables);
 for(const spec of Object.values(expenseSourceTables)){const table=coverage.tables.find(t=>t.table==='crest.'+spec.entity);expect(table?.required).toEqual([...spec.columns]);expect(table?.excluded).toEqual([]);expect(table?.required).not.toContain('id');expect(table?.required).not.toContain('created_by');expect(table?.required).not.toContain('created_at');}
 const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(v=>v.column)].map(column=>({table:t.table,column})));expect(observed).toHaveLength(910);expect(verifyExportCoverage(coverage,observed,49)).toMatchObject({tables:56,requiredColumns:900,excludedColumns:10,completePortableExport:false,completeBackup:false});
 expect(coverage.tables.flatMap(t=>t.excluded)).toEqual(priorCoverage.tables.flatMap(t=>t.excluded));
});
it('keeps schema compatibility separate from owner migration and financial activation',()=>{
 expect(compatibility).toEqual({...priorCompatibility,schemaMaximum:49});expect(compatibility.productionActivation).toBe('blocked');expect(adoption).toMatchObject({repositoryRegistration:49,ownerDatabaseApplied:false,productionActivation:'blocked',runtimeExpenseEnabled:false,runtimeFinancePostingEnabled:false,completePortableExport:false,completeBackup:false});expect(adoption.requiredAcceptance.join(' ')).toMatch(/independent|Independent/);expect(adoption.requiredAcceptance.join(' ')).toMatch(/phone/);
});
