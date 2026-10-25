import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {formatLeadCsv,formatLeadSourceCsv} from '../../src/customer/lead-csv.ts';
import {leadFixture,leadSourceFixture,leadBusiness} from '../support/lead-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const snapshotToken='a'.repeat(64);
function decode(result:ReturnType<typeof formatLeadCsv>){const matrix=readCustomerCsv(result.csv),columns=matrix.shift()!,escapes=JSON.parse(result.escapeMap).escapes as {row_id:string;column:string}[];return matrix.map(cells=>{const id=cells[columns.indexOf('id')]!;return Object.fromEntries(columns.map((column,i)=>{let text=cells[i]!;if(text==='\\N')return [column,null];if(escapes.some(e=>e.row_id===id&&e.column===column))text=text.slice(1);text=text.replace(/\\\\/g,'\\');if(column==='source_snapshot')return [column,JSON.parse(text)];if(column==='active')return [column,text==='true'];return [column,text];}));});}
it('round-trips all26 lead columns, exact cents/times and retained source JSON without contact or null inference',()=>{
 const source=leadSourceFixture({label:'=Formula é 😀',kind:'Quoted "source" \\N'}),row=leadFixture({label:'  +private',source_id:source.id,source_snapshot:source,phone_raw:'00123',phone_normalized:'00123',email_raw:'raw@EXAMPLE.com',email_normalized:'raw@example.com',estimated_cents:'9007199254740993',notes:'\\N\n=SUM(A1)',availability:'',follow_up_at:'2026-10-25T00:00:00.123456Z'});
 const result=formatLeadCsv({businessId:leadBusiness,snapshotToken,expectedRowCount:'1',rows:[row]});expect(readCustomerCsv(result.csv)[0]).toHaveLength(26);expect(decode(result)).toEqual([row]);expect(JSON.parse(result.escapeMap).escapes).toContainEqual({row_id:row.id,column:'label',apostrophe_prefix:true});expect(JSON.parse(result.manifest)).toMatchObject({completeCrestExport:false,completeBackup:false});
});
it('round-trips inactive source/referral metadata and formula or apostrophe text with declared escapes',()=>{
 const row=leadSourceFixture({active:false,label:"'retained source",kind:'@formula'}),result=formatLeadSourceCsv({businessId:leadBusiness,snapshotToken,expectedRowCount:'1',rows:[row]});expect(readCustomerCsv(result.csv)[0]).toHaveLength(15);expect(decode(result)).toEqual([row]);expect(JSON.parse(result.escapeMap).escapes).toHaveLength(2);
});
it('pins deterministic UUID ordering and independent exact byte/hash manifests',()=>{
 const first=leadFixture(),next=leadFixture({id:'33333333-3333-4333-8333-333333333333'}),one=formatLeadCsv({businessId:leadBusiness,snapshotToken,expectedRowCount:'2',rows:[next,first]}),two=formatLeadCsv({businessId:leadBusiness,snapshotToken,expectedRowCount:'2',rows:[first,next]});expect(one).toEqual(two);expect(decode(one).map(row=>row.id)).toEqual([first.id,next.id]);
 const parts:Record<string,string>={'leads.csv':one.csv,'leads_escape_map.json':one.escapeMap,'leads_dictionary.json':one.dictionary};for(const p of JSON.parse(one.manifest).parts){expect(p.bytes).toBe(Buffer.byteLength(parts[p.name]!));expect(p.sha256).toBe(createHash('sha256').update(parts[p.name]!).digest('hex'));}
});
it('rejects incomplete counts, duplicates, wrong scope, oversized collection and bad snapshot bindings',()=>{
 const input={businessId:leadBusiness,snapshotToken,expectedRowCount:'1',rows:[leadFixture()]};for(const patch of [{expectedRowCount:'0'},{expectedRowCount:'01'},{expectedRowCount:'1001'},{snapshotToken:'bad'},{businessId:'33333333-3333-4333-8333-333333333333'},{rows:[leadFixture(),leadFixture()],expectedRowCount:'2'}])expect(()=>formatLeadCsv({...input,...patch})).toThrow('CUSTOMER_DATA_INVALID');
});
it('empty lead/source snapshots produce headers, honest zero counts and valid manifests',()=>{
 for(const format of [formatLeadCsv,formatLeadSourceCsv]){const result=format({businessId:leadBusiness,snapshotToken,expectedRowCount:'0',rows:[]});expect(readCustomerCsv(result.csv)).toHaveLength(1);expect(JSON.parse(result.manifest).rowCount).toBe('0');expect(JSON.parse(result.dictionary).completeness).toContain('not a complete');}
});
