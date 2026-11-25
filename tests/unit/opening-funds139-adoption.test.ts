import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openingFundsSourceCoverage} from '../../src/bookkeeping/opening-funds-source.ts';
import {openingFunds139SourceInventory} from '../../src/tooling/opening-funds139-source-profile.ts';
import {financePostingSchema} from '../../src/bookkeeping/finance-posting-schema.ts';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const json=(path:string)=>JSON.parse(bytes(path).toString('utf8'));
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const adoption=json('planning/OPENING_FUNDS_SCHEMA139_ADOPTION.json');
it('preserves exact138 registry, coverage and compatibility while adding one reviewed migration',()=>{
 for(const prior of [adoption.previousRegistry,adoption.previousCoverage,adoption.previousCompatibility])expect(hash(bytes(prior.file))).toBe(prior.sha256);
 const old=json(adoption.previousRegistry.file),current=json('tests/support/registered139-migration-checksums.json');
 expect(current.migrations.slice(0,-1)).toEqual(old.migrations);expect(current.migrations).toHaveLength(139);
 expect(current.migrations.at(-1)).toEqual({version:adoption.migration.version,file:adoption.migration.file.split('/').at(-1),sha256:adoption.migration.sha256});
 expect(hash(bytes(adoption.migration.file))).toBe(adoption.migration.sha256);expect(hash(bytes('tests/support/registered139-migration-checksums.json'))).toBe(adoption.migration.registrySha256);
 expect(json('tests/support/registered139-compatibility.json')).toEqual({...json(adoption.previousCompatibility.file),schemaMaximum:139});
});
it('covers all192 noncredential sources once while retaining the old coverage unchanged',()=>{
 const previous=json(adoption.previousCoverage.file),current=json('tests/support/registered139-security-export-coverage.json');
 expect(current).toEqual({...previous,migrationCount:139,tables:[...previous.tables,...openingFundsSourceCoverage]});
 expect(openingFunds139SourceInventory).toHaveLength(192);expect(new Set(openingFunds139SourceInventory.map(row=>row.source)).size).toBe(192);
 expect(openingFunds139SourceInventory.map(row=>row.source)).toEqual(current.tables.map((row:{table:string})=>row.table).sort());
 for(const source of openingFunds139SourceInventory){const reviewed=current.tables.find((row:{table:string})=>row.table===source.source);expect(source.columns).toEqual(reviewed.required);expect([...source.excluded].sort()).toEqual(reviewed.excluded.map((row:{column:string})=>row.column).sort());}
});
it('does not treat source registration as installation, opening approval or completed backups',()=>{
 expect(adoption).toMatchObject({registeredSourceOnly:true,ownerDatabaseApplied:false,productionDatabaseApplied:false,productionActivation:'blocked',openingBalancesApproved:false,openingJournalPosted:false,completePortableExport:false,completeBackup:false});
 expect(financePostingSchema(139)).toBe(109);expect(financePostingSchema(141)).toBe(141);
});
