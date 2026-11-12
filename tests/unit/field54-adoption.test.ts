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
import registered62 from '../support/registered62-migration-checksums.json';
import coverage62 from '../support/registered62-export-coverage.json';
import registered63 from '../support/registered63-migration-checksums.json';
import coverage63 from '../support/registered63-export-coverage.json';
import registered64 from '../support/registered64-migration-checksums.json';
import coverage64 from '../support/registered64-export-coverage.json';
import registered65 from '../support/registered65-migration-checksums.json';
import coverage65 from '../support/registered65-export-coverage.json';
import registered66 from '../support/registered66-migration-checksums.json';
import coverage66 from '../support/registered66-export-coverage.json';
import registered67 from '../support/registered67-migration-checksums.json';
import coverage67 from '../support/registered67-export-coverage.json';
import registered68 from '../support/registered68-migration-checksums.json';
import coverage68 from '../support/registered68-export-coverage.json';
import registered69 from '../support/registered69-migration-checksums.json';
import coverage69 from '../support/registered69-export-coverage.json';
import registered70 from '../support/registered70-migration-checksums.json';
import coverage70 from '../support/registered70-export-coverage.json';
import registered71 from '../support/registered71-migration-checksums.json';
import coverage71 from '../support/registered71-export-coverage.json';
import {financeAccountSourceColumns,financeTaxSourceColumns} from '../../src/bookkeeping/finance-account-source.ts';
import {pickupCustodySourceColumns} from '../../src/operations/pickup-custody-source.ts';
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
 expect(registered62.migrations).toHaveLength(62);
 const correction=registered62.migrations.at(-1)!;
 expect(correction.file).toBe('20261116180000_job_work_end_correction.sql');
 const bodies=['context','correction','access'].map(name=>{
  const file='planning/proposals/job-work-end-'+name+'.sql';
  return '\n-- BEGIN REVIEWED '+file+'\n'+bytes(file).toString()+'\n';
 }).join('');
 expect(bytes('supabase/migrations/'+correction.file).toString()).toBe(
  '-- BR07 completed-job time correction. Exact reviewed bodies followed by private web grants.\n'+bodies+
  'GRANT EXECUTE ON FUNCTION\n crest_commands.read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),\n'+
  ' crest_commands.correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)\n TO crest_web;\n');
 expect(()=>validateMigrationSet(registered62 as MigrationRegistry,new Map(registered62.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered61 as MigrationRegistry)).not.toThrow();
 expect(coverage62).toEqual({...coverage61,migrationCount:62});
});
it('registers only the reviewed Mobile departure commands and preserves frozen schema 62',()=>{
 expect(sha256(bytes('tests/support/registered62-migration-checksums.json'))).toBe('87f44c7c0e0bf12157d38c263616ff9549f4782286fe452ce1856cfe75d15003');
 expect(sha256(bytes('tests/support/registered62-export-coverage.json'))).toBe('2c1c15a3f545df5557c597d62ad49ae92dbe1f42b6d0bf94116d2a05fd90b351');
 expect(registered63.migrations).toHaveLength(63);
 const correction=registered63.migrations.at(-1)!;
 expect(correction.file).toBe('20261117180000_mobile_trip_departure_correction.sql');
 const bodies=['context','correction','access'].map(name=>{
  const path='planning/proposals/mobile-trip-departure-'+name+'.sql';
  return '\n-- BEGIN REVIEWED '+path+'\n'+bytes(path).toString()+'\n';
 }).join('');
 expect(bytes('supabase/migrations/'+correction.file).toString()).toBe(
  '-- BR07 Mobile trip departure correction. Exact reviewed bodies followed by private web grants.\n'+bodies+
  'GRANT EXECUTE ON FUNCTION\n crest_commands.read_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),\n'+
  ' crest_commands.correct_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)\n TO crest_web;\n');
 expect(()=>validateMigrationSet(registered63 as MigrationRegistry,new Map(registered63.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered62 as MigrationRegistry)).not.toThrow();
 expect(coverage62).toEqual({...coverage61,migrationCount:62});
 expect(coverage63).toEqual({...coverage62,migrationCount:63});
});
it('registers only the reviewed message outcomes and preserves frozen schema 63',()=>{
 expect(sha256(bytes('tests/support/registered63-migration-checksums.json'))).toBe('bdc8995ba6f85968ed037b566490b907e21c6b2920d22e0a669ff3b4a16c5af3');
 expect(sha256(bytes('tests/support/registered63-export-coverage.json'))).toBe('166b1c164300f1f98fdc510bd260432766131db2f9ae3806f189dba2353a57dc');
 expect(registered64.migrations).toHaveLength(64);
 const change=registered64.migrations.at(-1)!;
 expect(change.file).toBe('20261118180000_review_message_outcomes.sql');
 const bodies=['review-message-outcomes','review-message-outcome-access'].map(name=>{
  const path='planning/proposals/'+name+'.sql';
  return '\n-- BEGIN REVIEWED '+path+'\n'+bytes(path).toString()+'\n';
 }).join('');
 expect(bytes('supabase/migrations/'+change.file).toString()).toBe(
  '-- BR10 saved review-message outcomes and their exact interrupted-save recovery.\n'+bodies+
  'GRANT EXECUTE ON FUNCTION\n crest_commands.read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),\n'+
  ' crest_commands.record_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,uuid,jsonb)\n TO crest_web;\n');
 expect(()=>validateMigrationSet(registered64 as MigrationRegistry,new Map(registered64.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered63 as MigrationRegistry)).not.toThrow();
 expect(coverage64).toEqual({...coverage63,migrationCount:64});
});
it('registers only the reviewed message history reader and preserves frozen schema 64',()=>{
 expect(sha256(bytes('tests/support/registered64-migration-checksums.json'))).toBe('df5f29afbe850614fdb34afc19bd8feae57e1b085514fb3d03422190eaa9a6d0');
 expect(sha256(bytes('tests/support/registered64-export-coverage.json'))).toBe('e7fa04883058d44d30dae8e95a6cb99ba406d3a0d08c414da3c99868d9ee61af');
 expect(registered65.migrations).toHaveLength(65);
 const entry=registered65.migrations.at(-1)!;
 expect(entry.file).toBe('20261119180000_review_message_history.sql');
 const proposal='planning/proposals/review-message-history.sql';
 expect(bytes('supabase/migrations/'+entry.file).toString()).toBe(
  '-- BR10 scoped review-message history. Exact reviewed reader and private web grant.\n\n-- BEGIN REVIEWED '+proposal+'\n'+
  bytes(proposal).toString()+'\nGRANT EXECUTE ON FUNCTION crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid) TO crest_web;\n');
 expect(()=>validateMigrationSet(registered65 as MigrationRegistry,new Map(registered65.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered64 as MigrationRegistry)).not.toThrow();
 expect(coverage65).toEqual({...coverage64,migrationCount:65});
});
it('registers maintenance source relations after the unchanged schema65 prefix',()=>{
 expect(sha256(bytes('tests/support/registered65-migration-checksums.json'))).toBe('bc59dcf082f3e09d50f4bd4ae5fd7ecf987d2f2abf73990cc16b3905be0c18f8');
 expect(sha256(bytes('tests/support/registered65-export-coverage.json'))).toBe('6956f43f69821920e583e09de448a0f144aa643bb5fc0e1aa18a8aecb0e55bbf');
 expect(registered66.migrations).toHaveLength(66);
 const entry=registered66.migrations.at(-1)!;
 expect(entry.file).toBe('20261120180000_maintenance_follow_up.sql');
 const sql=bytes('supabase/migrations/'+entry.file).toString();
 for(const name of ['tasks','reads','originals','source','schema-compatibility']){
  const path='planning/proposals/maintenance-follow-up-'+name+'.sql';
  expect(sql).toContain('-- BEGIN REVIEWED '+path+'\n'+bytes(path).toString().replaceAll('\r\n','\n')+'-- END REVIEWED '+path+'\n');
 }
 expect(()=>validateMigrationSet(registered66 as MigrationRegistry,new Map(registered66.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered65 as MigrationRegistry)).not.toThrow();
 expect(coverage66.migrationCount).toBe(66);
 expect(coverage66.tables.slice(0,-2)).toEqual(coverage65.tables);
 expect(coverage66.tables.slice(-2).map(row=>row.table)).toEqual(['crest.follow_up_tasks','crest.follow_up_task_events']);
});
it('registers custody after the frozen66 prefix without activating production',()=>{
 expect(sha256(bytes('tests/support/registered66-migration-checksums.json'))).toBe('f8b1e968201fba0d24b782a9fe3639f0ce6baeea2276eee98c0208ecd0eee28f');
 expect(sha256(bytes('tests/support/registered66-export-coverage.json'))).toBe('93403923d39cf6ba8125ffb5d0114f36a03819396f8bcb3048e1c161a038dcc7');
 expect(registered67.migrations).toHaveLength(67);
 expect(registered67.migrations.at(-1)!.file).toBe('20261121180000_dropoff_custody.sql');
 expect(()=>validateMigrationSet(registered67 as MigrationRegistry,new Map(registered67.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered66 as MigrationRegistry)).not.toThrow();
 expect(coverage67.migrationCount).toBe(67);
 expect(coverage67.tables.slice(0,coverage66.tables.length)).toEqual(coverage66.tables);
 expect(coverage67.tables.slice(coverage66.tables.length).map(row=>row.table)).toEqual([
  'crest.custody_authorization_configs','crest.custody_cases','crest.custody_events','crest.custody_photo_attempts','crest.custody_photo_originals']);
});
it('registers Drop-Off policy revision after the immutable custody schema',()=>{
 expect(sha256(bytes('tests/support/registered67-migration-checksums.json'))).toBe('a1f68cff218bb818ca48dc444e95eaa30e344603449e2b0bf5c986eab1f35889');
 expect(sha256(bytes('tests/support/registered67-export-coverage.json'))).toBe('3b97dc516e73b50063c6f30b6642dc983bc8379b40676f7729023e8e5b76c9d9');
 expect(registered68.migrations).toHaveLength(68);
 expect(registered68.migrations.at(-1)).toEqual({version:'20261122180000',file:'20261122180000_dropoff_policy_revision.sql',
  sha256:'9e968b4ef0f9eb6e665d093f28a4f522c4512f8248e7a55ef94dd7739f36831b'});
 expect(()=>validateMigrationSet(registered68 as MigrationRegistry,new Map(registered68.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered67 as MigrationRegistry)).not.toThrow();
 expect(coverage68).toEqual({...coverage67,migrationCount:68});
});
it('registers pickup custody after frozen68 with the reviewed SQL and exact source columns',()=>{
 expect(sha256(bytes('tests/support/registered68-migration-checksums.json'))).toBe('4388e636855e46a0ce83c14af951b73c57b9621f3cf6ff8584fc5d4884469d06');
 expect(sha256(bytes('tests/support/registered68-export-coverage.json'))).toBe('226d4692b549b16374f8e51c0e416cd9b89f920e54f956b9d00f7d8c6aa30b2b');
 expect(registered69.migrations).toHaveLength(69);
 expect(registered69.migrations.at(-1)).toEqual({version:'20261123180000',file:'20261123180000_pickup_custody.sql',
  sha256:'a752174e604d06ea777d64b697c5cda99af34b6d8edb02b2d80822cd8e9dc054'});
 expect(()=>validateMigrationSet(registered69 as MigrationRegistry,new Map(registered69.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered68 as MigrationRegistry)).not.toThrow();
 const expectedTables=Object.entries(pickupCustodySourceColumns).map(([name,required])=>({
  table:'crest_private.'+name,scope:'business',required,excluded:[],partialEvidenceGroup:null
 }));
 expect(coverage69).toEqual({...coverage68,migrationCount:69,tables:[...coverage68.tables,...expectedTables]});
});
it('registers pickup return after frozen69 and keeps production blocked',()=>{
 expect(sha256(bytes('tests/support/registered69-migration-checksums.json'))).toBe('c43ff400d162d7a4f56c543fa54bf62fa3d54d6eb80ae3c940c480a38f43fe2a');
 expect(sha256(bytes('tests/support/registered69-export-coverage.json'))).toBe('c70b5284cbfb4abfdc02442e8e99f50f0c0a095a4483418aacb7aead54512217');
 expect(registered70.migrations).toHaveLength(70);
 expect(registered70.migrations.at(-1)).toEqual({version:'20261124180000',file:'20261124180000_pickup_return_workflow.sql',
  sha256:'177298df23e2216a5daa4370f662e54ffb0ad996d62d59d5dc1f9a5f4293cec2'});
 expect(()=>validateMigrationSet(registered70 as MigrationRegistry,new Map(registered70.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered69 as MigrationRegistry)).not.toThrow();
 expect(coverage70.migrationCount).toBe(70);
 const inherited=coverage69.tables.map(table=>table.table==='crest_private.pickup_photo_slots'
  ? {...table,required:[...table.required.slice(0,5),'return_collection_id',...table.required.slice(5)]} : table);
 expect(coverage70.tables.slice(0,inherited.length)).toEqual(inherited);
 expect(coverage70.tables.slice(inherited.length).map(row=>row.table)).toEqual(['crest_private.pickup_custody_releases','crest_private.pickup_return_failures']);
});
it('registers account configuration after the exact accepted70 prefix with complete coverage',()=>{
 expect(sha256(bytes('tests/support/registered70-migration-checksums.json'))).toBe('196cf9e6daffb9c4398a36c6010423545013ec5fa6049defd4ddf3025a858d54');
 expect(sha256(bytes('tests/support/registered70-export-coverage.json'))).toBe('ea658e83083978f815089ee648461b10ee7bea73ebeab114cc26332e845355e6');
 expect(registered71.migrations).toHaveLength(71);
 const file='20261125180000_finance_account_configuration.sql';
 expect(registered71.migrations.at(-1)).toEqual({version:'20261125180000',file,
  sha256:'940896bf6d34ff8d3fd72116241fcbc5065b4cd419ca4266e0e10ef71cd2be4d'});
 expect(()=>validateMigrationSet(registered71 as MigrationRegistry,new Map(registered71.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered70 as MigrationRegistry)).not.toThrow();
 const sql=bytes('supabase/migrations/'+file).toString(),parts=['finance-accounts.sql','finance-account-commands.sql','finance-account-mappings.sql'];
 let previous=-1;
 for(const part of parts){
  const offset=sql.indexOf('-- '+part+'\n'+bytes('planning/proposals/'+part).toString().trimEnd()+'\n');
  expect(offset).toBeGreaterThan(previous);previous=offset;
 }
 const sourceTables=[...Object.entries(financeAccountSourceColumns).map(([name,columns])=>['crest.'+name,columns] as const),
  ['crest_private.finance_controls',['id','business_id','recovery_authority_id','created_at','created_by','origin']] as const];
 expect(coverage71).toEqual({...coverage70,migrationCount:71,tables:[...coverage70.tables,
  ...sourceTables.map(([table,required])=>({table,scope:'business',required,excluded:[],partialEvidenceGroup:null}))]});
});
it('registers tax profiles after the exact accepted71 prefix and inventories every persisted field',()=>{
 expect(sha256(bytes('tests/support/registered71-migration-checksums.json'))).toBe('5769296d8ee5fcc63b2f1a27c38a88a4cd3f2ffff533bc07723b93883113cef3');
 expect(sha256(bytes('tests/support/registered71-export-coverage.json'))).toBe('cffa35a1da8be180222bb15b2154f272aacc3d5de409da1966edd4a052beb5b3');
 const file='20261126180000_finance_tax_profiles.sql';
 expect(currentRegistry.migrations).toHaveLength(72);
 expect(currentRegistry.migrations.at(-1)).toEqual({version:'20261126180000',file,
  sha256:'8a747b6cb79950dcb8bcd5d626e88b7ae7d872c8e9793e6be9b6aff65dcb37fe'});
 expect(bytes('supabase/migrations/'+file).equals(bytes('planning/proposals/finance-tax-profiles.sql'))).toBe(true);
 expect(()=>validateMigrationSet(currentRegistry as MigrationRegistry,new Map(currentRegistry.migrations.map(m=>[m.file,bytes('supabase/migrations/'+m.file)])),registered71 as MigrationRegistry)).not.toThrow();
 expect(currentCoverage).toEqual({...coverage71,migrationCount:72,tables:[...coverage71.tables,
  {table:'crest.tax_profiles',scope:'business',required:financeTaxSourceColumns,excluded:[],partialEvidenceGroup:null}]});
 expect(currentCompatibility).toEqual({...compatibility,schemaMaximum:72});
});
it('freezes accepted53 coverage and compatibility without production or finance activation',()=>{
 expect(compatibility).toEqual({...previousCompatibility,schemaMaximum:54});for(const prior of [registration.previousCoverage,registration.previousCompatibility])expect(sha256(bytes(prior.frozenFixture))).toBe(prior.sha256);expect(registration).toMatchObject({schemaVersion:54,ownerApplied:false,completeCrestExport:false,completeBackup:false,productionActivation:false,runtimeFinancePostingEnabled:false,originalRowsAndHistoryRewritten:false,candidateHeaderRetainedByteExact:true});expect(compatibility.productionActivation).toBe('blocked');
});
