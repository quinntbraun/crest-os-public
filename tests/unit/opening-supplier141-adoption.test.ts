import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openingSupplier141SourceProfile as profile} from '../../src/tooling/opening-supplier141-catalog.ts';
import {openingSupplier141SourceInventory} from '../../src/tooling/opening-supplier141-source-inventory.ts';
import {recoveryCanonicalSourceProfile} from '../../src/tooling/recovery-source-profile.ts';
import {financePostingSchema} from '../../src/bookkeeping/finance-posting-schema.ts';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url)),json=(path:string)=>JSON.parse(bytes(path).toString('utf8')),hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const adoption=json('planning/OPENING_SUPPLIER141_ADOPTION.json');
it('registers the exact rehearsed package and preserves every held SQL part byte',()=>{
 const old=json(adoption.previousRegistry.file),current=json('tests/support/registered141-migration-checksums.json'),source=bytes(adoption.migration.file);
 expect(current.migrations).toHaveLength(141);expect(current.migrations.slice(0,140)).toEqual(old.migrations);expect(hash(bytes('tests/support/registered141-migration-checksums.json'))).toBe(profile.migrationRegistrySha256);expect(hash(source)).toBe(profile.migrationSha256);
 expect(current.migrations.at(-1)).toEqual({version:adoption.migration.version,file:adoption.migration.file.split('/').at(-1),sha256:adoption.migration.sha256});
 expect(adoption.parts).toHaveLength(10);for(const part of adoption.parts){const original=bytes(part.path);expect(hash(original)).toBe(part.sha256);expect(source.subarray(part.offset,part.offset+part.bytes)).toEqual(original);}
 for(const prior of[adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(hash(bytes(prior.file))).toBe(prior.sha256);
});
it('covers all196 fixed source tables and retains the frozen140 prefix and release hold',()=>{
 const prior=json(adoption.previousCoverage.file),current=json('tests/support/registered141-security-export-coverage.json');expect(current.migrationCount).toBe(141);expect(current.tables.slice(0,prior.tables.length)).toEqual(prior.tables);expect(current.tables).toHaveLength(196);expect(current.tables.map((row:{table:string})=>row.table).sort()).toEqual(openingSupplier141SourceInventory.map(row=>row.source));expect(new Set(current.tables.map((row:{table:string})=>row.table)).size).toBe(196);
 expect(json('tests/support/registered141-compatibility.json')).toEqual({...json(adoption.previousCompatibility.file),schemaMaximum:141});expect(adoption.businessSourceCount).toBe(174);
});
it('keeps schema109 financial semantics and does not equate registration with production approval',()=>{
 expect(recoveryCanonicalSourceProfile(141,profile.migrationRegistrySha256)).toMatchObject({registered:true,routines:{routineCount:1323},schema:{objectCount:15859}});expect(financePostingSchema(141)).toBe(109);expect(financePostingSchema(142)).toBe(109);expect(financePostingSchema(143)).toBe(143);
 expect(adoption).toMatchObject({registeredSourceOnly:true,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',openingBalancesApproved:false,openingJournalPosted:false,completePortableExport:false,completeBackup:false});
});
