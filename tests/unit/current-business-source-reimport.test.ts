import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatCurrentBusinessReimport} from '../../src/security/current-business-source-reimport';
import {currentBusinessSourceInventory} from '../../src/security/current-business-source-inventory';
import type {CurrentBusinessRows} from '../../src/security/current-business-source';
function fixture(){
 const businessId='11111111-1111-4111-8111-111111111111',sources=currentBusinessSourceInventory.map(source=>({...source,primaryKey:[source.columns.includes('id')?'id':'business_id'],types:Object.fromEntries(source.columns.map(column=>[column,'text'])),rows:[] as Record<string,string|null>[]}));
 const row=Object.fromEntries(sources[0]!.columns.map(column=>[column,null]));Object.assign(row,{id:businessId,legal_name:"'; DROP SCHEMA crest CASCADE; --\r\n=SUM(1,2)\\N",currency:'9007199254740993',timezone:'',version:'1'});sources[0]!.rows.push(row);
 return{schemaVersion:1,profile:'crest.current-business-rows.v1',businessId,snapshotToken:'a'.repeat(64),observedAt:'2026-11-22T20:00:00.000000Z',sources,recordCount:1,completePortableExport:false,completeBackup:false} satisfies CurrentBusinessRows;
}
const binding={appReleaseId:'a'.repeat(40),sourceSchemaVersion:134 as const};
it('escapes SQL literals while retaining exact null, empty, amount, formula and newline values',()=>{
 const capture=fixture(),sql=formatCurrentBusinessReimport(capture,binding).toString();
 expect(sql).toContain("SET LOCAL standard_conforming_strings = on;");expect(sql).toContain("E'''; DROP SCHEMA crest CASCADE; --\r\n=SUM(1,2)\\\\N'");expect(sql).toContain("E'9007199254740993',E'',NULL");expect(sql).toContain('CREATE SCHEMA "crest_portable_source";');expect(sql).not.toContain('IF NOT EXISTS');expect(sql).not.toContain('CREATE ROLE');expect(sql.endsWith('COMMIT;\n')).toBe(true);expect(sql.match(/CREATE TABLE /g)).toHaveLength(currentBusinessSourceInventory.length+1);expect(sql).toContain('"primary_key_json"');
});
it.each(['source','columns','scope','nul','count','key'])('refuses invalid %s source material before returning executable text',issue=>{
 const capture=structuredClone(fixture());if(issue==='source')Object.assign(capture.sources[0]!,{source:'crest_private.actors'});if(issue==='columns')capture.sources[0]!.columns=['id','arbitrary'];if(issue==='scope')capture.sources[0]!.rows[0]!.id='22222222-2222-4222-8222-222222222222';if(issue==='nul')capture.sources[0]!.rows[0]!.legal_name='bad\0';if(issue==='count')capture.recordCount++;if(issue==='key')capture.sources[0]!.primaryKey=['missing'];expect(()=>formatCurrentBusinessReimport(capture,binding)).toThrow('CURRENT_BUSINESS_REIMPORT_REVIEW_REQUIRED');
});
