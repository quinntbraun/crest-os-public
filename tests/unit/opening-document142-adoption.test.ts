import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openingDocument142SourceProfile as profile} from '../../src/tooling/opening-document142-catalog.ts';
import {openingDocument142SourceInventory} from '../../src/tooling/opening-document142-source-inventory.ts';
import {currentBusinessSourceInventory142} from '../../src/security/current-business-source-inventory.ts';
import {recoveryCanonicalSourceProfile} from '../../src/tooling/recovery-source-profile.ts';
import {readRecoveryCaptureRegistry} from '../../src/tooling/recovery-capture-registry.ts';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url)),json=(path:string)=>JSON.parse(bytes(path).toString()),hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex'),adoption=json('planning/OPENING_DOCUMENT142_ADOPTION.json');
it('registers the exact restored142 package and retains all141 migration identities',()=>{
 const prior=json(adoption.previousRegistry.file),current=json('supabase/migration-checksums.json'),source=bytes(adoption.migration.file);expect(current.migrations).toHaveLength(142);expect(current.migrations.slice(0,141)).toEqual(prior.migrations);expect(hash(bytes('supabase/migration-checksums.json'))).toBe(profile.migrationRegistrySha256);expect(hash(source)).toBe(profile.migrationSha256);expect(adoption.parts).toHaveLength(5);
 for(const part of adoption.parts){const original=bytes(part.path);expect(hash(original)).toBe(part.sha256);expect(source.subarray(part.offset,part.offset+part.bytes)).toEqual(original);}
 for(const old of[adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(hash(bytes(old.file))).toBe(old.sha256);
 expect(readRecoveryCaptureRegistry(bytes('supabase/migration-checksums.json')).sourceSchemaVersion).toBe(142);
});
it('adds exactly two source tables and preserves prior coverage and blocked compatibility',()=>{
 const prior=json(adoption.previousCoverage.file),current=json('planning/SECURITY_EXPORT_COVERAGE.json');expect(current.migrationCount).toBe(142);expect(current.tables.slice(0,prior.tables.length)).toEqual(prior.tables);expect(current.tables).toHaveLength(198);expect(current.tables.map((row:{table:string})=>row.table).sort()).toEqual(openingDocument142SourceInventory.map(row=>row.source));expect(currentBusinessSourceInventory142).toHaveLength(176);expect(json('release/compatibility.json')).toEqual({...json(adoption.previousCompatibility.file),schemaMaximum:142});
});
it('does not treat registration as installed production or approved opening balances',()=>{
 expect(recoveryCanonicalSourceProfile(142,profile.migrationRegistrySha256)).toMatchObject({registered:true,routines:{routineCount:1337},schema:{objectCount:15982}});expect(adoption).toMatchObject({registeredSourceOnly:true,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',openingBalancesApproved:false,openingJournalPosted:false,completePortableExport:false,completeBackup:false});
});
