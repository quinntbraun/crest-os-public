import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {recoveryCanonicalSourceProfile,recoverySourceProfileMatches} from '../../src/tooling/recovery-source-profile';
import {financePostingSchema} from '../../src/bookkeeping/finance-posting-schema';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url)),json=(path:string)=>JSON.parse(bytes(path).toString('utf8')),hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const adoption=json('planning/WORKSPACE_EXPORT140_ADOPTION.json');
it('pins140 to the observed SQL and preserves all frozen139 registry, coverage and compatibility bytes',()=>{
 for(const previous of[adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(hash(bytes(previous.file))).toBe(previous.sha256);
 const old=json(adoption.previousRegistry.file),current=json('supabase/migration-checksums.json');expect(current.migrations).toHaveLength(140);expect(current.migrations.slice(0,139)).toEqual(old.migrations);
 expect(current.migrations.at(-1)).toEqual({version:adoption.migration.version,file:adoption.migration.file.split('/').at(-1),sha256:adoption.migration.sha256});expect(hash(bytes(adoption.migration.file))).toBe(adoption.migration.sha256);expect(bytes(adoption.migration.file)).toEqual(bytes('planning/proposals/20270206180000_opening_funds_workspace_export.sql'));expect(hash(bytes('supabase/migration-checksums.json'))).toBe(adoption.migration.registrySha256);
 expect(json('release/compatibility.json')).toEqual({...json(adoption.previousCompatibility.file),schemaMaximum:140});expect(json('planning/SECURITY_EXPORT_COVERAGE.json')).toEqual({...json(adoption.previousCoverage.file),migrationCount:140});
});
it('keeps all three fixed recovery identities and rejects relabelled or future catalogs',()=>{
 for(const version of[138,139,140]){const registry=version===140?adoption.migration.registrySha256:hash(bytes('tests/support/registered'+version+'-migration-checksums.json'));expect(recoveryCanonicalSourceProfile(version,registry).routines.sourceSchemaVersion).toBe(version);}
 expect(recoveryCanonicalSourceProfile(140,adoption.migration.registrySha256)).toMatchObject({registered:true,routines:{routineCount:1286},schema:{objectCount:15613}});
 expect(recoverySourceProfileMatches(140,adoption.previousRegistry.sha256)).toBe(false);expect(()=>recoveryCanonicalSourceProfile(140,adoption.previousRegistry.sha256)).toThrow();expect(recoverySourceProfileMatches(141,adoption.migration.registrySha256)).toBe(false);
});
it('does not turn source registration into installation, posting or completed backups',()=>{
 expect(adoption).toMatchObject({registeredSourceOnly:true,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',openingBalancesApproved:false,openingJournalPosted:false,completePortableExport:false,completeBackup:false});expect(financePostingSchema(140)).toBe(109);expect(financePostingSchema(141)).toBe(141);
});
