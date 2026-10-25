import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatLeadEventCsv} from '../../src/customer/lead-csv.ts';
import {leadEventColumns,parseLeadEvent} from '../../src/customer/lead-state-contract.ts';
import type {LeadEvent} from '../../src/customer/lead-state-contract.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const business='11111111-1111-4111-8111-111111111111',token='a'.repeat(64),at='2026-10-25T12:00:00.123456Z';
const row=(patch:Partial<LeadEvent>={}):LeadEvent=>({id:business,business_id:business,lead_id:business,lead_version:'9007199254740993',from_state:'new',to_state:'lost',reason:' =SUM(A1)\nUnicode é 😀 "\\N"',effective_at:at,quote_send_id:null,acceptance_id:null,version:'1',created_at:at,updated_at:at,created_by:business,updated_by:business,origin:'manual',operation_id:business,import_row_id:null,...patch});
const format=(rows:LeadEvent[])=>formatLeadEventCsv({businessId:business,snapshotToken:token,expectedRowCount:String(rows.length),rows});
function decode(result:ReturnType<typeof format>){
 const matrix=readCustomerCsv(result.csv),columns=matrix.shift()!,escapes=JSON.parse(result.escapeMap).escapes as {row_id:string;column:string}[];
 return matrix.map(cells=>{const id=cells[columns.indexOf('id')]!;return parseLeadEvent(Object.fromEntries(columns.map((column,i)=>{let value=cells[i]!;if(value==='\\N')return[column,null];if(escapes.some(e=>e.row_id===id&&e.column===column))value=value.slice(1);return[column,value.replace(/\\\\/g,'\\')];})),business);});
}
it('round-trips all18 immutable event columns with exact versions, UTC, nullable references and escaped reasons',()=>{
 const original=row(),result=format([original]);expect(readCustomerCsv(result.csv)[0]).toEqual([...leadEventColumns]);expect(decode(result)).toEqual([original]);expect(JSON.parse(result.escapeMap).escapes).toContainEqual({row_id:original.id,column:'reason',apostrophe_prefix:true});expect(JSON.parse(result.manifest)).toMatchObject({scope:'lead_state_events',completeCrestExport:false,completeBackup:false});
});
it('keeps unknown optional reasons distinct from recorded text and never invents commercial references',()=>{
 const unknown=row({to_state:'contacted',reason:null}),quoted=row({id:'22222222-2222-4222-8222-222222222222',reason:"'retained\\N"});
 expect(decode(format([quoted,unknown]))).toEqual([unknown,quoted]);expect(()=>format([row({quote_send_id:business as never})])).toThrow('CUSTOMER_DATA_INVALID');expect(()=>format([row({reason:''})])).toThrow('CUSTOMER_DATA_INVALID');
});
it('pins deterministic byte/hash metadata and honest empty headers',()=>{
 const a=format([row()]),b=format([row()]);expect(a).toEqual(b);
 const parts:Record<string,string>={'lead_events.csv':a.csv,'lead_events_escape_map.json':a.escapeMap,'lead_events_dictionary.json':a.dictionary};for(const part of JSON.parse(a.manifest).parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
 expect(readCustomerCsv(format([]).csv)).toEqual([[...leadEventColumns]]);expect(JSON.parse(format([]).manifest).rowCount).toBe('0');
});
it('rejects missing/duplicate/wrong-scope or over-bound source collections instead of omitting history',()=>{
 const input={businessId:business,snapshotToken:token,expectedRowCount:'1',rows:[row()]};for(const patch of [{expectedRowCount:'0'},{expectedRowCount:'1001'},{expectedRowCount:'01'},{snapshotToken:'bad'},{businessId:'22222222-2222-4222-8222-222222222222'},{expectedRowCount:'2',rows:[row(),row()]}])expect(()=>formatLeadEventCsv({...input,...patch})).toThrow('CUSTOMER_DATA_INVALID');
});
