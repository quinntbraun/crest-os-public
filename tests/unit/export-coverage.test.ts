import {expect,it} from 'vitest';
// Preserve the historical42 construction profile; registered43 is separate.
import manifest from '../support/registered42-export-coverage.json';
import registered43 from '../support/registered43-export-coverage.json';
import proposedJournal from '../../planning/proposals/source-export-journal-coverage.json';
import {verifyExportCoverage as verify} from '../../src/tooling/export-coverage.ts';

const clone=()=>structuredClone(manifest);
it('declares registered43 journal coverage without changing the frozen42 profile or claiming actual catalogue observation',()=>{
 const synthetic=registered43.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
 expect(registered43.migrationCount).toBe(43);expect(verify(registered43,synthetic,43)).toEqual({assurance:'schema_inventory_only',tables:39,requiredColumns:603,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});expect(manifest.migrationCount).toBe(42);expect(manifest.tables).toHaveLength(33);
});
it('retains every proposed journal field without changing the registered inventory or claiming a complete export',()=>{
 const combined={...manifest,tables:[...manifest.tables,...proposedJournal.tables]},rows=combined.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
 expect(proposedJournal).toMatchObject({formatVersion:1,registeredMigrationCount:42,proposedMigration:43,registered:false,assurance:'schema_inventory_only'});expect(proposedJournal.tables.flatMap(t=>t.required)).toHaveLength(114);expect(verify(combined,rows,42)).toEqual({assurance:'schema_inventory_only',tables:39,requiredColumns:603,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});expect(manifest.tables).toHaveLength(33);expect(manifest.migrationCount).toBe(42);
});
it.each(proposedJournal.tables)('refuses omitting a required journal field from $table',entry=>{
 const combined={...manifest,tables:[...manifest.tables,...structuredClone(proposedJournal.tables)]},rows=combined.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
 combined.tables.find(t=>t.table===entry.table)!.required.pop();expect(()=>verify(combined,rows,42)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');
});
it('does not misclassify journal object keys, key IDs or original JSON as excludable credentials',()=>{
 for(const column of ['object_key','key_id','request_text']){const proposed=structuredClone(proposedJournal.tables),entry=proposed.find(t=>t.table==='crest_private.export_part_intents')!,combined={...manifest,tables:[...manifest.tables,...proposed]},rows=combined.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));entry.required=entry.required.filter(v=>v!==column);const changed={...entry,excluded:[{column,reason:'session_credential'}]};combined.tables=combined.tables.map(t=>t.table===entry.table?changed:t);expect(()=>verify(combined,rows,42)).toThrow('EXPORT_COVERAGE_REVIEW_REQUIRED');}
});
// Only a synthetic input for validator failure tests. Actual schema coverage is
// checked against pg_catalog in provider-reference-snapshot.test.mjs.
const observed=()=>manifest.tables.flatMap(t=>[...t.required,...t.excluded.map(e=>e.column)].map(column=>({table:t.table,column})));
const error='EXPORT_COVERAGE_REVIEW_REQUIRED';
it('reports declared schema coverage without promising a complete export or backup',()=>{
 const result=verify(manifest,observed(),manifest.migrationCount);
 expect(result).toEqual({assurance:'schema_inventory_only',tables:33,requiredColumns:489,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 expect(Object.isFrozen(result)).toBe(true);
});
it('accepts different catalog and declaration order',()=>{const m=clone();m.tables.reverse();for(const t of m.tables)t.required.reverse();expect(verify(m,observed().reverse(),manifest.migrationCount).tables).toBe(33);});
it.each([undefined,null,[],{},'manifest',3])('rejects malformed manifest %s',value=>expect(()=>verify(value,observed(),manifest.migrationCount)).toThrow(error));
it.each([0,-1,manifest.migrationCount-1,manifest.migrationCount+1,1.5,NaN,Infinity])('rejects incompatible applied migration count %s',value=>expect(()=>verify(manifest,observed(),value)).toThrow(error));
it('rejects unsupported format and extra top-level assertions',()=>{for(const m of [{...clone(),formatVersion:2},{...clone(),completePortableExport:true}])expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);});
it.each([undefined,null,[],{},[{table:'crest.businesses',column:'id',value:'do not read rows'}]])('rejects malformed/empty catalog input %s',value=>expect(()=>verify(manifest,value,manifest.migrationCount)).toThrow(error));
it('rejects a newly implemented table until its export policy is reviewed',()=>expect(()=>verify(manifest,[...observed(),{table:'crest.new_entity',column:'id'}],manifest.migrationCount)).toThrow(error));
it('rejects a newly implemented column until its export policy is reviewed',()=>expect(()=>verify(manifest,[...observed(),{table:'crest.businesses',column:'new_field'}],manifest.migrationCount)).toThrow(error));
it('rejects a removed table or column',()=>{
 for(const rows of [observed().filter(r=>r.table!=='crest.businesses'),observed().slice(1)])expect(()=>verify(manifest,rows,manifest.migrationCount)).toThrow(error);
});
it('rejects repeated catalog columns and tables outside the owned schemas',()=>{
 for(const rows of [[...observed(),observed()[0]],[...observed(),{table:'auth.users',column:'id'}]])expect(()=>verify(manifest,rows,manifest.migrationCount)).toThrow(error);
});
it('rejects duplicate declared tables',()=>{const m=clone();m.tables.push(m.tables[0]!);expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);});
it('rejects missing/duplicate/unknown declared columns',()=>{
 for(const name of ['missing','duplicate','unknown']){const m=clone(),t=m.tables[0]!;if(name==='missing')t.required.shift();else t.required.push(name==='duplicate'?t.required[0]!:'unknown');expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
it('rejects moving each reviewed sensitive column into portable output',()=>{
 for(const t of manifest.tables)for(const e of t.excluded){const m=clone(),copy=m.tables.find(x=>x.table===t.table)!;copy.excluded=copy.excluded.filter(x=>x.column!==e.column);copy.required.push(e.column);expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
it('rejects hiding required history under a recognized exclusion label',()=>{const m=clone(),t=m.tables[0]!;t.excluded.push({column:t.required.shift()!,reason:'session_credential'});expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);});
it('rejects unknown or incorrect exclusion reasons',()=>{
 for(const reason of ['convenience','browser_credential']){const m=clone(),e=m.tables.find(t=>t.table==='crest_private.app_sessions')!.excluded[0]!;e.reason=reason;expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
it('rejects duplicated or simultaneously required/excluded sensitive columns',()=>{
 for(const duplicate of [true,false]){const m=clone(),t=m.tables.find(t=>t.excluded.length)!;if(duplicate)t.excluded.push(t.excluded[0]!);else t.required.push(t.excluded[0]!.column);expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
it('rejects unsupported scopes and misleading full-row coverage assertions',()=>{
 for(const override of [{scope:'all_tenants'},{complete:true}]){const m=clone();Object.assign(m.tables[0]!,override);expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
it('rejects renamed, omitted or misplaced partial-evidence groups',()=>{
 for(const group of ['unknown',null,'session_event']){const m=clone();m.tables.find(t=>t.table==='crest_private.app_sessions')!.partialEvidenceGroup=group;expect(()=>verify(m,observed(),manifest.migrationCount)).toThrow(error);}
});
