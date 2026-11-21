import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import registry from '../support/registered122-migration-checksums.json';
import frozen from '../support/registered121-migration-checksums.json';
import coverage from '../support/registered122-export-coverage.json';
import frozenCoverage from '../support/registered121-export-coverage.json';
import compatibility from '../support/registered122-compatibility.json';
import frozenCompatibility from '../support/registered121-compatibility.json';

const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const hash=(path:string)=>createHash('sha256').update(bytes(path)).digest('hex');
it('adds the exact tested read-only migration while preserving every121 registered byte',()=>{
 expect(registry.migrations).toHaveLength(122);expect(registry.migrations.slice(0,121)).toEqual(frozen.migrations);
 const last=registry.migrations.at(-1)!;expect(last.file).toBe('20270115180000_invoice_outstanding.sql');
 expect(bytes('supabase/migrations/'+last.file).equals(bytes('planning/proposals/invoice-outstanding-read.sql'))).toBe(true);
 expect(last.sha256).toBe('a31c29b9e597c130ef8d14831b0edf6473e920e45aa024ba15caecaefeb91f30');
 for(const migration of frozen.migrations)expect(hash('supabase/migrations/'+migration.file)).toBe(migration.sha256);
 expect(hash('tests/support/registered121-migration-checksums.json')).toBe('a191fb766f88caf79a6c2eecd3459d001357e519da875117acf9549368d4f167');
 expect(hash('tests/support/registered121-export-coverage.json')).toBe('1ce3baedfffa812a252249f770b31809e469995b20b3b36cd7f8f971d64e8aa0');
 expect(hash('tests/support/registered121-compatibility.json')).toBe('dc8084ddc50edfe7ca1b310db3e115d4dec5b6a6563270c222117327dcda8918');
});
it('adds no persisted source columns or activation authority and keeps both native files mandatory',()=>{
 expect(coverage).toEqual({...frozenCoverage,migrationCount:122});expect(compatibility).toEqual({...frozenCompatibility,schemaMaximum:122});
 expect(compatibility.productionActivation).toBe('blocked');
 const scripts=JSON.parse(bytes('package.json').toString()).scripts;
 for(const path of ['tests/integration/invoice-outstanding.test.mjs','tests/integration/invoice-outstanding-recovery.test.mjs'])expect(scripts['test:finance-registered'].split(' ').filter((item:string)=>item===path)).toHaveLength(1);
});
