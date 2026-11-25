import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
// This historical adoption proof stays pinned to its original registered124
// inputs; current schema coverage is verified against the applied catalog.
import registry from '../support/registered124-migration-checksums.json';
import previous from '../support/registered123-migration-checksums.json';
import coverage from '../support/registered124-export-coverage.json';
import previousCoverage from '../support/registered123-export-coverage.json';
import compatibility from '../support/registered124-compatibility.json';
import previousCompatibility from '../support/registered123-compatibility.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const hash=(path:string)=>createHash('sha256').update(bytes(path)).digest('hex');

it('pins every registered123 input and appends only the124 read projection',()=>{
 expect(hash('tests/support/registered123-migration-checksums.json')).toBe('aa6bb0581e624d755c845be9fee880ea5d918c4fb2e4145ca4fff977625ec33d');
 expect(hash('tests/support/registered123-export-coverage.json')).toBe('e3a1c45b70a1d0e3ef6c1bdd71f921a7ea680184855ef0356cd43e3c97651999');
 expect(hash('tests/support/registered123-compatibility.json')).toBe('44f9260e80ebcf8031855cfb6c4ece7b5d0c453454be82f610dda9180d1dce24');
 expect(previous.migrations).toHaveLength(123);expect(registry.migrations).toHaveLength(124);
 expect(registry.migrations.slice(0,123)).toEqual(previous.migrations);
 const added=registry.migrations[123]!;expect(added.file).toBe('20270117180000_finance_history_recording.sql');expect(hash('supabase/migrations/'+added.file)).toBe(added.sha256);
 for(const entry of previous.migrations)expect(hash('supabase/migrations/'+entry.file)).toBe(entry.sha256);
});
it('preserves source coverage, accounting command versions and the activation block, keeping all registered native checks mandatory',()=>{
 expect(coverage).toEqual({...previousCoverage,migrationCount:124});expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:124});
 expect(compatibility.productionActivation).toBe('blocked');expect(compatibility.commandVersion).toBe(1);
 const script=JSON.parse(bytes('package.json').toString()).scripts['test:finance-registered'].split(' ');
 for(const file of ['invoice-outstanding.test.mjs','invoice-outstanding-recovery.test.mjs','finance-mapping-recording-history.test.mjs','financial-history-recording.test.mjs'])expect(script.filter((arg:string)=>arg==='tests/integration/'+file)).toHaveLength(1);
});
