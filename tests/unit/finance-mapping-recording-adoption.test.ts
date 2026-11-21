import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import registry from '../support/registered123-migration-checksums.json';
import previous from '../support/registered122-migration-checksums.json';
import coverage from '../support/registered123-export-coverage.json';
import previousCoverage from '../support/registered122-export-coverage.json';
import compatibility from '../support/registered123-compatibility.json';
import previousCompatibility from '../support/registered122-compatibility.json';

const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const hash=(path:string)=>createHash('sha256').update(bytes(path)).digest('hex');
it('pins the unchanged registered122 inputs and appends exactly the separate recording-history reader',()=>{
 expect(hash('tests/support/registered122-migration-checksums.json')).toBe('b058f60826c57db95730b9b601572fea9db1f77340473debc6ee758527c04e3e');
 expect(hash('tests/support/registered122-export-coverage.json')).toBe('d5d40657d1a76bfcc1fb9c369b8992469215b1823c1d2fcc6e1d98e8d55a34b4');
 expect(hash('tests/support/registered122-compatibility.json')).toBe('d0167366c94d90a4ad10fef6b04afc5d75487b8d956c41c02b0906ad9862eacf');
 expect(previous.migrations).toHaveLength(122);expect(registry.migrations).toHaveLength(123);
 expect(registry.migrations.slice(0,122)).toEqual(previous.migrations);
 const added=registry.migrations[122]!;expect(added.file).toBe('20270116180000_finance_mapping_recording_history.sql');
 expect(hash('supabase/migrations/'+added.file)).toBe(added.sha256);
 for(const entry of previous.migrations)expect(hash('supabase/migrations/'+entry.file)).toBe(entry.sha256);
});
it('adds no persisted source fields, accounting command version or activation authority',()=>{
 expect(coverage).toEqual({...previousCoverage,migrationCount:123});
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:123});
 expect(compatibility.productionActivation).toBe('blocked');expect(compatibility.commandVersion).toBe(1);
});
