import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatBusinessHistoryCsv} from '../../src/security/business-history-csv.ts';
import {historyFixture} from '../support/business-history-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';

type Parts=ReturnType<typeof formatBusinessHistoryCsv>;
function decode(part:Parts['operations']){
 const rows=readCustomerCsv(part.csv),columns=rows.shift()!,escapes=JSON.parse(part.escapeMap).escapes as {row_id:string;column:string}[];
 const numeric=new Set(['schema_version','result_schema_version']);
 return rows.map(cells=>Object.fromEntries(columns.map((column,index)=>{
  let value:string|number|null=cells[index]!;
  if(value==='\\N')value=null;
  else{
   if(escapes.some(e=>e.row_id===cells[columns.indexOf('id')]&&e.column===column)){expect(value.startsWith("'")).toBe(true);value=value.slice(1);}
   value=value.replaceAll('\\\\','\\');if(numeric.has(column))value=Number(value);
  }
  return [column,value];
 })));
}
const format=(f:ReturnType<typeof historyFixture>)=>formatBusinessHistoryCsv(f.encode(),{businessId:f.businessId});
it('round-trips every operation and audit column including original exact numeric JSON and microseconds',()=>{
 const f=historyFixture(),result=format(f);expect(decode(result.operations)).toEqual([f.operation]);expect(decode(result.audits)).toEqual([f.audit]);
 expect(readCustomerCsv(result.operations.csv)[0]).toEqual(Object.keys(f.operation));expect(readCustomerCsv(result.audits.csv)[0]).toEqual(Object.keys(f.audit));
 expect(decode(result.operations)[0]!.result).toContain('9007199254740993');expect(decode(result.audits)[0]!.delta).toContain('0.12345678901234567890123456789');expect(decode(result.audits)[0]!.recorded_at).toContain('123456');
 for(const value of [result,result.operations,result.audits])expect(Object.isFrozen(value)).toBe(true);
});
it.each([null,'','\\N',"'Owner \\N",'=SUM(A1)',' +1','\t-1','\n@SUM(A1)','\ufeff=1','  É 😀 ",\r\n\\N  '])('preserves null, raw Unicode, literal escape and formula reason %j',reason=>{
 const f=historyFixture();f.audit.reason=reason as string;f.bindAudit();f.refresh();
 // Empty reason is invalid source, never silently rewritten or dropped.
 if(reason===''){expect(()=>format(f)).toThrow('BUSINESS_HISTORY_CSV_REVIEW_REQUIRED');return;}
 const result=format(f);expect(decode(result.audits)).toEqual([f.audit]);expect(decode(result.operations)).toEqual([f.operation]);
 const matrix=readCustomerCsv(result.audits.csv),cell=matrix[1]![matrix[0]!.indexOf('reason')]!;
 if(typeof reason==='string'&&(reason.startsWith("'")||['=','+','-','@'].includes(reason.trimStart()[0]??'')))expect(cell.startsWith("'")).toBe(true);
});
it('retains explicit dictionaries, exact schema fields and separately keyed per-entity formula escape maps',()=>{
 const f=historyFixture();f.audit.reason='=Original review';f.bindAudit();f.refresh();const result=format(f);
 expect(JSON.parse(result.audits.escapeMap)).toMatchObject({entity:'audit_events',businessId:f.businessId,snapshotToken:f.collection.context.snapshotToken,escapes:[{row_id:f.audit.id,column:'reason',apostrophe_prefix:true}]});
 expect(JSON.parse(result.operations.escapeMap).escapes).toEqual([]);
 expect(JSON.parse(result.operations.dictionary).jsonTextColumns).toEqual(['result']);expect(JSON.parse(result.audits.dictionary).jsonTextColumns).toEqual(['delta','payload']);expect(JSON.parse(result.audits.dictionary).exactTextColumns).toEqual(['entity_version']);
});
it('hashes every emitted byte with honest private snapshot and incomplete-recovery metadata',()=>{
 const f=historyFixture(),result=format(f),manifest=JSON.parse(result.manifest),parts:Record<string,string>={'operations.csv':result.operations.csv,'operations_escape_map.json':result.operations.escapeMap,'operations_dictionary.json':result.operations.dictionary,'audit_events.csv':result.audits.csv,'audit_events_escape_map.json':result.audits.escapeMap,'audit_events_dictionary.json':result.audits.dictionary};
 expect(manifest).toMatchObject({scope:'business_history',generationId:f.collection.generationId,businessId:f.businessId,snapshotToken:f.collection.context.snapshotToken,observedAt:f.collection.context.observedAt,recordCounts:{operation:'1',audit_event:'1'},requiredActorIds:[f.actorId],assurance:'internal_consistency_only',referenceClosureComplete:false,completePortableExport:false,completeBackup:false});
 expect(manifest.parts.map((part:{name:string})=>part.name).sort()).toEqual(Object.keys(parts).sort());
 for(const part of manifest.parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
 expect(format(f)).toEqual(result);
});
it('exports an explicitly empty history with both headers and no invented rows or escaped values',()=>{
 const f=historyFixture();f.collection.records=[];f.collection.context.recordCounts={operation:'0',audit_event:'0'};const result=format(f);
 expect(decode(result.operations)).toEqual([]);expect(decode(result.audits)).toEqual([]);expect(JSON.parse(result.operations.escapeMap).escapes).toEqual([]);expect(JSON.parse(result.audits.escapeMap).escapes).toEqual([]);expect(JSON.parse(result.manifest).recordCounts).toEqual({operation:'0',audit_event:'0'});
});
it.each(['foreign','missing audit','bad source hash','bad original audit','extra source column','claimed count','malformed','credential field'])('refuses %s source without returning a partial CSV',issue=>{
 const f=historyFixture();let input:unknown;
 if(issue==='missing audit')f.collection.records.pop();if(issue==='bad source hash')f.collection.records[0]!.evidenceHash='0'.repeat(64);if(issue==='claimed count')f.collection.context.recordCounts.operation='2';
 if(issue==='bad original audit'){f.audit.event_hash='0'.repeat(64);f.refresh();}if(issue==='extra source column'||issue==='credential field'){Object.assign(f.operation,{[issue==='credential field'?'token_hash':'extra']:'Forbidden'});f.refresh();}
 input=f.encode();if(issue==='malformed')input='{malformed';expect(()=>formatBusinessHistoryCsv(input,{businessId:issue==='foreign'?randomUUID():f.businessId})).toThrow('BUSINESS_HISTORY_CSV_REVIEW_REQUIRED');
});
