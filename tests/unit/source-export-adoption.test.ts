import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations.ts';
import type {MigrationRegistry} from '../../src/tooling/migrations.ts';
import registry from '../support/registered43-migration-checksums.json';
import legacy from '../support/registered42-migration-checksums.json';
import adoption from '../../planning/SOURCE_EXPORT_SCHEMA43_ADOPTION.json';
import compatibility from '../support/registered43-compatibility.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('appends one checksummed journal migration and retains every reviewed42 migration entry and body',()=>{
 const files=new Map(registry.migrations.map(entry=>[entry.file,bytes('supabase/migrations/'+entry.file)]));expect(registry.migrations).toHaveLength(43);expect(registry.migrations.slice(0,42)).toEqual(legacy.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,files,legacy as MigrationRegistry)).not.toThrow();expect(registry.migrations[42]).toEqual({version:adoption.migration.file.slice(0,14),file:adoption.migration.file,sha256:adoption.migration.sha256});expect(sha256(bytes('tests/support/registered42-migration-checksums.json'))).toBe(adoption.previousRegistry.sha256);
});
it('retains all seven original SQL bodies byte-for-byte in their reviewed dependency order',()=>{
 const sql=bytes('supabase/migrations/'+adoption.migration.file);expect(sql.byteLength).toBe(adoption.migration.bytes);expect(sha256(sql)).toBe(adoption.migration.sha256);expect(adoption.proposalBodies.map(e=>e.path)).toEqual(['jobs','snapshots','parts','ready','journal-reads','request-resolution','owner-reads'].map(n=>'planning/proposals/source-export-'+n+'.sql'));let end=0;
 for(const [i,entry]of adoption.proposalBodies.entries()){expect(entry.order).toBe(i+1);expect(entry.offset).toBeGreaterThan(end);const original=bytes(entry.path);expect(original.byteLength).toBe(entry.bytes);expect(sha256(original)).toBe(entry.sha256);expect(sql.subarray(entry.offset,entry.offset+entry.bytes)).toEqual(original);end=entry.offset+entry.bytes;}
 expect(adoption.journalTables).toHaveLength(6);expect(adoption.requiredJournalColumns).toBe(114);
});
it('retains command/report compatibility and production/completeness gates during registration construction',()=>{
 expect(compatibility).toEqual({schemaVersion:1,appVersion:'0.1.0',databaseMajor:17,schemaMinimum:0,schemaMaximum:43,reportVersion:0,commandVersion:1,productionActivation:'blocked'});expect(adoption).toMatchObject({repositoryRegistration:43,databaseApplied:false,productionActivation:'blocked',completePortableExport:false,completeBackup:false,sourceCoverage:{tables:39,requiredColumns:603,excludedCredentialColumns:10,actualRegistered43CatalogVerified:false}});
});
