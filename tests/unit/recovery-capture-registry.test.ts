import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {readRecoveryCaptureRegistry} from '../../src/tooling/recovery-capture-registry.ts';
import {openingFunds139SourceProfile as candidate} from '../../src/tooling/opening-funds139-catalog.ts';
import {recoveryRoutineBaseline138} from '../../src/tooling/recovery-routine-baseline138.ts';
const original=await readFile(new URL('../support/registered138-migration-checksums.json',import.meta.url));
const registry139=JSON.parse(original.toString('utf8'));
registry139.migrations.push({version:'20270205183000',file:'20270205183000_fictional_opening_funds_sources.sql',sha256:candidate.migrationSha256});
const candidateBytes=Buffer.from(JSON.stringify(registry139,null,2)+'\n');
it('binds the original registry and exact migration list to reviewed138 fingerprints',()=>{
 const parsed=readRecoveryCaptureRegistry(original);expect(parsed.sourceSchemaVersion).toBe(138);
 expect(parsed.registrySha256).toBe(recoveryRoutineBaseline138.migrationRegistrySha256);expect(parsed.migrations).toHaveLength(138);
 expect(Object.isFrozen(parsed.migrations[0])).toBe(true);expect(Object.isFrozen(parsed.migrations)).toBe(true);
});
it('selects only the exact reviewed139 registry without registering or installing it',()=>{
 const parsed=readRecoveryCaptureRegistry(candidateBytes);expect(parsed.sourceSchemaVersion).toBe(139);
 expect(parsed.registrySha256).toBe(candidate.migrationRegistrySha256);
 expect(parsed.migrations.at(-1)).toEqual({version:'20270205183000',name:'fictional_opening_funds_sources'});
});
it.each(['checksum','version','name','count','whitespace'])('refuses %s drift even with a plausible version number',field=>{
 const changed=structuredClone(registry139);
 if(field==='checksum')changed.migrations.at(-1).sha256='a'.repeat(64);
 if(field==='version')changed.migrations.at(-1).version='20270206183000';
 if(field==='name')changed.migrations.at(-1).file='20270205183000_other_sources.sql';
 if(field==='count')changed.migrations.push({...changed.migrations.at(-1)});
 const bytes=Buffer.from(JSON.stringify(changed,null,2)+(field==='whitespace'?'\n\n':'\n'));
 expect(()=>readRecoveryCaptureRegistry(bytes)).toThrow();
});
it('refuses malformed or duplicate-key registries',()=>{
 for(const source of ['null','{}','{"migrations":[]}','{"migrations":[],"migrations":[]}'])expect(()=>readRecoveryCaptureRegistry(Buffer.from(source))).toThrow();
});
