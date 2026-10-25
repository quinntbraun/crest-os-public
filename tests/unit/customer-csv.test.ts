import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {formatCustomerCsv} from '../../src/customer/customer-csv.ts';
import {CustomerDataError} from '../../src/customer/customer-contract.ts';
import {customerFixture,customerBusiness,readCustomerCsv} from '../support/customer-fixture.ts';
const token='a'.repeat(64),input=(rows=[customerFixture()])=>({businessId:customerBusiness,snapshotToken:token,expectedRowCount:String(rows.length),rows});
it('round trips null, empty, literal null marker, backslashes, quotes, newlines, formulas and exact large versions',()=>{
  const values=[null,'','\\N','\\\\N',"'original",'=1+2',' \t+SUM(1,2)','\n@function','-original','ordinary, "quoted"\r\n é 😀'];
  const rows=values.map((notes,i)=>customerFixture({id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,notes,version:'9007199254740993'})).reverse();
  const result=formatCustomerCsv(input(rows)),matrix=readCustomerCsv(result.csv),headers=matrix.shift()!,map=JSON.parse(result.escapeMap),slash=String.fromCharCode(92);
  const reconstructed=matrix.map(cells=>Object.fromEntries(headers.map((column,i)=>{
    let value:string|boolean|null=cells[i]!;if(value===slash+'N')value=null;
    else {if(map.escapes.some((e:{row_id:string;column:string})=>e.row_id===cells[0]&&e.column===column)){expect(value.startsWith("'")).toBe(true);value=value.slice(1);}value=value.replaceAll(slash+slash,slash);if(column==='outreach_opt_out')value=value==='true';}
    return [column,value];
  })));
  expect(reconstructed).toEqual([...rows].sort((a,b)=>a.id<b.id?-1:1));expect(rows[0]!.notes).toBe(values.at(-1));expect(result.csv.endsWith('\r\n')).toBe(true);expect(map.escapes).toHaveLength(5);
});
it('manifest binds every part checksum/byte length and explicitly limits completeness to this domain',()=>{
  const parts=formatCustomerCsv(input()),m=JSON.parse(parts.manifest),texts={'customers.csv':parts.csv,'customer_escape_map.json':parts.escapeMap,'customer_dictionary.json':parts.dictionary};
  expect(m.completeCrestExport).toBe(false);expect(m.completeBackup).toBe(false);expect(m.rowCount).toBe('1');expect(m.snapshotToken).toBe(token);
  for(const p of m.parts){const content=texts[p.name as keyof typeof texts];expect(p.bytes).toBe(Buffer.byteLength(content));expect(p.sha256).toBe(createHash('sha256').update(content).digest('hex'));}
  expect(JSON.parse(parts.dictionary).columns).toHaveLength(21);
});
it('empty domain remains an explicit header-only export',()=>{const p=formatCustomerCsv(input([]));expect(readCustomerCsv(p.csv)).toHaveLength(1);expect(JSON.parse(p.manifest).rowCount).toBe('0');});
it.each(['bad-token','../private','A'.repeat(64)])('rejects invalid snapshot reference %s',snapshotToken=>expect(()=>formatCustomerCsv({...input(),snapshotToken})).toThrow(CustomerDataError));
it('refuses incomplete/duplicate/foreign/future-field rows and sparse arrays',()=>{
  for(const value of [{...input(),expectedRowCount:'2'},input([customerFixture(),customerFixture()]),input([customerFixture({business_id:randomUUID()})]),{...input(),rows:[{...customerFixture(),secret:'private'}]}, {...input(),rows:Array(1)}])expect(()=>formatCustomerCsv(value)).toThrow(CustomerDataError);
});
it('processing bounds fail rather than returning a truncated apparent success',()=>{const rows=Array.from({length:1000},()=>customerFixture({id:randomUUID(),notes:'😀'.repeat(2000),email_raw:'é'.repeat(512),email_normalized:'é'.repeat(512)}));expect(()=>formatCustomerCsv(input(rows))).toThrow(CustomerDataError);expect(()=>formatCustomerCsv({...input(),expectedRowCount:'1001'})).toThrow(CustomerDataError);});
