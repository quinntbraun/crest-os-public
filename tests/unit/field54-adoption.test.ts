import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sha256,validateMigrationSet} from '../../src/tooling/migrations';
import type {MigrationRegistry} from '../../src/tooling/migrations';
import {verifyExportCoverage} from '../../src/tooling/export-coverage';
import currentRegistry from '../../supabase/migration-checksums.json';
import registered55 from '../support/registered55-migration-checksums.json';
import coverage55 from '../support/registered55-export-coverage.json';
import registered56 from '../support/registered56-migration-checksums.json';
import coverage56 from '../support/registered56-export-coverage.json';
import registered57 from '../support/registered57-migration-checksums.json';
import coverage57 from '../support/registered57-export-coverage.json';
import registered58 from '../support/registered58-migration-checksums.json';
import coverage58 from '../support/registered58-export-coverage.json';
import registered59 from '../support/registered59-migration-checksums.json';
import coverage59 from '../support/registered59-export-coverage.json';
import registered60 from '../support/registered60-migration-checksums.json';
import coverage60 from '../support/registered60-export-coverage.json';
import registered61 from '../support/registered61-migration-checksums.json';
import coverage61 from '../support/registered61-export-coverage.json';
import registry from '../support/registered54-migration-checksums.json';
import previous from '../support/registered53-migration-checksums.json';
import previousCoverage from '../support/registered53-export-coverage.json';
import previousCompatibility from '../support/registered53-compatibility.json';
import coverage from '../support/field54-export-coverage.json';
import currentCoverage from '../../planning/SECURITY_EXPORT_COVERAGE.json';
import compatibility from '../support/registered54-compatibility.json';
import currentCompatibility from '../../release/compatibility.json';
import registration from '../../planning/FIELD54_REGISTRATION.json';
const bytes=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
it('registers the exact reviewed13-part54 package with the entire immutable53 prefix',()=>{
 expect(registry.migrations).toHaveLength(54);expect(registry.migrations.slice(0,53)).toEqual(previous.migrations);expect(()=>validateMigrationSet(registry as MigrationRegistry,new Map(registry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),previous as MigrationRegistry)).not.toThrow();expect(registry.migrations.at(-1)).toEqual(registration.migration);
 const sql=bytes('supabase/migrations/'+registration.migration.file);expect(sql.length).toBe(registration.bytes);expect(sha256(sql)).toBe('ebc88d2029dbac5815415a92f708e1213eaf3edbdcb342d583b925a4f3ff6524');expect(sha256(sql)).toBe(registration.migration.sha256);expect(sha256(bytes('tests/support/registered54-migration-checksums.json'))).toBe(registration.registrySha256);expect(registration.registrySha256).toBe('4834f520561796ce811f3b5a1d9391c3490b472a4f72a6fa9af5f232d3751dac');expect(sha256(bytes('tests/support/registered53-migration-checksums.json'))).toBe(registration.previousRegistrySha256);expect(registration.parts).toHaveLength(13);
 let end=0;for(const part of registration.parts){const original=bytes(part.path);expect(sha256(original)).toBe(part.sha256);expect(original.length).toBe(part.bytes);expect(sql.subarray(part.offset,part.offset+part.bytes)).toEqual(original);expect(sql.subarray(end,part.offset).toString()).toContain('RESET ROLE;');end=part.offset+part.bytes;}expect(sql.subarray(end).toString()).toContain('RESET ROLE;');
});
it('retains every frozen53 source/credential policy and declares only the12 added field tables',()=>{
 expect(coverage.migrationCount).toBe(54);expect(previousCoverage.migrationCount).toBe(53);expect(previousCoverage.tables).toHaveLength(68);expect(coverage.tables.slice(0,68)).toEqual(previousCoverage.tables);expect(coverage.tables).toHaveLength(80);
 expect(coverage.tables.slice(68).map(t=>t.table)).toEqual(['crest.work_intervals','crest.travel_legs','crest.work_scope_outcomes','crest.message_templates','crest.review_requests','crest.messages','crest.message_events','crest.review_request_encounters','crest.job_finalization_tasks','crest.mileage_evidence','crest.leg_job_allocations','crest.operator_occupancy']);
 const observed=coverage.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));expect(verifyExportCoverage(coverage,observed,54)).toMatchObject({tables:80,requiredColumns:1234,excludedColumns:10,completePortableExport:false,completeBackup:false});expect(()=>verifyExportCoverage(coverage,[...observed,{table:'crest.invented_finance',column:'amount'}],54)).toThrow();
});
it('appends only the End Job reader with unchanged source coverage and activation gates',()=>{
 expect(registered55.migrations).toHaveLength(55);
 expect(registered55.migrations.slice(0,54)).toEqual(registry.migrations);
 expect(registered55.migrations.at(-1)?.file).toBe('20261109180000_work_completion_context.sql');
 expect(()=>validateMigrationSet(registered55 as MigrationRegistry,new Map(registered55.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registry as MigrationRegistry)).not.toThrow();
 expect(coverage55).toEqual({...coverage,migrationCount:55});
});
it('registers the exact mileage reader and preserves the frozen55 profiles',()=>{
 expect(sha256(bytes('tests/support/registered55-migration-checksums.json'))).toBe('abc37ebb0d87dc7349f384d168fa9c36e92747fd2c84e452be49e9dc0a3e16db');
 expect(sha256(bytes('tests/support/registered55-export-coverage.json'))).toBe('edc6471bc82f14acf8c8967b3d3f464b68b8554ae4536167175ea8e1850549e2');
 expect(registered56.migrations).toHaveLength(56);
 expect(registered56.migrations.slice(0,55)).toEqual(registered55.migrations);
 const mileage=registered56.migrations.at(-1)!;
 expect(mileage.file).toBe('20261110180000_job_mileage_trips.sql');
 expect(bytes('supabase/migrations/'+mileage.file)).toEqual(bytes('planning/proposals/job-mileage-context.sql'));
 expect(()=>validateMigrationSet(registered56 as MigrationRegistry,new Map(registered56.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered55 as MigrationRegistry)).not.toThrow();
 expect(coverage56).toEqual({...coverage55,migrationCount:56});
});
it('registers only the standalone trip readers after the frozen56 profiles',()=>{
 expect(sha256(bytes('tests/support/registered56-migration-checksums.json'))).toBe('34456dba9fb0bbb250ccc3d0171eefbc238273905dbf8c40f89a19ca9282c8cd');
 expect(sha256(bytes('tests/support/registered56-export-coverage.json'))).toBe('46394feba0ac5b5da97984036726fe251af33eaeb25d9c43d9023ded92d051c2');
 expect(registered57.migrations).toHaveLength(57);
 expect(registered57.migrations.slice(0,56)).toEqual(registered56.migrations);
 const standalone=registered57.migrations.at(-1)!;
 expect(standalone.file).toBe('20261111180000_support_trip_readers.sql');
 expect(bytes('supabase/migrations/'+standalone.file)).toEqual(bytes('planning/proposals/support-trip-reader.sql'));
 expect(()=>validateMigrationSet(registered57 as MigrationRegistry,new Map(registered57.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered56 as MigrationRegistry)).not.toThrow();
 expect(coverage57).toEqual({...coverage56,migrationCount:57});
});
it('appends only the cancellation context and history reader over the frozen standalone profile',()=>{
 expect(sha256(bytes('tests/support/registered57-migration-checksums.json'))).toBe('03bcefe6fba5770cff868b9c6c57b008ac45b0e18b415bd665ec6dd6c1d0781b');
 expect(sha256(bytes('tests/support/registered57-export-coverage.json'))).toBe('eb86b3dcb3ba1098d160ba512fcf9eab25c4c47a6cc2b1edeeaa48def358e47d');
 expect(registered58.migrations).toHaveLength(58);
 expect(registered58.migrations.slice(0,57)).toEqual(registered57.migrations);
 const cancellation=registered58.migrations.at(-1)!;
 expect(cancellation.file).toBe('20261112180000_unfulfilled_cancellation_context.sql');
 expect(bytes('supabase/migrations/'+cancellation.file)).toEqual(bytes('planning/proposals/unfulfilled-cancellation-context.sql'));
 expect(()=>validateMigrationSet(registered58 as MigrationRegistry,new Map(registered58.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered57 as MigrationRegistry)).not.toThrow();
 expect(coverage58).toEqual({...coverage57,migrationCount:58});
});
it('registers only the private work-time history reader after the frozen cancellation profile',()=>{
 expect(sha256(bytes('tests/support/registered58-migration-checksums.json'))).toBe('6de5309bae313563f0481c1f0985d5b28f1231ae714afc88b1ad3fe49bfbf3d0');
 expect(sha256(bytes('tests/support/registered58-export-coverage.json'))).toBe('1fd339235be0ec1abc0de846d36d118d36020c5a107e3121ec21438a844a2628');
 expect(registered59.migrations).toHaveLength(59);
 expect(registered59.migrations.slice(0,58)).toEqual(registered58.migrations);
 const reader=registered59.migrations.at(-1)!;
 expect(reader.file).toBe('20261113180000_job_work_time.sql');
 expect(bytes('supabase/migrations/'+reader.file)).toEqual(bytes('planning/proposals/job-work-time-reader.sql'));
 expect(()=>validateMigrationSet(registered59 as MigrationRegistry,new Map(registered59.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered58 as MigrationRegistry)).not.toThrow();
 expect(coverage59).toEqual({...coverage58,migrationCount:59});
});
it('adopts the exact pause and resume correction after the frozen work-time reader',()=>{
 expect(sha256(bytes('tests/support/registered59-migration-checksums.json'))).toBe('d278abcdbc456cc0fbba5351224d39dea5c4e9d6a26252767d45f88f9ba52620');
 expect(sha256(bytes('tests/support/registered59-export-coverage.json'))).toBe('160d65cad297377a26ca7e99537cb519a1cd230efdaef29f36562085cebc21c5');
 expect(registered60.migrations).toHaveLength(60);
 expect(registered60.migrations.slice(0,59)).toEqual(registered59.migrations);
 const correction=registered60.migrations.at(-1)!;
 expect(correction.file).toBe('20261114180000_job_work_boundary_correction.sql');
 expect(bytes('supabase/migrations/'+correction.file)).toEqual(bytes('planning/proposals/job-work-boundary-correction.sql'));
 expect(()=>validateMigrationSet(registered60 as MigrationRegistry,new Map(registered60.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered59 as MigrationRegistry)).not.toThrow();
 expect(coverage60).toEqual({...coverage59,migrationCount:60});
});
it('appends the exact three reviewed first-start bodies and keeps frozen60 readable',()=>{
 expect(sha256(bytes('tests/support/registered60-migration-checksums.json'))).toBe('352ff53636746f58f583cdef4b02256e145277ed892787cf425bd846022e2bba');
 expect(sha256(bytes('tests/support/registered60-export-coverage.json'))).toBe('eefa78c0caf63edc43914398192dc9f27cbf2cdcfeb4f333acaaa4a235d9002d');
 expect(registered61.migrations).toHaveLength(61);
 expect(registered61.migrations.slice(0,60)).toEqual(registered60.migrations);
 const correction=registered61.migrations.at(-1)!;
 expect(correction.file).toBe('20261115180000_job_work_start_correction.sql');
 const sql=bytes('supabase/migrations/'+correction.file).toString();
 const bodies=['context','correction','access'].map(name=>{
  const file='planning/proposals/job-work-start-'+name+'.sql';
  return '\n-- BEGIN REVIEWED '+file+'\n'+bytes(file).toString()+'\n';
 }).join('');
 expect(sql).toBe('-- BR07 first work start. Exact reviewed bodies followed by private web grants.\n'+bodies+
  'GRANT EXECUTE ON FUNCTION\n crest_commands.read_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),\n'+
  ' crest_commands.correct_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)\n TO crest_web;\n');
 expect(()=>validateMigrationSet(registered61 as MigrationRegistry,new Map(registered61.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered60 as MigrationRegistry)).not.toThrow();
 expect(coverage61).toEqual({...coverage60,migrationCount:61});
});
it('appends only the reviewed completion-time commands and preserves the frozen61 inventory',()=>{
 expect(sha256(bytes('tests/support/registered61-migration-checksums.json'))).toBe('4d57aa9dd35b4a3454a052e40d1436bfa9d7c4bd0066d6bd4f082a469e952c9a');
 expect(sha256(bytes('tests/support/registered61-export-coverage.json'))).toBe('ce1612528cf0c32f98bae9b47aec6dd681ab3d064b798980d47476ac50282b9b');
 expect(currentRegistry.migrations).toHaveLength(62);
 const correction=currentRegistry.migrations.at(-1)!;
 expect(correction.file).toBe('20261116180000_job_work_end_correction.sql');
 const bodies=['context','correction','access'].map(name=>{
  const file='planning/proposals/job-work-end-'+name+'.sql';
  return '\n-- BEGIN REVIEWED '+file+'\n'+bytes(file).toString()+'\n';
 }).join('');
 expect(bytes('supabase/migrations/'+correction.file).toString()).toBe(
  '-- BR07 completed-job time correction. Exact reviewed bodies followed by private web grants.\n'+bodies+
  'GRANT EXECUTE ON FUNCTION\n crest_commands.read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),\n'+
  ' crest_commands.correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)\n TO crest_web;\n');
 expect(()=>validateMigrationSet(currentRegistry as MigrationRegistry,new Map(currentRegistry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered61 as MigrationRegistry)).not.toThrow();
 expect(currentCoverage).toEqual({...coverage61,migrationCount:62});
 expect(currentCompatibility).toEqual({...compatibility,schemaMaximum:62});
});
it('freezes accepted53 coverage and compatibility without production or finance activation',()=>{
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:54});for(const prior of [registration.previousCoverage,registration.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);expect(registration).toMatchObject({schemaVersion:54,ownerApplied:false,completeCrestExport:false,completeBackup:false,productionActivation:false,runtimeFinancePostingEnabled:false,originalRowsAndHistoryRewritten:false,candidateHeaderRetainedByteExact:true});expect(compatibility.productionActivation).toBe('blocked');
});
